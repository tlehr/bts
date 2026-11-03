'use strict';

const fs = require('fs/promises');
const crypto = require('crypto');
const { configuration } = require('./broker');
const { request } = require('./http');
const states = new WeakMap();
const labels = {
    ready: 'Verbindung erfolgreich. Der Sprachserver ist bereit.',
    starting: 'Verbindung erfolgreich. Der Sprachserver lädt seine Modelle noch.',
    unauthorized: 'Der Sprachserver hat den Zugangsschlüssel abgewiesen.',
    unavailable: 'Der Sprachserver ist nicht erreichbar. Adresse, Port und Netzwerkverbindung prüfen.',
    timeout: 'Der Sprachserver antwortet nicht rechtzeitig.',
    invalid: 'Die Antwort stammt nicht von einem unterstützten Sprachserver.',
};
const fail = code => { throw new Error(code); };
const keyValid = key => typeof key === 'string' && /^[\x20-\x7e]{32,4096}$/.test(key);
function origin(value) {
    if (typeof value !== 'string' || value.length > 2048) return fail('speech_connection_invalid_url');
    let url;
    try { url = new URL(value); } catch (_) { return fail('speech_connection_invalid_url'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return fail('speech_connection_invalid_url');
    return url.origin;
}
const signature = config => crypto.createHash('sha256').update(JSON.stringify([config.configured, config.base_url, config.api_key])).digest('hex');
function state(app) {
    if (!states.has(app)) states.set(app, {pending: Promise.resolve(), last: null});
    return states.get(app);
}
async function read(app) {
    const document = app.config_file ? JSON.parse(await fs.readFile(app.config_file, 'utf8')) : app.config;
    const config = configuration(document.speech);
    const active = app.speech?.broker?.config || configuration(app.config.speech);
    const locked = {
        url: process.env.BTS_SPEECH_URL !== undefined,
        enabled: process.env.BTS_SPEECH_ENABLED !== undefined,
        api_key: process.env.BTS_SPEECH_API_KEY !== undefined || process.env.BTS_SPEECH_API_KEY_FILE !== undefined,
    };
    const revision = signature(config), active_revision = signature(active);
    const last = state(app).last;
    const publicSpeech = app.speech?.broker?.public_config?.() || {};
    const issues = app.speech?.health?.snapshot?.().issues || [];
    const connectionFailed = issues.some(issue => issue.kind === 'upstream_connection' && issue.since >= (last?.result.checked_at || 0));
    const recent = last?.revision === revision && last.result.checked_at + 15000 > Date.now();
    const status = revision === active_revision && config.configured && recent && !connectionFailed ? last.result : {
        state: revision !== active_revision ? 'apply_pending' : !config.configured ? 'disabled' : !config.enabled ? 'missing_credentials' :
            connectionFailed ? 'unavailable' : publicSpeech.last_error === 'speech_busy' ? 'busy' :
                publicSpeech.last_error === 'speech_connecting' ? 'connecting' :
                publicSpeech.last_error ? 'error' : publicSpeech.voices?.length ? 'ready' : 'unknown',
    };
    return {document, config, view: {
        url: config.base_url || '', enabled: config.configured, api_key_configured: keyValid(config.api_key),
        locked, writable: !!app.config_file, revision, apply_pending: revision !== active_revision,
        active_url: active.base_url || '', status,
    }};
}
function candidate(current, values) {
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).some(key => !['url','enabled','api_key'].includes(key))) return fail('speech_connection_invalid_settings');
    const fields = {};
    for (const key of Object.keys(values)) {
        if (current.view.locked[key]) return fail('speech_connection_environment_locked');
    }
    if (values.url !== undefined) fields.url = origin(values.url);
    if (values.enabled !== undefined) {
        if (typeof values.enabled !== 'boolean') return fail('speech_connection_invalid_settings');
        fields.enabled = values.enabled;
    }
    if (values.api_key !== undefined && values.api_key !== '') {
        if (!keyValid(values.api_key)) return fail('speech_connection_invalid_key');
        fields.api_key = values.api_key;
    }
    const speech = {...current.document.speech, ...fields};
    const config = configuration(speech);
    if (!config.base_url) return fail('speech_connection_invalid_url');
    if (config.configured && !keyValid(config.api_key)) return fail('speech_connection_missing_key');
    return {speech, config};
}
async function save(app, msg) {
    const task = state(app);
    const run = async () => {
        if (!app.config_file) return fail('speech_connection_read_only');
        const current = await read(app);
        if (msg.revision !== current.view.revision) return fail('speech_connection_conflict');
        const {speech, config} = candidate(current, msg.values);
        // Persist first. A failed runtime apply remains visible and can be
        // retried without losing the saved address or the running service.
        const temporary = app.config_file + '.' + crypto.randomBytes(12).toString('hex') + '.tmp';
        try {
            await fs.writeFile(temporary, JSON.stringify({...current.document, speech}, null, 4) + '\n', {flag:'wx', mode:0o600});
            await fs.rename(temporary, app.config_file);
        } finally { await fs.rm(temporary, {force:true}).catch(() => {}); }
        app.config.speech = speech;
        try {
            if (typeof app.speech?.reconfigure_connection !== 'function') throw new Error('speech_runtime_unavailable');
            await app.speech.reconfigure_connection(config);
            app.speech.health?.clear('connection_apply');
            if (config.enabled || !config.configured) app.speech.health?.clear('configuration');
        } catch (_) {
            app.speech?.health?.fail('connection_apply', new Error('speech_connection_apply_failed'), false);
        }
        return (await read(app)).view;
    };
    const result = task.pending.then(run, run);task.pending = result.catch(() => {});return result;
}
async function test(app, msg) {
    const current = await read(app), {config} = candidate(current, msg.values || {});
    if (!keyValid(config.api_key)) return fail('speech_connection_missing_key');
    let result;
    try {
        const [health, voices] = await Promise.all([
            request(config.base_url, config.api_key, 'GET', '/health', undefined, 2500).catch(error => {
                if (error.status === 503 && error.response?.status === 'starting') return error.response;
                throw error;
            }),
            request(config.base_url, config.api_key, 'GET', '/v1/voices', undefined, 2500),
        ]);
        const supported = Array.isArray(voices?.voices) && voices.voices.some(voice =>
            ['hallensprecherin','hallensprecher'].includes(voice.voice_id) && voice.languages?.includes('de-DE'));
        result = {state: supported && ['ready','starting'].includes(health?.status) ? health.status : 'invalid'};
    } catch (error) {
        result = {state: [401,403].includes(error.status) ? 'unauthorized' : error.message === 'speech_timeout' ? 'timeout' : 'unavailable'};
    }
    result.checked_at = Date.now();result.message = labels[result.state];
    state(app).last = {revision:signature(config), result};return result;
}
async function handle(app, ws, msg) {
    if (!msg.tournament_key || msg.tournament_key !== ws.speech_tournament_key) return ws.respond(msg, {message:'tournament_not_loaded'});
    try {
        if (msg.type === 'speech_connection_get') return ws.respond(msg, null, {connection:(await read(app)).view});
        if (msg.type === 'speech_connection_save') return ws.respond(msg, null, {connection:await save(app, msg)});
        if (msg.type === 'speech_connection_test') {
            if (ws.speech_connection_testing) return ws.respond(msg, {message:'speech_connection_test_busy'});
            ws.speech_connection_testing = true;
            try { return ws.respond(msg, null, {result:await test(app, msg)}); }
            finally { ws.speech_connection_testing = false; }
        }
        return ws.respond(msg, {message:'speech_connection_invalid_request'});
    } catch (error) {
        // Never return file contents, upstream bodies or credentials.
        const message = /^speech_connection_[a-z_]+$/.test(error.message) ? error.message :
            msg.type === 'speech_connection_save' ? 'speech_connection_save_failed' : 'speech_connection_unavailable';
        return ws.respond(msg, {message});
    }
}

module.exports = {handle};
