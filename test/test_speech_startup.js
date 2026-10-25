'use strict';

const assert = require('assert');
const createService = require('../static/js/speech_service');
const createTexts = require('../static/js/announcement_text');
const translate = require('../static/js/ci18n')._translate;
const clip = { status: 'completed', audio_url: '/h/default/speech/audio/' + 'a'.repeat(32) + '?signature=fixture' };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(request) {
    const current = { key: 'default', language: 'de', annoncement_include_matchnumber: true,
        annoncement_include_event: true, annoncement_include_round: true,
        courts: [], locations: [{ _id: 'hall' }], normalizations: [], speech: { context_version: null } };
    const settings = { enabled: true, key: 'default', mode: 'auto', voice: 'hallensprecherin',
        language: 'de-DE', context_version: null, deadline_ms: 40, max_text: 1200 };
    const requests = [], played = [], browser = [], calls = [];
    const player = { play() { played.push(this.src); setImmediate(() => { this.onplaying?.(); this.onended?.(); }); return Promise.resolve(); }, pause() {} };
    const metadata = { enabled: true, context_version: 'bts-context-v2', cache_version: 'cached-v2' };
    const service = createService({ settings: () => settings, makeAudio: () => player,
        request: async (type, values, _timeout, signal) => {
            requests.push({ type, values });
            return request ? request(type, values, signal) : { speech: metadata, clips: (values.parts || []).map(() => clip) };
        },
        onMetadata: value => { if (value) { current.speech = { ...current.speech, ...value }; Object.assign(settings, value); } },
    });
    const texts = createTexts({ tournament: current, translate: (key, values) => translate('de', key, values),
        window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
        announce: (parts, _local, _claim, options) => calls.push({ parts, ...options }) });
    const setup = { state: 'preparation', match_num: 102, event_name: 'MX U13', match_name: '11/12', location_id: 'hall',
        teams: [{ players: [{ name: 'Anna Beispiel' }, { name: 'Ben Beispiel' }] },
            { players: [{ name: 'Clara Muster' }, { name: 'Dirk Muster' }] }] };
    const fallback = async parts => { browser.push(parts); return { status: 'ok', started: true }; };
    return { current, settings, service, requests, played, browser, texts, setup, calls, fallback, metadata };
}

describe('speech metadata at the first announcement', function() {
    it('rebuilds a queued real announcement after learning that the existing cache uses V2', async function() {
        const f = fixture((type, values) => {
            if (type === 'speech_status') return { speech: f.metadata, clips: [] };
            assert.strictEqual(type, 'speech_resolve');
            assert(values.parts.length > 0);
            assert(values.parts.every(part => part.startsWith('~bts-context-v2~')), 'never submit obsolete individual text');
            return { speech: f.metadata, clips: values.parts.map(() => clip) };
        });
        f.texts.announcePreparationMatch(f.setup);
        const call = f.calls[0];
        assert(call.localParts.includes('Spiel Nummer 102'));
        const result = await f.service.speak(call.parts, 'first-call', f.fallback, call.localParts, [],
            settings => ({ ...call.buildLocalPlan(settings), pauses: [] }));
        assert.strictEqual(result.provider, 'server');
        assert.deepStrictEqual(f.requests.map(r => r.type), ['speech_status', 'speech_resolve']);
        assert.strictEqual(f.played.length, f.requests[1].values.parts.length);
        assert.deepStrictEqual(f.browser, []);
        assert.deepStrictEqual(f.calls[0].parts, call.parts, 'browser sentence remains the original announcement');
    });

    it('keeps each queued call independent when metadata arrives before playback', function() {
        const f = fixture();
        f.texts.announcePreparationMatch(f.setup);
        f.texts.announcePreparationMatch({ ...f.setup, match_num: 103 });
        f.current.speech.context_version = 'bts-context-v2';
        const plans = f.calls.map(call => call.buildLocalPlan());
        assert(plans.every(plan => plan.parts.every(part => part.startsWith('~bts-context-v2~'))));
        assert.notDeepStrictEqual(plans[0].parts, plans[1].parts);
        assert(plans[0].parts.some(part => part.includes('Spielnummer 102')));
        assert(plans[1].parts.some(part => part.includes('Spielnummer 103')));
    });

    it('stores metadata returned by a read-only status request before text planning', async function() {
        const f = fixture();
        await f.service.status();
        assert.strictEqual(f.current.speech.context_version, 'bts-context-v2');
        assert.strictEqual(f.settings.cache_version, 'cached-v2');
        assert.deepStrictEqual(f.requests.map(r => r.type), ['speech_status']);
        assert.deepStrictEqual(f.played, []);
    });

    it('uses the playback metadata even if the queued builder holds an older tournament object', function() {
        const f = fixture();
        f.texts.announcePreparationMatch(f.setup);
        const plan = f.calls[0].buildLocalPlan(f.metadata);
        assert(plan.parts.every(part => part.startsWith('~bts-context-v2~')));
        assert.strictEqual(f.current.speech.context_version, null, 'the queued tournament snapshot stays intact');
    });

    it('does not request generation when metadata cannot be synchronized', async function() {
        const f = fixture(() => null);
        f.texts.announcePreparationMatch(f.setup);
        const call = f.calls[0];
        const result = await f.service.speak(call.parts, 'unavailable', f.fallback, call.localParts, [], call.buildLocalPlan);
        assert.strictEqual(result.provider, 'browser');
        assert.strictEqual(result.fallback_reason, 'speech_request_failed');
        assert.deepStrictEqual(f.requests.map(r => r.type), ['speech_status']);
        assert.deepStrictEqual(f.browser, [call.parts.filter(Boolean)]);
    });

    for (const cancel of [false, true]) it(`does not start the old call after ${cancel ? 'cancellation' : 'a tournament change'} during metadata synchronization`, async function() {
        let release;
        const f = fixture(() => new Promise(resolve => { release = resolve; }));
        const pending = f.service.speak(['Original'], 'pending', f.fallback, ['Old'], [], () => ({ parts: ['New'], pauses: [] }));
        await tick();
        if (cancel) f.service.cancel(); else f.settings.key = 'other';
        release({ speech: f.metadata, clips: [] });
        assert.strictEqual((await pending).status, 'cancelled');
        assert.deepStrictEqual(f.played, []);
        assert.deepStrictEqual(f.browser, []);
        assert.strictEqual(f.current.speech.context_version, null, 'obsolete metadata must not affect the new state');
    });

    it('retains legacy and browser-only behavior when those modes are actually advertised', async function() {
        const f = fixture((type, values) => ({ speech: { enabled: true, context_version: null }, clips: (values.parts || []).map(() => clip) }));
        const result = await f.service.speak(['Original'], 'legacy', f.fallback, ['Legacy'], [], () => ({ parts: ['Legacy'], pauses: [] }));
        assert.strictEqual(result.provider, 'server');
        assert.deepStrictEqual(f.requests[1].values.parts, ['Legacy']);
        f.settings.mode = 'browser'; f.requests.length = 0;
        assert.strictEqual((await f.service.speak(['Original'], 'browser', f.fallback, [], [], () => { throw Error('no local plan'); })).provider, 'browser');
        assert.deepStrictEqual(f.requests, []);
    });

    it('keeps disabled speech and unsupported languages free of metadata requests', async function() {
        for (const change of [{ enabled: false }, { language: 'en-GB' }]) {
            const f = fixture(); Object.assign(f.settings, change);
            const result = await f.service.speak(['Original'], 'unsupported', f.fallback, ['Old'], [], () => { throw Error('no local plan'); });
            assert.strictEqual(result.provider, 'browser');
            assert.deepStrictEqual(f.requests, []);
        }
    });

    it('records resolution counts without recording the requested speech text', async function() {
        const traces = require('../bts/performance/traces'), speech = require('../bts/speech');
        const app = { speech: { broker: { config: { enabled: true } },
            request: async () => ({ clips: [clip, { status: 'queued' }] }) } };
        traces.enable();
        try {
            await speech.handle(app, { speech_tournament_key: 'default', respond() {} }, {
                type: 'speech_resolve', tournament_key: 'default', parts: ['~bts-context-v2~private text', 'private name'],
            });
            const record = traces.snapshot(0).completed.find(row => row.name === 'speech_request');
            const span = record.spans.find(row => row.name === 'speech_resolve_result');
            assert.strictEqual(span.part_count, 2); assert.strictEqual(span.context_part_count, 1);
            assert.strictEqual(span.completed_count, 1);
            assert(!JSON.stringify(record).includes('private'));
        } finally { traces.disable(); }
    });
});
