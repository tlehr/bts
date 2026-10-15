/* global ci18n, conn_ui, resolveSpeechSettings */
/* exported btsSpeechService */
'use strict';

function createSpeechService(context) {
    const history = new Map();
    const prepared = new Map();
    let active = null;
    let preview_controller = null;
    let audio = null;
    let test_id = 0;
    let cache_version;
    let audio_ready = false;
    let audio_error = null;
    let last_result = null;
    const now = context.now || Date.now;
    const getAudio = () => audio || (audio = context.makeAudio());
    const settings = () => ({ ...context.settings(), audio_ready, audio_error });
    const languageSupported = value => value.language === 'de-DE';
    const usable = clip => clip?.status === 'completed' && typeof clip.audio_url === 'string' &&
        /^\/h\/[^/]+\/speech\/audio\/[0-9a-f]{32}\?/.test(clip.audio_url);
    const key = (text, value) => JSON.stringify([value.key, value.voice, value.language, text]);
    const changed = () => context.onStateChange?.();

    function rememberMetadata(response) {
        if (cache_version !== response?.speech?.cache_version) {
            prepared.clear();
            cache_version = response?.speech?.cache_version;
        }
        if (response?.speech_error || response?.speech?.enabled === false) prepared.clear();
    }

    function remember(response, parts, value) {
        rememberMetadata(response);
        if (response?.speech_error || response?.speech?.enabled === false) return;
        if (response?.clips?.length !== parts.length) return;
        response.clips.forEach((clip, index) => {
            const id = key(parts[index], value);
            prepared.delete(id);
            if (usable(clip)) prepared.set(id, { clip, checked: now() });
        });
        while (prepared.size > 512) prepared.delete(prepared.keys().next().value);
    }

    const reasons = {
        browser_mode: 'Browser-TTS ist ausgewählt.',
        disabled: 'Lokale Sprache ist nicht eingerichtet.',
        unsupported_language: 'Für diese Sprache ist keine lokale Stimme verfügbar.',
        cache_incomplete: 'Die vollständige Durchsage ist noch nicht gecacht.',
        speech_timeout: 'Die Antwort auf die Cache-Abfrage kam nicht rechtzeitig.',
        speech_rate_limit: 'Zu viele Sprachabfragen in kurzer Zeit.',
        speech_request_failed: 'Der Sprachstatus konnte nicht abgerufen werden.',
        audio_blocked: 'Der Browser hat Server-Audio gesperrt. Audio aktivieren.',
        audio_failed: 'Die lokale Audiodatei konnte nicht geladen oder abgespielt werden.',
        audio_start_timeout: 'Die lokale Audiodatei startete nicht rechtzeitig.',
    };
    function describeResult(result) {
        if (result.provider === 'browser') return result.fallback_reason === 'browser_mode' ? 'Browser-TTS aktiv (ausgewählt).' :
            'Browser-Fallback: ' + (reasons[result.fallback_reason] || reasons.speech_request_failed);
        if (result.provider === 'server' && ['ok', 'playing'].includes(result.status)) return 'Lokales Server-Audio aktiv.';
        return reasons[result.reason] || 'Lokales Server-Audio ist nicht verfügbar.';
    }

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
        if (!value.enabled || !value.key) return { reason: 'disabled' };
        if (!languageSupported(value)) return { reason: 'unsupported_language' };
        const cached = parts.map(text => prepared.get(key(text, value)));
        if (cached.every(entry => entry && now() - entry.checked < 15000)) return { clips: cached.map(entry => entry.clip) };
        const deadline = now() + value.deadline_ms;
        do {
            if (signal.aborted) return { reason: 'cancelled' };
            try {
                const response = await context.request('speech_resolve', {
                    tournament_key: value.key, voice: value.voice, language: value.language, parts,
                }, Math.max(1, deadline - now()), signal);
                if (signal.aborted || now() > deadline) return { reason: 'speech_timeout' };
                remember(response, parts, value);
                if (response.clips?.length === parts.length && response.clips.every(usable)) return { clips: response.clips };
                if (response.speech_error || response.speech?.enabled === false) return {
                    reason: response.speech_error === 'speech_rate_limit' ? 'speech_rate_limit' : 'speech_request_failed',
                };
            } catch (error) { return { reason: error.message === 'speech_timeout' ? 'speech_timeout' : 'speech_request_failed' }; }
            const remaining = deadline - now();
            if (remaining <= 0) return { reason: 'cache_incomplete' };
            await new Promise(resolve => {
                const timer = setTimeout(finish, Math.min(100, remaining));
                function finish() { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); }
                signal.addEventListener('abort', finish, { once: true });
            });
        } while (now() < deadline);
        return { reason: 'cache_incomplete' };
    }

    async function play(clips, value, signal, pauses = []) {
        let started = false;
        for (const [index, clip] of clips.entries()) {
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
                player.onplaying = () => {
                    const first = !started;
                    started = true; clearTimeout(timer);
                    audio_ready = true; audio_error = null;
                    last_result = { status: 'playing', provider: 'server' };
                    if (first) changed();
                };
                player.onended = () => finish();
                player.onerror = () => finish(new Error('audio_failed'));
                player.src = clip.audio_url;
                player.playbackRate = value.rate || 1;
                player.volume = value.volume === undefined ? 1 : value.volume;
                signal.addEventListener('abort', abort, { once: true });
                timer = setTimeout(() => finish(new Error('audio_start_timeout')), 3000);
                try { Promise.resolve(player.play()).catch(error =>
                    finish(new Error(error.name === 'NotAllowedError' ? 'audio_blocked' : 'audio_failed'))); }
                catch (_) { finish(new Error('audio_failed')); }
            });
            const pause = pauses[index];
            if (Number.isFinite(pause) && pause > 0) {
                await new Promise((resolve, reject) => {
                    const finish = error => {
                        clearTimeout(timer);
                        signal.removeEventListener('abort', abort);
                        if (error) reject(Object.assign(error, { started }));
                        else resolve();
                    };
                    const abort = () => finish(new Error('cancelled'));
                    const timer = setTimeout(finish, Math.min(pause, 500));
                    signal.addEventListener('abort', abort, { once: true });
                    if (signal.aborted) abort();
                });
            }
        }
        return { status: 'ok', provider: 'server', started };
    }

    async function speak(parts, playback_id, browser, localParts = parts, localPauses = []) {
        parts = parts.filter(Boolean);
        localParts = localParts.filter(Boolean);
        if (history.has(playback_id)) return { status: 'skipped', provider: 'none', started: false };
        history.set(playback_id, true);
        while (history.size > 1024) history.delete(history.keys().next().value);
        preview_controller?.abort();
        const value = settings();
        const controller = new AbortController();
        active = controller;
        let result;
        const useBrowser = async reason => {
            if (controller.signal.aborted) return { status: 'cancelled', started: false };
            last_result = { status: 'playing', provider: 'browser', fallback_reason: reason };
            changed();
            try { return { ...await browser(parts, controller.signal), provider: 'browser', fallback_reason: reason }; }
            catch (_) { return { status: 'error', provider: 'browser', fallback_reason: reason, started: false }; }
        };
        try {
            if (value.mode === 'browser') result = await useBrowser('browser_mode');
            else {
                const resolved = await ready(localParts, value, controller.signal);
                if (controller.signal.aborted) result = { status: 'cancelled', started: false };
                else if (!resolved.clips) {
                    result = value.mode === 'auto' ? await useBrowser(resolved.reason) :
                        { status: 'unavailable', reason: resolved.reason, provider: 'server', started: false };
                } else {
                    try { result = await play(resolved.clips, value, controller.signal, localPauses); }
                    catch (error) {
                        if (controller.signal.aborted) result = { status: 'cancelled', provider: 'server', started: error.started };
                        else {
                            prepared.clear();
                            audio_error = error.message;
                            if (audio_error === 'audio_blocked') audio_ready = false;
                            if (!error.started && value.mode === 'auto') result = await useBrowser(error.message);
                            else result = { status: 'error', reason: error.message, provider: 'server', started: !!error.started };
                        }
                    }
                }
            }
        } finally { if (active === controller) active = null; }
        // Claims may fail over to another tab only if no output began.
        result.allowRetry = !result.started && ['error', 'suspicious'].includes(result.status);
        last_result = result;
        changed();
        return result;
    }

    function cancel() {
        active?.abort();
        context.cancelBrowser?.();
    }

    async function preview(clip, version) {
        const value = settings();
        if (active) return { status: 'busy', reason: 'playback_busy' };
        if (!value.enabled || !value.key || !clip || clip.voice !== value.voice || clip.tournament_key !== value.key || version !== cache_version ||
            !usable(clip) || !clip.audio_url.startsWith('/h/' + encodeURIComponent(value.key) + '/speech/audio/')) {
            return { status: 'unavailable', reason: 'cache_incomplete' };
        }
        const controller = new AbortController();
        active = preview_controller = controller;
        let result;
        try {
            result = await play([clip], value, controller.signal);
        } catch (error) {
            result = { status: controller.signal.aborted ? 'cancelled' : 'error', reason: error.message, provider: 'server' };
            if (!controller.signal.aborted) {
                audio_error = error.message;
                if (audio_error === 'audio_blocked') audio_ready = false;
            }
        } finally {
            if (active === controller) {
                active = null;
                last_result = result;
                changed();
            }
            if (preview_controller === controller) preview_controller = null;
        }
        return result;
    }

    function unlock() {
        if (active) return Promise.resolve(false);
        const player = getAudio();
        // Reuse this same element for later server audio (including Safari's gesture policy).
        player.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQIAAAAAAA==';
        player.volume = 0;
        try {
            return Promise.resolve(player.play()).then(() => {
                player.pause(); player.volume = 1; audio_ready = true; audio_error = null; changed(); return true;
            }, error => {
                player.volume = 1; audio_ready = false;
                audio_error = error.name === 'NotAllowedError' ? 'audio_blocked' : 'audio_failed'; changed(); return false;
            });
        } catch (_) {
            player.volume = 1; audio_ready = false; audio_error = 'audio_failed'; changed(); return Promise.resolve(false);
        }
    }

    return {
        settings, prepare, speak, cancel, unlock, describeResult, preview,
        settingsChanged() { prepared.clear(); preview_controller?.abort(); changed(); },
        cancelPreview: () => preview_controller?.abort(),
        queue: async () => {
            const value = settings();
            if (!value.enabled || !value.key) return null;
            const response = await context.request('speech_queue', { tournament_key: value.key }, 1500).catch(() => null);
            if (settings().key !== value.key) return null;
            rememberMetadata(response);
            return response;
        },
        outputMessage: () => settings().mode === 'browser' ? 'Browser-TTS ist ausgewählt.' :
            last_result ? (last_result.status === 'playing' ? 'Aktuelle Ausgabe: ' : 'Letzte Ausgabe: ') + describeResult(last_result) :
                audio_ready ? 'Audiowiedergabe freigegeben.' : 'Lokales Audio noch nicht freigegeben. Audio aktivieren.',
        inspect: async parts => {
            const value = settings();
            if (!value.enabled || !value.key || !languageSupported(value)) return null;
            const response = await context.request('speech_status', {
                tournament_key: value.key, voice: value.voice, language: value.language, parts, audio_urls: true,
            }, 1500).catch(() => null);
            remember(response, parts, value);
            if (response?.clips) response.clips = response.clips.map(clip =>
                clip.status === 'completed' && !usable(clip) ? { status: 'unavailable' } : clip);
            return response;
        },
        status: () => !settings().enabled ? Promise.resolve({ speech: { enabled: false } }) :
            context.request('speech_status',
                { tournament_key: settings().key, voice: settings().voice }, 1500).catch(() => null),
        testId: () => 'speech-test:' + (++test_id),
    };
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
                ...resolveSpeechSettings(typeof curt === 'undefined' ? {} : curt),
                language: ci18n('announcements:lang'),
                deadline_ms: value.deadline_ms || 700, max_text: value.max_text || 1200,
                rate: (typeof curt !== 'undefined' && curt?.announcement_speed) || 1.05,
            };
        },
        makeAudio: () => new Audio(),
        cancelBrowser: () => window.speechSynthesis?.cancel(),
        onStateChange: () => window.dispatchEvent(new CustomEvent('bts-speech-output-changed')),
        request: (type, values, timeout_ms, signal) => new Promise((resolve, reject) => {
            let rid;
            let finished = false;
            const finish = (error, result) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (rid !== undefined) conn_ui.cancel_request(rid);
                if (error) reject(new Error(error.message === 'speech_timeout' ? 'speech_timeout' : 'speech_request_failed'));
                else resolve(result);
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
