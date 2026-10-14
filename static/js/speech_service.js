/* global ci18n, conn_ui */
/* exported btsSpeechService */
'use strict';

function createSpeechService(context) {
    const history = new Map();
    let active = null;
    let audio = null;
    let test_id = 0;
    const now = context.now || Date.now;
    const getAudio = () => audio || (audio = context.makeAudio());
    const settings = () => context.settings();
    const languageSupported = value => value.language === 'de-DE';

    async function prepare(parts) {
        const value = settings();
        if (!value.enabled || !value.key || !languageSupported(value)) return null;
        const texts = parts.filter(part => typeof part === 'string' && part.length && part.length <= value.max_text);
        return context.request('speech_prepare', {
            tournament_key: value.key, voice: value.voice, language: value.language,
            parts: [...new Set(texts)].slice(0, 64),
        }, 1500).catch(() => null);
    }

    async function ready(parts, value, signal) {
        if (!value.enabled || !value.key || !languageSupported(value)) return null;
        const deadline = now() + value.deadline_ms;
        do {
            if (signal.aborted) return null;
            try {
                const response = await context.request('speech_resolve', {
                    tournament_key: value.key, voice: value.voice, language: value.language, parts,
                }, Math.max(1, deadline - now()), signal);
                if (signal.aborted || now() > deadline) return null;
                if (response.clips?.length === parts.length &&
                    response.clips.every(clip => clip.status === 'completed' &&
                        typeof clip.audio_url === 'string' && /^\/h\/[^/]+\/speech\/audio\/[0-9a-f]{32}\?/.test(clip.audio_url))) {
                    return response.clips;
                }
                if (response.speech_error || response.speech?.enabled === false) return null;
            } catch (_) { return null; }
            const remaining = deadline - now();
            if (remaining <= 0) return null;
            await new Promise(resolve => {
                const timer = setTimeout(finish, Math.min(100, remaining));
                function finish() { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); }
                signal.addEventListener('abort', finish, { once: true });
            });
        } while (now() < deadline);
        return null;
    }

    async function play(clips, value, signal) {
        let started = false;
        for (const clip of clips) {
            if (signal.aborted) throw Object.assign(new Error('cancelled'), { started });
            const player = getAudio();
            await new Promise((resolve, reject) => {
                let finished = false;
                let timer;
                const finish = error => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timer);
                    signal.removeEventListener('abort', abort);
                    player.onplaying = player.onended = player.onerror = null;
                    if (error) { player.pause(); reject(Object.assign(error, { started })); }
                    else resolve();
                };
                const abort = () => finish(new Error('cancelled'));
                player.onplaying = () => { started = true; clearTimeout(timer); };
                player.onended = () => finish();
                player.onerror = () => finish(new Error('audio_failed'));
                player.src = clip.audio_url;
                player.playbackRate = value.rate || 1;
                player.volume = value.volume === undefined ? 1 : value.volume;
                signal.addEventListener('abort', abort, { once: true });
                timer = setTimeout(() => finish(new Error('audio_start_timeout')), 3000);
                try { Promise.resolve(player.play()).catch(() => finish(new Error('audio_blocked'))); }
                catch (_) { finish(new Error('audio_failed')); }
            });
        }
        return { status: 'ok', provider: 'server', started };
    }

    async function speak(parts, playback_id, browser) {
        parts = parts.filter(Boolean);
        if (history.has(playback_id)) return { status: 'skipped', provider: 'none', started: false };
        history.set(playback_id, true);
        while (history.size > 1024) history.delete(history.keys().next().value);
        const value = settings();
        const controller = new AbortController();
        active = controller;
        let result;
        const useBrowser = async () => {
            if (controller.signal.aborted) return { status: 'cancelled', started: false };
            try { return { ...await browser(parts, controller.signal), provider: 'browser' }; }
            catch (_) { return { status: 'error', provider: 'browser', started: false }; }
        };
        try {
            if (value.mode === 'browser') result = await useBrowser();
            else {
                const clips = await ready(parts, value, controller.signal);
                if (controller.signal.aborted) result = { status: 'cancelled', started: false };
                else if (!clips) {
                    result = value.mode === 'auto' ? await useBrowser() :
                        { status: 'unavailable', provider: 'server', started: false };
                } else {
                    try { result = await play(clips, value, controller.signal); }
                    catch (error) {
                        if (controller.signal.aborted) result = { status: 'cancelled', provider: 'server', started: error.started };
                        else if (!error.started && value.mode === 'auto') result = await useBrowser();
                        else result = { status: 'error', provider: 'server', started: !!error.started };
                    }
                }
            }
        } finally { if (active === controller) active = null; }
        // Claims may fail over to another tab only if no output began.
        result.allowRetry = !result.started && ['error', 'suspicious'].includes(result.status);
        return result;
    }

    function cancel() {
        active?.abort();
        context.cancelBrowser?.();
    }

    function unlock() {
        if (active) return Promise.resolve(false);
        const player = getAudio();
        // Reuse this same element for later server audio (including Safari's gesture policy).
        player.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQIAAAAAAA==';
        player.volume = 0;
        try {
            return Promise.resolve(player.play()).then(() => { player.pause(); player.volume = 1; return true; },
                () => { player.volume = 1; return false; });
        } catch (_) { player.volume = 1; return Promise.resolve(false); }
    }

    return {
        settings, prepare, speak, cancel, unlock,
        inspect: parts => {
            const value = settings();
            if (!value.enabled || !value.key || !languageSupported(value)) return Promise.resolve(null);
            return context.request('speech_status', {
                tournament_key: value.key, voice: value.voice, language: value.language, parts,
            }, 1500).catch(() => null);
        },
        status: () => !settings().enabled ? Promise.resolve({ speech: { enabled: false } }) :
            context.request('speech_status',
                { tournament_key: settings().key, voice: settings().voice }, 1500).catch(() => null),
        testId: () => 'speech-test:' + (++test_id),
    };
}

function speechPreference(name, fallback) {
    try { return window.localStorage.getItem('bts_speech_' + name) || fallback; }
    catch (_) { return fallback; }
}

var btsSpeechService; // eslint-disable-line no-unused-vars -- shared browser service
if (typeof module !== 'undefined' && module.exports) module.exports = createSpeechService;
else {
    btsSpeechService = createSpeechService({
        settings: () => {
            const value = typeof curt === 'undefined' ? {} : curt?.speech || {};
            return {
                ...value, enabled: value.enabled === true,
                key: typeof curt === 'undefined' ? null : curt?.key,
                mode: speechPreference('mode', value.mode || 'browser'),
                voice: speechPreference('voice', value.voice || 'hallensprecherin'),
                language: ci18n('announcements:lang'),
                deadline_ms: value.deadline_ms || 700, max_text: value.max_text || 1200,
                rate: (typeof curt !== 'undefined' && curt?.announcement_speed) || 1.05,
            };
        },
        makeAudio: () => new Audio(),
        cancelBrowser: () => window.speechSynthesis?.cancel(),
        request: (type, values, timeout_ms, signal) => new Promise((resolve, reject) => {
            let rid;
            let finished = false;
            const finish = (error, result) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (rid !== undefined) conn_ui.cancel_request(rid);
                if (error) reject(new Error('speech_request_failed')); else resolve(result);
            };
            const abort = () => finish(new Error('cancelled'));
            const timer = setTimeout(() => finish(new Error('speech_timeout')), timeout_ms);
            if (signal?.aborted) { abort(); return; }
            signal?.addEventListener('abort', abort, { once: true });
            try { rid = send({ type, ...values }, finish); }
            catch (_) { finish(new Error('speech_disconnected')); }
        }),
    });
    window.btsSpeechService = btsSpeechService;
}
