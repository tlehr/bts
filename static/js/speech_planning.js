'use strict';

(function() {
    const match = /^\/admin\/t\/([^/]+)\/speech-planning\/?$/.exec(window.location.pathname);
    if (!match) return;
    const key = decodeURIComponent(match[1]), main = document.querySelector('main'), svg = document.getElementById('overview');
    const svgNS = 'http://www.w3.org/2000/svg';
    const nodes = new Map(), pending = new Map();
    let socket, serial = 0, stopped = false, reconnect, poll, loading = false;
    const make = (parent, tag, cls, text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text) node.textContent = text;
        parent.appendChild(node); return node;
    };
    document.querySelector('.eyebrow').textContent = 'BTS · Sprachplanung · Live';
    document.querySelector('.footer > span').textContent = 'Aktueller BTS-Stand · automatische Aktualisierung alle zwei Sekunden.';
    const live = make(main, 'section', 'speech_plan_live');
    main.insertBefore(live, document.querySelector('.toolbar'));
    const title = make(live, 'h2', '', 'Verbindung zu BTS wird aufgebaut …');
    const state = make(live, 'p', 'speech_plan_state'); state.setAttribute('aria-live', 'polite');
    const phase = make(live, 'p');
    const counts = make(live, 'p', 'speech_plan_counts');
    const overall = bar(live);
    const current = make(live, 'p', 'speech_plan_current');
    make(live, 'p', 'speech_plan_help', 'Grün: bereit · Orange: in der Queue · Grau: noch ohne Auftrag. Gemeinsame Bausteine zählen einmal, beim vorrangigen Bedarf. Gold markiert die aktuelle oder nächste Aufgabe; blaue Rahmen zeigen vorhandene Spielzustände.');
    const stages = make(main, 'section', 'speech_plan_stages');
    main.insertBefore(stages, document.getElementById('detail'));
    make(stages, 'h2', '', 'Fortschritt nach Planungsbereich');
    const grid = make(stages, 'div', 'speech_plan_grid');
    const anchors = {
        urgent: [40, 117, 1200], test: [40, 177, 1200], shared: [40, 305, 1200], registration: [40, 463, 1200],
        oncourt: [580, 580, 380], preparation: [580, 685, 380], officials: [580, 776, 380],
        candidate: [76, 550, 400], planned: [76, 623, 400], registration_reserve: [76, 721, 400],
        tablet_waiting: [544, 849, 440], tablet: [76, 794, 400], people: [76, 867, 400], spare: [40, 975, 1200],
    };
    function bar(parent) {
        const track = make(parent, 'div', 'speech_plan_bar'); track.setAttribute('role', 'img');
        const ready = make(track, 'span', 'speech_plan_ready'), queued = make(track, 'span', 'speech_plan_queued');
        return { track, ready, queued };
    }
    function label(value) { return value.ready + ' bereit · ' + value.queued + ' in der Queue · ' + value.total + ' gesamt'; }
    function paintBar(row, value) {
        row.track.setAttribute('aria-label', label(value));
        row.ready.style.width = (value.ready * 100 / (value.total || 1)) + '%';
        row.queued.style.width = (value.queued * 100 / (value.total || 1)) + '%';
    }
    function svgEl(parent, tag, attrs) {
        const node = document.createElementNS(svgNS, tag);
        for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
        parent.appendChild(node); return node;
    }
    // Keep live highlights in SVG exports as well as on the HTML page.
    svgEl(svg, 'style', {}).textContent = '.live-outline{display:none;fill:none;stroke:#d48815;stroke-width:3;pointer-events:none}' +
        '.live-current>.live-outline{display:block}.live-current{opacity:1!important}' +
        '.phase.live-present>rect{stroke:#2475b4;stroke-dasharray:6 3;stroke-width:3}';
    function stageRow(value) {
        if (nodes.has(value.id)) return nodes.get(value.id);
        const card = make(grid, 'section', 'speech_plan_card'); card.dataset.stage = value.id;
        const heading = make(card, 'h3', '', value.label), caption = make(card, 'p');
        const progress = bar(card);
        const node = value.node ? svg.getElementById(value.node) : null;
        let mini;
        if (node && anchors[value.id]) {
            const [x, y, width] = anchors[value.id], box = node.getBBox();
            const outline = svgEl(node, 'rect', { x: box.x - 6, y: box.y - 4, width: box.width + 12, height: box.height + 8, rx: 6, class: 'live-outline' });
            node.insertBefore(outline, node.firstChild);
            const group = svgEl(node, 'g', { class: 'live-progress', role: 'img' });
            svgEl(group, 'rect', { x, y, width, height: 5, rx: 2, fill: '#cbd5e1' });
            const ready = svgEl(group, 'rect', { x, y, width: 0, height: 5, fill: '#21804b' });
            const queued = svgEl(group, 'rect', { x, y, width: 0, height: 5, fill: '#e88925' });
            const tooltip = svgEl(group, 'title', {});
            mini = { group, x, width, ready, queued, tooltip };
        }
        const row = { card, heading, caption, ...progress, node, mini };
        nodes.set(value.id, row); return row;
    }
    function disconnected(text) {
        live.dataset.connected = 'false'; state.textContent = text;
        svg.querySelectorAll('.live-current,.live-present').forEach(node => node.classList.remove('live-current', 'live-present'));
        for (const row of nodes.values()) row.card.classList.remove('is-current');
    }
    function render(snapshot) {
        live.dataset.connected = 'true';
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
        counts.textContent = label(snapshot.total); paintBar(overall, snapshot.total);
        const active = snapshot.stages.find(row => row.id === snapshot.active_stage);
        current.textContent = active ? (snapshot.current?.running ? 'Aktuell: ' : 'Als Nächstes: ') + active.label +
            (snapshot.current ? ' — ' + snapshot.current.text : '') : '';
        if (snapshot.current?.retry_at > Date.now()) current.textContent += ' · frühestens ' + new Date(snapshot.current.retry_at).toLocaleTimeString('de-DE');
        live.dataset.state = snapshot.state;
        for (const row of nodes.values()) { row.card.hidden = true; row.node?.classList.remove('live-current'); }
        for (const value of snapshot.stages) {
            const row = stageRow(value); row.card.hidden = false;
            row.caption.textContent = label(value); paintBar(row, value);
            row.card.classList.toggle('is-current', value.id === snapshot.active_stage);
            row.node?.classList.toggle('live-current', value.id === snapshot.active_stage);
            if (row.mini) {
                const { mini } = row, ready = value.ready * mini.width / (value.total || 1), queued = value.queued * mini.width / (value.total || 1);
                mini.ready.setAttribute('width', ready); mini.queued.setAttribute('x', mini.x + ready); mini.queued.setAttribute('width', queued);
                mini.group.setAttribute('aria-label', label(value)); mini.tooltip.textContent = value.label + ': ' + label(value);
            }
        }
        svg.querySelectorAll('.phase').forEach(node => node.classList.toggle('live-present', (snapshot.games[node.dataset.state] || 0) > 0));
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
