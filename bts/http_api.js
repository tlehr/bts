'use strict';

const assert = require('assert');
const path = require('path');
const utils = require('./utils');
const bupws = require('./bupws');
const calc = require('../static/bup/dev/js/calc.js');

const DISPLAY_PREVIEW_SETUP = Object.freeze({
	match_id: 'tdemo_match_42',
	match_num: 42,
	counting: '3x21',
	match_name: 'Finale',
	event_name: 'MX O55',
	umpire_name: 'Ulli Unparteiisch',
	service_judge_name: '',
	court_id: 'tdemo_5',
	is_doubles: true,
	team_competition: false,
	teams: [
		{
			name: 'TV Musterstadt',
			players: [
				{ name: 'Max Emil Mustermann', firstname: 'Max', middlename: 'Emil', lastname: 'Mustermann', nationality: 'GER' },
				{ name: 'Lena Beispiel', firstname: 'Lena', middlename: '', lastname: 'Beispiel', nationality: 'GER' },
			],
		},
		{
			name: 'BC Beispielheim',
			players: [
				{ name: 'Timo Testfeld', firstname: 'Timo', middlename: '', lastname: 'Testfeld', nationality: 'GER' },
				{ name: 'Mia Sophie Demo', firstname: 'Mia', middlename: 'Sophie', lastname: 'Demo', nationality: 'GER' },
			],
		},
	],
});

function display_preview_full_score_sequence() {
	return [
		[1, 0],
		[1, 1],
		[2, 1],
		[3, 1],
		[3, 2],
		[4, 2],
		[5, 2],
		[5, 3],
		[6, 3],
		[7, 3],
		[8, 3],
		[8, 4],
		[9, 4],
		[10, 4],
		[11, 4],
		[11, 5],
		[12, 5],
		[13, 5],
		[13, 6],
		[14, 6],
		[15, 6],
		[15, 7],
		[16, 7],
		[17, 7],
		[17, 8],
		[18, 8],
		[18, 9],
		[19, 9],
		[20, 9],
		[20, 10],
		[21, 10],
	];
}

function build_display_preview_presses(target_score, last_score_timestamp_ms, now_ms) {
	const sequence = display_preview_full_score_sequence();
	const target_index = sequence.findIndex(score => score[0] === target_score[0] && score[1] === target_score[1]);
	const used_sequence = target_index >= 0 ? sequence.slice(0, target_index + 1) : sequence;
	const fixed_last_score_ts = Number.isFinite(last_score_timestamp_ms) ? last_score_timestamp_ms : null;
	const start_ts = fixed_last_score_ts != null
		? (fixed_last_score_ts - Math.max(used_sequence.length - 1, 0) * 1000 - 1000)
		: (now_ms - (used_sequence.length + 10) * 1000);
	const presses = [{
		type: 'editmode_set-finished_games',
		scores: [[21, 18]],
		by_side: false,
		timestamp: start_ts,
	}, {
		type: 'pick_side',
		team1_left: true,
		timestamp: start_ts + 100,
	}, {
		type: 'pick_server',
		team_id: 0,
		player_id: 0,
		timestamp: start_ts + 200,
	}, {
		type: 'pick_receiver',
		team_id: 1,
		player_id: 0,
		timestamp: start_ts + 300,
	}, {
		type: 'love-all',
		timestamp: start_ts + 400,
	}];
	let previous_score = [0, 0];
	used_sequence.forEach((score, idx) => {
		let side = 'left';
		if (score[1] > previous_score[1]) {
			side = 'right';
		}
		presses.push({
			type: 'score',
			side,
			timestamp: start_ts + 1000 + idx * 1000,
		});
		previous_score = score;
	});
	return presses;
}

function build_display_preview_network_state(setup, target_score, last_score_timestamp_ms, now_ms) {
	const presses = build_display_preview_presses(target_score, last_score_timestamp_ms, now_ms);
	const temp_state = {
		setup,
		metadata: {
			id: setup.match_id,
			start: null,
			end: null,
			updated: now_ms,
		},
	};
	calc.init_state(temp_state, null, presses, true);
	calc.state(temp_state);
	return {
		presses,
		network_score: calc.netscore(temp_state, true),
		network_team1_serving: temp_state.game.team1_serving,
		network_teams_player1_even: temp_state.game.teams_player1_even.slice(),
		network_team0_left: temp_state.game.team1_left,
	};
}

function create_display_preview_event(app, variant) {
	const now_ms = app?.clock ? app.clock.now_ms() : Date.now();
	let target_score = [12, 5];
	let last_score_timestamp_ms = now_ms - 2000;
	if (variant === 'live') {
		target_score = [10, 4];
		last_score_timestamp_ms = now_ms - 1500;
	}
	const setup = JSON.parse(JSON.stringify(DISPLAY_PREVIEW_SETUP));
	const network_state = build_display_preview_network_state(setup, target_score, last_score_timestamp_ms, now_ms);
	return {
		type: 'bup-export',
		version: 2,
		event: {
			staticnet_message: 'BTS Display-Vorschau',
			id: `bts_display_preview_${variant}`,
			tournament_name: 'BTS Display-Vorschau',
			matches: [{
				setup,
				presses_json: JSON.stringify(network_state.presses),
				network_score: network_state.network_score,
				network_team1_serving: network_state.network_team1_serving,
				network_teams_player1_even: network_state.network_teams_player1_even,
				network_team0_left: network_state.network_team0_left,
			}],
			courts: [{
				court_id: 'tdemo_5',
				label: 5,
				match_id: 'tdemo_match_42',
			}],
		},
	};
}

function logo_handler(req, res) {
	const {tournament_key, logo_id} = req.params;
	assert(tournament_key);
	assert(logo_id);
	const filetype = logo_id.split(".")[1];
	const mime = {
		gif: 'image/gif',
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		svg: 'image/svg+xml',
		webp: 'image/webp',
	}[filetype];
	assert(mime, `Unsupported ext ${JSON.stringify(filetype)}`);
	const fn = path.join(utils.root_dir(), 'data', 'logos', path.basename(logo_id));
	res.setHeader('Content-Type', mime);
	res.setHeader('Cache-Control', 'public, max-age=31536000');
	res.sendFile(fn);
}

function matchinfo_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const match_id = req.params.match_id;

	const query = {
		tournament_key,
		_id: match_id,
	};

	req.app.db.fetch_all([{
		collection: 'tournaments',
		query: {key: tournament_key},
	}, {
		collection: 'matches',
		query,
	}], function(err, tournaments, matches) {
		if (err) {
			res.json({
				status: 'error',
				message: err.message,
			});
			return;
		}

		if (tournaments.length !== 1) {
			res.json({
				status: 'error',
				message: 'Cannot find tournament',
			});
			return;
		}

		if (matches.length !== 1) {
			res.json({
				status: 'error',
				message: 'Cannot find match',
			});
			return;
		}

		const [tournament] = tournaments;
		const [match] = matches;
		const event = bupws.create_event_representation(tournament);
		const match_repr = bupws.create_match_representation(req.app, tournament, match);
		if (match_repr.presses_json) {
			// Parse JSON-in-JSON (for performance reasons) for nicer output
			match_repr.presses = JSON.parse(match_repr.presses_json);
			delete match_repr.presses_json;
		}
		event.matches = [match_repr];

		const reply = {
			status: 'ok',
			event,
		};
		res.header('Content-Type', 'application/json');
        res.send(JSON.stringify(reply, null, 4));
	});
}

function display_preview_handler(req, res) {
	const variant = req.params.variant === 'live' ? 'live' : 'primary';
	const reply = create_display_preview_event(req.app, variant);
	res.header('Content-Type', 'application/json');
	res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Expires', '0');
	res.send(JSON.stringify(reply, null, 2));
}


module.exports = {
	logo_handler,
	matchinfo_handler,
	display_preview_handler,
};
