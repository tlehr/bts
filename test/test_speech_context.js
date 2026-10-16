'use strict';

const assert = require('assert');
const crypto = require('crypto');
const create = require('../static/js/announcement_text');
const translate = require('../static/js/ci18n')._translate;
const { prepare, CALLS } = require('../bts/speech/text');
const { decode } = require('../bts/speech/context');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { tournament, setup } = require('./test_speech_text');
const createService = require('../static/js/speech_service');

function capture(current, match, call, winner = 0) {
    let observed;
    const texts = create({ tournament: current, translate: (key, values) => translate('de', key, values),
        window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
        announce: (parts, _local, _claim, options) => { observed = { parts, ...options }; } });
    texts[call](match, winner);
    return observed;
}

describe('Context speech in tournament calls', function() {
    it('preserves every spoken word and the browser layout across all calls and optional settings', function() {
        const characters = parts => parts.filter(Boolean).join(' ').replace(/[^\p{L}\p{N}]/gu, '');
        for (const flags of [0, 1, 2, 7]) for (const point of [false, true]) for (const doubles of [false, true]) {
            const current = tournament(flags);
            current.preparation_meetingpoint_enabled = point;
            current.tabletoperator_use_manual_counting_boards_enabled = doubles;
            const match = setup();
            if (doubles) match.teams.forEach(team => team.players.push({ name: 'Zweite Person Ü17' }));
            for (const call of [...CALLS, 'announceNoMatchWin']) {
                const legacy = capture(current, match, call);
                const context = capture({ ...current, speech: { context_version: 'bts-context-v1' } }, match, call);
                assert.deepStrictEqual(context.parts, legacy.parts, call + ' browser text');
                assert.strictEqual(characters(context.localParts.map(part => decode(part, 1200)?.text || part)),
                    characters(legacy.parts), call + ' spoken content');
            }
        }
    });

    it('warms every exact contextual piece, including both winners and late hall assignment', function() {
        for (const point of [false, true]) for (const court of ['default_4', null]) {
            const current = { ...tournament(), speech: { context_version: 'bts-context-v1' },
                preparation_meetingpoint_enabled: point };
            const match = setup({ court_id: court, location_id: null });
            const prepared = new Set(prepare(current, [{ setup: match }]));
            for (const location_id of [null, 'default_h1']) for (const call of [...CALLS, 'announceNoMatchWin']) {
                for (const winner of [0, 1]) for (const part of capture(current, { ...match, location_id }, call, winner).localParts) {
                    assert(prepared.has(part), call + ': ' + (decode(part, 1200)?.text || part));
                }
            }
            const recipes = [...prepared].map(part => decode(part, 1200)).filter(Boolean);
            assert.strictEqual(recipes.filter(item => item.kind === 'game').length, 1);
            assert.strictEqual(recipes.filter(item => item.kind === 'team').length, 2);
            assert.strictEqual(recipes.filter(item => item.text === 'Das Spiel geht kampflos an').length, 1);
            assert(!recipes.some(item => ['gegen', 'und', 'Spiel Nummer 17', 'Jungeneinzel U17'].includes(item.text)));
        }
    });

    it('shares the game source across fields and officials and keeps distinct field opening and closing pieces', function() {
        const current = { ...tournament(), speech: { context_version: 'bts-context-v1' } };
        const first = capture(current, setup(), 'announceNewMatch').localParts;
        const changed = capture(current, setup({ court_id: 'default_8', umpire: { name: 'Andere Person' } }), 'announceNewMatch').localParts;
        assert.strictEqual(first[1], changed[1]);
        assert.notStrictEqual(first[0], first.at(-1));
        const a = decode(first[0], 1200), b = decode(first.at(-1), 1200);
        assert.strictEqual(a.before + a.text + a.after, b.before + b.text + b.after);
        assert.strictEqual(a.text, b.text);
        const d05 = capture(current, setup(), 'announceSecondPreparationCallTeamOne');
        assert.deepStrictEqual(d05.localPauses, [140, 120, 320, 160, 0]);
        assert.strictEqual(d05.localParts[1], d05.localParts[3]);
    });

    it('submits one shared source before its dependent cuts and keeps exactly one job open', async function() {
        let clock = 1000, open = null;
        const sent = [], jobs = new Map();
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'test-key-' + 'x'.repeat(32) }, {}), {
            now: () => clock,
            request: async (_url, _key, method, route, body) => {
                if (method === 'POST') {
                    assert.strictEqual(open, null);
                    const job_id = crypto.randomBytes(16).toString('hex');
                    const job = { ...body, job_id, status: 'processing' };
                    jobs.set(job_id, job); sent.push(body); open = job_id; return job;
                }
                const job = jobs.get(route.split('/').at(-1));
                open = null;
                return { ...job, status: 'completed', audio: { audio_id: job.job_id,
                    processed: !!job.context, leading_quiet_ms: 35, trailing_quiet_ms: 45 } };
            },
        });
        broker.context_version = 'bts-context-v1';
        const current = { ...tournament(), speech: { context_version: broker.context_version } };
        const parts = capture(current, setup(), 'announceNewMatch').localParts;
        const field = [parts[0], parts.at(-1)];
        broker.prepare(field, { priority: 'low' }, 'default');
        assert.strictEqual(broker.entries.size, 3);
        for (let i = 0; i < 6; i++) { await broker.step(); clock += 3000; }
        assert.strictEqual(sent.length, 3);
        assert(!sent[0].context);
        assert.strictEqual(sent[0].profile, 'bts-context-v1');
        assert(sent[1].context && sent[2].context);
        assert.strictEqual(sent[1].context.audio_id, sent[2].context.audio_id);
        assert(sent.every(item => !/\d/.test(item.text)));
        assert(broker.views(field, {}, 'default').every(item => item.status === 'completed' && item.processed));
        assert(broker.queue('default').items.filter(item => item.processed).every(item => !item.audio_url.includes('playback=')));
    });

    it('decodes contextual clips before playback and schedules exact pauses on one audio clock', async function() {
        const scheduled = [], events = [];
        let decoded = 0;
        const clock = { state: 'running', currentTime: 10, destination: {},
            decodeAudioData: async () => { events.push('decode'); return { duration: ++decoded === 1 ? .2 : .3 }; },
            createGain: () => ({ gain: {}, connect() {}, disconnect() {} }),
            createBufferSource: () => ({ connect() {}, disconnect() {}, stop() {}, start(time) {
                events.push('start'); scheduled.push(time); if (scheduled.length === 2) setImmediate(() => this.onended());
            } }),
        };
        const service = createService({ settings: () => ({ enabled: true, key: 'default', mode: 'auto',
            voice: 'hallensprecher', language: 'de-DE', rate: 1.05, deadline_ms: 700 }),
        makeAudioContext: () => clock, fetchAudio: async () => new ArrayBuffer(10),
        request: async () => ({ speech: { enabled: true }, clips: [0, 1].map(() => ({ status: 'completed',
            audio_url: '/h/default/speech/audio/' + 'a'.repeat(32) + '?signature=test', processed: true,
            leading_quiet_ms: 45, trailing_quiet_ms: 55 })) }) });
        const result = await service.speak(['Browsertext'], 'clock-test', () => { throw new Error('unexpected fallback'); },
            ['piece1', 'piece2'], [250, 0]);
        assert.strictEqual(result.provider, 'server');
        assert.deepStrictEqual(events, ['decode', 'decode', 'start', 'start']);
        assert.strictEqual(scheduled[0], 10.05);
        assert(Math.abs(scheduled[1] - 10.4) < 1e-9);
    });
});
