'use strict';

const assert = require('assert');
const crypto = require('crypto');
const create = require('../static/js/announcement_text');
const translate = require('../static/js/ci18n')._translate;
const { prepare, CALLS } = require('../bts/speech/text');
const { decode, sourcePart } = require('../bts/speech/context');
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
    for (const doubles of [false, true]) for (const split of [false, true]) for (const boards of [false, true]) {
        it('warms late tablet assignment from both on-court teams across fields and halls (' + [doubles, split, boards].join('/') + ')', async function() {
            let clock = 1000;
            const sent = [];
            const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'test-key-' + 'x'.repeat(32) }, {}), {
                now: () => clock,
                request: async (_base, _key, _method, _route, body) => {
                    sent.push(body);
                    const job_id = crypto.randomBytes(16).toString('hex');
                    return { ...body, job_id, status: 'completed', audio: { audio_id: job_id, processed: !!body.context } };
                },
            });
            broker.context_version = 'bts-context-v1';
            const current = { ...tournament(), speech: { context_version: broker.context_version },
                tabletoperator_enabled: true, tabletoperator_split_doubles: split,
                tabletoperator_use_manual_counting_boards_enabled: boards };
            current.normalizations = [{ origin: 'Johann', replace: 'Hans', language: 'de-DE' }];
            current.courts.push({ _id: 'default_8', is_active: true }, { _id: 'default_9', is_active: true });
            current.locations.push({ _id: 'hall2', meetingpoint_announcement: 'Bitte {komm/kommt} in Halle zwei!' });
            const previous = setup({ state: 'oncourt', tabletoperators: null, umpire: null, service_judge: null });
            if (doubles) previous.teams.forEach((team, index) => team.players.push({ name: 'Zweite Person ' + index }));
            const next = setup({ match_num: 18, court_id: null, location_id: null, tabletoperators: null,
                umpire: null, service_judge: null, teams: [{ players: [{ name: 'Neues Team A' }] }, { players: [{ name: 'Neues Team B' }] }] });
            const prepared = prepare(current, [{ setup: previous }, { setup: next }]);
            for (let i = 0; i < prepared.length; i += 64) broker.prepare(prepared.slice(i, i + 64), {}, 'default');
            while (broker.pending_order().length) { await broker.step(); clock += 1000; }
            const count = sent.length, entries = broker.entries.size;
            const groups = previous.teams.flatMap(team => split ? team.players.map(player => [player]) : [team.players]);
            const sources = new Set();
            for (const tabletoperators of groups) for (const court of current.courts) for (const hall of current.locations) {
                const assigned = { ...next, state: 'oncourt', tabletoperators, court_id: court._id, location_id: hall._id };
                for (const call of ['announceNewMatch', 'announceSecondCallTabletoperator',
                    'announceSecondPreparationCallTabletoperator']) {
                    const plan = capture(current, assigned, call);
                    broker.prepare(plan.localParts, { priority: 'high' }, 'default');
                    assert(broker.views(plan.localParts, {}, 'default').every(clip => clip.status === 'completed'), call);
                    const role = plan.localParts.find(part => /^(?:Tablet|Klapptafel)bedienung:/.test(decode(part, 1200)?.text));
                    if (role) sources.add(sourcePart(decode(role, 1200)));
                }
            }
            await broker.step();
            assert.strictEqual(sent.length, count, 'late assignment requires no extra API request');
            assert.strictEqual(broker.entries.size, entries, 'no field/game/operator combination is generated');
            assert.strictEqual(sources.size, groups.length, 'one shared contextual source per candidate team');
            assert(!JSON.stringify(previous).includes('Hans'), 'preparation must not mutate match/player names');
        });
    }

    it('warms existing waiting operators and service aliases without generating disabled or obsolete candidates', function() {
        const current = { ...tournament(), speech: { context_version: 'bts-context-v1' }, tabletoperator_enabled: true,
            tabletoperator_with_state_enabled: true, tabletoperators: [
                { tabletoperator: [{ name: 'Wartender Dienst' }], court: null, end_ts: null },
                { tabletoperator: [{ name: 'Beendeter Dienst' }], court: null, end_ts: 1 },
            ] };
        const match = setup({ state: 'oncourt', tabletoperators: null });
        match.teams.forEach((team, index) => { team.players[0].state = 'Landesverband ' + index; });
        const recipes = prepare(current, [{ setup: match }]).map(part => decode(part, 1200)).filter(Boolean);
        const roles = recipes.filter(recipe => recipe.text.startsWith('Tabletbedienung:')).map(recipe => recipe.text);
        assert(roles.includes('Tabletbedienung:Wartender Dienst'));
        assert(roles.includes('Tabletbedienung:Landesverband 0') && roles.includes('Tabletbedienung:Landesverband 1'));
        assert(!roles.some(text => text.includes('Beendeter Dienst') || text.includes('Johann')));
        const fromMatch = prepare({ ...current, tabletoperators: [], tabletoperator_with_state_from_match_enabled: true }, [{ setup: match }])
            .map(part => decode(part, 1200)).filter(recipe => recipe?.text.startsWith('Tabletbedienung:'));
        assert.deepStrictEqual(fromMatch.map(recipe => recipe.text), ['Tabletbedienung:Landesverband 0']);
        delete match.teams[0].players[0].state;
        const laterState = prepare({ ...current, tabletoperators: [], tabletoperator_with_state_from_match_enabled: true }, [{ setup: match }])
            .map(part => decode(part, 1200)).filter(recipe => recipe?.text.startsWith('Tabletbedienung:'));
        assert.deepStrictEqual(laterState.map(recipe => recipe.text), ['Tabletbedienung:Landesverband 1']);
        const disabled = prepare({ ...current, tabletoperator_enabled: false }, [{ setup: match }]);
        assert(!disabled.some(part => decode(part, 1200)?.text.startsWith('Tabletbedienung:')));
    });

    it('limits speculative tablet roles to teams currently on a court while still preparing future game blocks', function() {
        const current = { ...tournament(), speech: { context_version: 'bts-context-v1' }, tabletoperator_enabled: true };
        for (const state of ['scheduled', 'preparation', 'ready', 'finished', 'oncourt']) for (const court_id of [null, 'default_4']) {
            const match = setup({ state, court_id, tabletoperators: null, umpire: null, service_judge: null });
            const recipes = prepare(current, [{ setup: match }]).map(part => decode(part, 1200)).filter(Boolean);
            const roles = recipes.filter(recipe => recipe.text.startsWith('Tabletbedienung:'));
            assert.strictEqual(roles.length, state === 'oncourt' && court_id ? 2 : 0, state + '/' + court_id);
            assert(recipes.some(recipe => recipe.kind === 'game'), 'known game blocks retain their independent planning');
        }
    });

    for (const outcome of ['context', 'name', 'failed', 'source-failed', 'source-rejected']) it('bounds team recovery and retains one request at a time: ' + outcome, async function() {
        let clock = 1000;
        const sent = [], jobs = new Map();
        let open = null;
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'test-key-' + 'x'.repeat(32) }, {}), {
            now: () => clock,
            request: async (_url, _key, method, route, body) => {
                if (method === 'POST') {
                    assert.strictEqual(open, null, 'only BTS determines which job starts next');
                    if (outcome === 'source-rejected' && body.source_seed === 43) {
                        sent.push(body);
                        throw Object.assign(new Error('Source variant rejected'), { status: 422 });
                    }
                    const job_id = crypto.randomBytes(16).toString('hex');
                    const job = { ...body, job_id, status: 'processing' };
                    jobs.set(job_id, job); sent.push(body); open = job_id; return job;
                }
                const job = jobs.get(route.split('/').at(-1));
                assert.strictEqual(open, job.job_id); open = null;
                const source = job.context && jobs.get(job.context.audio_id);
                const failed = outcome === 'source-failed' && job.source_seed === 43 || job.context && (
                    source?.source_seed !== 43 && job.context.before ||
                    outcome !== 'context' && job.context.before || outcome === 'failed');
                return { ...job, status: failed ? 'failed' : 'completed',
                    ...(failed ? { error: { code: job.context ? 'alignment_failed' : 'generation_failed' } } :
                        { audio: { audio_id: job.job_id, processed: !!job.context } }) };
            },
        });
        broker.context_version = 'bts-context-v1';
        const part = '~bts-context-v1~' + JSON.stringify({ before: 'Finale! ', text: 'Ridhi Polali',
            after: ' gegen Charlotte Dettmann.', kind: 'team' });
        for (let step = 0; step < 25; step++) {
            broker.prepare([part], { priority: 'normal' }, 'default');
            await broker.step(); clock += 1000;
        }
        const entry = broker.entries.get(broker.key(part, 'hallensprecherin', 'de-DE'));
        assert.strictEqual(entry.status, outcome === 'failed' ? 'failed' : 'completed');
        assert.strictEqual(sent.filter(body => body.source_seed === 43).length, 1, 'one genuinely different complete context');
        assert.strictEqual(sent.filter(body => !body.context && body.text === 'Ridhi Polali').length, outcome === 'context' ? 0 : 1);
        assert.strictEqual(sent.length, outcome === 'context' ? 4 : ['source-failed', 'source-rejected'].includes(outcome) ? 5 : 6);
        assert.strictEqual(entry.fallback_stage, outcome === 'context' ? 'context' : 'name');
        assert.strictEqual(!!entry.terminal_failure, outcome === 'failed');
        const row = broker.queue('default').items.find(item => item.key === entry.key);
        const source = broker.queue('default').items.find(item => item.key === row.source_key);
        assert.strictEqual(source.text.slice(row.source_range.start, row.source_range.end), row.text);
        assert.strictEqual(row.operation, outcome === 'context' ? 'excerpt' : 'processing');
    });

    it('shares one alternate game recording between two failed team cuts and preserves the original game source', async function() {
        let clock = 1000;
        const sent = [];
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'test-key-' + 'x'.repeat(32) }, {}), {
            now: () => clock,
            request: async (_url, _key, _method, _route, body) => {
                sent.push(body);
                const job_id = crypto.randomBytes(16).toString('hex');
                const failed = body.context && (body.context.before || body.context.after);
                return { ...body, job_id, status: failed ? 'failed' : 'completed',
                    ...(failed ? { error: { code: 'alignment_failed' } } :
                        { audio: { audio_id: job_id, processed: !!body.context } }) };
            },
        });
        broker.context_version = 'bts-context-v1';
        const parts = [{ before: 'Finale! ', text: 'Ridhi Polali', after: ' gegen Charlotte Dettmann.', kind: 'team' },
            { before: 'Finale! Ridhi Polali gegen ', text: 'Charlotte Dettmann', after: '.', kind: 'team' }]
            .map(recipe => '~bts-context-v1~' + JSON.stringify(recipe));
        broker.prepare(parts, {}, 'default'); await broker.step(); clock += 1000;
        const original = [...broker.entries.values()].find(entry => entry.context.kind === 'source');
        const original_audio = original.audio_id;
        for (let step = 0; step < 15; step++) { await broker.step(); clock += 1000; }
        assert(broker.views(parts, {}, 'default').every(clip => clip.status === 'completed'));
        assert.strictEqual(original.audio_id, original_audio, 'the successfully generated game is never overwritten');
        assert.strictEqual(sent.filter(body => body.source_seed === 43).length, 1);
        assert.strictEqual(sent.filter(body => !body.context).length, 4, 'two game sources and two individual names');
        assert.strictEqual(sent.length, 10);
    });

    it('uses the correct girls discipline in browser calls and the actual local synthesis request for singles and doubles', async function() {
        let clock = 1000;
        const sent = [];
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'test-key-' + 'x'.repeat(32) }, {}), {
            now: () => clock,
            request: async (_url, _key, method, _route, body) => {
                assert.strictEqual(method, 'POST');
                sent.push(body);
                const job_id = crypto.randomBytes(16).toString('hex');
                return { ...body, job_id, status: 'completed', audio: { audio_id: job_id, processed: !!body.context } };
            },
        });
        broker.context_version = 'bts-context-v1';
        const current = { ...tournament(), speech: { context_version: broker.context_version } };
        for (const [code, discipline] of [['ME', 'Mädcheneinzel'], ['MD', 'Mädchendoppel']]) {
            const match = setup({ event_name: code + ' U19' });
            if (code === 'MD') match.teams.forEach(team => team.players.push({ name: 'Weitere Spielerin' }));
            const call = capture(current, match, 'announceNewMatch');
            assert(call.parts.includes(discipline + ' U19'), 'the browser receives the corrected discipline');
            broker.prepare(call.localParts.filter(part => decode(part, 1200)?.kind === 'game'), {}, 'default');
        }
        for (let step = 0; step < 10 && broker.pending_order().length; step++) { await broker.step(); clock += 1000; }
        assert([...broker.entries.values()].every(entry => entry.status === 'completed'));
        const sources = sent.filter(body => !body.context);
        assert.strictEqual(sources.length, 2);
        assert(sources.some(body => body.text.includes('Mädcheneinzel U neunzehn.')));
        assert(sources.some(body => body.text.includes('Mädchendoppel U neunzehn.')));
        assert(sent.every(body => !/Maedchen|Mädchenneinzel/.test(body.text)));
    });

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

    it('shares one preparation reference across empty hall additions while retaining distinct opening and closing cuts', async function() {
        const current = { ...tournament(), speech: { context_version: 'bts-context-v1' },
            preparation_meetingpoint_enabled: false, locations: [
                { _id: 'default_h1', preparation_addition: '', meetingpoint_announcement: '' },
                { _id: 'default_h2', preparation_addition: '  ', meetingpoint_announcement: 'Hier treffen!' },
            ] };
        const matches = [null, 'default_h1', 'default_h2'].map((location_id, index) => ({
            setup: setup({ court_id: null, location_id, match_num: index + 1 }),
        }));
        const prepared = prepare(current, matches);
        const pieces = prepared.filter(part => decode(part, 1200)?.text.trim() === 'In Vorbereitung');
        assert.strictEqual(pieces.length, 2, 'one opening and one closing, without whitespace or unused meeting-point variants');
        const recipes = pieces.map(part => decode(part, 1200));
        assert(recipes.every(recipe => recipe.text === 'In Vorbereitung'));
        assert.strictEqual(new Set(recipes.map(sourcePart)).size, 1, 'both cuts reuse the same complete reference recording');
        assert(recipes.some(recipe => !recipe.before));
        assert(recipes.some(recipe => !recipe.after));
        for (const match of matches) {
            const call = capture(current, match.setup, 'announcePreparationMatch');
            assert.strictEqual(call.localParts[0], pieces.find(part => !decode(part, 1200).before));
            assert.strictEqual(call.localParts.at(-1), pieces.find(part => !decode(part, 1200).after));
        }

        let clock = 1000;
        const sent = [];
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'test-key-' + 'x'.repeat(32) }, {}), {
            now: () => clock,
            request: async (_url, _key, method, _route, body) => {
                assert.strictEqual(method, 'POST');
                sent.push(body);
                const job_id = crypto.randomBytes(16).toString('hex');
                return { ...body, job_id, status: 'completed', audio: { audio_id: job_id, processed: !!body.context } };
            },
        });
        broker.context_version = 'bts-context-v1';
        broker.prepare(pieces, { voice: 'hallensprecher' }, 'default');
        for (let step = 0; step < 10 && broker.pending_order().length; step++) { await broker.step(); clock += 1000; }
        assert([...broker.entries.values()].every(entry => entry.status === 'completed'));
        assert.strictEqual(sent.filter(body => !body.context).length, 1, 'only one TTS generation');
        assert.strictEqual(sent.filter(body => body.context).length, 2, 'two inexpensive cuts');
        const queue = broker.queue('default').items.filter(item => item.kind !== 'source');
        assert.deepStrictEqual(queue.map(item => item.excerpt_position).sort(), ['end', 'start']);
        assert(queue.every(item => item.operation === 'excerpt'));
        assert.strictEqual(new Set(queue.map(item => item.source_key)).size, 1);
        const source = broker.queue('default').items.find(item => item.kind === 'source');
        assert.strictEqual(source.operation, 'synthesis');
        assert(queue.every(item => item.source_key === source.key &&
            source.text.slice(item.source_range.start, item.source_range.end) === item.text));
        assert.notDeepStrictEqual(queue[0].source_range, queue[1].source_range, 'the identical text must point to different positions');
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

    it('reuses 13 field references and three game sources for every later B01 field assignment without another request', async function() {
        let clock = 1000;
        const sent = [];
        const broker = new SpeechBroker(configuration({ enabled: true, api_key: 'test-key-' + 'x'.repeat(32) }, {}), {
            now: () => clock,
            request: async (_url, _key, method, _route, body) => {
                assert.strictEqual(method, 'POST');
                sent.push(body);
                const job_id = crypto.randomBytes(16).toString('hex');
                return { ...body, job_id, status: 'completed', audio: { audio_id: job_id, processed: !!body.context } };
            },
        });
        broker.context_version = 'bts-context-v1';
        const current = { ...tournament(), speech: { context_version: broker.context_version },
            courts: Array.from({ length: 13 }, (_, index) => ({ _id: 'default_' + (index + 1),
                is_active: true, location_id: 'default_h1' })) };
        const matches = Array.from({ length: 3 }, (_, index) => ({ setup: setup({ court_id: null, match_num: 185 + index }) }));
        const options = { voice: 'hallensprecher', priority: 'normal' };
        const prepared = prepare(current, matches);
        for (let i = 0; i < prepared.length; i += 64) broker.prepare(prepared.slice(i, i + 64), options, 'default');
        while (broker.pending_order().length) { await broker.step(); clock += 1000; }
        assert([...broker.entries.values()].every(entry => entry.status === 'completed'));
        const queue = broker.queue('default').items;
        const fields = queue.filter(item => item.source_usage?.type === 'field');
        const games = queue.filter(item => item.source_usage?.type === 'game');
        assert.strictEqual(fields.length, 13, 'one fixed reference for each field, shared by every game');
        assert.strictEqual(games.length, 3, 'one source for each actual game');
        for (const source of [...fields, ...games]) {
            assert.strictEqual(source.operation, 'synthesis');
            const children = queue.filter(item => item.source_key === source.key);
            assert(children.length >= 2);
            for (const child of children) {
                assert.strictEqual(source.text.slice(child.source_range.start, child.source_range.end), child.text);
                assert.strictEqual(child.operation, child.kind === 'game' ? 'processing' : 'excerpt');
            }
        }
        assert(games.every(item => !item.text.includes('Spielfeld')));
        assert.strictEqual(new Set(fields.map(item => item.source_usage.text)).size, 13);
        const requestsBefore = sent.length, entriesBefore = broker.entries.size;
        const fieldCalls = ['announceNewMatch', 'announceBeginnToPlay', 'announceSecondCallTeamOne',
            'announceSecondCallTeamTwo', 'announceSecondCallUmpire', 'announceSecondCallServiceJudge',
            'announceSecondCallTabletoperator', 'announceNoMatchWin'];
        for (const match of matches) for (const court of current.courts) for (const call of fieldCalls) {
            const parts = capture(current, { ...match.setup, court_id: court._id }, call).localParts;
            broker.prepare(parts, { ...options, priority: 'high' }, 'default');
            assert(broker.views(parts, options, 'default').every(item => item.status === 'completed'), call);
        }
        await broker.step();
        assert.strictEqual(sent.length, requestsBefore, 'field assignment needs no source, extraction or status POST');
        assert.strictEqual(broker.entries.size, entriesBefore, 'no extra field/game combination is registered');
        assert.strictEqual(broker.current, null);
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
