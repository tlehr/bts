'use strict';

const { isMainThread, parentPort, workerData } = require('worker_threads');
const { compareThings } = require('nedb/lib/model');
const { create_inline, handle } = require('./index');
function start(parentPort, workerData) {
    let diagnosticsVerbose = 0;
    const logEntries = [];
    require('../diagnostics/capture').subscribe({ verbose: () => Date.now() < diagnosticsVerbose, record: entry => {
        if (logEntries.length < 100) logEntries.push(entry);
    } });
    setInterval(() => {
        if (logEntries.length) parentPort.postMessage({ type: 'diagnostics_logs', entries: logEntries.splice(0, 20) });
    }, 1000).unref();
    const snapshots = new Map();
    const mirrors = new Map();
    let next_snapshot = 0;
    const app = require('express')();
    app.config = {};
    app.db = {};
    app.speech_snapshot = key => new Promise((resolve, reject) => {
            const id = ++next_snapshot;
            const previous = mirrors.get(key);
            snapshots.set(id, { key, resolve, reject, values: Array.from({ length: 7 }, (_, i) => new Map(previous?.[i])) });
            parentPort.postMessage({ type: 'snapshot', id, key });
        });
    app.speech = create_inline(app, workerData.config);
    app.speech.health.on_change = health => parentPort.postMessage({ type: 'health', health });
    parentPort.postMessage({ type: 'health', health: app.speech.health.snapshot() });
    const { broker, prefetch } = app.speech;
    broker.signing_key = Buffer.from(workerData.signing_key);
    require('./runtime_connection').restore(broker, workerData.connection_state);
    let audio_endpoint = null;
    const public_config = broker.public_config.bind(broker);
    broker.public_config = voice => ({ ...public_config(voice), audio_endpoint });
    // Audio and authenticated helper endpoints live on this listener.
    // The upstream API key and tournament control are never exposed here.
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'ETag, Content-Range, Accept-Ranges');
        if (req.method === 'OPTIONS') {
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Range, If-Range, If-None-Match');
            res.status(204).end(); return;
        }
        next();
    });
    app.get('/h/:tournament_key/speech/audio/:audio_id', require('./proxy'));
    app.use('/speech-helper/v1', (_req,res) => res.status(409).json({error:'helper_server_moved'}));
    const { listener } = workerData;
    const server = listener.tls ? require('https').createServer({
        key: require('fs').readFileSync(listener.tls.key), cert: require('fs').readFileSync(listener.tls.cert),
    }, app) : require('http').createServer(app);
    // A listen failure exits this worker; the main thread stays responsive and
    // reports speech_unavailable until its bounded restart succeeds.
    server.on('error', error => { throw error; });
    const configs = () => ['hallensprecherin', 'hallensprecher'].map(voice => [voice, broker.public_config(voice)]);
    broker.on_change = keys => parentPort.postMessage({ type: 'change', keys, configs: configs() });
    let previous_config = '';
    setInterval(() => {
        const current = configs(), encoded = JSON.stringify(current);
        if (previous_config !== encoded) { previous_config = encoded; parentPort.postMessage({ type: 'config', configs: current }); }
    }, 1000).unref();
    // Prefetch subscriptions arrive from the main thread's committed revisions;
    // its database object is deliberately absent from this worker.
    let onListening;
    const listening = new Promise(resolve => {onListening = resolve;});
    server.listen(listener.port, listener.host, () => {
        audio_endpoint = { port: server.address().port, protocol: listener.tls ? 'https:' : 'http:' };
        if (broker.config.audio_origin) {
            const origin = new URL(broker.config.audio_origin);
            if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
                throw new Error('invalid_speech_audio_origin');
            }
            audio_endpoint.origin = origin.origin;
        }
        app.speech.started = true;
        broker.start();
        parentPort.postMessage({ type: 'ready', configs: configs() });
        onListening();
    });
    const interval = setInterval(() => {
        for (const key of prefetch.subscriptions.keys()) prefetch.schedule(key);
    }, broker.config.prefetch_interval_ms);
    interval.unref();

    parentPort.on('message', async message => {
        try {
            if (message.type === 'snapshot_chunk') {
                const pending = snapshots.get(message.id);
                if (!pending) return;
                if (message.error || message.done) {
                    snapshots.delete(message.id);
                    if (message.error) pending.reject(new Error('speech_snapshot_unavailable'));
                    else {
                        mirrors.set(pending.key, pending.values);
                        // Match NeDB's query order. Locale collation changes the
                        // order of overlapping pronunciation rules (e.g. Ng/Nguyen)
                        // and would prepare different text than the browser uses.
                        const values = pending.values.map(collection => [...collection.values()].sort((a, b) => compareThings(a._id, b._id)));
                        values[0] = values[0][0] || null;
                        if (values[0] && Number.isFinite(message.now_ts)) values[0] = { ...values[0], speech_now_ts: message.now_ts };
                        pending.resolve(values);
                    }
                } else {
                    const values = pending.values[message.collection];
                    for (const id of message.removed || []) values.delete(id);
                    for (const document of message.documents) values.set(document._id, document);
                }
            } else if (message.type === 'diagnostics_configuration') diagnosticsVerbose = message.verbose_until || 0;
            else if (message.type === 'configure') prefetch.configure(message.tournament);
            else if (message.type === 'subscribe') prefetch.subscribe(message.key);
            else if (message.type === 'schedule') prefetch.schedule(message.key);
            else if (message.type === 'changed') prefetch.changed(message.key, message.event, message.value);
            else if (message.type === 'call') {
                let value;
                if (message.operation === 'request') {
                    const msg = message.payload;
                    await handle(app, { speech_tournament_key: msg.tournament_key, respond: (_msg, _error, response) => { value = response; } }, msg);
                } else if (message.operation === 'connection') {
                    await listening;
                    await app.speech.reconfigure_connection(message.payload);
                    value = {configs: configs(), connection_state:require('./runtime_connection').snapshot(broker)};
                } else throw new Error('invalid_speech_operation');
                parentPort.postMessage({ type: 'reply', id: message.id, value });
            }
        } catch (error) {
            app.speech.health.fail('worker_message', error);
            if (message.type === 'call') parentPort.postMessage({ type: 'reply', id: message.id, error: true });
            else broker.last_error = 'prefetch_unavailable';
        }
    });
}

if (!isMainThread) start(parentPort, workerData);
module.exports = { start };
