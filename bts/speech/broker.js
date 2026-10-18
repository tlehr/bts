'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { request } = require('./http');
const SpeechDiskCache = require('./disk_cache');
const { SpeechCoverage } = require('./coverage');
const { spellNumbers, VERSION: TEXT_VERSION } = require('./numbers');
const context = require('./context');
const PRIORITY = { high: 0, normal: 1, low: 2, idle: 3, spare: 4 };
const ID = /^[0-9a-f]{32}$/;
const PLAYBACK_PROFILE = 'bts-playback-v1';

function bounded(value, fallback, min, max) {
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function configuration(config = {}, env = process.env) {
    let api_key = env.BTS_SPEECH_API_KEY || config.api_key || '';
    const key_file = env.BTS_SPEECH_API_KEY_FILE || config.api_key_file;
    if (!api_key && key_file) {
        try {
            const filename = path.resolve(key_file);
            if (fs.statSync(filename).size <= 4096) api_key = fs.readFileSync(filename, 'utf8').trim();
        } catch (_) { /* Speech failure must not prevent BTS from starting. */ }
    }
    let base_url = env.BTS_SPEECH_URL || config.url || 'http://127.0.0.1:8077';
    try {
        const parsed = new URL(base_url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
            parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('invalid_url');
        base_url = parsed.origin;
    } catch (_) { base_url = null; }
    const configured = env.BTS_SPEECH_ENABLED === undefined ? config.enabled === true : env.BTS_SPEECH_ENABLED === 'true';
    return {
        enabled: configured && !!base_url && /^[\x20-\x7e]{32,}$/.test(api_key),
        configured, api_key, base_url,
        cache_enabled: env.BTS_SPEECH_CACHE_ENABLED === undefined ? config.cache_enabled !== false : env.BTS_SPEECH_CACHE_ENABLED !== 'false',
        cache_dir: env.BTS_SPEECH_CACHE_DIR || config.cache_dir || null,
        shared_audio_dir: env.BTS_SPEECH_SHARED_AUDIO_DIR || config.shared_audio_dir || null,
        mode: ['browser', 'auto', 'server'].includes(config.mode) ? config.mode : 'auto',
        voice: config.voice === 'hallensprecher' ? 'hallensprecher' : 'hallensprecherin',
        deadline_ms: bounded(config.deadline_ms, 700, 50, 2000),
        timeout_ms: bounded(config.timeout_ms, 2500, 100, 10000),
        submit_interval_ms: bounded(config.submit_interval_ms, 650, 500, 10000),
        poll_interval_ms: bounded(config.poll_interval_ms, 2000, 500, 10000),
        prefetch_matches: bounded(config.prefetch_matches, 12, 1, 100),
        prefetch_interval_ms: bounded(config.prefetch_interval_ms, 30000, 5000, 300000),
        max_entries: bounded(config.max_entries, 4096, 32, 4096),
        max_text: bounded(config.max_text, 1200, 1, 10000),
        audio_url_ttl_seconds: bounded(config.audio_url_ttl_seconds, 900, 60, 3600),
        audio_timeout_ms: bounded(config.audio_timeout_ms, 30000, 1000, 120000),
        max_audio_clients: bounded(config.max_audio_clients, 16, 1, 64),
    };
}

class SpeechBroker {
    constructor(config, options = {}) {
        this.config = config;
        this.request = options.request || request;
        this.now = options.now || Date.now;
        this.on_change = options.onChange || (() => {});
        this.entries = new Map();
        this.idle_plans = new Map();
        this.spare_plans = new Map();
        this.prefetch_plans = new Map();
        this.pending_plans = new Set();
        this.last_idle_tournament = null;
        this.last_spare_tournament = null;
        this.signing_key = crypto.randomBytes(32);
        this.voices = [];
        this.identity = null;
        this.last_error = config.configured && !config.enabled ? 'configuration_missing' : null;
        this.timer = null;
        this.stopped = true;
        this.last_post = -Infinity;
        this.last_post_voice = new Map();
        this.post_retry_at = 0;
        this.current = null;
        this.stepping = false;
        this.last_metadata = 0;
        this.metadata_verified = false;
        this.audio_clients = 0;
        this.context_version = null;
        this.playback_profile = null;
        this.playback_version = null;
        this.disk = null;
        this.cache_error = null;
        this.coverage = new SpeechCoverage(this);
        if (config.enabled && config.cache_enabled && config.cache_dir) {
            try {
                this.disk = new SpeechDiskCache(config);
                const saved = this.disk.state;
                if (saved && JSON.parse(saved.identity)[0] === TEXT_VERSION && Array.isArray(saved.voices)) {
                    this.identity = saved.identity;
                    this.voices = saved.voices;
                    this.context_version = context.SUPPORTED.includes(saved.context_version) ? saved.context_version : null;
                    this.playback_profile = saved.playback_profile === PLAYBACK_PROFILE ? PLAYBACK_PROFILE : null;
                    this.playback_version = this.playback_profile ? saved.playback_version : null;
                }
                void this.disk.ready.then(() => {
                    const changed = new Set();
                    for (const entry of this.entries.values()) if (this.restore(entry)) {
                        for (const key of entry.tournaments) changed.add(key);
                    }
                    for (const entry of this.entries.values()) this.ensure_source(entry);
                    if (changed.size) this.on_change([...changed]);
                }).catch(() => { this.cache_error = 'speech_cache_unavailable'; });
            } catch (_) { this.cache_error = 'speech_cache_unavailable'; }
        }
    }

    public_config(voice = this.config.voice) {
        const entries = [...this.entries.values()].filter(entry => entry.voice === voice);
        return {
            enabled: this.config.enabled, mode: this.config.mode, voice: this.config.voice,
            deadline_ms: this.config.deadline_ms, max_text: this.config.max_text,
            max_part_length: this.config.max_text * 4 + 512, context_version: this.context_version,
            playback_profile: this.playback_profile, playback_version: this.playback_version,
            voices: this.voices, last_error: this.last_error,
            cache_version: this.identity ? crypto.createHash('sha256').update(this.identity).digest('hex') : null,
            preparing: entries.filter(item => ['unsubmitted', 'queued', 'processing'].includes(item.status)).length,
            ready: entries.filter(item => item.status === 'completed').length,
            persistent_cache: { enabled: !!this.disk, ready: entries.filter(item => item.status === 'completed' && item.local).length,
                stored: this.disk?.count() ?? null, error: this.cache_error },
        };
    }

    restore(entry) {
        const saved = this.disk?.lookup(this.identity, entry.key);
        if (!saved) return false;
        if (this.playback_profile && entry.context?.kind !== 'source' && saved.playback_profile !== this.playback_profile) return false;
        if (saved.fallback_stage && entry.context?.kind === 'team' && !this.set_team_fallback(entry, saved.fallback_stage, true)) return false;
        Object.assign(entry, { status: 'completed', job_id: saved.job_id, audio_id: saved.audio_id, processed: saved.processed,
            playback_profile: saved.playback_profile || null,
            leading_quiet_ms: saved.leading_quiet_ms, trailing_quiet_ms: saved.trailing_quiet_ms,
            checked: this.now(), local: true, revalidate: false });
        entry.generated_for = new Set(saved.generated_for || []);
        return true;
    }

    set_team_fallback(entry, stage, cache_only = false) {
        const original = context.decode(entry.part, this.config.max_text);
        const recipe = stage === 'name' ? { before: '', text: entry.text, after: '', kind: 'team', version: original.version } : original;
        const part = context.sourcePart(recipe);
        const key = this.key('team-fallback-' + stage + '-v1:' + part, entry.voice, entry.language);
        let source = this.entries.get(key);
        Object.assign(entry, { context: recipe, source_key: key, fallback_stage: stage });
        if (!source && cache_only && !this.disk?.lookup(this.identity, key)) return true;
        if (!source) {
            if (this.entries.size >= this.config.max_entries) return cache_only;
            source = { key, part, text: recipe.before + recipe.text + recipe.after, context: context.decode(part, this.config.max_text),
                source_key: null, voice: entry.voice, language: entry.language, priority: entry.priority,
                status: 'unsubmitted', created: entry.created, used: this.now(), retry_at: 0, next_poll: 0, busy: false,
                tournaments: new Set(), fallback_source: stage, ...(stage === 'context' ? { source_seed: original.version === context.V2 ? 45 : 43 } : {}) };
            this.entries.set(key, source);
            this.restore(source);
        }
        for (const tournament of entry.tournaments) {
            source.tournaments.add(tournament);
            for (const group of ['prefetch_tournaments', 'foreground_tournaments', 'idle_tournaments', 'spare_tournaments']) if (entry[group]?.has(tournament)) {
                source[group] ||= new Set();
                source[group].add(tournament);
            }
            if (entry.foreground_expiry?.has(tournament)) {
                source.foreground_expiry ||= new Map();
                source.foreground_expiry.set(tournament, Math.max(source.foreground_expiry.get(tournament) || 0,
                    entry.foreground_expiry.get(tournament)));
            }
        }
        source.priority = Math.min(source.priority, entry.priority);
        source.used = this.now();
        return true;
    }

    ensure_source(entry) {
        if (!entry.source_key || this.disk && !this.disk.verified) return;
        if (entry.fallback_stage) {
            this.set_team_fallback(entry, entry.fallback_stage, entry.status === 'completed');
            return;
        }
        // A cached excerpt is playable by itself. Do not regenerate a missing
        // raw source just to display the provenance of an already finished cut.
        if (entry.status === 'completed' && !this.entries.has(entry.source_key) && !this.disk?.lookup(this.identity, entry.source_key)) return;
        const source = context.sourcePart(entry.context);
        const options = { voice: entry.voice, language: entry.language, priority: Object.keys(PRIORITY)[entry.priority] };
        if (!entry.tournaments.size) this.prepare([source], options);
        for (const key of entry.tournaments) {
            if (entry.prefetch_tournaments?.has(key)) this.prepare([source], { ...options, prefetch: true }, key);
            if (entry.idle_tournaments?.has(key)) this.prepare([source], { ...options, priority: 'idle', prefetch: true }, key);
            if (entry.spare_tournaments?.has(key)) this.prepare([source], { ...options, priority: 'spare', prefetch: true }, key);
            if (entry.foreground_tournaments?.has(key)) this.prepare([source],
                { ...options, foreground_until: entry.foreground_expiry?.get(key) }, key);
        }
    }

    advance_team_fallback(entry) {
        const stage = !entry.fallback_stage ? 'context' : entry.fallback_stage === 'context' ? 'name' : null;
        if (!stage || !this.set_team_fallback(entry, stage)) {
            entry.terminal_failure = true;
            return;
        }
        Object.assign(entry, { status: 'unsubmitted', job_id: null, retry_at: 0, next_poll: 0, local: false });
        if (this.entries.get(entry.source_key).status === 'failed') this.advance_team_fallback(entry);
        if (entry.tournaments.size) this.on_change([...entry.tournaments]);
    }

    failed_fallback_source(entry) {
        if (!entry.fallback_source) return;
        for (const child of this.entries.values()) if (child.source_key === entry.key && child.context?.kind === 'team') {
            this.advance_team_fallback(child);
            if (child.terminal_failure) child.status = 'failed';
        }
    }

    check_local(entry) {
        if (entry?.local && !this.disk?.file(entry.audio_id)) {
            Object.assign(entry, { status: 'unsubmitted', local: false, retry_at: 0, revalidate: false });
        }
        return entry;
    }

    key(text, voice, language) {
        return crypto.createHash('sha256').update(JSON.stringify([text, voice, language])).digest('hex');
    }

    validate(parts, options = {}) {
        if (!Array.isArray(parts) || parts.length > 64 ||
            parts.some(text => {
                if (typeof text !== 'string' || !text.trim() || text.length > this.config.max_text * 4 + 512) return true;
                const recipe = context.decode(text, this.config.max_text);
                return recipe ? this.context_version !== recipe.version : spellNumbers(text).length > this.config.max_text;
            })) {
            throw new Error('invalid_speech_parts');
        }
        const voice = options.voice || this.config.voice;
        if (!['hallensprecherin', 'hallensprecher'].includes(voice)) throw new Error('invalid_speech_voice');
        const language = options.language || 'de-DE';
        // English voices are not advertised or synthesized before operator validation.
        if (language !== 'de-DE') throw new Error('unsupported_speech_language');
        return { voice, language, priority: Object.hasOwn(PRIORITY, options.priority) ? options.priority : 'low' };
    }

    prepare(parts, options = {}, tournament_key) {
        const normalized = this.validate(parts, options);
        if (!this.config.enabled) return normalized;
        for (const text of parts) {
            const recipe = context.decode(text, this.config.max_text);
            const source = recipe && recipe.kind !== 'source' ? context.sourcePart(recipe) : null;
            const key = this.key(text, normalized.voice, normalized.language);
            let entry = this.entries.get(key);
            if (!entry) {
                if (this.entries.size >= this.config.max_entries) {
                    const victim = [...this.entries.values()]
                        .filter(item => item !== this.current?.entry && !item.busy && !['queued', 'processing'].includes(item.status))
                        .filter(item => item.key !== (source ? this.key(source, normalized.voice, normalized.language) : null) &&
                            ![...this.entries.values()].some(child => child.source_key === item.key))
                        .filter(item => item.status !== 'unsubmitted' || (recipe ? item.priority > PRIORITY[normalized.priority] :
                            item.priority >= PRIORITY[normalized.priority]))
                        .sort((a, b) => b.priority - a.priority || a.used - b.used)[0];
                    if (!victim) continue;
                    this.entries.delete(victim.key);
                }
                entry = {
                    key, part: text, text: recipe?.text || text, context: recipe,
                    source_key: source ? this.key(source, normalized.voice, normalized.language) : null,
                    ...normalized, priority: PRIORITY[normalized.priority],
                    status: 'unsubmitted', created: this.now(), used: this.now(),
                    retry_at: 0, next_poll: 0, busy: false,
                    tournaments: new Set(),
                };
                this.entries.set(key, entry);
                this.restore(entry);
                if (!entry.generated_for) entry.generated_for = new Set(this.disk?.origin(this.identity, key) || []);
            }
            entry.retired = false;
            if (normalized.priority === 'spare') entry.spare_cached = true;
            this.check_local(entry);
            if (entry.status !== 'completed' && !entry.busy && entry !== this.current?.entry) this.restore(entry);
            const interests = options.prefetch ? normalized.priority === 'spare' ? 'spare_tournaments' :
                normalized.priority === 'idle' ? 'idle_tournaments' : 'prefetch_tournaments' : 'foreground_tournaments';
            if (tournament_key) {
                entry.tournaments.add(tournament_key);
                entry[interests] ||= new Set();
                entry[interests].add(tournament_key);
                if (PRIORITY[normalized.priority] < PRIORITY.idle) this.coverage.mark_needed(entry, tournament_key);
                if (!options.prefetch && entry.context) {
                    entry.foreground_expiry ||= new Map();
                    entry.foreground_expiry.set(tournament_key, Math.max(entry.foreground_expiry.get(tournament_key) || 0,
                        options.foreground_until ?? this.now() + 10000));
                }
            }
            const active_source = this.entries.get(entry.source_key);
            if (active_source) {
                if (tournament_key) active_source.tournaments.add(tournament_key);
                if (tournament_key) {
                    active_source[interests] ||= new Set();
                    active_source[interests].add(tournament_key);
                    if (!options.prefetch && entry.foreground_expiry?.has(tournament_key)) {
                        active_source.foreground_expiry ||= new Map();
                        active_source.foreground_expiry.set(tournament_key, Math.max(active_source.foreground_expiry.get(tournament_key) || 0,
                            entry.foreground_expiry.get(tournament_key)));
                    }
                }
                active_source.priority = Math.min(active_source.priority, PRIORITY[normalized.priority]);
                active_source.used = this.now();
            }
            entry.used = this.now();
            if (PRIORITY[normalized.priority] < entry.priority) {
                entry.priority = PRIORITY[normalized.priority];
            }
            if (entry.status === 'failed' && !entry.terminal_failure && entry.retry_at <= this.now()) entry.status = 'unsubmitted';
            // Revalidate preference/configuration occasionally through the authoritative cache.
            if (entry.status === 'completed' && !entry.local && entry.checked + 300000 < this.now()) entry.revalidate = true;
            if (normalized.priority === 'high') entry.next_poll = 0;
            this.ensure_source(entry);
        }
        return normalized;
    }

    views(parts, options, tournament_key) {
        const { voice, language } = this.validate(parts, options);
        return parts.map(text => {
            const entry = this.check_local(this.entries.get(this.key(text, voice, language)));
            return entry?.status === 'completed' ? {
                status: 'completed',
                audio_url: this.audio_url(tournament_key, entry.audio_id, entry),
                processed: entry.processed || false, leading_quiet_ms: entry.leading_quiet_ms || 0,
                trailing_quiet_ms: entry.trailing_quiet_ms || 0,
                ...(entry.local ? { local: true } : {}),
            } : { status: entry?.status || 'unsubmitted', audio_url: null };
        });
    }

    inspect(parts, options, tournament_key) {
        const { voice, language } = this.validate(parts, options);
        return parts.map(text => {
            const entry = this.check_local(this.entries.get(this.key(text, voice, language)));
            return { status: entry?.status || 'missing',
                ...(entry?.status === 'completed' && tournament_key ?
                    { audio_url: this.audio_url(tournament_key, entry.audio_id, entry), processed: entry.processed || false,
                        leading_quiet_ms: entry.leading_quiet_ms || 0, trailing_quiet_ms: entry.trailing_quiet_ms || 0 } : {}),
                ...(entry?.status === 'completed' && entry.local ? { local: true } : {}),
            };
        });
    }

    select_voice(tournament_key, voice) {
        this.spare_plans.delete(tournament_key);
        if (this.idle_plans.get(tournament_key)?.voice !== voice) this.idle_plans.delete(tournament_key);
        if (this.prefetch_plans.get(tournament_key)?.voice !== voice) this.prefetch_plans.delete(tournament_key);
        for (const [key, entry] of this.entries) {
            entry.spare_tournaments?.delete(tournament_key);
            if (!entry.tournaments.has(tournament_key) || entry.voice === voice) continue;
            entry.tournaments.delete(tournament_key);
            entry.prefetch_tournaments?.delete(tournament_key);
            entry.idle_tournaments?.delete(tournament_key);
            entry.foreground_tournaments?.delete(tournament_key);
            entry.foreground_expiry?.delete(tournament_key);
            // A submitted request retains its independent current slot until it
            // finishes. Removing its local cache entry never opens another slot.
            if (!entry.tournaments.size) {
                if (entry === this.current?.entry) entry.detached = true;
                entry.retired = true;
                if (entry.status !== 'completed' || this.disk || !entry.spare_cached) this.entries.delete(key);
            }
        }
    }

    set_prefetch_order(tournament_key, parts, { voice, language = 'de-DE' }) {
        this.prefetch_plans.set(tournament_key, { voice,
            positions: new Map(parts.map((part, index) => [this.key(part, voice, language), index])) });
    }

    reconcile_prefetch(tournament_key, parts, { voice, language = 'de-DE', idle_parts = [], warm_other_voice = false }) {
        const expand = (values, selected_voice = voice) => {
            const wanted = new Set(values.map(part => this.key(part, selected_voice, language))), stack = [...wanted];
            while (stack.length) {
                const source = this.entries.get(stack.pop())?.source_key;
                if (source && !wanted.has(source)) { wanted.add(source); stack.push(source); }
            }
            return wanted;
        };
        const wanted = expand(parts), idle = expand(idle_parts);
        this.set_prefetch_order(tournament_key, parts, { voice, language });
        this.idle_plans.set(tournament_key, { voice, language, parts: idle_parts, cursor: 0,
            positions: new Map(idle_parts.map((part, index) => [this.key(part, voice, language), index])) });
        const spare_voice = voice === 'hallensprecher' ? 'hallensprecherin' : 'hallensprecher';
        const spare_parts = warm_other_voice ? [...new Set([...parts, ...idle_parts])] : [];
        const spare = expand(spare_parts, spare_voice);
        if (warm_other_voice) this.spare_plans.set(tournament_key, { voice: spare_voice, language, parts: spare_parts, cursor: 0,
            positions: new Map(spare_parts.map((part, index) => [this.key(part, spare_voice, language), index])) });
        else this.spare_plans.delete(tournament_key);
        let changed = false, retry_after = null;
        for (const [key, entry] of this.entries) {
            if (!entry.tournaments.has(tournament_key)) continue;
            if (!wanted.has(key)) entry.prefetch_tournaments?.delete(tournament_key);
            if (!idle.has(key) || wanted.has(key)) entry.idle_tournaments?.delete(tournament_key);
            if (!spare.has(key)) entry.spare_tournaments?.delete(tournament_key);
            if (!wanted.has(key) && entry.context && entry.foreground_tournaments?.has(tournament_key)) {
                const remaining = (entry.foreground_expiry?.get(tournament_key) || 0) - this.now();
                if (remaining > 0) retry_after = Math.min(retry_after ?? Infinity, remaining);
                else {
                    entry.foreground_tournaments.delete(tournament_key);
                    entry.foreground_expiry?.delete(tournament_key);
                }
            }
            if (entry.idle_tournaments?.size && !entry.prefetch_tournaments?.size && !entry.foreground_tournaments?.size) {
                entry.priority = PRIORITY.idle;
            } else if (entry.spare_tournaments?.size && !entry.prefetch_tournaments?.size && !entry.foreground_tournaments?.size) {
                entry.priority = PRIORITY.spare;
            }
            if (entry.prefetch_tournaments?.has(tournament_key) || entry.idle_tournaments?.has(tournament_key) || entry.spare_tournaments?.has(tournament_key) ||
                entry.foreground_tournaments?.has(tournament_key)) continue;
            entry.tournaments.delete(tournament_key);
            changed = true;
            if (!entry.tournaments.size) {
                // A submitted request still owns the one current slot until
                // completion. Its output may be archived, but never retried.
                if (entry === this.current?.entry) entry.detached = true;
                entry.retired = true;
                if (entry.status !== 'completed' || this.disk || !entry.spare_cached) this.entries.delete(key);
            }
        }
        if (changed) this.on_change([tournament_key]);
        return retry_after;
    }

    regular_work_pending(before = PRIORITY.idle) {
        const entries = [...this.entries.values()];
        return this.pending_plans.size > 0 || entries.some(entry => !entry.retired && entry.priority < before &&
            (entry.revalidate || ['unsubmitted', 'queued', 'processing'].includes(entry.status) ||
                entry.status === 'failed' && !entry.terminal_failure && (!entry.fallback_source ||
                    entries.some(child => child.source_key === entry.key && !child.terminal_failure))));
    }

    spare_work_allowed() {
        return !this.regular_work_pending(PRIORITY.spare) &&
            [...this.idle_plans.values()].every(plan => plan.cursor >= plan.parts.length);
    }

    admit_idle(priority = 'idle') {
        if (priority === 'spare' && !this.spare_work_allowed()) return;
        const inventory = priority === 'spare' ? this.spare_plans : this.idle_plans;
        const last = priority === 'spare' ? 'last_spare_tournament' : 'last_idle_tournament';
        // Round-robin between tournaments; each plan itself follows likely use.
        const plans = [...inventory].sort(([a], [b]) => Number(a === this[last]) - Number(b === this[last]));
        for (const [tournament, plan] of plans) while (plan.cursor < plan.parts.length) {
            const part = plan.parts[plan.cursor], key = this.key(part, plan.voice, plan.language);
            let entry = this.check_local(this.entries.get(key));
            if (entry?.status === 'completed' || this.disk?.lookup(this.identity, key)) { plan.cursor++; continue; }
            // Idle preparation must not evict ordinary work or churn through
            // more inventory than the bounded broker can hold, including a source.
            if (!entry && this.entries.size + 2 > this.config.max_entries) {
                for (const [saved_key, saved] of this.entries) {
                    if (saved.priority < PRIORITY.idle && !saved.retired || saved.status !== 'completed' || !saved.local ||
                        saved === this.current?.entry || saved.busy ||
                        [...this.entries.values()].some(child => child.source_key === saved_key && child.status !== 'completed')) continue;
                    this.entries.delete(saved_key);
                    if (this.entries.size + 2 <= this.config.max_entries) break;
                }
                if (this.entries.size + 2 > this.config.max_entries) return;
            }
            this.prepare([part], { voice: plan.voice, language: plan.language, priority, prefetch: true }, tournament);
            entry = this.entries.get(key);
            if (!entry) return;
            this[last] = tournament;
            if (entry.status === 'completed' || entry.terminal_failure) { plan.cursor++; continue; }
            if (entry.status === 'failed' && entry.retry_at > this.now()) { plan.cursor++; continue; }
            const source = this.entries.get(entry.source_key);
            if (source?.status === 'failed' && source.retry_at > this.now()) { plan.cursor++; continue; }
            return;
        }
    }

    pending_order(now = this.now()) {
        const regular_pending = this.regular_work_pending();
        const spare_allowed = this.spare_work_allowed();
        const positions = new Map();
        for (const entry of this.entries.values()) {
            if (entry.priority === PRIORITY.high || entry.status === 'completed' && !entry.revalidate) continue;
            const spare = entry.priority === PRIORITY.spare, idle = entry.priority >= PRIORITY.idle;
            if (idle && regular_pending) continue;
            if (spare && !spare_allowed) continue;
            for (const tournament of (spare ? entry.spare_tournaments : idle ? entry.idle_tournaments : entry.prefetch_tournaments) || []) {
                const position = (spare ? this.spare_plans : idle ? this.idle_plans : this.prefetch_plans).get(tournament)?.positions.get(entry.key);
                if (position === undefined) continue;
                // A source inherits the earliest still-needed cut's place.
                // Call timestamps and revised plans also reorder admitted work.
                let dependency = entry;
                while (dependency && position < (positions.get(dependency.key) ?? Infinity)) {
                    positions.set(dependency.key, position);
                    dependency = this.entries.get(dependency.source_key);
                }
            }
        }
        const compare = (a, b) => (a.priority !== PRIORITY.high ?
            (positions.get(a.key) ?? Infinity) - (positions.get(b.key) ?? Infinity) : 0) || a.created - b.created;
        const eligible = [...this.entries.values()].filter(entry => !entry.retired && entry !== this.current?.entry && !entry.busy &&
            (entry.priority < PRIORITY.idle || !regular_pending) &&
            (entry.priority !== PRIORITY.spare || spare_allowed) &&
            (!entry.source_key || this.entries.get(entry.source_key)?.status === 'completed') &&
            (entry.status === 'unsubmitted' || entry.revalidate) && entry.retry_at <= now);
        const ordered = [];
        for (const priority of Object.values(PRIORITY)) {
            const voices = new Map();
            for (const entry of eligible.filter(item => item.priority === priority).sort(compare)) {
                if (!voices.has(entry.voice)) voices.set(entry.voice, []);
                voices.get(entry.voice).push(entry);
            }
            let last = this.current?.entry.priority === priority ? this.current.request.voice : this.last_post_voice.get(priority);
            while (voices.size) {
                const next = [...voices.values()].map(items => items[0]).sort((a, b) =>
                    Number(a.voice === last) - Number(b.voice === last) || compare(a, b))[0];
                ordered.push(next);
                last = next.voice;
                const items = voices.get(next.voice);
                items.shift();
                if (!items.length) voices.delete(next.voice);
            }
        }
        return ordered;
    }

    queue(tournament_key, voice = this.coverage.plans.get(tournament_key)?.voice || this.config.voice) {
        for (const entry of this.entries.values()) this.check_local(entry);
        // Describe a source by its actual consumers. A full field reference
        // contains a fixed example game, but only supplies the reusable edges.
        const source_usage = new Map();
        for (const child of this.entries.values()) {
            if (!child.source_key || !child.tournaments.has(tournament_key)) continue;
            if (['field_start', 'field_end'].includes(child.context?.kind)) {
                source_usage.set(child.source_key, { type: 'field', text: child.text });
            } else if (child.context?.kind === 'game') {
                source_usage.set(child.source_key, { type: 'game' });
            }
        }
        const current = this.current?.entry;
        const pending = this.pending_order();
        const scheduled = new Set([current, ...pending]);
        const rest = [...this.entries.values()].filter(entry => !scheduled.has(entry))
            .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') ||
                a.priority - b.priority || a.created - b.created);
        const ordered = [...(current ? [current] : []), ...pending, ...rest];
        const positions = new Map(pending.map((entry, index) => [entry, index + 1]));
        return {
            coverage: this.coverage.summary(tournament_key, voice),
            busy_elsewhere: !!current && !current.tournaments.has(tournament_key),
            items: ordered.filter(entry => entry.tournaments.has(tournament_key)).map(entry => ({
                key: entry.key, text: entry.text, voice: entry.voice, language: entry.language, tournament_key,
                priority: Object.keys(PRIORITY)[entry.priority], status: entry.status,
                idle: (entry.idle_tournaments?.has(tournament_key) === true || entry.spare_tournaments?.has(tournament_key) === true) &&
                    !entry.prefetch_tournaments?.has(tournament_key) && !entry.foreground_tournaments?.has(tournament_key),
                spare: entry.spare_tournaments?.has(tournament_key) === true && entry.priority === PRIORITY.spare,
                position: entry === current ? 0 : positions.get(entry) ?? null,
                current: entry === current, retry_at: Math.max(entry.retry_at, this.post_retry_at),
                audio_url: entry.status === 'completed' ? this.audio_url(tournament_key, entry.audio_id, entry) : null,
                kind: entry.context?.kind || 'text',
                local: entry.local === true,
                ...(entry.fallback_stage || entry.fallback_source ? { fallback_stage: entry.fallback_stage || entry.fallback_source } : {}),
                ...(entry.terminal_failure ? { terminal_failure: true } : {}),
                operation: !entry.source_key ? 'synthesis' : entry.context.before || entry.context.after ? 'excerpt' : 'processing',
                ...(entry.source_key ? { source_key: entry.source_key, source_range: {
                    start: entry.context.before.length, end: entry.context.before.length + entry.text.length,
                } } : {}),
                ...(entry.context?.kind === 'source' ? { source_usage: source_usage.get(entry.key) || { type: 'shared' } } : {}),
                ...(entry.context?.kind === 'generic' ? { excerpt_position: !entry.context.before.trim() ? 'start' :
                    !entry.context.after.trim() ? 'end' : 'middle' } : {}),
                processed: entry.processed || false, leading_quiet_ms: entry.leading_quiet_ms || 0,
                trailing_quiet_ms: entry.trailing_quiet_ms || 0,
            })),
        };
    }

    audio_url(tournament_key, audio_id, entry) {
        const expires = Math.floor(this.now() / 1000) + this.config.audio_url_ttl_seconds;
        const playback = !entry?.playback_profile && !entry?.context && entry?.voice === 'hallensprecher' ? /[,;:.!?\r\n]/.test(entry.text) ? 'edges-v1' : 'words-v1' : '';
        return '/h/' + encodeURIComponent(tournament_key) + '/speech/audio/' + audio_id +
            '?expires=' + expires + '&signature=' + this.signature(tournament_key, audio_id, expires, playback) +
            (playback ? '&playback=' + playback : '');
    }

    signature(tournament_key, audio_id, expires, playback = '') {
        return crypto.createHmac('sha256', this.signing_key)
            .update(JSON.stringify([tournament_key, audio_id, Number(expires), playback])).digest('base64url');
    }

    authorize(tournament_key, audio_id, expires, signature, playback = '') {
        if (!this.config.enabled || !ID.test(audio_id) || !/^\d{10}$/.test(String(expires)) ||
            !['', 'edges-v1', 'words-v1'].includes(playback) ||
            typeof signature !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return false;
        const remaining = Number(expires) - Math.floor(this.now() / 1000);
        if (remaining < 0 || remaining > this.config.audio_url_ttl_seconds) return false;
        return crypto.timingSafeEqual(Buffer.from(signature),
            Buffer.from(this.signature(tournament_key, audio_id, expires, playback)));
    }

    async refresh() {
        const [health, voices] = await Promise.allSettled([
            this.request(this.config.base_url, this.config.api_key, 'GET', '/health', undefined, this.config.timeout_ms),
            this.request(this.config.base_url, this.config.api_key, 'GET', '/v1/voices', undefined, this.config.timeout_ms),
        ]);
        if (voices.status === 'fulfilled' && Array.isArray(voices.value.voices)) {
            this.voices = voices.value.voices.filter(voice =>
                ['hallensprecherin', 'hallensprecher'].includes(voice.voice_id) && voice.languages?.includes('de-DE'));
        }
        const state = health.status === 'fulfilled' ? health.value : health.reason.response;
        if (health.status === 'fulfilled' && state?.model_revision) this.metadata_verified = true;
        if (state?.model_revision) {
            const next_context = context.SUPPORTED.includes(state.context_version) ? state.context_version : null;
            if (next_context !== this.context_version) {
                this.context_version = next_context;
                this.entries.clear();
                this.idle_plans.clear();
                this.spare_plans.clear();
                this.prefetch_plans.clear();
            }
            this.playback_profile = state.playback_profile === PLAYBACK_PROFILE && /^[0-9a-f]{64}$/.test(state.playback_version) ? PLAYBACK_PROFILE : null;
            this.playback_version = this.playback_profile ? state.playback_version : null;
            const identity = JSON.stringify([TEXT_VERSION, state.configuration_version, state.backend, state.model, state.model_revision, this.voices, next_context,
                ...(this.playback_profile ? [this.playback_profile, this.playback_version] : [])]);
            if (this.identity && identity !== this.identity) {
                for (const entry of this.entries.values()) {
                    if (entry.fallback_stage) {
                        entry.context = context.decode(entry.part, this.config.max_text);
                        entry.source_key = this.key(context.sourcePart(entry.context), entry.voice, entry.language);
                        delete entry.fallback_stage;
                    }
                    delete entry.terminal_failure;
                    delete entry.generated_for;
                    entry.status = 'unsubmitted';
                    entry.job_id = null;
                    entry.retry_at = 0;
                    entry.local = false;
                }
            }
            this.identity = identity;
            if (this.disk) {
                try {
                    await this.disk.setState({ identity, voices: this.voices, context_version: next_context,
                        playback_profile: this.playback_profile, playback_version: this.playback_version });
                    this.cache_error = null;
                }
                catch (_) { this.cache_error = 'speech_cache_unavailable'; }
            }
            this.last_error = state.status === 'starting' || state.status === 'error' ? 'speech_unavailable' : null;
        } else this.last_error = 'speech_unavailable';
        this.last_metadata = this.now();
    }

    validate_response(entry, response) {
        if (!ID.test(response.job_id) || response.text !== spellNumbers(entry.text) || response.voice !== entry.voice ||
            response.language !== entry.language || !['queued', 'processing', 'completed', 'failed'].includes(response.status)) {
            throw new Error('speech_invalid_response');
        }
        if (response.status === 'completed' && (!ID.test(response.audio?.audio_id) ||
            entry.source_key && response.audio?.processed !== true || this.playback_profile && entry.context?.kind !== 'source' &&
            (response.audio?.playback_profile !== this.playback_profile || response.audio?.playback_version !== this.playback_version))) {
            throw new Error('speech_invalid_audio');
        }
    }

    update(entry, response) {
        this.validate_response(entry, response);
        entry.job_id = response.job_id;
        entry.status = response.status;
        entry.checked = this.now();
        entry.next_poll = this.now() + this.config.poll_interval_ms;
        if (response.status === 'completed') {
            entry.audio_id = response.audio.audio_id;
            entry.processed = response.audio.processed === true;
            entry.playback_profile = response.audio.playback_profile || null;
            entry.leading_quiet_ms = response.audio.leading_quiet_ms || 0;
            entry.trailing_quiet_ms = response.audio.trailing_quiet_ms || 0;
            this.last_error = null;
        } else if (response.status === 'failed') {
            entry.retry_at = this.now() + 30000;
            this.last_error = 'speech_generation_failed';
            if (!entry.detached && entry.context?.kind === 'team' && response.error?.code === 'alignment_failed') this.advance_team_fallback(entry);
            if (response.error?.code === 'source_quality_failed') {
                entry.terminal_failure = true;
                for (const child of this.entries.values()) if (child.source_key === entry.key) {
                    if (child.context?.kind === 'team') this.advance_team_fallback(child);
                    else { child.terminal_failure = true; child.status = 'failed'; }
                }
            }
            this.failed_fallback_source(entry);
        }
    }

    async step() {
        if (this.disk) await this.disk.ready;
        if (this.cache_error && !this.disk) return;
        if (this.stepping) return;
        const now = this.now();
        if (!this.current) {
            if (now < this.post_retry_at || now - this.last_post < this.config.submit_interval_ms) return;
            if (!this.regular_work_pending()) this.admit_idle();
            if (this.spare_work_allowed()) this.admit_idle('spare');
            const pending = this.pending_order(now);
            const entry = pending[0];
            if (!entry) return;
            this.current = { entry, identity: this.identity, job_id: null, request: {
                text: spellNumbers(entry.text), voice: entry.voice, language: entry.language,
                // The server protocol has three priorities. Admission and the
                // additional idle tier are managed exclusively here in BTS.
                priority: entry.priority >= PRIORITY.idle ? 'low' : Object.keys(PRIORITY)[entry.priority],
                ...(entry.context ? { profile: entry.context.version || context.VERSION } : {}),
                ...(this.playback_profile && entry.context?.kind !== 'source' ? { playback_profile: this.playback_profile } : {}),
                ...(entry.source_seed === undefined ? {} : { source_seed: entry.source_seed }),
                ...(entry.source_key ? { context: { audio_id: this.entries.get(entry.source_key).audio_id,
                    before: spellNumbers(entry.context.before), after: spellNumbers(entry.context.after), kind: entry.context.kind } } : {}),
            } };
        }
        const current = this.current;
        const entry = current.entry;
        const post = !current.job_id;
        if (post && this.restore(entry)) {
            this.current = null;
            if (entry.tournaments.size) this.on_change([...entry.tournaments]);
            return;
        }
        if (post ? now < Math.max(this.post_retry_at, entry.retry_at) : now < entry.next_poll) return;
        const previous_status = entry.status;
        this.stepping = true;
        entry.busy = true;
        try {
            let response;
            if (post) {
                this.last_post = now;
                entry.revalidate = false;
                response = await this.request(this.config.base_url, this.config.api_key, 'POST', '/v1/speech',
                    current.request, this.config.timeout_ms);
            } else {
                response = await this.request(this.config.base_url, this.config.api_key, 'GET',
                    '/v1/jobs/' + current.job_id + (current.request.playback_profile ? '?playback_profile=' + current.request.playback_profile : ''), undefined, this.config.timeout_ms);
            }
            this.validate_response(entry, response);
            if (post && current.identity === this.identity && response.cache_hit === false) {
                entry.generated_for ||= new Set();
                for (const key of entry.tournaments) entry.generated_for.add(key);
                this.coverage.mark_generated(entry);
            }
            if (!post && response.job_id !== current.job_id) throw new Error('speech_invalid_response');
            current.job_id = response.job_id;
            if (post && current.identity === this.identity && response.cache_hit === false && response.status !== 'completed' && this.disk) {
                try { await this.disk.mark_generated(current.identity, entry.key, [...(entry.generated_for || [])]); }
                catch (_) { this.cache_error = 'speech_cache_unavailable'; }
            }
            if (current.identity === this.identity && response.status === 'completed' && this.disk) {
                // Completion means both the WAV and its index have reached disk.
                // Keep the current job occupied until publication finishes.
                try {
                    await this.disk.store(this.identity, entry.key, { ...response, fallback_stage: entry.fallback_stage,
                        generated_for: [...(entry.generated_for || [])] });
                    this.cache_error = null;
                } catch (error) { this.cache_error = 'speech_cache_unavailable'; throw error; }
                entry.local = true;
            }
            if (current.identity === this.identity) this.update(entry, response);
            else entry.next_poll = now + this.config.poll_interval_ms;
            if (current.identity === this.identity && response.status === 'completed') await this.coverage.remember();
            current.job_id = response.job_id;
            if (post) this.last_post_voice.set(entry.priority, entry.voice);
            if (['completed', 'failed'].includes(response.status)) this.current = null;
        } catch (error) {
            if (post && entry.fallback_source && [400, 413, 422].includes(error.status)) {
                entry.status = 'failed';
                this.failed_fallback_source(entry);
            }
            if (post && entry.source_key && error.response?.error?.code === 'audio_unavailable') {
                const parent = this.entries.get(entry.source_key);
                if (parent) { parent.status = 'unsubmitted'; parent.retry_at = 0; }
            }
            this.last_error = error.status === 429 ? 'speech_busy' : 'speech_unavailable';
            const delay = error.response?.error?.code === 'busy' ? 1000 : error.status === 429 ? 10000 : 5000;
            if (post && error.status === 429) this.post_retry_at = now + delay;
            if (post && [400, 401, 403, 404, 409, 413, 422, 429].includes(error.status)) this.current = null;
            if (!post && error.status === 404) {
                entry.status = 'unsubmitted'; entry.job_id = null; this.current = null;
            }
            if (post && entry.status === 'completed') entry.revalidate = true;
            // An ambiguous POST failure keeps ownership of this exact request.
            // Retrying it uses API single-flight rather than opening a second job.
            entry.retry_at = this.now() + delay;
            entry.next_poll = entry.retry_at;
        } finally {
            entry.busy = false;
            this.stepping = false;
            if (entry.status !== previous_status && ['completed', 'failed'].includes(entry.status) && entry.tournaments.size) {
                this.on_change([...entry.tournaments]);
            }
        }
    }

    start() {
        if (!this.config.enabled || !this.stopped) return;
        this.stopped = false;
        const tick = async () => {
            try {
                if (this.last_metadata + 15000 <= this.now()) await this.refresh();
                // Restored metadata supports offline playback, but must not
                // submit an old context plan while a new service starts.
                if (this.metadata_verified) await this.step();
            } catch (_) { this.last_error = 'speech_unavailable'; }
            if (!this.stopped) this.timer = setTimeout(tick, 100);
            this.timer?.unref();
        };
        void tick();
    }

    stop() {
        this.stopped = true;
        clearTimeout(this.timer);
    }
}

module.exports = { SpeechBroker, configuration };
