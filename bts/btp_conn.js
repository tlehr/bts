'use strict';

const assert = require('assert');
const crypto = require('crypto');
const net = require('net');

const async = require('async');

const btp_proto = require('./btp_proto');
const bulk_decoder = require('./btp_decode');
const btp_parse = require('./btp_parse');
const btp_sync = require('./btp_sync');
const result_sync = require('./btp_result_sync');
const request_log = require('./btp_request_log');
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

async function queue_fetch_sync_task(connection, response, fetch_reset_ts, response_hash, fetch_start_ms, court_assignments_revision) {
	const state = await fetch_response_state(connection, fetch_reset_ts);
	if (!state.ok) {
		log_ignored_fetch_response(connection, state.reason, real_now_ms(connection.app) - fetch_start_ms);
		return null;
	}
	// Planning and comparison take place outside the resource queue. The sync
	// itself queues only the resources its validated writes actually affect.
	const value = await btp_sync.sync_btp_data(connection.app, connection.tkey, response, {
		expected_reset_ts: fetch_reset_ts,
		is_current: () => !connection.terminated && (connection.court_assignments_revision || 0) === court_assignments_revision,
		...(require('./btp_decode/response_hashes').get(response) ? {
			source_hash: require('./btp_decode/response_hashes').get(response).sha256,
			source_json: require('./btp_decode/response_hashes').get(response).json,
		} : {}),
	});
	if ((connection.court_assignments_revision || 0) !== court_assignments_revision) return null;
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
	if (!ip) return callback(Object.assign(new Error('No IP address specified'), { code: 'BTP_NO_ADDRESS', btp_phase: 'connect' }));
	let called = false, connected = false, client;
	const finish = (error, value) => {
		if (called) return;
		called = true;
		if (error) error.btp_phase = connected ? 'response' : 'connect';
		callback(error, value);
	};
	try {
		client = net.connect({ host: ip, port, timeout: CONNECT_TIMEOUT }, () => {
			if (called) return;
			connected = true;
			client.setTimeout(WAIT_TIMEOUT);
			client.write(raw_req);
		});
	} catch (error) { finish(error); return; }
	const got = [];
	client.on('error', error => finish(error));
	client.on('timeout', () => {
		if (called) return;
		const timeout_ms = connected ? WAIT_TIMEOUT : CONNECT_TIMEOUT;
		// Mark settled before destroy, which can synchronously emit close.
		finish(Object.assign(new Error(`Connection to ${ip}:${port} timed out after ${timeout_ms}ms`), { code: 'ETIMEDOUT', timeout_ms }));
		client.destroy();
	});
	client.on('data', data => { if (!called) got.push(data); });
	client.on('end', () => finish(null, Buffer.concat(got)));
	client.on('close', () => {
		if (!called) finish(Object.assign(new Error('BTP closed the connection before the complete reply arrived'), { code: 'ECONNRESET' }));
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
	try { encoded_req = btp_proto.encode(xml_req, timeZone); }
	catch (error) { error.btp_phase = 'encode'; return callback(error); }
	let cancelled = false, delivered = false, cancel_decode;
	const decoded = (error, response) => {
		if (cancelled || delivered) return;
		delivered = true;
		if (error) error.btp_phase = 'decode';
		callback(error, response);
	};
	const cancel_raw = send_raw_request(ip, port, encoded_req, (err, raw_response) => {
		if (cancelled) return;
		if (err) return callback(err);
		try {
			if (context?.action === 'SENDTOURNAMENTINFO' && require('./offload/profile').enabled('btp_decode')) {
				cancel_decode = bulk_decoder.decode(raw_response, context, decoded);
			} else btp_proto.decode(raw_response, decoded, context);
		} catch (error) {
			if (delivered) throw error; // Preserve exceptions in a caller's callback.
			decoded(error);
		}
	});
	return () => {
		cancelled = true;
		if (typeof cancel_raw === 'function') cancel_raw();
		if (cancel_decode) cancel_decode();
	};
}


class BTPConn {
	constructor(app, ip, password, tkey, enabled_autofetch, readonly, is_team, timeZone, autofetch_timeout_intervall, last_successful_fetch_ts = null) {
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
		this.last_successful_fetch_ts = last_successful_fetch_ts;
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

		clearTimeout(this.reconnect_timeout);
		this.reconnect_timeout = null;
		this.report_status('connecting','Try to establish connection to BTP.');
		this.send(btp_proto.login_request(this.password), (response, error) => {
			if (this.terminated) return;
			if (error) { this.report_status('error', request_log.safe_message(this, error)); return; }
			if (!response || response == null || !response.Action || !response.Action[0] || !response.Action[0].ID?.[0] || (response.Action[0].ID[0] !== 'REPLY')) {
				this.report_status('error','Invalid reply to login request');
				return;
			}

			if (response.Action[0].Result?.[0] !== 1) {
				this.report_status('error', 'Invalid password');
				return;
			}

			this.report_status('connected','Logged in.');
			this.key_unicode = response.Action[0].Unicode[0];

			// Read back accepted results before retrying the durable outbox.
			request_fetch(this, this.enabled_autofetch).then(() => this.pushall());
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
		connection.fetch_reschedule_requested = connection.fetch_reschedule_requested || reschedule_fetch === true ||
			(connection.enabled_autofetch && connection.autofetch_timeout != null);
		if (connection.fetch_promise) {
			return connection.fetch_promise;
		}
		// A readback can run before the automatic deadline. It replaces that
		// deadline rather than starting another recurring timer chain.
		clearTimeout(connection.autofetch_timeout);
		connection.autofetch_timeout = null;
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
		return require('./performance/traces').operation('btp_fetch', { tournament_key: this.tkey, type: 'sync' }, () => this._fetch_once_measured(), true);
	}

	async _fetch_once_measured() {
		if (this.terminated) return { value: null, reschedule: false };
		const connection = this;
		const court_assignments_revision = this.court_assignments_revision || 0;
		const fetch_start_ms = real_now_ms(this.app);
		const traces = require('./performance/traces');
		const transport = traces.begin('btp_request_response', 'transport');
		let snapshot;
		try { snapshot = await this._fetch_response(fetch_start_ms); traces.end(transport, !snapshot); }
		catch (error) { traces.end(transport, error); throw error; }
		if (!snapshot) return { value: null, reschedule: false };
		if ((this.court_assignments_revision || 0) !== court_assignments_revision) return { value: null, reschedule: true };
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
		const value = await queue_fetch_sync_task(this, response, fetch_reset_ts, response_hash, fetch_start_ms, court_assignments_revision);
		if ((this.court_assignments_revision || 0) !== court_assignments_revision) return { value: null, reschedule: true };
		if (value?.skipped) traces.annotate({ skipped: true, reason: value.reason });
		if (!this.terminated && (value === true || value?.reason === 'no_sync_changes')) {
			this.last_successful_fetch_ts = real_now_ms(this.app);
			this.pushall();
		}
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
		clearTimeout(this.autofetch_timeout);
		this.autofetch_timeout = null;
		if (this.terminated) {
			return;
		}
		if (!this.enabled_autofetch) {
			this.next_fetch_ts = null;
			this.publish_status();
			return;
		}
		this.next_fetch_ts = real_now_ms(this.app) + this.autofetch_timeout_intervall;
		const timeout = setTimeout(() => {
			if (this.autofetch_timeout !== timeout) return;
			this.autofetch_timeout = null;
			if (this.terminated) {
				return;
			}
			request_fetch(this, true);
		}, this.autofetch_timeout_intervall);
		this.autofetch_timeout = timeout;
		this.publish_status();
	}

	terminate(options = {}) {
		this.terminated = true;
		clearTimeout(this.result_retry_timeout);
		this.result_retry_timeout = null;
		clearTimeout(this.reconnect_timeout);
		this.reconnect_timeout = null;
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

	send(xml_req, success_cb, details = {}) {
		if (this.terminated) return success_cb(null);
		const port = this.is_team ? BLP_PORT : BTP_PORT;
		const context = request_log.context(this, xml_req, details);
		return send_request(this.ip, port, xml_req, this.timeZone, (err, response) => {
			if (this.terminated) {
				return success_cb(null);
			}
			if (err) {
				request_log.failure(this, context, err);
				this.report_status('error', 'Connection error: ' + request_log.safe_message(this, err));
				this.schedule_reconnect();
				return success_cb(null, err);
			}
			const error = request_log.response_error(xml_req, response);
			if (error) request_log.failure(this, context, error);
			success_cb(response, error);
		}, { tournament_key: this.tkey, action: xml_req.Action?.ID });
	}

	// Retry only this tournament, with bounded network concurrency. Results stay
	// durable until a later tournament read confirms both winner and sets.
	pushall() {
		if (this.readonly || this.terminated || typeof this.app?.db?.matches?.find !== 'function') return Promise.resolve();
		if (this.pushall_promise) return this.pushall_promise;
		this.pushall_promise = new Promise(resolve => {
			this.app.db.matches.find({ tournament_key: this.tkey, btp_needsync: true }, async (err, matches) => {
				if (err) {
					serror.silent('Failed to query needsynced: ' + err.message);
					this.schedule_result_retry();
					resolve();
					return;
				}
				const pending = matches.filter(result_sync.is_result).sort((a, b) => String(a._id).localeCompare(String(b._id)));
				if (!pending.length) {
					this.result_retry_delay = 1000;
					clearTimeout(this.result_retry_timeout);
					this.result_retry_timeout = null;
					if (this.result_write_error) {
						const previous = this.result_write_error;
						this.result_write_error = null;
						if (this.last_status?.message === previous) this.report_status('connected', 'Ergebnisse mit BTP abgeglichen.');
						else this.publish_status();
					}
					resolve();
					return;
				}
				// Rotate batches so an unconfirmed result cannot starve later ones.
				const offset = (this.result_retry_offset || 0) % pending.length;
				const batch = pending.slice(offset).concat(pending.slice(0, offset)).slice(0, 8);
				this.result_retry_offset = offset + batch.length;
				for (let i = 0; i < batch.length && !this.terminated; i += 2) {
					await Promise.all(batch.slice(i, i + 2).map(match => this.update_score(match)));
				}
				this.schedule_result_retry();
				resolve();
			});
		}).finally(() => { this.pushall_promise = null; });
		return this.pushall_promise;
	}

	schedule_result_retry() {
		if (this.terminated || this.readonly || this.result_retry_timeout) return;
		const delay = this.result_retry_delay || 1000;
		this.result_retry_timeout = setTimeout(() => {
			this.result_retry_timeout = null;
			this.result_retry_delay = Math.min(delay * 2, 30000);
			request_fetch(this, this.enabled_autofetch).then(() => this.pushall());
		}, delay);
		this.result_retry_timeout.unref?.();
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
		if (!this.reconnect_timeout) {
			this.reconnect_timeout = setTimeout(() => this.connect(), 500);
			this.reconnect_timeout.unref?.();
		}
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
			...(this.result_write_error ? { status: 'error', message: this.result_write_error } : {}),
			next_fetch_ts: this.next_fetch_ts,
			fetch_in_progress: this.fetch_in_progress,
			last_successful_fetch_ts: this.last_successful_fetch_ts ?? null,
		};
		const admin = require('./admin');
		admin.notify_change(this.app, this.tkey, 'btp_status', msg);
	}

	async clear_court_assignments(matches) {
		try {
			return await require('./btp_court_assignments_reset').reset(this, matches);
		} finally {
			// A fetch received before/during this action must never restore its
			// old planned courts after waiting behind the maintenance lock.
			this.court_assignments_revision = (this.court_assignments_revision || 0) + 1;
			this.last_applied_fetch_response_hash = null;
		}
	}

	async reset_match_results(matches) {
		try {return await require('./btp_match_results_reset').reset(this,matches);}
		finally {
			this.court_assignments_revision = (this.court_assignments_revision || 0) + 1;
			this.last_applied_fetch_response_hash = null;
		}
	}

	update_score(match) {
		return result_sync.enqueue(this, match, latest => this._send_score(latest));
	}

	_send_score(match) {
		return new Promise(resolve => {
			if (this.readonly || this.terminated) {
				return resolve(false);
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
						return cb(null, umpire_btp_id, service_judge_btp_id, match.btp_clear_court === true ? 0 : null);
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
					request_log.local_failure(this, match, Object.assign(err, { btp_phase: 'prepare' }));
					serror.silent('Error while fetching court/umpire: ' + err.message + '. Skipping sync of match ' + match._id);
					return resolve(false);
				}

				if (!match.btp_match_ids) {
					return resolve(false);
				}

				if (! this.key_unicode) {
					this.schedule_reconnect();
					return resolve(false);
				}

				let req;
				try {
					req = btp_proto.update_request(
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
				} catch (error) {
					request_log.local_failure(this, match, Object.assign(error, { btp_phase: 'prepare' }));
					return resolve(false);
				}
				if (match.btp_winner_only_update === true) {
					warn_compact('[bts] btp_update:winner_only_send', {
						tournament_key: this.tkey,
						match_id: match.btp_match_ids?.[0]?.id,
						match_num: match.btp_match_ids?.[0]?.nr,
						draw: match.btp_match_ids?.[0]?.draw,
						planning: match.btp_match_ids?.[0]?.planning,
					});
				}
				if (this.terminated) return resolve(false);
				this.send(req, (response, transport_error) => {
					if (this.terminated) return resolve(false);
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
						if (!match._id || result_sync.is_result(match)) {
							// A transport ACK does not prove BTP stored the result.
							return resolve(true);
						}
						this.app.db.matches.update(result_sync.version_query(match, this.tkey),
							{ $set: { btp_needsync: false } }, {}, err => {
								if (err) serror.silent('Failed to mark match as synced: ' + err.message);
								resolve(!err);
							});
					} else {
						const detail = transport_error ? ': ' + request_log.safe_message(this, transport_error) : '';
						serror.silent('Score update for ' + (match._id || match.btp_id) + ' failed with error code ' + rescode + detail);
						const message = 'Ergebnisübertragung ausstehend; erneuter Versuch folgt.' + detail;
						if (result_sync.is_result(match)) this.result_write_error = message;
						this.report_status('error', message);
						if (response) this.schedule_reconnect();
						resolve(false);
					}
				}, { match_id: match._id, match_number: match.setup?.match_num });

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
		this.send(req, (response, error) => {
			const results = response?.Action?.[0]?.Result;
			const rescode = (results && results.length > 0) ? results[0] : 'no-result';
			if (rescode === 1) {

			} else {
				serror.silent('Update Player failed with error code ' + rescode + (error ? ': ' + request_log.safe_message(this, error) : ''));
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
		this.send(req, (response, error) => {
			const results = response?.Action?.[0]?.Result;
			const rescode = (results && results.length > 0) ? results[0] : 'no-result';
			if (rescode === 1) {

			} else {
				serror.silent('Update Courts failed with error code ' + rescode + (error ? ': ' + request_log.safe_message(this, error) : ''));
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
