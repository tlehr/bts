'use strict';

const { SpeechBroker, configuration } = require('./broker');
const { Prefetcher } = require('./prefetch');

function create(app) {
    const broker = new SpeechBroker(configuration(app.config.speech));
    const prefetch = new Prefetcher(app, broker);
    return {
        broker, prefetch,
        start() { broker.start(); prefetch.start(); },
        stop() { broker.stop(); prefetch.stop(); },
        loaded(tournament, ws) {
            ws.speech_tournament_key = tournament.key;
            tournament.speech = broker.public_config();
            prefetch.subscribe(tournament.key);
        },
        changed(key, type) { prefetch.changed(key, type); },
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
    try {
        if (msg.type !== 'speech_status') {
            const options = { voice: msg.voice, language: msg.language,
                priority: msg.type === 'speech_resolve' ? 'high' : 'low' };
            broker.prepare(msg.parts, options);
            speech.prefetch.subscribe(key, options.voice || broker.config.voice);
            reply({ speech: broker.public_config(options.voice), clips: broker.views(msg.parts, options, key) });
        } else {
            const parts = msg.parts === undefined ? [] : msg.parts;
            const options = broker.validate(parts, { voice: msg.voice, language: msg.language });
            reply({ speech: broker.public_config(options.voice), clips: broker.inspect(parts, options) });
        }
    } catch (_) {
        reply({ speech_error: 'invalid_speech_request', clips: [] });
    }
}

module.exports = { create, handle };
