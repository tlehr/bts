'use strict';

const assert = require('assert');
const crypto = require('crypto');
const net = require('net');

const async = require('async');

const btp_proto = require('./btp_proto');
const bulk_decoder = require('./btp_decode');
const btp_parse = require('./btp_parse');
const btp_sync = require('./btp_sync');
const debug_flags = require('./debug_flags');
const serror = require('./serror');

const AUTOFETCH_TIMEOUT = 30000;
const CONNECT_TIMEOUT = 5000;
const WAIT_TIMEOUT = 10000;
const FETCH_HARD_TIMEOUT = CONNECT_TIMEOUT + WAIT_TIMEOUT + 5000;
const BTP_PORT = 9901;
const BLP_PORT = 9911;

function fetch_hard_timeout_ms() {
	const configured = Number(process.env.BTS_BTP_FETCH_HARD_TIMEOUT_MS);
	if (Number.isFinite(configured) && configured > 0) {
		return Math.round(configured);
	}
	return FETCH_HARD_TIMEOUT;
}

function normalize_autofetch_timeout_ms(autofetch_timeout_intervall) {
	const parsed_autofetch_timeout_seconds = Number(autofetch_timeout_intervall);
	const timeout_ms = parsed_autofetch_timeout_seconds * 1000;
	// Node replaces overflowing timers with 1 ms, which would continuously
	// refetch instead of respecting the configured interval.
	return Number.isFinite(timeout_ms) && timeout_ms > 0 && timeout_ms <= 2147483647
		? timeout_ms
		: AUTOFETCH_TIMEOUT;
}

function now_ms(app) {
	return app?.clock ? app.clock.now_ms() : Date.now();
}

function real_now_ms(app) {
	return app?.clock ? app.clock.real_now_ms() : Date.now();
}

function warn_compact(label, payload, failure = false) {
	if (!failure && !require('./server_diagnostics').sync_timing_enabled(payload.tournament_key)) return;
	try {
		console.warn(`${label} ${JSON.stringify(payload)}`);
	} catch (err) {
		console.warn(label, payload);
	}
}

function request_fetch(connection, reschedule_fetch) {
	// Background triggers do not await the fetch. Observe failures here while
	// fetch() itself retains a shared promise for callers that do await it.
	return connection.fetch(connection, reschedule_fetch).catch(err => {
		serror.silent('BTP fetch failed: ' + (err.message || String(err)));
		return null;
	});
}

async function queue_fetch_sync_task(connection, response, fetch_reset_ts, response_hash, fetch_start_ms) {
	const state = await fetch_response_state(connection, fetch_reset_ts);
	if (!state.ok) {
		log_ignored_fetch_response(connection, state.reason, real_now_ms(connection.app) - fetch_start_ms);
		return null;
	}
	// Planning and comparison take place outside the resource queue. The sync
	// itself queues only the resources its validated writes actually affect.
	const value = await btp_sync.sync_btp_data(connection.app, connection.tkey, response, {
		expected_reset_ts: fetch_reset_ts,
		is_current: () => !connection.terminated,
		...(require('./btp_decode/response_hashes').get(response) ? {
			source_hash: require('./btp_decode/response_hashes').get(response).sha256,
			source_json: require('./btp_decode/response_hashes').get(response).json,
		} : {}),
	});
	if (value === true || value?.reason === 'no_sync_changes') {
		connection.last_applied_fetch_response_hash = response_hash;
		connection.last_applied_fetch_reset_ts = fetch_reset_ts;
	}
	if (value?.skipped) {
		warn_compact('[bts] btp_fetch:sync_skipped', {
			tournament_key: connection.tkey, reason: value.reason,
			duration_ms: real_now_ms(connection.app) - fetch_start_ms,
		});
		if (value.reason !== 'no_sync_changes') return null;
	}
	return value;
}

async function fetch_response_state(connection, fetch_reset_ts) {
	if (!connection || connection.terminated) {
		return { ok: false, reason: 'connection_terminated' };
	}
	const tournaments = connection.app?.db?.tournaments;
	if (!tournaments || typeof tournaments.findOne_async !== 'function') {
		return { ok: true, reason: 'no_tournament_store' };
	}
	const tournament = await tournaments.findOne_async({ key: connection.tkey }, { btp_enabled: 1, last_reset_ts: 1 });
	if (connection.terminated) {
		return { ok: false, reason: 'connection_terminated' };
	}
	if (!tournament || tournament.btp_enabled !== true) {
		return { ok: false, reason: 'btp_disabled' };
	}
	if (tournament.last_reset_ts !== fetch_reset_ts) {
		return { ok: false, reason: 'tournament_reset_during_fetch' };
	}
	return { ok: true, reason: 'current' };
}

function log_ignored_fetch_response(connection, reason, duration_ms) {
	warn_compact('[bts] btp_fetch:response_ignored', {
		tournament_key: connection?.tkey,
		reason,
		duration_ms,
	});
}

function hash_fetch_response(response) {
	return crypto
		.createHash('sha1')
		.update(JSON.stringify(response))
		.digest('hex');
}

function count_pending_local_btp_sync(app, tkey) {
	return new Promise((resolve) => {
		const matches = app?.db?.matches;
		if (!matches) {
			resolve({ ok: false, count: null, reason: 'no_match_store' });
			return;
		}
		const query = tkey
			? { tournament_key: tkey, btp_needsync: true }
			: { btp_needsync: true };
		if (typeof matches.count === 'function') {
			matches.count(query, (err, count) => {
				if (err) {
					resolve({ ok: false, count: null, reason: err.message || String(err) });
					return;
				}
				resolve({ ok: true, count });
			});
			return;
		}
		if (typeof matches.find_async === 'function') {
			matches.find_async(query)
				.then((pending_matches) => resolve({ ok: true, count: pending_matches.length }))
				.catch((err) => resolve({ ok: false, count: null, reason: err.message || String(err) }));
			return;
		}
		resolve({ ok: false, count: null, reason: 'no_count_api' });
	});
}

function response_has_hidden_empty_bye_branch_winners(response) {
	try {
		const btp_state = btp_parse.get_btp_state(response);
		const candidates = btp_sync._find_hidden_empty_bye_branch_winner_candidates(btp_state);
		if (require('./server_diagnostics').sync_timing_enabled()) {
			warn_compact('[bts] btp_fetch:hidden_empty_bye_check', {
				candidate_count: candidates.length,
				candidates: candidates.slice(0, 20).map((match) => ({
					id: match.ID && match.ID[0],
					match_num: match.MatchNr && match.MatchNr[0],
					draw: match.DrawID && match.DrawID[0],
					planning: match.PlanningID && match.PlanningID[0],
					from1: match.From1 && match.From1[0],
					from2: match.From2 && match.From2[0],
				})),
			});
		}
		return candidates.length > 0;
	} catch (err) {
		warn_compact('[bts] btp_fetch:hidden_bye_check_failed', {
			reason: err && (err.message || String(err)),
		}, true);
		return false;
	}
}

async function should_skip_fetch_sync(connection, response_hash, response = null) {
	if (!response_hash || !connection.last_applied_fetch_response_hash) {
		return { skip: false, reason: 'no_previous_response_hash' };
	}
	if (connection.last_applied_fetch_response_hash !== response_hash) {
		return { skip: false, reason: 'response_changed' };
	}
	const pending = await count_pending_local_btp_sync(connection.app, connection.tkey);
	if (!pending.ok) {
		return { skip: false, reason: `pending_check_failed:${pending.reason}` };
	}
	if (pending.count > 0) {
		return { skip: false, reason: 'local_btp_sync_pending', pending_count: pending.count };
	}
	if (response && response_has_hidden_empty_bye_branch_winners(response)) {
		if (connection.last_hidden_empty_bye_response_hash_attempted === response_hash) {
			return { skip: true, reason: 'identical_response_after_hidden_empty_bye_attempt' };
		}
		connection.last_hidden_empty_bye_response_hash_attempted = response_hash;
		return { skip: false, reason: 'hidden_empty_bye_branch_pending' };
	}
	return { skip: true, reason: 'identical_response_without_local_pending_sync' };
}


function send_raw_request(ip, port, raw_req, callback) {
	assert(callback);
	if (!ip) {
		return callback(new Error('No IP address specified'));
	}
	let called = false;
	const client = net.connect({host: ip, port, timeout: CONNECT_TIMEOUT}, () => {
		if (called) return;
		client.setTimeout(WAIT_TIMEOUT);
		client.write(raw_req);
	});

	const got = [];
	client.on('error', (err) => {
		if (called) return;
		called = true;
		callback(err);
	});
	client.on('timeout', () => {
		if (called) return;
		called = true;
		client.destroy();
		callback(new Error(`Connection to ${ip}:${port} timed out after ${WAIT_TIMEOUT}ms`));
	});
	client.on('data', (data) => {
		if (!called) got.push(data);
	});
	client.on('end', () => {
		if (called) return;
		called = true;

		callback(null, Buffer.concat(got));
	});
	return () => {
		if (called) return;
		called = true;
		client.destroy();
	};
}

function send_request(ip, port, xml_req, timeZone, callback, context) {
	assert(callback);
	let encoded_req;
	try {
		encoded_req = btp_proto.encode(xml_req, timeZone);
	} catch(e) {
		serror.silent('Error while encoding for BTP:' + e.message);
		return callback(e);
	}
	let cancelled = false;
	let cancel_decode;
	const cancel_raw = send_raw_request(ip, port, encoded_req, (err, raw_response) => {
		if (cancelled) return;
		if (err) return callback(err);
		if (context?.action === 'SENDTOURNAMENTINFO' && require('./offload/profile').enabled('btp_decode')) {
			cancel_decode = bulk_decoder.decode(raw_response, context, (error, decoded) => {
				if (cancelled) return;
				if (error?.btp_parse_error) serror.silent('Encountered an error while parsing BTP message: ' + error.message);
				callback(error, decoded);
			});
		} else {
			btp_proto.decode(raw_response, callback, context);
		}
	});
	return () => {
		cancelled = true;
		if (typeof cancel_raw === 'function') cancel_raw();
		if (cancel_decode) cancel_decode();
	};
} 


class BTPConn {
	constructor(app, ip, password, tkey, enabled_autofetch, readonly, is_team, timeZone, autofetch_timeout_intervall) {
		this.app = app;
		this.last_status = { status: 'activated', message: '' };
		this.ip = ip;
		this.password = password;
		this.tkey = tkey;
		this.timeZone = timeZone;
		this.terminated = false;
		this.enabled_autofetch = enabled_autofetch;
		this.autofetch_timeout = null;
		this.next_fetch_ts = null;
		this.fetch_in_progress = false;
		this.fetch_promise = null;
		this.fetch_reschedule_requested = false;
		this.last_applied_fetch_reset_ts = undefined;
		this.readonly = readonly;
		this.is_team = is_team;
		this.autofetch_timeout_intervall = normalize_autofetch_timeout_ms(autofetch_timeout_intervall);
		this.last_applied_fetch_response_hash = null;
		this.connect();
	}

	connect() {
		if (this.terminated) {
			return;
		}

		this.report_status('connecting','Try to establish connection to BTP.');
		this.send(btp_proto.login_request(this.password), response => {
			if (!response || response == null || !response.Action || !response.Action[0] || !response.Action[0].ID[0] || (response.Action[0].ID[0] !== 'REPLY')) {
				this.report_status('error','Invalid reply to login request');
				return;
			}

			if (response.Action[0].Result[0] !== 1) {
				this.report_status('error', 'Invalid password');
				return;
			}

			this.report_status('connected','Logged in.');
			this.key_unicode = response.Action[0].Unicode[0];

			this.pushall();
			if (this.enabled_autofetch) {
				request_fetch(this, true);
			}
		});
	}

	sync_data() {
		if (this.autofetch_timeout) {
			clearTimeout(this.autofetch_timeout);
			this.autofetch_timeout = null;
		}
		this.next_fetch_ts = null;
		this.publish_status();
		return request_fetch(this, this.enabled_autofetch);
	}

	fetch(connection = this, reschedule_fetch = false) {
		if (connection.terminated) {
			return Promise.resolve(null);
		}
		connection.fetch_reschedule_requested = connection.fetch_reschedule_requested || reschedule_fetch === true;
		if (connection.fetch_promise) {
			return connection.fetch_promise;
		}
		connection.fetch_in_progress = true;
		connection.next_fetch_ts = null;
		connection.publish_status();
		let reschedule = true; // Failed integrations remain eligible for an automatic retry.
		// Defer execution until the shared promise is installed. It spans receipt
		// and integration, preventing a second fetch from overtaking this one.
		connection.fetch_promise = Promise.resolve().then(() => connection._fetch_once()).then(result => {
			reschedule = result.reschedule;
			return result.value;
		}).finally(() => {
			connection.fetch_promise = null;
			connection.fetch_in_progress = false;
			const requested = connection.fetch_reschedule_requested;
			connection.fetch_reschedule_requested = false;
			if (!connection.terminated) {
				if (reschedule && requested) {
					connection.schedule_fetch();
				} else {
					connection.publish_status();
				}
			}
		});
		return connection.fetch_promise;
	}

	_fetch_response(fetch_start_ms) {
		return new Promise((resolve, reject) => {
			let settled = false;
			let hard_timeout;
			let cancel_send;
			const finish = (err, value) => {
				if (settled) return;
				settled = true;
				clearTimeout(hard_timeout);
				if (typeof cancel_send === 'function') cancel_send();
				this.cancel_fetch_request = null;
				if (err) reject(err);
				else resolve(value);
			};
			this.cancel_fetch_request = () => finish(null, null);
			const hard_timeout_ms = fetch_hard_timeout_ms();
			hard_timeout = setTimeout(() => {
				warn_compact('[bts] btp_fetch:hard_timeout', {
					tournament_key: this.tkey,
					duration_ms: real_now_ms(this.app) - fetch_start_ms,
					timeout_ms: hard_timeout_ms,
				}, true);
				finish(null, null);
				if (!this.terminated) {
					this.report_status('error', `BTP fetch timed out after ${hard_timeout_ms}ms`);
					this.schedule_reconnect();
				}
			}, hard_timeout_ms);
			Promise.resolve().then(async () => {
				const tournaments = this.app?.db?.tournaments;
				const tournament = tournaments && typeof tournaments.findOne_async === 'function'
					? await tournaments.findOne_async({ key: this.tkey }, { last_reset_ts: 1 })
					: null;
				if (settled) return;
				if (this.terminated) {
					finish(null, null);
					return;
				}
				const fetch_reset_ts = tournament ? tournament.last_reset_ts : undefined;
				cancel_send = this.send(btp_proto.get_info_request(this.password), response => {
					if (settled) return;
					const response_ms = real_now_ms(this.app) - fetch_start_ms;
					// The hard timeout covers only receipt, never waiting for a lock
					// or applying the snapshot after it has already arrived.
					finish(null, response == null ? null : { response, fetch_reset_ts });
					if (require('./server_diagnostics').sync_timing_enabled(this.tkey)) {
						warn_compact('[bts] btp_fetch:response_received', {
							tournament_key: this.tkey, duration_ms: response_ms,
							has_response: response != null,
						});
					}
				});
				// Test transports may complete synchronously before send returns.
				if (settled && typeof cancel_send === 'function') cancel_send();
			}).catch(err => finish(err));
		});
	}

	async _fetch_once() {
		return require('./performance/traces').operation('btp_fetch', { tournament_key: this.tkey, type: 'sync' }, () => this._fetch_once_measured());
	}

	async _fetch_once_measured() {
		if (this.terminated) return { value: null, reschedule: false };
		const connection = this;
		const fetch_start_ms = real_now_ms(this.app);
		const traces = require('./performance/traces');
		const transport = traces.begin('btp_request_response', 'transport');
		let snapshot;
		try { snapshot = await this._fetch_response(fetch_start_ms); traces.end(transport, !snapshot); }
		catch (error) { traces.end(transport, error); throw error; }
		if (!snapshot) return { value: null, reschedule: false };
		const { response, fetch_reset_ts } = snapshot;
		const response_state = await fetch_response_state(this, fetch_reset_ts);
		if (!response_state.ok) {
			log_ignored_fetch_response(this, response_state.reason, real_now_ms(this.app) - fetch_start_ms);
			return { value: null, reschedule: false };
		}
		const hash_start_ms = real_now_ms(this.app);
		const response_hash = require('./btp_decode/response_hashes').get(response)?.sha1 || hash_fetch_response(response);
		const hash_duration_ms = real_now_ms(this.app) - hash_start_ms;
		if (require('./server_diagnostics').sync_timing_enabled(this.tkey)) {
			warn_compact('[bts] btp_fetch:response_hash', {
				tournament_key: this.tkey, duration_ms: hash_duration_ms,
			});
		}
		// Fetching and planning hold no resource lock. The backend validates
		// local changes and reset/enable state under its affected resource locks.
		const value = await queue_fetch_sync_task(this, response, fetch_reset_ts, response_hash, fetch_start_ms);
		if (value?.skipped) traces.annotate({ skipped: true, reason: value.reason });
		if (value === true && !this.terminated) {
			const total_ms = real_now_ms(this.app) - fetch_start_ms;
			if (require('./server_diagnostics').sync_timing_enabled(this.tkey)) {
				warn_compact('[bts] btp_fetch:complete', {
					tournament_key: this.tkey, duration_ms: total_ms,
				});
			}
			const match_utils = require('./match_utils');
			debug_flags.log(connection.app, connection.tkey, '[bts] auto_call_trace:post_sync_reevaluation_start', {
				ts: now_ms(connection.app),
				tournament_key: connection.tkey,
				reschedule_fetch: this.fetch_reschedule_requested === true,
			});
			match_utils.queue_auto_execute_preparation_selections(connection.app, connection.tkey, (selectionErr) => {
				if (selectionErr) {
					console.warn('[bts] failed to auto select preparation matches after fetch', selectionErr && (selectionErr.stack || selectionErr.message || String(selectionErr)));
					return;
				}
				debug_flags.log(connection.app, connection.tkey, '[bts] auto_call_trace:post_sync_preparation_done', {
					ts: now_ms(connection.app),
					tournament_key: connection.tkey,
				});
				match_utils.queue_auto_call_matches_on_free_courts(connection.app, connection.tkey, (callErr) => {
					if (callErr) {
						console.warn('[bts] failed to auto call matches on free courts after fetch', callErr && (callErr.stack || callErr.message || String(callErr)));
						return;
					}
					debug_flags.log(connection.app, connection.tkey, '[bts] auto_call_trace:post_sync_on_court_done', {
						ts: now_ms(connection.app),
						tournament_key: connection.tkey,
					});
				});
			});
		}
		return { value, reschedule: value != null };
	}

	schedule_fetch() {
		if (this.terminated) {
			return;
		}
		if (!this.enabled_autofetch) {
			this.next_fetch_ts = null;
			this.publish_status();
			return;
		}
		this.next_fetch_ts = real_now_ms(this.app) + this.autofetch_timeout_intervall;
		this.publish_status();
		this.autofetch_timeout = setTimeout(() => {
			this.autofetch_timeout = null;
			if (this.terminated) {
				return;
			}
			this.next_fetch_ts = null;
			this.publish_status();
			request_fetch(this, true);
		}, this.autofetch_timeout_intervall);
	}

	terminate(options = {}) {
		this.terminated = true;
		if (this.cancel_fetch_request) this.cancel_fetch_request();
		this.next_fetch_ts = null;
		this.fetch_in_progress = false;
		if (this.autofetch_timeout) {
			clearTimeout(this.autofetch_timeout);
			this.autofetch_timeout = null;
		}
		if (options.silent === true) {
			return;
		}
		this.report_status('deactivated','Terminated.');
	}

	send(xml_req, success_cb) {
		if (this.terminated) return success_cb(null);
		const port = this.is_team ? BLP_PORT : BTP_PORT;
		return send_request(this.ip, port, xml_req, this.timeZone, (err, response) => {
			if (this.terminated) {
				return success_cb(null);
			}
			if (err) {
				this.report_status('error', 'Connection error: ' + err.message);
				this.schedule_reconnect();
				return success_cb(null);
			}
			success_cb(response);
		}, { tournament_key: this.tkey, action: xml_req.Action?.ID });
	}

	// Push the changes from all changed matches
	pushall() {
		this.app.db.matches.find(
			{btp_needsync: true},

			(err, matches) => {
				if (err) {
					serror.silent('Failed to query needsynced: ' + err.message);
					return;
				}

				for (const m of matches) {
					if (typeof m.team1_won !== 'boolean') {
						// serror.silent('match ' + m._id + ' has needsync but is not finished');
						continue;
					}

					this.update_score(m);
				}
			}
		);
	}

	schedule_reconnect() {
		if (this.terminated) {
			return;
		}
		if (this.autofetch_timeout) {
			clearTimeout(this.autofetch_timeout);
			this.autofetch_timeout = null;
		}
		this.next_fetch_ts = null;
		this.fetch_in_progress = false;
		this.publish_status();
		setTimeout(() => this.connect(), 500);
	}

	on_end() {
		this.report_status('error', 'Verbindung verloren, versuche erneut ...');
		this.schedule_reconnect();
	}

	report_status(status, message) {
		this.last_status = {
			status: status,
			message: message
		};
		this.publish_status();
	}

	publish_status() {
		const msg = {
			...this.last_status,
			next_fetch_ts: this.next_fetch_ts,
			fetch_in_progress: this.fetch_in_progress,
		};
		const admin = require('./admin');
		admin.notify_change(this.app, this.tkey, 'btp_status', msg);
	}

	update_score(match) {
		if (this.readonly) {
			return;
		}

		async.waterfall([
			(cb) => {
				if (!match.setup) {
					return cb(null, null, null);
				}

				const packed_umpire = match.setup.umpire;
				const packed_service_judge = match.setup.service_judge;
				const packed_umpire_btp_id = packed_umpire && packed_umpire.btp_id != null ? packed_umpire.btp_id : null;
				const packed_service_judge_btp_id = packed_service_judge && packed_service_judge.btp_id != null ? packed_service_judge.btp_id : null;

				if (packed_umpire_btp_id != null && (packed_service_judge_btp_id != null || !packed_service_judge || !packed_service_judge.name)) {
					return cb(null, packed_umpire_btp_id, packed_service_judge_btp_id);
				}

				if (!packed_umpire || !packed_umpire.name) {
					if (packed_service_judge_btp_id != null) {
						return cb(null, null, packed_service_judge_btp_id);
					}
					if (!packed_service_judge || !packed_service_judge.name) {
						return cb(null, null, null);
					}
				}

				const resolveOfficialBtpId = (packed_official, done) => {
					if (!packed_official) {
						return done(null, null);
					}
					if (packed_official.btp_id != null) {
						return done(null, packed_official.btp_id);
					}
					if (!packed_official.name) {
						return done(null, null);
					}
					this.app.db.umpires.findOne({
						name: packed_official.name,
						tournament_key: this.tkey,
					}, (err, official) => {
						if (err) {
							return done(err);
						}
						return done(null, official ? official.btp_id : null);
					});
				};

				resolveOfficialBtpId(packed_umpire, (err, umpire_btp_id) => {
					if (err) {
						return cb(err);
					}
					resolveOfficialBtpId(packed_service_judge, (err2, service_judge_btp_id) => {
						if (err2) {
							return cb(err2);
						}
						return cb(null, umpire_btp_id, service_judge_btp_id);
					});
				});
			},
			(umpire_btp_id, service_judge_btp_id, cb) => {
				if (!match.setup || !match.setup.court_id) {
					return cb(null, umpire_btp_id, service_judge_btp_id, null);
				}

				this.app.db.courts.findOne({
					tournament_key: this.tkey,
					_id: match.setup.court_id,
				}, (err, court) => {
					if (err) {
						return cb(err);
					}

					return cb(null, umpire_btp_id, service_judge_btp_id, court ? court.btp_id : null);
				});
			},
			(umpire_btp_id, service_judge_btp_id, court_btp_id, cb) => {
				this.app.db.tournaments.findOne({ key: this.tkey }, (err, tournament) => {
					if (err) {
						return cb(err);
					}
					return cb(null, umpire_btp_id, service_judge_btp_id, court_btp_id, tournament);
				});
			},
		], (err, umpire_btp_id, service_judge_btp_id, court_btp_id, tournament) => {
			if (err) {
				serror.silent('Error while fetching court/umpire: ' + err.message + '. Skipping sync of match ' + match._id);
				return;
			}

			if (!match.btp_match_ids) {
				// TODO: assert here?
				return;
			}

			if (! this.key_unicode) {
				//serror.silent('Trying to send match data, but never logged in. Must retry later');
				return;
			}

			const req = btp_proto.update_request(
				match,
				this.key_unicode,
				this.password,
				umpire_btp_id,
				service_judge_btp_id,
				court_btp_id,
				{
					write_match_check_in_status: tournament?.btp_settings?.check_in_per_match === true,
					current_now_ms: now_ms(this.app),
				}
			);
			if (match.btp_winner_only_update === true) {
				warn_compact('[bts] btp_update:winner_only_send', {
					tournament_key: this.tkey,
					match_id: match.btp_match_ids?.[0]?.id,
					match_num: match.btp_match_ids?.[0]?.nr,
					draw: match.btp_match_ids?.[0]?.draw,
					planning: match.btp_match_ids?.[0]?.planning,
				});
			}
			this.send(req, response => {
				const results = response?.Action?.[0]?.Result;
				const rescode = results ? results[0] : 'no-result';
				if (match.btp_winner_only_update === true) {
					warn_compact('[bts] btp_update:winner_only_result', {
						tournament_key: this.tkey,
						match_id: match.btp_match_ids?.[0]?.id,
						match_num: match.btp_match_ids?.[0]?.nr,
						result: rescode,
					});
				}
				if (rescode === 1) {
					if (!match._id) {
						return;
					}
					this.app.db.matches.update({_id: match._id}, {$set: {btp_needsync: false}}, {}, (err) => {
						if (err) {
							serror.silent('Failed to mark match as synced: ' + err.message);
						}
					});
				} else {
					serror.silent('Score update for ' + match.btp_id + ' failed with error code ' + rescode);
				}
			});

		});
	}

	update_highlight(match) {
		this.update_score(match);
	}

	update_players(players) {
		if (this.readonly) {
			return false;
		}

		if (!players || players.length < 1) {
			return false;
		}

		if (! this.key_unicode) {
			//serror.silent('Trying to update player data, but never logged in. Must retry later');
			return false;
		}

		const req = btp_proto.update_players_request(players, this.key_unicode, this.password);
		this.send(req, response => {
			const results = response.Action[0].Result;
			const rescode = (results && results.length > 0) ? results[0] : 'no-result';
			if (rescode === 1) {

			} else {
				serror.silent('Update Player failed with error code ' + rescode);
			}
		});
		return true;
	}

	update_courts(courts) {
		if (this.readonly) {
			return;
		}

		if (!courts || courts.length < 1) {
			return;
		}

		if (! this.key_unicode) {
			//serror.silent('Trying to update court data, but never logged in. Must retry later');
			return;
		}

		const req = btp_proto.update_courts_request(courts, this.key_unicode, this.password);
		this.send(req, response => {
			const results = response.Action[0].Result;
			const rescode = results ? results[0] : 'no-result';
			if (rescode === 1) {

			} else {
				serror.silent('Update Courts failed with error code ' + rescode);
			}
		});
	}
}

module.exports = {
	BTPConn,
	send_raw_request,
	BTP_PORT,
	BLP_PORT,
	_fetch_response_state: fetch_response_state,
	_fetch_hard_timeout_ms: fetch_hard_timeout_ms,
	_normalize_autofetch_timeout_ms: normalize_autofetch_timeout_ms,
	_hash_fetch_response: hash_fetch_response,
	_should_skip_fetch_sync: should_skip_fetch_sync,
};
