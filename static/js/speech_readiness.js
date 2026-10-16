/* global createAnnouncementTexts, btsSpeechService, ci18n */
/* exported btsSpeechReadiness */
'use strict';

function createSpeechReadiness(context) {
    const tracked = new Map();
    const cache = new Map();
    const now = context.now || Date.now;
    let identity = null;
    let version = null;
    let unavailable = false;
    let running = null;
    let timer = null;
    let scheduledForce = false;
    let refreshAgain = false;
    let forceAgain = false;
    let generation = 0;
    let lastInspection = -Infinity;
    const labels = {
        ready: 'Lokal bereit', preparing: 'Wird vorbereitet', missing: 'Noch nicht bereit',
        checking: 'Wird geprüft', failed: 'Generierung fehlgeschlagen',
        unavailable: 'Status nicht verfügbar', disabled: 'Lokale Sprache aus',
        unsupported: 'Nur Browser-TTS', empty: 'Keine Ansage', browser: 'Browser-TTS ausgewählt',
        locked: 'Browser wartet auf Klick', audio_error: 'Server-Audio nicht abspielbar',
    };
    const calls = {
        'match:manualcall': 'announceNewMatch', 'match:preparationcall': 'announcePreparationMatch',
        'match:begintoplay': 'announceBeginnToPlay',
        'match:secondcallteamone': 'TeamOne', 'match:secondcallteamtwo': 'TeamTwo',
        'match:secondcallumpire': 'Umpire', 'match:secondcallservicejudge': 'ServiceJudge',
        'match:secondcaltabletoperator': 'Tabletoperator',
    };

    function snapshot() {
        const value = context.snapshot();
        value.identity = JSON.stringify([value.settings.key, value.settings.voice, value.settings.language,
            value.settings.enabled, value.settings.max_text, value.settings.max_part_length, value.tournament?.speech?.context_version]);
        return value;
    }

    function reset(value) {
        generation++;
        identity = value.identity;
        version = null;
        unavailable = false;
        cache.clear();
    }

    function collect(value) {
        const matches = new Map((value.tournament?.matches || []).map(match => [match._id, match]));
        let parts;
        const texts = context.createTexts({
            local: true,
            tournament: value.tournament || {}, translate: context.translate,
            window: { localStorage: { getItem: () => 'true' } }, claim: () => null,
            announce: values => parts.push(...values),
        });
        const jobs = [];
        for (const [element, item] of tracked) {
            if (!element.isConnected) { tracked.delete(element); continue; }
            parts = [];
            try {
                if (item.read) parts = item.read();
                else {
                    const match = matches.get(item.matchId);
                    if (match) texts[item.call](item.locationId === undefined ? match.setup :
                        { ...match.setup, location_id: item.locationId });
                }
            } catch (_) { parts = []; }
            jobs.push({ element, item, parts: [...new Set(parts.filter(Boolean))] });
        }
        return jobs;
    }

    function display(element, item, state, settings, completed, total) {
        element.dataset.speechState = state;
        const voice = settings.voice === 'hallensprecher' ? 'Hallensprecher' : 'Hallensprecherin';
        const count = total === undefined ? '' : ' · ' + completed + '/' + total + ' Ansageteile bereit.';
        let detail = labels[state] + ' · ' + voice + count;
        if (settings.mode === 'browser') detail += ' Auf diesem Gerät ist Browser-TTS ausgewählt.';
        if (state === 'locked') detail += ' Ein normaler Klick oder Tastendruck im BTS gibt Audio automatisch frei.';
        element.title = (item.title ? item.title + '\n' : '') + detail;
        element.setAttribute('aria-label', (item.title ? item.title + ': ' : '') + detail);
        if (item.label) element.textContent = labels[state] + (total === undefined ? '' : ' (' + completed + '/' + total + ')');
    }

    function paint(jobs, value) {
        for (const { element, item, parts } of jobs) {
            const states = parts.map(text => {
                const entry = cache.get(text);
                return entry && now() - entry.checked < 15000 ? entry.status : 'unknown';
            });
            const completed = states.filter(state => state === 'completed').length;
            const locallyReady = parts.length > 0 && completed === parts.length && parts.every(text => cache.get(text)?.local);
            let state;
            if (!value.settings.enabled) state = 'disabled';
            else if (value.settings.mode === 'browser') state = 'browser';
            else if (value.settings.language !== 'de-DE' || parts.some(text => text.length > (value.settings.max_part_length || value.settings.max_text))) state = 'unsupported';
            else if (!parts.length) state = 'empty';
            else if (unavailable && !locallyReady || states.includes('unavailable')) state = 'unavailable';
            else if (value.settings.audio_error && value.settings.audio_error !== 'audio_blocked') state = 'audio_error';
            else if (value.settings.audio_error === 'audio_blocked') state = 'locked';
            else if (value.settings.audio_ready === false) state = 'checking';
            else if (states.includes('failed')) state = 'failed';
            else if (completed === parts.length) state = 'ready';
            else if (states.some(status => ['unsubmitted', 'queued', 'processing'].includes(status))) state = 'preparing';
            else if (states.includes('unknown')) state = 'checking';
            else state = 'missing';
            display(element, item, state, value.settings, completed, parts.length);
        }
    }

    async function run(force) {
        const value = snapshot();
        if (identity !== value.identity) reset(value);
        const currentGeneration = generation;
        const jobs = collect(value);
        const used = new Set(jobs.flatMap(job => job.parts));
        for (const text of cache.keys()) if (!used.has(text)) cache.delete(text);
        paint(jobs, value);
        if (!value.settings.enabled || !value.settings.key || value.settings.language !== 'de-DE') return;
        // Bound inspection traffic independently of the number of matches. Inspect
        // visible controls only; old observations expire instead of staying green.
        const parts = [...new Set(jobs.filter(job => context.visible(job.element)).flatMap(job => job.parts))]
            .filter(text => text.length <= (value.settings.max_part_length || value.settings.max_text) && text.trim() &&
                (force || !cache.has(text) || now() - cache.get(text).checked >= 4000))
            .sort((a, b) => (cache.get(a)?.checked || 0) - (cache.get(b)?.checked || 0))
            .slice(0, 128);
        if (parts.length) lastInspection = now();
        for (let i = 0; i < parts.length; i += 64) {
            const batch = parts.slice(i, i + 64);
            const response = await context.service.inspect(batch);
            if (snapshot().identity !== value.identity || currentGeneration !== generation) {
                refreshAgain = forceAgain = true;
                return;
            }
            if (!response || response.speech_error || !Array.isArray(response.clips) ||
                response.clips.length !== batch.length || response.speech?.enabled === false) {
                unavailable = true;
                break;
            }
            if (version !== response.speech?.cache_version) {
                cache.clear();
                version = response.speech?.cache_version;
            }
            unavailable = response.speech?.last_error === 'speech_unavailable';
            batch.forEach((text, index) => cache.set(text, { status: response.clips[index].status,
                local: response.clips[index].local === true, checked: now() }));
        }
        const current = snapshot();
        paint(collect(current), current);
    }

    function refresh(force = false) {
        if (running) {
            refreshAgain = true;
            forceAgain ||= force;
            return running;
        }
        running = (async () => {
            do {
                refreshAgain = forceAgain = false;
                await run(force);
                force = forceAgain;
            } while (refreshAgain);
        })().finally(() => { running = null; });
        return running;
    }

    function schedule(force = false) {
        scheduledForce ||= force;
        if (!context.schedule || timer !== null) return;
        timer = context.schedule(() => {
            timer = null;
            const force = scheduledForce;
            scheduledForce = false;
            void refresh(force);
        }, force ? Math.max(250, 1000 - (now() - lastInspection)) : 250);
    }

    function track(element, item) {
        item.title = tracked.get(element)?.title ?? (element.title || (item.label ? '' : element.textContent.trim()));
        tracked.set(element, item);
        const value = snapshot();
        if (identity !== value.identity) reset(value);
        const state = !value.settings.enabled ? 'disabled' : value.settings.language !== 'de-DE' ? 'unsupported' : 'checking';
        display(element, item, state, value.settings);
        schedule();
    }

    return {
        refresh,
        schedule,
        changed(force = false) {
            const value = snapshot();
            if (identity !== value.identity) reset(value);
            paint(collect(value), value);
            if (running) { refreshAgain = true; forceAgain ||= force; }
            else schedule(force);
        },
        trackText(element, read, label = false) { track(element, { read, label }); },
        trackMatch(element, matchId, title, preparation = false, locationId) {
            let call = calls[title];
            if (!call) return;
            if (!call.startsWith('announce')) call = 'announceSecond' + (preparation ? 'Preparation' : '') + 'Call' + call;
            track(element, { matchId, call, locationId });
        },
    };
}

var btsSpeechReadiness; // eslint-disable-line no-unused-vars -- shared browser controller
if (typeof module !== 'undefined' && module.exports) module.exports = createSpeechReadiness;
else {
    btsSpeechReadiness = createSpeechReadiness({
        createTexts: createAnnouncementTexts, translate: (...args) => ci18n(...args), service: btsSpeechService,
        snapshot: () => ({ tournament: typeof curt === 'undefined' ? null : curt, settings: btsSpeechService.settings() }),
        visible: element => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight &&
                window.getComputedStyle(element).visibility !== 'hidden';
        },
        schedule: (callback, ms) => setTimeout(callback, ms),
    });
    setInterval(() => { if (!document.hidden) void btsSpeechReadiness.refresh(); }, 5000);
    window.addEventListener('focus', () => btsSpeechReadiness.changed());
    window.addEventListener('storage', () => btsSpeechReadiness.changed());
    window.addEventListener('bts-speech-output-changed', () => btsSpeechReadiness.changed());
    window.addEventListener('bts-speech-cache-changed', () => btsSpeechReadiness.changed(true));
    window.addEventListener('scroll', () => btsSpeechReadiness.schedule(), { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) btsSpeechReadiness.changed(true); });
}
