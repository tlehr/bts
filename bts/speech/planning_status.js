'use strict';

const { isOpen, tier } = require('./planning');
const { firstDrawn } = require('./v2_inventory');
const { _translate: translate } = require('../../static/js/ci18n');

const STAGES = [
    ['urgent', 'Ausgelöste Durchsagen', 'urgent-priority'],
    ['test', 'Sprachtest und angeforderte Texte', 'speech-test-priority'],
    ['shared', 'Spielorte, Felder und gemeinsame Bausteine', 'location-field-priority'],
    ['registration', 'Anmeldevorarbeit vor der ersten Auslosung', 'registration-priority'],
    ['oncourt', 'Laufende Spiele', 'running-priority'],
    ['preparation', 'Spiele in Vorbereitung', 'preparation-priority'],
    ['officials', 'Technische Offizielle', 'officials-priority'],
    ['candidate', 'Aufrufkandidaten', 'candidate-priority'],
    ['tablet_waiting', 'Wartende Tabletbediener', 'likely-tablet-priority'],
    ['planned', 'Weitere angesetzte Spiele', 'planned-priority'],
    ['registration_reserve', 'Weitere Disziplinen und Auslosungen', 'draws-priority'],
    ['tablet', 'Zusätzlicher Tablet-Vorrat', 'tablet-priority'],
    ['people', 'Übrige Personen und Teams', 'people-priority'],
    ['spare', 'Andere Stimme auf Vorrat', 'other-voice-priority'],
    ['additional', 'Weitere angeforderte Aufgaben', null],
];

class PlanningStatus {
    constructor(tournament, matches, required, preferred = []) {
        this.title = tournament.name || tournament.key;
        this.drawn = firstDrawn(tournament, matches);
        this.parts = new Map();
        this.games = { planned: 0, candidate: 0, preparation: 0, oncourt: 0, finished: 0 };
        const candidates = new Set(preferred);
        for (const match of matches) {
            if (!match.setup || match.setup.is_match === false) continue;
            const state = isOpen(match) ? ['oncourt', 'preparation', 'candidate', 'planned'][tier(match, candidates)] : 'finished';
            this.games[state]++;
        }
        this.add('test', [translate('de', 'announcements:speechcheck:text')]);
        this.add('shared', required.shared);
        this.add('registration', required.registration || []);
        for (const { match, parts } of required.games.values()) this.add(tier(match) === 0 ? 'oncourt' : 'preparation', parts);
        this.add('officials', required.officials || []);
    }

    add(stage, parts) {
        for (const part of parts) if (!this.parts.has(part)) this.parts.set(part, stage);
    }

    snapshot(broker, key, settings, updating) {
        const rows = new Map(STAGES.map(([id, label, node]) => [id, { id, label, node, total: 0, ready: 0, queued: 0, failed: 0, active: false }]));
        const keys = new Map();
        for (const [part, stage] of this.parts) keys.set(broker.key(part, settings.voice, 'de-DE'), stage);
        const spare = broker.spare_plans.get(key);
        if (settings.warm_other_voice && spare) for (const part of spare.parts) keys.set(broker.key(part, spare.voice, 'de-DE'), 'spare');
        const entries = [...broker.entries.values()].filter(entry => entry.tournaments.has(key));
        const classify = entry => entry.spare_tournaments?.has(key) && !entry.prefetch_tournaments?.has(key) ? 'spare' :
            entry.priority === 0 ? 'urgent' : entry.priority === 2 ? 'test' : keys.get(entry.key) || 'additional';
        for (const entry of entries) if (entry.context?.kind !== 'source') {
            if (entry.voice === settings.voice || classify(entry) === 'spare') keys.set(entry.key, classify(entry));
        }
        for (const [partKey, stage] of keys) {
            const entry = broker.entries.get(partKey), row = rows.get(stage);
            const saved = broker.disk?.lookup(broker.identity, partKey);
            row.total++;
            if (saved || entry?.status === 'completed' && (!entry.local || broker.disk?.file(entry.audio_id))) row.ready++;
            else if (entry?.tournaments.has(key)) {
                if (!entry.terminal_failure && ['unsubmitted', 'queued', 'processing', 'failed'].includes(entry.status)) row.queued++;
                if (entry.status === 'failed') row.failed++;
            }
        }
        const current = broker.current?.entry;
        const ownCurrent = current?.tournaments.has(key);
        const active = ownCurrent ? current : broker.pending_order().find(entry => entry.tournaments.has(key));
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
        return { title: this.title, voice: settings.voice, mode: settings.mode,
            phase: this.drawn ? 'competition' : 'registration', games: this.games, stages, total,
            updating: !!updating,
            state: !enabled ? 'disabled' : ownCurrent ? 'working' : current ? 'busy_elsewhere' : active ? 'waiting' :
                total.failed ? 'failed' : total.ready < total.total ? 'idle_pending' : 'complete',
            active_stage: enabled ? activeStage : null,
            current: enabled && active ? { text: active.text, status: active.status, running: !!ownCurrent,
                retry_at: Math.max(active.retry_at || 0, active.server_retry_at || 0, broker.post_retry_at || 0) } : null,
            updated_at: broker.now() };
    }
}

module.exports = { PlanningStatus, STAGES };
