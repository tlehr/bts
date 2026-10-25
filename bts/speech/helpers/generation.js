'use strict';

// Runs exclusively in the isolated speech process. Hosts receive exact source
// text and a seed, never upstream credentials, tournament data or DB access.
class HelperGeneration {
    constructor(broker, pool) {
        this.broker = broker;
        this.pool = pool;
        this.next = 0;
        this.parallelism = 0;
    }
    request(method, pathname, body, headers) {
        const b = this.broker;
        return b.request(b.config.base_url, b.config.api_key, method, pathname, body, b.config.timeout_ms, headers);
    }
    accepts(entry) {
        return entry.context?.kind === 'source' && entry.helper_skip !== this.broker.identity &&
            this.broker.request_for(entry).text.length <= 380;
    }
    execution(entry) {
        if (!entry.helper_job || entry.retired || entry.status === 'completed') return null;
        const job = this.pool.state?.jobs.find(job => job.id === entry.helper_job && !job.settled && job.binding?.identity === this.broker.identity);
        if (!job) return null;
        const worker = this.pool.state.workers.find(worker => worker.id === job.worker_id);
        if (['queued', 'processing'].includes(job.state)) return { kind: 'helper', name: worker?.name || 'Sprachhelfer',
            phase: job.state === 'processing' ? 'synthesis' : 'queued', running: job.state === 'processing' && job.deadline > this.broker.now() };
        if (['completed', 'validating'].includes(job.state)) {
            const running = (job.publication === 'checking' || job.binding.central_only) && entry.helper_central_status === 'processing';
            return { kind: 'server', name: 'Sprachserver', phase: running ? 'validation' : 'waiting_validation', running: !!running };
        }
        return null;
    }
    async cancel(job, entry, reason) {
        await this.request('POST', '/v1/helper-jobs/' + job.binding.upstream_id + '/cancel', {}).catch(() => {});
        await this.pool.settle(job.id, 'failed', reason);
        if (entry && !entry.retired && this.broker.entries.get(entry.key) === entry && job.binding.identity === this.broker.identity) {
            entry.status = 'unsubmitted'; entry.job_id = null; entry.retry_at = 0;
            entry.helper_skip = this.broker.identity;
            delete entry.helper_job;
            delete entry.helper_central_status;
        }
    }
    async completed(entry, response, identity) {
        const b = this.broker;
        await b.publish(entry, response, identity);
        if (b.recovery_dirty) await b.persist_recovery();
        delete entry.helper_job;
        delete entry.helper_central_status;
    }
    async step() {
        const b = this.broker, now = b.now();
        if (now < this.next || !b.metadata_verified) return;
        this.next = now + 1000;
        try {
            let runtime;
            try { runtime = await this.pool.runtime(); } catch (_) { runtime = null; }
            const profile = b.helper_generation_profile;
            const compatible = !!profile && runtime?.generation_profile === profile;
            this.parallelism = 0;
            this.pool.generation = { ready: compatible, reason: !profile ? 'speech_server_unavailable' :
                !compatible ? 'helper_profile_mismatch' : null };
            // Keep finished/leased work during an upstream outage. Losing a
            // health response does not mean its configuration has changed.
            if (!profile) return;
            const state = await this.pool.generation_state();
            const workers = state.workers.filter(worker => compatible && worker.runtime_id === runtime.id);
            this.parallelism = workers.length;
            // Reattach persistent reservations before admission. A restart may
            // have reconstructed the same entry as unsubmitted.
            for (const job of state.jobs) {
                const entry = b.entries.get(job.binding.key);
                if (!entry || entry.retired || job.binding.identity !== b.identity || job.binding.profile !== profile) {
                    await this.cancel(job, entry, 'helper_plan_changed'); continue;
                }
                entry.status = 'processing'; entry.revalidate = false; entry.helper_job = job.id;
                if (job.state === 'failed' || job.state === 'queued' && !workers.length && now - job.created_at > 10000) {
                    await this.cancel(job, entry, job.error || 'helper_unavailable'); continue;
                }
                let response;
                try { response = await this.request('GET', '/v1/jobs/' + job.binding.upstream_id); }
                catch (error) {
                    if (error.status === 404) { await this.cancel(job, entry, 'helper_assignment_lost'); continue; }
                    throw error;
                }
                b.validate_response(entry, response);
                if (response.job_id !== job.binding.upstream_id) throw new Error('speech_invalid_response');
                entry.helper_central_status = response.status;
                if (b.record_diagnostics(entry, response)) {
                    try { await b.failures.persist(); b.diagnostics_error = false; b.health.clear('diagnostics'); }
                    catch (error) { b.diagnostics_error = true; b.health.fail('diagnostics', error); }
                }
                if (response.status === 'failed') {
                    await this.cancel(job, entry, response.error?.code || 'helper_generation_failed'); continue;
                }
                if (response.status === 'completed') {
                    await this.completed(entry, response, job.binding.identity);
                    await this.pool.settle(job.id, 'ready'); continue;
                }
                if (job.state === 'completed' && job.publication !== 'checking') {
                    try {
                        const accepted = await this.request('POST', '/v1/helper-jobs/' + job.binding.upstream_id + '/result', await this.pool.result(job), {
                            'Content-Type': 'audio/wav', 'X-Helper-Generation-Profile': profile, 'X-Helper-Threads': String(job.threads),
                        });
                        b.validate_response(entry, accepted);
                        if (accepted.job_id !== job.binding.upstream_id) throw new Error('speech_invalid_response');
                        entry.helper_central_status = accepted.status;
                        await this.pool.submitted(job.id);
                    } catch (error) {
                        if (error.status === 429) continue; // Preserve the one central quality/CPU slot.
                        if ([404, 409, 422].includes(error.status)) { await this.cancel(job, entry, error.response?.error?.code || error.message); continue; }
                        throw error;
                    }
                }
            }
            if (!compatible) { b.health.clear('upstream_helpers'); return; }
            const occupied = new Set(state.jobs.filter(job => !job.settled && ['queued', 'processing'].includes(job.state))
                .map(job => job.target_worker || job.worker_id));
            const capacity = Math.max(0, Math.min(32, workers.length * 2) - state.jobs.length);
            const free = workers.filter(worker => !worker.job_id && !occupied.has(worker.id)).slice(0, capacity);
            for (const worker of free) {
                let entry = b.pending_order().find(item => this.accepts(item));
                const accept = item => this.accepts(item);
                if (!entry && !b.regular_work_pending()) entry = b.admit_idle('idle', { accept });
                if (!entry && b.spare_work_allowed()) entry = b.admit_idle('spare', { accept });
                if (!entry) break;
                if (b.restore(entry)) { b.on_change([...entry.tournaments]); continue; }
                entry.busy = true;
                let response;
                const identity = b.identity, request = b.request_for(entry);
                try {
                    response = await this.request('POST', '/v1/helper-jobs', { request, generation_profile: profile });
                    b.validate_response(entry, response);
                    if (response.status === 'completed') { await this.completed(entry, response, identity); continue; }
                    if (response.status === 'failed') { entry.helper_skip = identity; continue; }
                    const task = response.helper_task;
                    if (task && (task.text !== request.text || task.voice !== request.voice || task.seed !== (request.source_seed ?? 42) ||
                        task.generation_profile !== profile)) throw new Error('helper_invalid_task');
                    const binding = { key: entry.key, identity, profile, upstream_id: response.job_id, central_only: !task };
                    const id = await this.pool.enqueue(binding, task || { ...request, seed: request.source_seed ?? 42, generation_profile: profile },
                        [...entry.tournaments], worker.id);
                    entry.status = 'processing'; entry.job_id = response.job_id; entry.revalidate = false; entry.helper_job = id;
                    entry.helper_central_status = response.status;
                    entry.generated_for ||= new Set();
                    for (const key of entry.tournaments) entry.generated_for.add(key);
                    b.coverage.mark_generated(entry);
                    if (b.disk) await b.disk.mark_generated(identity, entry.key, [...entry.generated_for]);
                } catch (error) {
                    if (response?.job_id) await this.request('POST', '/v1/helper-jobs/' + response.job_id + '/cancel', {}).catch(() => {});
                    entry.helper_skip = identity;
                    entry.status = 'unsubmitted'; entry.job_id = null; delete entry.helper_job;
                    // Unsupported sources and older servers continue locally.
                    if (![404, 409, 422, 429].includes(error.status)) throw error;
                } finally { entry.busy = false; }
            }
            b.health.clear('upstream_helpers');
        } catch (error) {
            b.health.fail('upstream_helpers', error, true, { endpoint: b.config.base_url });
        }
    }
}
module.exports = { HelperGeneration };
