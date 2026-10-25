'use strict';

const { isOpen, tier } = require('./planning');
const { firstDrawn } = require('./v2_inventory');
const { _translate: translate } = require('../../static/js/ci18n');

const STAGES = [
    ['urgent', 'Ausgelöste Durchsagen', 'urgent-priority'],
    ['test', 'Sprachtest und angeforderte Texte', 'speech-test-priority'],
    ['shared', 'Spielorte, Felder und gemeinsame Bausteine', 'location-field-priority'],
    ['officials', 'Technische Offizielle', 'officials-priority'],
    ['tablet_waiting', 'Wartende Tabletbediener', 'likely-tablet-priority'],
    ['oncourt', 'Laufende Spiele', 'running-priority'],
    ['preparation', 'Spiele in Vorbereitung', 'preparation-priority'],
    ['candidate', 'Aufrufkandidaten', 'candidate-priority'],
    ['planned', 'Weitere angesetzte Spiele', 'planned-priority'],
    ['tablet', 'Vorbereitung angemeldeter Disziplinen', 'tablet-priority'],
    ['registration', 'Anmeldevorarbeit', 'registration-priority'],
    ['registration_reserve', 'Anmeldevorarbeit', 'registration-priority'],
    ['people', 'Übrige Personen und Teams', 'people-priority'],
    ['spare', 'Andere Stimme auf Vorrat', 'other-voice-priority'],
    ['additional', 'Weitere angeforderte Aufgaben', null],
];
const REGISTRATION_KINDS = { common: 'Gemeinsame Anmeldetexte', state: 'Landesverband', club: 'Verein',
    player: 'Spieler', pair: 'Paarung', team: 'Namensvarianten', number: 'Spielnummer der ersten Runde' };
const EVENT_STATES = { open: 'Anmeldung geöffnet', completed: 'Anmeldung abgeschlossen', closed: 'Anmeldung nicht geöffnet', drawn: 'ausgelost – übersprungen' };
const REGISTRATION_PHASES = { open_states: '1. Landesverbände aller offenen Anmeldungen',
    open_clubs: '2. Vereine aller offenen Anmeldungen', open_people: '3a. Spieler/Paarungen je offener Anmeldung',
    open_numbers: '3b. Spielnummern der ersten Runde nach den Spielern derselben offenen Anmeldung',
    closed_states: '1. Landesverbände aller noch nicht geöffneten Anmeldungen',
    closed_clubs: '2. Vereine aller noch nicht geöffneten Anmeldungen',
    closed_people: '3a. Spieler/Paarungen je noch nicht geöffneter Anmeldung',
    closed_numbers: '3b. Spielnummern der ersten Runde nach den Spielern derselben noch nicht geöffneten Anmeldung' };
const REGISTRATION_AREAS = { open: ['open_states', 'open_clubs', 'open_people', 'open_numbers'],
    closed: ['closed_states', 'closed_clubs', 'closed_people', 'closed_numbers'] };
const TABLET_PHASES = { states: '1. Landesverbände', clubs: '2. Vereine', people: '3. Spieler/Paarungen',
    numbers: '4. Spielnummern · 1. Runde' };

class PlanningStatus {
    constructor(tournament, matches, required, preferred = []) {
        this.title = tournament.name || tournament.key;
        this.drawn = firstDrawn(tournament, matches);
        this.has_officials = required.has_officials;
        this.parts = new Map();
        this.registration_trace = required.registration_trace || {};
        this.tablet_events = new Map();
        this.tablet_phases = new Map(Object.keys(TABLET_PHASES).map(id => [id, new Map()]));
        this.tablet_reasons = new Map();
        this.key_cache = null;
        this.games = { planned: 0, candidate: 0, preparation: 0, oncourt: 0, finished: 0 };
        const candidates = new Set(preferred);
        for (const match of matches) {
            if (!match.setup || match.setup.is_match === false) continue;
            const state = isOpen(match) ? ['oncourt', 'preparation', 'candidate', 'planned'][tier(match, candidates)] : 'finished';
            this.games[state]++;
        }
        this.add('test', [translate('de', 'announcements:speechcheck:text')]);
        this.add('shared', required.shared);
        this.add('officials', required.officials || []);
        this.add('tablet_waiting', required.tablet_waiting || []);
        for (const { match, parts } of required.games.values()) this.add(tier(match) === 0 ? 'oncourt' : 'preparation', parts);
    }

    add(stage, parts, detail) {
        for (const part of parts) if (!this.parts.has(part)) this.parts.set(part, stage);
        if (detail?.parts instanceof Map) this.registration_trace = detail;
        if (stage === 'tablet' && detail?.tablet_event) {
            const info = detail.tablet_event;
            if (!this.tablet_events.has(info.id)) this.tablet_events.set(info.id, { ...info, order: this.tablet_events.size + 1, parts: new Set() });
            const event = this.tablet_events.get(info.id);
            const phase = detail.tablet_phase || 'people', groups = this.tablet_phases.get(phase);
            if (!groups.has(info.id)) groups.set(info.id, new Set());
            for (const part of parts) {
                event.parts.add(part);
                groups.get(info.id).add(part);
                if (!this.tablet_reasons.has(part)) this.tablet_reasons.set(part, { event_id: event.id, event_name: event.name,
                    event_order: event.order, tablet_phase: phase, next_game: detail.tablet_game || info.next_game, first_game: info.first_game,
                    plan_order: this.tablet_reasons.size });
            }
        }
        this.key_cache = null;
    }

    keyed(broker, voice) {
        if (this.key_cache?.voice === voice) return this.key_cache;
        const stages = new Map(), reasons = new Map(), registration = new Map();
        for (const [part, stage] of this.parts) stages.set(broker.key(part, voice, 'de-DE'), stage);
        for (const [part, reason] of this.registration_trace.parts || []) reasons.set(broker.key(part, voice, 'de-DE'), reason);
        for (const [part, reason] of this.tablet_reasons) if (this.parts.get(part) === 'tablet') reasons.set(broker.key(part, voice, 'de-DE'), reason);
        for (const [phase, groups] of this.registration_trace.groups || []) {
            const events = new Map(), all = new Set();
            for (const [id, parts] of groups) {
                const keys = new Set([...parts].map(part => broker.key(part, voice, 'de-DE')));
                for (const key of keys) all.add(key);
                if (id !== null) events.set(id, keys);
            }
            registration.set(phase, { keys: all, events });
        }
        const areas = new Map(Object.entries(REGISTRATION_AREAS).map(([id, phases]) => [id,
            new Set(phases.flatMap(phase => [...(registration.get(phase)?.keys || [])]))]));
        const tablet = [...this.tablet_events.values()].map(({ parts, ...event }) => ({ ...event,
            keys: new Set([...parts].map(part => broker.key(part, voice, 'de-DE'))) }));
        const tablet_phases = [...this.tablet_phases].map(([id, groups]) => {
            const events = tablet.map(event => ({ ...event,
                keys: new Set([...(groups.get(event.id) || [])].map(part => broker.key(part, voice, 'de-DE'))) }));
            return { id, label: TABLET_PHASES[id], events, keys: new Set(events.flatMap(event => [...event.keys])) };
        });
        return this.key_cache = { voice, stages, reasons, registration, areas, tablet, tablet_phases };
    }

    explanations(broker, key, settings) {
        const { stages, reasons } = this.keyed(broker, settings.voice), values = new Map();
        const entries = [...broker.entries.values()].filter(entry => entry.tournaments.has(key));
        for (const entry of entries) {
            const stage = entry.priority === 0 ? 'urgent' : entry.priority === 2 ? 'test' :
                entry.spare_tournaments?.has(key) && !entry.prefetch_tournaments?.has(key) ? 'spare' : stages.get(entry.key);
            if (stage) values.set(entry.key, { stage, ...(reasons.get(entry.key) || {}) });
        }
        const rank = value => STAGES.findIndex(([id]) => id === value.stage);
        // Raw sources inherit the first still-needed consumer. A source may be
        // shared across disciplines; its literal example text is not its cause.
        for (const entry of entries) {
            if (entry.status === 'completed' && !entry.revalidate) continue;
            const value = values.get(entry.key);
            if (!value) continue;
            let dependency = entry;
            const visited = new Set();
            while (dependency?.source_key && !visited.has(dependency.source_key)) {
                visited.add(dependency.source_key);
                const previous = values.get(dependency.source_key);
                if (!previous || rank(value) < rank(previous) || rank(value) === rank(previous) &&
                    (value.plan_order ?? Infinity) < (previous.plan_order ?? Infinity)) {
                    values.set(dependency.source_key, { ...value, source_dependency: true });
                }
                dependency = broker.entries.get(dependency.source_key);
            }
        }
        for (const value of values.values()) {
            const label = STAGES.find(([id]) => id === value.stage)?.[1] || 'Zusätzlicher Bedarf';
            const path = [label];
            if (['registration', 'registration_reserve'].includes(value.stage) && value.kind) {
                if (REGISTRATION_PHASES[value.registration_phase]) path.push(REGISTRATION_PHASES[value.registration_phase]);
                if (value.event_name) path.push('Disziplin ' + value.event_order + ': ' + value.event_name + ' (' + EVENT_STATES[value.event_state] + ')');
                if (value.first_game) path.push('Spielplan: Spiel ' + value.first_game.number +
                    (value.first_game.date ? ' · ' + value.first_game.date : '') + (value.first_game.time ? ' ' + value.first_game.time : ''));
                path.push(REGISTRATION_KINDS[value.kind] + (value.kind === 'common' ? '' : ' ' + value.label_order + ': ' + value.label));
            }
            if (value.stage === 'tablet' && value.event_name) {
                path.push('Disziplin ' + value.event_order + ': ' + value.event_name);
                if (TABLET_PHASES[value.tablet_phase]) path.push(TABLET_PHASES[value.tablet_phase]);
                const game = value.next_game || value.first_game;
                path.push(game ? (value.next_game ? 'Nächstes Spiel' : 'Erstes angesetztes Spiel') + (game.number != null ? ' ' + game.number : '') +
                    (game.date ? ' · ' + game.date : '') + (game.time ? ' · ' + game.time : '') : 'Ohne bekannte Spielplanung');
            }
            value.reason = path.join(' → ') + (value.source_dependency ? ' · Quellaufnahme vor dem benötigten Ausschnitt.' : '');
        }
        return values;
    }

    annotate_queue(queue, broker, key, settings) {
        const explanations = this.explanations(broker, key, settings);
        for (const item of queue.items) {
            const value = explanations.get(item.key);
            if (value) item.planning = value;
        }
        return queue;
    }

    snapshot(broker, key, settings, updating) {
        const rows = new Map(STAGES.map(([id, label, node]) => [id, { id, label, node, total: 0, ready: 0, queued: 0, failed: 0, active: false }]));
        const keyed = this.keyed(broker, settings.voice), keys = new Map(keyed.stages);
        const spare = broker.spare_plans.get(key);
        if (settings.warm_other_voice && spare) for (const part of spare.parts) keys.set(broker.key(part, spare.voice, 'de-DE'), 'spare');
        const entries = [...broker.entries.values()].filter(entry => entry.tournaments.has(key));
        const classify = entry => entry.spare_tournaments?.has(key) && !entry.prefetch_tournaments?.has(key) ? 'spare' :
            entry.priority === 0 ? 'urgent' : entry.priority === 2 ? 'test' : keys.get(entry.key) || 'additional';
        for (const entry of entries) if (entry.context?.kind !== 'source') {
            if (entry.voice === settings.voice || classify(entry) === 'spare') keys.set(entry.key, classify(entry));
        }
        // The same component can serve several disciplines and phases. Inspect
        // its availability once, then reuse that result in each progress row.
        const availability = new Map();
        const progress = partKey => {
            if (availability.has(partKey)) return availability.get(partKey);
            const entry = broker.entries.get(partKey);
            const saved = broker.disk?.lookup(broker.identity, partKey);
            const ready = !!(saved || entry?.status === 'completed' && (!entry.local || broker.disk?.file(entry.audio_id)));
            const owned = !ready && entry?.tournaments.has(key);
            const value = { ready: Number(ready), queued: Number(!!owned && !entry.terminal_failure && ['unsubmitted', 'queued', 'processing', 'failed'].includes(entry.status)),
                failed: Number(!!owned && entry.status === 'failed') };
            availability.set(partKey, value); return value;
        };
        const count = partKeys => {
            const row = { ready: 0, queued: 0, failed: 0, total: partKeys.size };
            for (const partKey of partKeys) {
                const value = progress(partKey);
                for (const field of ['ready', 'queued', 'failed']) row[field] += value[field];
            }
            return row;
        };
        for (const [partKey, stage] of keys) {
            const row = rows.get(stage), value = progress(partKey);
            row.total++;
            for (const field of ['ready', 'queued', 'failed']) row[field] += value[field];
        }
        const registration_progress = [...keyed.registration].map(([id, group]) => ({ id, ...count(group.keys),
            events: [...group.events].map(([id, keys]) => ({ id, ...count(keys) })) }));
        const registration_groups = [...keyed.areas].map(([id, keys]) => ({ id, ...count(keys) }));
        const tablet_progress = keyed.tablet.map(({ keys, ...event }) => ({ ...event, ...count(keys),
            phases: keyed.tablet_phases.map(phase => ({ id: phase.id, label: phase.label,
                ...count(phase.events.find(row => row.id === event.id).keys) })) }));
        const tablet_phases = keyed.tablet_phases.map(({ keys, events, ...phase }) => ({ ...phase, ...count(keys),
            events: events.map(({ keys, ...event }) => ({ ...event, ...count(keys) })) }));
        const running = broker.active_entries(), ownRunning = running.filter(entry => entry.tournaments.has(key));
        const ownCurrent = ownRunning.length > 0;
        const active = ownRunning[0] || broker.pending_order().find(entry => entry.tournaments.has(key));
        let activeStage = null;
        if (active) {
            const consumers = entries.filter(entry => entry.source_key === active.key);
            const stages = consumers.length ? consumers.map(classify) : [classify(active)];
            activeStage = STAGES.find(([id]) => stages.includes(id))?.[0] || 'additional';
            rows.get(activeStage).active = true;
        }
        const stages = [...rows.values()].filter(row => row.total || row.active || !['additional', 'spare'].includes(row.id) || settings.warm_other_voice);
        const total = stages.reduce((sum, row) => ({ ready: sum.ready + row.ready, queued: sum.queued + row.queued,
            total: sum.total + row.total, failed: sum.failed + row.failed }), { ready: 0, queued: 0, total: 0, failed: 0 });
        const enabled = broker.config.enabled && settings.mode !== 'browser';
        if (!enabled) for (const row of stages) row.active = false;
        const explanation = active ? this.explanations(broker, key, settings).get(active.key) : null;
        return { title: this.title, voice: settings.voice, mode: settings.mode,
            phase: this.drawn ? 'competition' : 'registration', has_officials: this.has_officials, games: this.games, stages, total,
            updating: !!updating,
            state: !enabled ? 'disabled' : ownCurrent ? 'working' : running.length ? 'busy_elsewhere' : active ? 'waiting' :
                total.failed ? 'failed' : total.ready < total.total ? 'idle_pending' : 'complete',
            active_stage: enabled ? activeStage : null,
            running_count: enabled ? ownRunning.length : 0,
            registration_order: this.registration_trace.events || [],
            registration_progress, registration_groups, tablet_progress, tablet_phases,
            current: enabled && active ? { text: active.text, status: active.status, running: !!ownCurrent,
                execution: broker.execution(active),
                ...(explanation ? { planning: explanation } : {}),
                retry_at: broker.display_retry_at(active) } : null,
            updated_at: broker.now() };
    }
}

module.exports = { PlanningStatus, STAGES };
