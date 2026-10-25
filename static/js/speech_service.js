/* global ci18n, conn_ui, resolveSpeechSettings */
/* exported btsSpeechService */
'use strict';

function createSpeechService(context) {
    const history = new Map();
    const prepared = new Map();
    let active = null;
    let preview_controller = null;
    let audio = null;
    let audio_context = null;
    let unlocking = null;
    const getAudioContext = () => {
        try { return audio_context || (audio_context = context.makeAudioContext?.()); }
        catch (_) { return null; }
    };
    let test_id = 0;
    let cache_version;
    let audio_endpoint;
    let audio_ready = false;
    let audio_error = null;
    let last_result = null;
    const inventory_waiters = [];
    let inventory_scheduled = false;
    async function flushInventory() {
        inventory_scheduled = false;
        const waiters = inventory_waiters.splice(0, 8);
        if (!waiters.length) return;
        const value = settings();
        const current = waiters.filter(row => {
            if (value.key === row.settings.key && value.voice === row.settings.voice) return true;
            row.resolve(null); return false;
        });
        if (current.length) {
            const response = await context.request('speech_inventory', { tournament_key: value.key, requests: current.map(row => row.query) }, 3000).catch(() => null);
            current.forEach((row, i) => row.resolve(settings().key === row.settings.key && settings().voice === row.settings.voice ? response?.inventories?.[i] || null : null));
        }
        if (inventory_waiters.length) { inventory_scheduled = true; void Promise.resolve().then(flushInventory); }
    }
    const now = context.now || Date.now;
    const getAudio = () => audio || (audio = context.makeAudio());
    const settings = () => ({ ...context.settings(), audio_ready, audio_error });
    const languageSupported = value => value.language === 'de-DE';
    const usable = clip => clip?.status === 'completed' && typeof clip.audio_url === 'string' &&
        /^\/h\/[^/]+\/speech\/audio\/[0-9a-f]{32}\?/.test(clip.audio_url);
    const key = (text, value) => JSON.stringify([value.key, value.voice, value.language, text]);
    const changed = () => context.onStateChange?.();

    function audioURL(path) {
        const endpoint = audio_endpoint === undefined ? settings().audio_endpoint : audio_endpoint;
        if (!endpoint) return path;
        const base = new URL(context.page_url);
        if (endpoint.origin) return new URL(path, endpoint.origin).href;
        base.protocol = endpoint.protocol;
        base.port = String(endpoint.port);
        return new URL(path, base).href;
    }

    function rememberMetadata(response) {
        context.onMetadata?.(response?.speech);
        if (response?.speech) {
            audio_endpoint = response.speech.audio_endpoint || null;
            if (cache_version !== response.speech.cache_version) {
                prepared.clear();
                cache_version = response.speech.cache_version;
            }
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
        audio_blocked: 'Der Browser hat Audio gesperrt. Bitte einmal im BTS klicken oder eine Taste drücken.',
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
        const texts = parts.filter(part => typeof part === 'string' && part.length && part.length <= (value.max_part_length || value.max_text));
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

    async function playBuffered(clips, value, signal, pauses, player) {
        // Decode before starting and schedule the complete call on one audio
        // clock. Loading the next URL between pieces must not extend a pause.
        let bytes = 0;
        const buffers = [];
        for (const clip of clips) {
            if (signal.aborted) throw new Error('cancelled');
            const controller = new AbortController();
            const abort = () => controller.abort();
            signal.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(abort, 3000);
            let data;
            try { data = await context.fetchAudio(audioURL(clip.audio_url), controller.signal); }
            finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
            bytes += data.byteLength;
            if (bytes > 32 * 1024 * 1024) throw new Error('audio_failed');
            buffers.push(await player.decodeAudioData(data));
        }
        if (signal.aborted) throw new Error('cancelled');
        const gain = player.createGain();
        gain.gain.value = value.volume === undefined ? 1 : value.volume;
        gain.connect(player.destination);
        const sources = [];
        try {
            await new Promise((resolve, reject) => {
                const abort = () => reject(Object.assign(new Error('cancelled'), { started: true }));
                const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
                signal.addEventListener('abort', abort, { once: true });
                let time = player.currentTime + .05;
                buffers.forEach((buffer, index) => {
                    const source = player.createBufferSource();
                    source.buffer = buffer; source.connect(gain); sources.push(source);
                    if (index === buffers.length - 1) source.onended = finish;
                    source.start(time);
                    const margin = (clips[index].trailing_quiet_ms || 0) + (clips[index + 1]?.leading_quiet_ms || 0);
                    time += buffer.duration + Math.max(0, (pauses[index] || 0) - margin) / 1000;
                });
                audio_ready = true; audio_error = null;
                last_result = { status: 'playing', provider: 'server' }; changed();
            });
            return { status: 'ok', provider: 'server', started: true };
        } catch (error) {
            error.started = sources.length > 0;
            throw error;
        } finally {
            for (const source of sources) { try { source.stop(); } catch (_) { /* Already ended. */ } source.disconnect(); }
            gain.disconnect();
        }
    }

    async function play(clips, value, signal, pauses = []) {
        // A click can unlock audio while its button starts a call. Finish the
        // silent probe before assigning the real WAV to the shared element.
        if (unlocking) await unlocking;
        if (signal.aborted) throw Object.assign(new Error('cancelled'), { started: false });
        const clock = context.fetchAudio && clips.every(clip => clip.processed) &&
            Math.abs((value.rate || 1) - 1.05) < .0001 ? getAudioContext() : null;
        if (clock?.state === 'running') return playBuffered(clips, value, signal, pauses, clock);
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
                player.src = audioURL(clip.audio_url);
                player.playbackRate = clip.processed ? (value.rate || 1) / 1.05 :
                    (value.rate || 1) * (value.voice === 'hallensprecher' ? 1.1 : 1);
                player.preservesPitch = true;
                player.volume = value.volume === undefined ? 1 : value.volume;
                signal.addEventListener('abort', abort, { once: true });
                timer = setTimeout(() => finish(new Error('audio_start_timeout')), 3000);
                try { Promise.resolve(player.play()).catch(error =>
                    finish(new Error(error.name === 'NotAllowedError' ? 'audio_blocked' : 'audio_failed'))); }
                catch (_) { finish(new Error('audio_failed')); }
            });
            const target = pauses[index];
            const margin = clip.processed ? ((clip.trailing_quiet_ms || 0) + (clips[index + 1]?.leading_quiet_ms || 0)) /
                ((value.rate || 1) / 1.05) : 0;
            const pause = Number.isFinite(target) ? Math.max(0, target - margin) : 0;
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

    async function status(signal, timeout_ms = 1500) {
        const value = settings();
        if (!value.enabled || !value.key) return { speech: { enabled: false } };
        const response = await context.request('speech_status',
            { tournament_key: value.key, voice: value.voice }, timeout_ms, signal).catch(() => null);
        if (signal?.aborted || settings().key !== value.key || settings().voice !== value.voice) return null;
        rememberMetadata(response);
        return response;
    }

    async function speak(parts, playback_id, browser, localParts = parts, localPauses = [], buildLocalPlan) {
        parts = parts.filter(Boolean);
        localParts = localParts.filter(Boolean);
        if (history.has(playback_id)) return { status: 'skipped', provider: 'none', started: false };
        history.set(playback_id, true);
        while (history.size > 1024) history.delete(history.keys().next().value);
        preview_controller?.abort();
        let value = settings();
        const controller = new AbortController();
        active = controller;
        if (typeof window !== 'undefined') window.btsDiagnostics?.record('info', 'Durchsage gestartet', { playback_id });
        let result;
        const useBrowser = async reason => {
            if (typeof window !== 'undefined') window.btsDiagnostics?.record('warn', 'Sprach-Fallback auf Browser', { reason, playback_id });
            if (controller.signal.aborted) return { status: 'cancelled', started: false };
            last_result = { status: 'playing', provider: 'browser', fallback_reason: reason };
            changed();
            try { return { ...await browser(parts, controller.signal), provider: 'browser', fallback_reason: reason }; }
            catch (_) { return { status: 'error', provider: 'browser', fallback_reason: reason, started: false }; }
        };
        try {
            if (value.mode === 'browser') result = await useBrowser('browser_mode');
            else {
                let metadata_failed = false;
                if (buildLocalPlan && value.enabled && value.key && languageSupported(value)) {
                    if (value.context_version == null) {
                        // Read-only: do not admit obsolete individual snippets
                        // while this window still lacks the worker's metadata.
                        const response = await status(controller.signal, value.deadline_ms);
                        metadata_failed = !response?.speech || !!response.speech_error;
                    }
                    if (settings().key !== value.key || settings().voice !== value.voice) controller.abort();
                    value = settings();
                    if (!controller.signal.aborted && !metadata_failed) {
                        const plan = buildLocalPlan(value);
                        localParts = plan.parts; localPauses = plan.pauses;
                    }
                }
                const resolved = metadata_failed ? { reason: 'speech_request_failed' } : await ready(localParts, value, controller.signal);
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
        if (typeof window !== 'undefined') window.btsDiagnostics?.record('info', 'Durchsage beendet', { playback_id, status: result.status,
            provider: result.provider, reason: result.fallback_reason || result.reason || null });
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
        const selectedVoice = clip?.voice === value.voice || value.warm_other_voice === true && clip?.spare === true &&
            ['hallensprecher', 'hallensprecherin'].includes(clip?.voice);
        if (!value.enabled || !value.key || !clip || !selectedVoice || clip.tournament_key !== value.key || version !== cache_version ||
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
        if (unlocking) return unlocking;
        if (active) return Promise.resolve(false);
        const clock = getAudioContext();
        if (clock) void clock.resume().catch(() => {});
        const player = getAudio();
        // Reuse this same element for later server audio (including Safari's gesture policy).
        // Silent PCM at normal volume probes permission for unmuted playback;
        // a volume-zero test can succeed even when real announcements are blocked.
        player.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAwF0AAIC7AAACABAAZGF0YQIAAAAAAA==';
        player.volume = 1;
        unlocking = new Promise(resolve => {
            let finished = false;
            const finish = error => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                player.pause();
                audio_ready = !error;
                audio_error = error ? error.name === 'NotAllowedError' ? 'audio_blocked' : 'audio_failed' : null;
                changed();
                resolve(!error);
            };
            const timer = setTimeout(() => finish(new Error('audio_start_timeout')), 1500);
            try { Promise.resolve(player.play()).then(() => finish(), finish); }
            catch (error) { finish(error); }
        });
        const attempt = unlocking;
        const clear = () => { if (unlocking === attempt) unlocking = null; };
        void attempt.then(clear, clear);
        return attempt;
    }

    function ensureAudio() {
        const value = settings();
        if (!value.enabled || !value.key || value.mode === 'browser' || !languageSupported(value)) return Promise.resolve(false);
        if (audio_ready && !audio_error) {
            if (audio_context?.state === 'suspended') void audio_context.resume().catch(() => {});
            return Promise.resolve(true);
        }
        return unlock();
    }

    return {
        settings, prepare, speak, cancel, unlock, ensureAudio, describeResult, preview,
        isBusy: () => !!(active || preview_controller),
        settingsChanged() { prepared.clear(); preview_controller?.abort(); changed(); void ensureAudio(); },
        cancelPreview: () => preview_controller?.abort(),
        queue: async () => {
            const value = settings();
            if (!value.enabled || !value.key) return null;
            const response = await context.request('speech_queue', { tournament_key: value.key }, 1500).catch(() => null);
            if (settings().key !== value.key) return null;
            rememberMetadata(response);
            return response;
        },
        inventory: (kind, group = 'all', offset = 0, limit = 30, state = 'all', states) => {
            const value = settings();
            if (!value.enabled || !value.key) return Promise.resolve(null);
            return new Promise(resolve => {
                inventory_waiters.push({ query: { kind, group, offset, limit, state, states }, settings: value, resolve });
                if (!inventory_scheduled) { inventory_scheduled = true; void Promise.resolve().then(flushInventory); }
            });
        },
        outputMessage: () => settings().mode === 'browser' ? 'Browser-TTS ist ausgewählt.' :
            last_result ? (last_result.status === 'playing' ? 'Aktuelle Ausgabe: ' : 'Letzte Ausgabe: ') + describeResult(last_result) :
                audio_ready ? 'Audiowiedergabe automatisch bereit.' : audio_error === 'audio_blocked' ? reasons.audio_blocked :
                    'Lokales Audio wird automatisch vorbereitet.',
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
        status,
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
        page_url: window.location.href,
        makeAudioContext: () => {
            const AudioClock = window.AudioContext || window.webkitAudioContext;
            return AudioClock ? new AudioClock() : null;
        },
        fetchAudio: async (url, signal) => {
            const response = await fetch(url, { credentials: 'same-origin', signal });
            if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'audio/wav' ||
                Number(response.headers.get('content-length')) > 32 * 1024 * 1024) throw new Error('audio_failed');
            return response.arrayBuffer();
        },
        cancelBrowser: () => window.speechSynthesis?.cancel(),
        onMetadata: value => { if (value && typeof curt !== 'undefined' && curt) curt.speech = { ...curt.speech, ...value }; },
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
    for (const name of ['click', 'keydown', 'touchend']) {
        document.addEventListener(name, event => {
            if (event.isTrusted && !event.repeat) void btsSpeechService.ensureAudio();
        }, { capture: true, passive: true });
    }
}
