'use strict';

const assert = require('assert');
const create = require('../static/js/speech_service');

const TEXT = ' In Vorbereitung! Jungeneinzel U17: Halbfinale! Ä\n';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const clip = () => ({ status: 'completed', audio_url: '/h/default/speech/audio/' + 'a'.repeat(32) + '?signature=example' });

function harness(options = {}) {
    const played = [], requests = [], browser = [];
    let fail = options.fail;
    const settings = { enabled: true, key: 'default', mode: options.mode || 'auto',
        voice: 'hallensprecherin', language: 'de-DE', deadline_ms: 20, max_text: 1200, rate: 1.1 };
    const player = {
        play() {
            played.push(this.src);
            if (fail === 'blocked') return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
            if (fail === 'download') return Promise.reject(Object.assign(new Error('source failed'), { name: 'NotSupportedError' }));
            if (fail === 'held') return Promise.resolve();
            setImmediate(() => {
                this.onplaying?.();
                if (fail === 'partial') { this.onerror?.(); fail = null; }
                else this.onended?.();
            });
            return Promise.resolve();
        },
        pause() { this.paused = true; },
    };
    const service = create({
        settings: () => settings,
        makeAudio: () => player,
        request: async (type, values) => {
            requests.push([type, values]);
            if (options.request) return options.request(type, values);
            return { clips: values.parts.map(() => clip()), speech: { enabled: true } };
        },
        cancelBrowser() {},
        now: options.now,
    });
    const fallback = async parts => {
        browser.push(parts);
        return { status: 'ok', started: true };
    };
    return { service, settings, played, requests, browser, player, fallback };
}

describe('Browser local speech provider', function() {
    it('plays reusable local clips in order while browser mode and fallback keep the original sentence', async function() {
        const browserParts = ['Auf Spielfeld 8! Bitte mit dem Spielen beginnen!'];
        const localParts = ['Auf Spielfeld 8!', 'Bitte mit dem Spielen beginnen!'];
        const h = harness({ request: async (_type, values) => ({ clips: values.parts.map((text, i) => ({
            ...clip(), audio_url: clip().audio_url.replace('a'.repeat(32), String(i).repeat(32)),
        })) }) });
        const result = await h.service.speak(browserParts, 'split-start', h.fallback, localParts);
        assert.strictEqual(result.provider, 'server');
        assert.deepStrictEqual(h.requests[0][1].parts, localParts);
        assert.strictEqual(h.played.length, 2);
        assert(h.played[0].includes('0'.repeat(32)) && h.played[1].includes('1'.repeat(32)));
        assert.deepStrictEqual(h.browser, []);
        const missing = harness({ request: async (_type, values) => ({ clips: values.parts.map((_, i) =>
            i ? { status: 'processing' } : clip()) }) });
        assert.strictEqual((await missing.service.speak(browserParts, 'missing', missing.fallback, localParts)).provider, 'browser');
        assert.deepStrictEqual(missing.played, []);
        assert.deepStrictEqual(missing.browser, [browserParts]);
        const browser = harness({ mode: 'browser' });
        await browser.service.speak(browserParts, 'browser-start', browser.fallback, localParts);
        assert.deepStrictEqual(browser.requests, []);
        assert.deepStrictEqual(browser.browser, [browserParts]);
    });

    const previewClip = () => ({ ...clip(), tournament_key: 'default', text: TEXT, voice: 'hallensprecherin' });
    const previewResponse = () => ({ speech: { enabled: true, cache_version: 'one' }, queue: { items: [previewClip()] } });

    it('reads the queue without preparing or playing and previews the selected cached voice even in browser mode', async function() {
        const h = harness({ mode: 'browser', request: async () => previewResponse() });
        const response = await h.service.queue();
        assert.deepStrictEqual(h.requests, [['speech_queue', { tournament_key: 'default' }]]);
        assert.strictEqual(h.played.length, 0);
        assert.strictEqual((await h.service.preview(response.queue.items[0], response.speech.cache_version)).status, 'ok');
        assert.deepStrictEqual(h.played, [clip().audio_url]);
        assert.strictEqual(h.browser.length, 0);
        assert.strictEqual(h.requests.length, 1);
        assert.strictEqual(h.settings.voice, 'hallensprecherin');
        assert.strictEqual(h.settings.mode, 'browser');
        h.settings.enabled = false;
        assert.strictEqual(await h.service.queue(), null);
        assert.strictEqual(h.requests.length, 1);
    });

    it('refuses stale, unfinished, foreign-tournament and external preview audio without generating it', async function() {
        const h = harness({ request: async () => previewResponse() });
        await h.service.queue();
        for (const [item, version] of [
            [previewClip(), 'old'], [null, 'one'],
            [{ ...previewClip(), status: 'processing' }, 'one'],
            [{ ...previewClip(), tournament_key: 'other' }, 'one'],
            [{ ...previewClip(), voice: 'hallensprecher' }, 'one'],
            [{ ...previewClip(), audio_url: '/h/other/speech/audio/' + 'a'.repeat(32) + '?signature=test' }, 'one'],
            [{ ...previewClip(), audio_url: 'https://example.org/test.wav' }, 'one'],
        ]) assert.strictEqual((await h.service.preview(item, version)).status, 'unavailable');
        assert.strictEqual(h.played.length, 0);
        assert.strictEqual(h.browser.length, 0);
        assert.strictEqual(h.requests.length, 1);
    });

    it('never interrupts an actual announcement to preview and closing a preview does not stop an announcement', async function() {
        const h = harness({ fail: 'held' });
        const announcement = h.service.speak([TEXT], 'actual', h.fallback);
        await delay(5);
        assert.strictEqual((await h.service.preview(previewClip(), undefined)).status, 'busy');
        h.service.cancelPreview();
        assert(!h.player.paused);
        h.player.onplaying(); h.player.onended();
        assert.strictEqual((await announcement).status, 'ok');
        assert.strictEqual(h.played.length, 1);
    });

    it('lets actual announcements preempt previews and keeps preview out of announcement deduplication', async function() {
        const h = harness({ fail: 'held', request: async (type, values) => type === 'speech_queue' ? previewResponse() :
            { speech: { enabled: true, cache_version: 'one' }, clips: values.parts.map(clip) } });
        await h.service.queue();
        const preview = h.service.preview(previewClip(), 'one');
        const announcement = h.service.speak([TEXT], 'actual', h.fallback);
        assert.strictEqual((await preview).status, 'cancelled');
        await delay(5);
        assert.strictEqual(h.played.length, 2);
        h.player.onplaying(); h.player.onended();
        assert.strictEqual((await announcement).status, 'ok');
        assert.strictEqual((await h.service.speak([TEXT], 'actual', h.fallback)).status, 'skipped');
        assert.strictEqual(h.browser.length, 0);
    });

    it('cancels previews on close and reports playback errors without browser fallback', async function() {
        const h = harness({ fail: 'held', request: async () => previewResponse() });
        await h.service.queue();
        const preview = h.service.preview(previewClip(), 'one');
        h.service.cancelPreview();
        assert.strictEqual((await preview).status, 'cancelled');
        assert(h.player.paused);
        const blocked = harness({ fail: 'blocked', request: async () => previewResponse() });
        await blocked.service.queue();
        const result = await blocked.service.preview(previewClip(), 'one');
        assert.strictEqual(result.reason, 'audio_blocked');
        assert.strictEqual(blocked.service.settings().audio_error, 'audio_blocked');
        assert.strictEqual(blocked.browser.length, 0);
        assert.strictEqual(blocked.requests.length, 1);
    });

    it('inspects readiness without preparing jobs or playing audio and preserves exact text', async function() {
        const h = harness();
        await h.service.inspect([TEXT]);
        assert.deepStrictEqual(h.requests, [['speech_status', {
            tournament_key: 'default', voice: 'hallensprecherin', language: 'de-DE', parts: [TEXT], audio_urls: true,
        }]]);
        assert.strictEqual(h.played.length, 0);
        assert.strictEqual(h.browser.length, 0);
        h.settings.enabled = false;
        await h.service.inspect([TEXT]);
        h.settings.enabled = true;
        h.settings.language = 'en-GB';
        await h.service.inspect([TEXT]);
        assert.strictEqual(h.requests.length, 1);
    });

    it('plays ready server audio in order once, without consulting browser voices', async function() {
        const h = harness();
        const result = await h.service.speak([TEXT, 'Auf Spielfeld 4!', TEXT], 'event1', h.fallback);
        assert.strictEqual(result.provider, 'server');
        assert.strictEqual(h.played.length, 3);
        assert.strictEqual(h.browser.length, 0);
        assert.deepStrictEqual(h.requests[0][1].parts, [TEXT, 'Auf Spielfeld 4!', TEXT]);
        assert.strictEqual(h.player.playbackRate, 1.1);
        assert.strictEqual((await h.service.speak([TEXT], 'event1', h.fallback)).status, 'skipped');
        assert.strictEqual(h.played.length, 3);
    });

    it('plays the exact audio confirmed by readiness inspection without another time-critical resolve request', async function() {
        const h = harness({ request: async (type, values) => {
            assert.strictEqual(type, 'speech_status', 'a green announcement must not depend on another 700 ms lookup');
            return { speech: { enabled: true, cache_version: 'one' }, clips: values.parts.map(clip) };
        } });
        await h.service.inspect([TEXT, 'U17']);
        const result = await h.service.speak([TEXT, 'U17', TEXT], 'event1', h.fallback);
        assert.strictEqual(result.provider, 'server');
        assert.strictEqual(h.requests.length, 1);
        assert.strictEqual(h.played.length, 3);
        assert.strictEqual(h.browser.length, 0);
    });

    it('does not reuse readiness URLs for another voice, language or tournament', async function() {
        for (const changed of [{ voice: 'hallensprecher' }, { key: 'another' }, { language: 'en-GB' }]) {
            const h = harness({ request: async (type, values) => type === 'speech_status' ?
                { clips: values.parts.map(clip) } : { clips: values.parts.map(() => ({ status: 'queued' })) } });
            await h.service.inspect([TEXT]);
            Object.assign(h.settings, changed);
            assert.strictEqual((await h.service.speak([TEXT], 'event1', h.fallback)).provider, 'browser');
            assert.strictEqual(h.played.length, 0);
        }
    });

    it('expires inspected audio and invalidates it when the synthesis configuration changes', async function() {
        for (const scenario of ['expiry', 'version']) {
            let time = 1000, version = 'one';
            const h = harness({ now: () => time, request: async (type, values) => {
                if (type === 'speech_resolve') time += 21;
                return { speech: { enabled: true, cache_version: version },
                    clips: values.parts.map(() => type === 'speech_status' && version === 'one' ? clip() : { status: 'queued' }) };
            } });
            await h.service.inspect([TEXT]);
            if (scenario === 'expiry') time += 15001;
            else {
                version = 'two';
                await h.service.inspect(['Another text']);
            }
            assert.strictEqual((await h.service.speak([TEXT], 'event1', h.fallback)).provider, 'browser');
            assert.strictEqual(h.requests.at(-1)[0], 'speech_resolve');
            assert.strictEqual(h.played.length, 0);
        }
    });

    it('does not mark a completed inspection usable without a signed same-origin audio URL', async function() {
        const h = harness({ request: async () => ({ clips: [{ status: 'completed', audio_url: 'https://example.com/file.wav' }] }) });
        assert.strictEqual((await h.service.inspect([TEXT])).clips[0].status, 'unavailable');
        assert.strictEqual(h.played.length, 0);
    });

    it('browser mode preserves exact text and never requests server audio', async function() {
        const h = harness({ mode: 'browser' });
        await h.service.speak([TEXT, null, 'U17'], 'event1', h.fallback);
        assert.deepStrictEqual(h.browser, [[TEXT, 'U17']]);
        assert.strictEqual(h.requests.length, 0);
    });

    it('uses browser fallback once on a cache miss and ignores later completed generation', async function() {
        let completed = false;
        const h = harness({ request: async (_type, values) => ({
            clips: values.parts.map(() => completed ? clip() : { status: 'queued', audio_url: null }),
        }) });
        const result = await h.service.speak([TEXT], 'event1', h.fallback);
        assert.strictEqual(result.provider, 'browser');
        assert.strictEqual(result.fallback_reason, 'cache_incomplete');
        assert(h.service.outputMessage().includes('Browser-Fallback'));
        completed = true;
        await h.service.inspect([TEXT]);
        await delay(30);
        assert.strictEqual(h.browser.length, 1);
        assert.strictEqual(h.played.length, 0);
        assert.strictEqual((await h.service.speak([TEXT], 'event1', h.fallback)).status, 'skipped');
    });

    it('rejects a response arriving after the configured deadline', async function() {
        const h = harness({ request: async (_type, values) => {
            await delay(40);
            return { clips: values.parts.map(clip) };
        } });
        assert.strictEqual((await h.service.speak([TEXT], 'event1', h.fallback)).provider, 'browser');
        assert.strictEqual(h.played.length, 0);
    });

    it('falls back with a reason when an incomplete response arrives exactly at the deadline', async function() {
        let time = 1000;
        const h = harness({ now: () => time, request: async () => {
            time += 20;
            return { clips: [{ status: 'queued' }] };
        } });
        const result = await h.service.speak([TEXT], 'event1', h.fallback);
        assert.strictEqual(result.provider, 'browser');
        assert.strictEqual(result.fallback_reason, 'cache_incomplete');
    });

    it('falls back safely on transport failure and unsupported language', async function() {
        const h = harness({ request: () => Promise.reject(new Error('offline')) });
        assert.strictEqual((await h.service.speak([TEXT], 'event1', h.fallback)).provider, 'browser');
        h.settings.language = 'en-EN';
        await h.service.speak([TEXT], 'event2', h.fallback);
        assert.strictEqual(h.browser.length, 2);
        assert.strictEqual(h.requests.length, 1);
    });

    it('falls back after an autoplay error before audible output', async function() {
        const h = harness({ fail: 'blocked' });
        const result = await h.service.speak([TEXT], 'event1', h.fallback);
        assert.strictEqual(result.provider, 'browser');
        assert.strictEqual(h.browser.length, 1);
        assert.strictEqual(result.fallback_reason, 'audio_blocked');
        assert.strictEqual(h.service.settings().audio_ready, false);
        assert.strictEqual(h.service.settings().audio_error, 'audio_blocked');
        assert(h.service.describeResult(result).includes('gesperrt'));
    });

    it('distinguishes a failed audio download from an autoplay permission error', async function() {
        const h = harness({ fail: 'download' });
        const result = await h.service.speak([TEXT], 'event1', h.fallback);
        assert.strictEqual(result.provider, 'browser');
        assert.strictEqual(result.fallback_reason, 'audio_failed');
        assert(h.service.outputMessage().includes('Audiodatei'));
        assert.strictEqual(h.service.settings().audio_error, 'audio_failed');
    });

    it('never repeats a partially audible server batch using browser fallback', async function() {
        const h = harness({ fail: 'partial' });
        const result = await h.service.speak([TEXT, 'second part'], 'event1', h.fallback);
        assert.strictEqual(result.status, 'error');
        assert.strictEqual(result.started, true);
        assert.strictEqual(result.allowRetry, false);
        assert.strictEqual(h.played.length, 1);
        assert.strictEqual(h.browser.length, 0);
    });

    it('strict server mode skips unready audio without browser output', async function() {
        const h = harness({ mode: 'server', request: async () => ({ clips: [] }) });
        assert.strictEqual((await h.service.speak([TEXT], 'event1', h.fallback)).status, 'unavailable');
        assert.strictEqual(h.browser.length, 0);
    });

    it('cancels an active download/playback and clears the element without fallback', async function() {
        const h = harness({ fail: 'held' });
        const result = h.service.speak([TEXT], 'event1', h.fallback);
        await delay(5);
        h.service.cancel();
        assert.strictEqual((await result).status, 'cancelled');
        assert(h.player.paused);
        assert.strictEqual(h.browser.length, 0);
    });

    it('cancels preparation lookup without scheduling late audio', async function() {
        const h = harness({ request: async () => { await delay(20); return { clips: [clip()] }; } });
        const pending = h.service.speak([TEXT], 'event1', h.fallback);
        h.service.cancel();
        assert.strictEqual((await pending).status, 'cancelled');
        assert.strictEqual(h.played.length, 0);
        assert.strictEqual(h.browser.length, 0);
    });

    it('preparation only sends exact deduplicated text, never plays', async function() {
        const h = harness();
        await h.service.prepare([TEXT, TEXT, null]);
        assert.deepStrictEqual(h.requests[0][1].parts, [TEXT]);
        assert.strictEqual(h.played.length, 0);
        assert.strictEqual(h.browser.length, 0);
    });

    it('keeps a disabled or older BTS backend free of unsupported speech requests', async function() {
        const h = harness();
        h.settings.enabled = false;
        assert.strictEqual((await h.service.status()).speech.enabled, false);
        await h.service.prepare([TEXT]);
        await h.service.speak([TEXT], 'event1', h.fallback);
        assert.strictEqual(h.requests.length, 0);
        assert.strictEqual(h.browser.length, 1);
    });

    it('unlocks and reuses the same audio element for actual playback', async function() {
        const h = harness();
        assert.strictEqual(h.service.settings().audio_ready, false);
        assert(await h.service.unlock());
        assert.strictEqual(h.service.settings().audio_ready, true);
        await h.service.speak([TEXT], 'event1', h.fallback);
        assert.strictEqual(h.played.length, 2);
        assert(h.played[0].startsWith('data:audio/wav;'));
        assert.strictEqual(h.player.volume, 1);
    });

    it('lets two independent clients play a shared recording once each', async function() {
        for (const h of [harness(), harness()]) {
            await h.service.speak([TEXT], 'event1', h.fallback);
            await h.service.speak([TEXT], 'event1', h.fallback);
            assert.strictEqual(h.played.length, 1);
        }
    });
});
