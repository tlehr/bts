'use strict';

const assert = require('assert');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { PlanningStatus } = require('../bts/speech/planning_status');
const { requiredPlan } = require('../bts/speech/planning');
const idlePlan = require('../bts/speech/idle_plan');
const { handle } = require('../bts/speech');
const { tournament, setup } = require('./test_speech_text');

const key = 'default', voice = 'hallensprecher';
const settings = { mode: 'auto', voice };
const required = () => ({ shared: [], games: new Map() });
const broker = () => new SpeechBroker(configuration({ enabled: true, cache_enabled: false,
    api_key: 'planning-test-' + 'x'.repeat(32) }, {}));
const game = (id, state, overrides = {}) => ({ _id: id, setup: setup({ state, ...overrides }) });

describe('Live speech planning', function() {
    it('reports actual simultaneous game states, candidates and finished no-match results', function() {
        const model = new PlanningStatus({ ...tournament(), name: 'Live-Test' }, [
            game('field', 'oncourt'), game('prep', 'preparation'), game('candidate', 'scheduled'),
            game('future', 'incomplete'), game('done', 'finished'),
            { ...game('no-match', 'scheduled'), score_status: 'no_match' },
            game('not-a-game', 'scheduled', { is_match: false }),
        ], required(), ['candidate']);
        const value = model.snapshot(broker(), key, settings);
        assert.strictEqual(value.phase, 'competition');
        assert.strictEqual(value.title, 'Live-Test');
        assert.deepStrictEqual(value.games, { oncourt: 1, preparation: 1, candidate: 1, planned: 1, finished: 2 });
        assert.strictEqual(new PlanningStatus(tournament(), [], required()).snapshot(broker(), key, settings).phase, 'registration');
    });

    it('counts ready / queued / total once, including unrequested inventory and cache from other tournaments', function() {
        const b = broker(), model = new PlanningStatus(tournament(), [], required());
        model.parts.clear();
        model.add('shared', ['Fertig', 'Beauftragt', 'Vorrat']);
        model.add('planned', ['Fertig', 'Später']);
        b.prepare(['Fertig'], { voice }, 'other-tournament');
        b.entries.get(b.key('Fertig', voice, 'de-DE')).status = 'completed';
        b.prepare(['Beauftragt'], { voice, priority: 'normal', prefetch: true }, key);
        const entries = b.entries.size, order = b.pending_order().map(entry => entry.key);
        const first = model.snapshot(b, key, settings);
        const shared = first.stages.find(row => row.id === 'shared');
        assert.deepStrictEqual([shared.ready, shared.queued, shared.total], [1, 1, 3]);
        assert.deepStrictEqual([first.total.ready, first.total.queued, first.total.total], [1, 1, 4]);
        const current = b.entries.get(b.key('Beauftragt', voice, 'de-DE'));
        current.status = 'completed';
        const second = model.snapshot(b, key, settings);
        assert.deepStrictEqual([second.total.ready, second.total.queued, second.total.total], [2, 0, 4]);
        current.status = 'unsubmitted';
        assert.strictEqual(b.entries.size, entries, 'snapshots must never admit future inventory');
        assert.deepStrictEqual(b.pending_order().map(entry => entry.key), order);
    });

    it('reuses persistent cache without adding jobs and does not count unusable local audio as ready', function() {
        const b = broker(), model = new PlanningStatus(tournament(), [], required());
        model.parts.clear(); model.add('shared', ['Gespeichert', 'Datei fehlt']);
        b.prepare(['Datei fehlt'], { voice, priority: 'normal', prefetch: true }, key);
        const entry = b.entries.get(b.key('Datei fehlt', voice, 'de-DE'));
        Object.assign(entry, { status: 'completed', local: true, audio_id: 'missing' });
        b.disk = { lookup: (_identity, part) => part === b.key('Gespeichert', voice, 'de-DE') ? { audio_id: 'saved' } : null,
            file: () => null };
        const value = model.snapshot(b, key, settings);
        assert.deepStrictEqual([value.total.ready, value.total.queued, value.total.total], [1, 0, 2]);
        assert.strictEqual(b.entries.size, 1);
        assert.strictEqual(entry.status, 'completed', 'the read-only view must leave the broker unchanged');
    });

    it('tracks the current context source through its children and keeps raw sources out of the counts', function() {
        const b = broker(), model = new PlanningStatus(tournament(), [], required());
        b.context_version = 'bts-context-v2';
        const part = '~bts-context-v2~' + JSON.stringify({ before: 'Vorher. ', text: 'Ausschnitt', after: '. Nachher.', kind: 'generic' });
        model.parts.clear(); model.add('preparation', [part]);
        b.prepare([part], { voice, priority: 'normal', prefetch: true }, key);
        const clip = b.entries.get(b.key(part, voice, 'de-DE'));
        const source = b.entries.get(clip.source_key);
        source.status = 'processing';
        b.current = { entry: source, request: { voice } };
        const value = model.snapshot(b, key, settings);
        assert.strictEqual(value.total.total, 1);
        assert.strictEqual(value.total.queued, 1);
        assert.strictEqual(value.active_stage, 'preparation');
        assert.strictEqual(value.current.running, true);
        assert.strictEqual(value.state, 'working');
        assert(value.stages.find(row => row.id === 'preparation').active);
        b.current = null; source.status = 'unsubmitted';
        assert.strictEqual(model.snapshot(b, key, settings).active_stage, 'preparation');
        b.prepare([part], { voice, priority: 'high' }, key);
        assert.strictEqual(model.snapshot(b, key, settings).active_stage, 'urgent');
    });

    it('separates optional other-voice work and terminal failures and reports an external busy server', function() {
        const b = broker(), model = new PlanningStatus(tournament(), [], required());
        model.parts.clear(); model.add('shared', ['Fehlgeschlagen']);
        b.prepare(['Fehlgeschlagen'], { voice, priority: 'normal', prefetch: true }, key);
        const entry = b.entries.get(b.key('Fehlgeschlagen', voice, 'de-DE'));
        Object.assign(entry, { status: 'failed', terminal_failure: true });
        b.spare_plans.set(key, { voice: 'hallensprecherin', parts: ['Andere Stimme'] });
        const value = model.snapshot(b, key, { ...settings, warm_other_voice: true });
        assert.deepStrictEqual(value.total, { ready: 0, queued: 0, total: 2, failed: 1 });
        assert.strictEqual(value.state, 'failed');
        assert.strictEqual(value.stages.find(row => row.id === 'spare').total, 1);
        assert.strictEqual(model.snapshot(b, key, settings).total.total, 1);
        b.current = { entry: { tournaments: new Set(['elsewhere']) } };
        assert.strictEqual(model.snapshot(b, key, settings).state, 'busy_elsewhere');
        assert.strictEqual(model.snapshot(b, key, { ...settings, mode: 'browser' }).state, 'disabled');
    });

    it('annotates the existing actual plan without changing part order or scheduling', async function() {
        const current = { ...tournament(), tabletoperator_enabled: true, speech: { context_version: 'bts-context-v2' } };
        const matches = [game('field', 'oncourt', { called_timestamp: 100 }), game('prep', 'preparation'),
            game('future', 'scheduled', { match_num: 30 }), game('candidate', 'scheduled', { match_num: 40 })];
        const model = new PlanningStatus(current, matches, requiredPlan(current, matches), ['candidate']);
        const recorded = [];
        const annotated = await idlePlan(current, matches, [], ['candidate'], (stage, parts) => {
            recorded.push(stage); model.add(stage, parts);
        });
        assert.deepStrictEqual(annotated, await idlePlan(current, matches, [], ['candidate']));
        assert(recorded.indexOf('oncourt') < recorded.indexOf('preparation'));
        assert(recorded.indexOf('candidate') < recorded.indexOf('planned'));
        assert(annotated.every(part => model.parts.has(part)));
    });

    it('allows only loaded-tournament, rate-limited read-only status requests, including disabled speech', function() {
        const b = broker(), model = new PlanningStatus(tournament(), [], required());
        const app = { speech: { broker: b, prefetch: { planning_status: value => {
            assert.strictEqual(value, key); return model.snapshot(b, key, settings);
        } } } };
        let response;
        const ws = { respond: (_msg, _err, value) => { response = value; } };
        const message = { type: 'speech_planning', tournament_key: key };
        handle(app, ws, message);
        assert.strictEqual(response.speech_error, 'tournament_not_loaded');
        ws.speech_tournament_key = key;
        handle(app, ws, { ...message, tournament_key: 'another' });
        assert.strictEqual(response.speech_error, 'tournament_not_loaded');
        b.config.enabled = false;
        handle(app, ws, message);
        assert.strictEqual(response.planning.state, 'disabled');
        handle(app, ws, message);
        assert.strictEqual(response.speech_error, 'speech_rate_limit');
        assert.strictEqual(b.entries.size, 0);
        assert(!JSON.stringify(response).includes(b.config.api_key));
    });
});
