'use strict';

const { Worker } = require('worker_threads');
const ProcessWorker = require('../offload/process');
const traces = require('../performance/traces');
const path = require('path');
const resolveSettings = require('../../static/js/speech_settings');
const snapshot = require('./snapshot');
const { affectsPlan, CALL_EVENTS } = require('./prefetch');

class SpeechWorker {
    constructor(app, config) {
        this.app = app;
        this.config = config;
        this.health = require('./health').health(app);
        this.worker = null;
        this.stopped = true;
        this.pending = new Map();
        this.next_id = 0;
        this.subscriptions = new Map();
        this.changes = new Set();
        this.configs = new Map();
        this.snapshots = new Map();
        this.bridge = { sent: 0, send_total_ms: 0, send_max_ms: 0, snapshots: 0 };
        this.signing_key = require('crypto').randomBytes(32);
        this.broker = { config, public_config: voice => this.public_config(voice) };
        this.prefetch = {
            settings: key => resolveSettings(this.subscriptions.get(key), config),
            schedule: key => this.send({ type: 'schedule', key }),
        };
    }

    public_config(voice = this.config.voice) {
        return this.configs.get(voice) || { enabled: true, mode: this.config.mode, voice: this.config.voice,
            deadline_ms: this.config.deadline_ms, max_text: this.config.max_text, max_part_length: this.config.max_text * 4 + 512,
            context_version: null, cache_version: null, voices: [], last_error: 'speech_unavailable', preparing: 0, ready: 0 };
    }

    configure(tournament) {
        const selected = snapshot.settings(tournament);
        const previous = this.subscriptions.get(tournament.key);
        this.subscriptions.set(tournament.key, selected);
        if (JSON.stringify(previous) !== JSON.stringify(selected)) this.send({ type: 'configure', tournament: selected });
    }

    loaded(tournament, ws) {
        ws.speech_tournament_key = tournament.key;
        this.configure(tournament);
        this.send({ type: 'subscribe', key: tournament.key });
        const selected = this.prefetch.settings(tournament.key);
        tournament.speech = { ...this.public_config(selected.voice), ...selected };
    }

    changed(key, type, value) {
        if (!affectsPlan(type, value)) return;
        if (CALL_EVENTS.has(type)) {
            const game = value?.match || value;
            this.send({ type: 'changed', key, event: type, value: game?.setup ? snapshot.match(game) : null });
        } else {
            this.changes.add(key);
            if (!this.change_task) this.change_task = setImmediate(() => {
                this.change_task = null;
                for (const key of this.changes) this.send({ type: 'schedule', key });
                this.changes.clear();
            });
        }
    }

    request(message) {
        // Bound data before structured cloning, including requests from old or
        // malformed clients. Detailed text/context validation stays in worker.
        const fields = ['type', 'tournament_key', 'voice', 'language', 'audio_urls', 'pending_only', 'kind', 'group', 'offset', 'limit', 'state', 'match_id', 'revision', 'endpoint', 'worker_id', 'action'];
        const payload = {};
        for (const key of fields) if (message[key] !== undefined) {
            const value = message[key];
            if (!['string', 'boolean', 'number'].includes(typeof value) || typeof value === 'string' && value.length > 256) {
                return Promise.resolve({ speech_error: 'invalid_speech_request', clips: [] });
            }
            payload[key] = value;
        }
        const strings = (values, count, length) => Array.isArray(values) && values.length <= count &&
            values.every(value => typeof value === 'string' && value.length <= length);
        for (const key of ['parts', 'states']) if (message[key] !== undefined) {
            if (!strings(message[key], key === 'parts' ? 64 : 8, key === 'parts' ? this.config.max_text * 4 + 512 : 32)) {
                return Promise.resolve({ speech_error: 'invalid_speech_request', clips: [] });
            }
            payload[key] = message[key];
        }
        if (message.requests !== undefined) {
            if (!Array.isArray(message.requests) || message.requests.length > 8) return Promise.resolve({ speech_error: 'invalid_speech_request' });
            payload.requests = [];
            for (const query of message.requests) {
                if (!query || typeof query !== 'object' || query.states !== undefined && !strings(query.states, 8, 32)) {
                    return Promise.resolve({ speech_error: 'invalid_speech_request' });
                }
                const row = {};
                for (const field of ['kind', 'group', 'offset', 'limit', 'state']) if (query[field] !== undefined) {
                    if (!['string', 'number'].includes(typeof query[field]) || String(query[field]).length > 64) {
                        return Promise.resolve({ speech_error: 'invalid_speech_request' });
                    }
                    row[field] = query[field];
                }
                if (query.states !== undefined) row.states = query.states;
                payload.requests.push(row);
            }
        }
        payload._effective_now_ts = this.app.clock?.now_ms() ?? Date.now();
        payload._clock_fixed = this.app.clock?.get_state?.().mode === 'fixed';
        return this.call('request', payload);
    }

    send(message) {
        if (!this.worker || this.stopped) return false;
        const start = process.hrtime.bigint(), span = traces.begin('speech_bridge_send', 'encoding', { ctype: message.type });
        try { this.worker.postMessage(message); return true; }
        catch (error) { traces.end(span, error); this.failed(this.worker, error); return false; }
        finally {
            const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
            this.bridge.sent++; this.bridge.send_total_ms += elapsed;
            this.bridge.send_max_ms = Math.max(this.bridge.send_max_ms, elapsed);
            traces.end(span);
        }
    }

    diagnostics() {
        return { execution: this.config.worker_type || 'thread', running: !!this.worker && !this.stopped,
            pid: this.worker?.pid || null, thread_id: this.worker?.threadId ?? null,
            pending_requests: this.pending.size, ...this.bridge };
    }

    call(operation, payload) {
        if (!this.worker || this.stopped || this.pending.size >= 128) return Promise.reject(new Error('speech_unavailable'));
        return new Promise((resolve, reject) => {
            const id = ++this.next_id;
            const timer = setTimeout(() => {
                // A stuck speech worker cannot accumulate unbounded requests.
                this.failed(this.worker, new Error('speech_worker_timeout (5000 ms)'));
            }, 5000);
            this.pending.set(id, { resolve, reject, timer });
            try { this.send({ type: 'call', id, operation, payload }); }
            catch (error) { this.failed(this.worker, error); }
        });
    }

    start() {
        if (!this.stopped) return;
        this.stopped = false;
        this.launch();
    }

    launch() {
        if (this.stopped) return;
        let worker;
        try {
            const base_port = this.app.config.enable_https ? this.app.config.https_port : this.app.config.port;
            const listener = { host: this.app.config.host, port: this.config.audio_port ?? (base_port > 0 && base_port < 65535 ? base_port + 1 : 0),
                tls: this.app.config.enable_https ? { key: this.app.config.https_key, cert: this.app.config.https_cert } : null };
            const Process = this.config.worker_type === 'process' ? ProcessWorker : Worker;
            worker = new Process(path.join(__dirname, this.config.worker_type === 'process' ? 'process.js' : 'worker.js'),
                { workerData: { config: this.config, signing_key: this.signing_key, listener } });
        } catch (error) { this.failed(null, error); return; }
        this.worker = worker;
        this.snapshots.clear();
        worker.on('message', message => {
            if (this.worker !== worker) return;
            try {
                if (message.type === 'diagnostics_logs') {
                    for (const entry of (message.entries || []).slice(0, 20)) this.app.diagnostics?.record({ ...entry, source: 'speech' });
                } else if (message.type === 'fatal') {
                    throw Object.assign(new Error(message.error.message), message.error);
                } else if (message.type === 'ready' || message.type === 'change' || message.type === 'config') {
                    if (message.type === 'ready') this.health.clear('worker');
                    this.configs = new Map(message.configs);
                    if (message.type === 'change') for (const key of message.keys) require('../admin').notify_change(this.app, key, 'speech_cache_changed', {});
                } else if (message.type === 'health') {
                    this.health.adopt(message.health);
                } else if (message.type === 'snapshot') {
                    if (!this.snapshots.has(message.key)) this.snapshots.set(message.key, {});
                    this.bridge.snapshots++;
                    void traces.operation('speech_snapshot', { type: 'other', tournament_key: message.key }, () => snapshot.deliver(this.app, message.key, chunk => {
                        if (this.worker !== worker || this.stopped) return false;
                        return this.send({ type: 'snapshot_chunk', id: message.id, ...chunk });
                    }, this.snapshots.get(message.key))).then(() => {
                        if (this.worker === worker) this.health.clear('snapshot');
                    }).catch(error => {
                        if (this.worker !== worker || this.stopped) return;
                        this.health.fail('snapshot', error);
                        if (this.worker === worker) this.send({ type: 'snapshot_chunk', id: message.id, error: true });
                    });
                } else if (message.type === 'reply') {
                    const job = this.pending.get(message.id);
                    if (!job) return;
                    this.pending.delete(message.id); clearTimeout(job.timer);
                    if (message.value?.speech) this.configs.set(message.value.speech.voice, message.value.speech);
                    if (message.error) job.reject(new Error('speech_unavailable'));
                    else job.resolve(message.value);
                }
            } catch (error) { this.failed(worker, error); }
        });
        worker.on('error', error => this.failed(worker, error));
        worker.on('exit', code => this.failed(worker, new Error('speech_worker_exited (code ' + code + ')')));
        worker.unref();
        // Subscribe every tournament, even with no browser connected. No DB
        // cursor is opened: these are read-only committed persistence revisions.
        try {
            for (const tournament of this.app.db.tournaments.getAllData()) if (!this.subscriptions.has(tournament.key)) this.configure(tournament);
            for (const tournament of this.subscriptions.values()) this.send({ type: 'configure', tournament });
        } catch (error) { this.failed(worker, error); }
    }

    failed(worker, error) {
        if (this.worker !== worker) return;
        if (error && !this.stopped) this.health.fail('worker', error);
        this.worker = null;
        this.configs.clear();
        if (worker) void worker.terminate().catch(() => {});
        for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(new Error('speech_unavailable')); }
        this.pending.clear();
        if (!this.stopped && !this.restart_timer) {
            this.restart_timer = setTimeout(() => { this.restart_timer = null; this.launch(); }, 1000);
            this.restart_timer.unref();
        }
    }

    stop() {
        this.stopped = true;
        clearTimeout(this.restart_timer); this.restart_timer = null;
        clearImmediate(this.change_task); this.change_task = null; this.changes.clear();
        this.failed(this.worker);
    }
}

module.exports = SpeechWorker;
