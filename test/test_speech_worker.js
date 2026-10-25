'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync, spawnSync, spawn } = require('child_process');
const WebSocket = require('ws');
const express = require('express');
const { promisify } = require('util');
const database = require('../bts/database');
const { create, handle } = require('../bts/speech');
const { capture, deliver } = require('../bts/speech/snapshot');
const { configuration } = require('../bts/speech/broker');
const compact = require('../bts/speech/playback');
const { wave } = require('./fixtures/speech_pcm');
const KEY = 'worker-fixture-' + 'x'.repeat(32);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await check();
        if (result) return result;
        await delay(20);
    }
    throw new Error('speech_worker_test_timeout');
}
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => server.close(resolve));
const rpc = (app, message, ws = {}) => new Promise(resolve => handle(app,
    { speech_tournament_key: 'default', ...ws, respond: (_msg, _err, response) => resolve(response) },
    { tournament_key: 'default', ...message }));

async function fixture(tls = false, context_version = null, worker_type = 'process') {
    const db = await database.init_test();
    await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'default', name: 'Worker-Test', language: 'de', announcement_speech_mode: 'auto' });
    const wav = wave([[300, 0], [100, 1000], [400, 0], [100, 1000], [300, 0]]);
    const jobs = new Map(), posts = [];
    let outstanding = null, violations = 0;
    const upstream = http.createServer((req, res) => {
        assert.strictEqual(req.headers['x-api-key'], KEY);
        const json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
        if (req.url === '/health') return json({ model: 'fixture', model_revision: '1', context_version });
        if (req.url === '/v1/voices') return json({ voices: ['hallensprecherin', 'hallensprecher'].map(voice_id => ({ voice_id, version: '1', languages: ['de-DE'] })) });
        if (req.url === '/v1/speech') {
            const chunks = [];
            req.on('data', data => chunks.push(data));
            req.on('end', () => {
                if (outstanding) violations++;
                const body = JSON.parse(Buffer.concat(chunks));
                const job_id = crypto.createHash('md5').update(body.text + body.voice).digest('hex');
                const job = { ...body, job_id, status: 'processing' };
                jobs.set(job_id, job); posts.push(body); outstanding = job_id;
                res.statusCode = 202; json(job);
            });
            return;
        }
        if (req.url.startsWith('/v1/jobs/')) {
            const job = jobs.get(req.url.split('/').pop());
            outstanding = null;
            return json({ ...job, status: 'completed', audio: { audio_id: job.job_id, processed: !!job.context } });
        }
        if (req.url.startsWith('/v1/audio/')) { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); return; }
        res.statusCode = 404; res.end();
    });
    await listen(upstream);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-speech-worker-'));
    const app = express();
    app.db = db;
    app.config = { speech: { enabled: true, api_key: KEY, url: 'http://127.0.0.1:' + upstream.address().port,
        cache_dir: directory, poll_interval_ms: 500, submit_interval_ms: 500, worker_type } };
    if (tls) {
        const key = path.join(directory, 'test.key'), cert = path.join(directory, 'test.crt');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
            '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
        Object.assign(app.config, { enable_https: true, https_key: key, https_cert: cert, https_port: 0 });
    }
    app.speech = create(app);
    const server = http.createServer(app); await listen(server);
    app.speech.start();
    const base = 'http://127.0.0.1:' + server.address().port;
    const audioURL = pathname => {
        const endpoint = app.speech.public_config().audio_endpoint;
        return endpoint.protocol + '//127.0.0.1:' + endpoint.port + pathname;
    };
    return { app, db, server, wav, base, audioURL, posts, violations: () => violations, stopUpstream: () => close(upstream),
        close: async () => { app.speech.stop(); await close(server); await close(upstream); fs.rmSync(directory, { recursive: true, force: true }); } };
}

describe('Isolated speech management', function() {
    this.timeout(20000);

    it('keeps an existing speech plan running when multiple admin windows load it', async function() {
        const f = await fixture();
        try {
            await until(async () => {
                const reply = await rpc(f.app, { type: 'speech_planning' });
                return reply.planning?.stages?.length > 0 && !reply.planning.updating;
            });
            const before = f.app.speech.diagnostics().snapshots;
            for (let i = 0; i < 10; i++) f.app.speech.loaded({ key: 'default' }, {});
            await delay(750);
            const reply = await rpc(f.app, { type: 'speech_planning' });
            assert.strictEqual(f.app.speech.diagnostics().snapshots, before, 'loading unchanged pages must not rebuild and block the inventory');
            assert.strictEqual(reply.planning.updating, false);
            f.app.speech.changed('default', 'matches_changed', {});
            await until(() => f.app.speech.diagnostics().snapshots > before);
        } finally { await f.close(); }
    });

    it('serves game readiness and requested details through the isolated speech process', async function() {
        const f = await fixture();
        try {
            await promisify(f.db.courts.insert.bind(f.db.courts))({ _id: 'court', tournament_key: 'default', num: 1, is_active: true });
            await promisify(f.db.matches.insert.bind(f.db.matches))([2, 1].map(number => ({ _id: 'game-' + number,
                tournament_key: 'default', match_order: number, setup: { state: 'scheduled', is_match: true,
                    match_num: number, court_id: 'court', teams: [{ players: [{ name: 'Anna Beispiel' }] }, { players: [{ name: 'Berta Muster' }] }] } })));
            f.app.speech.loaded({ key: 'default' }, {});
            const first = await until(async () => {
                const response = await rpc(f.app, { type: 'speech_games', match_id: 'game-1' });
                return response.games?.items?.length === 2 && response;
            });
            assert.deepStrictEqual(first.games.items.map(game => game.number), [1, 2]);
            assert.strictEqual(first.games.detail.id, 'game-1');
            assert(first.games.detail.announcements.some(call => call.group === 'D03'));
            const next = await rpc(f.app, { type: 'speech_games', match_id: 'game-2', revision: first.games.revision });
            assert.strictEqual(next.games.detail.id, 'game-2', 'the bridge must retain match_id even when rows did not change');
            assert(next.games.items || next.games.unchanged === true);
            assert.strictEqual((await rpc(f.app, { type: 'speech_games', match_id: {} })).speech_error, 'invalid_speech_request');
        } finally { await f.close(); }
    });

    it('copies only speech data without entering datastore executors, and yields between deliveries', async function() {
        const db = await database.init_test();
        await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'default', language: 'de', btp_password: 'private' });
        await promisify(db.matches.insert.bind(db.matches))(Array.from({ length: 40 }, (_, i) => ({ _id: String(i), tournament_key: 'default',
            setup: { state: 'scheduled' }, presses: [{ huge: 'history' }], networkstats: { large: true } })));
        for (const store of Object.values(db)) if (store?.executor) store.executor.push = () => { throw new Error('speech must not enqueue datastore work'); };
        const values = capture({ db }, 'default');
        assert.strictEqual(values[3].length, 40);
        assert(!JSON.stringify(values).includes('history'));
        assert(!JSON.stringify(values).includes('private'));
        let turns = 0;
        const chunks = [];
        await deliver({ db }, 'default', chunk => { chunks.push(chunk); setImmediate(() => turns++); });
        assert(chunks.at(-1).done);
        assert(chunks.filter(chunk => chunk.collection === 3).every(chunk => chunk.documents.length <= 16));
        assert(turns >= 3);
    });

    it('completes speech planning and generation while tournament datastore executors are held', async function() {
        const f = await fixture();
        const releases = [], restores = [], attempts = [];
        try {
            await until(() => f.app.speech.public_config().audio_endpoint);
            for (const [name, store] of Object.entries(f.db)) if (store?.executor) {
                const executor = store.executor, push = executor.push;
                // Hold every database queue so even an accidental read would
                // wait forever. Capture attempts separately instead of timing
                // the test against machine load or fake synthesis throughput.
                await new Promise(resolve => push.call(executor, { this: store, arguments: [], fn: done => {
                    releases.push(done); resolve();
                } }));
                executor.push = () => { attempts.push(name); throw new Error('speech entered a tournament datastore executor'); };
                restores.push(() => { executor.push = push; });
            }
            const before = f.app.speech.diagnostics().snapshots;
            f.app.speech.changed('default', 'matches_changed', {});
            await rpc(f.app, { type: 'speech_resolve', parts: ['Unabhängige Sprachprobe'], voice: 'hallensprecherin' });
            await until(async () => {
                const response = await rpc(f.app, { type: 'speech_status', parts: ['Unabhängige Sprachprobe'], audio_urls: true });
                return response.clips?.[0]?.status === 'completed' && response.clips[0].local;
            });
            await until(async () => {
                const response = await rpc(f.app, { type: 'speech_planning' });
                return f.app.speech.diagnostics().snapshots > before && response.planning?.stages?.length > 0;
            });
            assert(f.posts.some(post => post.text === 'Unabhängige Sprachprobe'));
            assert.deepStrictEqual(attempts, [], 'planning, completion notifications and cache persistence must not enqueue tournament DB work');
            for (const store of Object.values(f.db)) if (store?.executor) assert.strictEqual(store.executor.queue.running(), 1);
        } finally {
            restores.forEach(restore => restore());
            releases.forEach(release => release());
            await f.close();
        }
    });

    it('transfers only changed revisions and removals on subsequent snapshots', async function() {
        const db = await database.init_test(), state = {}, chunks = [];
        await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'default', language: 'de' });
        await promisify(db.matches.insert.bind(db.matches))([{ _id: 'a', tournament_key: 'default', setup: { state: 'scheduled' } },
            { _id: 'b', tournament_key: 'default', setup: { state: 'scheduled' } }]);
        const send = chunk => { chunks.push(chunk); };
        await deliver({ db }, 'default', send, state);
        chunks.length = 0;
        await deliver({ db }, 'default', send, state);
        assert.deepStrictEqual(chunks, [{ done: true }], 'unchanged documents must never be cloned again');
        chunks.length = 0;
        await db.matches.update_async({ _id: 'a' }, { $set: { 'setup.state': 'preparation' } }, {});
        await promisify(db.matches.remove.bind(db.matches))({ _id: 'b' }, {});
        await deliver({ db }, 'default', send, state);
        assert.deepStrictEqual(chunks.filter(chunk => chunk.removed).flatMap(chunk => chunk.removed), ['b']);
        assert.deepStrictEqual(chunks.filter(chunk => chunk.collection === 3).flatMap(chunk => chunk.documents).map(doc => doc._id), ['a']);
    });

    it('calculates all speech candidates in the worker from rules, BTP order and tournament time without a UI selection', async function() {
        const f = await fixture();
        try {
            f.app.clock = { now_ms: () => Date.parse('2099-01-01T10:00:00') };
            await f.db.tournaments.update_async({ key: 'default' }, { $set: {
                preparation_call_matches_ahead_of_frontier_enabled: true, preparation_call_matches_ahead_of_frontier_limit: 1,
                preparation_call_time_limit_before_scheduled_enabled: true, preparation_call_time_limit_before_scheduled_minutes: 0,
            } }, {});
            await promisify(f.db.locations.insert.bind(f.db.locations))({ _id: 'hall', tournament_key: 'default' });
            await promisify(f.db.courts.insert.bind(f.db.courts))({ _id: 'court', tournament_key: 'default', location_id: 'hall', is_active: true });
            await promisify(f.db.matches.insert.bind(f.db.matches))(Array.from({ length: 5 }, (_, i) => ({
                _id: 'game-' + i, tournament_key: 'default', match_order: i === 0 ? 9 : i === 4 ? 0 : i,
                setup: { state: i === 0 ? 'preparation' : 'scheduled', is_match: true, incomplete: i === 2,
                    match_num: 10 - i, location_id: 'hall', scheduled_date: '2099-01-01', scheduled_time_str: '10:00',
                    teams: [0, 1].map(side => ({ players: i === 2 ? [] : [{ name: 'Spieler ' + i + ' ' + side }] })),
                },
            })));
            f.app.speech.changed('default', 'matches_changed', {});
            const before = await until(async () => {
                const reply = await rpc(f.app, { type: 'speech_planning' });
                return reply.planning?.games.candidate === 2 && reply.planning;
            });
            assert(before.stages.find(stage => stage.id === 'candidate').total > 0);
            assert.strictEqual(before.games.preparation, 1);
            assert.strictEqual(before.games.planned, 2);
            const gameStatus = (await rpc(f.app, { type: 'speech_games' })).games;
            assert.strictEqual(gameStatus.items.filter(game => game.match_state === 'candidate').length, before.games.candidate);
            await f.db.tournaments.update_async({ key: 'default' }, { $set: { preparation_call_matches_ahead_of_frontier_limit: 0 } }, {});
            f.app.speech.changed('default', 'props', {});
            await until(async () => (await rpc(f.app, { type: 'speech_planning' })).planning?.games.candidate === 1);
            assert.strictEqual((await f.db.matches.findOne_async({ _id: 'game-1' })).setup.state, 'scheduled',
                'speech inventory must never actually call a candidate');
        } finally { await f.close(); }
    });

    it('uses the browser pronunciation order for overlapping rules and preserves it across snapshot updates', async function() {
        const f = await fixture(false, 'bts-context-v2');
        try {
            const rules = [{ _id: 'Z-general', origin: 'Ng', replace: 'Nick', language: 'de-DE' },
                { _id: 'j-specific', origin: 'Nguyen', replace: 'Nuehjen', language: 'de-DE' }];
            await promisify(f.db.normalizations.insert.bind(f.db.normalizations))(rules);
            const setup = { state: 'oncourt', is_match: true, match_num: 20,
                teams: [{ players: [{ name: 'Max' }] }, { players: [{ name: 'Trung Nguyen Duc' }, { name: 'Mathilda Groskopf' }] }] };
            await promisify(f.db.matches.insert.bind(f.db.matches))({ _id: 'game-20', tournament_key: 'default', setup });
            f.app.speech.changed('default', 'matches_changed', {});
            await until(async () => {
                const response = await rpc(f.app, { type: 'speech_planning' });
                return response.planning?.games.oncourt === 1 && f.app.speech.public_config().context_version === 'bts-context-v2';
            });
            const browserPart = async expected => {
                const normalizations = await promisify(f.db.normalizations.find.bind(f.db.normalizations))({});
                const parts = [];
                require('../bts/speech/text').renderer({ normalizations, speech: { context_version: 'bts-context-v2' } }, 'de', parts)
                    .announceSecondCallTeamTwo(setup);
                const part = parts[1];
                assert.strictEqual(require('../bts/speech/context').decode(part, 1200).text, expected);
                const response = await rpc(f.app, { type: 'speech_status', parts: [part] });
                return response.clips[0].status;
            };
            assert.notStrictEqual(await browserPart('Trung Nickuyen Duc und Mathilda Groskopf'), 'missing',
                'the actual browser recipe must already belong to the worker plan');
            await promisify(f.db.normalizations.remove.bind(f.db.normalizations))({ _id: 'Z-general' }, {});
            f.app.speech.changed('default', 'normalization_removed', {});
            await until(async () => (await browserPart('Trung Nuehjen Duc und Mathilda Groskopf')) !== 'missing');
            await promisify(f.db.normalizations.insert.bind(f.db.normalizations))({ _id: 'A-first', origin: 'Nguyen', replace: 'Nu', language: 'de-DE' });
            f.app.speech.changed('default', 'normalization_add', {});
            await until(async () => (await browserPart('Trung Nu Duc und Mathilda Groskopf')) !== 'missing');
            assert.deepStrictEqual((await promisify(f.db.normalizations.find.bind(f.db.normalizations))({})).map(n => n.origin), ['Nguyen', 'Nguyen'],
                'snapshot delivery leaves the saved rules unchanged');
        } finally { await f.close(); }
    });

    it('keeps existing inline operation available as a rollback', async function() {
        const db = await database.init_test();
        const app = { db, config: { speech: { enabled: true, api_key: KEY, worker: false } } };
        const service = create(app);
        assert(service.broker.entries instanceof Map);
        assert.strictEqual(configuration({ worker: false }, { BTS_SPEECH_WORKER: '1' }).worker, true);
        assert.strictEqual(configuration({}, { BTS_SPEECH_WORKER: '0' }).worker, false);
        assert.strictEqual(configuration({}, {}).worker_type, 'process');
        assert.strictEqual(configuration({ worker_type: 'thread' }, {}).worker_type, 'thread');
        assert.strictEqual(configuration({ worker_type: 'thread' }, { BTS_SPEECH_WORKER_TYPE: 'process' }).worker_type, 'process');
        service.stop();
    });

    it('uses a separate process for speech and reports only small bridge diagnostics', async function() {
        const f = await fixture();
        try {
            await until(() => f.app.speech.public_config().audio_endpoint);
            const metrics = f.app.speech.diagnostics();
            assert.strictEqual(metrics.execution, 'process');
            assert(Number.isInteger(metrics.pid));
            assert.notStrictEqual(metrics.pid, process.pid);
            assert.strictEqual(metrics.thread_id, null);
            assert(metrics.sent > 0);
            assert(!JSON.stringify(metrics).includes(KEY));
        } finally { await f.close(); }
    });

    it('retains thread isolation as an explicit comparison mode', async function() {
        const f = await fixture(false, null, 'thread');
        try {
            await until(() => f.app.speech.public_config().audio_endpoint);
            const metrics = f.app.speech.diagnostics();
            assert.strictEqual(metrics.execution, 'thread');
            assert.strictEqual(metrics.pid, null);
            assert(Number.isInteger(metrics.thread_id));
            const response = await rpc(f.app, { type: 'speech_status', parts: [] });
            assert.strictEqual(response.speech.enabled, true);
        } finally { await f.close(); }
    });

    it('encodes speech replies in the existing background outbox when available', async function() {
        const f = await fixture();
        try {
            const result = await new Promise(resolve => handle(f.app, { speech_tournament_key: 'default',
                respond() { throw new Error('speech reply used the synchronous encoder'); },
                respond_background(_request, error, reply) { assert.ifError(error); resolve(reply); },
            }, { type: 'speech_queue', tournament_key: 'default' }));
            assert(Array.isArray(result.queue.items));
        } finally { await f.close(); }
    });

    it('closes the speech audio listener when its parent process exits', async function() {
        const adapter = require.resolve('../bts/offload/process'), entry = require.resolve('../bts/speech/process');
        const config = configuration({ enabled: true, api_key: KEY, cache_enabled: false, url: 'http://127.0.0.1:1' }, {});
        const source = `const Worker = require(${JSON.stringify(adapter)});
            const worker = new Worker(${JSON.stringify(entry)}, {workerData: {
                config: ${JSON.stringify(config)}, signing_key: Buffer.alloc(32), listener: {host:'127.0.0.1',port:0}
            }});
            worker.on('message', message => {
                if(message.type==='ready') process.stdout.write(JSON.stringify({port: message.configs[0][1].audio_endpoint.port})+'\\n', () => process.exit(0));
            });`;
        const parent = spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'ignore'] });
        try {
            const output = await new Promise((resolve, reject) => {
                let bytes = '';
                parent.stdout.on('data', chunk => { bytes += chunk; });
                parent.on('error', reject);
                parent.on('exit', code => code === 0 ? resolve(JSON.parse(bytes)) : reject(new Error('fixture parent failed')));
            });
            await until(async () => {
                try { await fetch('http://127.0.0.1:' + output.port); return false; }
                catch (_) { return true; }
            });
        } finally { parent.kill(); }
    });

    it('records speech bridge and snapshot timings without text or credentials', async function() {
        const traces = require('../bts/performance/traces'), f = await fixture();
        try {
            traces.disable(); traces.enable();
            await rpc(f.app, { type: 'speech_status', parts: ['Private fixture text'] });
            await until(() => traces.snapshot(0).completed.some(row => row.name === 'speech_snapshot'));
            const rows = traces.snapshot(0).completed;
            assert(rows.some(row => row.name === 'speech_request' && row.spans.some(span => span.name === 'speech_bridge_send')));
            assert(rows.some(row => row.name === 'speech_request' && row.ctype === 'speech_status'));
            assert(rows.some(row => row.name === 'speech_snapshot' && row.spans.some(span => span.name === 'speech_snapshot_collect')));
            assert(!JSON.stringify(rows).includes('Private fixture text'));
            assert(!JSON.stringify(rows).includes(KEY));
        } finally { traces.disable(); await f.close(); }
    });

    it('prepares, polls, signs and streams worker-owned cached audio, with read-only inspection and one upstream job', async function() {
        const f = await fixture();
        try {
            assert(f.app.speech.worker);
            assert.strictEqual(f.app.speech.broker.entries, undefined);
            const denied = await rpc(f.app, { type: 'speech_prepare', parts: ['Test'] }, { speech_tournament_key: 'other' });
            assert.strictEqual(denied.speech_error, 'tournament_not_loaded');
            const malformed = await rpc(f.app, { type: 'speech_prepare', parts: Array(65).fill('Test') });
            assert.strictEqual(malformed.speech_error, 'invalid_speech_request');
            const missing = await rpc(f.app, { type: 'speech_status', parts: ['Nicht generieren'] });
            assert.strictEqual(missing.clips[0].status, 'missing');
            await rpc(f.app, { type: 'speech_resolve', parts: ['Test acht'], voice: 'hallensprecherin' });
            const response = await until(async () => {
                const value = await rpc(f.app, { type: 'speech_status', parts: ['Test acht'], audio_urls: true });
                return value.clips[0].status === 'completed' && value;
            });
            assert(!JSON.stringify(response).includes(KEY));
            const url = response.clips[0].audio_url;
            const audio = await fetch(f.audioURL(url));
            assert.strictEqual(audio.status, 200);
            assert.deepStrictEqual(Buffer.from(await audio.arrayBuffer()), f.wav);
            const range = await fetch(f.audioURL(url), { headers: { Range: 'bytes=0-3' } });
            assert.strictEqual(range.status, 206);
            assert.strictEqual(await range.text(), 'RIFF');
            assert.strictEqual((await fetch(f.audioURL(url.replace('signature=', 'signature=bad')))).status, 401);
            assert.strictEqual((await fetch(f.base + url)).status, 404, 'the main server must never serve the WAV');
            const inventory = await rpc(f.app, { type: 'speech_inventory', requests: [{ kind: 'components' }] });
            assert(inventory.inventories);
            const planning = await rpc(f.app, { type: 'speech_planning' });
            assert(planning.planning);
            const pending = await rpc(f.app, { type: 'speech_queue', pending_only: true });
            assert.strictEqual(pending.queue.coverage, undefined);
            assert(pending.queue.items.every(item => item.status !== 'completed'));
            assert(!f.posts.some(post => post.text === 'Nicht generieren'));
            assert.strictEqual(f.violations(), 0);
            // The worker both compacts and serves the male playback copy.
            await f.db.tournaments.update_async({ key: 'default' }, { $set: { announcement_speech_voice: 'hallensprecher' } }, {});
            f.app.speech.configure({ key: 'default', announcement_speech_voice: 'hallensprecher' });
            await rpc(f.app, { type: 'speech_resolve', parts: ['Test acht'], voice: 'hallensprecher' });
            const male = await until(async () => {
                const value = await rpc(f.app, { type: 'speech_status', parts: ['Test acht'], voice: 'hallensprecher', audio_urls: true });
                return value.clips[0].status === 'completed' && value.clips[0];
            });
            const result = await fetch(f.audioURL(male.audio_url));
            const body = Buffer.from(await result.arrayBuffer());
            assert.deepStrictEqual(body, compact(f.wav, true));
            assert.strictEqual(result.headers.get('access-control-allow-origin'), '*');
            assert.strictEqual(result.headers.get('etag'), '"' + crypto.createHash('sha256').update(body).digest('hex') + '"');
            assert(body.length < f.wav.length);
            assert.strictEqual(f.app.speech.broker.compact, undefined, 'there is no audio transfer operation to the main thread');
        } finally { await f.close(); }
    });

    it('recovers from worker exit, preserves audio grants and serves the disk cache after restart', async function() {
        const f = await fixture();
        try {
            await rpc(f.app, { type: 'speech_resolve', parts: ['Bleibt erhalten'] });
            const clip = await until(async () => {
                const value = await rpc(f.app, { type: 'speech_status', parts: ['Bleibt erhalten'], audio_urls: true });
                return value.clips[0].status === 'completed' && value.clips[0];
            });
            await f.stopUpstream();
            const old = f.app.speech.worker;
            const send = old.postMessage;
            old.postMessage = () => {}; // Keep a request pending at the moment of exit.
            const pending = f.app.speech.request({ type: 'speech_queue', tournament_key: 'default' });
            old.postMessage = send;
            const rejected = assert.rejects(pending, /speech_unavailable/);
            await old.terminate();
            await rejected;
            await until(() => f.app.speech.worker && f.app.speech.worker !== old);
            await until(() => f.app.speech.public_config().audio_endpoint);
            await until(async () => {
                const result = await fetch(f.audioURL(clip.audio_url));
                return result.status === 200 && Buffer.from(await result.arrayBuffer()).equals(f.wav);
            });
            assert.strictEqual(f.violations(), 0);
            f.app.speech.stop();
            await assert.rejects(f.app.speech.request({ type: 'speech_queue', tournament_key: 'default' }), /speech_unavailable/);
        } finally { await f.close(); }
    });

    it('serves HTTPS audio in the worker using the configured BTS certificate', async function() {
        if (spawnSync('openssl', ['version']).status !== 0) this.skip();
        const f = await fixture(true);
        try {
            await rpc(f.app, { type: 'speech_resolve', parts: ['TLS Test'] });
            const clip = await until(async () => {
                const value = await rpc(f.app, { type: 'speech_status', parts: ['TLS Test'], audio_urls: true });
                return value.clips[0].status === 'completed' && value.clips[0];
            });
            assert.strictEqual(f.app.speech.public_config().audio_endpoint.protocol, 'https:');
            const audio = await new Promise((resolve, reject) => https.get(f.audioURL(clip.audio_url), { rejectUnauthorized: false }, res => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
                res.on('error', reject);
            }).on('error', reject));
            assert.strictEqual(audio.status, 200);
            assert.deepStrictEqual(audio.body, f.wav);
        } finally { await f.close(); }
    });

    it('uses the existing admin WebSocket for control while the browser downloads from the worker', async function() {
        const f = await fixture();
        const wss = new WebSocket.Server({ server: f.server });
        wss.on('connection', ws => require('../bts/wshandler').handle(require('../bts/admin'), f.app, ws));
        const client = new WebSocket(f.base.replace('http:', 'ws:') + '/ws/admin');
        let rid = 0;
        const send = message => new Promise((resolve, reject) => {
            const id = ++rid;
            const timer = setTimeout(() => { client.off('message', receive); reject(new Error('ws_timeout')); }, 5000);
            const receive = data => {
                const response = JSON.parse(data);
                if (response.rid !== id) return;
                clearTimeout(timer); client.off('message', receive);
                if (response.type === 'error') reject(new Error(response.message)); else resolve(response);
            };
            client.on('message', receive);
            client.send(JSON.stringify({ ...message, rid: id }));
        });
        try {
            await new Promise(resolve => client.once('open', resolve));
            const loaded = await send({ type: 'tournament_get', key: 'default' });
            assert.strictEqual(loaded.tournament.speech.enabled, true);
            await send({ type: 'speech_resolve', tournament_key: 'default', parts: ['WebSocket Steuerung'] });
            const response = await until(async () => {
                const value = await send({ type: 'speech_status', tournament_key: 'default', parts: ['WebSocket Steuerung'], audio_urls: true });
                return value.clips?.[0]?.status === 'completed' && value;
            });
            assert(response.speech.audio_endpoint.port !== f.server.address().port);
            const audio = await fetch(f.audioURL(response.clips[0].audio_url));
            assert.deepStrictEqual(Buffer.from(await audio.arrayBuffer()), f.wav);
            assert(!JSON.stringify(response).includes(KEY));
        } finally {
            client.terminate();
            await new Promise(resolve => wss.close(resolve));
            await f.close();
        }
    });

    it('keeps the main server usable when the audio port is already occupied', async function() {
        const reserved = http.createServer((_req, res) => res.end('main still works'));
        await listen(reserved);
        const db = await database.init_test();
        const service = create({ db, config: { speech: { enabled: true, api_key: KEY, audio_port: reserved.address().port,
            url: 'http://127.0.0.1:' + reserved.address().port } } });
        const error = console.error, messages = [];
        console.error = (...args) => messages.push(args);
        try {
            service.start();
            await until(() => service.restart_timer);
            assert.strictEqual(service.public_config().last_error, 'speech_unavailable');
            assert(service.health.snapshot().issues.some(issue => issue.code === 'EADDRINUSE'));
            assert(messages.some(row => row.join(' ').includes('EADDRINUSE')));
            assert.strictEqual(await (await fetch('http://127.0.0.1:' + reserved.address().port)).text(), 'main still works');
        } finally { service.stop(); await close(reserved); console.error = error; }
    });
});
