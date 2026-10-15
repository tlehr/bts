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
        await devtools.evaluate('document.querySelector(\'.speech_settings_layout\').scrollIntoView({block:\'start\'})');
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
        await devtools.call('Emulation.setDeviceMetricsOverride',
            { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
        await devtools.call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/admin/t/default/' });
        await until(() => devtools.evaluate('!!document.querySelector(\'.location_announcements_controls\')'));
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

    it('warms exact call parts with sentence spacing before playback and proxies the actual protected WAV', async function() {
        const parts = ['Jungeneinzel U17', 'Halbfinale', 'Johann Bjarne Schöttmer, gegen Muhammad Sytsh Abdulquddus',
            'Auf Spielfeld 4! Bitte mit dem Spielen beginnen!'];
        const resolved = await rpc(client, { type: 'speech_resolve', tournament_key: 'default',
            voice: 'hallensprecherin', language: 'de-DE', parts });
        assert(resolved.clips.every(clip => clip.status === 'completed'));
        const file = await fetch('http://127.0.0.1:' + server.address().port + resolved.clips.at(-1).audio_url);
        assert.strictEqual(file.headers.get('content-type'), 'audio/wav');
        assert.strictEqual(Buffer.from(await file.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
        const original = fs.readFileSync(path.join(directory, 'received.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
        assert(original.some(record => record.text === parts[2]));
        assert(original.some(record => record.text === parts[3]));
        assert(!original.some(record => record.text === 'Auf Spielfeld 4!Bitte mit dem Spielen beginnen!'));
        assert(original.every(record => !record.text.includes('U siebzehn')));
    });

    it('renders usable controls and plays ready server audio in the native browser', async function() {
        assert.strictEqual(await devtools.evaluate('!!document.querySelector(\'.local_speech_controls\')'), false,
            'speech settings belong on the existing settings page');
        await devtools.evaluate('window.__audioSources = []; ' +
            'const nativePlay = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function() {' +
            'window.__lastAudio = this; ' +
            'this.addEventListener(\'playing\', () => window.__audioSources.push(this.currentSrc), {once:true}); ' +
            'return nativePlay.call(this); };');
        await openSpeechSettings();
        await devtools.evaluate('(() => { const mode = document.querySelector(\'select[name="announcement_speech_mode"]\'); ' +
            'mode.value = \'server\'; mode.dispatchEvent(new Event(\'change\')); })()');
        await until(() => devtools.evaluate('btsSpeechService.settings().mode === \'server\''));
        const bounds = await devtools.evaluate('(() => { const button = [...document.querySelectorAll(\'.local_speech_controls button\')]' +
            '.find(b => b.textContent === \'Audio aktivieren\'); button.scrollIntoView({block:\'center\'}); ' +
            'const r = button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()');
        for (const type of ['mousePressed', 'mouseReleased']) {
            await devtools.call('Input.dispatchMouseEvent', { type, x: bounds.x, y: bounds.y, button: 'left', clickCount: 1 });
        }
        await devtools.call('Page.captureScreenshot', { format: 'png' }).then(result =>
            fs.writeFileSync('/tmp/bts-speech-admin-menu.png', Buffer.from(result.data, 'base64')));
        await devtools.call('Emulation.setDeviceMetricsOverride',
            { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
        await devtools.call('Page.captureScreenshot', { format: 'png' }).then(result =>
            fs.writeFileSync('/tmp/bts-speech-admin-menu-mobile.png', Buffer.from(result.data, 'base64')));
        await devtools.call('Emulation.setDeviceMetricsOverride',
            { width: 1280, height: 1100, deviceScaleFactor: 1, mobile: false });
        await closeSpeechSettings();
        assert.strictEqual(await devtools.evaluate('btsSpeechService.unlock()'), true,
            'the actual silent unlock WAV must be playable in the native browser');
        const state = await devtools.evaluate('runAnnouncementSpeechCheck()');
        assert.strictEqual(state.status, 'active', JSON.stringify(state));
        assert(state.detail.includes('Server-Audio'));
        assert(await devtools.evaluate('window.__audioSources.some(src => src.includes(\'/speech/audio/\'))'));
        const errors = devtools.events.filter(event => event.method === 'Runtime.exceptionThrown');
        assert.deepStrictEqual(errors, []);
        await devtools.call('Page.captureScreenshot', { format: 'png' }).then(result =>
            fs.writeFileSync('/tmp/bts-local-tts-preview.png', Buffer.from(result.data, 'base64')));
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
            assert.deepStrictEqual(rendered.map(row => row.disabled), expected.queue.items.map(item => item.status !== 'completed'));
            assert(rendered.some(row => row.priority === 'high' && row.disabled));
            assert(expected.queue.items.every(item => item.voice === 'hallensprecher'));
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
});
