'use strict';

const crypto = require('crypto');
const NOW = Date.parse('2026-10-24T10:00:00Z');
const TABLES = ['courts', 'locations', 'event', 'matches', 'tournaments', 'umpires', 'logs', 'tabletoperators',
	'displaysettings', 'display_court_displaysettings', 'normalizations', 'advertisements', 'app_settings'];

function fixture(count = 373) {
	const data = Object.fromEntries(TABLES.map(name => [name, []]));
	data.locations = [{ _id: 'hall', tournament_key: 'default', name: 'Testhalle', preparation_addition: 'in der Testhalle',
		meetingpoint_announcement: 'Bitte {melde dich/meldet euch} bei der Turnierleitung!' }];
	data.courts = Array.from({ length: 13 }, (_, i) => ({ _id: 'court-' + (i + 1), tournament_key: 'default', num: i + 1,
		name: String(i + 1), is_active: true, location_id: 'hall', match_id: 'game-' + (i + 1) }));
	data.matches = Array.from({ length: count }, (_, i) => ({ _id: 'game-' + (i + 1), tournament_key: 'default', match_order: i + 1,
		network_score: [[0, 0]], network_team1_left: true, presses: [], setup: { match_id: 'game-' + (i + 1), is_match: true,
			court_id: i < 13 ? 'court-' + (i + 1) : null, location_id: 'hall', state: i < 13 ? 'oncourt' : 'scheduled',
			now_on_court: i < 13, called_timestamp: NOW - 10000, counting: '3x21', warmup: 'none',
			event_name: 'MX U17', match_name: 'VF', match_num: i + 1, is_doubles: true,
			teams: [0, 1].map(side => ({ players: [0, 1].map(player => ({
				name: ['Max Mustermann', 'Erika Musterfrau', 'Hans Dampf', 'Lisa Beispiel'][side * 2 + player] + ' ' + (i + 1),
				btp_id: i * 4 + side * 2 + player + 1, checked_in: true,
			})) })),
		} }));
	data.tournaments = [{ _id: 'fixture', key: 'default', name: 'Isolierter Sprachlastvergleich', language: 'de',
		btp_enabled: false, bupws_v2_enabled: true, official_rotation_mode: 'disabled',
		call_preparation_matches_automatically_enabled: false, call_matches_on_free_courts_automatically_enabled: false,
		annoncement_include_event: true, annoncement_include_round: true, annoncement_include_matchnumber: true,
		preparation_meetingpoint_enabled: true, announcement_speech_voice: 'hallensprecher',
		events: { events: [{ id: 'mx-u17', name: 'MX U17', is_drawn: true, stages: [{ id: 'stage', stage_type: 1,
			entries: data.matches.flatMap(match => match.setup.teams.map((team, side) => ({ entry_id: match._id + '-' + side, team }))),
		}] }] } }];
	data.display_court_displaysettings = data.courts.flatMap(court => ['tv', 'tablet'].map(role => ({
		_id: role + '-' + court._id, client_id: role + '-' + court._id, hostname: role + '-' + court._id,
		court_id: court._id, panel_devicemode: role === 'tv' ? 'display' : 'umpire',
	})));
	return data;
}

function score(index) {
	const court = index % 13 + 1, rally = Math.floor(index / 13) + 1;
	const points = [rally % 20 + 1, Math.floor(rally / 20) % 20];
	// Deliberate alternating score states keep the same thirteen matches on
	// court. This isolates publication, not a complete rally/finish simulation.
	return { court_id: 'court-' + court, match_id: 'game-' + court, network_team1_left: true,
		network_score: [points],
		presses: [
			{ type: 'pick_side', team1_left: true, timestamp: NOW - 180000 },
			{ type: 'pick_server', team_id: 0, player_id: 0, timestamp: NOW - 179000 },
			{ type: 'pick_receiver', team_id: 1, player_id: 0, timestamp: NOW - 178000 },
			{ type: 'love-all', timestamp: NOW - 177000 },
			...Array.from({ length: 175 }, (_, i) => ({ type: 'note', text: 'Synthetischer Verlauf', timestamp: NOW - 176000 + i * 1000 })),
			{ type: 'editmode_set-score', score: points, resumed: true, timestamp: NOW },
		],
		duration_ms: rally * 1000, device: { battery: 80 }, debug_trace_id: 'speech-load-' + index };
}
const digest = data => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
module.exports = { fixture, score, digest, TABLES, NOW };
