'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const read = require('../bts/admin_response/tournament_read');
const qrcode = require('../bts/admin_response/qrcode_cache');
const { EventEmitter } = require('events');
const tick = () => new Promise(resolve => setImmediate(resolve));

describe('admin tournament input and QR reuse', function() {
	it('keeps the full wire response identical while reading frozen nested tournament records', async function() {
		const db = await database.init_test(), app = { db, wss: { clients: [] } };
		await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'wire', name: 'Wire test',
			events: { registrations: [{ name: 'Player', registered: new Date(0) }] }, scoring_formats: { formats: [{ id: 1, set_points: {} }] },
		});
		const admin = require('../bts/admin');
		await require('../bts/displaysettings_defaults').ensure_default_displaysettings(app, await db.tournaments.findOne_async({ key: 'wire' }));
		const legacy = await new Promise((resolve, reject) => admin.handle_tournament_get(app, {
			respond(_request, error, value) { error ? reject(error) : resolve(value); },
		}, { key: 'wire' }));
		const raw = db.model.tournament('wire').record.data;
		const freeze = value => {
			if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
			Object.values(value).forEach(freeze); Object.freeze(value);
		};
		freeze(raw.events); freeze(raw.scoring_formats);
		const original = db.tournaments.findOne;
		db.tournaments.findOne = () => { throw new Error('copied full tournament'); };
		const ws = new EventEmitter(); ws.readyState = 1;
		try {
			const response = new Promise(resolve => { ws.send = bytes => resolve(JSON.parse(bytes)); });
			require('../bts/wshandler').handle(admin, app, ws);
			ws.emit('message', JSON.stringify({ type: 'tournament_get', key: 'wire', rid: 'wire' }));
			const message = await response;
			assert.strictEqual(message.rid, 'wire');
			assert.deepStrictEqual(message.tournament, JSON.parse(JSON.stringify(legacy.tournament)));
			assert.strictEqual(raw.mainQrCode, undefined);
		} finally { ws.emit('close'); db.tournaments.findOne = original; }
	});
	it('keeps queued persistence ordering and shared read-only registrations without changing stored annotations', async function() {
		const db = await database.init_test();
		await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'admin', events: { registrations: [{ name: 'Player' }] } });
		const original = db.model.tournament('admin').record.data;
		let release;
		db.tournaments.executor.push({ this: db.tournaments, fn: done => { release = done; }, arguments: [() => {}] });
		await tick(); let completed = false;
		const pending = new Promise((resolve, reject) => read(db, 'admin', true, (error, value) => { completed = true; error ? reject(error) : resolve(value); }));
		await tick(); assert.strictEqual(completed, false); release();
		const response = await pending;
		assert.notStrictEqual(response, original); assert.strictEqual(response.events, original.events);
		response.mainQrCode = 'response only'; assert.strictEqual(original.mainQrCode, undefined);
		const legacy = await new Promise((resolve, reject) => read(db, 'admin', false, (error, value) => error ? reject(error) : resolve(value)));
		legacy.events.registrations[0].name = 'Changed'; assert.strictEqual(original.events.registrations[0].name, 'Player');
	});
	it('preserves expiration even when a TTL index appears while a response is waiting', async function() {
		const db = await database.init_test();
		await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'expired', expires: new Date(0) });
		let release;
		db.tournaments.executor.push({ this: db.tournaments, fn: done => { release = done; }, arguments: [() => {}] });
		await tick(); const pending = new Promise((resolve, reject) => read(db, 'expired', true, (error, value) => error ? reject(error) : resolve(value)));
		db.tournaments.ttlIndexes.expires = 1; release(); assert.strictEqual(await pending, null);
	});
	it('shares pending QR generation, replaces changed URLs and evicts old URLs', async function() {
		const calls = []; let release;
		const cached = qrcode.create((url, done) => { calls.push(url); release = () => done(null, 'image:' + url); }, 2);
		const first = cached('one'), second = cached('one');
		assert.strictEqual(first, second); assert.deepStrictEqual(calls, ['one']); release(); assert.strictEqual(await first, 'image:one');
		const next = cached('two'); release(); assert.strictEqual(await next, 'image:two');
		const third = cached('three'); release(); await third;
		const old = cached('one'); release(); await old; assert.deepStrictEqual(calls, ['one', 'two', 'three', 'one']);
	});
	it('does not retain failed QR generation and produces the native QR bytes', async function() {
		let attempts = 0;
		const cached = qrcode.create((_url, done) => { attempts++; done(attempts === 1 ? new Error('failed') : null, 'ok'); });
		await assert.rejects(cached('url'), /failed/); assert.strictEqual(await cached('url'), 'ok'); assert.strictEqual(attempts, 2);
		const url = 'https://example.test/tournament';
		assert.strictEqual(await qrcode(url), await promisify(require('qrcode').toDataURL)(url));
	});
});
