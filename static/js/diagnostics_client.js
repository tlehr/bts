'use strict';

(function(root) {
    function create(env, version) {
        const doc = env.document, queue = [], dirty = new Map(), baselines = new WeakMap();
        const uuid = () => env.crypto?.randomUUID?.() || 'page_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
        const get = (storage, key, fallback) => { try { return storage.getItem(key) || fallback; } catch (_) { return fallback; } };
        const put = (storage, key, value) => { try { value == null ? storage.removeItem(key) : storage.setItem(key, value); } catch (_) { /* Storage is optional. */ } };
        const clean = value => String(value ?? '').slice(0, 8000).replace(/(Bearer\s+)[\w.+/=-]+/gi, '$1[entfernt]')
            .replace(/((?:password|passwd|secret|token|api[_-]?key|authorization|signature)\s*[=:]\s*["']?)[^\s,"'&}]+/gi, '$1[entfernt]');
        let frameKey = ':top';
        try { if (env.parent && env.parent !== env) frameKey = ':frame:' + (env.frameElement?.id || env.frameElement?.parentElement?.id || env.name || env.location.pathname); }
        catch (_) { frameKey = ':frame:' + env.location.pathname; }
        const storageKey = 'bts_diagnostics_page' + frameKey;
        let dropped = Math.max(0, Number(get(env.sessionStorage, storageKey + ':dropped', '0')) || 0);
        let pageId = get(env.sessionStorage, storageKey, uuid());
        const device = get(env.localStorage, 'bts_diagnostics_device', uuid()), instance = uuid();
        put(env.localStorage, 'bts_diagnostics_device', device); put(env.sessionStorage, storageKey, pageId);
        let ws, registered = false, stopped = false, retry, inflight, batch = 0, sequence = 0, verboseUntil = 0, pending = null, banner;
        let checking = false, checkedAt = 0, verifiedPresses = null;
        const currentState = () => env.state || (typeof state === 'undefined' ? null : state);
        try {
            const saved = JSON.parse(get(env.sessionStorage, storageKey + ':backlog', '[]'));
            if (Array.isArray(saved)) for (const row of saved.slice(-100)) if (typeof row?.message === 'string') queue.push({
                event_id: String(row.event_id || uuid()).slice(0, 150), ts: Number(row.ts) || Date.now(),
                level: String(row.level || 'warn').slice(0, 10), message: clean(row.message),
                match_id: String(row.match_id || '').slice(0, 200), trace_id: String(row.trace_id || '').slice(0, 200),
            });
        } catch (_) { /* Ignore damaged backlog. */ }
        function context() {
            const state = currentState(), tournament = env.curt || (typeof curt === 'undefined' ? null : curt), params = new URLSearchParams(env.location.hash.replace(/^#/, ''));
            let tournamentKey = /^\/admin\/t\/([^/]+)/.exec(env.location.pathname)?.[1] || '';
            try { tournamentKey = decodeURIComponent(tournamentKey); } catch (_) { /* Retain malformed URLs for diagnosis. */ }
            let mode = state?.settings?.devicemode || (params.has('display') ? 'display' : params.has('umpire') ? 'umpire' : 'client');
            try { if (state?.settings && env.settings?.get_mode) mode = env.settings.get_mode(state); } catch (_) { /* Settings can still be loading. */ }
            const role = /\/diagnostics\/?$/.test(env.location.pathname) ? 'diagnostics' : /\/speech-planning\/?$/.test(env.location.pathname) ? 'speech-planning' :
                /^\/bup(?:dev)?\//.test(env.location.pathname) ? mode === 'display' ? 'display' : mode === 'umpire' ? 'umpire' : 'client' : 'admin';
            return { page_id: pageId, device_id: device, instance, version, role, path: env.location.pathname, dropped,
                tournament_key: tournament?.key || params.get('btsh_e') || tournamentKey,
                match_id: String(state?.setup?.match_id || '').replace(/^bts_/, ''), court_id: state?.settings?.court_id || '',
                label: state?.settings?.monitor_label || state?.settings?.client_id || doc.title || role };
        }
        function serialize(input, depth = 0, seen = new WeakSet()) {
            if (typeof input === 'string') return clean(input);
            if (input == null || typeof input === 'number' || typeof input === 'boolean') return input;
            if (typeof input !== 'object') return '[' + typeof input + ']';
            if (seen.has(input)) return '[Zyklus]'; seen.add(input);
            if (input instanceof Error || input?.stack && input?.message) return { message: clean(input.message), stack: clean(input.stack) };
            if (depth > 2) return '[gekürzt]';
            if (Array.isArray(input)) return input.slice(0, 10).map(item => serialize(item, depth + 1, seen));
            const value = {};
            for (const key of Object.keys(input).slice(0, 15)) try {
                value[key] = /password|passwd|secret|token|api.?key|authorization|cookie/i.test(key) ? '[entfernt]' : serialize(input[key], depth + 1, seen);
            } catch (_) { value[key] = '[nicht lesbar]'; }
            return value;
        }
        function record(level, message, detail) {
            try {
                const current = context();
                queue.push({ event_id: instance + ':' + (++sequence), ts: Date.now(), level, message: clean(message + (detail == null ? '' : ' ' + JSON.stringify(serialize(detail)))),
                    match_id: clean(detail?.match_id || current.match_id).slice(0, 200), trace_id: clean(detail?.trace_id || detail?.playback_id || '').slice(0, 200) });
                if (queue.length > 200) { queue.shift(); dropped++; }
            } catch (_) { /* Logging is best effort and bounded. */ }
        }
        function send(message) {
            if (!registered || ws?.readyState !== 1) return false;
            try { ws.send(JSON.stringify(message)); return true; } catch (_) { return false; }
        }
        function flush() {
            if (inflight && Date.now() - inflight.sent_at > 10000) { ws?.close(); return; }
            if (inflight || !queue.length || !registered) return;
            const entries = [];
            while (queue.length && entries.length < 3) {
                if (entries.length && JSON.stringify([...entries, queue[0]]).length > 9000) break;
                entries.push(queue.shift());
            }
            inflight = { id: ++batch, entries, sent_at: Date.now() };
            if (!send({ type: 'logs', batch_id: inflight.id, entries: inflight.entries })) { queue.unshift(...inflight.entries); inflight = null; }
        }
        function notice(message) {
            if (!message) { banner?.remove(); banner = null; return; }
            if (!doc.body) return;
            if (!banner) {
                banner = doc.createElement('div'); banner.setAttribute('role', 'status'); banner.id = 'bts-reload-notice';
                Object.assign(banner.style, { position: 'fixed', bottom: '12px', left: '12px', right: '12px', zIndex: '2147483646',
                    background: '#fff4d6', color: '#493500', padding: '12px', border: '1px solid #d9ad43', borderRadius: '8px', font: '14px sans-serif' });
                doc.body.appendChild(banner);
            }
            if (banner.textContent !== message) banner.textContent = message;
        }
        const inputValue = node => ['checkbox', 'radio'].includes(node.type) ? String(node.checked) : node.value;
        function remember(event) {
            const node = event.target;
            if (node?.matches?.('input,textarea,select') && node.closest('form') && !baselines.has(node)) baselines.set(node, inputValue(node));
        }
        function edited(event) {
            const node = event.target;
            if (!node?.matches?.('input,textarea,select') || !node.closest('form') || ['search', 'button', 'submit', 'hidden'].includes(node.type)) return;
            const initial = baselines.has(node) ? baselines.get(node) : ['checkbox', 'radio'].includes(node.type) ? String(node.defaultChecked) : node.defaultValue;
            if (inputValue(node) !== initial) dirty.set(node, initial); else dirty.delete(node);
        }
        function blockedReason() {
            if (!doc.body) return 'Ansicht wird noch geladen';
            for (const [node, value] of dirty) if (!node.isConnected || inputValue(node) === value) dirty.delete(node);
            if (dirty.size) return 'Ungespeicherte Eingaben · bitte speichern oder das Formular schließen';
            if (env.btsSpeechService?.isBusy?.() || env.speechSynthesis?.speaking || [...doc.querySelectorAll('audio')].some(audio => !audio.paused && !audio.ended)) return 'Eine Durchsage wird abgespielt';
            const state = currentState(), role = context().role;
            if (/^\/bup(?:dev)?\//.test(env.location.pathname) && role !== 'display' && !state?.settings) return 'Zähltablet kann noch nicht geprüft werden';
            if (state?.initialized && role !== 'display' && state.match && !state.match.finish_confirmed) return 'Laufendes Zähltablet · Neuladen nach bestätigtem Spielabschluss';
            for (const frame of doc.querySelectorAll('iframe')) try {
                const reason = frame.contentWindow?.btsDiagnostics?.blockedReason(); if (reason) return reason;
            } catch (_) { return 'Eingebettete Ansicht kann nicht geprüft werden'; }
            return null;
        }
        function wait(reason) {
            checking = false;
            if (pending && pending.reason !== reason) { pending.reason = reason; send({ type: 'reload_status', id: pending.id, state: 'waiting', reason }); }
            notice('Zentrales Neuladen vorgemerkt: ' + reason);
        }
        function guard() {
            const state = currentState();
            if (!state?.initialized || !state.setup?.match_id || context().role === 'display') return { idle: true };
            return { match_id: String(state.setup.match_id).replace(/^bts_/, ''), presses_json: JSON.stringify(state.presses || []) };
        }
        function tryReload() {
            if (!pending || !registered) return;
            if (Date.now() > pending.expires_at) { pending = null; checking = false; notice('Neuladeauftrag ist abgelaufen.'); return; }
            if (Date.now() < pending.start_at || checking && Date.now() - checkedAt < 5000) return;
            const reason = blockedReason(); if (reason) return wait(reason);
            const value = guard();
            if ((value.presses_json?.length || 0) > 250000) return wait('Spielprotokoll ist zu groß für die automatische Bestätigung');
            verifiedPresses = value.presses_json || null;
            checking = true; checkedAt = Date.now(); send({ type: 'reload_ready', id: pending.id, guard: value });
        }
        function reload(message) {
            if (!pending || pending.id !== message.id || Date.now() > pending.expires_at) return;
            const reason = blockedReason(); if (reason) return wait(reason);
            if ((guard().presses_json || null) !== verifiedPresses) return wait('Die Zähleingaben wurden inzwischen verändert');
            put(env.sessionStorage, storageKey + ':reload', pending.id); notice('Ansicht wird zentral aktualisiert …');
            const overlay = doc.createElement('div');
            Object.assign(overlay.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: '#ffffffed', display: 'grid', placeItems: 'center', font: '20px sans-serif' });
            overlay.textContent = 'Ansicht wird aktualisiert …'; doc.body.appendChild(overlay);
            const prevent = event => { event.preventDefault(); event.stopImmediatePropagation(); };
            doc.addEventListener('keydown', prevent, true); doc.addEventListener('pointerdown', prevent, true);
            const target = new URL(env.location.href); target.searchParams.set('_bts_reload', message.id); env.location.replace(target.href);
        }
        function connect() {
            if (stopped) return;
            ws = new env.WebSocket((env.location.protocol === 'https:' ? 'wss://' : 'ws://') + env.location.host + '/ws/diagnostics');
            ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', ...context(), reload_ack: get(env.sessionStorage, storageKey + ':reload', '') }));
            ws.onmessage = event => {
                let message; try { message = JSON.parse(event.data); } catch (_) { return; }
                if (message.type === 'registered') {
                    registered = true; verboseUntil = message.verbose_until || 0;
                    put(env.sessionStorage, storageKey + ':reload', null); put(env.sessionStorage, storageKey + ':backlog', null); flush();
                } else if (message.type === 'identity_conflict') {
                    pageId = uuid(); put(env.sessionStorage, storageKey, pageId); ws.send(JSON.stringify({ type: 'hello', ...context() }));
                } else if (message.type === 'logs_ack' && message.id === inflight?.id) inflight = null;
                else if (message.type === 'configuration') verboseUntil = message.verbose_until || 0;
                else if (message.type === 'reload_prepare') {
                    pending = { ...message, start_at: Date.now() + Math.min(300000, Math.max(0, message.delay_ms || 0)) }; checking = false; tryReload();
                } else if (message.type === 'reload_wait' && pending?.id === message.id) wait(message.reason || 'Serverbestätigung steht aus');
                else if (message.type === 'reload_go') reload(message);
                else if (message.type === 'reload_cancel' && pending?.id === message.id) { pending = null; checking = false; notice(null); }
            };
            ws.onclose = () => {
                registered = false;
                if (inflight) { queue.unshift(...inflight.entries); inflight = null; if (queue.length > 200) { dropped += queue.length - 200; queue.length = 200; } }
                record('warn', 'Diagnoseverbindung unterbrochen'); if (!stopped) retry = env.setTimeout(connect, 3000);
            };
            ws.onerror = () => ws.close();
        }
        for (const name of ['warn', 'error', 'log', 'info', 'debug']) {
            const original = env.console[name];
            env.console[name] = function(...args) {
                original.apply(env.console, args);
                if (['warn', 'error'].includes(name) || Date.now() < verboseUntil) try {
                    record(name === 'log' ? 'info' : name, args.slice(0, 5).map(arg => typeof arg === 'string' ? arg : JSON.stringify(serialize(arg))).join(' '));
                } catch (_) { /* Console output remains available. */ }
            };
        }
        for (const type of ['focusin', 'pointerdown', 'keydown']) doc.addEventListener(type, remember, true);
        for (const type of ['input', 'change']) doc.addEventListener(type, edited, true);
        env.addEventListener('error', event => record('error', event.message || 'Ressource konnte nicht geladen werden', event.error || { source: event.target?.src || event.filename, line: event.lineno }), true);
        env.addEventListener('unhandledrejection', event => record('error', 'Unbehandelter Promise-Fehler', event.reason));
        const beat = env.setInterval(() => send({ type: 'heartbeat', ...context() }), 15000);
        env.addEventListener('load', () => env.setTimeout(() => send({ type: 'heartbeat', ...context() }), 1000));
        for (const event of ['hashchange', 'popstate']) env.addEventListener(event, () => send({ type: 'heartbeat', ...context() }));
        const timer = env.setInterval(() => { flush(); tryReload(); }, 1000);
        env.addEventListener('pagehide', () => {
            stopped = true; env.clearTimeout(retry); env.clearInterval(beat); env.clearInterval(timer);
            const backlog = [...(inflight?.entries || []), ...queue]; dropped += Math.max(0, backlog.length - 100);
            put(env.sessionStorage, storageKey + ':backlog', JSON.stringify(backlog.slice(-100))); put(env.sessionStorage, storageKey + ':dropped', String(dropped));
            send({ type: 'bye' }); ws?.close();
        });
        connect(); return { record, blockedReason, context, _tryReload: tryReload };
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = create;
    else if (!root.btsDiagnostics) root.btsDiagnostics = create(root, root.document.currentScript?.dataset.btsVersion || 'unbekannt');
})(typeof window === 'undefined' ? null : window);
