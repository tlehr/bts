'use strict';
// Actual downloaded .sh, terminal menu, pinned HTTPS download, rootfs extraction,
// native speech, controlled stop/restart and scoped removal. Private pool only.
const fs = require('fs/promises'), path = require('path'), os = require('os'), assert = require('assert');
const https = require('https'), crypto = require('crypto'), express = require('express');
const { spawn, execFileSync } = require('child_process');
const { HelperPool } = require('../bts/speech/helpers/pool');
const { bundle } = require('../bts/speech/helpers/bundle');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main(artifacts) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-linux-helper-probe-'));
    const report = { directory, started_at: new Date().toISOString(), status: 'running' };
    let server, child, output = '';
    try {
        const cache = path.join(directory, 'pool'); await fs.mkdir(cache);
        for (const name of ['runtime.tar', 'runtime.json']) await fs.symlink(path.join(artifacts, name), path.join(cache, name));
        const pool = new HelperPool(cache); await pool.ready;
        const cert = path.join(directory, 'tls.crt'), key = path.join(directory, 'tls.key');
        execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
            '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
        const certificate = await fs.readFile(cert), pin = crypto.createHash('sha256').update(new crypto.X509Certificate(certificate).raw).digest('hex');
        const app = express(); require('../bts/speech/helpers/http').routes(app, pool);
        server = https.createServer({ cert: certificate, key: await fs.readFile(key) }, app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port, endpoint = 'https://127.0.0.1:' + port;
        const download = await bundle(pool, 'https://bts-fixture.example:' + port, pin, 'linux');
        const lines = Buffer.from(download.content_base64, 'base64').toString().split('\n');
        const marker = lines.indexOf('__BTS_PAYLOAD__'), config = JSON.parse(Buffer.from(lines[marker + 2], 'base64'));
        // Only the private fixture uses loopback; production downloads refuse it.
        config.endpoint = endpoint; lines[marker + 2] = Buffer.from(JSON.stringify(config)).toString('base64');
        const script = path.join(directory, download.filename); await fs.writeFile(script, lines.join('\n'));
        const data = path.join(directory, 'data');
        const root = path.join(data, 'bts-sprachhelfer', crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 12));
        const launch = (remove = false) => {
            output = '';
            assert(/^[a-zA-Z0-9_/.-]+$/.test(script), 'Fixture path must be shell-safe');
            const command = 'bash ' + script + (remove ? ' --remove' : '');
            child = spawn('script', ['-q', '-e', '-c', command, '/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'],
                env: { ...process.env, XDG_DATA_HOME: data, PYTHONDONTWRITEBYTECODE: '1' } });
            child.on('error', error => { report.child_error = error.message; });
            child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
            child.stdin.write(remove ? 'ja\n' : '1\n');
        };
        const until = async (check, seconds, description) => {
            const deadline = Date.now() + seconds * 1000;
            while (Date.now() < deadline) {
                if (await check()) return;
                if (output.includes('Fehler:')) throw new Error(description + ': ' + output.slice(-4000));
                if (child.exitCode !== null) throw new Error(description + ': helper exited ' + child.exitCode + '\n' + output.slice(-4000));
                await pause(500);
            }
            throw new Error(description + ': timed out\n' + output.slice(-4000));
        };
        const stop = async () => {
            child.stdin.write('\x03');
            await until(() => output.includes('Vorgang gestoppt.'), 45, 'Controlled stop');
            child.stdin.write('0\n');
            await until(() => child.exitCode === 0, 10, 'Menu close');
        };
        const first = await pool.test('default', 'hallensprecher');
        const started = Date.now(); launch();
        let view;
        await until(async () => {
            view = await pool.snapshot('default');
            const job = view.jobs.find(row => row.id === first.id);
            if (job?.state === 'failed') throw new Error('Native generation failed: ' + job.error + '\n' + output.slice(-4000));
            return job?.state === 'completed';
        }, 300, 'Download, unpack and native recording');
        const job = view.jobs.find(row => row.id === first.id);
        await until(() => output.includes('Auftrag abgeschlossen - Auftrag ' + first.id), 10, 'Local confirmed job status');
        assert(output.includes('Audio wird erzeugt - Auftrag ' + first.id));
        assert(output.includes('Stimme: Hallensprecher'));
        assert(output.includes('Text: ' + job.text));
        assert(output.includes('Aufnahme wird an BTS uebertragen - Auftrag ' + first.id));
        report.current_job_display = { text: true, voice: true, generation: true, upload: true, confirmed: true };
        const audio = await new Promise((resolve, reject) => https.get(endpoint + job.audio_path, { ca: certificate, checkServerIdentity: () => undefined }, response => {
            const chunks = []; response.on('data', data => chunks.push(data)); response.on('end', () => resolve(Buffer.concat(chunks))); response.on('error', reject);
        }).on('error', reject));
        assert(require('../bts/speech/disk_cache').wav(audio));
        await fs.writeFile(path.join(directory, 'recording.wav'), audio);
        report.first = { total_ms: Date.now() - started, generation_ms: job.elapsed_ms, audio_bytes: audio.length,
            threads: view.workers[0].threads, memory_limit_mib: view.workers[0].memory_limit_mib };
        await stop(); report.first_output = output;
        console.log('Bestanden: echtes Linux-SH, Download, Entpacken, native Aufnahme und kontrolliertes Stoppen.');
        const cancelled = await pool.test('default', 'hallensprecherin'); launch();
        await until(async () => (await pool.snapshot('default')).jobs.find(row => row.id === cancelled.id)?.state === 'processing', 60, 'Cached restart');
        await stop(); report.stop_output = output;
        const second = (await pool.snapshot('default')).jobs.find(row => row.id === cancelled.id);
        assert.strictEqual(second.state, 'failed');
        report.cancelled_job = second.state;
        launch(true);
        await until(() => child.exitCode === 0, 30, 'Local removal');
        report.removal_output = output;
        await assert.rejects(fs.stat(root), { code: 'ENOENT' });
        report.status = 'completed'; report.windows_gui_tested = false;
        console.log('Bestanden: Wiederverwendung der Laufzeit, Abbruch eines Auftrags und Entfernung. ' + directory);
    } catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
    finally {
        if (child && child.exitCode === null) { child.stdin.end(); child.kill('SIGTERM'); }
        if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
        report.finished_at = new Date().toISOString(); report.last_output = output;
        await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    }
}
if (require.main === module) main(path.resolve(process.argv[2])).catch(error => { console.error(error); process.exitCode = 1; });
