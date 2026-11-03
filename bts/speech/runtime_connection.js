'use strict';

const crypto = require('crypto');
const SpeechDiskCache = require('./disk_cache');
const { SpeechFailures } = require('./failures');

// Only the isolated speech loop is paused. Its HTTP audio listener, signing key,
// helper sessions and already published audio grants remain in place.
async function change(service, next) {
    const {broker, prefetch} = service;
    const fields = {base_url:next.base_url, api_key:next.api_key, enabled:next.enabled, configured:next.configured};
    if (Object.keys(fields).every(key => broker.config[key] === fields[key])) return;
    const resume = !broker.stopped || service.started;
    broker.reconfiguring = true;
    broker.stop();
    try {
        await broker.cycle;
        // Requests in the previous tick have completed; no late upstream response
        // can now attach an old job identifier to the new connection.
        const oldConfig = {...broker.config}, oldDisk = broker.disk;
        let disk = oldDisk?.config.base_url === fields.base_url ? oldDisk : null;
        const combined = {...oldConfig, ...fields};
        if (next.enabled && combined.cache_enabled && combined.cache_dir && !disk) {
            disk = new SpeechDiskCache(combined);
            // Verification is asynchronous, just as it is at startup.
            void disk.ready.catch(error => broker.health.fail('cache', error));
        }
        const pool = service.helpers;
        if (pool) {
            const state = await pool.generation_state();
            for (const job of state.jobs) await pool.settle(job.id, 'failed', 'helper_server_changed');
            void Promise.allSettled(state.jobs.map(job => broker.request(oldConfig.base_url, oldConfig.api_key,
                'POST', '/v1/helper-jobs/' + job.binding.upstream_id + '/cancel', {}, oldConfig.timeout_ms)));
            pool.generation = {ready:false, reason:'speech_connection_changed'};
        }
        // Keep the old endpoint and cache for the complete lifetime of its grants.
        const now = broker.now();
        if (!broker.audio_connections) broker.audio_connections = new Map([[null, {config:oldConfig, disk:oldDisk, until:Infinity}]]);
        const previous = broker.audio_connections.get(broker.connection_generation || null);
        if (previous) previous.until = now + oldConfig.audio_url_ttl_seconds * 1000;
        for (const [id, value] of broker.audio_connections) if (value.until < now) broker.audio_connections.delete(id);
        broker.connection_generation = crypto.randomBytes(16).toString('hex');
        broker.audio_connections.set(broker.connection_generation, {config:combined, disk, until:Infinity});
        broker.config = combined;
        if (disk) disk.config = combined;
        broker.disk = disk;
        if (disk !== oldDisk) broker.failures = new SpeechFailures(disk, broker.now);
        broker.metadata_verified = false;broker.last_metadata = 0;broker.helper_generation_profile = null;
        if (broker.helpers) broker.helpers.next = 0;
        broker.last_error = next.enabled ? 'speech_connecting' : null;
        broker.current = null;broker.last_post = -Infinity;broker.post_retry_at = 0;broker.last_post_voice.clear();
        for (const entry of broker.entries.values()) {
            if (entry.status === 'completed' && oldConfig.base_url === fields.base_url) continue;
            entry.status = 'unsubmitted';entry.job_id = null;entry.audio_id = null;entry.local = false;
            entry.retry_at = 0;entry.next_poll = 0;entry.busy = false;
            entry.revalidate = false;
            if (oldConfig.base_url !== fields.base_url) {
                delete entry.terminal_failure;delete entry.recovery_loaded;delete entry.generated_for;
            }
            delete entry.helper_job;delete entry.helper_central_status;delete entry.helper_skip;delete entry.waiting_for_server;
        }
        for (const source of [...broker.health.issues.keys()]) if (source.startsWith('upstream_') || source === 'configuration') broker.health.clear(source);
        if (!next.enabled) prefetch.stop();
        else for (const key of prefetch.subscriptions.keys()) prefetch.schedule(key);
        broker.on_change([...prefetch.subscriptions.keys()]);
    } finally {
        broker.reconfiguring = false;
        // A failed cache/pool write leaves the previous connection usable.
        if (broker.config.enabled && resume) {
            broker.start();
            if (!prefetch.app.speech_snapshot) prefetch.start();
        }
    }
}

function attach(service) {
    let pending = Promise.resolve();
    service.reconfigure_connection = next => {
        const operation = pending.then(() => change(service, next));
        pending = operation.catch(() => {});return operation;
    };
    return service;
}

// Keep grants across a restart of the isolated speech process as well. This
// state travels only over private IPC, never through admin/public responses.
function snapshot(broker) {
    if (!broker.audio_connections) return null;
    return {generation:broker.connection_generation, connections:[...broker.audio_connections]
        .filter(([,value]) => value.until >= broker.now()).map(([id,value]) => [id, {
            config:{base_url:value.config.base_url,api_key:value.config.api_key,enabled:value.config.enabled,configured:value.config.configured},until:value.until,
        }])};
}

function restore(broker, state) {
    if (!state) return;
    broker.connection_generation = state.generation;
    broker.audio_connections = new Map(state.connections.map(([id,value]) => {
        const config = {...broker.config,...value.config};
        let disk = id === state.generation ? broker.disk : null;
        if (!disk && config.enabled && config.cache_enabled && config.cache_dir) {
            try {
                disk = new SpeechDiskCache(config);
                void disk.ready.catch(error => broker.health.fail('cache',error));
            } catch (_) { /* Old grants can still use their original endpoint. */ }
        }
        return [id,{config,disk,until:value.until}];
    }));
}

module.exports = {attach,snapshot,restore};
