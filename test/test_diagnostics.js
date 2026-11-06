'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const database = require('../bts/database');
const { Diagnostics, handle } = require('../bts/diagnostics');
const sanitize = require('../bts/diagnostics/sanitize');
const pages = require('../bts/diagnostics/pages');
const createClient = require('../static/js/diagnostics_client');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(work) {
    const start = Date.now();
    while (Date.now() - start < 5000) { const result = await work(); if (result) return result; await delay(20); }
    throw new Error('diagnostics_test_timeout');
}
class Socket extends EventEmitter {
    constructor() { super(); this.readyState = 1; this.bufferedAmount = 0; this.messages = []; this._socket = { remoteAddress: '127.0.0.1' }; }
    send(json) { this.messages.push(JSON.parse(json)); }
    close() { this.readyState = 3; this.emit('close'); }
    terminate() { this.close(); }
    receive(value) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
function client(hub, id = 'page_alpha', overrides = {}) {
    const ws = new Socket(); hub.connect(ws);
    ws.receive({ type: 'hello', page_id: id, device_id: 'device_alpha', instance: id + '_instance', version: 'version-a', role: 'admin',
        tournament_key: 'default', path: '/admin/t/default/', ...overrides });
    return ws;
}
function browser() {
    const handlers = {}, intervals = [], sockets = [], storage = new Map(), elements = [];
    const store = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
    const env = { document: { title: 'Test', addEventListener(type, fn) { handlers[type] = fn; }, querySelectorAll: () => [],
        createElement: () => ({ style: {}, setAttribute() {}, remove() {} }), body: { appendChild(node) { elements.push(node); } } },
        location: { href: 'http://localhost/admin/t/default/#test', pathname: '/admin/t/default/', protocol: 'http:', host: 'localhost', hash: '#test',
            replace(url) { env.reloaded = url; } },
        localStorage: store, sessionStorage: store, console: Object.fromEntries(['warn', 'error', 'log', 'info', 'debug'].map(key => [key, () => {}])),
        addEventListener(type, fn) { handlers[type] = fn; }, setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {}, setTimeout() {}, clearTimeout() {},
        WebSocket: class { constructor() { this.readyState = 1; this.messages = []; sockets.push(this); } send(json) { this.messages.push(JSON.parse(json)); } close() {} },
    };
    const api = createClient(env, 'v-test'), ws = sockets[0];
    ws.onopen(); ws.onmessage({ data: JSON.stringify({ type: 'registered' }) });
    const receive = value => ws.onmessage({ data: JSON.stringify(value) });
    return { env, api, ws, receive, handlers, intervals, elements };
}

describe('Central diagnostics and remote reload', function() {
    this.timeout(10000);
    let app, hub, directory;
    beforeEach(async function() {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-diagnostics-'));
        app = { config: { diagnostics: { directory } }, db: await database.init_test() };
        hub = app.diagnostics = new Diagnostics(app, 'build-test');
        await until(() => hub.ready);
    });
    afterEach(async function() {
        if (hub) { const worker = hub.worker; hub.close(); if (worker && worker.exitCode === null) await new Promise(resolve => worker.once('exit', resolve)); }
        fs.rmSync(directory, { recursive: true, force: true });
    });

    it('runs storage in a separate process, redacts secrets and safely bounds circular console values', async function() {
        assert.notStrictEqual(hub.worker.pid, process.pid);
        const value = { api_key: 'not-for-logs', authorization: 'not-for-logs' }; value.self = value;
        const text = sanitize.format(['a warning', value, new Error('test')]);
        assert(!text.includes('not-for-logs')); assert(text.includes('[Zyklus]'));
        assert(!sanitize.cleanString('url?token=hide-me&other=ok Bearer abc123').includes('hide-me'));
        const original = console.warn;
        console.warn('diagnostics-capture-check', value);
        assert.strictEqual(console.warn, original, 'capturing leaves the installed console wrapper usable');
        const result = await until(async () => { const result = await hub.query({ search: 'diagnostics-capture-check' }); return result.items.length && result; });
        assert.strictEqual(result.items[0].source, 'server'); assert(!JSON.stringify(result).includes('not-for-logs'));
    });

    it('acknowledges client batches, attributes sources to the registered page and deduplicates replayed events', async function() {
        const ws = client(hub);
        const entry = { event_id: 'unique-event', message: 'client-marker', level: 'error', source: 'server', page_id: 'forged' };
        ws.receive({ type: 'logs', batch_id: 1, entries: [entry] }); ws.receive({ type: 'logs', batch_id: 2, entries: [entry] });
        assert(ws.messages.some(msg => msg.type === 'logs_ack' && msg.id === 2));
        const result = await until(async () => { const result = await hub.query({ search: 'client-marker' }); return result.items.length && result; });
        assert.strictEqual(result.items.length, 1); assert.strictEqual(result.items[0].count, 1);
        assert.strictEqual(result.items[0].source, 'admin'); assert.strictEqual(result.items[0].page_id, 'page_alpha');
    });

    it('associates panel pages by an explicit client ID rather than their label or address', function() {
        const ws = client(hub, 'page_panel', { role: 'umpire', label: 'Halle 1', panel_client_id: 'client_with_underscores' });
        assert.strictEqual(hub.snapshot().pages[0].panel_client_id, 'client_with_underscores');
        ws.receive({ type: 'heartbeat', role: 'umpire', label: 'Halle 2', panel_client_id: 'other-client' });
        assert.strictEqual(hub.snapshot().pages[0].panel_client_id, 'other-client');
        ws.receive({ type: 'heartbeat', role: 'admin', label: 'client_with_underscores' });
        assert.strictEqual(hub.snapshot().pages[0].panel_client_id, '');
    });

    it('includes protocol contacts in diagnostic snapshots even without a registered browser page', async function() {
        const panels = require('../bts/bupws_v2');
        const ws = Object.assign(new EventEmitter(), {readyState: 1, client_id: 'protocol-contact',
            last_tournament_key: 'contact-test', hostname: 'Protocol tablet'});
        panels.on_connect(app, ws);
        try {
            ws.emit('message', JSON.stringify({type: 'score_update'}));
            let response;
            await handle(app, {respond: (_msg, _error, value) => {response = value;}}, {type: 'diagnostics_snapshot'});
            const contact = response.diagnostics.panel_contacts.find(item => item.client_id === ws.client_id);
            assert.strictEqual(contact.last_contact, ws.last_contact);
            assert.strictEqual(contact.tournament_key, 'contact-test');
            assert(!response.diagnostics.pages.some(page => page.panel_client_id === ws.client_id));
        } finally { ws.readyState = 3; panels.on_close(app, ws); }
    });

    it('retains the last received browser contact when a connection closes later', function() {
        const ws = client(hub), received_at = ws.diagnostics_page.last_seen, clock = Date.now;
        try {
            Date.now = () => received_at + 10000;
            ws.close();
            const page = hub.snapshot().pages.find(page => page.id === 'page_alpha');
            assert.strictEqual(page.online, false);
            assert.strictEqual(page.last_seen, received_at);
        } finally { Date.now = clock; }
    });

    it('filters device logs across pages through the admin API and keeps export filters', async function() {
        const first = client(hub), second = client(hub, 'page_beta'), other = client(hub, 'page_other', {device_id:'device_other'});
        for (const [index, ws] of [first, second, other].entries()) ws.receive({type:'logs',batch_id:1,entries:[{event_id:'device-filter-' + index,level:'warn',message:'device-filter-marker-' + index}]});
        await until(async () => (await hub.query({search:'device-filter-marker'})).items.length === 3);
        const request = async filter => {
            let response;await handle(app, {respond:(_msg,_error,value) => {response = value;}}, {type:'diagnostics_logs',filter});return response;
        };
        const result = await request({device_id:'device_alpha',search:'device-filter-marker'});
        assert.deepStrictEqual(result.logs.items.map(item => item.page_id).sort(), ['page_alpha','page_beta']);
        const exported = await request({device_id:'device_other',search:'device-filter-marker',export:true});
        assert.strictEqual(exported.logs.items.length, 1);assert.strictEqual(exported.logs.items[0].device_id, 'device_other');
        assert((await request({device_id:7})).diagnostics_error);
    });

    it('keeps filtered history across a storage-process restart and exposes incremental repeat updates', async function() {
        hub.record({ message: 'persist-marker', source: 'speech', level: 'warn', event_id: 'first' });
        const first = await until(async () => { const result = await hub.query({ search: 'persist-marker' }); return result.items.length && result; });
        hub.record({ message: 'persist-marker', source: 'speech', level: 'warn', event_id: 'second' });
        const updated = await until(async () => { const result = await hub.query({ cursor: first.cursor, source: 'speech', level: 'warn' }); return result.items.some(row => row.count === 2) && result; });
        assert.strictEqual(updated.items[0].id, first.items[0].id);
        const worker = hub.worker; hub.close(); await new Promise(resolve => worker.once('exit', resolve));
        hub = app.diagnostics = new Diagnostics(app, 'build-test'); await until(() => hub.ready);
        const restored = await hub.query({ search: 'persist-marker', level: 'warn', source: 'speech' });
        assert.strictEqual(restored.items[0].count, 2); assert.strictEqual(restored.persistent, true);
        assert.strictEqual((await hub.query({ search: 'persist-marker', level: 'error' })).items.length, 0);
    });

    it('pages older filtered logs without advancing the live cursor past new or repeated messages', async function() {
        for (let i = 0; i < 123; i++) hub.record({ source: 'server', level: 'warn', message: 'history-page-' + i });
        hub.record({ source: 'speech', level: 'warn', message: 'history-page-other-source' });
        await until(async () => (await hub.query({ search: 'history-page-', source: 'server' })).matching_total === 123);
        const filter = { search: 'history-page-', source: 'server', limit: 50 };
        const first = await hub.query(filter);
        assert.strictEqual(first.items.length, 50);
        assert.strictEqual(first.matching_total, 123);
        assert.strictEqual(first.next_before, first.items.at(-1).revision);
        hub.record({ source: 'server', level: 'warn', message: 'history-page-new' });
        hub.record({ source: 'server', level: 'warn', message: 'history-page-0' });
        await until(async () => (await hub.query({ ...filter, cursor: first.cursor })).items.length === 2);
        const second = await hub.query({ ...filter, before_revision: first.next_before });
        const third = await hub.query({ ...filter, before_revision: second.next_before });
        const history = [...first.items, ...second.items, ...third.items];
        assert.strictEqual(second.items.length, 50);
        assert.strictEqual(history.length, 122, 'the repeated oldest row moved into the live range');
        assert.strictEqual(new Set(history.map(row => row.id)).size, history.length);
        assert.strictEqual(third.next_before, null);
        const changes = await hub.query({ ...filter, cursor: first.cursor });
        assert.strictEqual(changes.items.length, 2);
        assert(changes.items.some(row => row.message === 'history-page-0' && row.count === 2));
        assert(changes.items.some(row => row.message === 'history-page-new'));
        assert.strictEqual(changes.matching_total, 124);
        const exported = await hub.query({ ...filter, export: true });
        assert.strictEqual(exported.total, 124, 'the display page size must not restrict exports');
    });

    it('validates older-page boundaries through the admin API and retains all search matches', async function() {
        for (let i = 0; i < 55; i++) hub.record({ source: 'server', level: 'error', message: 'api-history-' + i });
        await until(async () => (await hub.query({ search: 'api-history-' })).matching_total === 55);
        const request = async filter => {
            let result;await handle(app, { respond: (_request, _error, value) => { result = value; } }, { type: 'diagnostics_logs', filter });return result;
        };
        const first = (await request({ search: 'api-history-', limit: 50 })).logs;
        const second = (await request({ search: 'api-history-', limit: 50, before_revision: first.next_before })).logs;
        assert.strictEqual(second.items.length, 5);
        assert.strictEqual(second.matching_total, 55);
        assert.strictEqual(second.next_before, null);
        for (const before_revision of [-1, 1.5, '20', Number.MAX_SAFE_INTEGER + 1]) {
            assert.strictEqual((await request({ before_revision })).diagnostics_error, 'invalid_log_filter');
        }
    });

    it('targets a page or all pages of a device and verifies a new page instance after reload', async function() {
        const a = client(hub), b = client(hub, 'page_beta'), c = client(hub, 'page_gamma', { device_id: 'device_other', role: 'display' });
        const command = hub.reload('page', 'page_alpha');
        assert.strictEqual(command.targets.length, 1); assert(a.messages.some(msg => msg.type === 'reload_prepare'));
        assert(!b.messages.some(msg => msg.type === 'reload_prepare')); assert(!c.messages.some(msg => msg.type === 'reload_prepare'));
        a.receive({ type: 'reload_ready', id: command.id, guard: { idle: true } });
        await until(() => a.messages.some(msg => msg.type === 'reload_go'));
        assert.strictEqual(command.targets[0].state, 'reloading'); a.close();
        client(hub, 'page_alpha', { instance: 'after_reload', version: 'version-b', reload_ack: command.id });
        assert.strictEqual(command.targets[0].state, 'reconnected'); assert.strictEqual(command.targets[0].version, 'version-b');
        command.at -= 1001;
        const device = hub.reload('device', 'device_alpha'); assert.strictEqual(device.targets.length, 2);
        assert.strictEqual(device.targets[1].state, 'scheduled');
    });

    it('marks offline pages unreachable and permits cancellation without late reload approval', async function() {
        const ws = client(hub); ws.close();
        const offline = hub.reload('all', ''); assert.strictEqual(offline.targets[0].state, 'unreachable');
        offline.at -= 1001;
        const active = client(hub, 'page_beta', { role: 'umpire' });
        const command = hub.reload('page', 'page_beta');
        active.receive({ type: 'reload_status', id: command.id, state: 'waiting', reason: 'Laufendes Spiel' });
        assert.strictEqual(command.targets[0].state, 'waiting');
        let answer;
        app.db.matches.findOne = (_query, callback) => { answer = callback; };
        active.receive({ type: 'reload_ready', id: command.id, guard: { match_id: 'm', presses_json: '[]' } });
        await until(() => answer);
        hub.cancel(command.id); answer(null, { setup: { state: 'finished' }, presses: [] }); await delay(20);
        assert.strictEqual(command.targets[0].state, 'cancelled'); assert(!active.messages.some(msg => msg.type === 'reload_go'));
        hub.wait(active.diagnostics_page, command.id, 'Verspäteter Prüfungsfehler');
        assert.strictEqual(command.targets[0].state, 'cancelled', 'a late failed check must not resurrect a cancelled command');
    });

    it('requires a persisted finished match with identical presses before reloading a counting tablet', async function() {
        const presses = [{ type: 'score', team: 0 }];
        await promisify(app.db.matches.insert.bind(app.db.matches))({ _id: 'm', tournament_key: 'default', setup: { state: 'oncourt', now_on_court: true }, presses });
        const ws = client(hub, 'page_tablet', { role: 'umpire' }), command = hub.reload('page', 'page_tablet');
        ws.receive({ type: 'reload_ready', id: command.id, guard: { match_id: 'm', presses_json: JSON.stringify(presses) } });
        await until(() => ws.messages.some(msg => msg.type === 'reload_wait'));
        assert(!ws.messages.some(msg => msg.type === 'reload_go'));
        await app.db.matches.update_async({ _id: 'm' }, { $set: { 'setup.state': 'finished', 'setup.now_on_court': false } }, {});
        ws.diagnostics_page.last_guard = 0;
        ws.receive({ type: 'reload_ready', id: command.id, guard: { match_id: 'm', presses_json: '[]' } }); await delay(30);
        assert(!ws.messages.some(msg => msg.type === 'reload_go'));
        ws.diagnostics_page.last_guard = 0;
        ws.receive({ type: 'reload_ready', id: command.id, guard: { match_id: 'm', presses_json: JSON.stringify(presses) } });
        await until(() => ws.messages.some(msg => msg.type === 'reload_go'));
        assert.strictEqual(command.targets[0].state, 'reloading');
    });

    it('exposes bounded admin queries and keeps client command messages away from the control API', async function() {
        const ws = client(hub);
        ws.receive({ type: 'diagnostics_reload', scope: 'all' }); assert.strictEqual(hub.commands.size, 0);
        const request = async message => {
            let response; await handle(app, { respond: (_request, _error, value) => { response = value; } }, message); return response;
        };
        assert((await request({ type: 'diagnostics_snapshot' })).diagnostics.pages.length === 1);
        assert((await request({ type: 'diagnostics_reload', scope: 'bad' })).diagnostics_error);
        assert((await request({ type: 'diagnostics_logs', filter: { limit: 999999 } })).logs.items.length <= 5000);
        for (let i = 0; i < 1100; i++) hub.record({ source: 'server', level: 'error', message: 'burst-' + i });
        assert(hub.dropped > 0); assert(hub.queue.length <= 1000);
    });

    it('adds versioned diagnostics to admin and BUP HTML while leaving external assets intact', function() {
        const html = pages.html('<html><head></head><body><script src="js/bup.js"></script><link href="/static/a.css"><script src="https://example.org/a.js"></script></body></html>', 'abc123');
        assert(html.includes('data-bts-version="abc123"')); assert(html.includes('js/bup.js?v=abc123'));
        assert(html.includes('/static/a.css?v=abc123')); assert(html.includes('src="https://example.org/a.js"'));
    });

    it('exports a stable snapshot in bounded pages while new logs continue arriving', async function() {
        for (let i = 0; i < 302; i++) hub.record({ source: 'server', message: 'export-marker-' + i, level: 'info' });
        await until(async () => (await hub.query({ search: 'export-marker-' })).total === 302);
        const first = await hub.query({ search: 'export-marker-', export: true });
        assert.strictEqual(first.items.length, 200); assert.strictEqual(first.total, 302);
        hub.record({ source: 'server', message: 'export-marker-0', level: 'info' });
        await until(async () => (await hub.query({ search: 'export-marker-0' })).items.some(row => row.count === 2));
        const second = await hub.query({ export_id: first.export_id, export_offset: first.next_offset });
        const all = [...first.items, ...second.items];
        assert.strictEqual(all.length, 302); assert.strictEqual(new Set(all.map(row => row.id)).size, 302);
        assert.strictEqual(all.find(row => row.message === 'export-marker-0').count, 1, 'the export retains its original immutable record');
        assert.strictEqual(second.next_offset, null);
    });

    it('rotates burst writes within three bounded files', async function() {
        hub.worker.send({ type: 'append', entries: Array.from({ length: 1100 }, (_, i) => ({ source: 'server', level: 'error', message: 'rotation-' + i + ' ' + 'x'.repeat(7000) })) });
        await until(async () => (await hub.query({ search: 'rotation-' })).total === 1100);
        const worker = hub.worker; hub.close(); await new Promise(resolve => worker.once('exit', resolve));
        const files = fs.readdirSync(directory).filter(file => file.endsWith('.jsonl'));
        assert.strictEqual(files.length, 3);
        assert(files.every(file => fs.statSync(path.join(directory, file)).size <= 2 * 1024 * 1024));
    });
});

describe('Browser reload safeguards', function() {
    it('reports a panel client ID only for BUP pages and updates it when the panel identity changes', function() {
        const h = browser();h.env.state = {settings:{devicemode:'umpire',client_id:'client_with_underscores'}};
        assert.strictEqual(h.api.context().panel_client_id, '');
        h.env.location.pathname = '/bup/';
        assert.strictEqual(h.api.context().panel_client_id, 'client_with_underscores');
        h.env.state.settings.client_id = 'another-client';
        assert.strictEqual(h.api.context().panel_client_id, 'another-client');
        h.env.location.pathname = '/bupdev/';
        assert.strictEqual(h.api.context().panel_client_id, 'another-client');
    });
    it('preserves unedited form baselines, blocks dirty forms and resumes when the form is closed', function() {
        const h = browser(), node = { type: 'text', value: 'original', isConnected: true, matches: () => true, closest: () => ({}) };
        h.handlers.focusin({ target: node }); node.value = 'changed'; h.handlers.input({ target: node });
        assert(h.api.blockedReason().includes('Ungespeicherte'));
        h.receive({ type: 'reload_prepare', id: 'command', delay_ms: 0, expires_at: Date.now() + 10000 });
        assert(h.ws.messages.some(msg => msg.type === 'reload_status' && msg.state === 'waiting'));
        assert(!h.env.reloaded); node.isConnected = false; h.api._tryReload();
        assert(h.ws.messages.some(msg => msg.type === 'reload_ready'));
        h.receive({ type: 'reload_go', id: 'command' });
        assert(h.env.reloaded.includes('_bts_reload=command')); assert(h.env.reloaded.endsWith('#test'));
    });

    it('defers running counting tablets and active speech, and rechecks edits after approval', function() {
        const h = browser();
        h.env.state = { initialized: true, settings: { devicemode: 'umpire' }, setup: { match_id: 'bts_match' }, presses: [], match: { finish_confirmed: false } };
        assert(h.api.blockedReason().includes('Zähltablet'));
        h.env.state.match.finish_confirmed = true;
        h.env.btsSpeechService = { isBusy: () => true }; assert(h.api.blockedReason().includes('Durchsage'));
        h.env.btsSpeechService.isBusy = () => false;
        h.receive({ type: 'reload_prepare', id: 'command', expires_at: Date.now() + 10000 });
        assert(h.ws.messages.some(msg => msg.type === 'reload_ready' && msg.guard.match_id === 'match'));
        h.env.state.presses.push({ type: 'score' }); h.receive({ type: 'reload_go', id: 'command' });
        assert(!h.env.reloaded, 'never reload after additional local input');
    });

    it('buffers offline errors, retains event identities and reports fallback reasons', function() {
        const h = browser(); h.api.record('warn', 'fallback', { reason: 'speech_timeout', playback_id: 'call-17' });
        for (const interval of h.intervals) interval();
        const batch = h.ws.messages.find(msg => msg.type === 'logs');
        assert(batch.entries[0].message.includes('speech_timeout')); assert.strictEqual(batch.entries[0].trace_id, 'call-17');
        h.ws.onclose(); h.handlers.pagehide();
        const backlog = JSON.parse(h.env.sessionStorage.getItem('bts_diagnostics_page:top:backlog'));
        assert(backlog.some(entry => entry.event_id === batch.entries[0].event_id));
    });

    it('gives an embedded view its own identity without overwriting its parent page identity', function() {
        const h = browser(), parentId = h.api.context().page_id;
        const child = createClient({ ...h.env, parent: h.env, frameElement: { id: 'embedded-registration' } }, 'v-test');
        assert.notStrictEqual(child.context().page_id, parentId);
        assert.strictEqual(h.env.sessionStorage.getItem('bts_diagnostics_page:top'), parentId);
    });

    it('bounds Unicode log batches by wire size', function() {
        const h = browser();
        for (let i = 0; i < 3; i++) h.api.record('error', '例'.repeat(8000));
        for (const interval of h.intervals) interval();
        const batch = h.ws.messages.find(msg => msg.type === 'logs');
        assert.strictEqual(batch.entries.length, 1);
        assert(Buffer.byteLength(JSON.stringify(batch)) < 32000);
        for (let i = 0; i < 250; i++) h.api.record('error', 'burst-' + i);
        assert(h.api.context().dropped > 0, 'buffer pressure must remain visible to the central page');
    });
});
