'use strict';

const assert = require('assert');
const { promisify } = require('util');
const fs = require('fs'), os = require('os'), path = require('path');
const Datastore = require('nedb');
const database = require('../bts/database');
const planner = require('../bts/btp_sync_plan');
const turn = () => new Promise(resolve => setImmediate(resolve));

describe('bounded prepared sync commits', function() {
	let directory, db, app;
	beforeEach(async function() {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-bounded-sync-'));
		db = Object.fromEntries(['tournaments', 'locations', 'courts', 'matches', 'umpires', 'tabletoperators'].map(name =>
			[name, new Datastore(name === 'matches' ? { filename: path.join(directory, name) } : { inMemoryOnly: true })]));
		await promisify(db.matches.loadDatabase.bind(db.matches))(); database.setup_helpers(db);
		await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'bounded', btp_enabled: true, btp_readonly: true });
		await promisify(db.matches.insert.bind(db.matches))(Array.from({ length: 9 }, (_, i) => ({
			_id: 'game-' + i, tournament_key: 'bounded', presses: [{ type: 'score' }], network_score: [[1, 0]],
			createdAt: new Date(0), updatedAt: new Date(0),
			setup: { state: 'scheduled', match_num: i, btp_group_rankings: [], teams: [] },
		})));
		app = { db, wss: { clients: [] }, clock: { now_ms: () => 1000 } };
	});
	afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
	function integrate() {
		return planner.sync(app, 'bounded', {}, { skip_unchanged: false, planning_namespace: 'bounded-test' }, async staged => {
			for (const doc of await staged.db.matches.find_async({ tournament_key: 'bounded' })) {
				await staged.db.matches.update_async({ _id: doc._id }, { $set: { 'setup.btp_group_rankings': [{ rank: 1 }] } }, {});
			}
			return true;
		});
	}
	async function reloaded() {
		const store = new Datastore({ filename: db.matches.filename });
		await promisify(store.loadDatabase.bind(store))(); return promisify(store.find.bind(store))({});
	}
	it('appends at most four prepared documents and lets an already queued read run between groups', async function() {
		const persist = db.matches.persistence.persistNewState, groups = [];
		let release;
		db.matches.persistence.persistNewState = function(docs, done) {
			groups.push(docs.length);
			if (groups.length === 1) release = () => persist.call(this, docs, done);
			else persist.call(this, docs, done);
		};
		const syncing = integrate();
		for (let i = 0; i < 200 && !release; i++) await turn();
		assert.strictEqual(typeof release, 'function');
		const reading = db.matches.find_async({}).then(records => {
			assert.strictEqual(groups.length, 1);
			assert.strictEqual(records.filter(doc => doc.setup.btp_group_rankings.length).length, 4);
		});
		release(); await reading; await syncing;
		assert.deepStrictEqual(groups, [4, 4, 1]);
		assert.deepStrictEqual(await reloaded(), await db.matches.find_async({}));
		assert((await reloaded()).every(doc => doc.network_score[0][0] === 1 && doc.presses.length === 1));
	});
	it('rolls back earlier groups and a partially appended failed group, including on reload', async function() {
		const before = await db.matches.find_async({}), persist = db.matches.persistence.persistNewState;
		let appends = 0;
		db.matches.persistence.persistNewState = function(docs, done) {
			if (++appends === 2) return persist.call(this, docs.slice(0, 1), error => done(error || new Error('partial append failed')));
			return persist.call(this, docs, done);
		};
		await assert.rejects(integrate(), /partial append failed/);
		assert.deepStrictEqual(await db.matches.find_async({}), before);
		assert.deepStrictEqual(await reloaded(), before);
	});
	it('falls back outside the executor slot when timestamp behaviour changes after planning', async function() {
		const push = db.matches.executor.push, persist = db.matches.persistence.persistNewState;
		const groups = [];
		db.matches.persistence.persistNewState = function(docs, done) { groups.push(docs.length); return persist.call(this, docs, done); };
		db.matches.executor.push = function(task, ...args) {
			if (task.diagnostic_name === 'sync_prepared_match_group') db.matches.timestampData = true;
			return push.call(this, task, ...args);
		};
		await integrate();
		assert(groups.every(count => count === 1));
		assert((await db.matches.find_async({})).every(doc => doc.updatedAt instanceof Date));
		assert.deepStrictEqual(await reloaded(), await db.matches.find_async({}));
	});
});
