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
    let directory, api, chrome, app, server, client, devtools, devtoolsHost;
    const dispatchViolations = [];
    const key = 'test-only-key-' + 'x'.repeat(32);

    async function click(selector) {
        const bounds = await devtools.evaluate('(() => { const element = document.querySelector(' + JSON.stringify(selector) + '); ' +
            'element.scrollIntoView({block:\'center\'}); const r = element.getBoundingClientRect(); ' +
            'return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
        for (const type of ['mousePressed', 'mouseReleased']) {
            await devtools.call('Input.dispatchMouseEvent', { type, ...bounds, button: 'left', clickCount: 1 });
        }
    }

    async function openSpeechSettings() {
        await devtools.evaluate('crouting.navigate_to(\'t/default/edit\')');
        await until(() => devtools.evaluate('!!document.querySelector(\'.tournament_settings .local_speech_controls\')'));
        await devtools.evaluate('document.querySelector(\'.speech_settings_layout\').scrollIntoView({block:\'start\'}); if(document.querySelector(\'.speech_queue_jobs\')) document.querySelector(\'.speech_queue_jobs\').open = true');
    }

    async function closeSpeechSettings() {
        await devtools.evaluate('ctournament.ui_show()');
        await until(() => devtools.evaluate('!document.querySelector(\'.local_speech_controls\')'));
    }

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
        current.courts.push({ _id: 'default_8', is_active: true, location_id: 'default_h1' });
        for (const [collection, values] of Object.entries({
            tournaments: [current],
            locations: current.locations.map(value => ({ ...value, tournament_key: 'default', name: 'Halle eins', required_preparation_count: 1 })),
            courts: current.courts.map(value => ({ ...value, tournament_key: 'default', num: Number(value._id.split('_')[1]) })),
            matches: [{ _id: 'match1', tournament_key: 'default',
                setup: { ...setup({ state: 'preparation', preparation_call_timestamp: Date.now() }),
                    is_match: true, counting: '3x21', incomplete: false }, presses: [] }],
        })) await promisify(db[collection].insert.bind(db[collection]))(values);
        app = create_app({
            port: 0, host: '127.0.0.1', bup_location: 'static/bup/dev', report_errors: false,
            speech: { enabled: true, worker: false, url: 'http://127.0.0.1:' + port, api_key: key },
        }, db);
        // Accelerated mock generation, while the real deployment retains its rate limit.
        app.speech.broker.config.submit_interval_ms = 0;
        app.speech.broker.config.poll_interval_ms = 0;
        const request = app.speech.broker.request;
        let outstanding = null;
        app.speech.broker.request = async (...args) => {
            const method = args[2], route = args[3];
            if (method === 'POST' && outstanding) dispatchViolations.push({ method, outstanding });
            const response = await request(...args);
            if (method === 'POST' && ['queued', 'processing'].includes(response.status)) outstanding = response.job_id;
            if (route === '/v1/jobs/' + outstanding && ['completed', 'failed'].includes(response.status)) outstanding = null;
            return response;
        };
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
        devtoolsHost = http_url.host;
        const pages = await (await fetch('http://' + http_url.host + '/json/list')).json();
        const page = pages.find(value => value.type === 'page');
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(resolve => ws.once('open', resolve));
        devtools = new CDP(ws);
        await devtools.call('Runtime.enable');
        await devtools.call('Page.enable');
        await devtools.call('Page.addScriptToEvaluateOnNewDocument', { source:
            'const originalInterval = window.setInterval.bind(window); window.setInterval = (fn, ms, ...args) => ' +
            'originalInterval(fn, String(fn).includes(\'btsSpeechReadiness.refresh\') ? 60000 : ms, ...args);' });
        await devtools.call('Emulation.setDeviceMetricsOverride',
            { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
        await devtools.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/t/default/' });
        try {
            await until(() => devtools.evaluate('!!document.querySelector(\'.location_announcements_controls\')'));
        } catch (error) {
            const exceptions = devtools.events.filter(event => event.method === 'Runtime.exceptionThrown');
            throw new Error(error.message + ': ' + JSON.stringify(exceptions.map(event => event.params.exceptionDetails.exception?.description)));
        }
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

    it('warms reusable names and one start instruction for all courts and proxies the actual protected WAV', async function() {
        const parts = ['Jungeneinzel U17', 'Halbfinale', 'Johann Bjarne Schöttmer', 'gegen', 'Muhammad Sytsh Abdulquddus',
            'Auf Spielfeld 4', 'Auf Spielfeld 8', 'Bitte mit dem Spielen beginnen', 'Spiel Nummer 17'];
        const resolved = await rpc(client, { type: 'speech_resolve', tournament_key: 'default',
            voice: 'hallensprecherin', language: 'de-DE', parts });
        assert(resolved.clips.every(clip => clip.status === 'completed'));
        const file = await fetch('http://127.0.0.1:' + server.address().port + resolved.clips.at(-1).audio_url);
        assert.strictEqual(file.headers.get('content-type'), 'audio/wav');
        assert.strictEqual(Buffer.from(await file.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
        const original = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
        const spokenParts = ['Jungeneinzel U siebzehn', 'Halbfinale', 'Johann Bjarne Schöttmer', 'gegen', 'Muhammad Sytsh Abdulquddus',
            'Auf Spielfeld vier', 'Auf Spielfeld acht', 'Bitte mit dem Spielen beginnen', 'Spiel Nummer siebzehn'];
        for (const name of ['Johann Bjarne Schöttmer', 'Muhammad Sytsh Abdulquddus', 'Ulli Unparteiisch', 'Lisa Linie']) {
            assert.strictEqual(original.filter(record => record.text === name).length, 1, name);
            assert(!original.some(record => record.text === name + '!'), name + ' must share its sentence-ending WAV');
        }
        assert(!original.some(record => record.text === 'Halbfinale!' || record.text === ', Halbfinale'));
        for (const text of spokenParts) {
            assert.strictEqual(original.filter(record => record.text === text).length, 1, text);
            assert(!original.some(record => record.text === text + '!'), text + ' must not have a sentence-ending variant');
        }
        assert(!original.some(record => record.text.includes('Spielfeld') && record.text.includes('Bitte mit dem Spielen')));
        assert(!original.some(record => record.text.includes('Schöttmer, gegen')));
        assert(original.every(record => !/\d/.test(record.text)), 'the actual engine must receive spelled-out numbers');
        const queue = await rpc(client, { type: 'speech_queue', tournament_key: 'default' });
        for (const text of parts) assert(queue.queue.items.some(item => item.text === text), text);
    });

    it('renders usable controls and plays ready server audio in the native browser', async function() {
        assert.strictEqual(await devtools.evaluate('!!document.querySelector(\'.local_speech_controls\')'), false,
            'speech settings belong on the existing settings page');
        await devtools.evaluate('window.__audioSources = []; ' +
            'const nativePlay = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function() {' +
            'if (!this.src.startsWith(\'data:\')) { window.__lastAudio = this; ' +
            'this.addEventListener(\'playing\', () => window.__audioSources.push(this.currentSrc), {once:true}); } ' +
            'return nativePlay.call(this); };');
        await openSpeechSettings();
        await devtools.evaluate('(() => { const mode = document.querySelector(\'select[name="announcement_speech_mode"]\'); ' +
            'mode.value = \'server\'; mode.dispatchEvent(new Event(\'change\')); })()');
        await until(() => devtools.evaluate('btsSpeechService.settings().mode === \'server\''));
        assert.strictEqual(await devtools.evaluate('[...document.querySelectorAll(\'.local_speech_controls button\')]' +
            '.some(b => b.textContent === \'Audio aktivieren\')'), false);
        const bounds = await devtools.evaluate('(() => { const button = [...document.querySelectorAll(\'.local_speech_controls button\')]' +
            '.find(b => b.textContent === \'Cache-Status aktualisieren\'); button.scrollIntoView({block:\'center\'}); ' +
            'const r = button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
        for (const type of ['mousePressed', 'mouseReleased']) {
            await devtools.call('Input.dispatchMouseEvent', { type, x: bounds.x, y: bounds.y, button: 'left', clickCount: 1 });
        }
        await until(() => devtools.evaluate('btsSpeechService.settings().audio_ready'));
        await devtools.call('Page.captureScreenshot', { format: 'png' }).then(result =>
            fs.writeFileSync('/tmp/bts-speech-admin-menu.png', Buffer.from(result.data, 'base64')));
        await devtools.call('Emulation.setDeviceMetricsOverride',
            { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await devtools.call('Page.captureScreenshot', { format: 'png' }).then(result =>
            fs.writeFileSync('/tmp/bts-speech-admin-menu-mobile.png', Buffer.from(result.data, 'base64')));
        await devtools.call('Emulation.setDeviceMetricsOverride',
            { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
        await closeSpeechSettings();
        assert.strictEqual(await devtools.evaluate('btsSpeechService.settings().audio_ready'), true,
            'an ordinary BTS click must automatically unlock audio without a dedicated activation button');
        const state = await devtools.evaluate('runAnnouncementSpeechCheck()');
        assert.strictEqual(state.status, 'active', JSON.stringify(state));
        assert(state.detail.includes('Server-Audio'));
        assert(await devtools.evaluate('window.__audioSources.some(src => src.includes(\'/speech/audio/\'))'));
        const errors = devtools.events.filter(event => event.method === 'Runtime.exceptionThrown');
        assert.deepStrictEqual(errors, []);
        await devtools.call('Page.captureScreenshot', { format: 'png' }).then(result =>
            fs.writeFileSync('/tmp/bts-local-tts-preview.png', Buffer.from(result.data, 'base64')));
    });

    it('plays two real start calls using two court clips and the same instruction without further generation', async function() {
        const before = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8');
        const fallback = await devtools.evaluate('window.__browserSpeechCalls || 0');
        await devtools.evaluate('window.__audioSources = []; localStorage.setItem(\'enable_announcement_calls_default_h1\', \'true\'); ' +
            'for (const court_id of [\'default_4\', \'default_8\']) announceBeginnToPlay({...curt.matches[0].setup, court_id});');
        await until(() => devtools.evaluate('window.__audioSources.length === 4 && !announcementPlaybackActive'));
        const sources = await devtools.evaluate('window.__audioSources.map(src => new URL(src).pathname)');
        const expected = app.speech.broker.views(['Auf Spielfeld 4', 'Bitte mit dem Spielen beginnen',
            'Auf Spielfeld 8', 'Bitte mit dem Spielen beginnen'], {}, 'default').map(clip => clip.audio_url.split('?')[0]);
        assert.deepStrictEqual(sources, expected);
        assert.strictEqual(await devtools.evaluate('window.__browserSpeechCalls || 0'), fallback);
        assert.strictEqual(fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8'), before);
    });

    it('reuses the same native WAV for a name in the middle and at the end of a forfeit announcement', async function() {
        const before = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8');
        await devtools.evaluate('window.__audioSources = []; ' +
            'announceNoMatchWin({...curt.matches[0].setup, _announcement_claim_key:\'name-reuse-e2e\'}, 0);');
        await until(() => devtools.evaluate('window.__audioSources.length === 8 && !announcementPlaybackActive'));
        const sources = await devtools.evaluate('window.__audioSources.map(src => new URL(src).pathname)');
        const parts = ['Spiel Nummer 17', 'Jungeneinzel U17', 'Halbfinale', 'Johann Bjarne Schöttmer',
            'gegen', 'Muhammad Sytsh Abdulquddus', 'Das Spiel geht kampflos an', 'Johann Bjarne Schöttmer'];
        const expected = app.speech.broker.views(parts, {}, 'default').map(clip => clip.audio_url.split('?')[0]);
        assert.deepStrictEqual(sources, expected);
        assert.strictEqual(sources[3], sources.at(-1));
        assert.strictEqual(fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8'), before);
    });

    it('updates native browser readiness indicators as a free announcement is cached without playing it', async function() {
        const before = await devtools.evaluate('window.__audioSources.length');
        await devtools.evaluate('document.querySelector(\'.announcement_speech_check_form button\').scrollIntoView(); ' +
            'btsSpeechReadiness.refresh(true)');
        assert.strictEqual(await devtools.evaluate(
            'document.querySelector(\'.announcement_speech_check_form button\').dataset.speechState'), 'ready');
        const text = 'Anzeige ohne Wiedergabe! Ä U17';
        await devtools.evaluate('(() => { const field = document.getElementById(\'custom_announcement\'); ' +
            'field.value = ' + JSON.stringify(text) + '; field.scrollIntoView(); ' +
            'field.dispatchEvent(new Event(\'input\', {bubbles:true})); })(); btsSpeechReadiness.refresh(true)');
        const badge = 'document.getElementById(\'custom_announcement\').parentElement.querySelector(\'.local_speech_readiness\')';
        assert.strictEqual(await devtools.evaluate(badge + '.dataset.speechState'), 'missing');
        await until(() => [...app.speech.broker.entries.values()].some(entry => entry.text === text && entry.status === 'completed'));
        await devtools.evaluate('btsSpeechReadiness.refresh(true)');
        assert.strictEqual(await devtools.evaluate(badge + '.dataset.speechState'), 'ready');
        assert((await devtools.evaluate(badge + '.textContent')).includes('Lokal bereit'));
        await devtools.evaluate('document.querySelector(\'.match_preparation_call_button\').scrollIntoView(); ' +
            'btsSpeechReadiness.refresh(true)');
        assert.strictEqual(await devtools.evaluate(
            'document.querySelector(\'.match_preparation_call_button\').dataset.speechState'), 'ready');
        assert.strictEqual(await devtools.evaluate('window.__audioSources.length'), before);
        await devtools.call('Page.captureScreenshot', { format: 'png' }).then(result =>
            fs.writeFileSync('/tmp/bts-local-tts-readiness-preview.png', Buffer.from(result.data, 'base64')));
    });

    it('uses the green preparation call audio directly in automatic mode despite a delayed resolve endpoint', async function() {
        await openSpeechSettings();
        await devtools.evaluate('(() => { const mode = document.querySelector(\'.local_speech_controls select\'); ' +
            'mode.value = \'auto\'; mode.dispatchEvent(new Event(\'change\')); })()');
        await closeSpeechSettings();
        await devtools.evaluate('(() => { localStorage.setItem(\'enable_announcement_preparations_default_h1\', \'true\'); ' +
            'window.__audioSources = []; window.__browserSpeechCalls = 0; ' +
            'const nativeSpeak = speechSynthesis.speak.bind(speechSynthesis); ' +
            'speechSynthesis.speak = words => { window.__browserSpeechCalls++; return nativeSpeak(words); }; ' +
            'document.querySelector(\'.match_preparation_call_button\').scrollIntoView(); })(); btsSpeechReadiness.refresh(true)');
        assert.strictEqual(await devtools.evaluate(
            'document.querySelector(\'.match_preparation_call_button\').dataset.speechState'), 'ready');
        for (const entry of app.speech.broker.entries.values()) entry.checked = Date.now() - 301000;
        const original = admin.handle_speech_resolve;
        let lookups = 0;
        admin.handle_speech_resolve = (...args) => { lookups++; setTimeout(() => original(...args), 900); };
        try {
            const match = await app.db.matches.findOne_async({ _id: 'match1' });
            admin.notify_change(app, 'default', 'match_preparation_call', {
                match__id: match._id, match, _announcement_ts: Date.now(),
            });
            await until(() => devtools.evaluate('window.__audioSources.length >= 10'));
            await until(() => devtools.evaluate('announcementPlaybackActive === false'));
            assert.strictEqual(await devtools.evaluate('window.__browserSpeechCalls'), 0);
            assert.strictEqual(lookups, 0, 'a green call must not depend on another short-deadline WebSocket lookup');
            assert((await devtools.evaluate('document.querySelector(\'.local_speech_playback_status\').textContent')).includes('Server-Audio'));
        } finally { admin.handle_speech_resolve = original; }
    });

    it('removes green readiness and visibly identifies browser fallback after a native audio download failure', async function() {
        await devtools.evaluate('document.querySelector(\'.announcement_speech_check_form button\').scrollIntoView(); ' +
            'btsSpeechReadiness.refresh(true)');
        await devtools.call('Network.enable');
        await devtools.call('Network.setCacheDisabled', { cacheDisabled: true });
        await devtools.call('Network.setBlockedURLs', { urls: ['*/speech/audio/*'] });
        try {
            const result = await devtools.evaluate('btsSpeechService.speak([ci18n(\'announcements:speechcheck:text\')], ' +
                '\'native-download-failure\', async () => ({status:\'ok\', started:true}))');
            assert.strictEqual(result.provider, 'browser');
            assert.strictEqual(result.fallback_reason, 'audio_failed');
            assert.strictEqual(await devtools.evaluate(
                'document.querySelector(\'.announcement_speech_check_form button\').dataset.speechState'), 'audio_error');
            const message = await devtools.evaluate('document.querySelector(\'.local_speech_playback_status\').textContent');
            assert(message.includes('Browser-Fallback') && message.includes('Audiodatei'), message);
        } finally {
            await devtools.call('Network.setBlockedURLs', { urls: [] });
            await devtools.evaluate('btsSpeechService.unlock()');
        }
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

    it('shares persisted voice and mode with a second browser and generates only the selected voice', async function() {
        const { targetId } = await devtools.call('Target.createTarget', {
            url: 'http://127.0.0.1:' + server.address().port + '/admin/t/default/', background: true,
        });
        const pages = await (await fetch('http://' + devtoolsHost + '/json/list')).json();
        const socket = new WebSocket(pages.find(page => page.id === targetId).webSocketDebuggerUrl);
        await new Promise(resolve => socket.once('open', resolve));
        const second = new CDP(socket);
        await until(() => second.evaluate('typeof btsSpeechService !== \'undefined\' && typeof curt !== \'undefined\' && !!curt?.speech'));
        await second.evaluate('localStorage.setItem(\'bts_speech_voice\', \'hallensprecherin\'); ' +
            'localStorage.setItem(\'bts_speech_mode\', \'browser\')');
        const receivedBefore = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8').trim().split('\n').length;
        await openSpeechSettings();
        await rpc(client, { type: 'tournament_edit_prop', key: 'default', field: 'announcement_speech_mode', value: 'server' });
        await until(() => second.evaluate('btsSpeechService.settings().mode === \'server\''));
        await rpc(client, { type: 'tournament_edit_prop', key: 'default', field: 'announcement_speech_mode', value: 'auto' });
        await devtools.evaluate('(() => { const voice = document.querySelectorAll(\'.local_speech_controls select\')[1]; ' +
            'voice.value = \'hallensprecher\'; voice.dispatchEvent(new Event(\'change\')); })()');
        await closeSpeechSettings();
        await until(() => second.evaluate('btsSpeechService.settings().voice === \'hallensprecher\' && btsSpeechService.settings().mode === \'auto\''));
        assert.strictEqual((await app.db.tournaments.findOne_async({ key: 'default' })).announcement_speech_voice, 'hallensprecher');
        await until(() => {
            const male = [...app.speech.broker.entries.values()].filter(entry => entry.voice === 'hallensprecher');
            return male.length > 1 && male.every(entry => entry.status === 'completed') &&
                [...app.speech.broker.entries.values()].every(entry => entry.voice === 'hallensprecher');
        }, 25000);
        await devtools.evaluate('document.querySelector(\'.announcement_speech_check_form button\').scrollIntoView(); ' +
            'btsSpeechReadiness.refresh(true)');
        assert.strictEqual(await devtools.evaluate('btsSpeechService.settings().voice'), 'hallensprecher');
        assert.strictEqual(await devtools.evaluate(
            'document.querySelector(\'.announcement_speech_check_form button\').dataset.speechState'), 'ready');
        const before = await devtools.evaluate('window.__browserSpeechCalls');
        const state = await devtools.evaluate('runAnnouncementSpeechCheck()');
        assert.strictEqual(state.status, 'active', JSON.stringify(state));
        assert(state.detail.includes('Server-Audio'));
        assert.strictEqual(await devtools.evaluate('window.__browserSpeechCalls'), before);
        const text = await devtools.evaluate('ci18n(\'announcements:speechcheck:text\')');
        const clip = app.speech.broker.views([text], { voice: 'hallensprecher' }, 'default')[0];
        assert(await devtools.evaluate('window.__audioSources.some(src => src.includes(' +
            JSON.stringify(clip.audio_url.split('?')[0]) + '))'));
        const received = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
        assert(received.some(item => item.voice === 'hallensprecher' && item.text.includes('Muhammad Sytsh Abdulquddus')));
        assert(received.slice(receivedBefore).every(item => item.voice === 'hallensprecher'));
        assert.deepStrictEqual(dispatchViolations, []);
        await openSpeechSettings();
        assert.strictEqual(await devtools.evaluate('document.querySelectorAll(\'.local_speech_controls select\')[1].value'), 'hallensprecher');
        await closeSpeechSettings();
        await second.call('Page.reload');
        await until(() => second.evaluate('typeof btsSpeechService !== \'undefined\' && typeof curt !== \'undefined\' && !!curt?.speech && btsSpeechService.settings().voice === \'hallensprecher\''));
        socket.close();
        await devtools.call('Target.closeTarget', { targetId });
        await devtools.call('Page.bringToFront');
    });

    it('plays and previews the shorter male recording natively at increased speed without regenerating or modifying the cached WAV', async function() {
        const text = 'BTS_TEST_COMPACT_NAME';
        await rpc(client, { type: 'speech_prepare', tournament_key: 'default', voice: 'hallensprecher', language: 'de-DE', parts: [text] });
        await until(() => app.speech.broker.views([text], { voice: 'hallensprecher' }, 'default')[0].status === 'completed');
        const clip = app.speech.broker.views([text], { voice: 'hallensprecher' }, 'default')[0];
        assert(clip.audio_url.includes('playback=words-v1'));
        const audio_id = new URL(clip.audio_url, 'http://localhost').pathname.split('/').pop();
        const original = Buffer.from(await (await fetch(app.speech.broker.config.base_url + '/v1/audio/' + audio_id,
            { headers: { 'X-API-Key': key } })).arrayBuffer());
        const received = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8');
        const before = await devtools.evaluate('window.__browserSpeechCalls');
        const result = await devtools.evaluate('btsSpeechService.speak([' + JSON.stringify(text) + '], ' +
            '\'male-shorter-pauses\', async () => { window.__browserSpeechCalls++; return {status:\'ok\', started:true}; })');
        assert.strictEqual(result.provider, 'server');
        assert.strictEqual(result.status, 'ok');
        assert.strictEqual(await devtools.evaluate('window.__browserSpeechCalls'), before);
        const duration = await devtools.evaluate('window.__lastAudio.duration');
        assert(duration >= 0.39 && duration < 0.42, String(duration));
        const expectedRate = await devtools.evaluate('btsSpeechService.settings().rate * 1.1');
        assert(Math.abs(await devtools.evaluate('window.__lastAudio.playbackRate') - expectedRate) < 1e-6);
        assert.strictEqual(await devtools.evaluate('window.__lastAudio.preservesPitch'), true);
        const preview = await devtools.evaluate('btsSpeechService.queue().then(response => ' +
            'btsSpeechService.preview(response.queue.items.find(item => item.text === ' + JSON.stringify(text) + '), response.speech.cache_version))');
        assert.strictEqual(preview.status, 'ok');
        assert.strictEqual(await devtools.evaluate('window.__lastAudio.duration'), duration);
        assert(Math.abs(await devtools.evaluate('window.__lastAudio.playbackRate') - expectedRate) < 1e-6);
        assert.strictEqual(await devtools.evaluate('window.__lastAudio.preservesPitch'), true);
        const after = Buffer.from(await (await fetch(app.speech.broker.config.base_url + '/v1/audio/' + audio_id,
            { headers: { 'X-API-Key': key } })).arrayBuffer());
        assert.deepStrictEqual(after, original);
        assert.strictEqual(fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8'), received);
    });

    it('persists the opt-in checkbox for other-voice reserve and shows its own queue label in the native browser', async function() {
        const field = '[name="announcement_speech_warm_other_voice"]';
        await openSpeechSettings();
        assert.strictEqual(await devtools.evaluate('document.querySelector(' + JSON.stringify(field) + ').checked'), false);
        try {
            await click(field);
            await until(async () => (await app.db.tournaments.findOne_async({ key: 'default' })).announcement_speech_warm_other_voice === true);
            assert.strictEqual(app.speech.prefetch.settings('default').warm_other_voice, true);
            const loaded = await rpc(client, { type: 'tournament_get', key: 'default' });
            assert.strictEqual(loaded.tournament.speech.warm_other_voice, true, 'another client reads the same saved setting');
            await until(() => app.speech.broker.queue('default').items.some(item => item.spare));
            await until(() => devtools.evaluate('[...document.querySelectorAll(".speech_queue_meta")].some(el => el.textContent.includes("Andere Stimme · letzter Vorrat"))'));
            assert.strictEqual(await devtools.evaluate('btsSpeechService.settings().voice'), loaded.tournament.speech.voice);
            await closeSpeechSettings();
            await openSpeechSettings();
            await until(() => devtools.evaluate('!!document.querySelector(' + JSON.stringify(field) + ')'));
            assert.strictEqual(await devtools.evaluate('document.querySelector(' + JSON.stringify(field) + ').checked'), true);
            if (process.env.BTS_SPEECH_UI_SCREENSHOT) {
                await devtools.evaluate('document.querySelector(".local_speech_controls").scrollIntoView({block:"start"})');
                const screenshot = await devtools.call('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(process.env.BTS_SPEECH_UI_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
                await devtools.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
                await devtools.evaluate('document.querySelector(".local_speech_controls").scrollIntoView({block:"start"})');
                const mobile = await devtools.call('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(process.env.BTS_SPEECH_UI_SCREENSHOT.replace(/\.png$/, '-mobile.png'), Buffer.from(mobile.data, 'base64'));
                await devtools.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
            }
            await click(field);
            await until(async () => (await app.db.tournaments.findOne_async({ key: 'default' })).announcement_speech_warm_other_voice === false);
            assert.strictEqual(app.speech.broker.spare_plans.size, 0);
            assert(!app.speech.broker.queue('default').items.some(item => item.spare));
        } finally {
            await rpc(client, { type: 'tournament_edit_prop', key: 'default', field: 'announcement_speech_warm_other_voice', value: false });
            await closeSpeechSettings();
        }
    });

    it('updates cache counts and progress from completion events even when periodic polling is delayed', async function() {
        const broker = app.speech.broker;
        const events = [];
        const receive = data => {
            const message = JSON.parse(data);
            if (message.ctype === 'speech_cache_changed') events.push(message);
        };
        client.on('message', receive);
        await devtools.evaluate('window.__originalSpeechInterval = window.setInterval; ' +
            'window.setInterval = (callback, ms, ...args) => window.__originalSpeechInterval(callback, ms === 3000 ? 60000 : ms, ...args)');
        try {
            await openSpeechSettings();
        } finally {
            await devtools.evaluate('window.setInterval = window.__originalSpeechInterval');
        }
        await until(() => !broker.current && !broker.stepping);
        app.speech.stop();
        const sources = await devtools.evaluate('window.__audioSources.length');
        const refresh = () => devtools.evaluate('[...document.querySelectorAll(\'.local_speech_controls button\')]' +
            '.find(button => button.textContent === \'Cache-Status aktualisieren\').click()');
        const snapshot = () => devtools.evaluate('(() => { const progress = document.querySelector(\'.speech_queue_progress\'); ' +
            'return {ready:Number(progress.dataset.ready), total:Number(progress.dataset.needed), hidden:progress.parentElement.hidden, ' +
            'label:document.querySelector(\'.speech_queue_progress_label\').textContent, status:document.querySelector(\'.local_speech_status\').textContent}; })()');
        try {
            const initial = broker.queue('default'), before = initial.items.length;
            const neededBefore = initial.coverage.total.cached + initial.coverage.total.generated + initial.coverage.total.ordered;
            const text = 'Fortschritt wird automatisch aktualisiert.';
            broker.prepare([text], { voice: 'hallensprecher' }, 'default');
            await refresh();
            await until(async () => (await snapshot()).total === neededBefore + 1);
            assert.strictEqual((await snapshot()).ready, neededBefore);
            await devtools.evaluate('window.__speechQueueNode = document.querySelector(\'.speech_queue\')');
            const finish = async () => {
                await broker.step();
                await until(async () => {
                    if (broker.current) broker.current.entry.next_poll = 0;
                    await broker.step();
                    return !broker.current;
                });
            };
            await finish();
            await until(async () => (await snapshot()).ready === neededBefore + 1, 2500);
            const completed = await snapshot();
            assert.strictEqual(completed.total, neededBefore + 1);
            assert(completed.label.startsWith('Aktuell benötigt: '));
            assert(completed.label.endsWith('100 %'));
            assert(completed.status.includes((before + 1) + ' aktuell benötigte Aufträge bereit, 0 werden vorbereitet.'));
            assert(await devtools.evaluate('window.__speechQueueNode === document.querySelector(\'.speech_queue\')'));
            assert(events.some(event => event.tournament_key === 'default' && JSON.stringify(event.val) === '{}'));
            assert(!JSON.stringify(events).includes(text));

            broker.prepare(['BTS_TEST_GENERATION_FAILURE'], { voice: 'hallensprecher' }, 'default');
            await refresh();
            await until(async () => (await snapshot()).total === neededBefore + 2);
            broker.last_post = -Infinity;
            await finish();
            await until(async () => (await snapshot()).status.includes('1 fehlgeschlagen.'), 2500);
            const failed = await snapshot();
            assert.strictEqual(failed.ready, neededBefore + 1);
            assert.strictEqual(failed.total, neededBefore + 2);
            assert(!failed.label.endsWith('100 %'), 'failed parts must not count as ready');
            assert.strictEqual(await devtools.evaluate('window.__audioSources.length'), sources,
                'completion events and progress updates must never play audio');

            const original = admin.handle_speech_queue;
            admin.handle_speech_queue = (_app, ws, msg) => ws.respond(msg, null, { speech_error: 'test_unavailable' });
            try {
                await refresh();
                await until(async () => (await snapshot()).hidden);
                assert((await snapshot()).status.includes('nicht verfügbar'));
            } finally { admin.handle_speech_queue = original; }
        } finally {
            client.off('message', receive);
            await closeSpeechSettings();
            app.speech.start();
        }
    });

    it('updates announcement readiness on a completion event without a manual refresh or periodic polling', async function() {
        await openSpeechSettings();
        await until(() => !app.speech.broker.current && !app.speech.broker.stepping);
        app.speech.stop();
        const broker = app.speech.broker;
        const text = 'Button aktualisiert sich beim fertigen Baustein.';
        const voice = await devtools.evaluate('btsSpeechService.settings().voice');
        broker.prepare([text], { voice }, 'default');
        try {
            await click('.speech_queue h3');
            await until(() => devtools.evaluate('btsSpeechService.settings().audio_ready'));
            await devtools.evaluate('(() => { const target = document.createElement(\'button\'); target.type = \'button\'; ' +
                'target.textContent = \'Ansage prüfen\'; target.id = \'event-readiness-test\'; ' +
                'document.querySelector(\'.local_speech_controls\').appendChild(target); ' +
                'target.scrollIntoView({block:\'center\'}); btsSpeechReadiness.trackText(target, () => [' + JSON.stringify(text) + ']); })()');
            await devtools.evaluate('btsSpeechReadiness.refresh(true)');
            assert.strictEqual(await devtools.evaluate('document.getElementById(\'event-readiness-test\').dataset.speechState'), 'preparing');
            await broker.step();
            await until(async () => {
                if (broker.current) broker.current.entry.next_poll = 0;
                await broker.step();
                return !broker.current;
            });
            await until(() => devtools.evaluate('document.getElementById(\'event-readiness-test\').dataset.speechState === \'ready\''), 2500);
        } finally {
            await devtools.evaluate('document.getElementById(\'event-readiness-test\')?.remove()');
            await closeSpeechSettings();
            app.speech.start();
        }
    });

    it('shows the selected voice queue on the existing settings page and previews it without generating', async function() {
        await openSpeechSettings();
        await until(() => !app.speech.broker.current && !app.speech.broker.stepping);
        app.speech.stop();
        const broker = app.speech.broker;
        broker.prepare(['Laufender Testauftrag'], { voice: 'hallensprecher', priority: 'low' }, 'default');
        await broker.step();
        for (const voice of ['hallensprecher']) {
            broker.prepare(['Priorität hoch eins', 'Priorität hoch zwei'], { voice, priority: 'high' }, 'default');
            broker.prepare(['Als Nächstes'], { voice, priority: 'normal' }, 'default');
        }
        broker.prepare(['Nicht aus diesem Turnier'], { priority: 'high' }, 'other');
        const snapshot = JSON.stringify([...broker.entries.values()]);
        const expected = await rpc(client, { type: 'speech_queue', tournament_key: 'default' });
        let reads = 0;
        const original = admin.handle_speech_queue;
        admin.handle_speech_queue = (...args) => { reads++; return original(...args); };
        try {
            await devtools.evaluate('window.__audioSources = [];');
            const browserBefore = await devtools.evaluate('window.__browserSpeechCalls');
            await until(async () => await devtools.evaluate('document.querySelectorAll(\'.speech_queue_row\').length') === expected.queue.items.length);
            const rendered = await devtools.evaluate('[...document.querySelectorAll(\'.speech_queue_row\')].map(row => ({' +
                'key:row.dataset.key, text:row.querySelector(\'.speech_queue_text\').textContent, ' +
                'disabled:row.querySelector(\'button\').disabled, priority:row.dataset.priority}))');
            assert.deepStrictEqual(rendered.map(row => row.key), expected.queue.items.map(item => item.key));
            assert.deepStrictEqual(rendered.map(row => row.text), expected.queue.items.map(item => item.text));
            assert(rendered.some(row => row.text === 'Auf Spielfeld 8'), 'the displayed queue must retain digits');
            assert.deepStrictEqual(rendered.map(row => row.disabled), expected.queue.items.map(item => item.status !== 'completed'));
            assert(rendered.some(row => row.priority === 'high' && row.disabled));
            assert(expected.queue.items.every(item => item.voice === 'hallensprecher'));
            const progress = await devtools.evaluate('(() => { const progress = document.querySelector(\'.speech_queue_progress\'); ' +
                'return {ready:Number(progress.dataset.ready), total:Number(progress.dataset.needed)}; })()');
            const coverage = expected.queue.coverage.total;
            assert.strictEqual(progress.total, coverage.cached + coverage.generated + coverage.ordered);
            assert.strictEqual(progress.ready, coverage.cached + coverage.generated);
            assert(!rendered.some(row => row.text === 'Nicht aus diesem Turnier'));
            await until(() => reads >= 2, 6000);
            const received = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8');
            for (const voice of ['hallensprecher']) {
                const item = expected.queue.items.find(item => item.status === 'completed' && item.voice === voice);
                assert(item, 'the selected cached voice must be available');
                await click('.speech_queue_row[data-key="' + item.key + '"] .speech_queue_preview');
                await until(async () => await devtools.evaluate('document.querySelector(\'.speech_queue_feedback\').textContent') === 'Aufnahme abgespielt.');
                assert(await devtools.evaluate('window.__audioSources.some(src => src.includes(' +
                    JSON.stringify(item.audio_url.split('?')[0]) + '))'));
            }
            assert.strictEqual(await devtools.evaluate('window.__browserSpeechCalls'), browserBefore);
            assert.strictEqual(await devtools.evaluate('btsSpeechService.settings().voice'), 'hallensprecher');
            assert.strictEqual(fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8'), received);
            assert.strictEqual(JSON.stringify([...broker.entries.values()]), snapshot);
            await devtools.evaluate('document.querySelector(\'.speech_queue_list\').scrollTop = 0');
            await devtools.call('Page.captureScreenshot', { format: 'png' }).then(result =>
                fs.writeFileSync('/tmp/bts-speech-queue.png', Buffer.from(result.data, 'base64')));
            await devtools.call('Emulation.setDeviceMetricsOverride',
                { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
            await devtools.evaluate('document.querySelector(\'.speech_queue\').scrollIntoView({block:\'start\'})');
            await devtools.evaluate('document.querySelector(\'.speech_queue_list\').scrollTop = 0; ' +
                'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            await devtools.call('Page.captureScreenshot', { format: 'png' }).then(result =>
                fs.writeFileSync('/tmp/bts-speech-queue-mobile.png', Buffer.from(result.data, 'base64')));
            const width = await devtools.evaluate('(() => { const layout = document.querySelector(\'.speech_settings_layout\'); ' +
                'return {content:layout.scrollWidth, available:layout.clientWidth}; })()');
            assert(width.content <= width.available, JSON.stringify(width));
            await devtools.evaluate('window.__audioSources = []');
            await click('.speech_queue_preview:not(:disabled)');
            await until(() => devtools.evaluate('window.__audioSources.length > 0 && !window.__lastAudio.paused'));
            await closeSpeechSettings();
            assert.strictEqual(await devtools.evaluate('window.__lastAudio.paused'), true,
                'leaving the settings page must immediately stop its preview');
            const closedReads = reads;
            await delay(3300);
            assert.strictEqual(reads, closedReads, 'closing the dialog must stop queue polling');
            assert.deepStrictEqual(devtools.events.filter(event => event.method === 'Runtime.exceptionThrown'), []);
        } finally {
            admin.handle_speech_queue = original;
        }
    });
    it('shows repeated failure reasons and preserves expanded history through live updates', async function() {
        const response = await rpc(client, { type: 'speech_queue', tournament_key: 'default' });
        const base = response.queue.items.find(item => item.status === 'completed');
        const item = { ...base, status: 'failed', terminal_failure: true, diagnostics: {
            failure_count: 3, transport_count: 0, last_failure_at: 1700000000,
            recent_failures: [{ event_id: 'failure-one', code: 'source_quality_failed', reason: 'long_internal_pause',
                stage: 'source_quality', created_at: 1700000000, seed: 43,
                pauses: [{ kind: 'word', duration_ms: 810, limit_ms: 500, start_ms: 1200 }] }],
        } };
        response.queue.items = [item]; response.queue.coverage = null;
        const original = admin.handle_speech_queue;
        admin.handle_speech_queue = (_app, ws, msg) => ws.respond(msg, null, { speech: response.speech, queue: response.queue });
        try {
            await openSpeechSettings();
            await until(() => devtools.evaluate('document.querySelector(\'.speech_queue_failure\')?.textContent.includes(\'3 Fehlversuche\')'));
            const text = await devtools.evaluate('document.querySelector(\'.speech_queue_failure\').textContent');
            assert(text.includes('wiederholt') && text.includes('810 ms') && text.includes('Grenze 500 ms'));
            assert(text.includes('Keine weiteren automatischen Versuche'));
            await devtools.evaluate('window.__failureRow = document.querySelector(\'.speech_queue_row\'); document.querySelector(\'.speech_queue_failure details\').open = true');
            item.status = 'completed'; item.terminal_failure = false;
            await devtools.evaluate('[...document.querySelectorAll(\'.local_speech_controls button\')].find(button => button.textContent === \'Cache-Status aktualisieren\').click()');
            await until(() => devtools.evaluate('document.querySelector(\'.speech_queue_failure\').textContent.includes(\'inzwischen fertig\')'));
            assert(await devtools.evaluate('window.__failureRow === document.querySelector(\'.speech_queue_row\') && document.querySelector(\'.speech_queue_failure details\').open'));
        } finally {
            admin.handle_speech_queue = original;
            await closeSpeechSettings();
        }
    });

    it('shows grouped bars behind one disclosure and filters one shared list while preserving live updates', async function() {
        await closeSpeechSettings();
        let reads = 0;
        const original = admin.handle_speech_inventory;
        admin.handle_speech_inventory = (...args) => { reads++; return original(...args); };
        try {
            await openSpeechSettings();
            await until(() => devtools.evaluate('document.querySelectorAll(\'.speech_inventory_section\').length === 2'));
            await until(() => devtools.evaluate('[...document.querySelectorAll(\'.speech_inventory_entries\')].every(node => node.querySelectorAll(\'.speech_inventory_item\').length > 0)'));
            assert(await devtools.evaluate(`(() => {
                const sections = [...document.querySelectorAll('.speech_inventory_section')];
                return document.querySelector('.speech_coverage_details').tagName === 'DIV' && sections.every(node =>
                    node.tagName === 'SECTION' && !node.querySelector('.speech_inventory_breakdown').open &&
                    node.querySelectorAll('.speech_inventory_entries').length === 1 &&
                    [...node.querySelectorAll('.speech_inventory_group')].every(group => group.tagName === 'DIV') &&
                    !!(node.querySelector('.speech_inventory_breakdown').compareDocumentPosition(node.querySelector('.speech_inventory_entries')) & Node.DOCUMENT_POSITION_FOLLOWING));
            })()`), 'totals stay visible; one disclosure reveals all bars, followed by one list per section');
            const section = '.speech_inventory_section[data-inventory-kind="announcements"]';
            const group = section + ' .speech_inventory_group[data-coverage-group="D01"]';
            const selector = section + ' .speech_inventory_entries';
            await click(section + ' .speech_inventory_breakdown > summary');
            await click(group + ' .speech_inventory_filter');
            await until(() => devtools.evaluate('document.querySelector(' + JSON.stringify(selector) + ').dataset.coverageGroup === "D01"'));
            await until(() => devtools.evaluate('document.querySelector(' + JSON.stringify(selector) + ').querySelectorAll(\'.speech_inventory_item\').length > 0'));
            const list = await devtools.evaluate('[...document.querySelector(' + JSON.stringify(selector) + ').querySelectorAll(\'.speech_inventory_item\')].map(node => node.textContent)');
            assert(list.length <= 30);
            assert(list.some(text => text.includes('Spiel') && text.includes('Teile bereit')));
            assert(reads > 0);
            const selected = await devtools.evaluate('document.querySelector(' + JSON.stringify(group) + ').querySelector(\'.speech_coverage_segment:not([hidden])\').dataset.coverageState');
            await click(group + ' .speech_coverage_segment[data-coverage-state="' + selected + '"]');
            await until(() => devtools.evaluate(`(() => {
                const node = document.querySelector(${JSON.stringify(selector)});
                return node.dataset.coverageState === ${JSON.stringify(selected)} && node.querySelectorAll('.speech_inventory_item').length > 0 &&
                    [...node.querySelectorAll('.speech_inventory_item')].every(row => row.dataset.state === ${JSON.stringify(selected)});
            })()`));
            assert(await devtools.evaluate('document.querySelector(' + JSON.stringify(group) + ').querySelector(\'[aria-pressed="true"][data-coverage-state]\') !== null'));
            await devtools.evaluate('document.querySelector(' + JSON.stringify(group) + ').querySelector(\'.speech_inventory_filter\').focus()');
            await devtools.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
            await devtools.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
            await until(() => devtools.evaluate('document.querySelector(' + JSON.stringify(selector) + ').dataset.coverageState === "all" && document.querySelector(' + JSON.stringify(selector) + ').querySelectorAll(\'.speech_inventory_item\').length > 0'));
            if (process.env.BTS_SPEECH_INVENTORY_SCREENSHOT) {
                await devtools.call('Emulation.setDeviceMetricsOverride',
                    { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
                await devtools.evaluate('document.querySelectorAll(\'.speech_inventory_section\')[1].scrollIntoView({block:\'start\'})');
                const shot = await devtools.call('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(process.env.BTS_SPEECH_INVENTORY_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
            await devtools.evaluate(`(() => {
                const row = document.querySelector(${JSON.stringify(selector)}).querySelector('.speech_inventory_item');
                row.querySelector('.speech_inventory_dependencies').open = true;
                window.__inventoryTracked = row;
                const queue = btsSpeechService.queue, inventory = btsSpeechService.inventory;
                window.__restoreInventoryMethods = () => { btsSpeechService.queue = queue; btsSpeechService.inventory = inventory; };
                btsSpeechService.queue = async () => {
                    const response = await queue();
                    response.queue.coverage.revision += '-inventory-refresh-test';
                    return response;
                };
                btsSpeechService.inventory = async (...args) => {
                    const page = await inventory(...args);
                    const item = page?.kind === 'announcements' && page.items.find(item => item.id === row.dataset.inventoryId);
                    if (item) item.text = 'Aktualisierter Volltext: ' + item.text;
                    return page;
                };
                window.dispatchEvent(new Event('bts-speech-cache-changed'));
            })()`);
            await until(() => devtools.evaluate('window.__inventoryTracked.textContent.includes(\'Aktualisierter Volltext\')'));
            assert(await devtools.evaluate('window.__inventoryTracked.isConnected && window.__inventoryTracked.querySelector(\'.speech_inventory_dependencies\').open'),
                'same-count plan changes must update the existing row while retaining its expanded components');
            await click(selector + ' .speech_inventory_reset');
            await until(() => devtools.evaluate('document.querySelector(' + JSON.stringify(selector) + ').dataset.coverageGroup === "all" && document.querySelector(' + JSON.stringify(selector) + ').querySelectorAll(\'.speech_inventory_item\').length > 0'));
        } finally {
            admin.handle_speech_inventory = original;
            await devtools.evaluate('window.__restoreInventoryMethods?.()');
            await closeSpeechSettings();
        }
    });

    it('toggles status colors for every bar and list, keeps headings filtered and remembers the selection', async function() {
        await closeSpeechSettings();
        const storage = 'bts_speech_inventory_hidden_states';
        const saved = await devtools.evaluate('localStorage.getItem(' + JSON.stringify(storage) + ')');
        const section = '.speech_inventory_section[data-inventory-kind="components"]';
        const legend = '.speech_coverage_legend input';
        try {
            await openSpeechSettings();
            await until(() => devtools.evaluate('document.querySelectorAll(' + JSON.stringify(legend) + ').length === 7'));
            const response = await rpc(client, { type: 'speech_queue', tournament_key: 'default' });
            const totals = response.queue.coverage.components.total;
            const selected = ['stock', 'tournament_stock', 'prepared', 'cached', 'generated', 'ordered', 'potential'].find(state => totals[state] > 0);
            assert(selected, 'the real inventory must contain at least one selectable category');
            await click(legend + '[value="' + selected + '"]');
            await click(section + ' > .speech_queue_progress_container > .speech_inventory_filter');
            await until(() => devtools.evaluate(`(() => {
                const lists = [...document.querySelectorAll('.speech_inventory_entries')];
                return lists.length === 2 && lists.every(node => !node.querySelector('.speech_inventory_note').textContent.includes('geladen') &&
                    [...node.querySelectorAll('.speech_inventory_item')].every(row => row.dataset.state !== ${JSON.stringify(selected)})) &&
                    [...document.querySelectorAll('.speech_coverage_segment[data-coverage-state="${selected}"]')].every(node => node.hidden);
            })()`));
            await devtools.evaluate(`document.querySelectorAll(${JSON.stringify(legend)}).forEach(input => { if (input.checked) input.click(); })`);
            await until(() => devtools.evaluate(`(() => {
                const lists = [...document.querySelectorAll('.speech_inventory_entries')];
                return lists.length === 2 && lists.every(node => node.querySelector('.speech_inventory_note').textContent.includes('Keine Einträge') &&
                    node.querySelectorAll('.speech_inventory_item').length === 0) &&
                    [...document.querySelectorAll('.speech_coverage_segment')].every(node => node.hidden);
            })()`));
            await click(legend + '[value="' + selected + '"]');
            await until(() => devtools.evaluate(`(() => {
                const list = document.querySelector(${JSON.stringify(section)}).querySelector('.speech_inventory_entries');
                return list.querySelectorAll('.speech_inventory_item').length > 0 &&
                    [...list.querySelectorAll('.speech_inventory_item')].every(row => row.dataset.state === ${JSON.stringify(selected)});
            })()`));
            assert(await devtools.evaluate(`document.querySelector(${JSON.stringify(section)}).querySelector('.speech_coverage_segment[data-coverage-state="${selected}"]').style.width === '100%'`));
            const category = response.queue.coverage.components.groups.find(group => group[selected] > 0).id;
            await click(section + ' .speech_inventory_breakdown > summary');
            await click(section + ' .speech_inventory_group[data-coverage-group="' + category + '"] .speech_inventory_filter');
            await until(() => devtools.evaluate(`(() => {
                const list = document.querySelector(${JSON.stringify(section)}).querySelector('.speech_inventory_entries');
                return list.dataset.coverageGroup === ${JSON.stringify(category)} && list.dataset.coverageState === 'all' &&
                    list.querySelectorAll('.speech_inventory_item').length > 0 &&
                    [...list.querySelectorAll('.speech_inventory_item')].every(row => row.dataset.state === ${JSON.stringify(selected)});
            })()`));
            await closeSpeechSettings();
            await openSpeechSettings();
            await until(() => devtools.evaluate(`document.querySelectorAll(${JSON.stringify(legend)}).length === 7`));
            assert.deepStrictEqual(await devtools.evaluate(`[...document.querySelectorAll(${JSON.stringify(legend)})].filter(input => input.checked).map(input => input.value)`), [selected]);
            if (process.env.BTS_SPEECH_FILTER_SCREENSHOT) {
                await devtools.evaluate('document.querySelector(' + JSON.stringify(section) + ').scrollIntoView({block:"start"})');
                const shot = await devtools.call('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(process.env.BTS_SPEECH_FILTER_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
        } finally {
            await devtools.evaluate(saved === null ? 'localStorage.removeItem(' + JSON.stringify(storage) + ')' :
                'localStorage.setItem(' + JSON.stringify(storage) + ',' + JSON.stringify(saved) + ')');
            await closeSpeechSettings();
        }
    });

    it('renders seven proportional coverage segments and updates them without generating or rebuilding the bars', async function() {
        const response = await rpc(client, { type: 'speech_queue', tournament_key: 'default' });
        response.queue.items = [{ ...response.queue.items.find(item => item.status === 'completed'), priority: 'idle', idle: true }];
        const counts = { stock: 1, tournament_stock: 1, prepared: 1, cached: 1, generated: 1, ordered: 1, potential: 1, total: 7, failed: 0 };
        response.queue.coverage = { total: counts, groups: [{ id: 'D08', label: 'Tabletbedienung', ...counts }] };
        const original = admin.handle_speech_queue;
        const received = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8');
        admin.handle_speech_queue = (_app, ws, msg) => ws.respond(msg, null, { speech: response.speech, queue: response.queue });
        try {
            await openSpeechSettings();
            await until(() => devtools.evaluate('document.querySelector(\'.speech_queue_progress\')?.dataset.signature?.includes(\'"stock":1\')'));
            const summary = await devtools.evaluate('document.querySelector(\'.speech_queue_summary\').textContent');
            assert(summary.includes('Aktuell keine Aufträge benötigt.'));
            assert(summary.includes('Leerlauf-Vorrat: 1 bereit, 0 offen'));
            assert(await devtools.evaluate('document.querySelector(\'.speech_queue_meta\').textContent.includes(\'Nur bei Leerlauf\')'));
            const parts = () => devtools.evaluate('[...document.querySelectorAll(\'.speech_queue_progress .speech_coverage_segment\')]' +
                '.map(part => ({state:part.dataset.coverageState, width:part.style.width, hidden:part.hidden, color:getComputedStyle(part).backgroundColor}))');
            const first = await parts();
            assert.deepStrictEqual(first.map(part => part.state), ['stock', 'tournament_stock', 'prepared', 'cached', 'generated', 'ordered', 'potential']);
            assert(first.every(part => Math.abs(parseFloat(part.width) - 100 / 7) < 0.001 && !part.hidden));
            assert.strictEqual(new Set(first.map(part => part.color)).size, 7);
            assert(await devtools.evaluate('document.querySelector(\'.speech_coverage_legend\').textContent.includes(\'Vorsorglich erzeugt · diese Sitzung\')'));
            await devtools.evaluate('window.__coverageBar = document.querySelector(\'.speech_queue_progress\')');
            counts.prepared = 0; counts.generated = 2;
            Object.assign(response.queue.coverage.groups[0], counts);
            await devtools.evaluate('[...document.querySelectorAll(\'.local_speech_controls button\')]' +
                '.find(button => button.textContent === \'Cache-Status aktualisieren\').click()');
            await until(async () => (await parts()).find(part => part.state === 'prepared').hidden);
            assert(Math.abs(parseFloat((await parts()).find(part => part.state === 'generated').width) - 200 / 7) < 0.001);
            const group = await devtools.evaluate('[...document.querySelectorAll(\'[data-coverage-group="D08"] .speech_coverage_segment\')]' +
                '.map(part => ({state:part.dataset.coverageState, width:part.style.width, hidden:part.hidden}))');
            assert(group.find(part => part.state === 'prepared').hidden);
            assert(Math.abs(parseFloat(group.find(part => part.state === 'generated').width) - 200 / 7) < 0.001);
            assert(await devtools.evaluate('window.__coverageBar === document.querySelector(\'.speech_queue_progress\')'));
            assert.strictEqual(fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8'), received);
        } finally {
            admin.handle_speech_queue = original;
            await closeSpeechSettings();
        }
    });

    it('keeps rebuilt ready icons green and mutates only the icon whose cache result changes', async function() {
        const broker = app.speech.broker;
        const wasRunning = !broker.stopped;
        app.speech.stop();
        await until(async () => {
            if (broker.current && !broker.stepping) { broker.current.entry.next_poll = 0; await broker.step(); }
            return !broker.current && !broker.stepping;
        });
        const voice = await devtools.evaluate('btsSpeechService.settings().voice');
        const entries = [...broker.entries.values()].filter(entry => entry.voice === voice && entry.status === 'completed').slice(0, 2);
        assert.strictEqual(entries.length, 2);
        const original = { status: entries[0].status, retry_at: entries[0].retry_at };
        try {
            await devtools.evaluate('(() => { const root = document.createElement(\'div\'); root.id = \'stable-speech-icons\'; ' +
                'document.body.appendChild(root); ' + JSON.stringify(entries.map(entry => entry.part)) + '.forEach((text, index) => {' +
                'const button = document.createElement(\'button\'); button.id = \'stable-icon-\' + index; button.textContent = text; ' +
                'root.appendChild(button); btsSpeechReadiness.trackText(button, () => [text]); }); root.scrollIntoView({block:\'center\'}); })()');
            await devtools.evaluate('btsSpeechReadiness.refresh(true)');
            assert.deepStrictEqual(await devtools.evaluate('[...document.querySelectorAll(\'#stable-speech-icons button\')].map(b => b.dataset.speechState)'),
                ['ready', 'ready']);
            await devtools.evaluate('window.__iconChanges = []; window.__iconObserver = new MutationObserver(records => ' +
                'window.__iconChanges.push(...records.map(record => ({id:record.target.id, attribute:record.attributeName})))); ' +
                'window.__iconObserver.observe(document.getElementById(\'stable-speech-icons\'), ' +
                '{subtree:true, attributes:true, attributeFilter:[\'data-speech-state\',\'title\',\'aria-label\']})');
            const attachedState = await devtools.evaluate('(() => { document.getElementById(\'stable-icon-0\').remove(); ' +
                'const button = document.createElement(\'button\'); button.id = \'stable-icon-0\'; button.textContent = \'Neuer Button\'; ' +
                'btsSpeechReadiness.trackText(button, () => [' + JSON.stringify(entries[0].part) + ']); ' +
                'const state = button.dataset.speechState; document.getElementById(\'stable-speech-icons\').appendChild(button); return state; })()');
            assert.strictEqual(attachedState, 'ready', 'a rebuilt DOM node must be ready before insertion');
            await devtools.evaluate('btsSpeechReadiness.refresh(true)');
            assert.deepStrictEqual(await devtools.evaluate('window.__iconChanges'), []);
            entries[0].status = 'failed'; entries[0].retry_at = Date.now() + 60000;
            await devtools.evaluate('btsSpeechReadiness.refresh(true)');
            const changes = await devtools.evaluate('window.__iconChanges');
            assert(changes.length > 0);
            assert(changes.every(change => change.id === 'stable-icon-0'));
            assert.strictEqual(await devtools.evaluate('document.getElementById(\'stable-icon-0\').dataset.speechState'), 'failed');
        } finally {
            Object.assign(entries[0], original);
            await devtools.evaluate('window.__iconObserver?.disconnect(); document.getElementById(\'stable-speech-icons\')?.remove()');
            if (wasRunning) app.speech.start();
        }
    });

    it('opens live planning in a separate admin tab with ready / queued / total bars and automatic game-state updates', async function() {
        const broker = app.speech.broker, wasRunning = !broker.stopped;
        broker.stop();
        await until(async () => {
            if (broker.current && !broker.stepping) { broker.current.entry.next_poll = 0; await broker.step(); }
            return !broker.current && !broker.stepping;
        });
        const match = await app.db.matches.findOne_async({ _id: 'match1' });
        const before = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8');
        let targetId, socket, selected;
        try {
            await app.speech.prefetch.refresh('default');
            await until(() => devtools.evaluate('!!document.querySelector(\'.speech_planning_link\')'));
            const originalURL = await devtools.evaluate('location.href');
            const attrs = await devtools.evaluate('(() => { const a = document.querySelector(\'.speech_planning_link\'); ' +
                'return {href:a.href,target:a.target,rel:a.rel}; })()');
            assert.strictEqual(attrs.target, '_blank');
            assert.strictEqual(attrs.rel, 'noopener');
            assert(attrs.href.endsWith('/admin/t/default/speech-planning/'));
            const menu = await devtools.evaluate('(() => { const label = document.querySelector(\'.speech_planning_link\')' +
                '.closest(\'.toprow_menu\').querySelector(\'.toprow_menu_label\'); label.scrollIntoView(); ' +
                'const r = label.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
            await devtools.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...menu });
            await until(() => devtools.evaluate('document.querySelector(\'.speech_planning_link\').getBoundingClientRect().height > 0'));
            await click('.speech_planning_link');
            const page = await until(async () => (await (await fetch('http://' + devtoolsHost + '/json/list')).json())
                .find(value => value.url === attrs.href));
            targetId = page.id;
            socket = new WebSocket(page.webSocketDebuggerUrl);
            await new Promise(resolve => socket.once('open', resolve));
            const live = new CDP(socket);
            await live.call('Runtime.enable');
            await live.call('Emulation.setDeviceMetricsOverride', { width: 1340, height: 1500, deviceScaleFactor: 1, mobile: false });
            await live.call('Page.bringToFront');
            const snapshot = () => live.evaluate('(() => { const panel = document.querySelector(\'.speech_plan_live\'); return {' +
                'connected:panel?.dataset.connected, state:panel?.dataset.state, phase:panel?.querySelector(\'p:nth-of-type(2)\').textContent, ' +
                'counts:document.querySelector(\'.speech_plan_counts\')?.textContent, ' +
                'cards:document.querySelectorAll(\'.flow-step\').length, bars:document.querySelectorAll(\'.flow-progress\').length, ' +
                'active:document.querySelector(\'.live-current\')?.id, updated:panel?.dataset.updatedAt}; })()');
            await until(async () => (await snapshot()).connected === 'true');
            const initial = await snapshot();
            assert(initial.counts.includes('bereit ·') && initial.counts.includes('in der Queue ·') && initial.counts.includes('gesamt'));
            assert(initial.cards > 10 && initial.bars > 10);
            assert(await live.evaluate('document.querySelectorAll(\'#overview [id]\').length === new Set([...document.querySelectorAll(\'#overview [id]\')].map(n => n.id)).size'));
            assert.strictEqual(await live.evaluate('typeof btsSpeechService'), 'undefined');
            assert.strictEqual(await live.evaluate('window.opener'), null);
            assert.strictEqual(await devtools.evaluate('location.href'), originalURL);
            assert((await fetch(attrs.href)).headers.get('cache-control').includes('no-store'));

            await app.db.matches.update_async({ _id: match._id }, { $set: { 'setup.state': 'oncourt', 'setup.called_timestamp': Date.now() } }, {});
            await app.speech.prefetch.refresh('default');
            await until(async () => (await snapshot()).phase.includes('1 auf dem Feld'));
            assert(await live.evaluate('!document.querySelector(\'#draw-decision\') && document.querySelector(\'#registration-priority .flow-description\').textContent.startsWith(\'Geöffnete Anmeldungen zuerst\')'));

            const model = app.speech.prefetch.planning.get('default');
            const voice = app.speech.prefetch.settings('default').voice;
            const part = [...model.parts].find(([part, stage]) => stage === 'shared' &&
                broker.entries.has(broker.key(part, voice, 'de-DE')))?.[0];
            assert(part);
            const entry = broker.entries.get(broker.key(part, voice, 'de-DE'));
            selected = { entry, values: { status: entry.status, local: entry.local, retry_at: entry.retry_at } };
            Object.assign(entry, { status: 'processing', local: false, retry_at: 0 });
            broker.current = { entry, request: { voice: entry.voice } };
            await until(async () => (await snapshot()).active === 'location-field-priority');
            const caption = await live.evaluate('document.querySelector(\'[data-stage="shared"] .flow-counts\').textContent');
            assert(/\b[1-9]\d* in der Queue/.test(caption), caption);
            if (process.env.BTS_SPEECH_PLANNING_SCREENSHOT) {
                const shot = await live.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
                fs.writeFileSync(process.env.BTS_SPEECH_PLANNING_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
            Object.assign(entry, selected.values); broker.current = null; selected = null;
            const update = (await snapshot()).updated;
            await until(async () => (await snapshot()).updated !== update);
            for (const ws of app.wss.clients) if (ws.speech_planning_last) ws.close();
            await until(async () => (await snapshot()).connected === 'false');
            assert.strictEqual(await live.evaluate('document.querySelectorAll(\'.live-current,[aria-current="step"]\').length'), 0);
            await until(async () => (await snapshot()).connected === 'true');
            assert.strictEqual(fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8'), before,
                'opening and polling the graphic must not submit synthesis');
            assert.deepStrictEqual(live.events.filter(event => event.method === 'Runtime.exceptionThrown'), []);
        } finally {
            if (selected) { Object.assign(selected.entry, selected.values); broker.current = null; }
            socket?.close();
            if (targetId) await devtools.call('Target.closeTarget', { targetId });
            await devtools.call('Page.bringToFront');
            await app.db.matches.update_async({ _id: match._id }, { $set: { setup: match.setup } }, {});
            await app.speech.prefetch.refresh('default');
            if (wasRunning) broker.start();
        }
    });

    it('keeps all 13 court slots fixed through finishes, late result edits and reassignments', async function() {
        let targetId, socket;
        const original = await app.db.matches.findOne_async({ _id: 'match1' });
        const courts = await app.db.courts.find_async({ tournament_key: 'default' });
        const added = Array.from({ length: 13 }, (_, i) => i + 1).filter(num => !courts.some(court => court._id === 'default_' + num));
        const change = async (court, finished = false) => {
            const setup = { ...original.setup, court_id: 'default_' + court, now_on_court: !finished, state: finished ? 'finished' : 'oncourt' };
            await app.db.matches.update_async({ _id: original._id }, { $set: { setup, network_score: finished ? [[21, 3], [21, 4]] : [],
                ...(finished ? { team1_won: true } : {}) }, ...(!finished ? { $unset: { team1_won: true } } : {}) }, {});
            const match = await app.db.matches.findOne_async({ _id: original._id });
            admin.notify_change(app, 'default', 'match_edit', { match__id: original._id, match });
            return match;
        };
        try {
            for (const num of added) await promisify(app.db.courts.insert.bind(app.db.courts))({ _id: 'default_' + num,
                tournament_key: 'default', num, location_id: 'default_h1', is_active: true });
            await change(4);
            ({ targetId } = await devtools.call('Target.createTarget', { url: 'about:blank' }));
            const target = (await (await fetch('http://' + devtoolsHost + '/json/list')).json()).find(page => page.id === targetId);
            socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.once('open', resolve));
            const live = new CDP(socket); await live.call('Runtime.enable'); await live.call('Page.enable');
            await live.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/t/default/' });
            await until(() => live.evaluate('document.querySelectorAll(\'.court_row\').length === 13'));
            await live.evaluate('window.__fixedCourts = [...document.querySelectorAll(\'.court_row\')]');
            const assertFixed = async () => {
                assert.deepStrictEqual(await live.evaluate('[...document.querySelectorAll(\'.court_row\')].map(row => row.dataset.court_id)'),
                    Array.from({ length: 13 }, (_, i) => 'default_' + (i + 1)));
                assert(await live.evaluate('window.__fixedCourts.every((row,i) => row === document.querySelectorAll(\'.court_row\')[i])'),
                    'incremental changes must reuse the fixed court rows');
            };
            let currentCourt = 4;
            for (const nextCourt of [13, 9, 6, 1, 8, 4]) {
                const match = await change(currentCourt, true);
                await until(() => live.evaluate('document.querySelector(\'.finished_container .match[data-match_id="match1"]\') !== null'));
                assert.strictEqual(await live.evaluate('document.querySelectorAll(\'.court_row[data-match_id="match1"]\').length'), 0);
                // The subsequent result edit used to find the stale court row,
                // repaint it and move it according to finished-game ordering.
                admin.notify_change(app, 'default', 'match_edit', { match__id: original._id, match: { ...match, shuttle_count: nextCourt } });
                await until(() => live.evaluate('curt.matches.find(m => m._id === \'match1\').shuttle_count === ' + nextCourt));
                await assertFixed();
                await change(nextCourt);
                await until(() => live.evaluate('document.querySelector(\'.court_row[data-court_id="default_' + nextCourt + '"]\')?.dataset.match_id === \'match1\''));
                await assertFixed(); currentCourt = nextCourt;
            }
            await live.evaluate('cmatch.update_court({_id:\'filtered-out\',num:14,is_active:true})');
            assert.deepStrictEqual(live.events.filter(event => event.method === 'Runtime.exceptionThrown'), []);
        } finally {
            socket?.close(); if (targetId) await devtools.call('Target.closeTarget', { targetId });
            await app.db.matches.update_async({ _id: original._id }, original, {});
            for (const num of added) await app.db.courts.remove_async({ _id: 'default_' + num }, {});
        }
    });

    it('shows all games in schedule order with live call details and updates only changed rows', async function() {
        const broker = app.speech.broker, wasRunning = !broker.stopped;
        broker.stop();
        await until(async () => {
            if (broker.current && !broker.stepping) { broker.current.entry.next_poll = 0; await broker.step(); }
            return !broker.current && !broker.stepping;
        });
        const base = await app.db.matches.findOne_async({ _id: 'match1' });
        const originalTournament = await app.db.tournaments.findOne_async({ key: 'default' });
        const originalContext = broker.context_version;
        const statuses = new Map([...broker.entries].map(([key, entry]) => [key, { status: entry.status, local: entry.local }]));
        const added = [16, 18, 19].map(number => ({ _id: 'status-' + number, tournament_key: 'default', match_order: 0,
            presses: [], setup: { ...base.setup, match_num: number, state: number === 16 ? 'finished' : 'scheduled',
                court_id: number === 18 ? null : base.setup.court_id, incomplete: number === 19,
                teams: number === 19 ? [{ players: [] }, { players: [] }] : [{ players: [{ name: 'Anna <script>window.__gameInjected=true</script>' }] },
                    { players: [{ name: 'Berta Muster' }] }] } }));
        let targetId, socket, live;
        const originalClock = app.clock;
        try {
            // Status proofs use modular V2 clips. The engine stays stopped;
            // this view must not submit any generation or play an announcement.
            broker.context_version = 'bts-context-v2';
            await promisify(app.db.matches.insert.bind(app.db.matches))(added);
            await app.db.matches.update_async({ _id: base._id }, { $set: { 'setup.state': 'oncourt', 'setup.now_on_court': true } }, {});
            await app.speech.prefetch.refresh('default');
            const current = broker.coverage.plans.get('default'), voice = current.voice;
            for (const target of current.values.values()) if (target.part) broker.prepare([target.part], { voice }, 'default');
            for (const entry of broker.entries.values()) { entry.status = 'completed'; entry.local = false; }
            const otherKeys = new Set(current.calls.filter(call => call.match_id !== 'status-18').flatMap(call => call.keys));
            const missingKey = current.calls.find(call => call.match_id === 'status-18' && call.group === 'D01').keys.find(key => !otherKeys.has(key));
            assert(missingKey);
            const pending = broker.entries.get(missingKey); pending.status = 'processing';
            const received = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8');
            ({ targetId } = await devtools.call('Target.createTarget', { url: 'about:blank' }));
            const page = (await (await fetch('http://' + devtoolsHost + '/json/list')).json()).find(page => page.id === targetId);
            socket = new WebSocket(page.webSocketDebuggerUrl);
            await new Promise(resolve => socket.once('open', resolve));
            live = new CDP(socket); await live.call('Runtime.enable'); await live.call('Page.enable');
            await live.call('Emulation.setDeviceMetricsOverride', { width: 1560, height: 1250, deviceScaleFactor: 1, mobile: false });
            const address = 'http://127.0.0.1:' + server.address().port + '/admin/t/default/speech-planning/';
            await live.call('Page.navigate', { url: address });
            await until(() => live.evaluate('!!document.querySelector(\'#view-games\')'));
            await live.evaluate('document.querySelector(\'#view-games\').click()');
            const rowSelector = '#games-panel tbody[data-game-id="status-18"]';
            await until(() => live.evaluate('document.querySelectorAll(\'#games-panel tbody\').length === 4'));
            assert.deepStrictEqual(await live.evaluate('[...document.querySelectorAll(\'#games-panel tbody\')].map(node=>node.dataset.gameId)'),
                ['status-16', 'match1', 'status-18', 'status-19']);
            assert(await live.evaluate('document.querySelector(\'.plan\').hidden && document.querySelector(\'#queue\').hidden'));
            assert(await live.evaluate('document.querySelector(\'tbody[data-game-id="match1"]\').dataset.speechState === \'ready\''));
            assert(await live.evaluate('document.querySelector(\'tbody[data-game-id="match1"]\').dataset.matchState === \'oncourt\''));
            assert(await live.evaluate('document.querySelector(\'tbody[data-game-id="match1"] .game-court-icon\').textContent === \'4\''));
            assert(await live.evaluate('getComputedStyle(document.querySelector(\'tbody[data-game-id="match1"] .game-match-status\')).backgroundColor === \'rgb(251, 228, 77)\''));
            assert(await live.evaluate('document.querySelector(\'.games-state-legend\').textContent.includes(\'Aufrufkandidaten\')'));
            assert(await live.evaluate('document.querySelector(\'tbody[data-game-id="status-16"] .game-match-status\').textContent.includes(\'Beendet auf Feld\')'));
            await live.evaluate('document.querySelector(\'.games-state-filter\').value=\'unfinished\';document.querySelector(\'.games-state-filter\').dispatchEvent(new Event(\'change\'))');
            assert.strictEqual(await live.evaluate('[...document.querySelectorAll(\'#games-panel tbody\')].filter(node=>!node.hidden).length'), 3);
            assert(await live.evaluate('document.querySelector(\'tbody[data-game-id="status-16"]\').hidden'));
            await live.evaluate('document.querySelector(\'.games-state-filter\').value=\'all\';document.querySelector(\'.games-state-filter\').dispatchEvent(new Event(\'change\'))');
            assert(await live.evaluate('document.querySelector(\'tbody[data-game-id="status-19"]\').dataset.speechState === \'blocked\''));
            assert(await live.evaluate('!window.__gameInjected && !document.querySelector(\'#games-panel script\')'));
            await live.evaluate('document.querySelector(' + JSON.stringify(rowSelector + ' button') + ').click()');
            await until(() => live.evaluate('document.querySelectorAll(' + JSON.stringify(rowSelector + ' .game-announcement') + ').length > 0'));
            assert(await live.evaluate('document.querySelector(' + JSON.stringify(rowSelector) + ').textContent.includes(\'Alle möglichen Felder\')'));
            assert(await live.evaluate('document.querySelector(' + JSON.stringify(rowSelector) + ').dataset.speechState === \'processing\''));
            assert(await live.evaluate('!document.querySelector(' + JSON.stringify(rowSelector) + ').textContent.includes(\'Angaben fehlen\')'));
            await live.evaluate('document.querySelector(' + JSON.stringify(rowSelector + ' .game-announcement') + ').open=true;' +
                'window.__gameRow=document.querySelector(' + JSON.stringify(rowSelector) + ');' +
                'window.__gameCall=document.querySelector(' + JSON.stringify(rowSelector + ' .game-announcement') + ');' +
                'window.__gameChanges=[];window.__gameObserver=new MutationObserver(records=>records.forEach(record=>{' +
                'const row=(record.target.nodeType===1?record.target:record.target.parentElement).closest(\'tbody\');if(row)window.__gameChanges.push(row.dataset.gameId)}));' +
                'window.__gameObserver.observe(document.querySelector(\'.games-table\'),{subtree:true,childList:true});');
            const beforeRevision = (await rpc(client, { type: 'speech_games', tournament_key: 'default' })).games.revision;
            pending.status = 'completed';
            await until(() => live.evaluate('document.querySelector(' + JSON.stringify(rowSelector + ' td:nth-child(4) small') + ').textContent.match(/^(\\d+)\\/\\1 Bausteine bereit$/) !== null'));
            assert(await live.evaluate('document.querySelector(' + JSON.stringify(rowSelector) + ').dataset.speechState === \'ready\''));
            assert(await live.evaluate('window.__gameChanges.length>0 && window.__gameChanges.every(id=>id===\'status-18\')'));
            assert(await live.evaluate('window.__gameRow===document.querySelector(' + JSON.stringify(rowSelector) + ') && ' +
                'window.__gameCall===document.querySelector(' + JSON.stringify(rowSelector + ' .game-announcement') + ') && window.__gameCall.open'));
            const after = (await rpc(client, { type: 'speech_games', tournament_key: 'default', revision: beforeRevision })).games;
            assert.notStrictEqual(after.revision, beforeRevision);
            if (process.env.BTS_SPEECH_GAMES_SCREENSHOT) {
                const shot = await live.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
                fs.writeFileSync(process.env.BTS_SPEECH_GAMES_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
            await live.evaluate('window.__gameObserver.disconnect()');
            await app.db.tournaments.update_async({ key: 'default' }, { $set: { events: { events: [{ name: base.setup.event_name,
                stages: [{ stage_type: 1, entries: [base.setup.teams[0], base.setup.teams[1], ...added[1].setup.teams]
                    .map(team => ({ team })) }] }] } } }, {});
            await app.speech.prefetch.refresh('default');
            for (const target of broker.coverage.game_plans.get('default').values.values()) if (target.part) broker.prepare([target.part], { voice }, 'default');
            for (const entry of broker.entries.values()) { entry.status = 'completed'; entry.local = false; }
            await until(() => live.evaluate('document.querySelector(\'tbody[data-game-id="status-19"]\').dataset.speechState === \'ready\''));
            assert(await live.evaluate('document.querySelector(\'tbody[data-game-id="status-19"]\').dataset.matchState === \'incomplete\''));
            await live.evaluate('document.querySelector(\'tbody[data-game-id="status-19"] button\').click()');
            await until(() => live.evaluate('document.querySelector(\'tbody[data-game-id="status-19"]\').textContent.includes(\'Alle Teilnehmer der Disziplin\')'));
            const frozenNow = Date.now();
            app.clock = { now_ms: () => frozenNow, get_state: () => ({ mode: 'fixed' }) };
            await app.db.matches.update_async({ _id: base._id }, { $set: { 'setup.state': 'preparation', 'setup.now_on_court': false,
                'setup.preparation_call_timestamp': frozenNow - 65000, 'setup.highlight': 6 } }, {});
            await app.speech.prefetch.refresh('default');
            await until(() => live.evaluate('document.querySelector(\'tbody[data-game-id="match1"] .game-preparation-time\')?.textContent === \'1:05\''));
            assert(await live.evaluate('getComputedStyle(document.querySelector(\'tbody[data-game-id="match1"] .game-match-status\')).backgroundColor === \'rgb(197, 107, 255)\''));
            assert(await live.evaluate('document.querySelector(\'tbody[data-game-id="match1"] .game-match-status\').textContent.includes(\'[für Feld 4]\')'));
            await live.evaluate('new Promise(resolve=>setTimeout(resolve,1200))');
            assert(await live.evaluate('document.querySelector(\'tbody[data-game-id="match1"] .game-preparation-time\').textContent === \'1:05\''), 'a fixed BTS clock must not advance the preparation timer');
            await live.evaluate('document.querySelector(\'.games-search\').value=\'19\';document.querySelector(\'.games-search\').dispatchEvent(new Event(\'input\'))');
            assert.strictEqual(await live.evaluate('[...document.querySelectorAll(\'#games-panel tbody\')].filter(node=>!node.hidden).length'), 1);
            await live.evaluate('document.querySelector(\'.games-search\').value=\'\';document.querySelector(\'.games-search\').dispatchEvent(new Event(\'input\'))');
            await live.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
            await live.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            assert(await live.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'the mobile view must fit without horizontal page scrolling');
            await live.call('Page.reload');
            await until(() => live.evaluate('document.querySelector(\'#view-games\')?.getAttribute(\'aria-selected\') === \'true\''));
            await until(() => live.evaluate('document.querySelectorAll(\'#games-panel tbody\').length === 4'));
            assert.strictEqual(fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8'), received, 'the game view must not submit synthesis');
            assert.deepStrictEqual(live.events.filter(event => event.method === 'Runtime.exceptionThrown'), []);
        } finally {
            app.clock = originalClock;
            broker.context_version = originalContext;
            if (live) await live.evaluate('localStorage.removeItem(\'bts-speech-planning-view\')').catch(() => {});
            socket?.close(); if (targetId) await devtools.call('Target.closeTarget', { targetId });
            for (const [key, values] of statuses) if (broker.entries.has(key)) Object.assign(broker.entries.get(key), values);
            for (const match of added) await promisify(app.db.matches.remove.bind(app.db.matches))({ _id: match._id }, {});
            await app.db.tournaments.update_async({ key: 'default' }, { $set: { events: originalTournament.events } }, {});
            await app.db.matches.update_async({ _id: base._id }, { $set: { setup: base.setup } }, {});
            await app.speech.prefetch.refresh('default');
            if (wasRunning) broker.start();
        }
    });

    it('collects browser logs centrally and reloads a chosen page after its unsaved form is closed', async function() {
        const hub = app.diagnostics;
        await until(() => hub?.ready);
        const original = await devtools.evaluate('btsDiagnostics.context()');
        assert.strictEqual(original.role, 'admin');
        const marker = 'browser-central-test-' + Date.now();
        await devtools.evaluate('console.warn(' + JSON.stringify(marker) + ', {api_key:\'do-not-export-this\',reason:\'speech_timeout\'});' +
            'const form=document.createElement(\'form\');form.id=\'diagnostics-unsaved\';form.innerHTML=\'<input name="test" value="before">\';document.body.appendChild(form);' +
            'const input=form.querySelector(\'input\');input.focus();input.value=\'after\';input.dispatchEvent(new Event(\'input\',{bubbles:true}));');
        let targetId, socket;
        try {
            ({ targetId } = await devtools.call('Target.createTarget', { url: 'about:blank' }));
            const target = (await (await fetch('http://' + devtoolsHost + '/json/list')).json()).find(page => page.id === targetId);
            socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.once('open', resolve));
            const live = new CDP(socket); await live.call('Runtime.enable'); await live.call('Page.enable');
            await live.call('Emulation.setDeviceMetricsOverride', { width: 1450, height: 1100, deviceScaleFactor: 1, mobile: false });
            await live.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/diagnostics/' });
            await until(() => live.evaluate('document.querySelector(\'#connection\')?.textContent.includes(\'Logprozess aktiv\')'));
            await live.evaluate('document.querySelector(\'#search\').value=' + JSON.stringify(marker) + ';document.querySelector(\'#search\').dispatchEvent(new Event(\'input\'));');
            await until(() => live.evaluate('document.querySelector(\'#logs\').textContent.includes(' + JSON.stringify(marker) + ')'));
            assert(await live.evaluate('!document.querySelector(\'#logs\').textContent.includes(\'do-not-export-this\')'));
            assert(await live.evaluate('document.querySelector(\'#logs\').textContent.includes(\'speech_timeout\')'));
            const exportsPath = path.join(directory, 'exports'); fs.mkdirSync(exportsPath, { recursive: true });
            await live.call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: exportsPath });
            await live.evaluate('document.querySelector(\'#export\').click()');
            const exported = await until(() => fs.readdirSync(exportsPath).find(name => name.endsWith('.json')));
            const report = JSON.parse(fs.readFileSync(path.join(exportsPath, exported), 'utf8'));
            assert(report.items.some(row => row.message.includes(marker))); assert(!JSON.stringify(report).includes('do-not-export-this'));
            await live.evaluate('document.querySelector(\'[data-tab="devices"]\').click()');
            const selector = '[data-reload="page"][data-value="' + original.page_id + '"]';
            await until(() => live.evaluate('!!document.querySelector(' + JSON.stringify(selector) + ')'));
            await live.evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()');
            await until(() => [...hub.commands.values()].some(command => command.targets.some(target => target.page_id === original.page_id && target.state === 'waiting')));
            assert(await devtools.evaluate('!!document.querySelector(\'#diagnostics-unsaved\')'));
            assert.strictEqual(await devtools.evaluate('btsDiagnostics.context().instance'), original.instance);
            await devtools.evaluate('document.querySelector(\'#diagnostics-unsaved\').remove()');
            await until(() => [...hub.commands.values()].some(command => command.targets.some(target => target.page_id === original.page_id && target.state === 'reconnected')));
            await until(() => devtools.evaluate('!!window.btsDiagnostics && btsDiagnostics.context().instance !== ' + JSON.stringify(original.instance)));
            const after = await devtools.evaluate('btsDiagnostics.context()');
            assert.strictEqual(after.page_id, original.page_id); assert.strictEqual(after.device_id, original.device_id);
            assert.strictEqual(after.version, hub.version);
            await until(() => live.evaluate('document.querySelector(\'#commands\').textContent.includes(\'Wieder verbunden\')'));
            if (process.env.BTS_DIAGNOSTICS_SCREENSHOT) {
                const shot = await live.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
                fs.writeFileSync(process.env.BTS_DIAGNOSTICS_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
            await live.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
            await live.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            assert(await live.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'the device view must fit a phone');
            assert.deepStrictEqual(live.events.filter(event => event.method === 'Runtime.exceptionThrown'), []);
        } finally {
            await devtools.evaluate('document.querySelector(\'#diagnostics-unsaved\')?.remove()').catch(() => {});
            socket?.close(); if (targetId) await devtools.call('Target.closeTarget', { targetId });
        }
    });

    it('registers an actual BUP display and centrally reloads it with its browser identity preserved', async function() {
        let targetId, socket;
        try {
            ({ targetId } = await devtools.call('Target.createTarget', { url: 'about:blank' }));
            const target = (await (await fetch('http://' + devtoolsHost + '/json/list')).json()).find(page => page.id === targetId);
            socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise(resolve => socket.once('open', resolve));
            const live = new CDP(socket); await live.call('Runtime.enable'); await live.call('Page.enable');
            await live.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/bup/bup.html#btsh_e=default&display' });
            await until(() => live.evaluate('!!window.btsDiagnostics && typeof state !== \'undefined\' && !!state.ui?.displaymode_visible && btsDiagnostics.context().role === \'display\''));
            const before = await live.evaluate('btsDiagnostics.context()');
            assert.strictEqual(before.role, 'display');
            await until(() => app.diagnostics.pages.get(before.page_id)?.role === 'display');
            const command = app.diagnostics.reload('page', before.page_id);
            await until(() => command.targets[0].state === 'reconnected');
            await until(() => live.evaluate('!!window.btsDiagnostics && btsDiagnostics.context().role === \'display\' && btsDiagnostics.context().instance !== ' + JSON.stringify(before.instance)));
            const after = await live.evaluate('btsDiagnostics.context()');
            assert.strictEqual(after.page_id, before.page_id); assert.strictEqual(after.device_id, before.device_id);
            assert.strictEqual(after.role, 'display'); assert.strictEqual(after.version, app.diagnostics.version);
        } finally { socket?.close(); if (targetId) await devtools.call('Target.closeTarget', { targetId }); }
    });

    it('shows speech faults prominently in every admin page and in newly opened planning windows, then clears them after recovery', async function() {
        let targetId, socket, legacySocket;
        const health = app.speech.health;
        for (const source of health.issues.keys()) health.clear(source);
        try {
            const legacyMessages = [];
            legacySocket = new WebSocket('ws://127.0.0.1:' + server.address().port + '/ws/admin', 'bts-admin');
            legacySocket.on('message', data => legacyMessages.push(JSON.parse(data)));
            await new Promise(resolve => legacySocket.once('open', resolve));
            await devtools.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/' });
            await until(() => devtools.evaluate('document.querySelector(\'.speech_health_banner\')?.hidden === true'));
            health.fail('worker', Object.assign(new Error('fixture processing failed <script>window.__healthInjected=true</script>'),
                { code: 'playback_processing_failed' }));
            await until(() => devtools.evaluate('document.querySelector(\'.speech_health_banner\')?.hidden === false'));
            await rpc(legacySocket, { type: 'debug_queue_stats' });
            assert(!legacyMessages.some(message => message.type === 'speech_health'), 'do not push unsupported messages to a legacy admin window');
            assert(await devtools.evaluate('document.querySelector(\'.speech_health_banner\').textContent.includes(\'Turnierbetrieb läuft weiter\')'));
            assert(await devtools.evaluate('document.querySelector(\'.speech_health_banner\').textContent.includes(\'playback_processing_failed\')'));
            assert(await devtools.evaluate('document.querySelector(\'.speech_health_banner\').getAttribute(\'role\') === \'alert\''));
            assert(await devtools.evaluate('!document.querySelector(\'.speech_health_banner script\') && !window.__healthInjected'));
            ({ targetId } = await devtools.call('Target.createTarget', { url: 'about:blank' }));
            const page = (await (await fetch('http://' + devtoolsHost + '/json/list')).json()).find(page => page.id === targetId);
            socket = new WebSocket(page.webSocketDebuggerUrl);
            await new Promise(resolve => socket.once('open', resolve));
            const live = new CDP(socket); await live.call('Runtime.enable'); await live.call('Page.enable');
            await live.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
            await live.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/t/default/speech-planning/' });
            await until(() => live.evaluate('document.querySelector(\'.speech_health_banner\')?.hidden === false'));
            await live.evaluate('window.scrollTo(0,1000); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            assert(await live.evaluate('(() => {const b=document.querySelector(\'.speech_health_banner\').getBoundingClientRect(); ' +
                'return b.top >= 0 && b.bottom <= innerHeight && document.documentElement.scrollWidth <= document.documentElement.clientWidth;})()'),
                'the mobile fault banner remains visible while scrolling without horizontal overflow');
            if (process.env.BTS_SPEECH_HEALTH_SCREENSHOT) {
                const shot = await live.call('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(process.env.BTS_SPEECH_HEALTH_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
            health.clear('worker');
            await until(() => live.evaluate('document.querySelector(\'.speech_health_banner\')?.hidden === true'));
            await until(() => devtools.evaluate('document.querySelector(\'.speech_health_banner\')?.hidden === true'));
            assert.deepStrictEqual(live.events.filter(event => event.method === 'Runtime.exceptionThrown'), []);
        } finally {
            health.clear('worker'); socket?.close(); legacySocket?.close();
            if (targetId) await devtools.call('Target.closeTarget', { targetId });
        }
    });

    it('shows parallel speech work by executor and separates normal waiting from actual retries', async function() {
        const originalPlanning = admin.handle_speech_planning, originalQueue = admin.handle_speech_queue;
        const base = app.speech.prefetch.planning_status('default');
        const items = [
            { key: 'parallel-server', text: 'Lokale Kontextaufnahme', current: true, status: 'processing', execution: { kind: 'server', name: 'Sprachserver', phase: 'synthesis' } },
            { key: 'parallel-helper', text: 'Externe Kontextaufnahme', current: true, status: 'processing', execution: { kind: 'helper', name: 'Testhost', phase: 'synthesis' } },
            { key: 'parallel-quality', text: 'Fertige Helferaufnahme', current: false, status: 'processing', execution: { kind: 'server', name: 'Sprachserver', phase: 'waiting_validation' } },
            { key: 'parallel-busy', text: 'Warte auf freien Server', current: false, status: 'unsubmitted', waiting_for_server: true },
            { key: 'parallel-failed', text: 'Tatsächlich fehlgeschlagen', current: false, status: 'failed', retry_at: Date.now() + 60000 },
            { key: 'parallel-source-ready', text: 'Quelle bereits fertig', current: false, status: 'unsubmitted', source_key: 'ready-source', position: null, waiting_for_source: false },
            { key: 'parallel-source-missing', text: 'Quelle noch offen', current: false, status: 'unsubmitted', source_key: 'missing-source', position: null, waiting_for_source: true },
        ].map(item => ({ priority: 'normal', voice: 'hallensprecher', retry_at: 0, operation: 'synthesis',
            planning: { stage: 'shared', reason: 'Gemeinsamer Sprachvorrat' }, ...item }));
        let count = 2;
        admin.handle_speech_planning = (_app, ws, msg) => ws.respond(msg, null, { planning: { ...base,
            state: count ? 'working' : 'idle_pending', active_stage: count ? 'shared' : null, running_count: count, updating: !count,
            current: count ? { text: items[0].text, status: 'processing', running: true, planning: items[0].planning } : null, updated_at: Date.now() } });
        admin.handle_speech_queue = (_app, ws, msg) => ws.respond(msg, null, { queue: { items, busy_elsewhere: false } });
        try {
            await devtools.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/t/default/speech-planning/' });
            await until(() => devtools.evaluate('document.querySelector(\'#queue-running\')?.textContent === \'2 laufen\''));
            assert.strictEqual(await devtools.evaluate('document.querySelectorAll(\'.speech_plan_queue_item[data-current="true"]\').length'), 2);
            assert(await devtools.evaluate('document.querySelector(\'#now-state\').textContent.includes(\'2 Aufträge parallel\')'));
            assert(await devtools.evaluate('document.querySelectorAll(\'.speech_plan_queue_meta\')[1].textContent.includes(\'Testhost\')'));
            assert.strictEqual(await devtools.evaluate('document.querySelectorAll(\'.speech_plan_queue_status\')[2].textContent'), 'Wartet auf zentrale Prüfung');
            assert.strictEqual(await devtools.evaluate('document.querySelectorAll(\'.speech_plan_queue_status\')[3].textContent'), 'Wartet auf Sprachserver');
            assert(await devtools.evaluate('document.querySelectorAll(\'.speech_plan_queue_status\')[4].textContent.includes(\'erneuter Versuch\')'));
            assert.strictEqual(await devtools.evaluate('document.querySelectorAll(\'.speech_plan_queue_status\')[5].textContent'), 'Wartet auf Aufbereitung');
            assert.strictEqual(await devtools.evaluate('document.querySelectorAll(\'.speech_plan_queue_status\')[6].textContent'), 'Wartet auf Quellaufnahme');
            if (process.env.BTS_PARALLEL_QUEUE_SCREENSHOT) {
                const shot = await devtools.call('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(process.env.BTS_PARALLEL_QUEUE_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
            await devtools.evaluate('window.__parallelHelperNode=document.querySelectorAll(\'.speech_plan_queue_item\')[1]');
            count = 1; items[1].current = false; items[1].execution.phase = 'waiting_validation';
            await until(() => devtools.evaluate('document.querySelector(\'#queue-running\')?.textContent === \'1 läuft\''));
            assert(await devtools.evaluate('window.__parallelHelperNode === document.querySelectorAll(\'.speech_plan_queue_item\')[1]'));
            assert.strictEqual(await devtools.evaluate('document.querySelectorAll(\'.speech_plan_queue_status\')[1].textContent'), 'Wartet auf zentrale Prüfung');
            count = 0; items[0].current = false;
            await until(() => devtools.evaluate('document.querySelector(\'#now-name\')?.textContent === \'Plan wird aktualisiert\''));
            assert(await devtools.evaluate('document.querySelector(\'#now-why\').textContent.includes(\'aktualisierte Reihenfolge\')'));
        } finally { admin.handle_speech_planning = originalPlanning; admin.handle_speech_queue = originalQueue; }
    });

    it('shows regular helper jobs, central validation and required updates without exposing raw audio as ready', async function() {
        const previous = app.speech.helpers;
        const job = { id: 'a'.repeat(32), kind: 'source', voice: 'hallensprecher', state: 'completed', worker_id: 'worker',
            text: 'Wir erwarten <script>window.__helperInjected=true</script> zum Spiel.', attempt: 1, created_at: Date.now() };
        const state = { runtime: { id: 'b'.repeat(64), size_bytes: 2 * 1024 ** 3 }, generation: { ready: true }, mode: 'production',
            workers: [{ id: 'worker', name: 'Testhost', platform: 'Linux', threads: 2, memory_limit_mib: 3584,
                online: true, completed: 1, job_id: job.id, text: job.text }], jobs: [job] };
        app.speech.helpers = { snapshot: async () => state };
        try {
            await devtools.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/t/default/speech-helpers/' });
            await until(() => devtools.evaluate('document.querySelector(\'#connection\')?.textContent.includes(\'automatisch verteilt\')'));
            assert(await devtools.evaluate('document.querySelector(\'#jobs\').textContent.includes(\'Wartet auf zentrale Prüfung\')'));
            assert(await devtools.evaluate('document.querySelector(\'#jobs\').textContent.includes(\'Kontextaufnahme\')'));
            assert(await devtools.evaluate('document.querySelector(\'#workers\').textContent.includes(\'Wir erwarten <script>\')'));
            assert(await devtools.evaluate('!window.__helperInjected && !document.querySelector(\'#jobs script, #workers script, #jobs audio\')'));
            job.publication = 'ready';
            await until(() => devtools.evaluate('document.querySelector(\'#jobs strong\')?.textContent === \'Bereit\''));
            state.generation = { ready: false, reason: 'helper_profile_mismatch' };
            state.workers[0].job_id = null; state.workers[0].update_required = true;
            await until(() => devtools.evaluate('document.querySelector(\'#connection\')?.textContent.includes(\'Helferpaket passt nicht\')'));
            assert(await devtools.evaluate('document.querySelector(\'#workers\').textContent.includes(\'Neuen Starter herunterladen\')'));
            if (process.env.BTS_HELPERS_SCREENSHOT) {
                const shot = await devtools.call('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(process.env.BTS_HELPERS_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
        } finally { app.speech.helpers = previous; }
    });

    it('explains an unreachable speech server in the admin and helper pages and automatically clears the notice after recovery', async function() {
        let targetId, socket;
        const broker = app.speech.broker, originalRequest = broker.request;
        const endpoint = broker.config.base_url;
        try {
            broker.request = async (...args) => {
                if (['/health', '/v1/voices'].includes(args[3])) throw Object.assign(new Error('connect failed ' + key), { code: 'ECONNREFUSED' });
                return originalRequest(...args);
            };
            await broker.refresh();
            await devtools.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/' });
            await until(() => devtools.evaluate('document.querySelector(\'.speech_health_banner\')?.hidden === false'));
            assert(await devtools.evaluate('document.querySelector(\'.speech_health_banner strong\').textContent.startsWith(\'Sprachserver nicht erreichbar\')'));
            assert(await devtools.evaluate('document.querySelector(\'.speech_health_banner\').textContent.includes(\'„make dev“ startet nur BTS\')'));
            assert(await devtools.evaluate('document.querySelector(\'.speech_health_banner\').textContent.includes(' + JSON.stringify(endpoint) + ')'));
            assert.strictEqual(await devtools.evaluate('document.querySelector(\'.speech_health_banner details\').open'), false);
            assert.strictEqual(await devtools.evaluate('document.querySelector(\'.speech_health_banner\').textContent.includes(' + JSON.stringify(key) + ')'), false);
            assert.strictEqual(await devtools.evaluate('[...document.querySelectorAll(\'.speech_health_banner > p\')].filter(p=>p.textContent.startsWith(\'Sprachserver:\')).length'), 1,
                'health and voices share one explanation');
            await devtools.evaluate('document.querySelector(\'.speech_health_banner details\').open=true');
            assert(await devtools.evaluate('document.querySelector(\'.speech_health_banner details\').textContent.includes(\'ECONNREFUSED\')'));

            ({ targetId } = await devtools.call('Target.createTarget', { url: 'about:blank' }));
            const page = (await (await fetch('http://' + devtoolsHost + '/json/list')).json()).find(page => page.id === targetId);
            socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise(resolve => socket.once('open', resolve));
            const live = new CDP(socket); await live.call('Runtime.enable'); await live.call('Page.enable');
            await live.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
            await live.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/t/default/speech-helpers/' });
            await until(() => live.evaluate('document.querySelector(\'.speech_health_banner\')?.hidden === false'));
            assert(await live.evaluate('document.querySelector(\'.speech_health_banner strong\').textContent.startsWith(\'Sprachserver nicht erreichbar\')'));
            assert(await live.evaluate('document.documentElement.scrollWidth<=innerWidth'), 'connection guidance fits a phone');
            if (process.env.BTS_SPEECH_HEALTH_SCREENSHOT) {
                const shot = await live.call('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(process.env.BTS_SPEECH_HEALTH_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
            broker.request = originalRequest; await broker.refresh();
            await until(() => live.evaluate('document.querySelector(\'.speech_health_banner\')?.hidden === true'));
            await until(() => devtools.evaluate('document.querySelector(\'.speech_health_banner\')?.hidden === true'));
            assert.deepStrictEqual(live.events.filter(event => event.method === 'Runtime.exceptionThrown'), []);
        } finally {
            broker.request = originalRequest; await broker.refresh();
            socket?.close(); if (targetId) await devtools.call('Target.closeTarget', { targetId });
        }
    });

    it('shows the live planning design in both views with shared selection, complete connections and read-only updates', async function() {
        const { STAGES } = require('../bts/speech/planning_status');
        const original = admin.handle_speech_planning, originalQueue = admin.handle_speech_queue;
        const response = { title: 'Automatische Sprachplanung', voice: 'hallensprecher', phase: 'competition', has_officials: true,
            games: { oncourt: 1, preparation: 1, candidate: 1, planned: 1, finished: 0 }, state: 'working',
            active_stage: 'oncourt', current: { text: 'Aktuelle Aufnahme', running: true },
            total: { ready: 0, queued: STAGES.length, total: STAGES.length },
            stages: STAGES.map(([id, label, node]) => ({ id, label, node, ready: 0, queued: 1, total: 1 })) };
        let targetId, socket, sequence = 0;
        const queueItems = [
            { key: 'current', text: 'Aktuelle Aufnahme', current: true, position: 0, status: 'processing', priority: 'normal', voice: 'hallensprecher', operation: 'synthesis' },
            { key: 'next', text: 'Auf Spielfeld 4', position: 1, status: 'unsubmitted', priority: 'high', voice: 'hallensprecher', operation: 'synthesis' },
            { key: 'later', text: 'Musterverein spielt jetzt gegen Musterverein!', position: 2, status: 'unsubmitted', priority: 'normal', voice: 'hallensprecher', operation: 'synthesis' },
            { key: 'failed', text: '<script>Kein HTML ausführen</script>', status: 'failed', priority: 'low', voice: 'hallensprecherin', terminal_failure: true },
            { key: 'done', text: 'Bereits fertige Aufnahme', status: 'completed', priority: 'normal', voice: 'hallensprecher' },
        ];
        response.registration_order = [
            { id: 'open', name: 'JE U17', order: 1, btp_order: 2, state: 'open', counts: { state: 2, club: 3, player: 8, pair: 0, team: 8 } },
            { id: 'open-two', name: 'JD U19', order: 2, btp_order: 3, state: 'open', counts: { state: 1, club: 2, player: 8, pair: 4, team: 4 } },
            { id: 'completed', name: 'ME U15', order: null, btp_order: 4, state: 'completed', counts: {} },
            { id: 'later', name: 'ME U19', order: 3, btp_order: 1, state: 'closed', counts: { state: 1, club: 2, player: 6, pair: 0, team: 6 } },
            { id: 'later-two', name: 'MD U19', order: 4, btp_order: 5, state: 'closed', counts: { state: 2, club: 3, player: 8, pair: 4, team: 4 } },
            { id: 'drawn', name: 'DE U17', order: null, btp_order: 6, state: 'drawn', counts: {} },
        ];
        response.registration_order[0].first_game = { number: 25, date: '2026-09-26', time: '10:00' };
        response.registration_order[1].first_game = { number: 396, date: '2026-09-27', time: '12:00' };
        response.registration_progress = [
            { id: 'common', ready: 2, queued: 0, failed: 0, total: 2, events: [] },
            { id: 'open_states', ready: 3, queued: 0, failed: 0, total: 3, events: [
                { id: 'open', ready: 2, queued: 0, failed: 0, total: 2 }, { id: 'open-two', ready: 1, queued: 0, failed: 0, total: 1 },
            ] },
            { id: 'open_clubs', ready: 1, queued: 4, failed: 0, total: 5, events: [
                { id: 'open', ready: 1, queued: 2, failed: 0, total: 3 }, { id: 'open-two', ready: 0, queued: 2, failed: 0, total: 2 },
            ] },
            { id: 'open_people', ready: 0, queued: 12, failed: 0, total: 12, events: [
                { id: 'open', ready: 0, queued: 8, failed: 0, total: 8 }, { id: 'open-two', ready: 0, queued: 4, failed: 0, total: 4 },
            ] },
            { id: 'open_numbers', ready: 4, queued: 4, failed: 0, total: 8, events: [
                { id: 'open', ready: 4, queued: 0, failed: 0, total: 4 }, { id: 'open-two', ready: 0, queued: 4, failed: 0, total: 4 },
            ] },
            { id: 'closed_states', ready: 0, queued: 3, failed: 0, total: 3, events: [
                { id: 'later', ready: 0, queued: 1, failed: 0, total: 1 }, { id: 'later-two', ready: 0, queued: 2, failed: 0, total: 2 },
            ] },
            { id: 'closed_clubs', ready: 0, queued: 5, failed: 0, total: 5, events: [
                { id: 'later', ready: 0, queued: 2, failed: 0, total: 2 }, { id: 'later-two', ready: 0, queued: 3, failed: 0, total: 3 },
            ] },
            { id: 'closed_people', ready: 0, queued: 16, failed: 0, total: 16, events: [
                { id: 'later', ready: 0, queued: 6, failed: 0, total: 6 }, { id: 'later-two', ready: 0, queued: 10, failed: 0, total: 10 },
            ] },
            { id: 'closed_numbers', ready: 0, queued: 8, failed: 0, total: 8, events: [
                { id: 'later', ready: 0, queued: 4, failed: 0, total: 4 }, { id: 'later-two', ready: 0, queued: 4, failed: 0, total: 4 },
            ] },
        ];
        for (const event of response.registration_order.filter(event => ['open', 'closed'].includes(event.state))) event.counts.number = 4;
        response.registration_groups = [
            { id: 'open', ready: 8, queued: 20, failed: 0, total: 28 },
            { id: 'closed', ready: 0, queued: 32, failed: 0, total: 32 },
        ];
        response.tablet_progress = [
            { id: 'tablet-one', name: 'MX U15', order: 1, btp_order: 5, next_game: { number: 17, time: '10:00' }, ready: 5, queued: 0, failed: 0, total: 5 },
            { id: 'tablet-two', name: 'MD U19', order: 2, btp_order: 3, next_game: { number: 21, time: '10:30' }, ready: 1, queued: 2, failed: 0, total: 3 },
            { id: 'tablet-empty', name: 'ME U17', order: 3, btp_order: 6, ready: 0, queued: 0, failed: 0, total: 0 },
        ];
        for (const event of response.tablet_progress) event.counts = { state: 1, club: 2, player: 4, pair: 2, team: 2, number: event.total ? 4 : 0 };
        response.tablet_phases = ['states', 'clubs', 'people'].map(id => ({ id,
            ready: id === 'people' ? 6 : 8, queued: id === 'people' ? 2 : 0, failed: 0, total: 8,
            events: response.tablet_progress.map(event => ({ ...event,
                ...(id !== 'people' ? { ready: event.total, queued: 0 } : {}) })),
        }));
        response.tablet_phases.push({ id: 'numbers', ready: 4, queued: 4, failed: 0, total: 8,
            events: response.tablet_progress.map((event, index) => ({ id: event.id, ready: index === 0 ? 4 : 0,
                queued: index === 1 ? 4 : 0, failed: 0, total: event.counts.number })) });
        for (const [index, event] of response.tablet_progress.entries()) {
            event.total += event.counts.number;
            if (index === 0) event.ready += event.counts.number;
            else event.queued += event.counts.number;
        }
        queueItems[2].planning = { stage: 'registration', event_id: 'open', kind: 'club', registration_phase: 'open_clubs',
            reason: 'Anmeldevorarbeit → 2. Vereine aller offenen Anmeldungen → Disziplin 1: JE U17 (Anmeldung geöffnet) → Verein 2: Musterverein · Quellaufnahme vor dem benötigten Ausschnitt.' };
        admin.handle_speech_planning = (_app, ws, msg) => {
            ws.speech_planning_test = true;
            ws.respond(msg, null, { planning: { ...response, updated_at: ++sequence } });
        };
        admin.handle_speech_queue = (app, ws, msg) => {
            if (!ws.speech_planning_test) return originalQueue(app, ws, msg);
            assert.strictEqual(msg.pending_only, true);
            ws.respond(msg, null, { queue: { items: queueItems, busy_elsewhere: false } });
        };
        try {
            ({ targetId } = await devtools.call('Target.createTarget', { url: 'about:blank' }));
            const page = (await (await fetch('http://' + devtoolsHost + '/json/list')).json()).find(page => page.id === targetId);
            socket = new WebSocket(page.webSocketDebuggerUrl);
            await new Promise(resolve => socket.once('open', resolve));
            const live = new CDP(socket);
            await live.call('Runtime.enable'); await live.call('Page.enable');
            await live.call('Page.addScriptToEvaluateOnNewDocument', { source:
                'const interval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>interval(fn,ms===2000?100:ms,...args);' });
            await live.call('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1250, deviceScaleFactor: 1, mobile: false });
            const address = 'http://127.0.0.1:' + server.address().port + '/admin/t/default/speech-planning/';
            const received = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8');
            await live.call('Page.navigate', { url: address });
            const updated = () => live.evaluate('document.querySelector(\'.speech_plan_live\')?.dataset.updatedAt');
            const nextUpdate = async () => { const old = await updated(); await until(async () => (await updated()) !== old); };
            await until(() => live.evaluate('document.querySelector(\'.speech_plan_live\')?.dataset.connected === \'true\''));
            assert(await live.evaluate('document.querySelector(\'#view-overview\').getAttribute(\'aria-selected\') === \'true\''));
            assert(await live.evaluate('document.querySelector(\'.plan-step[aria-pressed="true"]\').dataset.stage === \'oncourt\''));
            assert(await live.evaluate('!document.body.textContent.includes(\'ausschließlich Beispieldaten\') && !document.querySelector(\'#scenario,#error-toggle,iframe\')'));
            assert.strictEqual(await live.evaluate('typeof btsSpeechService'), 'undefined', 'the planning page must not load an audio client');
            const stageNumbers = () => live.evaluate('[...document.querySelectorAll(\'.plan-step\')].map(node=>[node.dataset.stage,node.querySelector(\'.number\').textContent])');
            assert.deepStrictEqual(await stageNumbers(), [
                ['urgent', '01'], ['test', '02'], ['shared', '03'], ['officials', '04'],
                ['tablet_waiting', '05'], ['oncourt', '06'], ['preparation', '07'], ['additional', ''],
                ['candidate', '08'], ['planned', '09'], ['tablet', '10'], ['registration', '11'], ['people', '12'], ['spare', '13'],
            ]);
            const queueTexts = () => live.evaluate('[...document.querySelectorAll(\'.speech_plan_queue_text\')].map(node=>node.textContent)');
            assert.deepStrictEqual(await queueTexts(), queueItems.slice(0, 4).map(item => item.text));
            assert(await live.evaluate('document.querySelector(\'.speech_plan_queue_summary\').textContent.includes(\'1 läuft · 2 warten · 1 fehlgeschlagen\')'));
            assert.strictEqual(await live.evaluate('document.querySelector(\'.speech_plan_queue_text script\')'), null);
            await live.evaluate('document.querySelector(\'.plan-step[data-stage="registration"]\').click()');
            assert(await live.evaluate('document.querySelector(\'.detail-description\').textContent.startsWith(\'Geöffnete Anmeldungen zuerst\')'));
            assert(await live.evaluate('document.querySelector(\'.flow-registration-next\').textContent === \'Danach → Übrige Personen und Teams\''));
            const additional = response.stages.find(row => row.id === 'additional');
            Object.assign(additional, { total: 0, queued: 0 }); await nextUpdate();
            assert.deepStrictEqual(await stageNumbers(), [
                ['urgent', '01'], ['test', '02'], ['shared', '03'], ['officials', '04'],
                ['tablet_waiting', '05'], ['oncourt', '06'], ['preparation', '07'], ['candidate', '08'], ['planned', '09'],
                ['tablet', '10'], ['registration', '11'], ['people', '12'], ['spare', '13'],
            ], 'the normal competition order must match the approved draft');
            assert.deepStrictEqual(await live.evaluate('[...document.querySelectorAll(\'.plan-group h3\')].map(node=>node.textContent)'), [
                'Turniervorarbeit', 'Aktueller Spielbetrieb', 'Vorbereitung des Spielbetriebs', 'Weitere Vorbereitung', 'Nur bei vollständigem Leerlauf',
            ], 'preserve the draft group headings');
            assert(await live.evaluate('document.querySelector(\'.detail-number\').textContent === \'11\' && document.querySelector(\'.next-step button\').textContent.startsWith(\'12 \')'));
            assert(await live.evaluate('!document.querySelector(\'.plan-group h3 .number,.flow-work-group > .flow-title .flow-number\')'), 'group headings must remain unnumbered as in the draft');
            Object.assign(additional, { total: 1, queued: 1 }); await nextUpdate();
            assert.strictEqual(await live.evaluate('document.querySelectorAll(\'.detail .area\').length'), 2);
            assert.deepStrictEqual(await live.evaluate('[...document.querySelectorAll(\'.detail .area:first-of-type .matrix tbody .event-name\')].map(n=>n.textContent)'), ['1.JE U17', '2.JD U19']);
            assert(await live.evaluate('document.querySelector(\'.detail .phase-summary\').textContent.includes(\'3 bereit\')'));
            assert.deepStrictEqual(await live.evaluate('[...document.querySelectorAll(\'.detail .area:first-of-type .phase-name\')].map(node=>node.textContent)'),
                ['Landesverbände', 'Vereine', 'Spieler/Paarungen', 'Spielnummern · erste Runde']);
            assert(await live.evaluate('document.querySelector(\'.cell[data-area="open"][data-phase="numbers"][data-event="open"]\').textContent.includes(\'4 bereit\')'));
            assert(await live.evaluate('(() => {const nodes=[...document.querySelectorAll(\'#registration-phase-open_people .registration-flow-state\')];return nodes.map(node=>node.dataset.subphase+\':\'+node.dataset.eventId).join(\',\')===\'open_people:open,open_numbers:open,open_people:open-two,open_numbers:open-two\';})()'));
            assert(await live.evaluate('document.querySelector(\'.registration-flow-state[data-subphase="open_numbers"][data-event-id="open"]\').dataset.ready===\'4\' && document.querySelector(\'.registration-flow-state[data-subphase="open_people"][data-event-id="open"]\').dataset.ready===\'0\''));
            await live.evaluate('document.querySelector(\'.cell[data-area="open"][data-phase="numbers"][data-event="open"]\').click()');
            assert(await live.evaluate('document.querySelector(\'.selection h3\').textContent.includes(\'JE U17 · Spielnummern · erste Runde\')'));
            await live.evaluate('document.querySelector(\'#view-diagram\').click()');
            await until(() => live.evaluate('document.querySelector(\'.registration-flow-state.plan-selected\')?.dataset.subphase === \'open_numbers\''));
            assert(await live.evaluate('document.querySelector(\'.registration-flow-state.plan-selected\').dataset.eventId===\'open\''));
            await live.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            assert(await live.evaluate(`(() => {
                const cards=[...document.querySelectorAll('#registration-phase-open_people .registration-flow-state')].map(node=>node.getBoundingClientRect());
                const [people,numbers,nextPeople,nextNumbers]=cards;
                return Math.abs(people.top-numbers.top)<1 && numbers.left>people.right &&
                    nextPeople.top>Math.max(people.bottom,numbers.bottom) && Math.abs(nextPeople.left-people.left)<1 &&
                    Math.abs(nextPeople.top-nextNumbers.top)<1 && nextNumbers.left>nextPeople.right;
            })()`), 'each discipline must run left to right, returning to the left in the next row');
            if (process.env.BTS_SPEECH_NUMBER_SEPARATION_SCREENSHOT) {
                const clip = await live.evaluate('(() => {const r=document.querySelector(\'#registration-area-open\').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:Math.min(r.height,1600),scale:1};})()');
                const shot = await live.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
                fs.writeFileSync(process.env.BTS_SPEECH_NUMBER_SEPARATION_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
            await live.evaluate('document.querySelector(\'.registration-flow-state[data-subphase="open_numbers"][data-event-id="open-two"]\').click();document.querySelector(\'#diagram-details\').click()');
            assert(await live.evaluate('document.querySelector(\'.selection h3\').textContent.includes(\'JD U19 · Spielnummern · erste Runde\')'));
            const cell = '.detail .cell[data-area="open"][data-phase="clubs"][data-event="open"]';
            await live.evaluate('document.querySelector(' + JSON.stringify(cell) + ').click();document.querySelector(' + JSON.stringify(cell) + ').focus()');
            assert(await live.evaluate('document.querySelector(\'.selection h3\').textContent.includes(\'JE U17 · Vereine\')'));
            assert(await live.evaluate('document.querySelector(\'.sample-parts\').textContent.includes(\'Musterverein\')'));
            response.registration_progress.find(row => row.id === 'open_clubs').events[0].ready = 2;
            await nextUpdate();
            assert(await live.evaluate('document.activeElement.dataset.focusKey === \'cell:open:clubs:open\''), 'keep keyboard focus across progress updates');
            assert(await live.evaluate('document.querySelector(\'.plan-step[aria-pressed="true"]\').dataset.stage === \'registration\''), 'keep a manual selection while another area is active');
            await live.evaluate('document.querySelector(\'#view-diagram\').click()');
            await until(() => live.evaluate('document.querySelectorAll(\'.flow-edge\').length > 0'));
            assert(await live.evaluate('document.querySelector(\'.speech_plan_queue\').getBoundingClientRect().left > document.querySelector(\'#diagram-panel\').getBoundingClientRect().right'));
            assert(await live.evaluate('document.querySelector(\'.registration-flow-state.plan-selected\').dataset.eventId === \'open\''));
            await live.evaluate('document.querySelector(\'.tablet-flow-state[data-tablet-phase="clubs"][data-event-id="tablet-two"]\').click();document.querySelector(\'#diagram-details\').click()');
            assert(await live.evaluate('document.querySelector(\'.selection h3\').textContent.includes(\'MD U19 · Vereine\')'));
            assert(await live.evaluate('document.querySelector(\'.matrix .event-meta\').textContent.includes(\'4 anwesende Spieler\')'));
            await live.evaluate('document.querySelector(\'.cell[data-area="tablet"][data-phase="numbers"][data-event="tablet-one"]\').click()');
            assert(await live.evaluate('document.querySelector(\'.selection h3\').textContent.includes(\'MX U15 · Spielnummern · erste Runde\')'));
            assert.strictEqual(await live.evaluate('document.querySelector(\'#now-name\').textContent'), response.current.text, 'a manual selection must not change the current job');
            await live.evaluate('document.querySelector(\'#view-diagram\').click()');
            await until(() => live.evaluate('document.querySelectorAll(\'.flow-edge\').length > 0'));
            await live.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            assert.deepStrictEqual(await live.evaluate('[...document.querySelectorAll(\'#tablet-event-tablet-one .tablet-flow-state\')].map(node=>node.dataset.tabletPhase)'),
                ['states', 'clubs', 'people', 'numbers']);
            assert(await live.evaluate('(() => {const root=document.querySelector(\'#tablet-event-tablet-one\'),people=root.querySelector(\'[data-tablet-phase="people"]\').getBoundingClientRect(),numbers=root.querySelector(\'[data-tablet-phase="numbers"]\').getBoundingClientRect();return Math.abs(people.top-numbers.top)<1&&numbers.left>people.right;})()'));
            assert(await live.evaluate('document.querySelector(\'.tablet-flow-state.plan-selected\').dataset.tabletPhase===\'numbers\''));
            if (process.env.BTS_SPEECH_COMPLETED_NUMBERS_SCREENSHOT) {
                const clip = await live.evaluate('(() => {const r=document.querySelector(\'#tablet-event-tablet-one\').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()');
                const shot = await live.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
                fs.writeFileSync(process.env.BTS_SPEECH_COMPLETED_NUMBERS_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
            // Verify actual border attachment, clear routing and a complete
            // connection chain in every main category and nested subcategory.
            const geometry = () => live.evaluate(`(() => {
                const errors=[],near=(a,b)=>Math.abs(a-b)<1.2;
                const types='.flow-state,.registration-flow-area,.registration-flow-phase,.tablet-flow-event,.registration-flow-state,.tablet-flow-state';
                const states=[...document.querySelectorAll(types)].filter(n=>n.getBoundingClientRect().width>0);
                for(const path of document.querySelectorAll('.flow-edge,.work-flow-edge,.sub-flow-edge')){
                    const coords=path.getAttribute('d').match(/[-+]?(?:\\d*\\.)?\\d+(?:e[-+]?\\d+)?/gi).map(Number),points=[];
                    for(let i=0;i<coords.length;i+=2)points.push(new DOMPoint(coords[i],coords[i+1]).matrixTransform(path.getScreenCTM()));
                    const from=document.getElementById(path.dataset.from),to=document.getElementById(path.dataset.to),id=from.id+' → '+to.id;
                    const onBorder=(p,n)=>{const r=n.getBoundingClientRect();return ((near(p.x,r.left)||near(p.x,r.right))&&p.y>=r.top-1&&p.y<=r.bottom+1)||((near(p.y,r.top)||near(p.y,r.bottom))&&p.x>=r.left-1&&p.x<=r.right+1);};
                    if(!onBorder(points[0],from)||!onBorder(points.at(-1),to))errors.push(id+' detached');
                    for(let i=1;i<points.length;i++){
                        const a=points[i-1],b=points[i];
                        if(!near(a.x,b.x)&&!near(a.y,b.y))errors.push(id+' diagonal');
                        for(const node of states){
                            if(node===from||node===to||node.contains(from)||node.contains(to)||from.contains(node)||to.contains(node))continue;
                            const r=node.getBoundingClientRect();
                            const crosses=near(a.x,b.x)?a.x>r.left+2&&a.x<r.right-2&&Math.max(a.y,b.y)>r.top+2&&Math.min(a.y,b.y)<r.bottom-2:
                                a.y>r.top+2&&a.y<r.bottom-2&&Math.max(a.x,b.x)>r.left+2&&Math.min(a.x,b.x)<r.right-2;
                            if(crosses)errors.push(id+' crosses '+node.className);
                        }
                    }
                }
                for(const flow of document.querySelectorAll('.sub-flow,.work-flow')){
                    const body=flow.querySelector(':scope>.sub-flow-body,:scope>.work-flow-body');
                    const children=[...body.children].filter(n=>!n.hidden).map(n=>n.matches('.work-flow-column')?n.firstElementChild:n);
                    const sequence=[flow.querySelector(':scope>.is-start'),...children,flow.querySelector(':scope>.is-end')];
                    const edges=[...flow.querySelectorAll(':scope>svg>path')];
                    if(edges.length!==sequence.length-1)errors.push('incomplete category');
                    for(let i=1;i<sequence.length;i++)if(!edges.some(p=>p.dataset.from===sequence[i-1].id&&p.dataset.to===sequence[i].id))errors.push('missing connection');
                }
                const viewport=document.querySelector('.flow-viewport'),parent=document.querySelector('#prework-priority');
                if(document.documentElement.scrollWidth>document.documentElement.clientWidth)errors.push('page overflow');
                if(viewport.scrollWidth>viewport.clientWidth+1)errors.push('diagram overflow');
                if(parent.getBoundingClientRect().width<viewport.clientWidth*.72)errors.push('unused diagram width');
                return [...new Set(errors)];
            })()`);
            const settle = () => live.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const scrollingRegions = () => live.evaluate(`(() => {
                const result={horizontal:[],vertical:[]},root=document.scrollingElement;
                if(root.scrollWidth>root.clientWidth+1)result.horizontal.push('page');
                if(root.scrollHeight>root.clientHeight+1)result.vertical.push('page');
                for(const node of document.querySelectorAll('body *')){
                    if(!node.getBoundingClientRect().width||!node.getBoundingClientRect().height)continue;
                    const css=getComputedStyle(node),name=node.id||node.className;
                    if(/^(auto|scroll)$/.test(css.overflowX)&&node.scrollWidth>node.clientWidth+1)result.horizontal.push(name);
                    if(/^(auto|scroll)$/.test(css.overflowY)&&node.scrollHeight>node.clientHeight+1)result.vertical.push(name);
                }
                return result;
            })()`);
            for (const width of [2560, 1680, 1340, 1024, 760, 390, 360]) {
                await live.call('Emulation.setDeviceMetricsOverride', { width, height: 1250, deviceScaleFactor: 1, mobile: false });
                await settle(); assert.deepStrictEqual(await geometry(), [], 'diagram geometry at width ' + width);
                await live.evaluate('document.querySelector(\'.flow-trace\').open=true'); await settle();
                assert.deepStrictEqual(await scrollingRegions(), { horizontal: [], vertical: ['page'] }, 'only the page may scroll in the diagram, including its expanded trace, at ' + width);
                await live.evaluate('document.querySelector(\'#diagram-details\').click()'); await settle();
                assert.deepStrictEqual(await scrollingRegions(), { horizontal: [], vertical: ['page'] }, 'tables, navigation and queue must not add scrollbars at ' + width);
                if (width === 390) {
                    const mobile = '.detail .cell[data-area="tablet"][data-phase="clubs"][data-event="tablet-two"]';
                    await live.evaluate('document.querySelector(' + JSON.stringify(mobile) + ').focus();window.__scroll=window.scrollY');
                    response.tablet_phases[1].events[1].ready = 2; await nextUpdate();
                    assert(await live.evaluate('document.activeElement.dataset.focusKey === \'cell:tablet:clubs:tablet-two\' && Math.abs(window.scrollY-window.__scroll)<2'), 'preserve focus and page position across live updates');
                    assert(await live.evaluate('getComputedStyle(document.querySelector(\'.cell-phase\')).display === \'block\''), 'stacked phases must retain their labels');
                    assert(await live.evaluate('[...document.querySelectorAll(\'.matrix th\')].every(node=>Math.abs(node.getBoundingClientRect().width-node.closest(\'.matrix\').getBoundingClientRect().width)<2)'), 'phase summaries must use the full available width when stacked');
                    await live.evaluate('btsSpeechHealth.update({issues:Array.from({length:30},(_,i)=>({source:\'generation\',code:\'Testfehler \'+i,message:\'Lange Fehlermeldung zur Prüfung des Seitenflusses\'}))})'); await settle();
                    assert.deepStrictEqual(await scrollingRegions(), { horizontal: [], vertical: ['page'] }, 'even long health messages must use the page scrollbar');
                    await live.evaluate('document.querySelector(\'.speech_health_banner li:last-child\').scrollIntoView({block:\'center\'})'); await settle();
                    assert(await live.evaluate('(() => {const r=document.querySelector(\'.speech_health_banner li:last-child\').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()'), 'the last error must remain reachable using the page scrollbar');
                    await live.evaluate('btsSpeechHealth.update({issues:[]})');
                }
                await live.evaluate('document.querySelector(\'.plan-step[data-stage="registration"]\').click()'); await settle();
                assert.deepStrictEqual(await scrollingRegions(), { horizontal: [], vertical: ['page'] }, 'both registration tables must fit without their own scrollbars at ' + width);
                await live.evaluate('document.querySelector(\'.plan-step[data-stage="tablet"]\').click();document.querySelector(\'#view-diagram\').click()'); await settle();
            }
            await live.call('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1250, deviceScaleFactor: 1, mobile: false });
            await settle();
            await live.evaluate('window.__edge=document.querySelector(\'.flow-edge\');window.__queueRow=document.querySelectorAll(\'.speech_plan_queue_item\')[1]');
            Object.assign(queueItems[0], { current: false, status: 'completed' });
            Object.assign(queueItems[1], { current: true, position: 0, status: 'processing' });
            await until(async () => (await queueTexts())[0] === queueItems[1].text);
            assert(await live.evaluate('window.__queueRow === document.querySelector(\'.speech_plan_queue_item\')'), 'reuse queue rows when their position changes');
            const targets = { urgent: 'prework-priority', test: 'prework-priority', shared: 'prework-priority', officials: 'prework-priority',
                tablet_waiting: 'competition-priority', oncourt: 'competition-priority', preparation: 'competition-priority',
                candidate: 'competition-preparation-priority', planned: 'competition-preparation-priority', tablet: 'competition-preparation-priority',
                registration: 'registration-priority', registration_reserve: 'registration-priority', people: 'people-priority', spare: 'other-voice-priority', additional: 'additional-priority' };
            for (const [stage, target] of Object.entries(targets)) {
                response.active_stage = stage; response.phase = stage === 'registration' ? 'registration' : 'competition';
                response.current = { text: 'Auftrag ' + stage, running: true, planning: stage === 'tablet' ? { stage, event_id: 'tablet-two', tablet_phase: 'people' } :
                    stage.startsWith('registration') ? { ...queueItems[2].planning, stage } : { stage } };
                await until(() => live.evaluate('document.querySelector(\'#overview\').dataset.followStage === ' + JSON.stringify(stage)));
                await settle();
                assert.strictEqual(await live.evaluate('document.querySelector(\'#overview\').dataset.routeTarget'), target);
                assert(await live.evaluate('(() => {const path=[...document.querySelectorAll(\'.flow-edge.is-traversed\')];let id=\'initial\',n=0;while(id!==' + JSON.stringify(target) + '&&n++<30){const next=path.filter(p=>p.dataset.from===id);if(next.length!==1)return false;id=next[0].dataset.to;}return id===' + JSON.stringify(target) + '&&n===path.length;})()'));
                assert.deepStrictEqual(await geometry(), [], 'route and geometry for ' + stage);
                assert(await live.evaluate('[...document.querySelectorAll(\'.plan-step\')].every(node=>node.querySelector(\'.number\').textContent===document.querySelector(\'.flow-step[data-stage="\'+node.dataset.stage+\'"] > .flow-title .flow-number\').textContent)'), 'stage numbers must agree in both views');
                assert(await live.evaluate('!document.querySelector(\'.plan-group h3 .number,.flow-work-group > .flow-title .flow-number\')'), 'group headings must remain unnumbered in both views');
                assert(await live.evaluate('window.__edge===document.querySelector(\'.flow-edge\')'));
                assert.strictEqual(await live.evaluate('document.querySelectorAll(\'.live-current\').length'), 1);
            }
            assert(await live.evaluate('document.querySelector(\'#registration-priority\').getBoundingClientRect().top > document.querySelector(\'#competition-preparation-priority\').getBoundingClientRect().bottom'));
            response.phase = 'registration'; response.active_stage = 'registration'; response.current = { text: 'Musterverein', running: true, planning: queueItems[2].planning };
            await until(() => live.evaluate('document.querySelector(\'#overview\').dataset.phase === \'registration\'')); await settle();
            assert(await live.evaluate('document.querySelector(\'#registration-priority\').getBoundingClientRect().top > document.querySelector(\'#competition-preparation-priority\').getBoundingClientRect().bottom'));
            assert.deepStrictEqual(await stageNumbers(), [
                ['urgent', '01'], ['test', '02'], ['shared', '03'], ['officials', '04'],
                ['tablet_waiting', '05'], ['oncourt', '06'], ['preparation', '07'], ['additional', ''],
                ['candidate', '08'], ['planned', '09'], ['tablet', '10'], ['registration', '11'], ['people', '12'], ['spare', '13'],
            ], 'the first draw must not change the order or numbers, including when additional requests exist');
            Object.assign(additional, { total: 0, queued: 0 }); await nextUpdate(); await settle();
            assert.deepStrictEqual(await stageNumbers(), [
                ['urgent', '01'], ['test', '02'], ['shared', '03'], ['officials', '04'],
                ['tablet_waiting', '05'], ['oncourt', '06'], ['preparation', '07'], ['candidate', '08'], ['planned', '09'],
                ['tablet', '10'], ['registration', '11'], ['people', '12'], ['spare', '13'],
            ], 'the standard draft order must apply before the first draw as well');
            assert.deepStrictEqual(await live.evaluate('[...document.querySelectorAll(\'.plan-group h3\')].map(node=>node.textContent)'), [
                'Turniervorarbeit', 'Aktueller Spielbetrieb', 'Vorbereitung des Spielbetriebs', 'Weitere Vorbereitung', 'Nur bei vollständigem Leerlauf',
            ]);
            assert(await live.evaluate('document.querySelector(\'.registration-flow-phase[data-current="true"]\').dataset.subphase === \'open_clubs\''));
            assert(await live.evaluate('document.querySelector(\'.registration-flow-state[data-current="true"]\').dataset.eventId === \'open\''));
            assert(await live.evaluate('document.querySelector(\'.flow-registration-next\').textContent === \'Danach → Übrige Personen und Teams\''));
            await live.evaluate('document.querySelector(\'#diagram-current\').click()'); await settle();
            assert(await live.evaluate('(() => {const r=document.querySelector(\'#registration-priority\').getBoundingClientRect();return scrollY>0&&r.top>=0&&r.top<innerHeight;})()'), 'jump to the current job using the page scrollbar');
            await live.evaluate('document.querySelector(\'#diagram-start\').click()'); await settle();
            assert(await live.evaluate('(() => {const r=document.querySelector(\'#initial\').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})()'), 'the start button must work without an internal diagram scrollbar');
            await live.evaluate('document.querySelector(\'#diagram-current\').click()'); await settle();
            const originalQueueSize = queueItems.length;
            queueItems.push(...Array.from({ length: 25 }, (_, index) => ({ key: 'scroll-' + index, text: 'Zusätzlicher Testauftrag ' + index,
                status: 'unsubmitted', priority: 'normal', voice: 'hallensprecher', operation: 'synthesis' })));
            await nextUpdate(); await settle();
            assert.deepStrictEqual(await scrollingRegions(), { horizontal: [], vertical: ['page'] }, 'a long queue must not add an independent scrollbar');
            queueItems.splice(originalQueueSize); await nextUpdate();
            await live.evaluate('document.querySelector(\'#diagram-details\').click()');
            assert(await live.evaluate('document.querySelector(\'.detail-number\').textContent === \'11\''));
            assert(await live.evaluate('document.querySelector(\'.next-step button\').dataset.stage === \'people\' && document.querySelector(\'.next-step button\').textContent.startsWith(\'12 \')'));
            await live.evaluate('document.querySelector(\'#view-diagram\').click()'); await settle();
            if (process.env.BTS_SPEECH_PLANNING_DESIGN_SCREENSHOT) {
                const shot = await live.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
                fs.writeFileSync(process.env.BTS_SPEECH_PLANNING_DESIGN_SCREENSHOT, Buffer.from(shot.data, 'base64'));
            }
            await live.evaluate('document.querySelector(\'#diagram-fit\').click()'); await settle(); assert.deepStrictEqual(await geometry(), []);
            const svg = await live.evaluate('(() => {const svg=new DOMParser().parseFromString(btsSpeechPlanningDiagram.exportSVG(),\'image/svg+xml\');return {valid:!svg.querySelector(\'parsererror,foreignObject\'),paths:svg.querySelectorAll(\'.sub-flow-edge\').length,boundaries:svg.querySelectorAll(\'circle[data-boundary]\').length,expected:document.querySelectorAll(\'.flow-point\').length};})()');
            assert(svg.valid); assert(svg.paths > 40); assert.strictEqual(svg.boundaries, svg.expected);
            response.active_stage = null; response.current = null;
            for (const row of response.stages) Object.assign(row, { ready: row.total, queued: 0, failed: 0 });
            for (const [state, target] of [['complete', 'result-state'], ['failed', 'result-state'], ['idle_pending', 'result-state'], ['disabled', 'disabled-state']]) {
                response.state = state;
                await until(() => live.evaluate('document.querySelector(\'.speech_plan_live\').dataset.state === ' + JSON.stringify(state)));
                await settle(); assert.strictEqual(await live.evaluate('document.querySelector(\'#overview\').dataset.routeTarget'), target);
                assert.strictEqual(await live.evaluate('document.querySelectorAll(\'.live-current\').length'), 0);
            }
            response.state = 'updating'; response.phase = 'unknown'; await nextUpdate(); await settle();
            assert.strictEqual(await live.evaluate('document.querySelector(\'#overview\').dataset.routeTarget'), 'unknown-state');
            response.state = 'working'; response.phase = 'competition'; response.active_stage = 'tablet';
            response.current = { text: 'Auftrag nach Wiederverbinden', running: true, planning: { stage: 'tablet', event_id: 'tablet-two', tablet_phase: 'people' } };
            await until(() => live.evaluate('document.querySelector(\'#overview\').dataset.followStage === \'tablet\''));
            for (const ws of app.wss.clients) if (ws.speech_planning_test) ws.close();
            await until(() => live.evaluate('document.querySelector(\'.speech_plan_live\').dataset.connected === \'false\''));
            assert.strictEqual(await live.evaluate('document.querySelectorAll(\'.live-current\').length'), 0);
            assert.strictEqual(await live.evaluate('document.querySelectorAll(\'.speech_plan_queue_item\').length'), 0);
            await until(() => live.evaluate('document.querySelector(\'.speech_plan_live\').dataset.connected === \'true\''));
            await live.call('Page.reload');
            await until(() => live.evaluate('document.querySelector(\'.speech_plan_live\')?.dataset.connected === \'true\''));
            assert(await live.evaluate('document.querySelector(\'#view-diagram\').getAttribute(\'aria-selected\') === \'true\''), 'remember the selected view');
            assert.strictEqual(fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8'), received, 'the planning page must never submit synthesis');
            assert.deepStrictEqual(live.events.filter(event => event.method === 'Runtime.exceptionThrown'), []);
        } finally {
            admin.handle_speech_planning = original;
            admin.handle_speech_queue = originalQueue;
            socket?.close();
            if (targetId) await devtools.call('Target.closeTarget', { targetId });
            await devtools.call('Page.bringToFront');
        }
    });

    it('keeps shared audio green and plays it after BTS adapter restart with the actual FastAPI process stopped', async function() {
        app.speech.stop();
        await until(async () => {
            const broker = app.speech.broker;
            if (broker.current && !broker.stepping) { broker.current.entry.next_poll = 0; await broker.step(); }
            return !broker.current && !broker.stepping;
        });
        const text = 'Jungeneinzel U17';
        const voice = await devtools.evaluate('btsSpeechService.settings().voice');
        const config = { ...app.speech.broker.config, cache_dir: path.join(directory, 'persistent-bts'),
            shared_audio_dir: path.join(directory, 'data', 'audio') };
        const original = app.speech.broker;
        const before = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8');
        const first = new SpeechBroker(config);
        await first.refresh(); first.prepare([text], { voice }, 'default'); await first.step();
        assert(first.views([text], { voice }, 'default')[0].local);
        const entry = [...first.entries.values()][0];
        assert.strictEqual(fs.statSync(first.disk.file(entry.audio_id).path).ino,
            fs.statSync(path.join(config.shared_audio_dir, entry.audio_id + '.wav')).ino);
        await terminate(api);
        const fresh = new SpeechBroker(config); await fresh.disk.ready;
        fresh.prepare([text], { voice, prefetch: true }, 'default'); await fresh.refresh(); await fresh.step();
        app.speech.broker = fresh;
        try {
            await openSpeechSettings();
            const inventory = () => devtools.evaluate('document.querySelector(\'.speech_queue_cache_status\').textContent');
            await until(async () => (await inventory()).includes('Dauerhaft im BTS-Cache: 1 '));
            const stored = await inventory();
            assert(stored.includes('alle Turniere und Stimmen'));
            fresh.reconcile_prefetch('default', [], { voice });
            assert(!fresh.queue('default').items.some(item => item.key === entry.key));
            await devtools.evaluate('[...document.querySelectorAll(\'.local_speech_controls button\')]' +
                '.find(button => button.textContent === \'Cache-Status aktualisieren\').click()');
            await until(() => devtools.evaluate('!document.querySelector(' +
                JSON.stringify('.speech_queue_row[data-key="' + entry.key + '"]') + ')'));
            assert.strictEqual(await inventory(), stored, 'removing a finished job must not reduce the saved inventory');
            fresh.prepare([text], { voice }, 'default');
            await closeSpeechSettings();
            await devtools.call('Emulation.setDeviceMetricsOverride',
                { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
            await devtools.evaluate('(() => { const target = document.createElement(\'button\'); target.type = \'button\'; ' +
                'target.id = \'durable-ready-test\'; target.textContent = \'Gespeicherte Ansage\'; document.body.appendChild(target); ' +
                'target.scrollIntoView({block:\'center\'}); btsSpeechReadiness.trackText(target, () => [' + JSON.stringify(text) + ']); })()');
            // This cache test must establish its own real audio gesture rather
            // than depend on playback permission left by earlier browser tests.
            await click('#durable-ready-test');
            await until(() => devtools.evaluate('btsSpeechService.settings().audio_ready'));
            await devtools.evaluate('btsSpeechReadiness.refresh(true)');
            assert.strictEqual(await devtools.evaluate('document.getElementById(\'durable-ready-test\').dataset.speechState'), 'ready');
            const result = await devtools.evaluate('btsSpeechService.speak([' + JSON.stringify(text) + '], \'durable-offline-test\', ' +
                '() => { throw new Error(\'unexpected browser fallback\'); })');
            assert.strictEqual(result.provider, 'server');
            assert.strictEqual(result.status, 'ok');
            assert.strictEqual(fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8'), before);
        } finally {
            app.speech.broker = original;
            await devtools.evaluate('document.getElementById(\'durable-ready-test\')?.remove()');
        }
    });
});
