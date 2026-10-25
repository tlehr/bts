'use strict';
// Native end-to-end proof in private temporary directories and random loopback
// ports. Never connects to the operator's BTS, speech server, BTP or database.
const fs = require('fs/promises'), path = require('path'), os = require('os'), assert = require('assert');
const http = require('http'), net = require('net'), express = require('express');
const { spawn, execFileSync } = require('child_process');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { HelperPool } = require('../bts/speech/helpers/pool');
const { HelperGeneration } = require('../bts/speech/helpers/generation');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPEECH = path.resolve(__dirname, '../../bts-sprachserver');
const KEY = 'isolated-helper-probe-key-' + 'x'.repeat(32);
async function main(artifacts) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-regular-helper-probe-'));
    const report = { directory, started_at: new Date().toISOString(), status: 'running', operator_services_used: false };
    let helper, upstream, listener, broker, logs = '', helperLogs = '';
    try {
        const rootfs = path.join(directory, 'rootfs'), state = path.join(directory, 'state'), poolDir = path.join(directory, 'pool');
        for (const dir of [rootfs, state, poolDir]) await fs.mkdir(dir);
        execFileSync('tar', ['-xf', path.join(artifacts, 'runtime.tar'), '-C', rootfs]);
        for (const name of ['runtime.tar', 'runtime.json']) await fs.symlink(path.join(artifacts, name), path.join(poolDir, name));
        const pool = new HelperPool(poolDir); await pool.ready;
        const available = net.createServer(); await new Promise(resolve => available.listen(0, '127.0.0.1', resolve));
        const port = available.address().port; await new Promise(resolve => available.close(resolve));
        const code = `from pathlib import Path\nimport sys, uvicorn\nfrom pydantic import SecretStr\nfrom bts_sprachserver.config import Settings\nfrom bts_sprachserver.main import create_app\ns = Settings.from_env(backend='kitten_cpp').model_copy(update={'api_key': SecretStr('${KEY}'), 'data_dir': Path(sys.argv[1]), 'context_v2_lab': Path(sys.argv[1]) / 'empty-lab', 'torch_threads': 2, 'kitten_decoder_threads': 2, 'shutdown_timeout': 10})\nuvicorn.run(create_app(s), host='127.0.0.1', port=int(sys.argv[2]), log_level='warning')\n`;
        upstream = spawn('nice', ['-n', '10', path.join(SPEECH, '.venv/bin/python'), '-c', code, path.join(directory, 'speech'), String(port)],
            { cwd: SPEECH, stdio: ['ignore', 'pipe', 'pipe'] });
        upstream.stdout.on('data', data => { logs += data; }); upstream.stderr.on('data', data => { logs += data; });
        const url = 'http://127.0.0.1:' + port;
        let health;
        const until = async (check, seconds, name) => {
            const deadline = Date.now() + seconds * 1000;
            while (Date.now() < deadline) {
                if (upstream.exitCode !== null) throw new Error('Private API exited: ' + logs.slice(-4000));
                if (await check()) return;
                await pause(500);
            }
            throw new Error(name + ' timed out');
        };
        await until(async () => {
            try { health = await (await fetch(url + '/health')).json(); return health.status === 'ready'; }
            catch (_) { return false; }
        }, 150, 'Native server startup');
        const runtime = await pool.runtime();
        assert.strictEqual(health.helper_generation_profile, runtime.generation_profile);
        const app = express(); require('../bts/speech/helpers/http').routes(app, pool);
        listener = http.createServer(app); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
        const endpoint = 'http://127.0.0.1:' + listener.address().port;
        const pair = await pool.pair(), device_id = '3'.repeat(32);
        await pool.register(pair.key, { protocol: 1, device_id, runtime_id: runtime.id, name: 'Native isolated helper', platform: 'Linux', threads: 2 });
        broker = new SpeechBroker(configuration({ enabled: true, api_key: KEY, url,
            cache_dir: path.join(directory, 'bts-cache'), submit_interval_ms: 500, poll_interval_ms: 500 }, {}));
        await broker.disk.ready; await broker.refresh();
        const recipe = { before: 'Wir erwarten euch zum nächsten Spiel. ', text: 'Bitte meldet euch bei der Turnierleitung!',
            after: ' Der nächste Aufruf folgt in Kürze.', kind: 'generic' };
        const part = '~bts-context-v2~' + JSON.stringify(recipe);
        broker.prepare([part], { voice: 'hallensprecher', priority: 'normal', prefetch: true }, 'fixture');
        const generation = new HelperGeneration(broker, pool); await generation.step();
        assert.strictEqual((await pool.snapshot('fixture')).jobs.length, 1);
        const args = JSON.parse(execFileSync('python3', ['-c', 'import importlib.util,json,sys\nfrom pathlib import Path\ns=importlib.util.spec_from_file_location(\'helper\',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m)\nprint(json.dumps(m.sandbox_command(Path(sys.argv[2]),Path(sys.argv[3]))))', path.resolve(__dirname, '../static/speech-helper/Linux.py'), rootfs, state], { encoding: 'utf8' }));
        helper = spawn(args[0], [...args.slice(1), '--once'], { stdio: ['pipe', 'pipe', 'pipe'] });
        helper.stdout.on('data', data => { helperLogs += data; }); helper.stderr.on('data', data => { helperLogs += data; });
        helper.stdin.write(JSON.stringify({ endpoint, bootstrap: pair.key, runtime: { id: runtime.id }, device_id, name: 'Native isolated helper', threads: 2, memory_limit_mib: 3584 }) + '\n');
        const started = Date.now(); let snapshot;
        await until(async () => {
            await generation.step(); await broker.step(); snapshot = await pool.snapshot('fixture');
            if (snapshot.jobs.some(job => job.state === 'failed' || job.publication === 'failed')) throw new Error('Native source failed: ' + JSON.stringify(snapshot.jobs) + '\n' + helperLogs.slice(-3000));
            if (helper.exitCode !== null && helper.exitCode !== 0) throw new Error('Native helper exited: ' + helperLogs.slice(-3000));
            const clip = [...broker.entries.values()].find(entry => entry.part === part);
            if (clip?.status === 'failed') throw new Error('Central excerpt failed: ' + broker.last_error);
            return clip?.status === 'completed' && clip.local && snapshot.jobs[0]?.publication === 'ready';
        }, 360, 'Native helper → central quality → excerpt/playback → BTS disk cache');
        const clip = [...broker.entries.values()].find(entry => entry.part === part);
        assert(clip.processed); assert.strictEqual(clip.playback_profile, 'bts-playback-v1');
        const source = [...broker.entries.values()].find(entry => entry.context?.kind === 'source');
        const sourceResult = await broker.request(url, KEY, 'GET', '/v1/jobs/' + source.job_id);
        assert.strictEqual(sourceResult.audio.seed, 42, 'native helper candidate must pass central quality itself');
        assert(helperLogs.includes('Audio wird erzeugt - Auftrag ' + snapshot.jobs[0].id));
        report.status = 'completed'; report.total_ms = Date.now() - started;
        report.runtime_id = runtime.id; report.generation_profile = runtime.generation_profile;
        report.helper = { job_id: snapshot.jobs[0].id, generation_ms: snapshot.jobs[0].elapsed_ms,
            threads: snapshot.workers[0].threads, publication: snapshot.jobs[0].publication };
        report.source = { audio_id: source.audio_id, seed: sourceResult.audio.seed, duration_seconds: sourceResult.audio.duration_seconds };
        report.excerpt = { audio_id: clip.audio_id, text: clip.text, processed: clip.processed, playback_profile: clip.playback_profile, local: clip.local };
        console.log('Bestanden: native Helfersynthese, zentrale Qualitätsprüfung, Ausschnitt, Wiedergabeaufbereitung und BTS-Dateicache. ' + directory);
    } catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
    finally {
        broker?.stop();
        for (const child of [helper, upstream]) if (child && child.exitCode === null) {
            child.kill('SIGTERM');
            await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(15000)]);
            if (child.exitCode === null) child.kill('SIGKILL');
        }
        if (listener) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); }
        report.finished_at = new Date().toISOString(); report.helper_output = helperLogs; report.upstream_output = logs;
        await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    }
}
if (require.main === module) main(path.resolve(process.argv[2])).catch(error => { console.error(error); process.exitCode = 1; });
