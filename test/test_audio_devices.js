'use strict';

const assert = require('assert');
const database = require('../bts/database');
const admin = require('../bts/admin');
const registry = require('../bts/audio_devices');
const {create} = require('../static/js/audio_devices');
const createTexts = require('../static/js/announcement_text');
const {_translate: translate} = require('../static/js/ci18n');

function client(app, id, initial = {}, key = 'audio-test') {
	const saved = new Map(Object.entries({'bts-audio-device-id-v1': id, ...initial})), callbacks = new Map(), inputs = [];
	let request = 0, device;
	const ws = {readyState: 1, _socket: {remoteAddress: '::ffff:192.0.2.10'},
		sendmsg: message => device.receive(message),
		respond: (message, error, response) => {const callback = callbacks.get(message.rid);callbacks.delete(message.rid);callback(error, response);},
	};
	device = create({localStorage: {getItem: name => saved.get(name) ?? null, setItem: (name, value) => saved.set(name, String(value))},
		document: {querySelectorAll: () => inputs}, navigator: {userAgent: 'Chrome/130 Linux'},
		send: (message, callback) => {
			const value = {...message, rid: ++request};callbacks.set(value.rid, callback);
			admin['handle_' + message.type](app, ws, value);
		},
	});
	const connect = () => device.connect({key, locations: [{_id: 'hall-a'}, {_id: 'hall-b'}]});
	const set = (target, change) => new Promise((resolve, reject) => device.set(target, change, error => error ? reject(error) : resolve()));
	return {device, ws, saved, inputs, connect, set};
}

describe('centrally managed announcement audio devices', function() {
	let app;
	beforeEach(async function() {
		app = {db: await database.init_test()};
		const insert = (table, value) => new Promise((resolve, reject) => app.db[table].insert(value, error => error ? reject(error) : resolve()));
		await insert('tournaments', {key: 'audio-test'});
		await insert('tournaments', {key: 'other-test'});
		for (const id of ['hall-a', 'hall-b']) await insert('locations', {_id: id, tournament_key: 'audio-test'});
	});
	it('migrates existing hall and free-announcement preferences only on first registration', async function() {
		const a = client(app, 'device-one', {enable_announcement_calls_hall_a: 'true', 'enable_announcement_calls_hall-a': 'true', enable_free_announcements: 'true'});
		await a.connect();
		const record = await app.db.app_settings.findOne_async({device_id: 'device-one'});
		assert.deepStrictEqual(record.settings, {free: true, locations: [{id: 'hall-a', calls: true, preparations: false}, {id: 'hall-b', calls: false, preparations: false}]});
		await a.set('device-one', {kind: 'calls', location_id: 'hall-a', value: false});
		const sameBrowser = client(app, 'device-one', {'enable_announcement_calls_hall-a': 'true'});await sameBrowser.connect();
		assert.strictEqual(sameBrowser.device.read('enable_announcement_calls_hall-a'), 'false');
		assert.strictEqual(sameBrowser.device.read('enable_free_announcements'), 'true');
	});

	it('updates a remote device immediately while leaving the editing device unchanged', async function() {
		const a = client(app, 'device-one'), b = client(app, 'device-two');await a.connect();await b.connect();
		const toggle = {name: 'enable_announcement_calls_hall-a', checked: false};b.inputs.push(toggle);
		await a.set('device-two', {kind: 'calls', location_id: 'hall-a', value: true});
		assert.strictEqual(b.device.read(toggle.name), 'true');assert.strictEqual(toggle.checked, true);
		assert.strictEqual(b.saved.get(toggle.name), 'true');assert.strictEqual(a.device.read(toggle.name), 'false');
		await a.set('device-two', {kind: 'free', value: true});
		assert.strictEqual(b.saved.get('enable_free_announcements'), 'true');
		assert.strictEqual(a.device.read('enable_free_announcements'), 'false');
	});

	it('synchronizes all tabs sharing the same device without resetting their configuration', async function() {
		const a = client(app, 'device-one'), tab = client(app, 'device-one');await a.connect();await tab.connect();
		await a.set('device-one', {kind: 'preparations', location_id: 'hall-b', value: true});
		assert.strictEqual(tab.device.read('enable_announcement_preparations_hall-b'), 'true');
		assert.strictEqual(a.device.read('enable_announcement_preparations_hall-b'), 'true');
	});

	it('preserves independent simultaneous edits to different halls and call types', async function() {
		const a = client(app, 'device-one');await a.connect();
		await Promise.all([
			a.set('device-one', {kind: 'calls', location_id: 'hall-a', value: true}),
			a.set('device-one', {kind: 'preparations', location_id: 'hall-a', value: true}),
			a.set('device-one', {kind: 'calls', location_id: 'hall-b', value: true}),
		]);
		assert.strictEqual(a.device.read('enable_announcement_calls_hall-a'), 'true');
		assert.strictEqual(a.device.read('enable_announcement_preparations_hall-a'), 'true');
		assert.strictEqual(a.device.read('enable_announcement_calls_hall-b'), 'true');
	});

	it('makes the existing board switch save centrally and synchronize another tab', async function() {
		const a = client(app, 'device-one'), tab = client(app, 'device-one');await a.connect();await tab.connect();
		let changed;
		const control = {name: 'enable_announcement_calls_hall-a', checked: false, addEventListener: (_event, callback) => {changed = callback;}};
		a.inputs.push(control);a.device.bind(control, error => assert.fail(error.message));control.checked = true;changed();
		for (let attempt = 0;tab.device.read(control.name) !== 'true';attempt++) {
			assert(attempt < 1000, 'Board preference did not reach the other tab');await new Promise(resolve => setImmediate(resolve));
		}
		assert.strictEqual((await app.db.app_settings.findOne_async({device_id: 'device-one'})).settings.locations[0].calls, true);
	});

	it('applies remote preferences to real announcement generation without triggering playback on a settings update', async function() {
		const a = client(app, 'device-one'), b = client(app, 'device-two');await a.connect();await b.connect();
		const played = [], tournament = {key: 'audio-test', locations: [{_id: 'hall-a'}], courts: [{_id: 'court-one', num: 1}], normalizations: []};
		const texts = createTexts({tournament, translate: (key, data) => translate('de', key, data), claim: () => null,
			window: {localStorage: {getItem: name => b.device.read(name)}}, announce: parts => played.push(parts)});
		const match = {location_id: 'hall-a', court_id: 'court-one', teams: [{players: [{name: 'Max Mustermann'}]}, {players: [{name: 'Hans Dampf'}]}]};
		texts.announceNewMatch(match);assert.strictEqual(played.length, 0);
		await a.set('device-two', {kind: 'calls', location_id: 'hall-a', value: true});assert.strictEqual(played.length, 0);
		texts.announceNewMatch(match);assert.strictEqual(played.length, 1);
		await a.set('device-two', {kind: 'calls', location_id: 'hall-a', value: false});
		texts.announceNewMatch(match);assert.strictEqual(played.length, 1);
	});

	it('reloads persisted choices after a server restart instead of overwriting them with stale browser values', async function() {
		const a = client(app, 'device-one');await a.connect();await a.set('device-one', {kind: 'calls', location_id: 'hall-a', value: true});
		const next = client({db: app.db}, 'device-one', {'enable_announcement_calls_hall-a': 'false'});await next.connect();
		assert.strictEqual(next.device.read('enable_announcement_calls_hall-a'), 'true');
	});

	it('saves settings for an offline device and applies them on reconnection', async function() {
		const a = client(app, 'device-one'), b = client(app, 'device-two');await a.connect();await b.connect();
		b.ws.readyState = 3;registry.release(app, b.ws);b.device.disconnected();
		await a.set('device-two', {kind: 'calls', location_id: 'hall-a', value: true});
		const next = client(app, 'device-two');await next.connect();
		assert.strictEqual(next.device.read('enable_announcement_calls_hall-a'), 'true');
	});

	it('rejects invalid settings, unknown devices and halls from another tournament', async function() {
		const a = client(app, 'device-one');await a.connect();
		const before = await app.db.app_settings.find_async({});
		for (const [id, change] of [
			['device-one', {kind: 'unknown', value: true}], ['device-one', {kind: 'free', value: 'true'}],
			['missing', {kind: 'free', value: true}], ['device-one', {kind: 'calls', location_id: 'missing', value: true}],
		]) await assert.rejects(a.set(id, change));
		const other = client(app, 'device-one', {}, 'other-test');await other.connect();
		await assert.rejects(other.set('device-one', {kind: 'calls', location_id: 'hall-a', value: true}), /Location not found/);
		assert.deepStrictEqual(await app.db.app_settings.find_async({tournament_key: 'audio-test'}), before);
	});

	it('does not publish or apply a change when saving fails', async function() {
		const a = client(app, 'device-one'), b = client(app, 'device-two');await a.connect();await b.connect();
		app.db.app_settings.update_async = async () => {throw new Error('Synthetic audio save failure');};
		await assert.rejects(a.set('device-two', {kind: 'calls', location_id: 'hall-a', value: true}), /Synthetic audio save failure/);
		assert.strictEqual(b.device.read('enable_announcement_calls_hall-a'), 'false');
		const record = await app.db.app_settings.findOne_async({device_id: 'device-two'});
		assert.strictEqual(record.settings.locations[0].calls, false);
	});

	it('ignores old snapshots and snapshots from a different tournament', async function() {
		const a = client(app, 'device-one');await a.connect();
		a.device.receive({tournament_key: 'audio-test', revision: 0, devices: []});
		a.device.receive({tournament_key: 'other-test', revision: 1000, devices: []});
		await a.set('device-one', {kind: 'calls', location_id: 'hall-a', value: true});
		assert.strictEqual(a.device.read('enable_announcement_calls_hall-a'), 'true');
	});
});
