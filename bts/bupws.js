﻿'use strict';

const { forEach } = require('async');
const serror = require('./serror');
const utils = require('./utils');

const all_panels = [];

function on_close(app, ws) {
	if (!utils.remove(all_panels, ws)) {
		serror.silent('Removing Scoreboard ws, but it was not connected!?');
	}
}

function on_connect(app, ws) {
	all_panels.push(ws);
}

function notify_change(tournament_key, court_id, ctype, val) {
	for (const panel_ws of all_panels) {
		notify_change_ws(panel_ws, tournament_key, court_id, ctype, val);
	}
}

function notify_change_ws(ws, tournament_key, court_id, ctype, val) {
	if (ws == null) {
		notify_change(tournament_key, court_id, ctype, val);
	} else { 
		if (ws.court_id === court_id) { 
			ws.sendmsg({
				type: 'change',
				tournament_key,
				ctype,
				val,
			});
		}
	}
}

function all_matches_delivery() {
	for (const panel_ws of all_panels) {
		if (panel_ws.court_id === undefined) {
			return true;
		}
	}
}

async function handle_reset_display_settings(app, ws, msg) {
	const tournament_key = msg.tournament_key;
	const court_id = msg.panel_settings.court_id;
	var setting = msg.panel_settings;

	const client_id = determine_client_id(ws);
	var client_court_displaysetting = await get_display_court_displaysettings(app, tournament_key, client_id);
	if (client_court_displaysetting != null) {
		const updatevalues = {
			client_id: 'deleted'
		}
		client_court_displaysetting = await update_client_court_displaysetting(app, client_court_displaysetting, updatevalues);

	}
}

async function handle_persist_display_settings(app, ws, msg) {
	const tournament_key = msg.tournament_key;
	const court_id = msg.panel_settings.court_id;
	var setting = msg.panel_settings;

	const client_id = determine_client_id(ws);
	var client_court_displaysetting = await get_display_court_displaysettings(app, tournament_key, client_id);
	if (client_court_displaysetting == null) {
		setting.id = tournament_key + "_" + court_id + " _" + Date.now();
		setting = await persist_displaysetting(app, setting);

		client_court_displaysetting = {
			client_id: client_id,
			court_id: court_id,
			displaysetting_id: setting.id,
		}
		client_court_displaysetting = await persist_client_court_displaysetting(app, client_court_displaysetting);
	} else {
		setting.id = tournament_key + "_" + court_id + " _" + Date.now();
		setting = await persist_displaysetting(app, setting);
		const updatevalues = {
			court_id: court_id,
			displaysetting_id: setting.id,
		}
		client_court_displaysetting = await update_client_court_displaysetting(app, client_court_displaysetting, updatevalues);
	}
}

async function handle_init(app, ws, msg) {
	const tournament_key = msg.tournament_key;
	var court_id = msg.panel_settings.court_id;
	if (court_id) {
		ws.court_id = court_id;
	} else {
		ws.court_id = undefined;
		court_id = undefined;
	}
	if (msg.initialize_display) {
		const client_id = determine_client_id(ws);
		if (client_id) {
			let display_setting = await get_display_setting(app, tournament_key, client_id, court_id)
			if (display_setting != null) {
				ws.court_id = display_setting.court_id;
				court_id = display_setting.court_id;
				notify_change_ws(ws, tournament_key, court_id, "settings-update", display_setting);
			}
		}
	}
	matches_handler(app, ws, tournament_key, court_id);
}

function determine_client_id(ws) {
	const remote_adress_seqments = ws._socket.remoteAddress.split('.');
	return remote_adress_seqments[remote_adress_seqments.length - 1];
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

function update_client_court_displaysetting(app, client_court_displaysetting, updatevalues) {
	return new Promise((resolve, reject) => {
		app.db.display_court_displaysettings.update({ _id: client_court_displaysetting._id }, { $set: updatevalues }, { returnUpdatedDocs: true }, function (err, numAffected, changed_objects) {
			if (err) {
				reject(err)
			}
			resolve(changed_objects)

		});
	});
}


function persist_displaysetting(app, setting) {
	setting._id = undefined;
	return new Promise((resolve, reject) => {
		app.db.displaysettings.insert(setting, function (err, inserted_t) {
			if (err) {
				reject(err);
			}
			resolve(inserted_t);
		});
	});
}


function get_display_court_displaysettings(app, tkey, client_id) {
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

function get_display_setting(app, tkey, client_id, court_id) {
	return new Promise((resolve, reject) => {
		const display_court_query = { 'client_id': client_id };
		app.db.display_court_displaysettings.find(display_court_query).limit(1).exec((err, display_court_displaysetting) => {
			if (err) {
				return reject(err);
			}
			var returnvalue = null;
			if (display_court_displaysetting.length == 1) {
				const display_query = { 'id': display_court_displaysetting[0].displaysetting_id };
				app.db.displaysettings.find(display_query).limit(1).exec((err, display_setting) => {
					if (err) {
						return reject(err);
					}
					if (display_setting.length == 1) {
						returnvalue = display_setting[0];
						returnvalue.court_id = display_court_displaysetting[0].court_id;
						returnvalue.displaymode_court_id = display_court_displaysetting[0].court_id;
					}
					resolve(returnvalue);
				});
			} else {
				const display_query_default = { 'id': 'default' };
				app.db.displaysettings.find(display_query_default).limit(1).exec((err, display_setting_default) => {
					if (err) {
						return reject(err);
					}
					if (display_setting_default.length == 1) {
						returnvalue = display_setting_default[0];
						returnvalue.court_id = court_id;
						returnvalue.displaymode_court_id = court_id;
					} 
					resolve(returnvalue);
				});
			}
		});
	});
}

function handle_score_change(app, tournament_key, court_id) {
	matches_handler(app, null, tournament_key, court_id);
	if (all_matches_delivery()) {
		matches_handler(app, null, tournament_key, undefined);
	}
}

function matches_handler(app, ws, tournament_key, court_id) {
	const now = Date.now();
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

		let matches = db_matches.map(dbm => create_match_representation(tournament, dbm));
		if (tournament.only_now_on_court) {
			matches = matches.filter(m => m.setup.now_on_court);
		}

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
				res.called_timestamp = dc.called_timestamp;
			}
			return res;
		});

		const event = create_event_representation(tournament);
		event.matches = matches;
		event.courts = courts;
		const reply = {
			status: 'ok',
			event,
		};
		notify_change_ws(ws, tournament_key, court_id, "score-update",reply)
	});
}

function create_match_representation(tournament, match) {
	const setup = match.setup;
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

	const res = {
		setup,
		network_score: match.network_score,
		network_team1_left: match.network_team1_left,
		network_team1_serving: match.network_team1_serving,
		network_teams_player1_even: match.network_teams_player1_even,
		end_ts: match.end_ts !== undefined ? match.end_ts : null,
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
	res.tournament_logo_background_color = tournament.logo_background_color || '#000000';
	res.tournament_logo_foreground_color = tournament.logo_foreground_color || '#aaaaaa';
	return res;
}


module.exports = {
	on_close,
	on_connect,
	notify_change,
	handle_init,
	handle_score_change,
	handle_persist_display_settings,
	handle_reset_display_settings,
};