'use strict';

const assert = require('assert');
const { promisify } = require('util');
const crypto = require('crypto');
const Datastore = require('nedb');
const model = require('../bts/tournament_model');
const fingerprints = require('../bts/tournament_model/fingerprints');
const normalization = require('../bts/tournament_model/normalization_fingerprints');
const { fixture, insert, match, registration } = require('./tournament_model_fixture');

describe('cached object fingerprints', function() {
	it('separates match scores, participants and normalization and reuses hashes across ordinary points', async function() {
		const { db, tournament } = await fixture();
		const game = tournament.matches.get('one');
		const before = Object.fromEntries(['document', 'score', 'participants', 'normalization'].map(kind => [kind, game.fingerprint(kind)]));
		const state = await db.model.normalization_state('test');
		await db.matches.update_async({ _id: 'one' }, { $set: { network_score: [[3, 4]], duration_ms: 100,
			presses: [{ timestamp: 100 }] } }, {});
		assert.notStrictEqual(game.fingerprint('score'), before.score);
		assert.notStrictEqual(game.fingerprint(), before.document);
		assert.strictEqual(game.fingerprint('participants'), before.participants);
		assert.strictEqual(game.fingerprint('normalization'), before.normalization);
		assert.strictEqual((await db.model.normalization_state('test')).signature, state.signature);
		await db.matches.update_async({ _id: 'one' }, { $set: { 'setup.teams.0.players.0.checked_in': true } }, {});
		assert.notStrictEqual(game.fingerprint('participants'), before.participants);
		assert.strictEqual(game.fingerprint('normalization'), before.normalization);
		await db.matches.update_async({ _id: 'one' }, { $set: { end_ts: 1000, team1_won: true } }, {});
		assert.notStrictEqual(game.fingerprint('normalization'), before.normalization);
	});

	it('avoids both document traversal and hash calculation on an unchanged normalization read', async function() {
		const { db, tournament } = await fixture();
		const state = await db.model.normalization_state('test');
		const create_hash = crypto.createHash;
		const values = tournament.matches.values;
		crypto.createHash = () => { throw new Error('Rehashed unchanged data'); };
		tournament.matches.values = () => { throw new Error('Traversed all matches'); };
		try {
			assert.strictEqual((await db.model.normalization_state('test')).signature, state.signature);
		} finally { crypto.createHash = create_hash; tournament.matches.values = values; }
	});

	it('updates membership on insertion, deletion, moves, reset and failed batch rollback', async function() {
		const { db, tournament } = await fixture();
		const before = (await db.model.normalization_state('test')).signature;
		await insert(db.matches, match('new', [8]));
		assert.notStrictEqual((await db.model.normalization_state('test')).signature, before);
		await db.matches.remove_async({ _id: 'new' }, {});
		assert.strictEqual((await db.model.normalization_state('test')).signature, before);
		await db.matches.update_async({ _id: 'one' }, { $set: { tournament_key: 'other' } }, {});
		assert.notStrictEqual((await db.model.normalization_state('test')).signature, before);
		assert.strictEqual((await db.model.normalization_state('other', true)).matches.length, 1);
		await db.matches.update_async({ _id: 'one' }, { $set: { tournament_key: 'test' } }, {});
		assert.strictEqual((await db.model.normalization_state('test')).signature, before);
		db.model._reset('matches', db.matches.getAllData());
		assert.strictEqual((await db.model.normalization_state('test')).signature, before);
		await promisify(db.matches.ensureIndex.bind(db.matches))({ fieldName: 'unique', unique: true, sparse: true });
		await db.matches.update_async({ _id: 'one' }, { $set: { unique: 'existing' } }, {});
		await assert.rejects(insert(db.matches, [match('temporary', [77]), { ...match('conflict'), unique: 'existing' }]), /unique constraint/);
		assert.strictEqual((await db.model.normalization_state('test')).signature, before);
		await assert.rejects(db.matches.update_async({}, { $set: { unique: 'duplicate', 'setup.state': 'blocked' } }, { multi: true }), /unique constraint/);
		assert.strictEqual((await db.model.normalization_state('test')).signature, before);
		assert.strictEqual(tournament.matches.get('one').data.setup.state, 'ready');
	});

	it('captures signatures and mutable projections in datastore order, excluding score histories and events', async function() {
		const { db, tournament } = await fixture();
		const pending = db.matches.update_async({ _id: 'one' }, { $set: { end_ts: 1234 } }, {});
		const capture = db.model.normalization_state('test', true);
		await pending;
		const state = await capture;
		assert.strictEqual(state.matches.find(game => game._id === 'one').end_ts, 1234);
		assert.strictEqual(normalization.snapshot_signature(state), state.signature);
		Object.defineProperty(tournament.matches.get('one').data, 'presses', { get() { throw new Error('Copied history'); } });
		Object.defineProperty(tournament.record.data, 'events', { get() { throw new Error('Copied events'); } });
		const copy = await db.model.normalization_state('test', true);
		copy.matches.find(game => game._id === 'one').setup.state = 'blocked';
		assert.strictEqual(tournament.matches.get('one').data.setup.state, 'ready');
		assert.strictEqual((await db.model.normalization_state('test')).signature, state.signature);
	});

	it('keeps canonical player profile hashes independent of per-match check-ins and points', async function() {
		const { db, tournament } = await fixture();
		const player = tournament.players.get('1');
		const before = player.fingerprint();
		await db.matches.update_async({ _id: 'one' }, { $set: { 'setup.teams.0.players.0.checked_in': true, network_score: [[5, 6]] } }, {});
		assert.strictEqual(player.fingerprint(), before);
		await db.tournaments.update_async({ key: 'test' }, { $set: { events: registration([{ btp_id: 1, name: 'Updated registration' }]) } }, {});
		const updated = player.fingerprint();
		assert.notStrictEqual(updated, before);
		await db.tournaments.update_async({ key: 'test' }, { $set: { events: registration([{ btp_id: 1, name: 'Updated registration' }]) } }, {});
		assert.strictEqual(player.fingerprint(), updated);
		await db.matches.update_async({ _id: 'two' }, { $set: { 'setup.teams.0.players.0.name': 'New profile' } }, {});
		assert.notStrictEqual(player.fingerprint(), updated);
	});

	it('hashes values consistently regardless of property order and correctly distinguishes changed dates', async function() {
		const a = { _id: 'official', name: 'A', birthday: new Date(1000) };
		const b = { birthday: new Date(1000), name: 'A', _id: 'official' };
		assert.strictEqual(fingerprints.fingerprint('umpires', a, 'normalization'), fingerprints.fingerprint('umpires', b, 'normalization'));
		const c = { ...b, birthday: new Date(2000) };
		fingerprints.inherit('umpires', b, c);
		assert.notStrictEqual(fingerprints.fingerprint('umpires', c, 'normalization'), fingerprints.fingerprint('umpires', b, 'normalization'));
	});

	it('rebuilds the same hashes on reload without persisting runtime cache fields', async function() {
		const fs = require('fs'), os = require('os'), path = require('path');
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-fingerprints-'));
		try {
			const store = new Datastore({ filename: path.join(directory, 'matches') });
			const db = { matches: store };
			model.attach(db);
			await promisify(store.loadDatabase.bind(store))();
			await insert(store, match('persisted'));
			const game = db.model.tournament('test').matches.get('persisted');
			const digest = game.fingerprint('normalization');
			await promisify(store.loadDatabase.bind(store))();
			assert.strictEqual(game.fingerprint('normalization'), digest);
			assert(!fs.readFileSync(path.join(directory, 'matches'), 'utf8').includes(digest));
			assert.deepStrictEqual(game.toJSON(), match('persisted'));
		} finally { fs.rmSync(directory, { recursive: true, force: true }); }
	});
});
