'use strict';

const fs = require('fs/promises'), path = require('path'), crypto = require('crypto');
const HASH = /^[a-f0-9]{64}$/, ID = /^[a-f0-9]{32}$/;
const TEST_TEXT = 'Dies ist eine Testaufnahme des BTS-Sprachhelfers. In Vorbereitung: Mixed U17. Bitte meldet euch bei der Turnierleitung!';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const identifier = () => crypto.randomBytes(16).toString('hex');
function failure(code, status = 400) { return Object.assign(new Error(code), { status, helper_error: true }); }
function clean(value, length = 80) {
    return typeof value === 'string' ? [...value].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').trim().slice(0, length) : '';
}

class HelperPool {
    constructor(directory, options = {}) {
        this.directory = path.resolve(directory);
        this.now = options.now || Date.now;
        this.lease_ms = options.lease_ms || 90000;
        this.pending = Promise.resolve();
        this.artifact = null;
        this.ready = this.load();
    }
    async load() {
        await fs.mkdir(path.join(this.directory, 'audio'), { recursive: true, mode: 0o700 });
        try {
            const text = await fs.readFile(path.join(this.directory, 'state.json'), 'utf8');
            if (text.length > 1024 * 1024) throw failure('helper_state_invalid');
            this.state = JSON.parse(text);
            if (this.state.schema !== 1 || !HASH.test(this.state.secret) ||
                !['workers', 'jobs', 'pairs'].every(key => Array.isArray(this.state[key])) ||
                this.state.workers.length > 32 || this.state.jobs.length > 100 || this.state.pairs.length > 64) throw failure('helper_state_invalid');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            this.state = { schema: 1, secret: crypto.randomBytes(32).toString('hex'), workers: [], jobs: [], pairs: [] };
        }
        await this.persist();
    }
    async persist() {
        const target = path.join(this.directory, 'state.json'), temp = target + '.tmp';
        await fs.writeFile(temp, JSON.stringify(this.state), { mode: 0o600 });
        await fs.rename(temp, target);
    }
    mutate(work) {
        const result = this.pending.then(async () => {
            await this.ready;
            const previous = JSON.stringify(this.state);
            try {
                this.expire();
                const value = await work();
                await this.persist(); return value;
            } catch (error) { this.state = JSON.parse(previous); throw error; }
        });
        this.pending = result.catch(() => {}); return result;
    }
    expire() {
        const now = this.now();
        this.state.pairs = this.state.pairs.filter(pair => pair.expires > now);
        for (const job of this.state.jobs) if (job.state === 'queued' && this.artifact && job.runtime_id !== this.artifact.id) {
            if (job.binding?.profile && job.binding.profile === this.artifact.generation_profile) {
                job.runtime_id = this.artifact.id; job.target_worker = null;
            } else { job.state = 'failed'; job.error = 'helper_update_required'; }
        }
        for (const job of this.state.jobs) if (job.state === 'processing' && job.deadline <= now) {
            const worker = this.state.workers.find(row => row.id === job.worker_id);
            if (worker?.job_id === job.id) worker.job_id = null;
            job.state = job.attempt >= 3 ? 'failed' : 'queued';
            job.error = 'helper_timeout'; job.worker_id = null; job.target_worker = null;
        }
    }
    async runtime() {
        try {
            const filename = path.join(this.directory, 'runtime.json');
            const info = await fs.stat(filename);
            if (info.size > 65536) throw failure('helper_runtime_invalid');
            const value = JSON.parse(await fs.readFile(filename, 'utf8'));
            if (value.schema !== 1 || !HASH.test(value.id) || !HASH.test(value.sha256) ||
                value.generation_profile !== undefined && !HASH.test(value.generation_profile) ||
                !Number.isSafeInteger(value.size_bytes) || value.size_bytes < 1024 || value.size_bytes > 8 * 1024 ** 3) throw failure('helper_runtime_invalid');
            const archive = path.join(this.directory, 'runtime.tar');
            const stat = await fs.stat(archive);
            if (stat.size !== value.size_bytes || !stat.isFile()) throw failure('helper_runtime_invalid');
            this.artifact = { ...value, path: archive };
            return this.artifact;
        } catch (error) {
            this.artifact = null;
            if (error.code === 'ENOENT') throw failure('helper_runtime_missing', 503);
            throw error;
        }
    }
    async pair() {
        const artifact = await this.runtime();
        return this.mutate(() => {
            if (this.state.pairs.length >= 64) throw failure('helper_pair_limit', 429);
            const key = token(), expires = this.now() + 8 * 3600000;
            this.state.pairs.push({ hash: digest(key), expires, worker_id: null });
            return { key, expires, runtime: { id: artifact.id, sha256: artifact.sha256, size_bytes: artifact.size_bytes } };
        });
    }
    pairing(key) {
        const pair = typeof key === 'string' && this.state.pairs.find(row => row.hash === digest(key));
        if (!pair || pair.expires <= this.now()) throw failure('helper_pair_expired', 401);
        return pair;
    }
    worker(key) {
        const worker = typeof key === 'string' && this.state.workers.find(row => row.session === digest(key));
        if (!worker || worker.revoked) throw failure('helper_unauthorized', 401);
        return worker;
    }
    async register(key, values) {
        values ||= {};
        const artifact = await this.runtime();
        return this.mutate(() => {
            const pair = this.pairing(key);
            if (!/^[a-f0-9-]{32,36}$/.test(values.device_id || '') || values.protocol !== 1 ||
                values.runtime_id !== artifact.id || !Number.isInteger(values.threads) || values.threads < 1 || values.threads > 16 ||
                values.memory_limit_mib !== undefined && (!Number.isInteger(values.memory_limit_mib) || values.memory_limit_mib < 2560 || values.memory_limit_mib > 16384) ||
                !clean(values.name)) throw failure('helper_incompatible', 409);
            let worker = pair.worker_id ? this.state.workers.find(row => row.id === pair.worker_id) :
                this.state.workers.find(row => row.device_id === values.device_id && !row.revoked);
            if (worker && worker.device_id !== values.device_id) throw failure('helper_pair_used', 401);
            if (!worker) {
                if (this.state.workers.length >= 32) throw failure('helper_worker_limit', 429);
                worker = { id: identifier(), device_id: values.device_id, paused: false, completed: 0 };
                this.state.workers.push(worker);
            }
            if (worker.job_id) throw failure('helper_already_working', 409);
            const session = token();
            Object.assign(worker, { name: clean(values.name), platform: clean(values.platform), threads: values.threads,
                memory_limit_mib: values.memory_limit_mib ?? 3584,
                runtime_id: values.runtime_id, session: digest(session), last_seen: this.now(), revoked: false });
            pair.worker_id = worker.id;
            return { worker_id: worker.id, session, lease_ms: this.lease_ms, protocol: 1 };
        });
    }
    leaseToken(job) {
        return crypto.createHmac('sha256', this.state.secret).update(JSON.stringify([job.id, job.worker_id, job.attempt, job.nonce])).digest('base64url');
    }
    lease(worker, id, lease) {
        const job = this.state.jobs.find(row => row.id === id);
        if (!job || job.state !== 'processing' || job.worker_id !== worker.id || job.deadline <= this.now() ||
            typeof lease !== 'string' || digest(lease) !== digest(this.leaseToken(job))) throw failure('helper_lease_lost', 409);
        return job;
    }
    async claim(key) {
        const artifact = await this.runtime();
        return this.mutate(() => {
            const worker = this.worker(key); worker.last_seen = this.now();
            if (worker.runtime_id !== artifact.id) throw failure('helper_update_required', 409);
            let job = this.state.jobs.find(row => row.id === worker.job_id && row.state === 'processing');
            if (!job && !worker.paused) {
                job = this.state.jobs.find(row => row.state === 'queued' && row.runtime_id === worker.runtime_id &&
                    (!row.target_worker || row.target_worker === worker.id));
                if (job) {
                    Object.assign(job, { state: 'processing', worker_id: worker.id, attempt: job.attempt + 1,
                        threads: worker.threads,
                        nonce: identifier(), deadline: this.now() + this.lease_ms, started_at: this.now(), error: null });
                    worker.job_id = job.id;
                }
            }
            return { paused: worker.paused, job: job ? { id: job.id, text: job.text, voice: job.voice, seed: job.seed ?? 42,
                lease: this.leaseToken(job), deadline: job.deadline } : null };
        });
    }
    async heartbeat(key, id, lease) {
        return this.mutate(() => {
            const worker = this.worker(key), job = this.lease(worker, id, lease);
            worker.last_seen = this.now(); job.deadline = this.now() + this.lease_ms;
            return { deadline: job.deadline };
        });
    }
    async resources(key, values) {
        return this.mutate(() => {
            const worker = this.worker(key);
            if (!Number.isInteger(values?.threads) || values.threads < 1 || values.threads > 16 ||
                !Number.isInteger(values.memory_limit_mib) || values.memory_limit_mib < 2560 || values.memory_limit_mib > 16384) throw failure('helper_invalid_resources');
            worker.threads = values.threads; worker.memory_limit_mib = values.memory_limit_mib;
            worker.last_seen = this.now(); return { accepted: true };
        });
    }
    async complete(key, id, lease, data, elapsed_ms) {
        if (!Buffer.isBuffer(data) || data.length > 16 * 1024 * 1024 || !require('../disk_cache').wav(data)) throw failure('helper_invalid_audio', 422);
        const sha256 = digest(data);
        return this.mutate(async () => {
            const worker = this.worker(key), existing = this.state.jobs.find(row => row.id === id);
            if (existing?.state === 'completed' && existing.worker_id === worker.id &&
                digest(lease || '') === digest(this.leaseToken(existing)) && existing.audio_sha256 === sha256) return { accepted: true };
            const job = this.lease(worker, id, lease);
            const filename = path.join(this.directory, 'audio', sha256 + '.wav');
            const temporary = filename + '.upload';
            await fs.writeFile(temporary, data, { mode: 0o600 }); await fs.rename(temporary, filename);
            Object.assign(job, { state: 'completed', audio_sha256: sha256, size_bytes: data.length, completed_at: this.now(),
                elapsed_ms: Number.isFinite(elapsed_ms) && elapsed_ms > 0 && elapsed_ms < 3600000 ? elapsed_ms : this.now() - job.started_at });
            worker.job_id = null; worker.last_seen = this.now(); worker.completed++;
            return { accepted: true };
        });
    }
    async fail(key, id, lease, code) {
        return this.mutate(() => {
            const worker = this.worker(key), job = this.lease(worker, id, lease);
            job.state = 'failed'; job.error = clean(code, 120) || 'helper_generation_failed';
            worker.job_id = null; worker.last_seen = this.now(); return { accepted: true };
        });
    }
    async test(tournament, voice, target_worker) {
        const artifact = await this.runtime();
        return this.mutate(() => {
            if (!['hallensprecher', 'hallensprecherin'].includes(voice)) throw failure('helper_invalid_voice');
            if (target_worker && !this.state.workers.some(row => row.id === target_worker && !row.revoked)) throw failure('helper_unknown_worker');
            if (target_worker && this.state.workers.find(row => row.id === target_worker).runtime_id !== artifact.id) throw failure('helper_update_required', 409);
            if (this.state.jobs.filter(row => ['queued', 'processing'].includes(row.state)).length >= 20) throw failure('helper_queue_full', 429);
            this.room();
            const job = { id: identifier(), kind: 'test', tournament, voice, text: TEST_TEXT, state: 'queued', target_worker: target_worker || null,
                attempt: 0, runtime_id: artifact.id, created_at: this.now() };
            this.state.jobs.push(job); return { id: job.id };
        });
    }
    room() {
        if (this.state.jobs.length < 100) return;
        const index = this.state.jobs.findIndex(row => !['queued', 'processing'].includes(row.state) && (!row.binding || row.settled));
        if (index < 0) throw failure('helper_queue_full', 429);
        this.state.jobs.splice(index, 1);
    }
    async generation_state() {
        return this.mutate(() => {
            for (const job of this.state.jobs) if (job.binding && job.state === 'queued' && job.target_worker &&
                !this.state.workers.some(worker => worker.id === job.target_worker && !worker.revoked && !worker.paused &&
                    this.now() - worker.last_seen < 30000)) job.target_worker = null;
            return { workers: this.state.workers.filter(worker => !worker.revoked && !worker.paused &&
            this.now() - worker.last_seen < 30000).map(worker => ({ ...worker, session: undefined })),
            jobs: this.state.jobs.filter(job => job.binding && !job.settled).map(job => structuredClone(job)) };
        });
    }
    async enqueue(binding, task, tournaments, target_worker) {
        const artifact = await this.runtime();
        if (artifact.generation_profile !== task.generation_profile) throw failure('helper_update_required', 409);
        return this.mutate(() => {
            const previous = this.state.jobs.find(row => row.binding?.upstream_id === binding.upstream_id && !row.settled);
            if (previous) return previous.id;
            if (!ID.test(binding.upstream_id) || !HASH.test(task.generation_profile) ||
                !['hallensprecher', 'hallensprecherin'].includes(task.voice) || typeof task.text !== 'string' ||
                !task.text.length || task.text.length > 380 || !Number.isInteger(task.seed) || task.seed < 0 || task.seed > 0xffffffff) throw failure('helper_invalid_task');
            this.room();
            const job = { id: identifier(), kind: 'source', binding, tournaments, voice: task.voice, text: task.text, seed: task.seed,
                state: binding.central_only ? 'validating' : 'queued', target_worker, attempt: 0, runtime_id: artifact.id, created_at: this.now() };
            this.state.jobs.push(job); return job.id;
        });
    }
    async settle(id, publication, error) {
        return this.mutate(() => {
            const job = this.state.jobs.find(row => row.id === id);
            if (!job || job.settled) return;
            if (['queued', 'processing'].includes(job.state)) {
                const worker = this.state.workers.find(row => row.id === job.worker_id);
                if (worker?.job_id === id) worker.job_id = null;
                job.state = 'failed';
            }
            Object.assign(job, { settled: true, publication, error: error || null });
            return job.audio_sha256;
        }).then(async sha => {
            if (sha && !this.state.jobs.some(job => job.audio_sha256 === sha && (!job.binding || !job.settled))) {
                await fs.unlink(path.join(this.directory, 'audio', sha + '.wav')).catch(error => { if (error.code !== 'ENOENT') throw error; });
            }
        });
    }
    async submitted(id) {
        return this.mutate(() => {
            const job = this.state.jobs.find(row => row.id === id && !row.settled);
            if (job) job.publication = 'checking';
        });
    }
    async result(job) {
        if (!HASH.test(job.audio_sha256 || '') || job.state !== 'completed') throw failure('helper_invalid_audio');
        const data = await fs.readFile(path.join(this.directory, 'audio', job.audio_sha256 + '.wav'));
        if (digest(data) !== job.audio_sha256) throw failure('helper_invalid_audio');
        return data;
    }
    async control(id, action) {
        return this.mutate(() => {
            const worker = this.state.workers.find(row => row.id === id);
            if (!worker || !['pause', 'resume', 'revoke'].includes(action)) throw failure('helper_invalid_control');
            if (action === 'revoke') {
                worker.revoked = true; worker.session = null;
                this.state.pairs = this.state.pairs.filter(pair => pair.worker_id !== id);
                const job = this.state.jobs.find(row => row.id === worker.job_id && row.state === 'processing');
                if (job) { job.state = 'queued'; job.target_worker = null; job.worker_id = null; }
                for (const queued of this.state.jobs) if (queued.state === 'queued' && queued.target_worker === id) queued.target_worker = null;
                worker.job_id = null;
            } else worker.paused = action === 'pause';
            return { accepted: true };
        });
    }
    grant(id, expires) {
        return crypto.createHmac('sha256', this.state.secret).update(JSON.stringify(['audio', id, expires])).digest('base64url');
    }
    async snapshot(tournament) {
        let runtime = null, error = null;
        try { const value = await this.runtime(); runtime = { id: value.id, size_bytes: value.size_bytes }; }
        catch (failure) { error = failure.message; }
        return this.mutate(() => ({ runtime, error, mode: 'production', generation: this.generation || { ready: false }, workers: this.state.workers.map(worker => ({
            id: worker.id, name: worker.name, platform: worker.platform, threads: worker.threads,
            memory_limit_mib: worker.memory_limit_mib ?? 3584,
            online: !worker.revoked && this.now() - worker.last_seen < 30000,
            paused: worker.paused, revoked: worker.revoked, completed: worker.completed, job_id: worker.job_id,
            last_seen: worker.last_seen, runtime_id: worker.runtime_id,
            update_required: worker.runtime_id !== runtime?.id,
            text: this.state.jobs.find(job => job.id === worker.job_id)?.text,
        })), jobs: this.state.jobs.filter(job => job.tournament === tournament || job.tournaments?.includes(tournament)).slice(-50).reverse().map(job => {
            const expires = Math.floor(this.now() / 1000) + 300;
            return { id: job.id, kind: job.kind || 'test', publication: job.publication, voice: job.voice, state: job.state, worker_id: job.worker_id, attempt: job.attempt,
                error: job.error, elapsed_ms: job.elapsed_ms, created_at: job.created_at, text: job.text,
                ...(job.state === 'completed' && !job.binding ? { audio_path: '/speech-helper/v1/audio/' + job.id + '?expires=' + expires + '&grant=' + this.grant(job.id, expires) } : {}) };
        }) }));
    }
    async asset(key) {
        await this.ready;
        try { this.worker(key); } catch (_) { this.pairing(key); }
        return this.runtime();
    }
    async audio(id, expires, grant) {
        await this.ready;
        if (!ID.test(id) || !/^\d{10}$/.test(expires || '') || Number(expires) < this.now() / 1000 ||
            Number(expires) > this.now() / 1000 + 600 || typeof grant !== 'string' || digest(grant) !== digest(this.grant(id, Number(expires)) )) {
            throw failure('helper_invalid_audio_grant', 401);
        }
        const job = this.state.jobs.find(row => row.id === id && row.state === 'completed');
        if (!job || !HASH.test(job.audio_sha256)) throw failure('helper_unknown_audio', 404);
        return path.join(this.directory, 'audio', job.audio_sha256 + '.wav');
    }
}
module.exports = { HelperPool, failure, TEST_TEXT, digest };
