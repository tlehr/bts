'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { EventEmitter } = require('events');
const { networkInterfaces } = require('os');
const admin = require('../bts/admin');
const wshandler = require('../bts/wshandler');
const coordinator = require('../bts/emergency_audio');
const tick = () => new Promise(resolve => setImmediate(resolve));
const sources = ['announcements', 'change_queue_scheduler', 'change', 'conn'].map(file =>
	fs.readFileSync(require.resolve('../static/js/' + file), 'utf8'));

// Run the actual browser scripts and WebSocket handlers. Each page has its own
// storage/profile; only the server sees which pages share a physical host.
function page(app, address, key = 'test') {
	const timers = new Map(), listeners = new Map(), audios = [], errors = [], messages = [];
	let timer_id = 0, socket, client, connection, failure = null;
	const context = vm.createContext({
		curt: { key }, current_view: 'show', console, Promise,
		localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
		document: { hidden: false, addEventListener() {} },
		addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, []);listeners.get(name).push(callback); },
		setInterval(fn, ms) { timers.set(++timer_id, { fn, ms, interval: true });return timer_id; },
		clearInterval(id) { timers.delete(id); },
		setTimeout(fn, ms) { timers.set(++timer_id, { fn, ms });return timer_id; },
		clearTimeout(id) { timers.delete(id); },
		ctournament: { update_emergency_btn() {}, handle_view_announcement() { return true; } },
		cerror: { silent: message => errors.push(message) }, debug: { log() {} }, utils: { values: Object.values },
		Audio: class {
			constructor(src) { this.src = src;this.currentTime = 0;this.playing = false;this.starts = 0;audios.push(this); }
			play() {
				this.starts++;
				if (failure === 'throw') throw new Error('Audio blocked');
				if (failure === 'reject') return Promise.reject(new Error('Audio blocked'));
				this.playing = true;
				if (failure === 'pending') return new Promise((_, reject) => { this.reject = reject; });
				return Promise.resolve();
			}
			pause() { this.playing = false; }
		},
		WebSocket: class {
			constructor() {
				client = this;
				socket = new EventEmitter();socket._socket = { remoteAddress: address };socket.readyState = 1;
				socket.send = (bytes, options) => {
					assert.strictEqual(options.binary, false);
					messages.push(JSON.parse(bytes));client.onmessage?.({ data: bytes.toString() });
				};
				wshandler.handle(admin, app, socket);
			}
			send(bytes) { if (socket.readyState !== 1) throw new Error('Closed');socket.emit('message', bytes); }
		},
		send: (message, callback) => connection.send(message, callback),
	});
	context.window = context;context.location = { protocol: 'http:', hostname: 'bts.test', port: '80' };
	for (const source of sources) vm.runInContext(source, context);
	const change = context.change.default_handler(() => assert.fail('Emergency must not rebuild the view'));
	connection = context.conn(() => {}, message => { if (context.curt?.key === message.tournament_key) change(message); });
	connection.connect();
	context.subscribeEmergencyAudio(key);
	return {
		context, socket, timers, audios, messages, errors, connection,
		get playing() { return audios.filter(audio => audio.playing).length; },
		get starts() { return audios.reduce((sum, audio) => sum + audio.starts, 0); },
		get intervals() { return [...timers.values()].filter(timer => timer.interval); },
		fail(value) { failure = value; },
		event(name, value = {}) { for (const fn of listeners.get(name) || []) fn(value); },
		subscribe(next = key) { context.curt = { key: next };context.subscribeEmergencyAudio(next); },
		emergency(enable, tournament_key = key) { context.send({ type: 'emergency_announce', tournament_key, enable }, error => assert.ifError(error)); },
		close() {
			if (socket.readyState !== 1) return;
			socket.readyState = 3;
			// Browser close handling silences the old page before server failover.
			client.onclose();
			socket.emit('close');
		},
	};
}

describe('Evacuation audio: one page per host, every host', function() {
	let app, pages;
	beforeEach(() => { app = {};pages = []; });
	afterEach(() => { for (const p of pages) p.close(); });
	const add = function(address, key) { const p = page(app, address, key);pages.push(p);return p; };
	function counts() { return pages.map(p => p.playing); }

	it('plays on every host, once per host across independent browser profiles, without normal audio opt-in', function() {
		const a = add('192.0.2.10'), b = add('192.0.2.10'), c = add('192.0.2.11'), d = add('192.0.2.11'), e = add('192.0.2.12');
		assert(pages.every(p => p.errors.length === 0), 'opening an inactive page must not announce a stop');
		a.emergency(true);
		assert.deepStrictEqual(counts(), [1, 0, 1, 0, 1]);
		assert.deepStrictEqual([b.audios.length, d.audios.length], [0, 0]);
		for (const p of [a, c, e]) {
			assert.strictEqual(p.context.curt.enable_emergency, true);
			assert.strictEqual(p.audios[0].src, '/static/audio/evakuierung.mp3');
			assert.strictEqual(p.intervals.length, 1);
			assert.strictEqual(p.intervals[0].ms, 20000);
			p.intervals[0].fn();assert.strictEqual(p.starts, 2);
		}
	});

	it('does not restart playback for repeated start notifications or subscriptions', function() {
		const a = add('192.0.2.10'), b = add('192.0.2.10');
		a.emergency(true);a.emergency(true);b.subscribe();a.subscribe();
		assert.deepStrictEqual(counts(), [1, 0]);assert.strictEqual(a.starts, 1);assert.strictEqual(a.intervals.length, 1);
	});

	it('groups IPv4-mapped addresses and all loopback/server-local addresses while keeping other IPv6 hosts separate', function() {
		const a = add('::ffff:192.0.2.10');add('192.0.2.10');add('::1');add('127.0.0.1');
		let local;
		try { local = Object.values(networkInterfaces()).flat().find(info => !info.internal)?.address; } catch (_) { /* Restricted runner. */ }
		if (local) add(local);
		add('2001:db8::10');add('2001:db8::11');a.emergency(true);
		assert.deepStrictEqual(counts(), local ? [1, 0, 1, 0, 0, 1, 1] : [1, 0, 1, 0, 1, 1]);
	});

	it('hands playback to a standby page on close without restarting another host', function() {
		const a = add('192.0.2.10'), b = add('192.0.2.10'), c = add('192.0.2.11'), d = add('192.0.2.10');
		a.emergency(true);d.close();assert.deepStrictEqual(counts(), [1, 0, 1, 0]);
		a.close();assert.deepStrictEqual(counts(), [0, 1, 1, 0]);assert.strictEqual(c.starts, 1);assert.strictEqual(a.intervals.length, 0);
		assert.strictEqual(b.starts, 1);
	});

	it('joins an active evacuation after a new host connects, a reload, or all earlier pages have closed', function() {
		const a = add('192.0.2.10');a.emergency(true);a.close();
		const b = add('192.0.2.10'), c = add('192.0.2.11');add('192.0.2.11');
		assert.deepStrictEqual(counts(), [0, 1, 1, 0]);
		assert.strictEqual(b.context.curt.enable_emergency, true);assert.strictEqual(c.context.curt.enable_emergency, true);
	});

	it('stops every host, clears repetitions, and never starts a newly opened page after stop', function() {
		const a = add('192.0.2.10'), b = add('192.0.2.10');add('192.0.2.11');a.emergency(true);
		const old_repeat = a.intervals[0].fn;
		b.emergency(false);old_repeat();add('192.0.2.12');
		assert.deepStrictEqual(counts(), [0, 0, 0, 0]);
		assert(pages.every(p => p.intervals.length === 0 && p.context.curt.enable_emergency === false));
		assert.strictEqual(a.starts, 1);
	});

	it('releases a page entering the back-forward cache and rejoins without stealing the current owner', function() {
		const a = add('192.0.2.10');add('192.0.2.10');a.emergency(true);
		a.event('pagehide');assert.deepStrictEqual(counts(), [0, 1]);
		a.event('pageshow', { persisted: true });assert.deepStrictEqual(counts(), [0, 1]);
	});

	it('keeps tournaments isolated and prevents two active tournaments echoing on the same host', function() {
		const a = add('192.0.2.10'), b = add('192.0.2.10'), c = add('192.0.2.10', 'other');add('192.0.2.11', 'other');
		a.emergency(true);assert.deepStrictEqual(counts(), [1, 0, 0, 0]);
		c.emergency(true, 'other');assert.deepStrictEqual(counts(), [1, 0, 0, 1]);
		a.subscribe('other');assert.deepStrictEqual(counts(), [0, 1, 0, 1]);
		b.emergency(false);assert.deepStrictEqual(counts(), [0, 0, 1, 1]);
		c.emergency(false, 'other');assert.deepStrictEqual(counts(), [0, 0, 0, 0]);
	});

	for (const failure of ['throw', 'reject']) it('hands off after ' + failure + ' audio failure and retries after user interaction if every page is blocked', async function() {
		const a = add('192.0.2.10'), b = add('192.0.2.10'), c = add('192.0.2.11');
		a.fail(failure);b.fail(failure);a.emergency(true);await tick();
		assert.deepStrictEqual(counts(), [0, 0, 1]);assert.strictEqual(c.starts, 1);
		assert(a.errors.some(error => error.includes('nicht abgespielt')));assert.strictEqual(a.intervals.length, 0);
		b.fail(null);b.event('pointerdown');await tick();assert.deepStrictEqual(counts(), [0, 1, 1]);
		a.fail(null);a.event('keydown');await tick();assert.deepStrictEqual(counts(), [0, 1, 1]);
	});

	it('ignores a delayed rejection from a stopped audio instance after a new start', async function() {
		const a = add('192.0.2.10');a.fail('pending');a.emergency(true);
		const old = a.audios[0];a.emergency(false);a.fail(null);a.emergency(true);
		old.reject(new Error('Late AbortError'));await tick();
		assert.strictEqual(a.playing, 1);assert.strictEqual(a.intervals.length, 1);
		assert(!a.errors.some(error => error.includes('nicht abgespielt')));
	});

	it('tolerates user interaction on a disconnected blocked page and resumes on a new connection', async function() {
		const a = add('192.0.2.10');a.fail('reject');a.emergency(true);await tick();
		a.close();assert.doesNotThrow(() => a.event('pointerdown'));
		const b = add('192.0.2.10');assert.strictEqual(b.playing, 1);assert.strictEqual(b.context.curt.enable_emergency, true);
	});

	it('does not turn a tournament state notification into playback, including in muted registration views', function() {
		const a = add('192.0.2.10');
		a.connection._test_handle_message({ data: JSON.stringify({ type: 'change', ctype: 'emergency_announce', tournament_key: 'test', val: true }) });
		assert.strictEqual(a.context.curt.enable_emergency, true);assert.strictEqual(a.starts, 0);
		a.context.current_view = 'self_check_in';a.emergency(true);assert.strictEqual(a.playing, 1);
		a.emergency(false);assert.strictEqual(a.playing, 0);
	});

	it('treats playback grants as immediate even without a tournament route or with queued data updates', function() {
		const a = add('192.0.2.10');a.context.curt = null;
		a.connection._test_handle_message({ data: JSON.stringify({ type: 'change', ctype: 'events', tournament_key: 'test', val: {} }) });
		for (const enable of [true, false]) {
			a.connection._test_handle_message({ data: JSON.stringify({ type: 'emergency_playback', enable }) });
			assert.strictEqual(a.playing, Number(enable));
		}
		assert.strictEqual(a.connection._test_change_queue_length(), 1);
	});

	it('skips probes, closed sockets and a failed recipient without silencing the remaining hosts', function() {
		const state = coordinator(app), received = [];
		const socket = (ip, extra = {}) => ({ _socket: { remoteAddress: ip }, sendmsg: message => received.push([ip, message]), ...extra });
		state.subscribe(socket('192.0.2.9', { performance_probe: true }), 'test');
		state.subscribe(socket('192.0.2.10', { readyState: 3 }), 'test');
		state.subscribe(socket('192.0.2.10', { sendmsg() { throw new Error('Lost socket'); } }), 'test');
		state.subscribe(socket('192.0.2.10'), 'test');state.subscribe(socket('192.0.2.11'), 'test');
		state.set_enabled('test', true);
		assert.deepStrictEqual(received.filter(([, message]) => message.type === 'emergency_playback' && message.enable).map(([ip]) => ip), ['192.0.2.10', '192.0.2.11']);
	});

	it('rejects non-boolean start commands and malformed subscriptions', function() {
		const a = add('192.0.2.10'), replies = [];
		const ws = { respond: (msg, error) => replies.push(error) };
		admin.handle_emergency_announce(app, ws, { tournament_key: 'test', enable: 'false' });
		admin.handle_emergency_audio_subscribe(app, ws, { tournament_key: null });
		assert(replies.every(error => error?.message));assert.strictEqual(a.playing, 0);
	});
});
