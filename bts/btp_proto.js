'use strict';
const assert = require('assert');
const zlib = require('zlib');
const xmldom = require('xmldom');
const serror = require('./serror');
const calc = require('../static/bup/dev/js/calc');

function resolve_current_now_ms(options = {}) {
	const normalized = Number(options.current_now_ms);
	return Number.isFinite(normalized) ? normalized : Date.now();
}

function reached_score_from_match(match) {
	const presses = Array.isArray(match?.presses) ? match.presses : [];
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
		console.error('[btp] failed to derive reached score for special score status', err);
		return null;
	}
}

function get_info_request(password) {
	const res = {
		Header: {
			Version: {
				Hi: 1,
				Lo: 1,
			},
		},
		Action: {
			ID: 'SENDTOURNAMENTINFO',
		},
		Client: {
			IP: 'bts',
		},
	};
	if (password) {
		res.Action.Password = password;
	}
	return res;
}

function login_request(password) {
	const res = {
		Header: {
			Version: {
				Hi: 1,
				Lo: 1,
			},
		},
		Action: {
			ID: 'LOGIN',
		},
		Client: {
			IP: 'bts',
		},
	};
	if (password) {
		res.Action.Password = password;
	}
	return res;
}

function update_request(match, key_unicode, password, umpire_btp_id, service_judge_btp_id, court_btp_id, options = {}) {
	assert(key_unicode);
	const write_match_check_in_status = options.write_match_check_in_status !== false;
	const current_now_ms = resolve_current_now_ms(options);
	const matches = [];
	const res = {
		Header: {
			Version: {
				Hi: 1,
				Lo: 1,
			},
		},
		Action: {
			ID: 'SENDUPDATE',
			Unicode: key_unicode,
		},
		Client: {
			IP: 'bts',
		},
		Update: {
			Tournament: {
				Matches: matches
			},
		},
	};
	if (password) {
		res.Action.Password = password;
	}

	assert(match.btp_match_ids);
	assert(match.btp_match_ids.length > 0);
	const shuttle_count = match.shuttle_count;
	const presses = Array.isArray(match.presses) ? match.presses : [];
	const score_status_by_name = {
		normal: 0,
		walkover: 1,
		retired: 2,
		disqualified: 3,
		no_match: 4,
	};
	const normalize_score_status = () => {
		if (score_status_by_name[match.score_status] != null) {
			return score_status_by_name[match.score_status];
		}
		if (Number.isFinite(Number(match.btp_score_status))) {
			return Number(match.btp_score_status);
		}
		for (let i = presses.length - 1; i >= 0 && i >= presses.length - 4; i--) {
			if (presses[i]?.type == "retired") {
				return 2; // retired
			}
			if (presses[i]?.type == "disqualified") {
				return 3; // disqualified
			}
		}
		return 0;
	};

	for (const btp_m_id of match.btp_match_ids) {
		assert(btp_m_id);
		const score_status = normalize_score_status();

		//TODO: calc Status;

		const m = {
			ID: btp_m_id.id,
			DrawID: btp_m_id.draw,
			PlanningID: btp_m_id.planning,
			Status: 0,
			Highlight: (match.setup.highlight ? match.setup.highlight : 0),
			MatchOrder: match.match_order,
			// BTP also sends a boolean ScoreSheetPrinted here
		};

		if(typeof match.team1_won === 'boolean') {
			m.Winner = match.team1_won ? 1 : 2;
		
			const duration_mins = match.duration_ms ? Math.floor(match.duration_ms / 60000) : 0;
			m.Duration = duration_mins;

			const special_status_uses_reached_score = score_status === 2 || score_status === 3;
			const result_score = Array.isArray(match.score_status_network_score)
				? match.score_status_network_score
				: (special_status_uses_reached_score ? reached_score_from_match(match) : null) || match.network_score;
			if(result_score) {
				const sets = result_score.map(ns => {
					return {
						Set: {
							T1: ns[0],
							T2: ns[1],
						},
					};
				});

				m.Sets = sets;
			}

			m.ScoreStatus = score_status;
			if (match.forward_loser === true || btp_m_id.forward_loser === true) {
				m.ForwardLoser = true;
			}
		}
		if (score_status !== 0 && m.ScoreStatus == null) {
			m.ScoreStatus = score_status;
			if (match.forward_loser === true || btp_m_id.forward_loser === true) {
				m.ForwardLoser = true;
			}
		}

		if (umpire_btp_id) {
			m.Official1ID = umpire_btp_id;
		}
		if (service_judge_btp_id) {
			m.Official2ID = service_judge_btp_id;
		}
		if (court_btp_id) {
			m.CourtID = court_btp_id;
		}
		if (shuttle_count) {
			m.Shuttles = shuttle_count;
		}


		if (write_match_check_in_status && Array.isArray(match?.setup?.teams) && match.setup.teams.length > 1) {
			const team0_players = Array.isArray(match.setup.teams[0]?.players) ? match.setup.teams[0].players : [];
			const team1_players = Array.isArray(match.setup.teams[1]?.players) ? match.setup.teams[1].players : [];
			if (team0_players.length > 0 && team0_players[0].checked_in) {
				m.Status = m.Status | 0b0001;
			}

			if(team0_players.length > 1 &&  team0_players[1].checked_in) {
				m.Status = m.Status | 0b0010;
			}

			if (team1_players.length > 0 && team1_players[0].checked_in) {
				m.Status = m.Status | 0b0100;
			}

			if(team1_players.length > 1 &&  team1_players[1].checked_in) {
				m.Status = m.Status | 0b1000;
			}
		}

		matches.push({Match: m});
	}

	if (match.btp_player_ids && match.end_ts && (match.end_ts + 300000 > current_now_ms)) {
		const players = [];
		res.Update.Tournament.Players = players;
		const end_date = new Date(match.end_ts);

		for (const pid of match.btp_player_ids) {
			const pupdate = {
				ID: pid,
				LastTimeOnCourt: end_date,
				CheckedIn: false,
			};
			players.push({Player: pupdate});
		}

	}
	return res;
}

function update_players_request(players, key_unicode, password) {
	assert(key_unicode);
	const res = {
		Header: {
			Version: {
				Hi: 1,
				Lo: 1,
			},
		},
		Action: {
			ID: 'SENDUPDATE',
			Unicode: key_unicode,
		},
		Client: {
			IP: 'bts',
		},
		Update: {
			Tournament: {
			},
		},
	};
	if (password) {
		res.Action.Password = password;
	}

	const btp_players = [];
	res.Update.Tournament.Players = btp_players;

	players.forEach((player) => {
		if (player.btp_id) {
			const pupdate = {
				ID: player.btp_id,
			};

			if (player.checked_in !== undefined) {
				pupdate.CheckedIn = player.checked_in;
			}
			
			if (player.last_time_on_court_ts) {
				const end_date = new Date(player.last_time_on_court_ts);

				pupdate.LastTimeOnCourt = end_date;
			}
			btp_players.push({Player: pupdate});
		}
	});
	return res;
}

function update_stage_entries_request(stage_entries, key_unicode, password) {
	assert(key_unicode);
	const stage_entries_list = [];
	const res = {
		Header: {
			Version: {
				Hi: 1,
				Lo: 1,
			},
		},
		Action: {
			ID: 'SENDUPDATE',
			Unicode: key_unicode,
		},
		Client: {
			IP: 'bts',
		},
		Update: {
			Tournament: {
				StageEntries: stage_entries_list,
			},
		},
	};
	if (password) {
		res.Action.Password = password;
	}

	assert(stage_entries);
	assert(stage_entries.length > 0);
	for (const stage_entry of stage_entries) {
		const update = {};
		for (const field of ['ID', 'StageID', 'EntryID', 'Status', 'Seed1', 'Seed2']) {
			if (stage_entry[field] != null) {
				update[field] = stage_entry[field];
			}
		}
		stage_entries_list.push({StageEntry: update});
	}
	return res;
}

function update_courts_request(courts, key_unicode, password){
	assert(key_unicode);
	const courts_list = [];
	const res = {
		Header: {
			Version: {
				Hi: 1,
				Lo: 1,
			},
		},
		Action: {
			ID: 'SENDUPDATE',
			Unicode: key_unicode,
		},
		Client: {
			IP: 'bts',
		},
		Update: {
			Tournament: {
				Courts: courts_list,
			},
		},
	};

	if (password) {
		res.Action.Password = password;
	}

	assert(courts);
	assert(courts.length > 0);

	for (const court of courts) {
		assert(court.btp_id);

		if (court.btp_id){
		 	const c = {
		 		ID: court.btp_id
		 	}

			if(court.btp_match_id){
				c.MatchID = court.btp_match_id;
			}

		 	courts_list.push({Court: c});
		}
	}

	return res;
}


function el2obj(el) {
	const res = {};
	for (let i = 0;i < el.childNodes.length;i++) {
		const c = el.childNodes[i];
		if (c.nodeType === c.TEXT_NODE) {
			// Whitespace in indented XML
			assert(/^\s*$/.test(c.data));
			continue;
		}
		let item;

		if (c.tagName === 'GROUP') {
			item = el2obj(c);
		} else if (c.tagName === 'ITEM') {
			const itype = c.getAttribute('TYPE');
			if (itype === 'String') {
				item = c.textContent;
			} else if (itype === 'Integer') {
				item = parseInt(c.textContent);
			} else if (itype === 'Float') {
				item = parseFloat(c.textContent);
			} else if (itype === 'Bool') {
				item = c.textContent === 'true';
			} else if (itype === 'DateTime') {
				const dt = c.getElementsByTagName('DATETIME')[0];
				item = {
					_type: 'datetime',
					year: parseInt(dt.getAttribute('Y')),
					month: parseInt(dt.getAttribute('MM')),
					day: parseInt(dt.getAttribute('D')),
					hour: parseInt(dt.getAttribute('H')),
					minute: parseInt(dt.getAttribute('M')),
					second: parseInt(dt.getAttribute('S')),
					ms: parseInt(dt.getAttribute('MS')),
				};
			} else {
				throw new Error('Unsupported BTP item type ' + itype);
			}
		} else {
			throw new Error('Unsupported BTP tag ' + c.tagName);
		}

		const id = c.getAttribute('ID');
		if (!res[id]) {
			res[id] = [];
		}
		res[id].push(item);
	}
	return res;
}

function _req2xml_add(doc, parent, obj, timeZone) {
	for (const k in obj) {
		const v = obj[k];

		let node;
		if (Array.isArray(v)) {
			node = doc.createElement('GROUP');
			for (const el of v) {
				_req2xml_add(doc, node, el, timeZone);
			}
		} else if (v instanceof Date) {
			node = doc.createElement('ITEM');
			node.setAttribute('TYPE', 'DateTime');

			// Convert to specific timezone
			let date = v;
			if (timeZone && timeZone !== 'system') {
				date = new Date(new Intl.DateTimeFormat('sv', {
					timeZone, dateStyle: 'short', timeStyle: 'medium'
				}).format(v));
				date.setMilliseconds(v.getMilliseconds());
			}

			const dt = doc.createElement('DATETIME');
			dt.setAttribute('Y', date.getFullYear());
			dt.setAttribute('MM', date.getMonth() + 1);
			dt.setAttribute('D', date.getDate());
			dt.setAttribute('H', date.getHours());
			dt.setAttribute('M', date.getMinutes());
			dt.setAttribute('S', date.getSeconds());
			dt.setAttribute('MS', date.getMilliseconds());
			node.appendChild(dt);
		} else if (typeof v === 'object') {
			node = doc.createElement('GROUP');
			_req2xml_add(doc, node, v, timeZone);
		} else if (typeof v === 'string') {
			node = doc.createElement('ITEM');
			node.setAttribute('TYPE', 'String');
			node.appendChild(doc.createTextNode(v));
		} else if (typeof v === 'number') {
			node = doc.createElement('ITEM');
			node.setAttribute('TYPE', 'Integer');
			node.appendChild(doc.createTextNode(v));
		} else if (typeof v === 'boolean') {
			node = doc.createElement('ITEM');
			node.setAttribute('TYPE', 'Bool');
			node.appendChild(doc.createTextNode(v));
		} else {
			throw new Error('Cannot encode type ' + typeof v);
		}
		node.setAttribute('ID', k);
		parent.appendChild(node);
	}
}

function req2xml(req, timeZone) {
	const doci = new xmldom.DOMImplementation();
	const doc = doci.createDocument(null, 'VISUALXML');
	const root_node = doc.documentElement;
	root_node.setAttribute('VERSION', '1.0');

	_req2xml_add(doc, root_node, req, timeZone);

	const serializer = new xmldom.XMLSerializer();
	const xml_str = '<?xml version="1.0" encoding="UTF-8"?>' + serializer.serializeToString(doc);
	return xml_str;
}

function encode(req, timeZone) {
	const xml_str = req2xml(req, timeZone);
	return encode_xml(xml_str);
}

function encode_xml(xml_str) {
	const xml_buf = Buffer.from(xml_str, 'utf8');
	const compressed_request = zlib.gzipSync(xml_buf, {});

	const byte_len = compressed_request.length;
	const request_header = Buffer.alloc(4);
	request_header.writeInt32BE(byte_len, 0);
	const whole_req = Buffer.concat([request_header, compressed_request]);

	return whole_req;
}

function decode_string(buf, callback) {
	if (buf.length < 4) {
		return callback(new Error('Got only ' + buf.length + ' bytes'));
	}

	const expect_len = buf.readInt32BE(0);
	if (buf.length - 4 !== expect_len) {
		return callback(new Error('Expected a message of 4+' + expect_len + ' Bytes, but got ' + buf.length));
	}

	const main_buf = buf.slice(4);
	const response_buf = zlib.gunzipSync(main_buf, {});
	callback(null, response_buf.toString('utf8'));
}

function decode(buf, callback) {
	assert(callback);
	decode_string(buf, (err, response_str) => {
		if (err) return callback(err);
		const parser = new xmldom.DOMParser();

		var response;
		try {
			const doc = parser.parseFromString(response_str);
			response = el2obj(doc.documentElement);
		} catch(err) {
			serror.silent('Encountered an error while parsing BTP message: ' + err.message);
			callback(err);
			return;
		}

		callback(null, response);
	});
}

module.exports = {
	decode,
	decode_string,
	encode,
	encode_xml,
	el2obj,
	get_info_request,
	login_request,
	update_request,
	update_players_request,
	update_stage_entries_request,
	update_courts_request,
	// Tests only
	_req2xml: req2xml,
};
