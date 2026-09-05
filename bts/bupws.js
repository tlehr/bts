'use strict';
const async = require('async');
const serror = require('./serror');
const utils = require('./utils');
const admin = require('./admin');
const bupws_v2 = require('./bupws_v2');
const debug_flags = require('./debug_flags');
const cp = require("child_process");
const os = require("os");
const dns = require("dns");
const net = require("net");

const btp_manager = require('./btp_manager');
const btp_conn = require('./btp_conn');
const calc = require('../static/bup/dev/js/calc');
const ticker_manager = require('./ticker_manager');
const update_queue = require('./update_queue');
const match_automation = require('./match_automation');
const stournament = require('./stournament');
const displaysettings_defaults = require('./displaysettings_defaults');
const all_panels = [];

const default_tournament_key = 'default';
const default_displaysettings_key = default_tournament_key;

function now_ms(app) {
	return app?.clock ? app.clock.now_ms() : Date.now();
}

function real_now_ms(app) {
	return app?.clock?.real_now_ms ? app.clock.real_now_ms() : Date.now();
}

function bup_outgoing_ts(app, ts) {
	if (ts == null) {
		return ts;
	}
	return app?.clock?.to_real_ts ? app.clock.to_real_ts(ts) : ts;
}

function bup_incoming_ts(app, ts) {
	if (ts == null) {
		return ts;
	}
	return app?.clock?.to_effective_ts ? app.clock.to_effective_ts(ts) : ts;
}

function score_status_from_score_update(score_data) {
	const explicit_status = score_data?.score_status;
	if (explicit_status === 'retired' || explicit_status === 'disqualified') {
		return explicit_status;
	}
	if (Number(explicit_status) === 2) {
		return 'retired';
	}
	if (Number(explicit_status) === 3) {
		return 'disqualified';
	}
	const presses = Array.isArray(score_data?.presses) ? score_data.presses : [];
	for (let i = presses.length - 1; i >= 0 && i >= presses.length - 4; i--) {
		const press_type = presses[i]?.type;
		if (press_type === 'retired' || press_type === 'disqualified') {
			return press_type;
		}
	}
	return 'normal';
}

function reached_score_from_score_update(match, score_data) {
	const presses = Array.isArray(score_data?.presses) ? score_data.presses : [];
	if (!match?.setup || presses.length < 1) {
		return null;
	}
	try {
		const state = calc.remote_state({}, match.setup, presses);
		const scores = [];
		if (Array.isArray(state?.match?.finished_games)) {
			state.match.finished_games.forEach((finished_game) => {
				if (Array.isArray(finished_game?.score) && finished_game.score.length >= 2) {
					scores.push([
						Number(finished_game.score[0]) || 0,
						Number(finished_game.score[1]) || 0,
					]);
				}
			});
		}
		if (Array.isArray(state?.game?.score) && state.game.score.length >= 2) {
			const current_score = [
				Number(state.game.score[0]) || 0,
				Number(state.game.score[1]) || 0,
			];
			const last_score = scores[scores.length - 1];
			if (!last_score || last_score[0] !== current_score[0] || last_score[1] !== current_score[1]) {
				scores.push(current_score);
			}
		}
		return scores.length > 0 ? scores : null;
	} catch (err) {
		console.error('[bts] failed to derive reached score for special score status', err);
		return null;
	}
}

function normalize_panel_devicemode(devicemode) {
	return devicemode === 'umpire' ? 'umpire' : 'display';
}

function get_default_displaysettings_id(tournament, devicemode = 'display') {
	const normalized_devicemode = normalize_panel_devicemode(devicemode);
	if (normalized_devicemode === 'umpire') {
		return (tournament && tournament.displaysettings_general_tablet)
			|| (tournament && tournament.displaysettings_general)
			|| default_displaysettings_key;
	}
	return (tournament && tournament.displaysettings_general)
		|| (tournament && tournament.displaysettings_general_tablet)
		|| default_displaysettings_key;
}

async function is_bupws_v2_enabled(app, tournament_key) {
	const tournament = await app.db.tournaments.findOne_async({ key: tournament_key || default_tournament_key });
	debug_flags.set_from_tournament(tournament);
	return !!(tournament && tournament.bupws_v2_enabled);
}

function send_use_bup_v2(ws, tournament_key) {
	if (!ws || ws.readyState !== 1) {
		return false;
	}
	ws.sendmsg({
		type: 'use-bup-v2',
		tournament_key,
	});
	return true;
}

function is_default_displaysetting_id(tournament, displaysetting_id) {
	return !!displaysetting_id && !!tournament
		&& (displaysetting_id === tournament.displaysettings_general
			|| displaysetting_id === tournament.displaysettings_general_tablet);
}

function on_close(app, ws) {
	if (!utils.remove(all_panels, ws)) {
		serror.silent('Removing Scoreboard ws, but it was not connected!?');
	}
	notify_admin_display_status_changed(app, ws, false);
}

async function on_connect(app, ws) {
	all_panels.push(ws);
	notify_admin_display_status_changed(app, ws, true);
}

async function notify_admin_display_status_changed(app, ws, ws_online) {
	app.db.tournaments.findOne({ key: default_tournament_key }, async (err, tournament) => {
		if (!err || !tournament) {
			err = { message: 'No tournament ' + default_tournament_key };
		}
		const client_id = determine_client_id(ws);
		const hostname = await determine_client_hostname(ws);
		var display_court_displaysetting = await get_display_court_displaysettings(app, client_id);
		if (display_court_displaysetting == null) {
			display_court_displaysetting = create_display_court_displaysettings(
				client_id,
				hostname,
				null,
				get_default_displaysettings_id(tournament, ws.panel_devicemode),
				ws.panel_devicemode,
			);
			display_court_displaysetting = await persist_client_court_displaysetting(app, display_court_displaysetting);
		}
		display_court_displaysetting.online = ws_online;
		admin.notify_change(app, default_tournament_key, 'display_status_changed', {'display_court_displaysetting': display_court_displaysetting });	
	});
}

function notify_change(app, tournament_key, court_id, ctype, val) {
	for (const panel_ws of all_panels) {
		notify_change_ws(app, panel_ws, tournament_key, court_id, ctype, val);
	}
}

function notify_change_broadcast(app, tournament_key, ctype, val) {
	for (const panel_ws of all_panels) {
		notify_change_send(app, panel_ws, tournament_key, ctype, val);
	}
}

function _clear_court_match_reference_after_finish(app, tournament_key, court_q, court, match_id, finish_confirmed, callback) {
	if (!finish_confirmed || !court || court.match_id !== match_id) {
		return callback(null, false);
	}
	app.db.courts.update(
		court_q,
		{ $set: { match_id: null } },
		{ returnUpdatedDocs: true },
		(err, _numAffected, updated_court) => {
			if (err) {
				return callback(err);
			}
			if (updated_court) {
				admin.notify_change(app, tournament_key, 'court_changed', {
					court_id: updated_court._id,
					is_active: updated_court.is_active,
					has_umpire: updated_court.has_umpire,
					has_service_judge: updated_court.has_service_judge,
					match_id: null,
				});
			}
			callback(null, !!updated_court);
		}
	);
}

function notify_change_ws(app, ws, tournament_key, court_id, ctype, val) {
	if (ws == null) {
		notify_change(app, tournament_key, court_id, ctype, val);
	} else { 
		if (ws.court_id === court_id) { 
			notify_change_send(app, ws, tournament_key, ctype, val);
		}
	}
}

function notify_change_send(app, ws, tournament_key, ctype, val) {
	admin.notify_change(app, tournament_key, 'display_wait_for_done', {'ctype': ctype, 'val' : val, 'client_id': ws.client_id});
	ws.sendmsg({
		type: 'change',
		tournament_key,
		ctype,
		val,
	});
}

function send_courts(app, ws, tournament_key) {
	stournament.get_courts(app.db, tournament_key, function (err, courts) {
		notify_change_ws(app, ws,tournament_key, ws.court_id, "courts-update", courts);
	});
}
function send_error(ws, tournament_key, msg) {
	ws.sendmsg({
		type: 'error',
		tournament_key,
		msg
	});
}

function all_matches_delivery() {
	for (const panel_ws of all_panels) {
		if (panel_ws.court_id === undefined) {
			return true;
		}
	}
}

async function handle_reset_display_settings(app, ws, msg) {
	const client_id = determine_client_id(ws);
	var client_court_displaysetting = await get_display_court_displaysettings(app, client_id);
	if (client_court_displaysetting != null) {
		const updatevalues = {
			client_id: 'deleted'
		}
		client_court_displaysetting = await update_client_court_displaysetting(app, client_court_displaysetting.client_id, updatevalues);
	}
}

async function handle_persist_display_settings(app, ws, msg) {
	const tournament_key = msg.tournament_key;
	const court_id = msg.panel_settings.court_id;
	var setting = msg.panel_settings;

	const client_id = determine_client_id(ws);
	const hostname = await determine_client_hostname(ws);
	var client_court_displaysetting = await get_display_court_displaysettings(app, client_id);
	if (client_court_displaysetting == null) {
		setting.id = tournament_key + "_" + court_id + " _" + real_now_ms(app);
		setting = await persist_displaysetting(app, tournament_key, setting);
		client_court_displaysetting = create_display_court_displaysettings(client_id, hostname, court_id, setting.id);
		client_court_displaysetting = await persist_client_court_displaysetting(app, client_court_displaysetting);
	} else {
		setting.id = tournament_key + "_" + court_id + " _" + real_now_ms(app);
		setting = await persist_displaysetting(app, tournament_key, setting);
		const updatevalues = {
			court_id: court_id,
			displaysetting_id: setting.id,
		}
		client_court_displaysetting = await update_client_court_displaysetting(app, client_court_displaysetting.client_id, updatevalues);
	}
	await bupws_v2.reinitialize_client(app, tournament_key, client_id);
}
async function handle_score_update(app, ws, msg) {
	return update_queue.instance().execute(update_queue.named('handle_score_update', () => new Promise((resolve) => {
		const match_utils = require('./match_utils');
		const tournament_key = msg.tournament_key;
		const score_data = msg.score;
		const match_id = score_data.match_id;
		let finished = false;
		const finish = (err) => {
			if (finished) {
				return;
			}
			finished = true;
			clearTimeout(timeout);
			if (err) {
				send_error(ws, tournament_key, err.message || String(err));
			}
			resolve();
		};
		const timeout = setTimeout(() => {
			finish(new Error('handle_score_update timeout'));
		}, 5000);

		(async () => {
			let match = null;
			let tournament = null;
			let court = null;
			try {
				const fetch_tournament = new Promise((resolve, reject) => {
					app.db.tournaments.findOne({ key: tournament_key }, (err, found_tournament) => {
						if (err) {
							return reject(err);
						}
						resolve(found_tournament);
					});
				});
				const fetch_court = new Promise((resolve, reject) => {
					app.db.courts.findOne({ tournament_key, _id: score_data.court_id }, (err, found_court) => {
						if (err) {
							return reject(err);
						}
						resolve(found_court);
					});
				});
				[match, tournament, court] = await Promise.all([
					match_utils.fetch_match(app, tournament_key, match_id),
					fetch_tournament,
					fetch_court,
				]);
			} catch {
				match = null;
				tournament = null;
				court = null;
			}
			const finish_confirmed = score_data.finish_confirmed ? score_data.finish_confirmed : false;
			const allow_finished_confirmation = finish_confirmed && (score_data.team1_won !== undefined && score_data.team1_won !== null);
			if (match == null || (match.setup.now_on_court == false && !allow_finished_confirmation)) {
				send_error(ws, tournament_key, "Match not found or not on court actualy.");
				return finish();
			}
			if (!court) {
				send_error(ws, tournament_key, "Court for score update not found.");
				return finish();
			}
			if (ws.court_id && score_data.court_id && ws.court_id !== score_data.court_id) {
				send_error(ws, tournament_key, "Score update rejected: panel is assigned to a different court.");
				return finish();
			}
			if (match.setup && match.setup.court_id && score_data.court_id && match.setup.court_id !== score_data.court_id) {
				send_error(ws, tournament_key, "Score update rejected: match is assigned to a different court.");
				return finish();
			}
			const expected_match_for_court =
				court.match_id === match_id ||
				(!court.match_id && match.setup && match.setup.court_id === score_data.court_id && match.setup.now_on_court === true);
			if (!expected_match_for_court) {
				send_error(ws, tournament_key, "Score update rejected: stale panel state for this court.");
				return finish();
			}

			const update = {
				network_score: score_data.network_score,
				network_team1_left:score_data.network_team1_left,
				network_team1_serving:score_data.network_team1_serving,
				network_teams_player1_even:score_data.network_teams_player1_even,
				presses:score_data.presses,
				duration_ms:score_data.duration_ms,
				end_ts:bup_incoming_ts(app, score_data.end_ts),
				'setup.now_on_court': true,
				'setup.state': 'oncourt',
			};

			const device_info = score_data.device;
			if (device_info) {
				const client_ip = ws._socket.remoteAddress;
				device_info.client_ip = client_ip;
			}

			if (finish_confirmed) {
				const score_status = score_status_from_score_update(score_data);
				update["setup.now_on_court"] = false;
				update["setup.state"] = 'finished';
				update.team1_won = score_data.team1_won;
				update.btp_winner = (update.team1_won === true) ? 1 : 2;
				update.btp_needsync = true;
				update.score_status = score_status;
				update.forward_loser = score_status === 'retired' || score_status === 'disqualified';
				if (update.forward_loser) {
					update.score_status_network_score = reached_score_from_score_update(match, score_data) || score_data.score_status_network_score || score_data.network_score;
				}
			}

			if (score_data.shuttle_count) {
				update.shuttle_count = score_data.shuttle_count;
			}

			const simulated_match = {
				...match,
				network_score: update.network_score,
				team1_won: update.team1_won,
				setup: {
					...match.setup,
					now_on_court: update['setup.now_on_court'],
					state: update['setup.state'],
				},
			};
			const preparation_successor_state = match_automation.calculate_preparation_successor_state(simulated_match, tournament, {
				now_ts: now_ms(app),
			});
			update['setup.needs_preparation_successor'] = preparation_successor_state.needs_preparation_successor;
			update['setup.needs_preparation_successor_ts'] = preparation_successor_state.needs_preparation_successor_ts;

			const match_query = {
				_id: match_id,
				tournament_key,
			};

			const court_q = {
				tournament_key,
				_id: score_data.court_id,
			};
			const db = app.db;
			async.waterfall([
				cb => {
					db.matches.update(match_query, { $set: update }, { returnUpdatedDocs: true }, (err, _, updated_match) => cb(err, updated_match));
				},
				(updated_match, cb) => {
					if (updated_match) {
						handle_score_change(app, tournament_key, updated_match.setup.court_id);
						admin.notify_change(app, tournament_key, 'score', {
							match_id,
							network_score: update.network_score,
							team1_won: update.team1_won,
							shuttle_count: update.shuttle_count,
							score_status: update.score_status,
							forward_loser: update.forward_loser,
							score_status_network_score: update.score_status_network_score,
							presses: updated_match.presses,
							end_ts: updated_match.end_ts,
							court_id: updated_match.setup && updated_match.setup.court_id,
							now_on_court: updated_match.setup && updated_match.setup.now_on_court,
						});
					}
					cb(null, updated_match);
				},
				(updated_match, cb) => {
					if (updated_match && finish_confirmed) {
						btp_manager.update_score(app, updated_match);
						match_utils.reset_player_tabletoperator(app, tournament_key, match_id, update.end_ts)
							.then(() => cb(null, updated_match))
							.catch((err) => {
								console.error("Error in reset_player_tabletoperator:", err);
								cb(err);
							});
						return;
					}
					cb(null, updated_match);
				},
				(updated_match, cb) => {
					cb(null, updated_match, court);
				},
				(updated_match, court, cb) => {
					if (!court) {
						return cb(new Error('Cannot find court ' + JSON.stringify(score_data.court_id)));
					}
					if (!updated_match) {
						if (court.match_id === match_id) {
							cb(null, updated_match, court, false);
							return;
						}

						db.courts.update(court_q, { $set: { match_id: match_id } }, {}, (err) => {
							cb(err, updated_match, court, true);
						});
						return;
					}
					cb(null, updated_match, court, true);
				},
				(updated_match, court, changed_court, cb) => {
					if (updated_match && changed_court) {
						admin.notify_change(app, tournament_key, 'court_current_match', {
							match__id: match_id,
							match: updated_match,
						});
					}
					cb(null, updated_match, changed_court);
				},
				(updated_match, changed_court, cb) => {
					if (updated_match && updated_match.setup.highlight &&
						updated_match.setup.highlight == 6 &&
						updated_match.network_score &&
						updated_match.network_score.length > 0 &&
						updated_match.network_score[0].length > 1 &&
						(updated_match.network_score[0][0] > 0 || updated_match.network_score[0][1] > 0)) {
						updated_match.setup.highlight = 0;
						match_utils.normalize_preparation_state(updated_match.setup);
						btp_manager.update_highlight(app, updated_match);
					}
					cb(null, updated_match, changed_court);
				},
				(updated_match, changed_court, cb) => {
					if (changed_court) {
						ticker_manager.pushall(app, tournament_key);
					} else if (updated_match) {
						ticker_manager.update_score(app, updated_match);
					}
					cb(null, updated_match, changed_court);
				},
				(updated_match, changed_court, cb) => {
					_clear_court_match_reference_after_finish(app, tournament_key, court_q, court, match_id, finish_confirmed, (err) => {
						if (err) {
							return cb(err);
						}
						cb(null, updated_match, changed_court);
					});
				},
				(updated_match, changed_court, cb) => {
					if (!updated_match) {
						return cb(new Error('Cannot find match ' + JSON.stringify(updated_match)));
					}
					match_utils.auto_execute_preparation_selection_for_setup(app, tournament, updated_match.setup, (err) => {
						if (err) {
							return cb(err);
						}
						return cb(null, updated_match, changed_court);
					});
				},
				(updated_match, changed_court, cb) => {
					if (!finish_confirmed || !score_data.court_id) {
						return cb(null, updated_match, changed_court);
					}
					match_utils.call_preparation_match_on_court(app, tournament_key, score_data.court_id)
						.then(() => cb(null, updated_match, changed_court))
						.catch((err) => {
							const message = err && (err.message || String(err));
							if (/No match found to call on court/.test(message)) {
								return cb(null, updated_match, changed_court);
							}
							return cb(err);
						});
				},
				(updated_match, changed_court, cb) => {
					if (!device_info) {
						return cb(null, updated_match, changed_court);
					}
					update_device_info(app, tournament_key, device_info);
					return cb(null, updated_match, changed_court);
				},
			], finish);
		})().catch(finish);
	})));
}
async function handle_device_info(app, ws, msg) {
	const tournament_key = msg.tournament_key;
	const device_info = msg.device;
	if (device_info) {
		device_info.client_ip = ws._socket.remoteAddress;
		update_device_info(app, tournament_key, device_info);
	}
}
async function update_device_info(app, tournament_key, device_info) {
	app.db.tournaments.findOne({ key: tournament_key }, async (err, tournament) => {
		if (!err || !tournament) {
			err = { message: 'No tournament ' + default_tournament_key };
		}
		const client_id = determine_client_id_from_ip(device_info.client_ip);
		const panel = fetch_panel(client_id);
		if (panel != null) {
			const hostname = await determine_client_hostname(panel);
			var display_court_displaysetting = await get_display_court_displaysettings(app, client_id);
			if (display_court_displaysetting == null) {
				display_court_displaysetting = create_display_court_displaysettings(
					client_id,
					hostname,
					panel.court_id,
					get_default_displaysettings_id(tournament, panel.panel_devicemode),
					panel.panel_devicemode,
				);
			} else {
				display_court_displaysetting.hostname = hostname;
			}
			panel.battery = device_info.battery
			display_court_displaysetting.battery = device_info.battery
			display_court_displaysetting.online = true;
			admin.notify_change(app, default_tournament_key, 'display_status_changed', { 'display_court_displaysetting': display_court_displaysetting });
		}
	});
}

function fetch_panel(client_id) {
	for (const panel_ws of all_panels) {
		if (client_id == panel_ws.client_id) {
			return panel_ws;
		}
	}
	return null;
}


function create_display_court_displaysettings(client_id, hostname, court_id, displaysetting_id, panel_devicemode = 'display') {
	return  {
		client_id: client_id,
		hostname: hostname,
		court_id: court_id,
		displaysetting_id: displaysetting_id,
		panel_devicemode: normalize_panel_devicemode(panel_devicemode),
	}
}

async function handle_init(app, ws, msg) {
	const tournament_key = msg.tournament_key || default_tournament_key;
	ws.last_tournament_key = tournament_key;
	if (await is_bupws_v2_enabled(app, tournament_key)) {
		send_use_bup_v2(ws, tournament_key);
		return;
	}
	var court_id = undefined;
	ws.panel_devicemode = normalize_panel_devicemode(msg.panel_settings && msg.panel_settings.devicemode);
	ws.court_id = undefined;
	if (msg.initialize_display) {
		await initialize_client(ws, app, tournament_key, court_id, undefined, ws.panel_devicemode);
	} else { 
		matches_handler(app, ws, tournament_key, ws.court_id);
	}
	await notify_admin_display_status_changed(app, ws, true);
	send_courts(app, ws, tournament_key);
}

async function async_handle_select_court_assignment(app, ws, msg) {
	const tournament_key = msg.tournament_key || ws.last_tournament_key || default_tournament_key;
	const court_id = msg.court_id;
	if (!court_id || court_id === 'referee') {
		return;
	}

	const court = await app.db.courts.findOne_async({ tournament_key, _id: court_id });
	if (!court) {
		send_error(ws, tournament_key, 'Unknown court ' + court_id);
		return;
	}

	const client_id = determine_client_id(ws);
	await restart_panel(app, tournament_key, client_id, court_id);
	send_courts(app, ws, tournament_key);
}

async function send_finshed_confirmed(app, tournament_key, court_id, match_id) {
	const val = {
		court_id,
		match_id: match_id ? 'bts_' + match_id : null,
		raw_match_id: match_id || null,
	};
	for (const panel_ws of all_panels) {
		if (!panel_ws) {
			continue;
		}
		if (panel_ws.court_id !== court_id && panel_ws.court_id !== undefined) {
			continue;
		}
		notify_change_send(app, panel_ws, tournament_key, 'confirm-match-finished', val);
	}
}

async function confirm_match_finished_from_admin(app, tournament_key, match_id, court_id) {
	return update_queue.instance().execute(update_queue.named('confirm_match_finished_from_admin', async () => {
		const match_utils = require('./match_utils');
		const [match, tournament, court] = await Promise.all([
			match_utils.fetch_match(app, tournament_key, match_id),
			app.db.tournaments.findOne_async({ key: tournament_key }),
			app.db.courts.findOne_async({ tournament_key, _id: court_id }),
		]);
		if (!match) {
			throw new Error('Match not found ' + JSON.stringify(match_id));
		}
		if (!tournament) {
			throw new Error('Tournament not found ' + JSON.stringify(tournament_key));
		}
		if (!court) {
			throw new Error('Court not found ' + JSON.stringify(court_id));
		}
		const network_score = Array.isArray(match.network_score) ? match.network_score : [];
		let team1_won = typeof match.team1_won === 'boolean' ? match.team1_won : null;
		if (team1_won == null) {
			const winner = calc.match_winner(match.setup, network_score);
			if (winner === 'left') {
				team1_won = true;
			} else if (winner === 'right') {
				team1_won = false;
			}
		}
		if (team1_won == null) {
			throw new Error('Match has no finished result to confirm');
		}
		const presses = Array.isArray(match.presses) ? match.presses.slice() : [];
		if (!presses.length || presses[presses.length - 1].type !== 'postmatch-confirm') {
			presses.push({
				type: 'postmatch-confirm',
				timestamp: real_now_ms(app),
			});
		}
		const end_ts = match.end_ts || now_ms(app);
		const simulated_match = {
			...match,
			team1_won,
			setup: {
				...match.setup,
				now_on_court: false,
				state: 'finished',
			},
		};
		const preparation_successor_state = match_automation.calculate_preparation_successor_state(simulated_match, tournament, {
			now_ts: now_ms(app),
		});
		const update = {
			presses,
			end_ts,
			team1_won,
			btp_winner: team1_won ? 1 : 2,
			btp_needsync: true,
			'setup.now_on_court': false,
			'setup.state': 'finished',
			'setup.needs_preparation_successor': preparation_successor_state.needs_preparation_successor,
			'setup.needs_preparation_successor_ts': preparation_successor_state.needs_preparation_successor_ts,
		};
		const [_numAffected, updated_match] = await app.db.matches.update_async(
			{ _id: match_id, tournament_key },
			{ $set: update },
			{ returnUpdatedDocs: true }
		);
		if (!updated_match) {
			throw new Error('Match confirmation update failed ' + JSON.stringify(match_id));
		}
		send_finshed_confirmed(app, tournament_key, updated_match.setup.court_id, match_id);
		bupws_v2.send_finished_confirmed(app, tournament_key, updated_match.setup.court_id, match_id).catch((err) => {
			console.error('[bup v2] send finished confirmed failed', err);
		});
		handle_score_change(app, tournament_key, updated_match.setup.court_id);
		admin.notify_change(app, tournament_key, 'score', {
			match_id,
			network_score: updated_match.network_score,
			team1_won: updated_match.team1_won,
			shuttle_count: updated_match.shuttle_count,
			presses: updated_match.presses,
			end_ts: updated_match.end_ts,
			court_id: updated_match.setup && updated_match.setup.court_id,
			now_on_court: updated_match.setup && updated_match.setup.now_on_court,
		});
		btp_manager.update_score(app, updated_match);
		await match_utils.reset_player_tabletoperator(app, tournament_key, match_id, end_ts);
		await new Promise((resolve, reject) => {
			_clear_court_match_reference_after_finish(
				app,
				tournament_key,
				{ tournament_key, _id: court_id },
				court,
				match_id,
				true,
				(err) => err ? reject(err) : resolve()
			);
		});
		handle_score_change(app, tournament_key, court_id);
		ticker_manager.pushall(app, tournament_key);
		await new Promise((resolve, reject) => {
			match_utils.auto_execute_preparation_selection_for_setup(app, tournament, updated_match.setup, (err) => {
				if (err) {
					return reject(err);
				}
				resolve();
			});
		});
		try {
			await match_utils.call_preparation_match_on_court(app, tournament_key, court_id);
		} catch (err) {
			const message = err && (err.message || String(err));
			if (!/No match found to call on court/.test(message)) {
				throw err;
			}
		}
		return updated_match;
	}));
}

async function send_advertisement_add(app, tournament_key, advertisement) {
	notify_change_broadcast(app, tournament_key, 'advertisement_add', advertisement);
}

async function send_advertisement_remove(app, tournament_key, advertisement_id) {
	notify_change_broadcast(app, tournament_key, 'advertisement_remove', { advertisement_id: advertisement_id });
}

async function initialize_client(ws, app, tournament_key, court_id, displaysetting_id, panel_devicemode = 'display') {
	const client_id = determine_client_id(ws);
	const hostname = await determine_client_hostname(ws);
	ws.panel_devicemode = normalize_panel_devicemode(panel_devicemode);
	if (client_id) {
		let display_setting = await get_display_setting(app, tournament_key, client_id, court_id, displaysetting_id, ws.panel_devicemode, hostname)
		if (display_setting != null) {
			ws.court_id = display_setting.court_id;
			court_id = display_setting.court_id;
			notify_change_ws(app, ws, tournament_key, court_id, "settings-update", display_setting);
		}
	}
	matches_handler(app, ws, tournament_key, ws.court_id);
}

function getComputerName() {
	try {
		switch (process.platform) {
			case "win32":
				return process.env.COMPUTERNAME || os.hostname();
			case "darwin":
				return cp.execSync("scutil --get ComputerName").toString().trim();
			case "linux":
				const prettyname = cp.execSync("hostnamectl --pretty").toString().trim();
				return prettyname || os.hostname();
			default:
				return os.hostname();
		}
	} catch (err) {
		console.error("Error getting computer name:", err);
		return os.hostname();
	}
}

function extractIPv4FromMappedIPv6(ip) {
	const match = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	return match ? match[1] : null;
}

async function determine_client_hostname(ws) {
	if (ws.hostname) {
		return ws.hostname;
	}

	let remoteAddress = ws._socket.remoteAddress;
	let ipv4 = extractIPv4FromMappedIPv6(remoteAddress);
	let ip = ipv4 || remoteAddress;

	// Lokale Adressen behandeln
	if (ip === "127.0.0.1") {
		ws.hostname = getComputerName();
		return ws.hostname;
	}

	// Bei ungültiger IP
	if (!net.isIP(ip)) {
		console.error("Invalid IP address:", remoteAddress);
		ws.hostname = "N/N";
		return ws.hostname;
	}

	// 1. Falls IPv4 verfügbar → versuchen Reverse-Lookup
	if (ipv4) {
		try {
			const hostnames = await dnsReverseWithTimeout(ipv4, 3000);
			ws.hostname = hostnames?.[0]?.split(".")[0] || ipv4;
			return ws.hostname;
		} catch (err) {
			if (err.code !== 'ENOTFOUND') {
				console.error("IPv4 DNS reverse lookup failed:", err);
			}
			// IPv4 Lookup fehlgeschlagen → weiter mit IPv6 versuchen
			ip = remoteAddress; // original IPv6 verwenden
		}
	}

	// 2. Jetzt IPv6 Reverse-Lookup versuchen
	if (net.isIPv6(ip)) {
		if (ip === "::1") {
			ws.hostname = getComputerName();
			return ws.hostname;
		}

		try {
			const hostnames = await dnsReverseWithTimeout(ip, 3000);
			ws.hostname = hostnames?.[0]?.split(".")[0] || ipv4 || ip;
			return ws.hostname;
		} catch (err) {
			if (err.code !== 'ENOTFOUND') {
				console.error("IPv6 DNS reverse lookup failed:", err);
			}
			// 3. Fallback: IPv4-Adresse als Text
			ws.hostname = ipv4 || ip;
			return ws.hostname;
		}
	}

	// Sollte nicht vorkommen, aber falls doch:
	ws.hostname = ipv4 || ip;
	return ws.hostname;
}

// Hilfsfunktion: extrahiert IPv4 aus gemapptem IPv6, z.B. ::ffff:192.168.0.1 => 192.168.0.1
function extractIPv4FromMappedIPv6(address) {
	if (typeof address !== "string") return null;
	const match = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	return match ? match[1] : null;
}

// Hilfsfunktion: DNS-Reverse mit Timeout
function dnsReverseWithTimeout(ip, timeoutMs) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error("DNS reverse lookup timeout"));
		}, timeoutMs);

		dns.reverse(ip, (err, hostnames) => {
			clearTimeout(timer);
			if (err) {
				reject(err);
			} else {
				resolve(hostnames);
			}
		});
	});
}


function determine_client_id(ws) {
	if (!ws.client_id) {
		ws.client_id = determine_client_id_from_ip (ws._socket.remoteAddress);
	}
	return ws.client_id;
}

function determine_client_id_from_ip(ip_adress) {
	if (ip_adress) {
		const remote_adress_seqments = ip_adress.split('.');
		return remote_adress_seqments[remote_adress_seqments.length - 1];
	} else {
		return "UNDEFINED";
	}
}

function persist_client_court_displaysetting(app, client_court_displaysetting) {
	return new Promise((resolve, reject) => {
		app.db.display_court_displaysettings.insert(client_court_displaysetting, function (err, inserted_t) {
			if (err) {
				reject(err);
			}
			resolve(inserted_t);
		});
	});
}

function update_client_court_displaysetting(app, client_court_displaysetting_id, updatevalues) {
	return new Promise((resolve, reject) => {
		const setvalues = {};
		const unsetvalues = {};
		Object.keys(updatevalues || {}).forEach((key) => {
			if (updatevalues[key] === undefined) {
				unsetvalues[key] = true;
			} else {
				setvalues[key] = updatevalues[key];
			}
		});
		const modifier = {};
		if (Object.keys(setvalues).length > 0) {
			modifier.$set = setvalues;
		}
		if (Object.keys(unsetvalues).length > 0) {
			modifier.$unset = unsetvalues;
		}
		app.db.display_court_displaysettings.update({ client_id: client_court_displaysetting_id }, modifier, { returnUpdatedDocs: true }, function (err, numAffected, changed_objects) {
			if (err) {
				reject(err)
			}
			resolve(changed_objects)

		});
	});
}


function persist_displaysetting(app, tournament_key, setting) {
	setting._id = undefined;
	return new Promise((resolve, reject) => {
		app.db.displaysettings.insert(setting, function (err, inserted_t) {
			if (err) {
				reject(err);
			}
			admin.notify_change(app, tournament_key, 'update_display_setting', {setting: inserted_t});
			resolve(inserted_t);
		});
	});
}


function client_id(app, tkey, client_id) {
	return new Promise((resolve, reject) => {
		const display_court_query = { 'client_id': client_id };
		app.db.display_court_displaysettings.find(display_court_query).limit(1).exec((err, display_court_displaysetting) => {
			if (err) {
				return reject(err);
			}
			var returnvalue = null;
			if (display_court_displaysetting.length == 1) {
				returnvalue = display_court_displaysetting[0];
			}
			resolve(returnvalue);
		});
	});
}

function get_display_court_displaysettings(app, client_id) {
	return new Promise((resolve, reject) => {
		const display_court_query = { 'client_id': client_id };
		app.db.display_court_displaysettings.find(display_court_query).limit(1).exec((err, display_court_displaysetting) => {
			if (err) {
				return reject(err);
			}
			if (display_court_displaysetting.length == 1) {
				resolve(display_court_displaysetting[0]);
			}
			resolve(null);
		});
	});
}
async function get_display_setting(app, tkey, client_id, court_id, displaysetting, panel_devicemode = 'display', hostname = null) {
	const normalized_panel_devicemode = normalize_panel_devicemode(panel_devicemode);
	let tournament = await app.db.tournaments.findOne_async({ key: tkey });
	if (!tournament) {
		throw new Error('No tournament ' + tkey);
	}
	({ tournament } = await displaysettings_defaults.ensure_default_displaysettings(app, tournament));

	let display_court_displaysetting = await get_display_court_displaysettings(app, client_id);
	let current_displaysetting = null;
	if (display_court_displaysetting && display_court_displaysetting.displaysetting_id) {
		current_displaysetting = await app.db.displaysettings.findOne_async({ id: display_court_displaysetting.displaysetting_id });
	}

	const desired_default_id = displaysetting || get_default_displaysettings_id(tournament, normalized_panel_devicemode);
	if (!display_court_displaysetting) {
		display_court_displaysetting = create_display_court_displaysettings(
			client_id,
			hostname,
			court_id,
			desired_default_id,
			normalized_panel_devicemode,
		);
		display_court_displaysetting = await persist_client_court_displaysetting(app, display_court_displaysetting);
	} else {
		const updatevalues = {};
		if (hostname && display_court_displaysetting.hostname !== hostname) {
			updatevalues.hostname = hostname;
		}
		if (display_court_displaysetting.panel_devicemode !== normalized_panel_devicemode) {
			updatevalues.panel_devicemode = normalized_panel_devicemode;
		}
		if ((display_court_displaysetting.court_id == null) && (court_id != null)) {
			updatevalues.court_id = court_id;
		}
		const uses_default_setting = is_default_displaysetting_id(tournament, display_court_displaysetting.displaysetting_id);
		const has_wrong_mode = current_displaysetting && current_displaysetting.devicemode !== normalized_panel_devicemode;
		const is_missing_setting = !display_court_displaysetting.displaysetting_id || !current_displaysetting;
		if (uses_default_setting || has_wrong_mode || is_missing_setting) {
			updatevalues.displaysetting_id = desired_default_id;
		}
		if (Object.keys(updatevalues).length > 0) {
			display_court_displaysetting = await update_client_court_displaysetting(app, display_court_displaysetting.client_id, updatevalues);
		}
	}

	let returnvalue = null;
	const effective_displaysetting_id = display_court_displaysetting && display_court_displaysetting.displaysetting_id
		? display_court_displaysetting.displaysetting_id
		: desired_default_id;
	const effective_displaysetting = await app.db.displaysettings.findOne_async({ id: effective_displaysetting_id });
	if (effective_displaysetting) {
		returnvalue = effective_displaysetting;
		returnvalue.court_id = (
			display_court_displaysetting && display_court_displaysetting.court_id != null
				? display_court_displaysetting.court_id
				: ''
		);
		returnvalue.displaymode_court_id = returnvalue.court_id;
		returnvalue.client_id = display_court_displaysetting ? display_court_displaysetting.client_id : client_id;
		returnvalue.hostname = display_court_displaysetting ? display_court_displaysetting.hostname : hostname;
		returnvalue.monitor_label = String(returnvalue.client_id || '');
	}
	const advertisements = await app.db.advertisements.find_async({});
	if (returnvalue) {
		returnvalue.advertisements = advertisements;
	}
	return returnvalue;
}

function handle_command_done(app, ws, msg) {
	admin.notify_change(app, msg.tournament_key, 'display_is_done', {'ctype': msg.wait_for_command.ctype, 'val' : msg.wait_for_command.val, 'client_id': ws.client_id});
}

function handle_score_change(app, tournament_key, court_id) {
	debug_flags.log(app, tournament_key, '[bts] auto_call_trace:bup_handle_score_change', {
		ts: now_ms(app),
		tournament_key,
		court_id: court_id || null,
		all_matches_delivery: !!all_matches_delivery(),
	});
	matches_handler(app, null, tournament_key, court_id);
	if (all_matches_delivery()) {
		matches_handler(app, null, tournament_key, undefined);
	}
	bupws_v2.handle_score_change(app, tournament_key, court_id).catch((err) => {
		console.error('[bup v2] score change hook failed', err);
	});
}

function get_bup_match_priority(match, prefer_finished_first) {
	if (!match || !match.setup) {
		return 99;
	}
	if (prefer_finished_first) {
		if (match.setup.state === 'finished') {
			return 0;
		}
		if (match.setup.now_on_court === true) {
			return 1;
		}
		if (match.setup.state === 'oncourt') {
			return 2;
		}
		if (match.setup.state === 'blocked') {
			return 3;
		}
		return 4;
	}
	if (match.setup.now_on_court === true) {
		return 0;
	}
	if (match.setup.state === 'oncourt') {
		return 1;
	}
	if (match.setup.state === 'blocked') {
		return 2;
	}
	if (match.setup.state === 'finished') {
		return 3;
	}
	return 4;
}

function cmp_bup_matches(a, b, prefer_finished_first) {
	const priority_diff = get_bup_match_priority(a, prefer_finished_first) - get_bup_match_priority(b, prefer_finished_first);
	if (priority_diff !== 0) {
		return priority_diff;
	}

	const a_called = (a && a.setup && a.setup.called_timestamp) || 0;
	const b_called = (b && b.setup && b.setup.called_timestamp) || 0;
	if (a_called !== b_called) {
		return b_called - a_called;
	}

	const a_end = a && a.end_ts ? a.end_ts : 0;
	const b_end = b && b.end_ts ? b.end_ts : 0;
	if (a_end !== b_end) {
		return b_end - a_end;
	}

	const a_id = (a && a.setup && a.setup.match_id) || '';
	const b_id = (b && b.setup && b.setup.match_id) || '';
	return a_id.localeCompare(b_id);
}

function matches_handler(app, ws, tournament_key, court_id) {
	const now = now_ms(app);
	const show_still = now - 60000;
	const query = {
		tournament_key,
		$or: [
			{
				$and: [
					{
						team1_won: {
							$ne: true,
						},
					},
					{
						team1_won: {
							$ne: false,
						},
					},
				],
			},
			{
				end_ts: {
					$gt: show_still,
				},
			},
		],
	};
	if (court_id) {
		query['setup.court_id'] = court_id;
	} else {
		query['setup.court_id'] = { $exists: true };
	}

	app.db.fetch_all([{
		queryFunc: '_findOne',
		collection: 'tournaments',
		query: { key: tournament_key },
	}, {
		collection: 'matches',
		query,
	}, {
		collection: 'courts',
		query: { tournament_key },
	}], function (err, tournament, db_matches, db_courts) {
		if (err) {
			const msg = {
				status: 'error',
				message: err.message,
			};
			notify_change_ws(app, tournament_key, "score-update", msg);
		}

		if(db_matches){
		    let matches = db_matches.map(dbm => create_match_representation(app, tournament, dbm));
			if (!court_id) {
		        matches = matches.filter(m => m.setup.now_on_court);
		    }
			matches = matches.filter(m => m.setup.state == 'oncourt' || m.setup.state == 'finished' || m.setup.state == 'blocked');
			matches.sort((a, b) => cmp_bup_matches(a, b, !!court_id));

		    db_courts.sort(utils.cmp_key('num'));
		    const courts = db_courts.map(function (dc) {
				var res = {
					court_id: dc._id,
					label: dc.num,
				};
				if (dc.match_id) {
					res.match_id = 'bts_' + dc.match_id;
				}
				if (dc.called_timestamp) {
					res.called_timestamp = bup_outgoing_ts(app, dc.called_timestamp);
				}
				return res;
			});
		

			const event = create_event_representation(tournament);
			event.matches = matches;
			event.courts = courts;
			debug_flags.log(app, tournament_key, '[bts] auto_call_trace:bup_score_update_payload', {
				ts: now_ms(app),
				tournament_key,
				court_id: court_id || null,
				match_states: matches.map((match) => ({
					match_id: match && match.setup && match.setup.match_id,
					state: match && match.setup && match.setup.state,
					now_on_court: match && match.setup && match.setup.now_on_court,
					called_timestamp: match && match.setup && match.setup.called_timestamp,
					end_ts: match && match.end_ts,
				})),
			});
			const reply = {
				status: 'ok',
				event,
			};
			notify_change_ws(app, ws, tournament_key, court_id, "score-update", reply)
		}		
	});
}

function create_match_representation(app, tournament, match) {
	const setup = {
		...match.setup,
	};
	setup.match_id = 'bts_' + match._id;
	setup.team_competition = tournament.is_team;
	setup.nation_competition = tournament.is_nation_competition;
	for (const t of setup.teams) {
		if (!t.players) continue;

		for (const p of t.players) {
			if (p.lastname) continue;

			const asian_m = /^([A-Z]+)\s+(.*)$/.exec(p.name);
			if (asian_m) {
				p.lastname = asian_m[1];
				p.firstname = asian_m[2];
				p._guess_info = 'bts_asian';
				continue;
			}

			const m = /^(.*)\s+(\S+)$/.exec(p.name);
			if (m) {
				p.firstname = m[1];
				p.lastname = m[2];
				p._guess_info = 'bts_western';
			} else {
				p.firstname = '';
				p.lastname = p.name;
				p._guess_info = 'bts_single';
			}
		}
	}

	setup.called_timestamp = bup_outgoing_ts(app, setup.called_timestamp);
	setup.preparation_call_timestamp = bup_outgoing_ts(app, setup.preparation_call_timestamp);
	setup.needs_preparation_successor_ts = bup_outgoing_ts(app, setup.needs_preparation_successor_ts);

	const res = {
		setup,
		network_score: match.network_score,
		score_status: match.score_status,
		score_status_network_score: match.score_status_network_score,
		network_team1_left: match.network_team1_left,
		network_team1_serving: match.network_team1_serving,
		network_teams_player1_even: match.network_teams_player1_even,
		end_ts: match.end_ts !== undefined ? bup_outgoing_ts(app, match.end_ts) : null,
	};
	if (match.presses) {
		res.presses_json = JSON.stringify(match.presses);
	}
	return res;
}

function create_event_representation(tournament) {
	const res = {
		id: 'bts_' + tournament.key,
		tournament_name: tournament.name,
	};
	if (tournament.logo_id) {
		res.tournament_logo_url = `/h/${encodeURIComponent(tournament.key)}/logo/${tournament.logo_id}`;
	}
	else {
		try {
			const fs = require('fs');
			const path = require('path');
			const d = new Date();
			const datestring = d.toISOString().slice(0, 10);
			const filename = "logo/" + datestring +"_"+tournament._id + ".png";
			const filepath = path.join(utils.root_dir(), 'data', 'logos', datestring +"_"+tournament._id + ".png");
			if (!fs.existsSync(filepath)) {
				const qrcode = require('qrcode');
				const url = admin.generate_tournament_web_url(tournament);
				qrcode.toFile(filepath, url, { scale: 7, errorCorrectionLevel: 'H' }, function (error) { });
			}
			res.tournament_logo_url = `/h/${encodeURIComponent(tournament.key)}/${filename}`;
		} catch (error) {
			console.error("An error occurred while generating the display QR code:", error);
		}
	}
	res.tournament_logo_background_color = tournament.logo_background_color || '#000000';
	res.tournament_logo_foreground_color = tournament.logo_foreground_color || '#aaaaaa';
	return res;
}

async function restart_panel(app, tournament_key, client_id, new_court_id) {
	var client_court_displaysetting = null;
	const should_update_court = arguments.length >= 4;
	if (new_court_id == "--") {
		new_court_id = undefined;
	}

	if (should_update_court) {
		const updatevalues = {
			court_id: new_court_id
		}
		client_court_displaysetting = await update_client_court_displaysetting(app, client_id, updatevalues);
		if (!client_court_displaysetting) {
			const tournament = await app.db.tournaments.findOne_async({ key: tournament_key });
			client_court_displaysetting = await persist_client_court_displaysetting(app, create_display_court_displaysettings(
				client_id,
				null,
				new_court_id,
				get_default_displaysettings_id(tournament, 'display'),
				'display',
			));
		}
	}
	var display_online = reinitialize_panel(app, tournament_key, client_id, new_court_id, undefined, should_update_court);
	if (client_court_displaysetting != null) { 
		client_court_displaysetting.online = display_online;
		admin.notify_change(app, tournament_key, 'display_status_changed', { 'display_court_displaysetting': client_court_displaysetting });
	}
	await bupws_v2.reinitialize_client(app, tournament_key, client_id);
	
}

async function change_display_mode(app, tournament_key, client_id, new_displaysettings_id) {
	if (new_displaysettings_id) {
		const [new_displaysetting, current_display] = await Promise.all([
			app.db.displaysettings.findOne_async({ id: new_displaysettings_id }),
			get_display_court_displaysettings(app, client_id),
		]);
		const updatevalues = {
			displaysetting_id: new_displaysettings_id
		}
		if (new_displaysetting) {
			updatevalues.panel_devicemode = normalize_panel_devicemode(new_displaysetting.devicemode);
		}
		if (bupws_v2.is_fieldless_multi_court_display_style(new_displaysetting)) {
			updatevalues.court_id = bupws_v2.MULTI_COURT_ASSIGNMENT_ID;
		} else if (current_display && current_display.court_id === bupws_v2.MULTI_COURT_ASSIGNMENT_ID) {
			updatevalues.court_id = undefined;
		}
		let client_court_displaysetting = await update_client_court_displaysetting(app, client_id, updatevalues);
		if (!client_court_displaysetting) {
			const connected_panel = fetch_panel(client_id);
			const initial_court_id = Object.prototype.hasOwnProperty.call(updatevalues, 'court_id')
				? updatevalues.court_id
				: (current_display && current_display.court_id) || (connected_panel && connected_panel.court_id);
			client_court_displaysetting = await persist_client_court_displaysetting(app, create_display_court_displaysettings(
				client_id,
				null,
				initial_court_id,
				new_displaysettings_id,
				updatevalues.panel_devicemode || (new_displaysetting && new_displaysetting.devicemode) || 'display',
			));
			if (!client_court_displaysetting.court_id && current_display && current_display.court_id) {
				client_court_displaysetting = await update_client_court_displaysetting(app, client_id, {
					court_id: current_display.court_id,
				});
			}
		}
		const should_update_court = Object.prototype.hasOwnProperty.call(updatevalues, 'court_id');
		var display_online = reinitialize_panel(
			app,
			tournament_key,
			client_id,
			updatevalues.court_id,
			new_displaysettings_id,
			should_update_court,
			updatevalues.panel_devicemode,
		);
		if (client_court_displaysetting) { 
			client_court_displaysetting.online = display_online;
			admin.notify_change(app, tournament_key, 'display_status_changed', { 'display_court_displaysetting': client_court_displaysetting });
		}
		await bupws_v2.refresh_client(app, tournament_key, client_id);
	}
}
async function change_default_display_mode(app, tournament, old_displaysettings_id, new_displaysettings_id) {
	if (new_displaysettings_id) {
		app.db.display_court_displaysettings.find({ displaysetting_id: old_displaysettings_id }).exec( async (err, display_court_displaysettings) => {
			if (err) {
				return reject(err);
			}
			const updatevalues = {
				displaysetting_id: new_displaysettings_id
			}
			for (const displaysettings of display_court_displaysettings) {
				const client_court_displaysetting = await update_client_court_displaysetting(app, displaysettings.client_id, updatevalues);
				if (client_court_displaysetting) {
					var display_online = reinitialize_panel(app, tournament.key, displaysettings.client_id, null, undefined);

				}
			}
			for (const panel_ws of all_panels) {
				restart_panel(app, tournament.key, panel_ws.client_id);
			}
		});
	}
}

async function refresh_protocol_mode(app, tournament_key) {
	const use_v2 = await is_bupws_v2_enabled(app, tournament_key);
	for (const panel_ws of all_panels) {
		if (panel_ws.last_tournament_key && panel_ws.last_tournament_key !== tournament_key) {
			continue;
		}
		if (use_v2) {
			send_use_bup_v2(panel_ws, tournament_key);
		} else {
			initialize_client(
				panel_ws,
				app,
				tournament_key,
				panel_ws.court_id,
				undefined,
				panel_ws.panel_devicemode,
			);
		}
	}
	await bupws_v2.refresh_tournament(app, tournament_key);
}



function reinitialize_panel(app, tournament_key, client_id, new_court_id, displaysetting_id, apply_court_id = false, panel_devicemode) {
	for (const panel_ws of all_panels) {
		const ws_client_id = determine_client_id(panel_ws);
		if (client_id == ws_client_id) {
			if (apply_court_id) {
				panel_ws.court_id = new_court_id;
			}
			const effective_panel_devicemode = panel_devicemode || panel_ws.panel_devicemode;
			initialize_client(panel_ws, app, tournament_key, panel_ws.court_id, displaysetting_id, effective_panel_devicemode);
			return true;
		}
	}
	return false;;
}

async function add_display_status(app, tournament, displays, callback) {
	for (const d of displays) {
		d.online = false;
		for (const panel_ws of all_panels) {
			const ws_client_id = determine_client_id(panel_ws);
			if (d.client_id == ws_client_id) {
				d.online = true;
				d.battery = panel_ws.battery;
				d.hostname = await determine_client_hostname(panel_ws);
				break;
			}
		}
	}
	for (const panel_ws of all_panels) {
		var found = false;
		const ws_client_id = determine_client_id(panel_ws);
		for (const d of displays) {
			if (d.client_id == ws_client_id) {
				found = true;
				break;
			}
		}
		if (!found) {
			const ws_hostname = await determine_client_hostname(panel_ws);
			const client_court_displaysetting = create_display_court_displaysettings(
				ws_client_id,
				ws_hostname,
				panel_ws.court_id,
				get_default_displaysettings_id(tournament, panel_ws.panel_devicemode),
				panel_ws.panel_devicemode,
			);
			client_court_displaysetting.online = true;
			client_court_displaysetting.battery = panel_ws.battery;
			displays[displays.length] = client_court_displaysetting;

		}
	}
	await bupws_v2.add_display_status(app, tournament, displays);
	return callback(displays);
}

module.exports = {
	on_close,
	on_connect,
	notify_change,
	handle_init,
	async_handle_select_court_assignment,
	handle_command_done,
	handle_score_change,
	handle_persist_display_settings,
	handle_reset_display_settings,
	handle_score_update,
	handle_device_info,
	update_device_info,
	restart_panel,
	send_finshed_confirmed,
	confirm_match_finished_from_admin,
	send_advertisement_add,
	send_advertisement_remove,
	change_display_mode,
	change_default_display_mode,
	refresh_protocol_mode,
	add_display_status,
	create_match_representation,
	create_event_representation,
	_clear_court_match_reference_after_finish,
};
