'use strict';

const { prepare } = require('./text');
const reads = require('../preparation_selection/model_reads');
const resolveSettings = require('../../static/js/speech_settings');
const EVENTS = new Set([
    'match_edit', 'match_added', 'match_delete', 'match_preparation_call', 'match_called_on_court',
    'court_current_match', 'match_finished', 'matches_changed', 'prop_changed',
    'location_changed', 'locations_changed', 'court_changed', 'courts_changed',
    'normalization_add', 'normalization_remove', 'normalizations_changed', 'props',
    'umpire_updated', 'umpires_changed', 'tabletoperator_updated', 'tabletoperator_add',
]);

function read_normalizations(db) {
    return new Promise((resolve, reject) => db.normalizations.find({}, (error, values) =>
        error ? reject(error) : resolve(values)));
}

function upcoming(matches, limit, preferred_ids = []) {
    const preferred = new Set(preferred_ids);
    return matches.filter(match => ['preparation', 'scheduled', 'oncourt', 'ready'].includes(match.setup?.state))
        .sort((a, b) => {
            const rank = match => preferred.has(match._id) ? 0 : match.setup.state === 'preparation' ? 1 :
                match.setup.state === 'oncourt' ? 3 : 2;
            return rank(a) - rank(b) ||
                Number(a.setup.match_num || 0) - Number(b.setup.match_num || 0) ||
                String(a._id).localeCompare(String(b._id));
        }).filter(match => {
            // Active/prepared games and real call candidates must not be lost
            // because a different hall filled the scheduled-game horizon.
            if (preferred.has(match._id) || ['preparation', 'oncourt'].includes(match.setup.state)) return true;
            return limit-- > 0;
        });
}

class Prefetcher {
    constructor(app, broker) {
        this.app = app;
        this.broker = broker;
        this.subscriptions = new Map();
        this.timers = new Map();
        this.running = new Set();
        this.dirty = new Set();
        this.preferred = new Map();
        this.interval = null;
    }

    settings(key) {
        return this.subscriptions.get(key) || resolveSettings({}, this.broker.config);
    }

    configure(tournament, schedule = true) {
        const selected = resolveSettings(tournament, this.broker.config);
        const previous = this.subscriptions.get(tournament.key);
        if (previous?.voice === selected.voice && previous?.mode === selected.mode) return;
        this.subscriptions.set(tournament.key, selected);
        this.broker.select_voice(tournament.key, selected.mode === 'browser' ? null : selected.voice);
        if (schedule) this.schedule(tournament.key);
    }

    subscribe(key, tournament = {}) {
        if (!this.broker.config.enabled || this.subscriptions.size >= 128 && !this.subscriptions.has(key)) return;
        if (!this.subscriptions.has(key)) this.configure({ ...tournament, key }, false);
        this.schedule(key);
    }

    schedule(key, candidates) {
        if (!this.broker.config.enabled || !this.subscriptions.has(key)) return;
        if (candidates) this.preferred.set(key, candidates.slice(0, this.broker.config.max_entries));
        if (this.running.has(key)) { this.dirty.add(key); return; }
        if (this.timers.has(key)) return;
        const timer = setTimeout(() => {
            this.timers.delete(key);
            void this.refresh(key).catch(() => { this.broker.last_error = 'prefetch_unavailable'; });
        }, 500);
        timer.unref();
        this.timers.set(key, timer);
    }

    changed(key, type) {
        if (EVENTS.has(type) || type.includes('normalization') || type.includes('tabletoperator') ||
            type.includes('umpire') || type.includes('servicejudge')) this.schedule(key);
    }

    async refresh(key) {
        if (this.running.has(key)) return;
        this.running.add(key);
        const revision = this.subscriptions.get(key);
        try {
            await require('../foreground_work').idle();
            const [tournament, locations, courts, matches, normalizations, tabletoperators] = await Promise.all([
                reads.read(this.app, key, 'tournaments', true),
                reads.read(this.app, key, 'locations', true),
                reads.read(this.app, key, 'courts', true),
                reads.read(this.app, key, 'matches', true),
                read_normalizations(this.app.db),
                reads.read(this.app, key, 'tabletoperators', true),
            ]);
            if (!tournament) return;
            // An edit may commit while the background snapshot is being read.
            if (this.subscriptions.get(key) !== revision) return;
            this.configure(tournament, false);
            const speech_settings = this.settings(key);
            if (speech_settings.mode === 'browser') return;
            // Only verified German voices are enabled. "auto" is warmed in German;
            // browsers using another UI language retain their existing browser TTS.
            if (tournament.language && !['auto', 'de'].includes(tournament.language)) return;
            const selected = upcoming(matches, this.broker.context_version ? this.broker.config.max_entries :
                this.broker.config.prefetch_matches, this.preferred.get(key));
            if (this.broker.context_version) selected.sort((a, b) => Number(a.setup.match_num || 0) - Number(b.setup.match_num || 0));
            const context = { ...tournament, locations, courts, normalizations, tabletoperators,
                speech: { context_version: this.broker.context_version } };
            const parts = prepare(context, selected);
            const preferred = new Set(this.preferred.get(key));
            const imminent = selected.filter((match, index) => ['preparation', 'oncourt'].includes(match.setup.state) ||
                preferred.has(match._id) || this.broker.context_version && index < this.broker.config.prefetch_matches);
            // On-court teams are imminent candidates for the next tablet duty.
            // The rest of the waiting pool is warmed at the stock priority.
            const imminent_parts = imminent.length ? prepare({ ...context, tabletoperators: [] }, imminent) : [];
            const warm = async (texts, priority) => {
                for (let i = 0; i < texts.length; i += 64) {
                    if (this.subscriptions.get(key) !== speech_settings) return;
                    for (const text of texts.slice(i, i + 64)) {
                        this.broker.prepare([text], { voice: speech_settings.voice, language: 'de-DE', priority, prefetch: true }, key);
                    }
                    await new Promise(resolve => setImmediate(resolve));
                }
            };
            await warm(imminent_parts, 'normal');
            await warm(parts, 'low');
            if (this.subscriptions.get(key) === speech_settings) {
                this.broker.reconcile_prefetch(key, parts, { voice: speech_settings.voice, language: 'de-DE' });
            }
        } finally {
            this.running.delete(key);
            if (this.dirty.delete(key)) this.schedule(key);
        }
    }

    start() {
        if (!this.broker.config.enabled || this.interval) return;
        this.interval = setInterval(() => {
            for (const key of this.subscriptions.keys()) this.schedule(key);
        }, this.broker.config.prefetch_interval_ms);
        this.interval.unref();
        // Warm tournaments without requiring an announcement-capable browser to be open.
        this.app.db.tournaments.find({}, (error, tournaments) => {
            if (error) return;
            for (const tournament of tournaments) this.subscribe(tournament.key, tournament);
        });
    }

    stop() {
        clearInterval(this.interval);
        this.interval = null;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        this.dirty.clear();
    }
}

module.exports = { Prefetcher, upcoming };
