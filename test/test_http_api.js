'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const http_api = require('../bts/http_api');

describe('HTTP match information', function() {
	it('uses the request application after asynchronous database reads and preserves its clock conversion', async function() {
		const db = await database.init_test();
		await promisify(db.tournaments.insert.bind(db.tournaments))({
			key: 'info-test', name: 'Match information test', logo_id: 'fixture.png',
		});
		const presses = [{ type: 'love-all', timestamp: 1500 }];
		await promisify(db.matches.insert.bind(db.matches))({
			_id: 'info-match', tournament_key: 'info-test', presses,
			network_score: [[21, 19]], end_ts: 2000,
			setup: {
				match_num: 231, called_timestamp: 1000,
				teams: [{ players: [{ name: 'First Player', firstname: 'First', lastname: 'Player' }] },
					{ players: [{ name: 'Second Player', firstname: 'Second', lastname: 'Player' }] }],
			},
		});
		const app = { db, clock: { to_real_ts: timestamp => timestamp + 60000 } }, headers = {};
		const response = await new Promise(resolve => http_api.matchinfo_handler({
			app, params: { tournament_key: 'info-test', match_id: 'info-match' },
		}, {
			header(name, value) { headers[name] = value; },
			send(body) { resolve(JSON.parse(body)); },
			json(body) { resolve(body); },
		}));
		assert.strictEqual(response.status, 'ok');
		assert.strictEqual(headers['Content-Type'], 'application/json');
		assert.strictEqual(response.event.id, 'bts_info-test');
		assert.strictEqual(response.event.matches.length, 1);
		const match = response.event.matches[0];
		assert.strictEqual(match.setup.match_id, 'bts_info-match');
		assert.strictEqual(match.setup.called_timestamp, 61000);
		assert.strictEqual(match.end_ts, 62000);
		assert.deepStrictEqual(match.network_score, [[21, 19]]);
		assert.deepStrictEqual(match.presses, presses);
		assert.strictEqual(match.presses_json, undefined);
	});
});
