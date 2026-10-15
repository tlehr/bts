'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { request } = require('./http');
const { spellNumbers, VERSION: TEXT_VERSION } = require('./numbers');
const PRIORITY = { high: 0, normal: 1, low: 2 };
const ID = /^[0-9a-f]{32}$/;

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
        mode: ['browser', 'auto', 'server'].includes(config.mode) ? config.mode : 'auto',
        voice: config.voice === 'hallensprecher' ? 'hallensprecher' : 'hallensprecherin',
        deadline_ms: bounded(config.deadline_ms, 700, 50, 2000),
        timeout_ms: bounded(config.timeout_ms, 2500, 100, 10000),
        submit_interval_ms: bounded(config.submit_interval_ms, 650, 500, 10000),
        poll_interval_ms: bounded(config.poll_interval_ms, 2000, 500, 10000),
        prefetch_matches: bounded(config.prefetch_matches, 12, 1, 100),
        prefetch_interval_ms: bounded(config.prefetch_interval_ms, 30000, 5000, 300000),
        max_entries: bounded(config.max_entries, 512, 32, 4096),
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
        this.audio_clients = 0;
    }

    public_config(voice = this.config.voice) {
        const entries = [...this.entries.values()].filter(entry => entry.voice === voice);
        return {
            enabled: this.config.enabled, mode: this.config.mode, voice: this.config.voice,
            deadline_ms: this.config.deadline_ms, max_text: this.config.max_text,
            voices: this.voices, last_error: this.last_error,
            cache_version: this.identity ? crypto.createHash('sha256').update(this.identity).digest('hex') : null,
            preparing: entries.filter(item => ['unsubmitted', 'queued', 'processing'].includes(item.status)).length,
            ready: entries.filter(item => item.status === 'completed').length,
        };
    }

    key(text, voice, language) {
        return crypto.createHash('sha256').update(JSON.stringify([text, voice, language])).digest('hex');
    }

    validate(parts, options = {}) {
        if (!Array.isArray(parts) || parts.length > 64 ||
            parts.some(text => typeof text !== 'string' || text.length > this.config.max_text || !text.trim() ||
                spellNumbers(text).length > this.config.max_text)) {
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
            const key = this.key(text, normalized.voice, normalized.language);
            let entry = this.entries.get(key);
            if (!entry) {
                if (this.entries.size >= this.config.max_entries) {
                    const victim = [...this.entries.values()]
                        .filter(item => item !== this.current?.entry && !item.busy && !['queued', 'processing'].includes(item.status))
                        .filter(item => item.status !== 'unsubmitted' || item.priority >= PRIORITY[normalized.priority])
                        .sort((a, b) => b.priority - a.priority || a.used - b.used)[0];
                    if (!victim) continue;
                    this.entries.delete(victim.key);
                }
                entry = {
                    key, text, ...normalized, priority: PRIORITY[normalized.priority],
                    status: 'unsubmitted', created: this.now(), used: this.now(),
                    retry_at: 0, next_poll: 0, busy: false,
                    tournaments: new Set(),
                };
                this.entries.set(key, entry);
            }
            if (tournament_key) entry.tournaments.add(tournament_key);
            entry.used = this.now();
            if (PRIORITY[normalized.priority] < entry.priority) {
                entry.priority = PRIORITY[normalized.priority];
            }
            if (entry.status === 'failed' && entry.retry_at <= this.now()) entry.status = 'unsubmitted';
            // Revalidate preference/configuration occasionally through the authoritative cache.
            if (entry.status === 'completed' && entry.checked + 300000 < this.now()) entry.revalidate = true;
            if (normalized.priority === 'high') entry.next_poll = 0;
        }
        return normalized;
    }

    views(parts, options, tournament_key) {
        const { voice, language } = this.validate(parts, options);
        return parts.map(text => {
            const entry = this.entries.get(this.key(text, voice, language));
            return entry?.status === 'completed' ? {
                status: 'completed',
                audio_url: this.audio_url(tournament_key, entry.audio_id, entry),
            } : { status: entry?.status || 'unsubmitted', audio_url: null };
        });
    }

    inspect(parts, options, tournament_key) {
        const { voice, language } = this.validate(parts, options);
        return parts.map(text => {
            const entry = this.entries.get(this.key(text, voice, language));
            return { status: entry?.status || 'missing',
                ...(entry?.status === 'completed' && tournament_key ?
                    { audio_url: this.audio_url(tournament_key, entry.audio_id, entry) } : {}),
            };
        });
    }

    select_voice(tournament_key, voice) {
        for (const [key, entry] of this.entries) {
            if (!entry.tournaments.has(tournament_key) || entry.voice === voice) continue;
            entry.tournaments.delete(tournament_key);
            // A submitted request retains its independent current slot until it
            // finishes. Removing its local cache entry never opens another slot.
            if (!entry.tournaments.size) this.entries.delete(key);
        }
    }

    pending_order(now = this.now()) {
        const eligible = [...this.entries.values()].filter(entry => entry !== this.current?.entry && !entry.busy &&
            (entry.status === 'unsubmitted' || entry.revalidate) && entry.retry_at <= now);
        const ordered = [];
        for (const priority of [0, 1, 2]) {
            const voices = new Map();
            for (const entry of eligible.filter(item => item.priority === priority).sort((a, b) => a.created - b.created)) {
                if (!voices.has(entry.voice)) voices.set(entry.voice, []);
                voices.get(entry.voice).push(entry);
            }
            let last = this.current?.entry.priority === priority ? this.current.request.voice : this.last_post_voice.get(priority);
            while (voices.size) {
                const next = [...voices.values()].map(items => items[0]).sort((a, b) =>
                    Number(a.voice === last) - Number(b.voice === last) || a.created - b.created)[0];
                ordered.push(next);
                last = next.voice;
                const items = voices.get(next.voice);
                items.shift();
                if (!items.length) voices.delete(next.voice);
            }
        }
        return ordered;
    }

    queue(tournament_key) {
        const current = this.current?.entry;
        const pending = this.pending_order();
        const scheduled = new Set([current, ...pending]);
        const rest = [...this.entries.values()].filter(entry => !scheduled.has(entry))
            .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') ||
                a.priority - b.priority || a.created - b.created);
        const ordered = [...(current ? [current] : []), ...pending, ...rest];
        const positions = new Map(pending.map((entry, index) => [entry, index + 1]));
        return {
            busy_elsewhere: !!current && !current.tournaments.has(tournament_key),
            items: ordered.filter(entry => entry.tournaments.has(tournament_key)).map(entry => ({
                key: entry.key, text: entry.text, voice: entry.voice, language: entry.language, tournament_key,
                priority: Object.keys(PRIORITY)[entry.priority], status: entry.status,
                position: entry === current ? 0 : positions.get(entry) ?? null,
                current: entry === current, retry_at: Math.max(entry.retry_at, this.post_retry_at),
                audio_url: entry.status === 'completed' ? this.audio_url(tournament_key, entry.audio_id, entry) : null,
            })),
        };
    }

    audio_url(tournament_key, audio_id, entry) {
        const expires = Math.floor(this.now() / 1000) + this.config.audio_url_ttl_seconds;
        const playback = entry?.voice === 'hallensprecher' ? /[,;:.!?\r\n]/.test(entry.text) ? 'edges-v1' : 'words-v1' : '';
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
        if (state?.model_revision) {
            const identity = JSON.stringify([TEXT_VERSION, state.configuration_version, state.backend, state.model, state.model_revision, this.voices]);
            if (this.identity && identity !== this.identity) {
                for (const entry of this.entries.values()) {
                    entry.status = 'unsubmitted';
                    entry.job_id = null;
                    entry.retry_at = 0;
                }
            }
            this.identity = identity;
            this.last_error = state.status === 'starting' || state.status === 'error' ? 'speech_unavailable' : null;
        } else this.last_error = 'speech_unavailable';
        this.last_metadata = this.now();
    }

    validate_response(entry, response) {
        if (!ID.test(response.job_id) || response.text !== spellNumbers(entry.text) || response.voice !== entry.voice ||
            response.language !== entry.language || !['queued', 'processing', 'completed', 'failed'].includes(response.status)) {
            throw new Error('speech_invalid_response');
        }
        if (response.status === 'completed' && !ID.test(response.audio?.audio_id)) {
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
            this.last_error = null;
        } else if (response.status === 'failed') {
            entry.retry_at = this.now() + 30000;
            this.last_error = 'speech_generation_failed';
        }
    }

    async step() {
        if (this.stepping) return;
        const now = this.now();
        if (!this.current) {
            if (now < this.post_retry_at || now - this.last_post < this.config.submit_interval_ms) return;
            const pending = this.pending_order(now);
            const entry = pending[0];
            if (!entry) return;
            this.current = { entry, identity: this.identity, job_id: null, request: {
                text: spellNumbers(entry.text), voice: entry.voice, language: entry.language,
                priority: Object.keys(PRIORITY)[entry.priority],
            } };
        }
        const current = this.current;
        const entry = current.entry;
        const post = !current.job_id;
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
                    '/v1/jobs/' + current.job_id, undefined, this.config.timeout_ms);
            }
            this.validate_response(entry, response);
            if (!post && response.job_id !== current.job_id) throw new Error('speech_invalid_response');
            if (current.identity === this.identity) this.update(entry, response);
            else entry.next_poll = now + this.config.poll_interval_ms;
            current.job_id = response.job_id;
            if (post) this.last_post_voice.set(entry.priority, entry.voice);
            if (['completed', 'failed'].includes(response.status)) this.current = null;
        } catch (error) {
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
                await this.step();
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
