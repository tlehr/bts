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
            if (fail === 'blocked') return Promise.reject(new Error('blocked'));
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
    });
    const fallback = async parts => {
        browser.push(parts);
        return { status: 'ok', started: true };
    };
    return { service, settings, played, requests, browser, player, fallback };
}

describe('Browser local speech provider', function() {
    it('inspects readiness without preparing jobs or playing audio and preserves exact text', async function() {
        const h = harness();
        await h.service.inspect([TEXT]);
        assert.deepStrictEqual(h.requests, [['speech_status', {
            tournament_key: 'default', voice: 'hallensprecherin', language: 'de-DE', parts: [TEXT],
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
        completed = true;
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
        assert(await h.service.unlock());
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
