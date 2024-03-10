'use strict';

const assert = require('assert');

const async = require('async');

const btp_parse = require('./btp_parse');
const countries = require('./countries');
const utils = require('./utils');
const { fix_player } = require('./name_fixup');


function time_str(dt) {
	return utils.pad(dt.hour, 2, '0') + ':' + utils.pad(dt.minute, 2, '0');
}

function date_str(dt) {
	return utils.pad(dt.year, 2, '0') + '-' + utils.pad(dt.month, 2, '0') + '-' + utils.pad(dt.day, 2, '0');
}

function craft_match(app, tkey, btp_id, court_map, event, draw, officials, bm, match_ids_on_court, match_types, is_league) {
	if (!bm.IsMatch) {
		return;
	}

	if (!bm.bts_complete) {
		// TODO: register them as incomplete, but continue instead of returning
		return;
	}

	const gtid = event.GameTypeID[0];
	assert((gtid === 1) || (gtid === 2));

	const scheduled_time_str = (bm.PlannedTime ? time_str(bm.PlannedTime[0]) : undefined);
	const scheduled_date = (bm.PlannedTime ? date_str(bm.PlannedTime[0]) : undefined);
	const match_name = bm.RoundName[0];
	const event_name = (event.Name[0] === draw.Name[0]) ? draw.Name[0] : event.Name[0] + ' - ' + draw.Name[0];
	const teams = _craft_teams(bm);

	const btp_player_ids = [];
	for (const team of bm.bts_players) {
		for (const p of team) {
			btp_player_ids.push(p.ID[0]);
		}
	}

	const setup = {
		incomplete: !bm.bts_complete,
		is_doubles: (gtid === 2),
		match_num: bm.MatchNr[0],
		counting: '3x21',
		team_competition: false,
		match_name,
		event_name,
		teams,
		warmup: 'none',
	};

	app.db.tournaments.findOne({key: tkey}, (err, tournament) => {
		if (err) {
			return callback(err);
		}
		if (tournament.warmup) {
			setup.warmup = tournament.warmup;
		}
		if (tournament.warmup_ready) {
			setup.warmup_ready = tournament.warmup_ready;
		}
		if (tournament.warmup_start) {
			setup.warmup_start = tournament.warmup_start;
		}
		if (tournament.btp_settings.check_in_per_match && teams.length > 1) {
			teams[0].players[0].checked_in = (bm.Status & 0b0001) > 0;
			if(teams[0].players.length > 1) {
				teams[0].players[1].checked_in = (bm.Status & 0b0010) > 0;
			}
			teams[1].players[0].checked_in = (bm.Status & 0b0100) > 0;
			if(teams[1].players.length > 1) {
				teams[1].players[1].checked_in = (bm.Status & 0b1000) > 0;
			}
		}

	});

	if (scheduled_time_str) {
		setup.scheduled_time_str = scheduled_time_str;
	}
	if (scheduled_date) {
		setup.scheduled_date = scheduled_date;
	}
	if (bm.CourtID) {
		const btp_court_id = bm.CourtID[0];
		const court_id = court_map.get(btp_court_id);
		assert(court_id);
		setup.court_id = court_id;
		setup.now_on_court = match_ids_on_court.has(bm.ID[0]);
	}
	if (bm.Official1ID) {
		const o = officials.get(bm.Official1ID[0]);
		assert(o);
		setup.umpire_name = o.FirstName + ' ' + o.Name;
	}
	if (bm.Official2ID) {
		const o = officials.get(bm.Official2ID[0]);
		assert(o);
		setup.service_judge_name = o.FirstName + ' ' + o.Name;
	}

	const btp_match_ids = [{
		id: bm.ID[0],
		nr: bm.MatchNr[0],
		draw: bm.DrawID[0],
		planning: bm.PlanningID[0],
	}];

	const match = {
		tournament_key: tkey,
		btp_id,
		btp_match_ids,
		btp_player_ids,
		setup,
	};
	match.team1_won = undefined;
	match.btp_winner = undefined;
	if (bm.Winner) {
		match.btp_winner = bm.Winner[0];
		match.team1_won = (match.btp_winner === 1);
	}
	if (bm.Sets) {
		match.network_score = _parse_score(bm);
	}
	if (bm.Shuttles) {
		match.shuttle_count = bm.Shuttles[0];
	}
	if (bm.DisplayOrder) {
		match.match_order = bm.DisplayOrder[0];
	}
	match._id = 'btp_' + btp_id;

	return match;
}

function _craft_team(par) {
	if (!par) {
		return {players: []};
	}

	const players = par.map(p => {
		const asian_name = !! (p.Asianname && p.Asianname[0]);
		const pres = {asian_name};
		if (p.Firstname && p.Lastname) {
			if (asian_name) {
				pres.name = p.Lastname[0].toUpperCase() + ' ' + p.Firstname[0];
			} else {
				pres.name = p.Firstname[0] + ' ' + p.Lastname[0];
			}

			pres.firstname = p.Firstname[0];
			pres.lastname = p.Lastname[0];
		} else if (p.Lastname) {
			pres.name = p.Lastname[0];
			pres.lastname = p.Lastname[0];
			pres.firstname = '';
		} else if (p.Firstname) {
			pres.name = p.Firstname[0];
			pres.lastname = p.Firstname[0];
			pres.firstname = '';
		}


		if(p.ID && p.ID[0]) {
			pres.btp_id = p.ID[0];
		}

		if (p.Country && p.Country[0]) {
			pres.nationality = p.Country[0];
		}

		if(p.LastTimeOnCourt && p.LastTimeOnCourt[0]) {
			let date = new Date(p.LastTimeOnCourt[0].year,
								p.LastTimeOnCourt[0].month - 1,
								p.LastTimeOnCourt[0].day,
								p.LastTimeOnCourt[0].hour,
								p.LastTimeOnCourt[0].minute,
								p.LastTimeOnCourt[0].second,
								p.LastTimeOnCourt[0].ms);
			pres.last_time_on_court_ts = date.getTime();
		}

		if(p.CheckedIn && p.CheckedIn.length > 0) {
			pres.checked_in = p.CheckedIn[0];
		}

		if (p.State) {
			switch (p.State[0]) {
				case 'NIS': {
					pres.state = "Niedersachsen";
					break;
				} case 'SLH': {
					pres.state = "Schleswig-Holstein";
					break;
				} case 'BRE': {
					pres.state = "Bremen";
					break;
				} case 'BBB': {
					pres.state = "Berlin Brandenburg";
					break;
				} case 'SAH': {
					pres.state = "Sachsen Anhalt";
					break;
				} case 'HAM': {
					pres.state = "Hamburg";
					break;
				} case 'MVP': {
					pres.state = "Mecklenburg Vorpommern";
					break;
				} case 'NRW': {
					pres.state = "Nordrhein Westfalen";
					break;
				}
				default:
					pres.state = p.State[0]
			}
		}
		fix_player(pres);
		return pres;
	});

	const tres = {
		players,
	};

	if ((players.length === 2) && (players[0].nationality != players[1].nationality)) {
		tres.name = countries.lookup(players[0].nationality) + ' / ' + countries.lookup(players[1].nationality);
	} else if ((players.length > 0) && (players[0].nationality)) {
		tres.name = countries.lookup(players[0].nationality);
	}

	return tres;
}

function _craft_teams(bm) {
	assert(bm.bts_players);
	return bm.bts_players.map(_craft_team);
}

function _parse_score(bm) {
	assert(bm.Sets);
	assert(bm.Sets[0]);
	assert(bm.Sets[0].Set);

	return bm.Sets[0].Set.map(s => [s.T1[0], s.T2[0]]);
}

function integrate_matches(app, tkey, btp_state, court_map, callback) {
	const admin = require('./admin'); // avoid dependency cycle
	const {draws, events, officials} = btp_state;

	const match_ids_on_court = calculate_match_ids_on_court(btp_state);

	async.each(btp_state.matches, function(bm, cb) {
		const draw = draws.get(bm.DrawID[0]);
		assert(draw);

		const event = events.get(draw.EventID[0]);
		assert(event);

		const discipline_name = (event.Name[0] === draw.Name[0]) ? draw.Name[0] : event.Name[0] + '_' + draw.Name[0];
		const btp_id = tkey + '_' + discipline_name + '_' + bm.ID[0];

		const query = {
			btp_id,
			tournament_key: tkey,
		};
		// TODO get all matches upfront here
		app.db.matches.findOne(query, (err, cur_match) => {
			if (err) return cb(err);

			if (cur_match && cur_match.btp_needsync) {
				cb();
				return;
			}

			let match = craft_match(app, tkey, btp_id, court_map, event, draw, officials, bm, match_ids_on_court);

			if (!match) {
				cb();
				return;
			}

			if (cur_match) {
				if(cur_match.setup.called_timestamp) {
					// The called_timestamp is not from btp so we have to coppy it to the match generated by btp.
					match.setup.called_timestamp = cur_match.setup.called_timestamp;
				}

				if (cur_match.setup.tabletoperators) {
					// tabletoperators is not from btp so we have to coppy it to the match generated by btp.
					match.setup.tabletoperators = cur_match.setup.tabletoperators;
				}

				for(let team_index = 0; team_index < cur_match.setup.teams.length; team_index++) {
					for (let player_index = 0; player_index < cur_match.setup.teams[team_index].players.length; player_index++){
					
						if (cur_match.setup.teams[team_index].players[player_index].now_playing_on_court != undefined) {
							match.setup.teams[team_index].players[player_index].now_playing_on_court = cur_match.setup.teams[team_index].players[player_index].now_playing_on_court;
						}

						if (cur_match.setup.teams[team_index].players[player_index].now_tablet_on_court != undefined) {
							match.setup.teams[team_index].players[player_index].now_tablet_on_court = cur_match.setup.teams[team_index].players[player_index].now_tablet_on_court;
						}

						if(cur_match.setup.teams[team_index].players[player_index].last_time_on_court_ts || match.setup.teams[team_index].players[player_index].last_time_on_court_ts) {
							if(!cur_match.setup.teams[team_index].players[player_index].last_time_on_court_ts) {
								cur_match.setup.teams[team_index].players[player_index].last_time_on_court_ts = 0;
							}

							if(!match.setup.teams[team_index].players[player_index].last_time_on_court_ts) {
								match.setup.teams[team_index].players[player_index].last_time_on_court_ts = 0;
							}

							let max_ts = Math.max(	cur_match.setup.teams[team_index].players[player_index].last_time_on_court_ts, 
													match.setup.teams[team_index].players[player_index].last_time_on_court_ts);

							cur_match.setup.teams[team_index].players[player_index].last_time_on_court_ts = max_ts;
							match.setup.teams[team_index].players[player_index].last_time_on_court_ts = max_ts;
						}
					}
				}

				if (cur_match.setup.warmup) {
					match.setup.warmup = cur_match.setup.warmup;
				}

				if (cur_match.setup.warmup_ready) {
					match.setup.warmup_ready = cur_match.setup.warmup_ready;
				}

				if(cur_match.setup.warmup_start) {
					match.setup.warmup_start = cur_match.setup.warmup_start;
				}

				if (utils.plucked_deep_equal(match, cur_match, Object.keys(match), true)) {
					// No update required
					cb();
					return;
				}

				// equals checked_in changed and check if it was the only change
				let only_change_check_in = false;

				for(let team_index = 0; team_index < cur_match.setup.teams.length; team_index++) {
					for (let player_index = 0; player_index < cur_match.setup.teams[team_index].players.length; player_index++){
						cur_match.setup.teams[team_index].players[player_index].checked_in = match.setup.teams[team_index].players[player_index].checked_in;
					}
				}

				if (utils.plucked_deep_equal(match, cur_match, Object.keys(match), true)) {
					only_change_check_in = true;
				}

				app.db.matches.update({_id: cur_match._id}, {$set: match}, {}, (err) => {
					if (err) return cb(err);

					if(!only_change_check_in) {
						admin.notify_change(app, match.tournament_key, 'match_edit', {	match__id: match._id,
																						btp_winner: match.btp_winner, 
																						setup: match.setup,
																						from: "btp_sync.js:423"});
					} else {
						admin.notify_change(app, match.tournament_key, 'update_player_status', {match__id: match._id,
																								btp_winner: match.btp_winner, 
																								setup: match.setup,
																								from: "btp_sync.js:429"});
					}
					cb();
				});
				return;
			}

			app.db.matches.insert(match, function(err) {
				if (err) return cb(err);

				admin.notify_change(app, tkey, 'match_add', {match});
				cb();
			});
		});
	}, callback);
}

// Returns a map btp_court_id => court._id
function integrate_courts(app, tournament_key, btp_state, callback) {
	const admin = require('./admin'); // avoid dependency cycle
	const stournament = require('./stournament'); // avoid dependency cycle

	const courts = Array.from(btp_state.courts.values());
	const res = new Map();
	var changed = false;

	async.each(courts, (c, cb) => {
		const btp_id = c.ID[0];
		const name = c.Name[0];
		let num = parseInt(name, 10) || btp_id;
		const m = /^Court\s*([0-9]+)$/.exec(name);
		if (m) {
			num = parseInt(m[1]);
		}
		const query = {
			btp_id,
			name,
			num,
			tournament_key,
		};

		app.db.courts.findOne(query, (err, cur_court) => {
			if (err) return cb(err);
			if (cur_court) {
				res.set(btp_id, cur_court._id);
				return cb();
			}

			const alt_query = {
				tournament_key,
				num,
			};
			const court = {
				_id: tournament_key + '_' + num,
				tournament_key,
				btp_id,
				num,
				name,
			};
			res.set(btp_id, court._id);
			app.db.courts.findOne(alt_query, (err, cur_court) => {
				if (err) return cb(err);

				if (cur_court) {
					// Add BTP ID
					app.db.courts.update(alt_query, {$set: {btp_id}}, {}, (err) => cb(err));
					return;
				}

				changed = true;
				app.db.courts.insert(court, (err) => cb(err));
			});
		});
	}, (err) => {
		if (err) return callback(err);

		if (changed) {
			stournament.get_courts(app.db, tournament_key, function(err, all_courts) {
				admin.notify_change(app, tournament_key, 'courts_changed', {all_courts});
				callback(err, res);
			});
		} else {
			callback(err, res);
		}
	});
}

function integrate_btp_settings(app, tkey, btp_state, callback) {
	let btp_settings = {};

	btp_settings.check_in_per_match = btp_state.btp_settings.get(1003).Value[0] ? false : true;
	btp_settings.pause_duration_ms = btp_state.btp_settings.get(1303).Value[0] * 60 * 1000;

	app.db.tournaments.update({key: tkey}, {$set: {btp_settings}}, {}, (err) => {
		if (err) {
			return callback(err);
		}

		return callback(null);
	});
}

function integrate_umpires(app, tournament_key, btp_state, callback) {
	const admin = require('./admin'); // avoid dependency cycle
	const stournament = require('./stournament'); // avoid dependency cycle

	const officials = Array.from(btp_state.officials.values());
	var changed = false;

	async.each(officials, (o, cb) => {
		const name = (o.FirstName ? (o.FirstName[0] + ' ') : '') + ((o.Name && o.Name[0]) ? o.Name[0] : '');
		if (!name) {
			return cb();
		}
		const btp_id = o.ID[0];

		app.db.umpires.findOne({tournament_key, name}, (err, cur) => {
			if (err) return cb(err);

			if (cur) {
				if (cur.btp_id === btp_id) {
					return cb();
				} else {
					app.db.umpires.update({tournament_key, name}, {$set: {btp_id}}, {}, (err) => cb(err));
					return;
				}
			}

			const u = {
				_id: tournament_key + '_btp_' + btp_id,
				btp_id,
				name,
				tournament_key,
			};
			changed = true;
			app.db.umpires.insert(u, err => cb(err));
		});
	}, err => {
		if (changed) {
			stournament.get_umpires(app.db, tournament_key, function(err, all_umpires) {
				if (!err) {
					admin.notify_change(app, tournament_key, 'umpires_changed', {all_umpires});
				}
				callback(err);
			});
		} else {
			callback(err);
		}
	});
}

function calculate_match_ids_on_court(btp_state) {
	const res = new Set();
	for (const c of btp_state.courts.values()) {
		if (c.MatchID) {
			for (const match_id of c.MatchID) {
				res.add(match_id);
			}
		}
	}
	return res;
}

async function integrate_now_on_court(app, tkey, callback) {
	const admin = require('./admin'); // avoid dependency cycle
	const stournament = require('./stournament'); // avoid dependency cycle
	const btp_manager = require('./btp_manager');

	// TODO after switching to async, this should happen during court&match construction
	app.db.tournaments.findOne({key: tkey}, async (err, tournament) => {
		if (err) {
			return callback(err);
		}
		assert(tournament);
		if (!tournament.only_now_on_court) {
			return; // Nothing to do here
		}

		app.db.matches.find({'setup.now_on_court': true}, async (err, now_on_court_matches) => {
			if (err) return callback(err);

			await Promise.all(now_on_court_matches.map(async (match) => {
				
				const court_id = match.setup.court_id;
				const match_id = match._id;
				const called_timestamp = Date.now();

				if (!court_id || !match_id) {
					return; // TODO in async we would assert both to be true
				}

				const setup = match.setup;
				if(!setup.called_timestamp) {
					setup.called_timestamp = called_timestamp;
					try{
						const tabletoperators = await get_last_looser_on_court(app, tkey, court_id, setup.umpire_name);
						setup.tabletoperators = tabletoperators;
					} catch (err) {
						callback(err)
					}

					if (setup.tabletoperators) {
						for (let operator of setup.tabletoperators) {
							operator.checked_in = false;
							operator.last_time_on_court_ts = called_timestamp;
						}
					}
					
					btp_manager.update_players(app, tkey, setup.tabletoperators);

					const match_q = {_id: match_id};
					app.db.matches.update(match_q, {$set: {setup}}, {}, (err) => {
						if (err) {
							console.error(err);
							return;
						}

						const court_q = {_id: court_id};
						app.db.courts.find(court_q, (err, courts) => {
							if (err) {
								console.error(err);
								return;
							}
			 				if (courts.length !== 1) return;

							app.db.courts.update(court_q, {$set: {match_id}}, {}, (err) => {
			 					if (err) {
			 						console.error(err);
									return;
			 					}

								admin.notify_change(app, match.tournament_key, 'match_edit', {	match__id: match._id,
																								btp_winner: match.btp_winner, 
																								setup: match.setup,
																								from: "btp_sync.js:664"});
			 					admin.notify_change(app, tkey, 'match_called_on_court', match);
							
			 					async.waterfall([	wcb => set_player_on_court(app, tkey, match.setup, wcb),
			 										wcb => set_player_on_tablet(app, tkey, match.setup, wcb)], 
												(err) => {
									if (err) {
										console.error(err);
										return;
									}
			 					});
							});
						});
					});
				} 
			}));
			callback(null);
		});
	});
	// TODO clear courts (better in async)
}

function get_last_looser_on_court(app, tkey, court_id, umpire_name) {
	return new Promise((resolve, reject) => {
		const match_querry = {	'tournament_key': tkey, 
								'setup.court_id': court_id,
								'end_ts':{$exists: true}};
		let tabletoperators = undefined;
		app.db.matches.find(match_querry).sort({'end_ts': -1}).limit(1).exec((err, last_match_on_court) => {
			if (err) {
				return reject(err);
			}
			if (last_match_on_court.length === 1 && !umpire_name) {
				const match = last_match_on_court[0];
				const round = match.setup.match_name;
				var team = null;
				if (round == 'VF' || round == 'QF') {
					team = match.setup.teams[match.btp_winner-1];
				} else {
					const index = match.btp_winner % 2;
					team = match.setup.teams[index];
				}
				if(team && typeof team.players !== 'undefined') {
					tabletoperators = [];
					
					team.players.forEach((player) => {
						tabletoperators.push(player);
					});
				}
			}
			resolve(tabletoperators);
		});
	});
}

function set_player_on_tablet (app, tkey, match_on_court_setup, callback) {	
	
	if(!match_on_court_setup.tabletoperators || match_on_court_setup.tabletoperators.length == 0) {
		return;
	}
	
	const admin = require('./admin'); // avoid dependency cycle	
	app.db.matches.find({'tournament_key': tkey}, async (err, matches) => {
		if (err) {
			callback(err);
		}

		async.each(matches, async (match, cb) => {
			if(match.setup.now_on_court == false) {
				return;
			}
			
			const match_id = match._id;
			let tablet_operatorns_btp_ids = [match_on_court_setup.tabletoperators[0].btp_id];

			if(match_on_court_setup.tabletoperators.length > 1) {
				tablet_operatorns_btp_ids.push(match_on_court_setup.tabletoperators[1].btp_id);
			}

			let change = false;
			
			if (tablet_operatorns_btp_ids.includes(match.setup.teams[0].players[0].btp_id)) {
				match.setup.teams[0].players[0].now_tablet_on_court = match_on_court_setup.court_id;
				match.setup.teams[0].players[0].checked_in = false;
				change = true;
			}

			if (match.setup.teams[0].players.length > 1 && tablet_operatorns_btp_ids.includes(match.setup.teams[0].players[1].btp_id)) {
				match.setup.teams[0].players[1].now_tablet_on_court = match_on_court_setup.court_id;
				match.setup.teams[0].players[1].checked_in = false;
				change = true;
			}

			if (tablet_operatorns_btp_ids.includes(match.setup.teams[1].players[0].btp_id)) {
				match.setup.teams[1].players[0].now_tablet_on_court = match_on_court_setup.court_id;
				match.setup.teams[1].players[0].checked_in = false;
				change = true;
			}

			if (match.setup.teams[1].players.length > 1 && tablet_operatorns_btp_ids.includes(match.setup.teams[1].players[1].btp_id)) {
				match.setup.teams[1].players[1].now_tablet_on_court = match_on_court_setup.court_id;
				match.setup.teams[1].players[1].checked_in = false;
				change = true;
			}

			if (change) {
				const setup = match.setup;
				const match_q = {_id: match_id};
				app.db.matches.update(match_q, {$set: {setup}}, {}, (err) => {
					if (err) return callback(err);
					admin.notify_change(app, match.tournament_key, 'update_player_status', {match__id: match._id,
																							btp_winner: match.btp_winner, 
																							setup: match.setup});
				});
			}
		});

		callback(null);
	});
}


function set_player_on_court (app, tkey, match_on_court_setup, callback) {	
	const admin = require('./admin'); // avoid dependency cycle	
	app.db.matches.find({'tournament_key': tkey}, async (err, matches) => {
		if (err) {
			callback(err);
		}

		async.each(matches, async (match, cb) => {
			if(match.setup.now_on_court == false) {
				return;
			}
			
			const match_id = match._id;
			let on_court_btp_ids = [match_on_court_setup.teams[0].players[0].btp_id, 
						   			match_on_court_setup.teams[1].players[0].btp_id];

			if(match_on_court_setup.teams[0].players.length > 1) {
				on_court_btp_ids.push(match_on_court_setup.teams[0].players[1].btp_id);
			}
			
			if(match_on_court_setup.teams[1].players.length > 1) {
				on_court_btp_ids.push(match_on_court_setup.teams[1].players[1].btp_id);
			}

			let change = false;
			
			if (on_court_btp_ids.includes(match.setup.teams[0].players[0].btp_id)) {
				match.setup.teams[0].players[0].now_playing_on_court = match_on_court_setup.court_id;
				change = true;
			}

			if (match.setup.teams[0].players.length > 1 && on_court_btp_ids.includes(match.setup.teams[0].players[1].btp_id)) {
				match.setup.teams[0].players[1].now_playing_on_court = match_on_court_setup.court_id;
				change = true;
			}

			if (on_court_btp_ids.includes(match.setup.teams[1].players[0].btp_id)) {
				match.setup.teams[1].players[0].now_playing_on_court = match_on_court_setup.court_id;
				change = true;
			}

			if (match.setup.teams[1].players.length > 1 && on_court_btp_ids.includes(match.setup.teams[1].players[1].btp_id)) {
				match.setup.teams[1].players[1].now_playing_on_court = match_on_court_setup.court_id;
				change = true;
			}
			if (change) {
				const setup = match.setup;
				const match_q = {_id: match_id};
				app.db.matches.update(match_q, {$set: {setup}}, {}, (err) => {
					if (err) return callback(err);

					admin.notify_change(app, match.tournament_key, 'update_player_status', {match__id: match._id,
																							btp_winner: match.btp_winner, 
																							setup: match.setup});
				});
			}
		});

		callback(null);
	});
}


function fetch(app, tkey, response, callback) {
	let btp_state;
	try {
		btp_state = btp_parse.get_btp_state(response);
	} catch (e) {
		return callback(e);
	}

	async.waterfall([
		cb => integrate_btp_settings(app, tkey, btp_state, cb),
		cb => integrate_umpires(app, tkey, btp_state, cb),
		cb => integrate_courts(app, tkey, btp_state, cb),
		(court_map, cb) => integrate_matches(app, tkey, btp_state, court_map, cb),
		cb => integrate_now_on_court(app, tkey, cb),
	], callback);
}

module.exports = {
	calculate_match_ids_on_court,
	craft_match,
	date_str,
	fetch,
	time_str,
	// test only
	_integrate_umpires: integrate_umpires,
};
