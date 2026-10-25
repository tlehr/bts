'use strict';

const { plan } = require('./coverage');
const idlePlan = require('./idle_plan');
const { isRequired, matchParts, requiredPlan, requiredParts, callCandidates } = require('./planning');
const reads = require('../preparation_selection/model_reads');
const resolveSettings = require('../../static/js/speech_settings');
const { PlanningStatus } = require('./planning_status');
const EVENTS = new Set([
	'court_assignments_reset',
    'match_edit', 'match_added', 'match_delete', 'match_preparation_call', 'match_called_on_court',
    'court_current_match', 'match_finished', 'matches_changed', 'prop_changed',
    'location_changed', 'locations_changed', 'court_changed', 'courts_changed',
    'normalization_add', 'normalization_remove', 'normalizations_changed', 'props',
    'umpire_updated', 'umpires_changed', 'tabletoperator_updated', 'tabletoperator_add',
    'update_btp_events', 'registration_player_status', 'registration_player_status_reset',
    'registration_open_events', 'registration_completed_events',
]);
const CALL_EVENTS = new Set(['match_preparation_call', 'match_called_on_court']);

function affectsPlan(type, value) {
    return CALL_EVENTS.has(type) || type === 'score' && (value?.now_on_court === false || typeof value?.team1_won === 'boolean') ||
        EVENTS.has(type) || ['normalization', 'tabletoperator', 'umpire', 'servicejudge'].some(part => type.includes(part));
}

function read_normalizations(db) {
    return new Promise((resolve, reject) => db.normalizations.find({}, (error, values) =>
        error ? reject(error) : resolve(values)));
}

class Prefetcher {
    constructor(app, broker) {
        this.app = app;
        this.broker = broker;
        this.health = require('./health').health(app);
        this.subscriptions = new Map();
        this.timers = new Map();
        this.lease_timers = new Map();
        this.running = new Set();
        this.refresh_phases = new Map();
        this.dirty = new Set();
        this.contexts = new Map();
        this.planning = new Map();
        this.urgent = new Set();
        this.interval = null;
    }

    settings(key) {
        return this.subscriptions.get(key) || resolveSettings({}, this.broker.config);
    }

    planning_status(key) {
        const settings = this.settings(key), model = this.planning.get(key);
        if (model) return { ...model.snapshot(this.broker, key, settings, this.broker.pending_plans.has(key)),
            refresh: { phase: this.refresh_phases.get(key) || (this.timers.has(key) ? 'scheduled' : null), dirty: this.dirty.has(key) } };
        return { title: key, state: !this.broker.config.enabled || settings.mode === 'browser' ? 'disabled' : 'updating',
            phase: 'unknown', voice: settings.voice, mode: settings.mode, games: {}, stages: [],
            total: { ready: 0, queued: 0, total: 0, failed: 0 }, current: null, active_stage: null, updated_at: this.broker.now() };
    }

    configure(tournament, schedule = true) {
        const selected = resolveSettings(tournament, this.broker.config);
        const previous = this.subscriptions.get(tournament.key);
        if (previous?.voice === selected.voice && previous?.mode === selected.mode &&
            previous?.warm_other_voice === selected.warm_other_voice) return;
        this.subscriptions.set(tournament.key, selected);
        this.contexts.delete(tournament.key);
        this.planning.delete(tournament.key);
        clearTimeout(this.lease_timers.get(tournament.key));
        this.lease_timers.delete(tournament.key);
        this.broker.select_voice(tournament.key, selected.mode === 'browser' ? null : selected.voice);
        if (schedule) this.schedule(tournament.key);
    }

    subscribe(key, tournament, { refresh = false } = {}) {
        if (!this.broker.config.enabled || this.subscriptions.size >= 128 && !this.subscriptions.has(key)) return;
        const previous = this.subscriptions.get(key);
        if (tournament || !previous) this.configure({ ...tournament, key }, false);
        const changed = previous !== this.subscriptions.get(key);
        const needs_plan = !this.planning.has(key) ||
            this.contexts.get(key)?.context.speech.context_version !== this.broker.context_version;
        // Loading an unchanged tournament is a subscription, not a committed
        // data change. In particular it must not cancel an in-flight snapshot.
        if (refresh || changed || needs_plan && !this.running.has(key) && !this.timers.has(key)) this.schedule(key);
    }

    schedule(key, _candidates, urgent = false) {
        if (!this.broker.config.enabled || !this.subscriptions.has(key)) return;
        this.broker.pending_plans.add(key);
        if (this.running.has(key)) {
            this.dirty.add(key);
            if (urgent) this.urgent.add(key);
            return;
        }
        if (this.timers.has(key)) {
            if (!urgent) return;
            clearTimeout(this.timers.get(key));
        }
        const timer = setTimeout(() => {
            this.timers.delete(key);
            void this.refresh(key).then(() => this.health.clear('prefetch:' + key)).catch(error => {
                this.broker.last_error = 'prefetch_unavailable'; this.health.fail('prefetch:' + key, error);
            });
        }, urgent ? 0 : 500);
        timer.unref();
        this.timers.set(key, timer);
    }

    changed(key, type, value) {
        if (CALL_EVENTS.has(type)) {
            if (!this.subscriptions.has(key)) this.subscribe(key);
            // The call notification follows persistence. Admit the complete
            // game immediately, even while another server job is still busy.
            const cached = this.contexts.get(key), match = value?.match || value;
            if (cached && cached.settings === this.settings(key) &&
                cached.context.speech.context_version === this.broker.context_version && isRequired(match)) {
                try {
                    const parts = matchParts(cached.context, match);
                    cached.required.games.set(match._id, { match: { _id: match._id, setup: match.setup }, parts });
                    this.broker.set_prefetch_order(key, requiredParts(cached.required), cached.settings);
                    for (let i = 0; i < parts.length; i += 64) this.broker.prepare(parts.slice(i, i + 64),
                        { ...cached.settings, language: 'de-DE', priority: 'normal', prefetch: true }, key);
                    this.broker.on_change([key]);
                    this.health.clear('immediate_prefetch:' + key);
                } catch (error) { this.broker.last_error = 'prefetch_unavailable'; this.health.fail('immediate_prefetch:' + key, error); }
            }
            this.schedule(key, undefined, true);
            return;
        }
        const finished = type === 'score' && (value?.now_on_court === false || typeof value?.team1_won === 'boolean');
        if (finished || EVENTS.has(type) || type.includes('normalization') || type.includes('tabletoperator') ||
            type.includes('umpire') || type.includes('servicejudge')) this.schedule(key);
    }

    async refresh(key) {
        if (this.running.has(key)) return;
        this.running.add(key);
        this.broker.pending_plans.add(key);
        const revision = this.subscriptions.get(key);
        try {
            this.refresh_phases.set(key, 'snapshot');
            await require('../foreground_work').idle();
            const [tournament, locations, courts, matches, normalizations, tabletoperators, umpires] = this.app.speech_snapshot ?
                await this.app.speech_snapshot(key) : await Promise.all([
                reads.read(this.app, key, 'tournaments', true),
                reads.read(this.app, key, 'locations', true),
                reads.read(this.app, key, 'courts', true),
                reads.read(this.app, key, 'matches', true),
                read_normalizations(this.app.db),
                reads.read(this.app, key, 'tabletoperators', true),
                reads.read(this.app, key, 'umpires', true),
            ]);
            if (!tournament) return;
            // An edit may commit while the background snapshot is being read.
            if (this.subscriptions.get(key) !== revision) return;
            this.configure(tournament, false);
            const speech_settings = this.settings(key);
            if (speech_settings.mode === 'browser') return;
            // Only verified German voices are enabled. "auto" is warmed in German;
            // browsers using another UI language retain their existing browser TTS.
            if (tournament.language && !['auto', 'de'].includes(tournament.language)) {
                this.contexts.delete(key);
                this.planning.delete(key);
                this.broker.reconcile_prefetch(key, [], speech_settings);
                return;
            }
            const context = { ...tournament, locations, courts, normalizations, tabletoperators,
                speech: { context_version: this.broker.context_version } };
            const required = requiredPlan(context, matches, umpires), parts = requiredParts(required);
            const candidates = callCandidates({ ...context, umpires }, matches, {
                now_ts: tournament.speech_now_ts ?? this.app.clock?.now_ms() ?? this.broker.now(),
            });
            const planning = new PlanningStatus(context, matches, required, candidates);
            // Retain only the context and active game recipes needed by an
            // immediate call; the registration inventory is rebuilt separately.
            const warm = async (texts, priority) => {
                for (let i = 0; i < texts.length; i += 64) {
                    if (this.subscriptions.get(key) !== speech_settings) return;
                    for (const text of texts.slice(i, i + 64)) {
                        this.broker.prepare([text], { voice: speech_settings.voice, language: 'de-DE', priority, prefetch: true }, key);
                    }
                    await new Promise(resolve => setImmediate(resolve));
                }
            };
            this.refresh_phases.set(key, 'required');
            if (!this.dirty.has(key)) {
                this.contexts.set(key, { context: { ...context, events: undefined }, settings: speech_settings, required });
                this.broker.set_prefetch_order(key, parts, speech_settings);
                await warm(parts, 'normal');
            }
            let published = false;
            if (!this.dirty.has(key) && this.subscriptions.get(key) === speech_settings) {
                const needed = new Set(parts);
                this.refresh_phases.set(key, 'inventory');
                const idle_parts = (await idlePlan(context, matches, umpires, candidates, (stage, values, detail) => planning.add(stage, values, detail)))
                    .filter(part => !needed.has(part));
                if (!this.dirty.has(key) && this.subscriptions.get(key) === speech_settings) {
                    this.refresh_phases.set(key, 'publish');
                    const retry = this.broker.reconcile_prefetch(key, parts, { ...speech_settings, language: 'de-DE', idle_parts });
                    this.planning.set(key, planning);
                    // Generation only needs the reconciled inventory. Building
                    // and persisting every game's overview must not hold up a
                    // free generator. A later committed change sets this again.
                    this.broker.pending_plans.delete(key);
                    published = true;
                    this.broker.on_change([key]);
                    clearTimeout(this.lease_timers.get(key));
                    this.lease_timers.delete(key);
                    if (retry !== null) {
                        const timer = setTimeout(() => { this.lease_timers.delete(key); this.schedule(key); }, retry);
                        timer.unref();
                        this.lease_timers.set(key, timer);
                    }
                }
            }
            // Publish each captured game state even when a newer event cancels
            // generation, so its status cannot remain minutes behind live play.
            this.refresh_phases.set(key, 'coverage');
            const coverage = await plan(context, matches, umpires, candidates);
            if (this.subscriptions.get(key) !== speech_settings) return;
            const game_plan = this.broker.coverage.set_game_plan(key, speech_settings.voice, coverage);
            if (published && !this.dirty.has(key)) {
                await this.broker.coverage.set_plan(key, speech_settings.voice, coverage, game_plan);
            }
        } finally {
            this.running.delete(key);
            this.refresh_phases.delete(key);
            if (this.dirty.delete(key)) this.schedule(key, undefined, this.urgent.delete(key));
            else this.broker.pending_plans.delete(key);
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
            if (error) { this.health.fail('prefetch', error); return; }
            try { for (const tournament of tournaments) this.subscribe(tournament.key, tournament); }
            catch (error) { this.health.fail('prefetch', error); }
        });
    }

    stop() {
        clearInterval(this.interval);
        this.interval = null;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        for (const timer of this.lease_timers.values()) clearTimeout(timer);
        this.lease_timers.clear();
        this.dirty.clear();
        this.refresh_phases.clear();
        this.contexts.clear();
        this.planning.clear();
        this.urgent.clear();
        for (const key of this.subscriptions.keys()) this.broker.pending_plans.delete(key);
    }
}

module.exports = { Prefetcher, affectsPlan, CALL_EVENTS };
