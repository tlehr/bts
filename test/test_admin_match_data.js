'use strict';

const assert = require('assert');
const database = require('../bts/database');
const { promisify } = require('util');
const admin = require('../bts/admin');
const { read_matches } = require('../bts/admin_match_data');

const read = (db, defer = true) => new Promise((resolve, reject) => read_matches(db, 'default', defer,
	(error, matches) => error ? reject(error) : resolve(matches)));
const insert = (store, documents) => promisify(store.insert.bind(store))(documents);
const request = (handler, app, msg) => new Promise((resolve, reject) => handler(app,
	{ respond(_msg, error, response) { error ? reject(error) : resolve(response); } }, msg));

async function fixture() {
	const db = await database.init_test();
	await insert(db.tournaments, { key: 'default', name: 'Test' });
	await insert(db.matches, [
		{ _id: 'finished', tournament_key: 'default', setup: { state: 'finished', now_on_court: false },
			presses: [{ type: 'point', timestamp: 100 }], network_score: [[21, 10]], team1_won: true, btp_winner: 1, end_ts: 200 },
		{ _id: 'active', tournament_key: 'default', setup: { state: 'oncourt', now_on_court: true },
			presses: [{ type: 'pick_side', timestamp: 100 }], network_score: [[0, 0]] },
		{ _id: 'preparation', tournament_key: 'default', setup: { state: 'preparation' }, presses: [{ type: 'warmup', timestamp: 100 }] },
		{ _id: 'reactivated', tournament_key: 'default', setup: { state: 'finished', now_on_court: true }, presses: [{ type: 'point' }] },
		{ _id: 'bye', tournament_key: 'default', setup: { state: 'finished' }, score_status: 'no_match', presses: [] },
		{ _id: 'foreign', tournament_key: 'other', setup: { state: 'finished' }, presses: [{ type: 'point' }] },
	]);
	return { db, wss: { clients: [] }, clock: { now_ms: () => 1234, get_state: () => ({ now_ms: 1234 }) } };
}

describe('admin match overview and deferred history', function() {
	it('releases the executor while copying a committed immutable snapshot in the background', async function() {
		const { db } = await fixture();
		const previous = process.env.BTS_ADMIN_RESPONSE_BACKGROUND, immediate = global.setImmediate;
		process.env.BTS_ADMIN_RESPONSE_BACKGROUND = '1';
		let copy;
		global.setImmediate = (fn, ...args) => fn.name === 'copy' ? (copy = fn) : immediate(fn, ...args);
		try {
			const pending = read(db);
			while (!copy) await new Promise(resolve => setTimeout(resolve, 1));
			await db.matches.update_async({ _id: 'active' }, { $set: { 'setup.state': 'finished', 'setup.now_on_court': false, presses: [{ type: 'postmatch-confirm' }] } }, {});
			copy();
			const snapshot = (await pending).find(match => match._id === 'active');
			assert.strictEqual(snapshot.setup.state, 'oncourt');
			assert.deepStrictEqual(snapshot.presses, [{ type: 'pick_side', timestamp: 100 }]);
			snapshot.setup.state = 'edited';
			assert.strictEqual(db.model.tournament('default').matches.get('active').data.setup.state, 'finished');
		} finally {
			global.setImmediate = immediate;
			if (previous === undefined) delete process.env.BTS_ADMIN_RESPONSE_BACKGROUND; else process.env.BTS_ADMIN_RESPONSE_BACKGROUND = previous;
		}
	});
	it('detaches records, keeps scores and all live histories, and never changes canonical objects', async function() {
		const { db } = await fixture();
		const canonical = db.model.tournament('default').matches.get('finished');
		const full = await read(db, false), light = await read(db);
		assert.strictEqual(light.length, 5);
		for (const original of full) {
			const result = light.find(m => m._id === original._id);
			if (original._id === 'finished') {
				const expected = { ...original, presses_deferred: true };
				delete expected.presses;
				assert.deepStrictEqual(result, expected);
			} else assert.deepStrictEqual(result, original);
		}
		light[0].setup.state = 'changed';
		light.find(m => m._id === 'active').presses[0].type = 'changed';
		assert.deepStrictEqual(await read(db, false), full);
		assert.strictEqual(db.model.tournament('default').matches.get('finished'), canonical);
		assert.deepStrictEqual(canonical.data.presses, [{ type: 'point', timestamp: 100 }]);
	});

	it('captures behind pending persistence and includes committed edits, inserts and removals', async function() {
		const { db } = await fixture();
		const persist = db.matches.persistence.persistNewState;
		let release, started;
		const began = new Promise(resolve => { started = resolve; });
		db.matches.persistence.persistNewState = function(documents, callback) {
			release = () => persist.call(this, documents, callback);
			started();
		};
		const update = db.matches.update_async({ _id: 'finished' }, { $set: { network_score: [[21, 15]] } }, {});
		await began;
		let observed = false;
		const pending = read(db).then(matches => { observed = true; return matches; });
		await new Promise(resolve => setImmediate(resolve));
		assert.strictEqual(observed, false);
		release();
		await update;
		assert.deepStrictEqual((await pending).find(m => m._id === 'finished').network_score, [[21, 15]]);
		db.matches.persistence.persistNewState = persist;
		await db.matches.remove_async({ _id: 'finished' }, {});
		await insert(db.matches, { _id: 'new', tournament_key: 'default', setup: { state: 'scheduled' } });
		const after = await read(db);
		assert(!after.some(m => m._id === 'finished'));
		assert(after.some(m => m._id === 'new'));
	});

	it('uses the full legacy response unless a client explicitly opts in, and fetches a scoped full history', async function() {
		const app = await fixture();
		const full = await request(admin.handle_tournament_get, app, { key: 'default' });
		const light = await request(admin.handle_tournament_get, app, { key: 'default', defer_finished_history: true });
		assert.deepStrictEqual(full.tournament.matches, await read(app.db, false));
		assert.strictEqual(light.tournament.matches.find(m => m._id === 'finished').presses, undefined);
		assert.deepStrictEqual(await request(admin.handle_match_history_get, app, { tournament_key: 'default', match_id: 'finished' }),
			{ tournament_key: 'default', match_id: 'finished', presses: [{ type: 'point', timestamp: 100 }] });
		assert.deepStrictEqual((await request(admin.handle_match_history_get, app, { tournament_key: 'default', match_id: 'bye' })).presses, []);
		await assert.rejects(request(admin.handle_match_history_get, app, { tournament_key: 'default', match_id: 'foreign' }), /not found/);
		await assert.rejects(request(admin.handle_match_history_get, app, { tournament_key: 'default' }), /Missing/);
	});

	it('keeps full histories available to the bulk scoresheet export', async function() {
		const app = await fixture();
		await request(admin.handle_tournament_get, app, { key: 'default', defer_finished_history: true });
		const export_data = await request(admin.handle_fetch_allscoresheets_data, app, { tournament_key: 'default' });
		assert.deepStrictEqual(export_data.matches.find(m => m._id === 'finished').presses, [{ type: 'point', timestamp: 100 }]);
	});
});
