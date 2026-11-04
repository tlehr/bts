/* exported btsServiceStatus */
'use strict';

var btsServiceStatus = (function() {
    function createMonitor(context) {
        const now = context.now || Date.now;
        const later = context.later || setTimeout, clearLater = context.clearLater || clearTimeout;
        const interval = 5000;
        let connected = false, timer = null, pending = null, followup = false;
        let lastKey = null, lastRequest = -Infinity;
        const revisions = {};
        function cancel() {
            if (!pending) return;
            const request = pending;pending = null;
            clearLater(request.timeout);
            context.cancel?.(request.id);
        }
        function refresh(force = false) {
            const key = context.key();
            if (!connected || !key) return;
            if (pending && pending.key !== key) cancel();
            if (pending) { followup ||= force;return; }
            if (!force && key === lastKey && now() - lastRequest < interval) return;
            lastKey = key;lastRequest = now();
            const request = pending = { key, revisions: {...revisions} };
            const finish = (error, response) => {
                if (pending !== request) return;
                pending = null;clearLater(request.timeout);
                if (!error && connected && context.key() === key && response?.services) {
                    // A direct status event is newer than a snapshot already in flight.
                    const services = Object.fromEntries(Object.entries(response.services).filter(([name]) =>
                        revisions[name] === request.revisions[name]));
                    context.apply(services);
                }
                if (error && connected && context.key() === key) context.failed?.(error);
                if (followup) { followup = false;refresh(true); }
            };
            request.timeout = later(() => {
                context.cancel?.(request.id);finish(new Error('service_status_timeout'));
            }, interval);
            try { request.id = context.request(key, finish); }
            catch (error) { finish(error); }
        }
        return {
            start() {
                if (timer === null) timer = (context.repeat || setInterval)(refresh, interval);
                refresh();
            },
            refresh,
            changed(name) { revisions[name] = (revisions[name] || 0) + 1; },
            connected(value) {
                const previous = connected;connected = value;
                if (!value) { followup = false;cancel(); }
                else if (!previous) refresh(true);
            },
            stop() { connected = false;followup = false;cancel();(context.clearRepeat || clearInterval)(timer);timer = null; },
        };
    }

    function speechOutputState({connected, settings, health, check, busy, browserSupported}) {
        if (!connected) return {status:'waiting', detail:'Verbindung zu BTS unterbrochen. Der Sprachstatus ist nicht aktuell.'};
        if (!settings || settings.mode === 'browser' || settings.mode === 'auto' && !settings.enabled) {
            if (browserSupported === false) return {status:'unsupported', detail:'Dieser Browser unterstützt keine Sprachausgabe.'};
            return check;
        }
        if (!settings.enabled) return {status:'unsupported', detail:'Serveraudio ist deaktiviert.'};
        if (health?.state === 'error') return {status:'error', detail:health.issues?.map(issue => issue.message || issue.code).join(' · ') || 'Ansagen gestört.'};
        if (settings.last_error) return {status:'error', detail:'Serveraudio ist derzeit nicht bereit. Der Status wird automatisch aktualisiert.'};
        if (Array.isArray(settings.voices) && !settings.voices.some(voice => voice.voice_id === settings.voice)) return {
            status:settings.voices.length ? 'error' : 'waiting', detail:'Die ausgewählte Stimme des Sprachservers ist noch nicht verfügbar.',
        };
        if (settings.audio_error) return {status:'error', detail:settings.audio_error === 'audio_blocked' ?
            'Der Browser hat Audio gesperrt. Bitte einmal im BTS klicken oder eine Taste drücken.' : 'Audiowiedergabe auf diesem Gerät fehlgeschlagen.'};
        if (!settings.audio_ready) return {status:'untested', detail:'Audiowiedergabe auf diesem Gerät ist noch nicht freigegeben.'};
        return {status:busy ? 'running' : 'active', detail:busy ? 'Eine Durchsage wird abgespielt.' : 'Serveraudio und Audiowiedergabe auf diesem Gerät sind bereit.'};
    }
    return {createMonitor, speechOutputState};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = btsServiceStatus;
