'use strict';

(function() {
    const match = /^\/admin\/t\/([^/]+)\/speech-planning\/?$/.exec(window.location.pathname);
    if (!match) return;
    const key = decodeURIComponent(match[1]), main = document.querySelector('main');
    const diagram = window.btsSpeechPlanningDiagram, pending = new Map();
    let socket, serial = 0, stopped = false, reconnect, poll, loading = false;
    const make = (parent, tag, cls, text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text) node.textContent = text;
        parent.appendChild(node); return node;
    };
    document.querySelector('.eyebrow').textContent = 'BTS · Sprachplanung · Live';
    document.querySelector('.footer > span').textContent = 'Aktueller BTS-Stand · automatische Aktualisierung alle zwei Sekunden.';
    const followStatus = document.querySelector('.speech_plan_follow_status');
    const live = make(main, 'section', 'speech_plan_live'); main.insertBefore(live, followStatus);
    const title = make(live, 'h2', '', 'Verbindung zu BTS wird aufgebaut …');
    const state = make(live, 'p', 'speech_plan_state'); state.setAttribute('aria-live', 'polite');
    const phase = make(live, 'p');
    const counts = make(live, 'p', 'speech_plan_counts');
    const track = make(live, 'div', 'speech_plan_bar'); track.setAttribute('role', 'img');
    const ready = make(track, 'span', 'speech_plan_ready'), queued = make(track, 'span', 'speech_plan_queued');
    const current = make(live, 'p', 'speech_plan_current');
    make(live, 'p', 'speech_plan_help', 'Gemeinsame Bausteine zählen einmal, beim vorrangigen Bedarf. Die Balken zählen abspielbare Teile; Quellaufnahmen zählen nicht zusätzlich.');
    const inactive = { complete: 'Keine Generierung aktiv – alles bereit.',
        updating: 'Plan wird aktualisiert – keine Generierung aktiv.',
        disabled: 'Lokale Sprachgenerierung ausgeschaltet.',
        failed: 'Keine Generierung aktiv – fehlgeschlagene Aufträge sind offen.',
        idle_pending: 'Keine Generierung aktiv – weitere Vorarbeit wartet auf Leerlauf.',
        busy_elsewhere: 'Sprachserver arbeitet für ein anderes Turnier.',
        waiting: 'Keine Generierung aktiv – Aufträge warten.' };
    function disconnected(text) {
        live.dataset.connected = 'false'; state.textContent = text; current.textContent = '';
        followStatus.dataset.active = 'false';
        followStatus.textContent = 'Verbindung unterbrochen – aktueller Generierungsstatus unbekannt.';
        diagram.disconnect();
    }
    function render(snapshot) {
        live.dataset.connected = 'true'; live.dataset.state = snapshot.state;
        title.textContent = snapshot.title;
        const labels = { disabled: 'Lokale Sprachvorbereitung ist ausgeschaltet.', updating: 'BTS aktualisiert den Plan …',
            working: 'Sprachserver bearbeitet einen Auftrag.', busy_elsewhere: 'Der Sprachserver bearbeitet einen Auftrag eines anderen Turniers.',
            waiting: 'Nächster Auftrag wartet auf die Bearbeitung.', failed: 'Es sind fehlgeschlagene Aufgaben offen.',
            idle_pending: 'Weitere Vorarbeit ist für den Leerlauf vorgesehen.', complete: 'Alle aktuell geplanten Teile sind bereit.' };
        state.textContent = labels[snapshot.state] || 'Planungsstand wird geladen …';
        const gameLabels = { planned: 'geplant', candidate: 'Aufrufkandidaten', preparation: 'in Vorbereitung', oncourt: 'auf dem Feld', finished: 'abgeschlossen' };
        phase.textContent = (snapshot.phase === 'registration' ? 'Vor der ersten Auslosung' : snapshot.phase === 'competition' ? 'Spielbetrieb' : 'Turnierphase wird ermittelt') +
            ' · ' + (snapshot.voice === 'hallensprecher' ? 'Hallensprecher' : 'Hallensprecherin') + ' · ' +
            Object.entries(snapshot.games).map(([id, n]) => n + ' ' + gameLabels[id]).join(' · ');
        const value = snapshot.total;
        counts.textContent = value.ready + ' bereit · ' + value.queued + ' in der Queue · ' + value.total + ' gesamt';
        track.setAttribute('aria-label', counts.textContent);
        ready.style.width = value.ready * 100 / (value.total || 1) + '%';
        queued.style.width = value.queued * 100 / (value.total || 1) + '%';
        const active = ['working', 'waiting', 'busy_elsewhere'].includes(snapshot.state) ? snapshot.stages.find(row => row.id === snapshot.active_stage) : null;
        followStatus.dataset.active = String(!!active);
        const caption = active ? (snapshot.current?.running ? 'Aktuell: ' : 'Als Nächstes: ') + active.label : inactive[snapshot.state] || 'Planungsstand wird ermittelt …';
        if (followStatus.textContent !== caption) followStatus.textContent = caption;
        current.textContent = snapshot.current?.retry_at > Date.now() ? 'Nächster Versuch frühestens ' +
            new Date(snapshot.current.retry_at).toLocaleTimeString('de-DE') : '';
        diagram.update(snapshot);
        live.dataset.updatedAt = snapshot.updated_at;
    }
    function request(values) {
        return new Promise((resolve, reject) => {
            const rid = ++serial, timer = setTimeout(() => { pending.delete(rid); reject(new Error('timeout')); }, 5000);
            pending.set(rid, { resolve, reject, timer });
            socket.send(JSON.stringify({ ...values, rid }));
        });
    }
    async function refresh() {
        if (loading || stopped || socket?.readyState !== WebSocket.OPEN) return;
        loading = true;
        try {
            const response = await request({ type: 'speech_planning', tournament_key: key });
            if (response.planning) render(response.planning);
            else disconnected('Planungsstand derzeit nicht verfügbar.');
        } catch (_) { disconnected('Planungsstand konnte nicht aktualisiert werden.'); }
        finally { loading = false; }
    }
    function connect() {
        if (stopped) return;
        socket = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/admin');
        socket.onmessage = event => {
            let response;
            try { response = JSON.parse(event.data); } catch (_) { return; }
            const waiter = pending.get(response.rid);
            if (!waiter) return;
            clearTimeout(waiter.timer); pending.delete(response.rid);
            if (response.type === 'error') waiter.reject(new Error('server_error')); else waiter.resolve(response);
        };
        socket.onopen = async () => {
            try {
                const response = await request({ type: 'tournament_get', key, defer_finished_history: true });
                if (!response.tournament) throw new Error('not_found');
                await refresh(); clearInterval(poll); poll = setInterval(refresh, 2000);
            } catch (_) { disconnected('Turnier konnte nicht geladen werden.'); socket.close(); }
        };
        socket.onclose = () => {
            clearInterval(poll); loading = false;
            for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error('disconnected')); }
            pending.clear(); disconnected('Verbindung zu BTS unterbrochen. Verbindung wird wiederhergestellt …');
            if (!stopped) reconnect = setTimeout(connect, 3000);
        };
        socket.onerror = () => socket.close();
    }
    window.addEventListener('pagehide', () => { stopped = true; clearTimeout(reconnect); clearInterval(poll); socket?.close(); });
    connect();
})();
