'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { promisify } = require('util');
const WebSocket = require('ws');
const database = require('../bts/database');
const { create_app } = require('../bts/bts');
const admin = require('../bts/admin');
const { SpeechBroker } = require('../bts/speech/broker');
const { tournament, setup } = require('./test_speech_text');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(test, timeout = 15000) {
    const deadline = Date.now() + timeout;
    do {
        const value = await test();
        if (value) return value;
        await delay(50);
    } while (Date.now() < deadline);
    throw new Error('integration_timeout');
}

async function terminate(child) {
    if (!child || child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
}

async function rpc(ws, message) {
    const rid = crypto_random_id++;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { ws.off('message', receive); reject(new Error('ws_timeout')); }, 5000);
        const receive = data => {
            const response = JSON.parse(data);
            if (response.rid !== rid) return;
            clearTimeout(timer); ws.off('message', receive);
            if (response.type === 'error') reject(new Error(response.message)); else resolve(response);
        };
        ws.on('message', receive);
        ws.send(JSON.stringify({ ...message, rid }));
    });
}
let crypto_random_id = 1;

class CDP {
    constructor(ws) {
        this.ws = ws;
        this.next_id = 1;
        this.pending = new Map();
        this.events = [];
        ws.on('message', raw => {
            const message = JSON.parse(raw);
            if (message.id) {
                const pending = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (message.error) pending?.reject(new Error(message.error.message));
                else pending?.resolve(message.result);
            } else this.events.push(message);
        });
    }
    call(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = this.next_id++;
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async evaluate(expression) {
        const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' +
            (result.exceptionDetails.exception?.description || ''));
        return result.result.value;
    }
}

const suite = process.env.BTS_SPEECH_INTEGRATION === '1' ? describe : describe.skip;
suite('BTS / actual FastAPI / native Chrome speech integration', function() {
    this.timeout(60000);
    let directory, api, chrome, app, server, client, devtools;
    const key = 'test-only-key-' + 'x'.repeat(32);

    before(async function() {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bts-speech-e2e-'));
        const python = process.env.BTS_SPEECH_PYTHON ||
            path.resolve(__dirname, '../../bts-sprachserver/.venv/bin/python');
        api = spawn(python, [path.join(__dirname, 'fixtures/speech_fastapi_fixture.py'), directory],
            { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        api.stdout.on('data', data => { output += data; });
        const port = await until(() => {
            const match = /"port":\s*(\d+)/.exec(output);
            return match ? Number(match[1]) : null;
        });
        await until(async () => {
            try { return (await fetch('http://127.0.0.1:' + port + '/health')).ok; } catch (_) { return false; }
        });
        const db = await database.init_test();
        const current = { ...tournament(), name: 'TTS-Testturnier', events: { events: [] }, btp_enabled: false };
        for (const [collection, values] of Object.entries({
            tournaments: [current],
            locations: current.locations.map(value => ({ ...value, tournament_key: 'default', name: 'Halle eins', required_preparation_count: 1 })),
            courts: current.courts.map(value => ({ ...value, tournament_key: 'default', num: 4 })),
            matches: [{ _id: 'match1', tournament_key: 'default',
                setup: { ...setup(), is_match: true, counting: '3x21', incomplete: false }, presses: [] }],
        })) await promisify(db[collection].insert.bind(db[collection]))(values);
        app = create_app({
            port: 0, host: '127.0.0.1', bup_location: 'static/bup/dev', report_errors: false,
            speech: { enabled: true, url: 'http://127.0.0.1:' + port, api_key: key },
        }, db);
        // Accelerated mock generation, while the real deployment retains its rate limit.
        app.speech.broker.config.submit_interval_ms = 0;
        app.speech.broker.config.poll_interval_ms = 0;
        server = app.wss.options.server;
        await until(() => server.address()?.port);
        client = new WebSocket('ws://127.0.0.1:' + server.address().port + '/ws/admin');
        await new Promise(resolve => client.once('open', resolve));
        const loaded = await rpc(client, { type: 'tournament_get', key: 'default' });
        assert.strictEqual(loaded.tournament.speech.enabled, true);
        assert(!JSON.stringify(loaded).includes(key));
        await until(() => app.speech.broker.entries.size && [...app.speech.broker.entries.values()]
            .every(entry => entry.status === 'completed'));

        chrome = spawn(process.env.BTS_SPEECH_CHROME || '/usr/bin/google-chrome', [
            '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio',
            '--remote-debugging-port=0', '--user-data-dir=' + path.join(directory, 'chrome'),
            'about:blank',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let logs = '';
        chrome.stderr.on('data', data => { logs += data; });
        const endpoint = await until(() => /DevTools listening on (ws:\/\/[^\s]+)/.exec(logs)?.[1]);
        const http_url = new URL(endpoint);
        const pages = await (await fetch('http://' + http_url.host + '/json/list')).json();
        const page = pages.find(value => value.type === 'page');
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(resolve => ws.once('open', resolve));
        devtools = new CDP(ws);
        await devtools.call('Runtime.enable');
        await devtools.call('Page.enable');
        await devtools.call('Emulation.setDeviceMetricsOverride',
            { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
        await devtools.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/t/default/' });
        await until(() => devtools.evaluate('!!document.querySelector(\'.local_speech_controls\')'));
    });

    after(async function() {
        devtools?.ws.close();
        client?.close();
        await terminate(chrome);
        app?.speech.stop();
        if (app?.wss) await new Promise(resolve => app.wss.close(resolve));
        if (server?.listening) await new Promise(resolve => server.close(resolve));
        await terminate(api);
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
    });

    it('warms exact legacy call parts before playback and proxies the actual protected WAV', async function() {
        const parts = ['Jungeneinzel U17', 'Halbfinale', 'Johann Bjarne Schöttmer, gegen Muhammad Sytsh Abdulquddus'];
        const resolved = await rpc(client, { type: 'speech_resolve', tournament_key: 'default',
            voice: 'hallensprecherin', language: 'de-DE', parts });
        assert(resolved.clips.every(clip => clip.status === 'completed'));
        const file = await fetch('http://127.0.0.1:' + server.address().port + resolved.clips[0].audio_url);
        assert.strictEqual(file.headers.get('content-type'), 'audio/wav');
        assert.strictEqual(Buffer.from(await file.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
        const original = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
        assert(original.some(record => record.text === parts[2]));
        assert(original.every(record => !record.text.includes('U siebzehn')));
    });

    it('renders usable controls and plays ready server audio in the native browser', async function() {
        await devtools.evaluate('localStorage.setItem(\'bts_speech_mode\', \'server\'); window.__audioSources = []; ' +
            'const nativePlay = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function() {' +
            'this.addEventListener(\'playing\', () => window.__audioSources.push(this.currentSrc), {once:true}); ' +
            'return nativePlay.call(this); };');
        const bounds = await devtools.evaluate('(() => { const r = [...document.querySelectorAll(\'.local_speech_controls button\')]' +
            '.find(b => b.textContent === \'Audio aktivieren\').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
        for (const type of ['mousePressed', 'mouseReleased']) {
            await devtools.call('Input.dispatchMouseEvent', { type, x: bounds.x, y: bounds.y, button: 'left', clickCount: 1 });
        }
        const state = await devtools.evaluate('runAnnouncementSpeechCheck()');
        assert.strictEqual(state.status, 'active', JSON.stringify(state));
        assert(state.detail.includes('Server-Audio'));
        assert(await devtools.evaluate('window.__audioSources.some(src => src.includes(\'/speech/audio/\'))'));
        const errors = devtools.events.filter(event => event.method === 'Runtime.exceptionThrown');
        assert.deepStrictEqual(errors, []);
        await devtools.call('Page.captureScreenshot', { format: 'png' }).then(result =>
            fs.writeFileSync('/tmp/bts-local-tts-preview.png', Buffer.from(result.data, 'base64')));
    });

    it('uses the real match-call WebSocket path and plays a repeated event only once', async function() {
        await devtools.evaluate('localStorage.setItem(\'enable_announcement_calls_default_h1\', \'true\'); window.__audioSources = [];');
        const match = await app.db.matches.findOne_async({ _id: 'match1' });
        const event = { ...match, _announcement_ts: Date.now() };
        admin.notify_change(app, 'default', 'match_called_on_court', event);
        await until(() => devtools.evaluate('window.__audioSources.length >= 9'));
        await until(() => devtools.evaluate('announcementPlaybackActive === false'));
        const count = await devtools.evaluate('window.__audioSources.length');
        admin.notify_change(app, 'default', 'match_called_on_court', event);
        await delay(900);
        assert.strictEqual(await devtools.evaluate('window.__audioSources.length'), count);
    });

    it('reuses the durable speech-server cache after a fresh BTS adapter starts', async function() {
        const before = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8');
        const fresh = new SpeechBroker(app.speech.broker.config);
        fresh.prepare(['Jungeneinzel U17']);
        await fresh.step();
        assert.strictEqual(fresh.views(['Jungeneinzel U17'], {}, 'default')[0].status, 'completed');
        assert.strictEqual(fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8'), before);
    });
});
