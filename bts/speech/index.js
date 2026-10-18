'use strict';

const { SpeechBroker, configuration } = require('./broker');
const { Prefetcher } = require('./prefetch');
const resolveSettings = require('../../static/js/speech_settings');
const path = require('path');

function public_config(broker, selected) {
    return { ...broker.public_config(selected.voice), ...selected };
}

function create(app) {
    const config = configuration(app.config.speech);
    if (!config.cache_dir && app.db?.tournaments?.filename) config.cache_dir = path.join(path.dirname(app.db.tournaments.filename), 'speech-cache');
    const broker = new SpeechBroker(config, { onChange: keys => {
        for (const key of keys) require('../admin').notify_change(app, key, 'speech_cache_changed', {});
    } });
    const prefetch = new Prefetcher(app, broker);
    return {
        broker, prefetch,
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
    const speech = app.speech;
    const key = msg.tournament_key;
    const reply = values => ws.respond(msg, null, values);
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
    const broker = speech.broker;
    const selected = speech.prefetch.settings?.(key) || resolveSettings({}, broker.config);
    const configuration = public_config(broker, selected);
    try {
        if (msg.type === 'speech_inventory') {
            if (msg.requests !== undefined) reply({ speech: configuration, inventories: broker.coverage.inventories(key, selected.voice, msg.requests) });
            else reply({ speech: configuration, inventory: broker.coverage.inventory(key, selected.voice, msg.kind, msg.group, msg.offset, msg.limit, msg.state, msg.states) });
        } else if (msg.type === 'speech_queue') {
            reply({ speech: configuration, queue: broker.queue(key, selected.voice) });
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
            speech.prefetch.subscribe(key);
            reply({ speech: configuration, clips: broker.views(msg.parts, options, key) });
        } else {
            const parts = msg.parts === undefined ? [] : msg.parts;
            const options = broker.validate(parts, { voice: msg.voice || selected.voice, language: msg.language });
            reply({ speech: configuration,
                clips: broker.inspect(parts, options, msg.audio_urls === true ? key : undefined) });
        }
    } catch (_) {
        reply({ speech_error: 'invalid_speech_request', clips: [] });
    }
}

module.exports = { create, handle };
