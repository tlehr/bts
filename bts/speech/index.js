'use strict';

const { SpeechBroker, configuration } = require('./broker');
const { Prefetcher } = require('./prefetch');
const resolveSettings = require('../../static/js/speech_settings');
const path = require('path');

function public_config(broker, selected) {
    return { ...broker.public_config(selected.voice), ...selected };
}

function create(app) {
    const health = require('./health').health(app);
    try {
        const config = configuration(app.config.speech);
        if (config.configured && !config.enabled) health.fail('configuration', new Error('speech_configuration_missing'), false);
        if (!config.cache_dir && app.db?.tournaments?.filename) config.cache_dir = path.join(path.dirname(app.db.tournaments.filename), 'speech-cache');
        return protect(config.enabled && config.worker ? new (require('./worker_client'))(app, config) : create_inline(app, config));
    } catch (error) {
        health.fail('initialization', error, false);
        const public_config = () => ({ enabled: false, last_error: 'speech_unavailable' });
        return { health, broker: { config: { enabled: false }, public_config }, prefetch: { schedule() {} },
            configure() {}, changed() {}, start() {}, stop() {},
            loaded(tournament, ws) { ws.speech_tournament_key = tournament.key; tournament.speech = public_config(); },
            request: async () => ({ speech: public_config(), speech_error: 'speech_unavailable', clips: [] }) };
    }
}

function protect(service) {
    const wrap = (target, name) => {
        const fn = target[name];
        target[name] = function(...args) {
            try {
                const result = fn.apply(this, args);
                service.health.clear('bridge:' + name);
                return result;
            } catch (error) { service.health.fail('bridge:' + name, error, name !== 'stop'); }
        };
    };
    for (const name of ['start', 'stop', 'configure', 'loaded', 'changed']) wrap(service, name);
    wrap(service.prefetch, 'schedule');
    return service;
}

function create_inline(app, config) {
    const health = require('./health').health(app);
    const broker = new SpeechBroker(config, { health, onChange: keys => {
        for (const key of keys) require('../admin').notify_change(app, key, 'speech_cache_changed', {});
    } });
    const prefetch = new Prefetcher(app, broker);
    return {
        broker, prefetch, health,
        configure(tournament) { prefetch.configure(tournament); },
        start() { broker.start(); prefetch.start(); },
        stop() { broker.stop(); prefetch.stop(); },
        loaded(tournament, ws) {
            ws.speech_tournament_key = tournament.key;
            prefetch.subscribe(tournament.key, tournament);
            tournament.speech = public_config(broker, prefetch.settings(tournament.key));
        },
        changed(key, type, value) { prefetch.changed(key, type, value); },
    };
}

function handle(app, ws, msg) {
    return require('../performance/traces').operation('speech_request', { type: 'admin', tournament_key: msg.tournament_key, ctype: msg.type },
        () => handle_request(app, ws, msg)).catch(error => {
            app.speech?.health?.fail('request_handler', error);
            send_reply(app, ws, msg, { speech_error: 'speech_unavailable', clips: [] });
        });
}

function send_reply(app, ws, msg, values) {
    try { (ws.respond_background || ws.respond).call(ws, msg, null, values); }
    catch (error) { app.speech?.health?.fail('admin_reply', error, false); }
}

function handle_request(app, ws, msg) {
    const speech = app.speech;
    const key = msg.tournament_key;
    const reply = values => {
        if (msg.type === 'speech_resolve') {
            const traces = require('../performance/traces');
            const phase = traces.begin('speech_resolve_result', 'phase', {
                part_count: msg.parts?.length || 0,
                context_part_count: Array.isArray(msg.parts) ? msg.parts.filter(part =>
                    typeof part === 'string' && /^~bts-context-v[12]~/.test(part)).length : 0,
                completed_count: values.clips?.filter(clip => clip.status === 'completed').length || 0,
                reason: values.speech_error || null,
            });
            traces.end(phase);
        }
        return send_reply(app, ws, msg, values);
    };
    if (['speech_helpers', 'speech_helper_bundle', 'speech_helper_test', 'speech_helper_control'].includes(msg.type)) {
        if (!key || key !== ws.speech_tournament_key) return reply({ speech_error: 'tournament_not_loaded' });
        if (!speech) return reply({ speech_error: 'speech_unavailable' });
        const now = Date.now();
        if (now - (ws.helper_request_last || 0) < 250) return reply({ speech_error: 'speech_rate_limit' });
        ws.helper_request_last = now;
        if (speech.request) return speech.request(msg).then(reply, () => reply({ speech_error: 'speech_unavailable' }));
        const pool = speech.helpers;
        if (!pool) return reply({ speech_error: 'helper_process_required' });
        const execute = async () => {
            if (msg.type === 'speech_helpers') return { helpers: await pool.snapshot(key), speech: public_config(speech.broker, speech.prefetch.settings(key)) };
            if (msg.type === 'speech_helper_bundle') return { bundle: await require('./helpers/bundle').bundle(pool, msg.endpoint, speech.helper_certificate_sha256, msg.platform) };
            if (msg.type === 'speech_helper_test') return { helper_job: await pool.test(key, msg.voice, msg.worker_id) };
            return { helper_control: await pool.control(msg.worker_id, msg.action) };
        };
        return execute().then(reply).catch(error => reply({ speech_error: error.message }));
    }
    if (['speech_planning', 'speech_games'].includes(msg.type)) {
        if (!key || key !== ws.speech_tournament_key) return reply({ speech_error: 'tournament_not_loaded' });
        if (!speech) return reply({ speech_error: 'speech_unavailable' });
        const now = Date.now();
        const last = msg.type + '_last';
        if (now - (ws[last] || 0) < 500) return reply({ speech_error: 'speech_rate_limit' });
        ws[last] = now;
        if (msg.type === 'speech_games' && (msg.match_id !== undefined && (typeof msg.match_id !== 'string' || msg.match_id.length > 256) ||
            msg.revision !== undefined && (typeof msg.revision !== 'string' || !/^[a-f0-9]{64}$/.test(msg.revision)))) {
            return reply({ speech_error: 'invalid_speech_request' });
        }
        if (speech.request) return speech.request(msg).then(reply, () => reply({ speech_error: 'speech_unavailable' }));
        if (msg.type === 'speech_games') {
            const settings = speech.prefetch.settings(key);
            const disabled = !speech.broker.config.enabled || settings.mode === 'browser';
            if (disabled) return reply({ games: { voice: settings.voice, disabled: true, items: [], detail: null } });
            return speech.broker.coverage.game_status(key, settings.voice, msg.match_id, msg.revision).then(games =>
                reply({ games: { ...games, updating: games.updating || speech.broker.pending_plans.has(key),
                    now_ts: app.clock?.now_ms() ?? msg._effective_now_ts ?? Date.now(),
                    clock_fixed: app.clock?.get_state?.().mode === 'fixed' || msg._clock_fixed === true } }));
        }
        return reply({ planning: speech.prefetch.planning_status(key) });
    }
    if (!speech || !speech.broker.config.enabled) {
        reply({ speech: speech?.broker.public_config() || { enabled: false }, clips: [] });
        return;
    }
    // Use the existing admin WebSocket and a successfully loaded tournament.
    // No new public generation endpoint or inferred session middleware.
    if (!key || key !== ws.speech_tournament_key) {
        reply({ speech_error: 'tournament_not_loaded', clips: [] });
        return;
    }
    const now = Date.now();
    if (!ws.speech_rate || now - ws.speech_rate.start > 60000) ws.speech_rate = { start: now, count: 0 };
    if (++ws.speech_rate.count > 120) {
        reply({ speech_error: 'speech_rate_limit', clips: [] });
        return;
    }
    if (speech.request) return speech.request(msg).then(reply,
        () => reply({ speech_error: 'speech_unavailable', clips: [] }));
    const broker = speech.broker;
    const selected = speech.prefetch.settings?.(key) || resolveSettings({}, broker.config);
    const configuration = public_config(broker, selected);
    try {
        if (msg.type === 'speech_inventory') {
            if (msg.requests !== undefined) reply({ speech: configuration, inventories: broker.coverage.inventories(key, selected.voice, msg.requests) });
            else reply({ speech: configuration, inventory: broker.coverage.inventory(key, selected.voice, msg.kind, msg.group, msg.offset, msg.limit, msg.state, msg.states) });
        } else if (msg.type === 'speech_queue') {
            const queue = broker.queue(key, selected.voice, { pending_only: msg.pending_only === true });
            speech.prefetch.planning?.get(key)?.annotate_queue(queue, broker, key, selected);
            reply({ speech: configuration, queue });
        } else if (msg.type !== 'speech_status') {
            broker.validate(msg.parts, { voice: msg.voice, language: msg.language });
            if (msg.voice && msg.voice !== selected.voice) {
                reply({ speech: configuration, speech_error: 'speech_settings_changed', clips: [] });
                return;
            }
            if (selected.mode === 'browser') { reply({ speech: configuration, clips: [] }); return; }
            const options = { voice: selected.voice, language: msg.language,
                priority: msg.type === 'speech_resolve' ? 'high' : 'low' };
            broker.prepare(msg.parts, options, key);
            const clips = broker.views(msg.parts, options, key);
            // Repeated preparations of cached UI announcements do not change
            // the tournament plan and must not keep idle admission paused.
            if (clips.some(clip => clip.status !== 'completed')) speech.prefetch.subscribe(key, undefined, { refresh: true });
            reply({ speech: configuration, clips });
        } else {
            const parts = msg.parts === undefined ? [] : msg.parts;
            const options = broker.validate(parts, { voice: msg.voice || selected.voice, language: msg.language });
            reply({ speech: configuration,
                clips: broker.inspect(parts, options, msg.audio_urls === true ? key : undefined) });
        }
    } catch (error) {
        if (!['invalid_speech_parts', 'invalid_speech_voice', 'unsupported_speech_language', 'invalid_inventory_request'].includes(error.message)) {
            speech.health?.fail('request_handler', error);
        }
        reply({ speech_error: 'invalid_speech_request', clips: [] });
    }
}

module.exports = { create, create_inline, handle };
