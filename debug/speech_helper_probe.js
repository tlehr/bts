'use strict';
// Real packaged agents, private BTS speech process, two parallel native jobs.
// No production tournament database, BTP connection or regular audio cache.
const fs = require('fs/promises'), path = require('path'), os = require('os'), assert = require('assert');
const http = require('http'), https = require('https'), crypto = require('crypto'), express = require('express');
const { spawn, execFileSync } = require('child_process');
const { promisify } = require('util');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rpc = (app, type, fields = {}) => new Promise(resolve => require('../bts/speech').handle(app,
    { speech_tournament_key: 'default', respond: (_msg, _err, value) => resolve(value) }, { type, tournament_key: 'default', ...fields }));
function configFromZip(encoded) {
    const zip = Buffer.from(encoded, 'base64');
    for (let offset = 0; zip.readUInt32LE(offset) === 0x04034b50;) {
        const size = zip.readUInt32LE(offset + 18), names = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
        const start = offset + 30 + names + extra;
        if (zip.toString('utf8', offset + 30, offset + 30 + names) === 'helper.json') {
            const data = zip.subarray(start, start + size);
            return JSON.parse(zip.readUInt16LE(offset + 8) === 8 ? require('zlib').inflateRawSync(data) : data);
        }
        offset = start + size;
    }
    throw new Error('Missing helper configuration');
}
async function main(rootfs, artifactDir, controlled = false) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-helper-probe-'));
    const children = [], logs = [], samples = [];
    let app, upstream, overlap = false;
    const report = { directory, rootfs, status: 'running', started_at: new Date().toISOString(), steps: [] };
    try {
        const cache = path.join(directory, 'speech-cache'); await fs.mkdir(path.join(cache, 'helpers'), { recursive: true });
        for (const name of ['runtime.tar', 'runtime.json']) await fs.symlink(path.join(artifactDir, name), path.join(cache, 'helpers', name));
        const cert = path.join(directory, 'test.crt'), key = path.join(directory, 'test.key');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
            '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
        upstream = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(req.url === '/health' ? { backend: 'probe', model: 'probe', model_revision: '1' } :
                { voices: ['hallensprecherin', 'hallensprecher'].map(voice_id => ({ voice_id, version: '1', languages: ['de-DE'] })) }));
        });
        await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
        const db = await require('../bts/database').init_test();
        await promisify(db.tournaments.insert.bind(db.tournaments))({ key: 'default', name: 'Isolierter Helfertest', language: 'de', announcement_speech_mode: 'browser' });
        app = express(); app.db = db;
        app.config = { host: '127.0.0.1', enable_https: true, https_key: key, https_cert: cert, https_port: 0,
            speech: { enabled: true, api_key: 'fixture-key-' + 'x'.repeat(40), url: 'http://127.0.0.1:' + upstream.address().port,
                cache_dir: cache, worker_type: 'process', audio_port: 0 } };
        app.speech = require('../bts/speech').create(app); app.speech.start();
        let status;
        for (let i = 0; i < 100; i++) {
            await pause(100); status = await rpc(app, 'speech_helpers');
            if (status.helpers?.runtime && status.speech?.audio_endpoint) break;
        }
        assert(status.helpers?.runtime, JSON.stringify(status));
        const port = status.speech.audio_endpoint.port, base = 'https://127.0.0.1:' + port;
        report.runtime = status.helpers.runtime; report.endpoint = base;
        const configurations = [];
        const count = controlled ? 1 : 2;
        for (let i = 0; i < count; i++) {
            const response = await rpc(app, 'speech_helper_bundle', { endpoint: 'https://bts-probe.example:' + port, platform: 'zip' });
            assert(response.bundle, JSON.stringify(response));
            const config = configFromZip(response.bundle.zip_base64);
            Object.assign(config, { endpoint: base, name: 'Isolierter Helfer ' + (i + 1), device_id: crypto.randomUUID(), platform: 'Packaged Linux / WSL rootfs', threads: 1 });
            configurations.push(config);
            const job = await rpc(app, 'speech_helper_test', { voice: 'hallensprecher' }); assert(job.helper_job);
        }
        report.steps.push('Admin IPC, authenticated starter ZIP, ' + count + ' queued tests');
        for (let i = 0; i < count; i++) {
            const state = path.join(directory, 'agent-' + i); await fs.mkdir(state);
            const child = spawn('bwrap', ['--ro-bind', rootfs, '/', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
                '--bind', state, '/var/lib/bts-speech-helper', '--unshare-pid', '--die-with-parent', '--chdir', '/',
                '--', '/usr/bin/python3', '/opt/bts-speech-helper/agent.py', '--config-stdin', controlled ? '--watch-stdin' : '--once'],
            { env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
            children.push(child);
            const lines = []; logs.push(lines);
            child.stdout.on('data', data => { lines.push(data.toString()); console.log('Helfer ' + (i + 1) + ': ' + data.toString().trim()); });
            child.stderr.on('data', data => { lines.push(data.toString()); console.log('Helfer ' + (i + 1) + ': ' + data.toString().trim()); });
            if (controlled) child.stdin.write(JSON.stringify(configurations[i]) + '\n');
            else child.stdin.end(JSON.stringify(configurations[i]) + '\n');
        }
        const began = Date.now(), deadline = began + 300000;
        let closed_at = null;
        while (Date.now() < deadline) {
            status = await rpc(app, 'speech_helpers');
            if (status.speech_error) throw new Error(status.speech_error);
            const processing = status.helpers.jobs.filter(job => job.state === 'processing').length;
            overlap ||= processing === 2;
            samples.push({ at_ms: Date.now() - began, processing, completed: status.helpers.jobs.filter(job => job.state === 'completed').length });
            if (controlled && processing === 1 && !closed_at) { closed_at = Date.now(); children[0].stdin.end(); }
            if (controlled && closed_at && children[0].exitCode === 0 && status.helpers.jobs[0].state === 'failed') break;
            if (controlled && closed_at && Date.now() - closed_at > 40000) throw new Error('Agent did not stop after owner EOF');
            if (status.helpers.jobs.every(job => job.state === 'completed')) break;
            if ((!controlled && status.helpers.jobs.some(job => job.state === 'failed')) || children.some(child => child.exitCode !== null && child.exitCode !== 0)) {
                throw new Error('Native helper failed: ' + JSON.stringify(status.helpers.jobs));
            }
            if (samples.length % 10 === 0) console.log('Paralleltest: ' + Math.round((Date.now() - began) / 1000) + ' Sekunden');
            await pause(2000);
        }
        if (controlled) {
            assert(closed_at && children[0].exitCode === 0 && status.helpers.jobs[0].state === 'failed', 'Missing controlled stop');
            report.status = 'completed'; report.control = { after_eof_ms: Date.now() - closed_at, exit_code: children[0].exitCode, job_state: status.helpers.jobs[0].state };
            report.steps.push('Owner pipe closed during an actual native job; packaged agent and model stopped without a process kill');
            console.log('Bestanden: Helfer beendet seine Arbeit nach EOF des Starter-Kontrollkanals. ' + directory);
            return;
        }
        assert(overlap, 'No simultaneous jobs'); assert(status.helpers.jobs.every(job => job.state === 'completed'), 'Missing results');
        const ca = await fs.readFile(cert);
        for (const job of status.helpers.jobs) {
            const body = await new Promise((resolve, reject) => https.get(base + job.audio_path, { ca }, response => {
                if (response.statusCode !== 200) { response.resume(); reject(new Error('Audio status ' + response.statusCode)); return; }
                const chunks = []; response.on('data', data => chunks.push(data)); response.on('end', () => resolve(Buffer.concat(chunks))); response.on('error', reject);
            }).on('error', reject));
            assert(require('../bts/speech/disk_cache').wav(body));
            await fs.writeFile(path.join(directory, job.id + '.wav'), body);
        }
        report.steps.push('Two packaged native agents simultaneously generated actual speech with one CPU each');
        report.steps.push('TLS certificate pinned before sending credentials; lease heartbeats and PCM16 return; signed HTTPS playback');
        report.helpers = status.helpers; report.overlap = overlap; report.samples = samples;
        report.status = 'completed'; console.log('Bestanden: zwei echte Helfer, zwei zentral gespeicherte Aufnahmen. ' + directory);
    } catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
    finally {
        for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
        await pause(1000); for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
        app?.speech.stop();
        if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
        report.logs = logs; report.finished_at = new Date().toISOString();
        await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    }
}
if (require.main === module) main(path.resolve(process.argv[2]), path.resolve(process.argv[3]), process.argv.includes('--control-only')).catch(error => { console.error(error); process.exitCode = 1; });
