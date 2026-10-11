'use strict';

const assert = require('assert');
const database = require('../bts/database');
const bup = require('../bts/bupws_v2');
const admin = require('../bts/admin');
const queue = require('../bts/device_info/background');

async function fixture() {
	const db = await database.init_test(), app = { db };
	const insert = (store, doc) => new Promise((resolve, reject) => store.insert(doc, err => err ? reject(err) : resolve()));
	await insert(db.tournaments, { key: 'background-test', bupws_v2_enabled: true });
	await insert(db.courts, { _id: 'court', tournament_key: 'background-test', match_id: 'match' });
	await insert(db.matches, { _id: 'match', tournament_key: 'background-test', network_score: [[0, 0]],
		setup: { match_id: 'match', court_id: 'court', now_on_court: true, state: 'oncourt', counting: '3x21', teams: [{ players: [] }, { players: [] }] } });
	const ws = { readyState: 1, client_id: 'background-tablet', hostname: 'known-host', court_id: 'court',
		messages: [], send(raw) { this.messages.push(JSON.parse(raw)); }, sendmsg(msg) { this.messages.push(msg); } };
	bup.on_connect(app, ws); ws.panel_devicemode = 'umpire'; ws.last_tournament_key = 'background-test'; ws.last_v2_match_id = 'match';
	const score = (point, battery) => bup.handle_score_update(app, ws, { tournament_key: 'background-test', score: {
		match_id: 'match', court_id: 'court', network_score: [[point, 0]], presses: [], device: { battery },
		debug_trace_id: 'background-' + point,
	} });
	return { app, ws, score };
}

describe('device metadata outside score locks', function() {
	let previous, current, notify;
	beforeEach(function() { previous = process.env.BTS_DEVICE_INFO_BACKGROUND; process.env.BTS_DEVICE_INFO_BACKGROUND = '1'; notify = admin.notify_change; });
	afterEach(async function() {
		if (current) {
			await queue.idle(current.app.db, current.ws.client_id);
			current.ws.readyState = 3; bup.on_close(current.app, current.ws); current = null;
		}
		admin.notify_change = notify;
		if (previous === undefined) delete process.env.BTS_DEVICE_INFO_BACKGROUND; else process.env.BTS_DEVICE_INFO_BACKGROUND = previous;
	});
	it('finishes and accepts subsequent points while metadata waits, then coalesces to the latest battery', async function() {
		current = await fixture();
		let release;
		current.ws.hostname = new Promise(resolve => { release = resolve; });
		const batteries = [];
		admin.notify_change = (app, tkey, type, value) => {
			if (type === 'display_status_changed') batteries.push(value.display_court_displaysetting.battery);
		};
		try {
			await current.score(1, 11);
			await new Promise(resolve => setImmediate(resolve));
			await current.score(2, 22); await current.score(3, 33);
			assert.strictEqual(current.ws.battery, 33);
			assert.deepStrictEqual((await current.app.db.matches.findOne_async({ _id: 'match' })).network_score, [[3, 0]]);
			assert.deepStrictEqual(batteries, []);
		} finally { release('resolved-host'); }
		await queue.idle(current.app.db, current.ws.client_id);
		assert.deepStrictEqual(batteries, [11, 33]);
		assert.strictEqual((await current.app.db.display_court_displaysettings.find_async({ client_id: current.ws.client_id })).length, 1);
	});
	it('keeps existing battery information when a score carries no device metadata', async function() {
		current = await fixture(); current.ws.battery = 55;
		const statuses = [];
		admin.notify_change = (app, tkey, type) => { if (type === 'display_status_changed') statuses.push(type); };
		await bup.handle_score_update(current.app, current.ws, { tournament_key: 'background-test', score: {
			match_id: 'match', court_id: 'court', network_score: [[1, 0]], presses: [],
		} });
		await queue.idle(current.app.db, current.ws.client_id);
		assert.strictEqual(current.ws.battery, 55);
		assert.strictEqual(statuses.length, 0);
		assert.deepStrictEqual((await current.app.db.matches.findOne_async({ _id: 'match' })).network_score, [[1, 0]]);
	});
	it('reports optional metadata failure separately without rejecting a saved point', async function() {
		current = await fixture();
		const original_read = current.app.db.display_court_displaysettings.findOne_async;
		current.app.db.display_court_displaysettings.findOne_async = async () => { throw new Error('metadata unavailable'); };
		const warn = console.warn, failures = [];
		console.warn = value => { if (value.startsWith('[bts] device_info:background_error')) failures.push(value); };
		try {
			await current.score(1, 44); await queue.idle(current.app.db, current.ws.client_id);
			assert.strictEqual(failures.length, 1);
			assert(!current.ws.messages.some(msg => msg.type === 'error'));
			assert.deepStrictEqual((await current.app.db.matches.findOne_async({ _id: 'match' })).network_score, [[1, 0]]);
		} finally { console.warn = warn; current.app.db.display_court_displaysettings.findOne_async = original_read; }
	});
	it('does not announce a closed connection as online after delayed hostname resolution', async function() {
		current = await fixture();
		let release;
		current.ws.hostname = new Promise(resolve => { release = resolve; });
		const online = [];
		admin.notify_change = (app, tkey, type, value) => { if (type === 'display_status_changed') online.push(value); };
		await current.score(1, 55); await new Promise(resolve => setImmediate(resolve));
		current.ws.readyState = 3; release('late-host');
		await queue.idle(current.app.db, current.ws.client_id);
		assert.strictEqual(online.length, 0);
	});
});
