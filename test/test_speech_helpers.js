'use strict';
const assert = require('assert'), fs = require('fs/promises'), path = require('path'), os = require('os');
const http = require('http'), express = require('express'), { execFileSync } = require('child_process');
const { HelperPool, digest } = require('../bts/speech/helpers/pool');
const { bundle, zip } = require('../bts/speech/helpers/bundle');
const { wave } = require('./fixtures/speech_pcm');
const wav = () => wave([[100, 0], [500, 1200], [100, 0]]);
describe('Speech helper prototype', function() {
    let directory, pool, clock;
    beforeEach(async function() {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-helper-test-'));
        const data = Buffer.alloc(2048, 1);
        await fs.writeFile(path.join(directory, 'runtime.tar'), data);
        await fs.writeFile(path.join(directory, 'runtime.json'), JSON.stringify({ schema: 1, id: 'a'.repeat(64), sha256: digest(data), size_bytes: data.length }));
        clock = { now: 1700000000000 };
        pool = new HelperPool(directory, { now: () => clock.now }); await pool.ready;
    });
    afterEach(async function() { await pool.pending; await fs.rm(directory, { recursive: true, force: true }); });
    async function worker(number = 1) {
        const pair = await pool.pair();
        const registration = { device_id: String(number).repeat(32), protocol: 1, runtime_id: 'a'.repeat(64), name: 'Windows ' + number, platform: 'WSL 2', threads: 2 };
        return { ...await pool.register(pair.key, registration), pair, registration };
    }
    it('pairs one device, hides credentials, and resumes from persisted state', async function() {
        const agent = await worker();
        await assert.rejects(pool.register(agent.pair.key, { ...agent.registration, device_id: '2'.repeat(32) }), /pair_used/);
        const saved = await fs.readFile(path.join(directory, 'state.json'), 'utf8');
        assert(!saved.includes(agent.session)); assert(!saved.includes(agent.pair.key));
        const view = JSON.stringify(await pool.snapshot('default'));
        assert(!view.includes(agent.session)); assert(!view.includes('"session"'));
        const restarted = new HelperPool(directory, { now: () => clock.now }); await restarted.ready;
        assert.strictEqual(restarted.worker(agent.session).id, agent.worker_id);
    });
    it('runs independent work concurrently with one lease per helper and idempotent claim', async function() {
        const a = await worker(1), b = await worker(2);
        await pool.test('default', 'hallensprecher'); await pool.test('default', 'hallensprecherin');
        const first = (await pool.claim(a.session)).job, next = (await pool.claim(b.session)).job;
        assert.notStrictEqual(first.id, next.id);
        assert.deepStrictEqual((await pool.claim(a.session)).job, first);
        assert.strictEqual((await pool.snapshot('default')).jobs.filter(j => j.state === 'processing').length, 2);
        await pool.complete(a.session, first.id, first.lease, wav(), 1000);
        assert.strictEqual((await pool.claim(a.session)).job, null);
    });
    it('renews leases and rejects stale results after reassignment and after completion', async function() {
        const a = await worker(1), b = await worker(2);
        await pool.test('default', 'hallensprecher');
        const first = (await pool.claim(a.session)).job;
        clock.now += 80000; await pool.heartbeat(a.session, first.id, first.lease);
        clock.now += 80000; assert.strictEqual((await pool.claim(b.session)).job, null);
        clock.now += 10001;
        const replacement = (await pool.claim(b.session)).job;
        assert.strictEqual(replacement.id, first.id); assert.notStrictEqual(replacement.lease, first.lease);
        await assert.rejects(pool.complete(a.session, first.id, first.lease, wav(), 1), /lease_lost/);
        await pool.complete(b.session, replacement.id, replacement.lease, wav(), 2000);
        await pool.complete(b.session, replacement.id, replacement.lease, wav(), 2000);
        await assert.rejects(pool.complete(a.session, first.id, first.lease, wav(), 1), /lease_lost/);
        assert.strictEqual((await pool.snapshot('default')).workers.find(w => w.id === b.worker_id).completed, 1);
    });
    it('pauses after active work, revokes access, and makes abandoned work available', async function() {
        const a = await worker(1), b = await worker(2);
        await pool.test('default', 'hallensprecher');
        const first = (await pool.claim(a.session)).job;
        await pool.control(a.worker_id, 'pause'); await pool.heartbeat(a.session, first.id, first.lease);
        await pool.complete(a.session, first.id, first.lease, wav(), 20);
        await pool.test('default', 'hallensprecher'); assert.strictEqual((await pool.claim(a.session)).job, null);
        await pool.control(a.worker_id, 'resume'); assert((await pool.claim(a.session)).job);
        await pool.control(a.worker_id, 'revoke');
        await assert.rejects(pool.claim(a.session), /unauthorized/);
        await assert.rejects(pool.register(a.pair.key, a.registration), /pair_expired/);
        assert((await pool.claim(b.session)).job);
    });
    it('rejects incompatible runtimes, excessive parallelism and malformed WAVs', async function() {
        const pair = await pool.pair();
        const values = { protocol: 1, device_id: '1'.repeat(32), name: 'Test', runtime_id: 'b'.repeat(64), threads: 2 };
        await assert.rejects(pool.register(pair.key, values), /incompatible/);
        await assert.rejects(pool.register(pair.key, { ...values, runtime_id: 'a'.repeat(64), threads: 32 }), /incompatible/);
        await assert.rejects(pool.register(pair.key, { ...values, runtime_id: 'a'.repeat(64), memory_limit_mib: 2000 }), /incompatible/);
        const a = await worker(); await pool.test('default', 'hallensprecher'); const job = (await pool.claim(a.session)).job;
        await assert.rejects(pool.complete(a.session, job.id, job.lease, Buffer.from('invalid'), 10), /invalid_audio/);
        assert.strictEqual((await pool.snapshot('default')).jobs[0].state, 'processing');
    });
    it('reassigns queued targeted tests when their helper is disconnected', async function() {
        const a = await worker(1), b = await worker(2);
        await pool.test('default', 'hallensprecher', a.worker_id);
        assert.strictEqual((await pool.claim(b.session)).job, null);
        await pool.control(a.worker_id, 'revoke');
        assert((await pool.claim(b.session)).job);
    });
    it('keeps the locally selected budget when an existing session resumes', async function() {
        const a = await worker();
        await pool.resources(a.session, { threads: 4, memory_limit_mib: 4096 });
        const view = (await pool.snapshot('default')).workers[0];
        assert.strictEqual(view.threads, 4); assert.strictEqual(view.memory_limit_mib, 4096);
        await assert.rejects(pool.resources(a.session, { threads: 32, memory_limit_mib: 4096 }), /invalid_resources/);
        assert.strictEqual((await pool.snapshot('default')).workers[0].threads, 4);
    });
    it('reports obsolete helpers and releases queued tests when the runtime is replaced', async function() {
        const a = await worker(); await pool.test('default', 'hallensprecher', a.worker_id);
        const file = path.join(directory, 'runtime.json'), runtime = JSON.parse(await fs.readFile(file));
        await fs.writeFile(file, JSON.stringify({ ...runtime, id: 'c'.repeat(64) }));
        const view = await pool.snapshot('default');
        assert.strictEqual(view.workers[0].update_required, true);
        assert.strictEqual(view.jobs[0].state, 'failed');
        assert.strictEqual(view.jobs[0].error, 'helper_update_required');
        await assert.rejects(pool.claim(a.session), /update_required/);
        await assert.rejects(pool.test('default', 'hallensprecher', a.worker_id), /update_required/);
    });
    it('creates a valid small ZIP with prefilling, and refuses localhost downloads', async function() {
        await assert.rejects(bundle(pool, 'https://localhost:4434', 'f'.repeat(64)), /not_reachable/);
        await assert.rejects(bundle(pool, 'https://127.0.0.2:4434', 'f'.repeat(64)), /not_reachable/);
        const result = await bundle(pool, 'https://bts.example:4434', 'f'.repeat(64), 'zip');
        const decoded = execFileSync('python3', ['-c', 'import sys,io,json,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({"names":z.namelist(),"config":json.loads(z.read("helper.json"))}))'],
            { input: Buffer.from(result.zip_base64, 'base64') });
        const value = JSON.parse(decoded);
        assert.deepStrictEqual(value.names, ['Start.cmd', 'Start.ps1', 'Window.ps1', 'Worker.ps1', 'Plan.ps1', 'Runtime.cs', 'README.txt', 'RUECKNAHME.txt', 'helper.json']);
        assert.strictEqual(value.config.endpoint, 'https://bts.example:4434');
        assert.strictEqual(value.config.certificate_sha256, 'f'.repeat(64));
        assert(value.config.bootstrap.length >= 43); assert(Buffer.byteLength(result.zip_base64) < 100000);
        assert.strictEqual(zip({ a: 'hello' }).readUInt32LE(), 0x04034b50);
    });
    it('creates a single Windows GUI EXE with checked personal payload', async function() {
        const result = await bundle(pool, 'https://bts.example:4434', 'f'.repeat(64));
        assert.strictEqual(result.filename, 'BTS-Sprachhelfer-Windows.exe');
        const bytes = Buffer.from(result.content_base64, 'base64');
        assert.strictEqual(bytes.toString('ascii', 0, 2), 'MZ');
        const pe = bytes.readUInt32LE(0x3c);
        assert.strictEqual(bytes.toString('ascii', pe, pe + 4), 'PE\0\0');
        assert.strictEqual(bytes.readUInt16LE(pe + 24 + 68), 2, 'GUI subsystem, no console window');
        const trailer = bytes.subarray(-56), size = Number(trailer.readBigInt64LE());
        assert.strictEqual(trailer.toString('ascii', 40), 'BTSHELPER-EXE-1!');
        const payload = bytes.subarray(bytes.length - 56 - size, bytes.length - 56);
        assert.strictEqual(digest(payload), trailer.subarray(8, 40).toString('hex'));
        const info = JSON.parse(execFileSync('python3', ['-c', 'import sys,io,json,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({"names":z.namelist(),"config":json.loads(z.read("helper.json"))}))'], { input: payload }));
        assert(!info.names.includes('Start.cmd')); assert(info.names.includes('Window.ps1'));
        assert.strictEqual(info.config.endpoint, 'https://bts.example:4434');
        assert(Buffer.byteLength(result.content_base64) < 100000);
    });
    it('creates a single Linux shell file whose information mode writes no app files', async function() {
        await assert.rejects(bundle(pool, 'https://bts.example:4434', 'f'.repeat(64), 'other'), /platform_invalid/);
        const result = await bundle(pool, 'https://bts.example:4434', 'f'.repeat(64), 'linux');
        assert.strictEqual(result.filename, 'BTS-Sprachhelfer-Linux.sh');
        const script = path.join(directory, result.filename), data = path.join(directory, 'linux-data');
        await fs.writeFile(script, Buffer.from(result.content_base64, 'base64'));
        execFileSync('sh', ['-n', script]);
        const text = execFileSync('bash', [script, '--info'], { env: { ...process.env, XDG_DATA_HOME: data }, encoding: 'utf8' });
        assert(text.includes('https://bts.example:4434')); assert(text.includes('Strg+C'));
        assert(text.includes('Modell-RAM')); assert(!text.includes('bootstrap'));
        await assert.rejects(fs.stat(data), { code: 'ENOENT' });
    });
    it('serves protected runtime ranges, accepts returned audio, and scopes playback grants', async function() {
        const app = express(); require('../bts/speech/helpers/http').routes(app, pool);
        const server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = 'http://127.0.0.1:' + server.address().port + '/speech-helper/v1';
        try {
            const a = await worker();
            assert.strictEqual((await fetch(base + '/runtime')).status, 401);
            const asset = await fetch(base + '/runtime', { headers: { Authorization: 'Bearer ' + a.pair.key, Range: 'bytes=0-99' } });
            assert.strictEqual(asset.status, 206); assert.strictEqual((await asset.arrayBuffer()).byteLength, 100);
            await pool.test('default', 'hallensprecher'); const job = (await pool.claim(a.session)).job;
            const response = await fetch(base + '/jobs/' + job.id + '/result', { method: 'POST', headers: {
                Authorization: 'Bearer ' + a.session, 'Content-Type': 'audio/wav', 'X-Helper-Lease': job.lease,
            }, body: wav() });
            assert.strictEqual(response.status, 200);
            const view = (await pool.snapshot('default')).jobs[0];
            assert.strictEqual((await fetch(base.replace('/speech-helper/v1', '') + view.audio_path)).status, 200);
            assert.strictEqual((await fetch(base + '/audio/' + job.id + '?expires=1700000300&grant=bad')).status, 401);
        } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    });
});
