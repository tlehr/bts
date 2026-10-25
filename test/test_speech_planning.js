'use strict';

const assert = require('assert');
const { SpeechBroker, configuration } = require('../bts/speech/broker');
const { PlanningStatus } = require('../bts/speech/planning_status');
const { Prefetcher } = require('../bts/speech/prefetch');
const { requiredPlan, requiredParts } = require('../bts/speech/planning');
const idlePlan = require('../bts/speech/idle_plan');
const { handle } = require('../bts/speech');
const { decode } = require('../bts/speech/context');
const { tournament, setup } = require('./test_speech_text');

const key = 'default', voice = 'hallensprecher';
const settings = { mode: 'auto', voice };
const required = () => ({ shared: [], games: new Map() });
const broker = () => new SpeechBroker(configuration({ enabled: true, cache_enabled: false,
    api_key: 'planning-test-' + 'x'.repeat(32) }, {}));
const game = (id, state, overrides = {}) => ({ _id: id, setup: setup({ state, ...overrides }) });
const registrationTournament = () => ({ ...tournament(), speech: { context_version: 'bts-context-v2' },
    registration_open_events: { open: true }, registration_completed_events: { complete: true },
    events: { events: [
        { id: 'closed', name: 'Spätere Disziplin', stages: [{ entries: [{ entry_id: 'later', team: {
            players: [{ name: 'Erika Musterfrau', state: 'Verband Süd', club: 'Späterer Verein' }],
        } }] }] },
        { id: 'open', name: 'Offene Disziplin', stages: [{ entries: [{ entry_id: 'first', team: {
            players: [{ name: 'Max Mustermann', state: 'Verband Nord', club: 'Musterverein' },
                { name: 'Hans Dampf', state: 'Verband Nord', club: 'Musterverein' }],
        } }] }] },
        { id: 'complete', name: 'Abgeschlossene Anmeldung', stages: [{ entries: [{ entry_id: 'checked', team: {
            players: [{ name: 'Otto Normalverbraucher', state: 'Verband West', club: 'Fertiger Verein' }],
        } }] }] },
    ] } });

async function registrationPlan(current) {
    const required = requiredPlan(current, []), model = new PlanningStatus(current, [], required);
    let registration;
    await idlePlan(current, [], [], [], (stage, parts, detail) => {
        model.add(stage, parts, detail);
        if (stage === 'registration_reserve') registration = parts;
    });
    return { ...required, model, registration, registration_trace: model.registration_trace };
}

describe('Live speech planning', function() {
    it('keeps registration behind completed disciplines before the first draw and skips empty earlier areas', async function() {
        for (const present of [true, false]) {
            const current = registrationTournament(), b = broker(); b.context_version = 'bts-context-v2';
            current.tabletoperator_enabled = false;
            current.registration_player_statuses = { 'checked:0': { status: present ? 'present' : 'absent' } };
            const required = requiredPlan(current, []), parts = requiredParts(required), model = new PlanningStatus(current, [], required);
            const idle = await idlePlan(current, [], [], [], (stage, values, detail) => model.add(stage, values, detail));
            const registration = idle.filter(part => model.parts.get(part) === 'registration_reserve');
            assert(registration.length > 0);
            assert(registration.every(part => !parts.includes(part)), 'registration must never enter the ordinary queue before the first draw');
            const expected = present ? 'tablet' : 'registration_reserve';
            const needed = new Set(parts), inventory = idle.filter(part => !needed.has(part));
            assert.strictEqual(model.parts.get(inventory[0]), expected, 'prepare present players from completed check-in before open registrations');
            b.reconcile_prefetch(key, parts, { ...settings, idle_parts: inventory });
            for (let i = 0; i < parts.length; i += 64) b.prepare(parts.slice(i, i + 64), { voice, priority: 'normal', prefetch: true }, key);
            for (const entry of b.entries.values()) entry.status = 'completed';
            b.admit_idle();
            const snapshot = model.snapshot(b, key, settings);
            assert.strictEqual(snapshot.phase, 'registration');
            assert.strictEqual(snapshot.active_stage, expected, 'the broker must follow the same fixed order as the diagram');
            b.prepare(['Unmittelbarer Aufruf'], { voice, priority: 'high' }, key);
            assert.strictEqual(model.snapshot(b, key, settings).active_stage, 'urgent', 'actual calls must still preempt all reserve work');
        }
    });

    it('reprioritizes waiting tablet operators before already queued games and retains reusable game recipes', function() {
        for (const context_version of ['bts-context-v2', 'bts-context-v1', null]) {
            const current = { ...tournament(), tabletoperator_enabled: true, tabletoperators: [], speech: { context_version } };
            const matches = [game('running', 'oncourt', { tabletoperators: null, umpire: null, service_judge: null,
                teams: [{ players: [{ name: 'Max Mustermann' }] }, { players: [{ name: 'Hans Dampf' }] }],
            })];
            const b = broker(); b.context_version = context_version;
            const warm = parts => {
                for (let i = 0; i < parts.length; i += 64) b.prepare(parts.slice(i, i + 64), { voice, priority: 'normal', prefetch: true }, key);
            };
            const previous = requiredPlan(current, matches);
            b.set_prefetch_order(key, requiredParts(previous), settings); warm(requiredParts(previous));
            current.tabletoperators = [
                { court: null, end_ts: null, tabletoperator: [{ name: 'Erika Musterfrau' }] },
                { court: null, end_ts: null, tabletoperator: [{ name: 'Max Mustermann' }] },
                { court: 'default_4', end_ts: null, tabletoperator: [{ name: 'Otto Normalverbraucher' }] },
                { court: null, end_ts: 1234, tabletoperator: [{ name: 'Abgeschlossene Musterbedienung' }] },
            ];
            const required = requiredPlan(current, matches), parts = requiredParts(required);
            assert(required.tablet_waiting.length > 0);
            assert(!required.tablet_waiting.some(part => /Otto Normalverbraucher|Abgeschlossene Musterbedienung/.test(decode(part, 1200)?.text || part)));
            assert.deepStrictEqual(required.games.get('running').parts, previous.games.get('running').parts);
            b.set_prefetch_order(key, parts, settings); warm(parts);
            const model = new PlanningStatus(current, matches, required), explanations = model.explanations(b, key, settings);
            const stages = b.pending_order().map(entry => explanations.get(entry.key)?.stage);
            const waiting = stages.indexOf('tablet_waiting'), running = stages.indexOf('oncourt');
            assert(waiting >= 0 && running > waiting, String(context_version));
            assert(stages.lastIndexOf('tablet_waiting') < running, 'finish the tablet waiting list before running games');
            assert(stages.lastIndexOf('shared') < waiting, 'retain higher-priority shared pieces');
        }
    });

    it('reports whether officials exist independently of their audio demand, including assignments on games', function() {
        for (const [umpires, assignments, expected] of [
            [[], {}, false], [[{ name: '   ' }], {}, false], [[{ name: 'Max Mustermann' }], {}, true],
            [[], { umpire: { name: 'Hans Dampf' } }, true], [[], { service_judge: { name: 'Erika Musterfrau' } }, true],
        ]) {
            const current = tournament(), matches = [game('future', 'scheduled', { umpire: null, service_judge: null, ...assignments })];
            const required = requiredPlan(current, matches, umpires);
            const snapshot = new PlanningStatus(current, matches, required).snapshot(broker(), key, settings);
            assert.strictEqual(snapshot.has_officials, expected);
            assert.strictEqual(snapshot.stages.find(stage => stage.id === 'officials').total, 0,
                'zero planned parts must not imply that no official exists');
        }
    });

    it('moves newly known officials after fields and ahead of already queued game work', function() {
        const official = { name: 'Max Mustermann' };
        for (const matches of [[game('running', 'oncourt', { umpire: official })]]) {
            const current = registrationTournament(), b = broker(); b.context_version = 'bts-context-v2';
            const warm = parts => {
                for (let i = 0; i < parts.length; i += 64) b.prepare(parts.slice(i, i + 64), { voice, priority: 'normal', prefetch: true }, key);
            };
            const previous = requiredParts(requiredPlan(current, matches));
            b.set_prefetch_order(key, previous, settings); warm(previous);
            const required = requiredPlan(current, matches, [official]);
            const parts = requiredParts(required), model = new PlanningStatus(current, matches, required);
            b.set_prefetch_order(key, parts, settings); warm(parts);
            const explanations = model.explanations(b, key, settings);
            const stages = b.pending_order().map(entry => explanations.get(entry.key)?.stage);
            const first = stage => { const index = stages.indexOf(stage); assert(index >= 0, stage); return index; };
            assert(stages.lastIndexOf('shared') < first('officials'), 'finish field/location work before officials');
            assert(stages.lastIndexOf('officials') < first('oncourt'),
                'reprioritize already queued game work behind officials');
            for (const part of required.officials) if (!required.shared.includes(part)) {
                assert.strictEqual(model.parts.get(part), 'officials', 'shared official/player pieces belong to their earliest priority');
            }
        }
    });

    it('explains the actual discipline and label order without changing registration recipes or their sequence', function() {
        const inventory = require('../bts/speech/v2_inventory'), current = registrationTournament(), trace = {};
        current.events.events.push({ id: 'drawn', name: 'Ausgeloste Disziplin', is_drawn: true, stages: [] });
        const parts = inventory.registration(current, [], null, trace);
        assert.deepStrictEqual(parts, inventory.registration(current, []));
        assert.deepStrictEqual(trace.events.map(event => [event.id, event.order]),
            [['open', 1], ['complete', null], ['closed', 2], ['drawn', null]]);
        assert.deepStrictEqual(trace.events[0].counts, { state: 1, club: 1, player: 2, pair: 1, team: 1, number: 0 });
        assert.deepStrictEqual(trace.events[1].counts, { state: 0, club: 0, player: 0, pair: 0, team: 0, number: 0 });
        assert(![...trace.parts.values()].some(part => part.event_id === 'complete'));
        const earliest = kind => [...trace.parts.values()].find(value => value.kind === kind && value.event_id === 'open').plan_order;
        assert(earliest('state') < earliest('club'));
        assert(earliest('club') < earliest('player'));
        assert(earliest('player') < earliest('pair'));
        assert([...trace.parts.values()].filter(value => value.event_id === 'closed').every(value =>
            value.plan_order > earliest('pair')));
    });

    it('orders undrawn registration disciplines by their BTP schedule and keeps area and phase priorities', async function() {
        const current = registrationTournament();
        const md = current.events.events.find(event => event.id === 'open');
        md.name = 'MD U17'; md.first_planned_match = { number: 396, date: '2026-09-27', time: '12:00', order: 0 };
        current.events.events.push({ id: 'mx', name: 'MX U19', match_count: 0, is_drawn: false,
            first_planned_match: { number: 25, date: '2026-09-26', time: '10:00', order: 0 },
            stages: [{ entries: [{ entry_id: 'mx-entry', team: { players: [{ name: 'Erika Musterfrau', state: 'Verband MX', club: 'Verein MX' }] } }] }] });
        current.registration_open_events.mx = true;
        current.events.events.find(event => event.id === 'closed').first_planned_match = { number: 1, date: '2026-09-25', time: '08:00' };
        const required = await registrationPlan(current), trace = required.registration_trace;
        assert.strictEqual(required.games.size, 0);
        assert.deepStrictEqual(trace.events.map(event => event.id), ['mx', 'open', 'complete', 'closed']);
        assert(trace.events.every(event => event.state !== 'drawn'), 'a known time slot must not imply a completed draw');
        for (const phase of ['open_states', 'open_clubs', 'open_people']) {
            assert.deepStrictEqual([...trace.groups.get(phase).keys()], ['mx', 'open']);
        }
        const positions = [...trace.parts.values()], first = phase => positions.findIndex(value => value.registration_phase === phase);
        assert(first('open_states') < first('open_clubs') && first('open_clubs') < first('open_people'));
        assert(first('open_people') < first('closed_states') && first('completed_teams') === -1);
        const b = broker(); b.context_version = 'bts-context-v2';
        const model = required.model;
        assert.strictEqual(model.snapshot(b, key, settings).phase, 'registration');
        for (let index = 0; index < required.registration.length; index += 64) b.prepare(required.registration.slice(index, index + 64), { voice, priority: 'normal', prefetch: true }, key);
        const reason = [...model.explanations(b, key, settings).values()].find(value => value.event_id === 'mx');
        assert(reason.reason.includes('Spielplan: Spiel 25 · 2026-09-26 10:00'));
        md.first_planned_match.date = '2026-09-25';
        const reordered = await registrationPlan(current);
        assert.deepStrictEqual(reordered.registration_trace.events.slice(0, 2).map(event => event.id), ['open', 'mx']);
        assert.deepStrictEqual(new Set(reordered.registration), new Set(required.registration), 'schedule changes only reorder reusable recipes');
        for (const event of current.events.events) delete event.first_planned_match;
        assert.deepStrictEqual((await registrationPlan(current)).registration_trace.events.slice(0, 2).map(event => event.id), ['open', 'mx'],
            'retain BTP list order when neither discipline has schedule data');
    });

    it('prepares first-round numbers after each discipline\'s players using the normal match-number cache', async function() {
        const current = registrationTournament(), b = broker(); b.context_version = 'bts-context-v2';
        const open = current.events.events.find(event => event.id === 'open');
        open.first_round_match_numbers = [42, 41, 42, 0, null, -1, 1.5];
        const second = structuredClone(open);
        second.id = 'second'; second.name = 'Zweite offene Disziplin';
        second.stages[0].entries[0].entry_id = 'second-entry';
        second.stages[0].entries[0].team.players = [{ name: 'Weitere Musterperson', state: 'Verband Ost', club: 'Anderer Verein' }];
        second.first_round_match_numbers = [42, 43];
        current.events.events.push(second);
        current.registration_open_events.second = true;
        current.events.events.find(event => event.id === 'closed').first_round_match_numbers = [70];
        current.events.events.find(event => event.id === 'complete').first_round_match_numbers = [80];
        current.events.events.push({ id: 'drawn', name: 'Ausgeloste Disziplin', is_drawn: true, first_round_match_numbers: [90] });
        const required = await registrationPlan(current), model = required.model;
        const values = required.registration.map(part => decode(part, 1200).text);
        const position = text => { const index = values.indexOf(text); assert(index >= 0, text); return index; };
        assert(position('Max Mustermann und Hans Dampf') < position('Spielnummer 42'));
        assert(position('Spielnummer 42') < position('Spielnummer 41'));
        assert(position('Spielnummer 41') < position('Weitere Musterperson'));
        assert(position('Weitere Musterperson') < position('Spielnummer 43'));
        assert(position('Spielnummer 43') < position('Verband Süd'));
        assert(position('Erika Musterfrau') < position('Spielnummer 70'));
        assert.deepStrictEqual(values.filter(text => text.startsWith('Spielnummer ')), ['Spielnummer 42', 'Spielnummer 41', 'Spielnummer 43', 'Spielnummer 70']);
        assert.deepStrictEqual(required.registration_trace.events.filter(event => ['open', 'second', 'closed'].includes(event.id))
            .map(event => event.counts.number), [2, 2, 1]);
        const numberPart = required.registration.find(part => decode(part, 1200).text === 'Spielnummer 42');
        assert(required.registration_trace.groups.get('open_numbers').get('second').has(numberPart),
            'shared numbers belong to both disciplines without generating duplicate audio');
        for (const part of required.registration_trace.groups.get('open_people').get('open')) {
            assert(!decode(part, 1200).text.startsWith('Spielnummer '), 'player progress must exclude match numbers');
        }
        const normal = require('../static/js/speech_context')(require('../bts/speech/text').renderer(current, 'de', []),
            current, 'prepareGame', setup({ match_num: 42 })).parts;
        assert(normal.includes(numberPart), 'prepared number must use the same context and cache key as the actual call');
        b.set_prefetch_order(key, required.registration, settings);
        for (let i = 0; i < required.registration.length; i += 64) b.prepare(required.registration.slice(i, i + 64), { voice, priority: 'normal', prefetch: true }, key);
        const pending = b.pending_order().map(entry => entry.text);
        assert(pending.indexOf('Max Mustermann und Hans Dampf spielt jetzt gegen Max Mustermann und Hans Dampf!') < pending.indexOf('Spielnummer 42 ist als nächstes an der Reihe.'));
        assert(pending.indexOf('Spielnummer 41 ist als nächstes an der Reihe.') < pending.indexOf('Weitere Musterperson spielt jetzt gegen Weitere Musterperson!'));
        const clip = b.entries.get(b.key(numberPart, voice, 'de-DE'));
        const reason = model.explanations(b, key, settings).get(clip.source_key);
        assert.strictEqual(reason.event_id, 'open');
        assert.strictEqual(reason.registration_phase, 'open_numbers');
        assert.strictEqual(reason.kind, 'number');
        assert(reason.reason.includes('Spielnummer der ersten Runde'));
        assert.strictEqual(model.snapshot(b, key, settings).registration_order.find(event => event.id === 'open').counts.number, 2);
        for (const part of required.registration_trace.groups.get('open_people').get('open')) {
            b.entries.get(b.key(part, voice, 'de-DE')).status = 'completed';
        }
        const progress = model.snapshot(b, key, settings).registration_progress;
        const people = progress.find(phase => phase.id === 'open_people').events.find(event => event.id === 'open');
        const numbers = progress.find(phase => phase.id === 'open_numbers').events.find(event => event.id === 'open');
        assert.strictEqual(people.ready, people.total, 'players can be complete while their numbers are still missing');
        assert.deepStrictEqual([numbers.ready, numbers.queued, numbers.total], [0, 2, 2]);
        current.annoncement_include_matchnumber = false;
        assert(!(await registrationPlan(current)).registration.some(part => decode(part, 1200).text.startsWith('Spielnummer ')),
            'disabled match-number announcements must not generate unused numbers');
        b.stop();
    });

    it('shows why a registration source is needed, even though its literal text contains no discipline', async function() {
        const current = registrationTournament(), b = broker(); b.context_version = 'bts-context-v2';
        const required = await registrationPlan(current), model = required.model;
        b.set_prefetch_order(key, required.registration, settings);
        for (let i = 0; i < required.registration.length; i += 64) {
            b.prepare(required.registration.slice(i, i + 64), { voice, priority: 'normal', prefetch: true }, key);
        }
        const [part] = [...required.registration_trace.parts].find(([, value]) => value.kind === 'club' && value.event_id === 'open');
        const clip = b.entries.get(b.key(part, voice, 'de-DE')), source = b.entries.get(clip.source_key);
        assert(source.text.includes('Musterverein spielt jetzt gegen Musterverein'));
        const before = b.pending_order().map(entry => entry.key), size = b.entries.size;
        const queue = model.annotate_queue(b.queue(key, voice, { pending_only: true }), b, key, settings);
        const reason = queue.items.find(item => item.key === source.key).planning;
        assert.strictEqual(reason.event_name, 'Offene Disziplin');
        assert.strictEqual(reason.event_order, 1);
        assert.strictEqual(reason.kind, 'club');
        assert.strictEqual(reason.registration_phase, 'open_clubs');
        assert.strictEqual(reason.label_order, 1);
        assert.strictEqual(reason.source_dependency, true);
        assert(reason.reason.includes('Verein 1: Musterverein'));
        assert(reason.reason.includes('Quellaufnahme vor dem benötigten Ausschnitt'));
        source.status = 'processing'; b.current = { entry: source, request: { voice } };
        const snapshot = model.snapshot(b, key, settings);
        assert.strictEqual(snapshot.current.planning.reason, reason.reason);
        assert.deepStrictEqual(snapshot.registration_order.map(event => event.id), ['open', 'complete', 'closed']);
        b.current = null; source.status = 'unsubmitted';
        assert.strictEqual(b.entries.size, size);
        assert.deepStrictEqual(b.pending_order().map(entry => entry.key), before, 'inspection must not change scheduling');
    });

    it('counts shared playable parts in every registration substate, deduplicates phases and only inspects readiness', async function() {
        const current = registrationTournament(), b = broker(); b.context_version = 'bts-context-v2';
        const duplicate = structuredClone(current.events.events.find(event => event.id === 'open'));
        duplicate.id = 'second'; duplicate.name = 'Zweite offene Disziplin';
        current.events.events.push(duplicate); current.registration_open_events.second = true;
        const required = await registrationPlan(current), model = required.model;
        for (let i = 0; i < required.registration.length; i += 64) b.prepare(required.registration.slice(i, i + 64), { voice, priority: 'normal', prefetch: true }, key);
        const before = b.pending_order().map(entry => entry.key), size = b.entries.size;
        const group = required.registration_trace.groups.get('open_clubs');
        assert.deepStrictEqual([...group.get('open')], [...group.get('second')], 'the same club requirements belong to both disciplines');
        const keys = [...group.get('open')].map(part => b.key(part, voice, 'de-DE'));
        const openKeys = new Set(['open_states', 'open_clubs', 'open_people', 'open_numbers'].flatMap(phase =>
            [...required.registration_trace.groups.get(phase).values()].flatMap(parts => [...parts])));
        for (const entry of b.entries.values()) if (entry.context?.kind === 'source') entry.status = 'completed';
        let snapshot = model.snapshot(b, key, settings);
        let clubs = snapshot.registration_progress.find(phase => phase.id === 'open_clubs');
        assert.strictEqual(clubs.ready, 0, 'completed sources do not make uncut excerpts playable');
        assert.strictEqual(clubs.total, keys.length);
        assert.strictEqual(snapshot.registration_groups.find(area => area.id === 'open').total, openKeys.size);
        assert(clubs.events.every(event => event.total === keys.length && event.queued === keys.length));
        b.entries.get(keys[0]).status = 'completed';
        snapshot = model.snapshot(b, key, settings);
        clubs = snapshot.registration_progress.find(phase => phase.id === 'open_clubs');
        assert.strictEqual(clubs.ready, 1);
        assert.strictEqual(snapshot.registration_groups.find(area => area.id === 'open').ready, 1);
        assert(clubs.events.every(event => event.ready === 1 && event.queued === keys.length - 1));
        const local = b.entries.get(keys[1]); Object.assign(local, { status: 'completed', local: true, audio_id: 'missing' });
        const lookups = new Map();
        b.disk = { lookup: (_identity, part) => {
            lookups.set(part, (lookups.get(part) || 0) + 1);
            return part === keys.at(-1) ? { audio_id: 'from-another-tournament' } : null;
        }, file: () => null };
        clubs = model.snapshot(b, key, settings).registration_progress.find(phase => phase.id === 'open_clubs');
        assert.strictEqual(clubs.ready, 2, 'persistent shared cache counts; missing local WAV does not');
        assert(clubs.events.every(event => event.ready === 2));
        assert([...lookups.values()].every(count => count === 1), 'shared parts are inspected once per snapshot');
        b.disk = null; local.local = false;
        for (const id of keys) b.entries.get(id).status = 'completed';
        clubs = model.snapshot(b, key, settings).registration_progress.find(phase => phase.id === 'open_clubs');
        assert.deepStrictEqual([clubs.ready, clubs.queued, clubs.failed], [clubs.total, 0, 0]);
        for (const entry of b.entries.values()) entry.status = 'unsubmitted';
        assert.strictEqual(b.entries.size, size);
        assert.deepStrictEqual(b.pending_order().map(entry => entry.key), before, 'substate progress must not admit or reorder work');
    });

    it('reports tablet disciplines in actual plan order with shared progress and source provenance without changing scheduling', async function() {
        const current = { ...tournament(), tabletoperator_enabled: true, speech: { context_version: 'bts-context-v2' },
            registration_completed_events: { ready: true, empty: true }, registration_player_statuses: {
                'early:0': { status: 'present' }, 'later:0': { status: 'present' }, 'ready:0': { status: 'present' }, 'empty:0': { status: 'absent' },
            }, events: { events: ['later', 'early', 'ready', 'empty'].map(id => ({ id, name: id, stages: [{ id: id + '-stage',
                entries: [{ entry_id: id, team: { players: [{ name: id === 'later' ? 'Hans Dampf' : 'Max Mustermann' }] } }] }] })) } };
        for (const id of ['early', 'ready']) {
            current.events.events.find(event => event.id === id).stages[0].entries.push({ entry_id: id + '-next', team: { players: [{ name: 'Otto Normalverbraucher' }] } });
            current.registration_player_statuses[id + '-next:0'] = { status: 'present' };
        }
        for (const event of current.events.events) for (const entry of event.stages[0].entries) for (const player of entry.team.players) {
            player.state = event.id === 'empty' ? 'Abwesender Musterverband' : event.id === 'later' ? 'Zweiter Musterverband' : 'Musterverband';
            player.club = event.id === 'empty' ? 'Abwesender Musterverein' : event.id === 'later' ? 'Zweiter Musterverein' : 'Musterverein';
        }
        const matches = ['later', 'early'].map((id, index) => game(id, 'scheduled', { stage_id: id + '-stage', event_name: id,
            scheduled_time_str: index ? '09:00' : '11:00', court_id: null, tabletoperators: null, umpire: null, service_judge: null,
            teams: [current.events.events.find(event => event.id === id).stages[0].entries[0].team, { players: [] }] }));
        matches.push(game('early-next', 'scheduled', { stage_id: 'early-stage', event_name: 'early', scheduled_time_str: '12:00', court_id: null,
            tabletoperators: null, umpire: null, service_judge: null, teams: [{ players: [{ name: 'Otto Normalverbraucher' }] }, { players: [] }] }));
        const b = broker(); b.context_version = 'bts-context-v2';
        const model = new PlanningStatus(current, matches, requiredPlan(current, matches));
        const parts = await idlePlan(current, matches, [], [], (stage, values, detail) => model.add(stage, values, detail));
        assert.deepStrictEqual(parts, await idlePlan(current, matches), 'tracing must preserve every recipe and its order');
        for (let index = 0; index < parts.length; index += 64) b.prepare(parts.slice(index, index + 64), { voice, priority: 'normal', prefetch: true }, key);
        const before = b.pending_order().map(entry => entry.key), size = b.entries.size;
        let snapshot = model.snapshot(b, key, settings), rows = snapshot.tablet_progress;
        assert.deepStrictEqual(rows.map(row => [row.id, row.order, row.btp_order]), [['early', 1, 2], ['later', 2, 1], ['ready', 3, 3], ['empty', 4, 4]]);
        assert.strictEqual(rows[0].next_game.time, '09:00');
        assert.strictEqual(rows[1].next_game.time, '11:00');
        assert([...model.tablet_reasons.values()].some(why => why.event_id === 'early' && why.next_game?.time === '12:00'),
            'keep the actual later game as the cause when a discipline reappears between other disciplines');
        assert(!rows[2].next_game && rows[3].total === 0);
        assert(rows[0].total > 0 && rows[0].total === rows[2].total, 'shared playable recipes belong to each needing discipline');
        assert.deepStrictEqual(snapshot.tablet_phases.map(phase => phase.id), ['states', 'clubs', 'people', 'numbers']);
        for (const phase of snapshot.tablet_phases) {
            assert.deepStrictEqual(phase.events.map(event => event.id), rows.map(event => event.id));
            assert(phase.events[0].total === phase.events[2].total && phase.events[3].total === 0);
            assert.strictEqual(phase.total > 0, phase.id !== 'numbers');
        }
        let previous = -1;
        for (const row of rows) for (const phase of row.phases) {
            const positions = [...model.tablet_reasons]
                .filter(([part, why]) => model.parts.get(part) === 'tablet' && why.event_id === row.id && why.tablet_phase === phase.id)
                .map(([part]) => parts.indexOf(part));
            if (!positions.length) continue;
            assert(Math.min(...positions) > previous, 'finish every phase of one discipline before the next discipline');
            previous = Math.max(...positions);
        }
        assert(![...model.tablet_events.values()].some(event => [...event.parts].some(part => part.includes('Abwesender Muster'))),
            'never add federation or club recordings from absent players');
        const [part] = [...model.tablet_reasons].find(([part, why]) => model.parts.get(part) === 'tablet' && why.event_id === 'early');
        const entry = b.entries.get(b.key(part, voice, 'de-DE'));
        let explanation = model.explanations(b, key, settings).get(entry.source_key);
        assert.strictEqual(explanation.event_id, 'early');
        assert(explanation.reason.includes('1. Landesverbände') && explanation.reason.includes('Disziplin 1: early') && explanation.reason.includes('09:00'));
        const group = model.tablet_events.get('early');
        for (const part of group.parts) b.entries.get(b.key(part, voice, 'de-DE')).status = 'completed';
        snapshot = model.snapshot(b, key, settings); rows = snapshot.tablet_progress;
        assert(rows[0].ready === rows[0].total && rows[2].ready === rows[2].total, 'completion updates every discipline sharing a recording');
        assert(snapshot.tablet_phases.every(phase => phase.events[0].ready === phase.events[0].total && phase.events[2].ready === phase.events[2].total));
        for (const part of group.parts) b.entries.get(b.key(part, voice, 'de-DE')).status = 'unsubmitted';
        explanation = model.annotate_queue(b.queue(key), b, key, settings).items.find(item => item.key === entry.source_key).planning;
        assert.strictEqual(explanation.event_id, 'early');
        assert.strictEqual(b.entries.size, size);
        assert.deepStrictEqual(b.pending_order().map(entry => entry.key), before, 'inspection must not enqueue or reprioritize work');
    });

    it('treats every drawn player as present while excluding reserves and excluded entries', async function() {
        for (const source of ['flag', 'count', 'matches', 'missing-roster']) {
            const players = [{ btp_id: 1, name: 'Max Mustermann', state: 'Musterverband', club: 'Musterverein' },
                { btp_id: 2, name: 'Hans Dampf', state: 'Musterverband', club: 'Musterverein' }];
            const event = { id: 15, name: 'MX U17', stages: [
                { id: 43, stage_type: 1, entries: [{ stage_entry_id: 'pair', team: { players } }] },
                { id: 44, stage_type: 9998, entries: [{ stage_entry_id: 'reserve', team: { players: [{ btp_id: 3, name: 'Reserve Musterperson' }] } }] },
                { id: 45, stage_type: 9999, entries: [{ stage_entry_id: 'excluded', team: { players: [{ btp_id: 4, name: 'Ausgeschlossene Musterperson' }] } }] },
            ] };
            const current = { ...tournament(), speech: { context_version: 'bts-context-v2' }, tabletoperator_enabled: false,
                events: { events: [event] }, registration_player_statuses: { 'pair:1': { status: 'absent' },
                    'reserve:3': { status: 'present' }, 'excluded:4': { status: 'present' } } };
            if (source === 'flag') event.is_drawn = true;
            if (source === 'count') event.match_count = 1;
            const matches = ['matches', 'missing-roster'].includes(source) ? [game('drawn', 'scheduled', { stage_id: 43,
                event_name: 'MX U17', court_id: null, teams: [{ players: players.map(player => ({ ...player, btp_id: String(player.btp_id) })) }, { players: [] }],
                umpire: null, service_judge: null, tabletoperators: null })] : [];
            if (source === 'missing-roster') event.stages = [];
            const statuses = structuredClone(current.registration_player_statuses);
            const model = new PlanningStatus(current, matches, requiredPlan(current, matches));
            await idlePlan(current, matches, [], [], (stage, parts, detail) => model.add(stage, parts, detail));
            const planned = model.tablet_events.get('15');
            assert(planned.parts.size > 0, source);
            assert.deepStrictEqual([planned.counts.player, planned.counts.pair, planned.counts.state, planned.counts.club], [2, 1, 1, 1], source);
            const text = [...planned.parts].map(part => decode(part, 1200).text).join(' ');
            assert(text.includes('Max Mustermann und Hans Dampf'), source);
            assert(!text.includes('Reserve Musterperson') && !text.includes('Ausgeschlossene Musterperson'), source);
            assert.deepStrictEqual(current.registration_player_statuses, statuses, 'speech preparation must not rewrite check-in records');
        }
    });

    it('prepares completed disciplines\' first-round numbers after their players with separate progress', async function() {
        const current = registrationTournament(), b = broker(); b.context_version = 'bts-context-v2';
        current.tabletoperator_enabled = false;
        const complete = current.events.events.find(event => event.id === 'complete');
        complete.first_round_match_numbers = [41, 42, 41, 0, -1, null];
        complete.first_planned_match = { number: 41, date: '2026-09-26', time: '09:00' };
        const second = structuredClone(complete);
        second.id = 'second'; second.name = 'Weitere abgeschlossene Disziplin';
        second.first_round_match_numbers = [43];
        second.first_planned_match = { number: 43, date: '2026-09-26', time: '10:00' };
        second.stages[0].entries[0].entry_id = 'second-entry';
        second.stages[0].entries[0].team.players[0].name = 'Weitere Musterperson';
        current.events.events.push(second);
        current.registration_completed_events.second = true;
        current.registration_player_statuses = { 'checked:0': { status: 'present' }, 'second-entry:0': { status: 'present' } };
        const required = requiredPlan(current, []), model = new PlanningStatus(current, [], required), stages = [];
        const parts = await idlePlan(current, [], [], [], (stage, values, detail) => {
            model.add(stage, values, detail);
            if (stage === 'tablet') stages.push({ ...detail, parts: values });
        });
        const values = stages.flatMap(stage => stage.parts.map(part => decode(part, 1200).text));
        const position = text => { const index = values.indexOf(text); assert(index >= 0, text); return index; };
        assert(position('Otto Normalverbraucher') < position('Spielnummer 41'));
        assert(position('Spielnummer 41') < position('Spielnummer 42'));
        assert(position('Spielnummer 42') < position('Weitere Musterperson'));
        assert(position('Weitere Musterperson') < position('Spielnummer 43'));
        const numberStages = stages.filter(stage => stage.tablet_phase === 'numbers');
        assert.deepStrictEqual(numberStages.map(stage => stage.tablet_event.id), ['complete', 'second']);
        assert(numberStages.every(stage => stage.parts.every(part => decode(part, 1200).text.startsWith('Spielnummer '))));
        assert.deepStrictEqual(model.tablet_events.get('complete').counts.number, 2);
        b.set_prefetch_order(key, parts, settings);
        for (let i = 0; i < parts.length; i += 64) b.prepare(parts.slice(i, i + 64), { voice, priority: 'normal', prefetch: true }, key);
        const firstNumber = numberStages[0].parts[0], clip = b.entries.get(b.key(firstNumber, voice, 'de-DE'));
        const reason = model.explanations(b, key, settings).get(clip.source_key);
        assert.strictEqual(reason.stage, 'tablet');
        assert.strictEqual(reason.event_id, 'complete');
        assert.strictEqual(reason.tablet_phase, 'numbers');
        assert(reason.reason.includes('4. Spielnummern · 1. Runde'));
        for (const stage of stages.filter(stage => stage.tablet_phase === 'people' && stage.tablet_event.id === 'complete')) {
            for (const part of stage.parts) b.entries.get(b.key(part, voice, 'de-DE')).status = 'completed';
        }
        const progress = model.snapshot(b, key, settings).tablet_progress[0];
        const people = progress.phases.find(phase => phase.id === 'people'), numbers = progress.phases.find(phase => phase.id === 'numbers');
        assert.strictEqual(people.ready, people.total);
        assert.deepStrictEqual([numbers.ready, numbers.queued, numbers.total], [0, 2, 2]);
        current.annoncement_include_matchnumber = false;
        const disabled = [];
        await idlePlan(current, [], [], [], (stage, values, detail) => {
            if (stage === 'tablet' && detail.tablet_phase === 'numbers') disabled.push(...values);
        });
        assert.deepStrictEqual(disabled, []);
        b.stop();
    });

    it('orders completed disciplines by next or first game and transfers every present name variant out of registration', async function() {
        const current = { ...tournament(), speech: { context_version: 'bts-context-v2' }, tabletoperator_enabled: false,
            registration_completed_events: {}, registration_player_statuses: {}, events: { events: [] } };
        for (const [index, id] of ['unknown', 'later', 'first', 'early', 'tie'].entries()) {
            current.registration_completed_events[id] = true;
            const players = [{ btp_id: id + '-1', name: 'Max Mustermann ' + id, state: 'Musterverband ' + id, club: 'Musterverein ' + id },
                { btp_id: id + '-2', name: 'Hans Dampf ' + id, state: 'Musterverband ' + id, club: 'Musterverein ' + id }];
            current.events.events.push({ id, name: id, stages: [{ id: id + '-stage', entries: [
                { entry_id: id, team: { players } },
                { entry_id: id + '-absent', team: { players: [{ name: 'Abwesende Musterperson ' + id, state: 'Abwesender Verband', club: 'Abwesender Verein' }] } },
            ] }], ...(id === 'first' || id === 'tie' ? { first_planned_match: { number: 25,
                date: '2026-09-26', time: '10:00', order: 2 } } : {}), btp: index });
            for (const player of players) current.registration_player_statuses[id + ':' + player.btp_id] = { status: 'present' };
            current.registration_player_statuses[id + '-absent:0'] = { status: 'absent' };
            if (['early', 'later'].includes(id)) {
                const event = current.events.events.at(-1);
                event.stages.push({ stage_type: 9999, entries: [event.stages[0].entries.pop()] });
            }
        }
        const matches = ['early', 'later'].map(id => game(id, 'scheduled', { stage_id: id + '-stage', event_name: id,
            court_id: null, tabletoperators: null, umpire: null, service_judge: null, scheduled_date: '2026-09-26',
            scheduled_time_str: id === 'early' ? '09:00' : '11:00', teams: [current.events.events.find(event => event.id === id).stages[0].entries[0].team, { players: [] }] }));
        const stages = [], b = broker(); b.context_version = 'bts-context-v2';
        const required = requiredPlan(current, matches), model = new PlanningStatus(current, matches, required);
        const parts = await idlePlan(current, matches, [], [], (stage, parts, detail) => {
            model.add(stage, parts, detail);
            if (stage === 'tablet') stages.push([detail.tablet_event.id, detail.tablet_phase]);
        });
        const compact = stages.filter((row, index) => !index || row.join(':') !== stages[index - 1].join(':'));
        const expected = ['early', 'first', 'tie', 'later', 'unknown'];
        assert.deepStrictEqual(compact, expected.flatMap(id => ['states', 'clubs', 'people', 'numbers'].map(phase => [id, phase])));
        assert(![...model.registration_trace.parts.values()].some(reason => current.registration_completed_events[reason.event_id]),
            'completed disciplines must not own any registration preparation');
        const contextPlan = require('../static/js/speech_context'), { renderer } = require('../bts/speech/text');
        const texts = renderer(current, 'de', []);
        for (const event of current.events.events) {
            const players = event.stages[0].entries[0].team.players, covered = model.tablet_events.get(event.id).parts;
            for (const group of [...players.map(player => [player]), players]) {
                for (const part of contextPlan(texts, current, 'prepareName', { players: group }).parts) assert(covered.has(part));
            }
            assert(![...covered].some(part => part.includes('Abwesend')));
        }
        b.set_prefetch_order(key, parts, settings);
        for (let index = 0; index < parts.length; index += 64) b.prepare(parts.slice(index, index + 64), { voice, priority: 'normal', prefetch: true }, key);
        const snapshot = model.snapshot(b, key, settings);
        assert.deepStrictEqual(snapshot.tablet_progress.map(row => row.id), expected);
        assert.strictEqual(snapshot.tablet_progress[1].first_game.number, 25);
        assert.strictEqual(snapshot.tablet_progress[0].next_game.time, '2026-09-26 09:00');
        assert(snapshot.tablet_progress.every(row => row.counts.state === 1 && row.counts.club === 1 &&
            row.counts.player === 2 && row.counts.pair === 1 && row.counts.team === 1),
        'live discipline metadata counts present players and complete teams once across roster and scheduled games');
        const firstReason = [...model.explanations(b, key, settings).values()].find(why => why.stage === 'tablet' && why.event_id === 'first');
        assert(firstReason.reason.includes('Erstes angesetztes Spiel 25') && firstReason.reason.includes('2026-09-26'));
        const explanations = model.explanations(b, key, settings);
        const sourceOrder = b.pending_order().map(entry => explanations.get(entry.key))
            .filter(why => why?.stage === 'tablet').map(why => expected.indexOf(why.event_id));
        assert(sourceOrder.every((position, index) => !index || position >= sourceOrder[index - 1]), 'the actual queue retains discipline priority');
        current.events.events.find(event => event.id === 'first').first_planned_match.time = '08:00';
        const reordered = [];
        const moved = await idlePlan(current, matches, [], [], (stage, values, detail) => { if (stage === 'tablet') reordered.push(detail.tablet_event.id); });
        assert.strictEqual(reordered[0], 'first');
        assert.deepStrictEqual(new Set(moved), new Set(parts), 'schedule changes reuse the same recordings');
        current.events.events.find(event => event.id === 'first').first_planned_match.time = '10:00';
        const later = matches.find(match => match._id === 'later');
        matches.push({ ...later, _id: 'later-candidate', setup: { ...later.setup, match_num: 29, scheduled_time_str: '08:30' } });
        const next = new PlanningStatus(current, matches, requiredPlan(current, matches));
        await idlePlan(current, matches, [], ['later-candidate'], (stage, parts, detail) => next.add(stage, parts, detail));
        const ordered = next.snapshot(b, key, settings).tablet_progress;
        assert.strictEqual(ordered[0].id, 'later', 'an earlier candidate still defines the next game of a discipline with later scheduled games');
        assert.strictEqual(ordered[0].next_game.number, 29);
    });

    it('explains unopened registrations and excludes completed disciplines from registration preparation', async function() {
        const current = registrationTournament(), b = broker(); b.context_version = 'bts-context-v2';
        const duplicate = structuredClone(current.events.events.find(event => event.id === 'closed'));
        duplicate.id = 'second-closed'; duplicate.name = 'Zweite spätere Disziplin';
        current.events.events.push(duplicate);
        const required = await registrationPlan(current), model = required.model;
        b.set_prefetch_order(key, required.registration, settings);
        for (let i = 0; i < required.registration.length; i += 64) b.prepare(required.registration.slice(i, i + 64), { voice, priority: 'normal', prefetch: true }, key);
        const snapshot = model.snapshot(b, key, settings);
        const closed = snapshot.registration_progress.filter(phase => phase.id.startsWith('closed_'));
        assert.deepStrictEqual(closed.map(phase => phase.id), ['closed_states', 'closed_clubs', 'closed_people', 'closed_numbers']);
        assert(closed.every(phase => phase.events.length === 2 && phase.events.every(event => event.total === phase.total)));
        const all = new Set(['closed_states', 'closed_clubs', 'closed_people', 'closed_numbers'].flatMap(phase =>
            [...required.registration_trace.groups.get(phase).values()].flatMap(parts => [...parts])));
        const area = snapshot.registration_groups.find(area => area.id === 'closed');
        assert.deepStrictEqual([area.ready, area.queued, area.total], [0, all.size, all.size]);
        assert(!snapshot.registration_progress.some(phase => phase.id === 'completed_teams'));
        assert(![...required.registration_trace.parts.values()].some(part => part.event_id === 'complete'));
        const [part] = [...required.registration_trace.parts].find(([, reason]) => reason.registration_phase === 'closed_clubs');
        const clip = b.entries.get(b.key(part, voice, 'de-DE'));
        const explanation = model.explanations(b, key, settings).get(clip.source_key);
        assert.strictEqual(explanation.registration_phase, 'closed_clubs');
        assert(explanation.reason.includes('2. Vereine aller noch nicht geöffneten Anmeldungen'));
        assert(explanation.reason.includes('Spätere Disziplin (Anmeldung nicht geöffnet)'));
        for (const part of all) b.entries.get(b.key(part, voice, 'de-DE')).status = 'completed';
        const done = model.snapshot(b, key, settings).registration_groups.find(area => area.id === 'closed');
        assert.deepStrictEqual([done.ready, done.queued, done.total], [all.size, 0, all.size]);
    });

    it('moves a later open discipline\'s clubs ahead of already admitted players and explains the new queue phase', async function() {
        const current = registrationTournament(), b = broker(); b.context_version = 'bts-context-v2';
        let now = 1000; b.now = () => now;
        const prepare = parts => {
            for (let i = 0; i < parts.length; i += 64) b.prepare(parts.slice(i, i + 64), { voice, priority: 'normal', prefetch: true }, key);
        };
        const previous = await registrationPlan(current);
        b.set_prefetch_order(key, previous.registration, settings); prepare(previous.registration);
        now += 1000;
        current.registration_open_events.second = true;
        current.events.events.push({ id: 'second', name: 'Zweite offene Disziplin', stages: [{ entries: [{ entry_id: 'second',
            team: { players: [{ name: 'Weitere Musterperson', state: 'Zweiter Verband', club: 'Zweiter Verein' }] },
        }] }] });
        const next = await registrationPlan(current), model = next.model;
        b.set_prefetch_order(key, next.registration, settings); prepare(next.registration);
        const source = (kind, event) => {
            const [part] = [...next.registration_trace.parts].find(([, value]) => value.kind === kind && value.event_id === event);
            return b.entries.get(b.entries.get(b.key(part, voice, 'de-DE')).source_key);
        };
        const player = source('player', 'open'), club = source('club', 'second');
        assert(player.created < club.created, 'the player was queued before the second discipline existed');
        const order = b.pending_order();
        assert(order.indexOf(club) >= 0 && order.indexOf(club) < order.indexOf(player));
        const queue = model.annotate_queue(b.queue(key, voice, { pending_only: true }), b, key, settings);
        const explanation = queue.items.find(item => item.key === club.key).planning;
        assert.strictEqual(explanation.event_order, 2);
        assert.strictEqual(explanation.registration_phase, 'open_clubs');
        assert(explanation.reason.includes('Vereine aller offenen Anmeldungen'));
    });

    it('retains registration provenance in idle work after the first draw', async function() {
        const current = registrationTournament(), matches = [game('drawn', 'scheduled')], b = broker();
        b.context_version = 'bts-context-v2';
        const model = new PlanningStatus(current, matches, requiredPlan(current, matches));
        await idlePlan(current, matches, [], [], (stage, parts, detail) => model.add(stage, parts, detail));
        const [part] = [...model.registration_trace.parts].find(([, value]) => value.kind === 'club' && value.event_id === 'open');
        b.prepare([part], { voice, priority: 'idle', prefetch: true }, key);
        const clip = b.entries.get(b.key(part, voice, 'de-DE'));
        const queue = model.annotate_queue(b.queue(key, voice, { pending_only: true }), b, key, settings);
        assert.strictEqual(queue.items.find(item => item.key === clip.source_key).planning.stage, 'registration_reserve');
        assert.strictEqual(model.snapshot(b, key, settings).phase, 'competition');
    });

    it('retains known work and readiness while the tournament plan refreshes in the background', function() {
        const b = broker(), prefetch = new Prefetcher({}, b), model = new PlanningStatus(tournament(), [], required());
        prefetch.subscriptions.set(key, settings);
        b.pending_plans.add(key);
        assert.strictEqual(prefetch.planning_status(key).state, 'updating');
        assert.strictEqual(prefetch.planning_status(key).phase, 'unknown');
        model.parts.clear(); model.add('shared', ['Feldansage']);
        prefetch.planning.set(key, model);
        b.prepare(['Feldansage'], { voice, priority: 'normal', prefetch: true }, key);
        const entry = b.entries.get(b.key('Feldansage', voice, 'de-DE'));
        const queued = prefetch.planning_status(key);
        assert.strictEqual(queued.updating, true);
        assert.strictEqual(queued.state, 'waiting');
        assert.strictEqual(queued.active_stage, 'shared');
        entry.status = 'processing'; b.current = { entry, request: { voice } };
        const running = prefetch.planning_status(key);
        assert.strictEqual(running.updating, true);
        assert.strictEqual(running.state, 'working');
        assert.strictEqual(running.current.running, true);
        assert.strictEqual(running.active_stage, queued.active_stage);
        b.current = null; entry.status = 'completed';
        const complete = prefetch.planning_status(key);
        assert.strictEqual(complete.state, 'complete');
        assert.strictEqual(complete.updating, true);
        assert.deepStrictEqual([complete.total.ready, complete.total.total], [1, 1]);
        b.pending_plans.delete(key);
        assert.strictEqual(prefetch.planning_status(key).updating, false);
    });

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

    it('recognizes a helper as current work even while the local server serves a different tournament', function() {
        const b = broker(), model = new PlanningStatus(tournament(), [], required());
        b.context_version = 'bts-context-v2';
        const part = '~bts-context-v2~' + JSON.stringify({ before: 'Vorher. ', text: 'Ausschnitt', after: '. Nachher.', kind: 'generic' });
        model.parts.clear(); model.add('preparation', [part]);
        b.prepare([part], { voice, priority: 'normal', prefetch: true }, key);
        const clip = b.entries.get(b.key(part, voice, 'de-DE')), source = b.entries.get(clip.source_key);
        source.status = 'processing';
        b.helpers = { execution: entry => entry === source ? { kind: 'helper', name: 'Testhost', phase: 'synthesis', running: true } : null };
        b.current = { entry: { tournaments: new Set(['elsewhere']) } };
        const snapshot = model.snapshot(b, key, settings);
        assert.strictEqual(snapshot.state, 'working'); assert.strictEqual(snapshot.running_count, 1);
        assert.strictEqual(snapshot.current.execution.name, 'Testhost');
        assert.strictEqual(snapshot.active_stage, 'preparation');
        assert.strictEqual(b.queue(key).items[0].current, true);
        assert.strictEqual(b.queue(key).busy_elsewhere, true);
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
        const current = { ...registrationTournament(), tabletoperator_enabled: true };
        const matches = [game('field', 'oncourt', { called_timestamp: 100, match_num: 10 }), game('prep', 'preparation', { match_num: 20 }),
            game('future', 'scheduled', { match_num: 30 }), game('candidate', 'scheduled', { match_num: 40 })];
        const model = new PlanningStatus(current, matches, requiredPlan(current, matches), ['candidate']);
        const recorded = [];
        const annotated = await idlePlan(current, matches, [], ['candidate'], (stage, parts) => {
            recorded.push(stage); model.add(stage, parts);
        });
        assert.deepStrictEqual(annotated, await idlePlan(current, matches, [], ['candidate']));
        assert(recorded.indexOf('oncourt') < recorded.indexOf('preparation'));
        assert(recorded.indexOf('preparation') < recorded.indexOf('candidate'));
        assert(recorded.indexOf('candidate') < recorded.indexOf('planned'));
        assert(recorded.indexOf('planned') < recorded.indexOf('tablet'));
        assert(recorded.lastIndexOf('tablet') < recorded.indexOf('registration_reserve'));
        assert.strictEqual(recorded.filter(stage => stage === 'registration_reserve').length, 1);
        assert(annotated.every(part => model.parts.has(part)));
        const order = annotated.map(part => model.parts.get(part));
        assert(order.includes('candidate') && order.includes('registration_reserve') && order.includes('planned'));
        assert(order.lastIndexOf('candidate') < order.indexOf('planned'), 'prepare call candidates before other scheduled games');
        assert(order.lastIndexOf('planned') < order.indexOf('registration_reserve'), 'prepare other scheduled games before later disciplines');
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
