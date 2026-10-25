'use strict';

(function() {
    const match = /^\/admin\/t\/([^/]+)\/speech-planning\/?$/.exec(window.location.pathname);
    if (!match) return;
    const key = decodeURIComponent(match[1]), main = document.querySelector('main');
    const diagram = window.btsSpeechPlanningDiagram, pending = new Map();
    let socket, serial = 0, stopped = false, reconnect, poll, loading = false;
    let snapshot = null, queueSnapshot = null, connected = false, selected = null, follow = true, view = 'overview', fitted = false;
    let selectedArea = 'tablet', selectedPhase = 'people', selectedEvent = null;
    const $ = id => document.getElementById(id);
    const make = (parent, tag, cls, text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text) node.textContent = text;
        parent.appendChild(node); return node;
    };
    const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char]));
    const alias = id => id === 'registration_reserve' ? 'registration' : id;
    const phases = [['states', 'Landesverbände'], ['clubs', 'Vereine'], ['people', 'Spieler/Paarungen'], ['numbers', 'Spielnummern · erste Runde']];
    const operationLabels = { synthesis: 'Sprachaufnahme', excerpt: 'Ausschnitt', processing: 'Aufbereitung' };
    const priorities = { high: 'Hoch · Aufruf', normal: 'Normal · benötigt', low: 'Niedrig · angefordert', idle: 'Nur bei Leerlauf', spare: 'Andere Stimme · Vorrat' };
    const voiceLabel = voice => voice === 'hallensprecher' ? 'Hallensprecher' : voice === 'hallensprecherin' ? 'Hallensprecherin' : voice || 'Stimme wird geladen';
    const normalize = value => Object.fromEntries(['ready', 'queued', 'total', 'failed'].map(field =>
        [field, Number.isFinite(value?.[field]) ? Math.max(0, value[field]) : 0]));
    const sum = values => values.reduce((total, value) => {
        for (const field of ['ready', 'queued', 'total', 'failed']) total[field] += value?.[field] || 0;
        return total;
    }, normalize());
    const complete = value => value.total > 0 && value.ready === value.total && !value.queued && !value.failed;
    const countText = value => value.ready + ' bereit · ' + value.queued + ' in der Queue · ' + value.total + ' gesamt' +
        (value.failed ? ' · ' + value.failed + ' fehlgeschlagen' : '');
    const pill = (text, type = 'waiting') => `<span class="pill ${type}">${esc(text)}</span>`;
    const bar = value => `<div class="bar" role="img" aria-label="${esc(countText(value))}"><span class="ready" style="width:${Math.min(100, value.ready * 100 / (value.total || 1))}%"></span><span class="queued" style="width:${Math.min(100, value.queued * 100 / (value.total || 1))}%"></span></div>`;
    const metric = value => `<div class="metrics mono"><span class="ready-count"><strong>${value.ready}</strong>bereit</span><span class="queue-count"><strong>${value.queued}</strong>in der Queue</span><span><strong>${value.total}</strong>gesamt</span>${value.failed ? `<span>${value.failed} fehlgeschlagen</span>` : ''}</div>`;
    const diagramSection = document.querySelector('.diagram'), oldFooter = document.querySelector('main > .footer');
    const exportButton = $('download'), printButton = $('print');
    const definitions = new Map([...document.querySelectorAll('.flow-step')].map(node => [node.dataset.stage, {
        title: node.querySelector('h3').textContent, description: node.querySelector('.flow-description').textContent,
    }]));
    const rules = {
        urgent: 'Tatsächlich ausgelöste Ansagen zuerst, in Auslösereihenfolge. Ein laufender Auftrag wird vor der nächsten Priorisierung beendet.',
        test: 'Der Sprachtest wird immer vorbereitet. Angeforderte Proben gehören ebenfalls in diesen Bereich.',
        shared: 'Gemeinsame Feld-, Hallen- und Treffpunkttexte werden für viele Ansagen wiederverwendet.',
        officials: 'Alle hinterlegten Offiziellen mit Namen und Rollen, auch ohne Zuordnung zu einem Spiel.',
        tablet_waiting: 'Dienstgruppen der Tablet-Warteliste stehen vor laufenden Spielen.',
        oncourt: 'Laufende Spiele folgen ihrer Aufrufzeit.',
        preparation: 'Spiele in Vorbereitung folgen dem Zeitpunkt ihres Vorbereitungsaufrufs.',
        candidate: 'Alle Spiele bis zur Aufrufgrenze, bei denen alle Spieler feststehen und die noch nicht in Vorbereitung sind. Die Reihenfolge folgt dem Spielplan.',
        planned: 'Weitere Spiele folgen dem BTS-Spielplan; unbekannte Teilnehmer werden nicht ergänzt.',
        tablet: 'Disziplinen nach ihrem nächsten oder ersten angesetzten Spiel. Jede Disziplin vollständig vorbereiten: Landesverbände → Vereine → Spieler/Paarungen → Spielnummern der ersten Runde. Erst danach folgt die nächste Disziplin. Ohne Spielplanung gilt anschließend die BTP-Reihenfolge.',
        registration: 'Geöffnete Anmeldungen zuerst, dann noch nicht geöffnete Anmeldungen. In jedem Bereich: Landesverbände aller Disziplinen → Vereine aller Disziplinen → je Disziplin Spieler/Paarungen und anschließend die Spielnummern ihrer ersten Runde. Disziplinen nach erstem angesetzten Spiel, sonst BTP-Reihenfolge.',
        people: 'Verbleibender Bedarf aller bekannten Personen und Teams. Bereits vorhandene Bausteine werden wiederverwendet.',
        spare: 'Die andere Stimme folgt nur bei aktivierter Option, vorbereiteter gewählter Stimme und vollständigem Leerlauf aller Turniere.',
        additional: 'Zusätzlicher konkreter Bedarf ohne Zuordnung zu einem anderen Bereich steht vor dem Vorrat.',
    };
    for (const heading of diagramSection.querySelectorAll('.flow-heading,.flow-hint')) heading.remove();
    for (const node of [...main.children]) if (node !== diagramSection && node !== oldFooter) node.remove();
    main.className = 'app'; document.body.classList.add('speech-planning-page');
    main.insertAdjacentHTML('afterbegin', `
      <header class="masthead"><div class="brand"><div class="brand-mark">BTS</div><div class="brand-copy"><strong>Turnierleitung</strong><span class="muted small" id="tournament-name">Turnier wird geladen …</span></div></div><a class="back-link" href="/admin/t/${encodeURIComponent(key)}/">← Zum Turnier</a></header>
      <div class="page-heading"><div><h1>Sprachvorbereitung</h1><p class="subtitle">Was ist als Nächstes dran – und warum?</p></div><span class="pill waiting" id="connection-status" role="status">Verbindung wird aufgebaut</span></div>
      <div class="conditions" id="conditions" aria-label="Voraussetzungen"></div>
      <section class="speech_plan_live now" data-connected="false" aria-label="Aktueller Auftrag">
        <div><div class="eyebrow"><i class="dot live-dot"></i><span id="now-state">Planungsstand wird geladen</span></div><h2 id="now-name">Verbindung zu BTS wird aufgebaut …</h2><p id="now-subtitle" class="sub speech_plan_state"></p><p class="speech_plan_phase" id="phase-summary"></p></div>
        <div class="why"><strong>Warum gerade dieser Auftrag?</strong><p id="now-why">Die aktuelle Planung wird von BTS geladen.</p></div><button type="button" class="outline-button" id="jump-current">Im Plan ansehen ↗</button>
        <div class="now-statistics"><p class="speech_plan_counts" id="total-counts">Fortschritt wird geladen …</p><div id="total-bar"></div></div>
      </section>
      <div class="view-bar"><div class="view-switch" role="tablist" aria-label="Darstellung wählen"><button type="button" role="tab" id="view-overview" data-view="overview" aria-selected="true" aria-controls="detail-column">Übersicht</button><button type="button" role="tab" id="view-diagram" data-view="diagram" aria-selected="false" aria-controls="diagram-panel">Zustandsdiagramm</button><button type="button" role="tab" id="view-games" data-view="games" aria-selected="false" aria-controls="games-panel">Spiele</button></div><p id="view-note">Prioritäten, Disziplinen und Begründungen im Überblick.</p></div>
      <p class="speech_plan_follow_status" aria-live="polite">Verbindung zu BTS wird aufgebaut …</p>
      <div class="workspace speech_plan_workspace">
        <nav class="plan" aria-label="Priorisierte Vorbereitungsbereiche"><div class="plan-heading"><h2>Bearbeitungsreihenfolge</h2>${pill('oben zuerst')}</div><p class="plan-subtitle">Bereich auswählen, um alle Details zu sehen.</p><div id="plan-list"></div><div class="plan-footer" id="plan-total"></div></nav>
        <div class="detail" id="detail-column" role="tabpanel" aria-labelledby="view-overview"><section class="panel"><div class="detail-header" id="detail-header"></div><div class="detail-content" id="detail-content"></div></section><section class="panel rules"><details><summary>So entsteht die Reihenfolge · Bedingungen und Zählweise</summary><div class="rules-grid"><div><strong>1. Auswahl nach Priorität</strong><p>Der erste Bereich mit fehlendem Bedarf kommt zum Zug. Fertige Bereiche und Bereiche ohne Bedarf werden übersprungen. Die Reihenfolge bleibt in allen Turnierphasen gleich: Vorbereitung angemeldeter Disziplinen vor Anmeldevorarbeit.</p></div><div><strong>2. Konkreter Auftrag</strong><p>Innerhalb des Bereichs gelten seine Phasen, Disziplinen und Spielreihenfolgen. Eine Quellaufnahme muss vor den daraus benötigten Ausschnitten fertig sein. Nach jedem Auftrag wird neu priorisiert.</p></div><div><strong>3. Bereit, Queue, Gesamt</strong><p>Die Balken zählen abspielbare Teile. Quellaufnahmen zählen nicht zusätzlich. Gemeinsam genutzte Bausteine zählen in der Bereichssumme einmal, können aber in mehreren Disziplinen benötigt werden. Fehlgeschlagene Aufträge erhalten einen eigenen Hinweis.</p></div></div></details></section></div>
        <section class="panel diagram-panel" id="diagram-panel" role="tabpanel" aria-labelledby="view-diagram" hidden><div class="panel-header"><div><div class="eyebrow">Derselbe Plan · andere Darstellung</div><h2>Zustandsdiagramm</h2><p>Vollständiger Ablauf mit Entscheidungen und Unterzuständen. Ein Klick wählt einen Bereich für die Übersicht aus.</p></div>${pill('Live-Daten','ready')}</div><div class="diagram-tools"><button type="button" class="outline-button" id="diagram-start">Zum Anfang ↑</button><button type="button" class="outline-button" id="diagram-current">Aktueller Auftrag ↗</button><button type="button" class="outline-button" id="diagram-fit" aria-pressed="false">Gesamtbreite</button><button type="button" class="outline-button" id="diagram-details">Auswahl in Übersicht öffnen →</button><span class="diagram-selection" id="diagram-selection"></span></div><div class="diagram-legend"><span><i style="background:var(--green)"></i>fertig</span><span><i style="background:var(--amber)"></i>aktueller Bedarf</span><span><i style="background:var(--teal)"></i>geprüfter Auswahlweg</span><span>Passt sich der verfügbaren Breite an · Auswahl erhält einen Petrolrahmen.</span></div></section>
        <aside class="panel queue speech_plan_queue" id="queue" aria-labelledby="speech-plan-queue-heading"><div class="queue-heading"><h2 id="speech-plan-queue-heading">Konkrete Queue</h2><span class="pill waiting" id="queue-running">Wird geladen</span></div><p class="speech_plan_queue_summary" aria-live="polite">Warteschlange wird geladen …</p><ol class="speech_plan_queue_list" aria-label="Aktuelle Generierungsreihenfolge" tabindex="0"></ol><p class="speech_plan_queue_empty" hidden></p><div class="reuse">Bereits fertige Aufnahmen werden wiederverwendet.</div><details class="queue-rules"><summary>So wird die Queue abgearbeitet</summary><p>Laufende Aufträge auf Sprachserver und Helfern zuerst. Danach ausführbare Aufträge, anschließend blockierte Ausschnitte und Fehler. Fehlende Quellen kommen vor ihren Ausschnitten. Ausgelöste Ansagen haben Vorrang; die Stimme wechselt je Priorität. Positionsnummern gelten für alle Turniere zusammen. Nach jedem Auftrag wird neu priorisiert.</p></details></aside>
      </div>`);
    const gamesPanel = make(document.querySelector('.workspace'), 'section', 'panel games-panel');
    gamesPanel.id = 'games-panel'; gamesPanel.hidden = true; gamesPanel.setAttribute('role', 'tabpanel'); gamesPanel.setAttribute('aria-labelledby', 'view-games');
    const gamesView = window.btsSpeechPlanningGames(gamesPanel, request, key);
    $('diagram-panel').appendChild(diagramSection);
    for (const button of [exportButton, printButton]) { button.className = 'outline-button'; document.querySelector('.diagram-tools').insertBefore(button, $('diagram-selection')); }
    oldFooter.remove();
    make(main, 'footer', 'footer', 'Aktuelle BTS-Daten · automatische Aktualisierung alle zwei Sekunden.');
    const live = document.querySelector('.speech_plan_live'), followStatus = document.querySelector('.speech_plan_follow_status');
    const queuePanel = $('queue'), queueList = document.querySelector('.speech_plan_queue_list');
    const queueSummary = document.querySelector('.speech_plan_queue_summary'), queueEmpty = document.querySelector('.speech_plan_queue_empty');
    const queueRows = new Map(), htmlCache = new WeakMap();
    function html(node, value) {
        if (htmlCache.get(node) === value) return;
        htmlCache.set(node, value);
        const focused = node.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
        const opened = new Set([...node.querySelectorAll('details[open]')].map(detail => detail.dataset.persist));
        node.innerHTML = value;
        for (const detail of node.querySelectorAll('details')) if (opened.has(detail.dataset.persist)) detail.open = true;
        if (focused) [...node.querySelectorAll('[data-focus-key]')].find(button => button.dataset.focusKey === focused)?.focus({ preventScroll: true });
    }
    function stageRows() {
        const rows = new Map((snapshot?.stages || []).map(row => [row.id, normalize(row)]));
        rows.set('registration', sum([rows.get('registration'), rows.get('registration_reserve')]));
        return rows;
    }
    const groups = () => diagram.model(snapshot).groups;
    const order = () => groups().flatMap(group => group.ids);
    const number = id => diagram.model(snapshot).numbers[id];
    const active = () => connected && ['working', 'waiting', 'busy_elsewhere'].includes(snapshot?.state) ? alias(snapshot.active_stage) : null;
    const stageProgress = id => stageRows().get(id) || normalize();
    function label(id, value) {
        if (!connected) return ['Status unbekannt', 'waiting'];
        if (id === active()) return [snapshot.current?.running ? 'Wird bearbeitet' : 'Als Nächstes', 'active'];
        if (id === 'spare' && !snapshot.stages?.some(row => row.id === 'spare')) return ['Option ausgeschaltet', 'waiting'];
        if (value.failed) return ['Fehler offen', 'waiting'];
        if (!value.total) return [id === 'officials' && snapshot.has_officials === false ? 'Keine Offiziellen' : 'Kein Bedarf', 'waiting'];
        return complete(value) ? ['Bereit', 'ready'] : ['Später an der Reihe', 'waiting'];
    }
    function eventsFor(area) {
        if (area === 'tablet') return (snapshot?.tablet_progress || []).map(event => ({ ...event, cells: Object.fromEntries(phases.map(([id]) => {
            const amount = event.phases?.find(phase => phase.id === id) || snapshot.tablet_phases?.find(phase => phase.id === id)?.events?.find(row => String(row.id) === String(event.id));
            return [id, amount ? normalize(amount) : null];
        })) }));
        return (snapshot?.registration_order || []).filter(event => event.state === area).map(event => ({ ...event,
            cells: Object.fromEntries(phases.map(([id]) => [id, normalize(snapshot.registration_progress?.find(phase => phase.id === area + '_' + id)?.events?.find(row => String(row.id) === String(event.id)))])),
        }));
    }
    function gameText(event, area = 'tablet') {
        const game = event.next_game || event.first_game;
        if (!game) return 'Ohne bekannte Spielplanung';
        return (area === 'tablet' && event.next_game ? 'Nächstes Spiel' : 'Erstes angesetztes Spiel') + (game.number != null ? ' ' + game.number : '') +
            (game.date ? ' · ' + String(game.date).split('-').reverse().join('.') : '') + (game.time ? ' · ' + game.time : '');
    }
    function isCurrent(area, phase, event) {
        const planning = snapshot?.current?.planning;
        return !!planning && active() === (area === 'tablet' ? 'tablet' : 'registration') && String(planning.event_id) === String(event) &&
            (area === 'tablet' ? (planning.tablet_phase || 'people') === phase : planning.registration_phase === area + '_' + phase);
    }
    function choose(id, planning = null, following = false) {
        id = alias(id);
        if (!definitions.has(id)) return;
        selected = id; follow = following;
        if (planning?.event_id != null) {
            selectedEvent = String(planning.event_id);
            if (id === 'tablet') { selectedArea = 'tablet'; selectedPhase = planning.tablet_phase || 'people'; }
            if (id === 'registration') {
                const [area, phase] = (planning.registration_phase || 'open_states').split('_');
                selectedArea = ['open', 'closed'].includes(area) ? area : 'open';
                selectedPhase = phases.some(([id]) => id === phase) ? phase : 'states';
            }
        } else if (['registration', 'tablet'].includes(id)) {
            selectedArea = id === 'tablet' ? 'tablet' : ['open', 'closed'].includes(selectedArea) ? selectedArea : 'open';
            const events = eventsFor(selectedArea);
            if (!events.some(event => String(event.id) === selectedEvent)) selectedEvent = events[0] ? String(events[0].id) : null;
        }
    }
    function renderPlan() {
        html($('plan-list'), groups().map(({ id: group, title, ids }) => `<section class="plan-group" data-group="${group}"><h3>${esc(title)}</h3>${ids.map(id => {
            const value = stageProgress(id), [status] = label(id, value), current = id === active();
            return `<button type="button" class="plan-step" data-stage="${id}" data-focus-key="stage:${id}" data-current="${current}" data-status="${value.total ? 'work' : 'empty'}" aria-pressed="${id === selected}"><span class="number">${number(id)}</span><span><span class="title">${esc(definitions.get(id).title)}</span><span class="note">${esc(!connected ? status : current ? status : value.total ? value.ready + ' / ' + value.total + ' bereit' : status)}</span></span><span class="symbol" aria-hidden="true">${current ? '●' : complete(value) ? '✓' : value.total ? '·' : '—'}</span></button>`;
        }).join('')}</section>`).join(''));
        const total = sum(order().filter(id => id !== 'spare').map(stageProgress));
        html($('plan-total'), connected ? `<strong>${total.ready} / ${total.total}</strong> Bausteine der gewählten Stimme bereit${bar(total)}<p style="margin-top:8px">Fertig oder kein Bedarf? Dann geht es direkt zum nächsten Bereich. Nach jedem Auftrag wird neu priorisiert.</p>` : 'Fortschritt derzeit nicht verfügbar.');
    }
    function phaseProgress(area, phase) {
        const value = area === 'tablet' ? snapshot?.tablet_phases?.find(item => item.id === phase) :
            snapshot?.registration_progress?.find(item => item.id === area + '_' + phase);
        return value ? normalize(value) : null;
    }
    function matrix(events, area) {
        if (!events.length) return `<div class="empty-box"><h3>${area === 'tablet' ? 'Keine passenden Disziplinen' : area === 'open' ? 'Keine offenen Anmeldungen' : 'Keine noch nicht geöffneten Anmeldungen'}</h3><p>In diesem Bereich gibt es derzeit nichts vorzubereiten.</p></div>`;
        const areaPhases = phases, phaseName = id => areaPhases.find(([phase]) => phase === id)?.[1];
        return `<div class="matrix-wrap" data-area="${area}" role="region" aria-label="Fortschritt je Disziplin und Phase"><table class="matrix"><caption hidden>Disziplinen in Generierungsreihenfolge</caption><thead><tr><th>Disziplin<br><span class="muted small" style="font-weight:400;font-size:10px">Reihenfolge des Bedarfs</span></th>${areaPhases.map(([phase, title], index) => {
            const value = phaseProgress(area, phase);
            const current = area !== 'tablet' && active() === 'registration' && snapshot?.current?.planning?.registration_phase === area + '_' + phase;
            const step = area !== 'tablet' && index >= 2 ? index === 2 ? '3a' : '3b' : index + 1;
            return `<th data-current="${current}" data-complete="${!!value && complete(value) && !current}"><button type="button" class="phase-heading" data-phase="${phase}" data-area="${area}" data-focus-key="phase:${area}:${phase}"><span class="phase-order">Schritt ${step}${index + 1 < areaPhases.length ? ' →' : ''}</span><span class="phase-name">${title}</span>${value ? bar(value) + `<span class="phase-summary">${value.ready} bereit · ${value.queued} Queue · ${value.total} gesamt</span>` : '<span class="phase-summary">Fortschritt noch nicht verfügbar</span>'}</button></th>`;
        }).join('')}</tr></thead><tbody>${events.map((event, index) => {
            const counts = event.counts;
            const meta = counts ? [counts.state != null ? counts.state + ' Verbände' : '', counts.club != null ? counts.club + ' Vereine' : '',
                counts.player != null ? counts.player + (area === 'tablet' ? ' anwesende Spieler' : ' Spieler') : '',
                counts.pair != null ? counts.pair + (area === 'tablet' ? ' vollständige Paarungen' : ' Paarungen') : '', counts.team != null ? counts.team + ' bekannte Teams' : '',
                counts.number != null ? counts.number + ' Spielnummern (1. Runde)' : ''].filter(Boolean).join(' · ') : '';
            return `<tr><td><strong class="event-name"><span class="event-position">${event.order ?? index + 1}.</span>${esc(event.name)}</strong><span class="event-time">${esc(gameText(event, area))}</span><span class="event-meta">BTP-Position ${esc(event.btp_order ?? '–')}${meta ? '<br>' + esc(meta) : ''}</span></td>${areaPhases.map(([phase, title], phaseIndex) => {
                const value = event.cells[phase], current = isCurrent(area, phase, event.id);
                const focus = selectedArea === area && selectedPhase === phase && selectedEvent === String(event.id);
                return `<td><button type="button" class="cell${value && complete(value) ? ' complete' : ''}${current ? ' active' : ''}" data-phase="${phase}" data-event="${esc(event.id)}" data-area="${area}" data-focus-key="cell:${area}:${phase}:${esc(event.id)}" aria-label="${esc(event.name + ', ' + phaseName(phase) + ': ' + (value ? countText(value) : 'Fortschritt noch nicht verfügbar'))}" aria-pressed="${focus}"><span class="cell-phase" aria-hidden="true">${phaseIndex + 1}. ${title}</span>${value ? `<span class="cell-title">${value.ready} bereit<span class="cell-state">${current ? snapshot?.current?.running ? 'Aktuell' : 'Als Nächstes' : complete(value) ? '✓' : !value.total ? 'Kein Bedarf' : ''}</span></span>${bar(value)}<span class="cell-counts">${value.queued} Queue · ${value.total} gesamt</span>${value.failed ? `<span class="cell-remaining">${value.failed} fehlgeschlagen</span>` : ''}` : '<span class="cell-remaining">Fortschritt noch nicht verfügbar</span>'}</button></td>`;
            }).join('')}</tr>`;
        }).join('')}</tbody></table></div>`;
    }
    function selectionRows() {
        return (queueSnapshot?.items || []).filter(item => item.status !== 'completed' && alias(item.planning?.stage) === selected &&
            (selectedEvent == null || String(item.planning?.event_id) === selectedEvent) &&
            (selected === 'tablet' ? (item.planning?.tablet_phase || 'people') === selectedPhase : selected === 'registration' ?
                item.planning?.registration_phase === selectedArea + '_' + selectedPhase : true));
    }
    function itemStatus(item) {
        let status = item.execution?.phase === 'validation' ? 'Zentrale Prüfung' :
            item.execution?.phase === 'waiting_validation' ? 'Wartet auf zentrale Prüfung' :
            item.execution?.kind === 'helper' && !item.current ? 'Wartet auf Sprachhelfer' :
            item.current ? 'In Bearbeitung' : item.waiting_for_server ? 'Wartet auf Sprachserver' : item.status === 'failed' ? 'Fehlgeschlagen' :
            item.status === 'processing' ? 'Wird vorbereitet' :
            item.waiting_for_source === true || item.waiting_for_source === undefined && item.source_key && item.position == null ? 'Wartet auf Quellaufnahme' :
            item.source_key ? 'Wartet auf Aufbereitung' : 'Wartet';
        if (!item.current && item.terminal_failure) status += ' · keine automatische Wiederholung';
        else if (!item.current && item.retry_at > Date.now()) status += ' · erneuter Versuch ab ' + new Date(item.retry_at).toLocaleTimeString('de-DE');
        return status;
    }
    function selectionDetails(events) {
        const event = events.find(event => String(event.id) === selectedEvent);
        if (!event) return '';
        const value = event.cells[selectedPhase], phase = phases.find(([id]) => id === selectedPhase)?.[1];
        const items = selectionRows(), shown = items.slice(0, 12), current = isCurrent(selectedArea, selectedPhase, event.id);
        return `<section class="selection"><div class="selection-header"><div><div class="eyebrow">Ausgewählte Tabellenzelle${value ? ' · ' + value.ready + ' / ' + value.total + ' bereit' : ''}</div><h3>${esc(event.name)} · ${esc(phase)}</h3></div>${current ? pill('Aktueller Bedarf', 'active') : value && complete(value) ? pill('Vollständig bereit', 'ready') : pill('Ausgewählt')}</div><div class="selection-body"><div class="selection-reason"><h4>Warum diese Position?</h4><ol><li>${selected === 'tablet' ? 'Anmeldung abgeschlossen oder Disziplin ausgelost, Disziplin noch nicht beendet. Nach der Auslosung gelten alle gelosten Spieler als anwesend.' : 'Zuerst geöffnete, danach noch nicht geöffnete Anmeldungen; jeweils in drei Phasen.'}</li><li>${selected === 'tablet' ? 'Diese Disziplin vollständig vorbereiten: Landesverbände → Vereine → Spieler/Paarungen → Spielnummern der ersten Runde. Danach folgt die nächste Disziplin.' : selectedPhase === 'numbers' ? 'Die Spielnummern der ersten Runde folgen direkt auf die Spieler/Paarungen dieser Disziplin. Danach beginnt die nächste Disziplin.' : selectedPhase === 'people' ? 'Alle Landesverbände und Vereine dieses Anmeldebereichs stehen davor. Anschließend folgen die Spielnummern der ersten Runde dieser Disziplin.' : selectedPhase === 'clubs' ? 'Alle Landesverbände dieses Anmeldebereichs stehen davor; Spieler/Paarungen folgen danach.' : 'Landesverbände aller Disziplinen dieses Anmeldebereichs stehen vor deren Vereinen und Spielern/Paarungen.'}</li><li>${esc(gameText(event, selectedArea))}. Ohne Spielplanung gilt die BTP-Reihenfolge.</li><li>Innerhalb der Disziplin gilt die vorhandene Melde- und Teamreihenfolge. Fertige und gemeinsam genutzte Bausteine werden wiederverwendet.</li></ol></div><div class="sample-parts"><div class="eyebrow">Offene Aufträge aus der aktuellen Queue</div>${shown.length ? shown.map(item => `<div class="part-line${item.current ? ' active' : ''}"><i class="dot"></i><div><strong>${esc(item.text)}</strong><br><small>${esc(operationLabels[item.operation] || 'Sprachauftrag')}</small></div><span class="part-state">${esc(itemStatus(item))}</span></div>`).join('') + (items.length > shown.length ? `<p class="muted small">${items.length - shown.length} weitere Aufträge in der Queue.</p>` : '') : '<p class="muted small">Für diese Auswahl steht derzeit kein offener Auftrag in der Queue. Fertige Bausteine und noch nicht beauftragter Bedarf sind hier nicht aufgeführt.</p>'}</div></div></section>`;
    }
    function renderDetail() {
        if (!selected || !definitions.has(selected)) return;
        const stage = definitions.get(selected), value = stageProgress(selected), [status, type] = label(selected, value);
        html($('detail-header'), `<div class="eyebrow" style="margin-bottom:7px">${selected === active() ? 'Aktuell bearbeiteter Bereich' : 'Ausgewählter Bereich'}</div><div class="detail-title"><h2 id="detail-title"><span class="detail-number">${number(selected)}</span>${esc(stage.title)}</h2>${pill(status, type)}</div><p class="detail-description">${esc(stage.description)}</p>${connected ? metric(value) + bar(value) : '<p class="muted">Der aktuelle Fortschritt ist unbekannt.</p>'}`);
        let content = `<div class="rule-strip"><span class="rule-icon">↳</span><span>${esc(rules[selected])}</span></div>`;
        if (!connected) {
            content += '<div class="empty-box"><h3>Planungsstand derzeit nicht verfügbar</h3><p>Die Verbindung wird automatisch wiederhergestellt. Der letzte bekannte Plan ist im Zustandsdiagramm als unbekannt markiert.</p></div>';
        } else if (selected === 'tablet') {
            const events = eventsFor('tablet'); content += matrix(events, 'tablet');
            content += '<p class="matrix-footnote">Zeilenweise bearbeiten: innerhalb einer Disziplin von links nach rechts, dann zur nächsten Zeile. Die Zahlen beziehen sich auf Abspielbausteine. Gemeinsam genutzte Namen zählen in der Bereichssumme einmal; die Summe der Disziplinen kann deshalb größer sein.</p>' + selectionDetails(events);
            content += '<details data-persist="tablet-rules"><summary>Auswahl der Spieler und Einstellungen</summary><p>Vor der Auslosung zählen anwesend erfasste Spieler und vollständig anwesende Paarungen. Nach der Auslosung gelten alle gelosten Spieler und Paarungen als anwesend. Die Disziplin bleibt ab abgeschlossener Anmeldung enthalten, bis ihre wirklichen Spiele beendet sind. Alle wiederverwendbaren Namensvarianten werden vorbereitet; Tablet- und Klapptafelaufrufe richten sich nach den Turniereinstellungen.</p></details>';
        } else if (selected === 'registration') {
            const common = normalize(snapshot.registration_progress?.find(row => row.id === 'common'));
            content += `<div class="simple-row"><div><h3>Allgemeine Anmeldetexte</h3><p>Gemeinsame Formulierungen stehen vor den Namen.</p></div><div>${common.ready} / ${common.total} bereit${bar(common)}</div></div>`;
            for (const [area, name] of [['open', 'Geöffnete Anmeldungen'], ['closed', 'Noch nicht geöffnete Anmeldungen']]) {
                const events = eventsFor(area), counts = normalize(snapshot.registration_groups?.find(row => row.id === area));
                content += `<section class="area"><div class="area-heading"><div><h3>${name}</h3><p>Alle Landesverbände → alle Vereine → je Disziplin Schritt 3a: Spieler/Paarungen, dann Schritt 3b: Spielnummern der ersten Runde</p></div><span class="muted small">${counts.ready} / ${counts.total} bereit</span></div>${matrix(events, area)}</section>`;
                if (selectedArea === area) content += selectionDetails(events);
            }
            const elsewhere = (snapshot.registration_order || []).filter(event => ['completed', 'drawn'].includes(event.state));
            content += '<p class="matrix-footnote">Abgeschlossene Anmeldungen gehören zur Vorbereitung angemeldeter Disziplinen. Bei anwesend oder abwesend erfassten Personen entfallen die Einzelaufrufe; eine Paarung wird noch aufgerufen, solange mindestens eine Person offen ist.</p>';
            if (elsewhere.length) content += `<details data-persist="registration-skipped"><summary>Welche Disziplinen entfallen hier?</summary><p>${esc(elsewhere.map(event => event.name).join(', '))}. Diese Disziplinen werden entsprechend ihrem Spielstand in den Spielbetriebsbereichen vorbereitet. Beendete Disziplinen entfallen dort.</p></details>`;
        } else if (selected === 'officials' && snapshot.has_officials === false && !value.total) {
            content += '<div class="empty-box"><h3>Keine technischen Offiziellen im Turnier</h3><p>Es sind keine Namen und Rollen hinterlegt. Der nächste Bereich folgt automatisch.</p></div>';
        } else {
            const items = (queueSnapshot?.items || []).filter(item => item.status !== 'completed' && alias(item.planning?.stage) === selected);
            content += `<div class="empty-box"><h3>${complete(value) ? 'Alle benötigten Bausteine sind bereit' : !value.total ? 'Aktuell kein Bedarf' : 'Bekannter Vorbereitungsbedarf'}</h3><p>${selected === 'spare' && !snapshot.stages?.some(row => row.id === 'spare') ? 'Die Option für die andere Stimme ist ausgeschaltet.' : complete(value) ? 'Die vorhandenen Bausteine werden wiederverwendet. Der nächste Bereich folgt automatisch.' : !value.total ? 'Für diesen Bereich gibt es derzeit keine Aufgaben.' : 'Die Bearbeitung startet nach den vorherigen Prioritäten; die aktuelle Queue zeigt die konkreten offenen Aufträge.'}</p></div>`;
            for (const item of items.slice(0, 20)) content += `<div class="simple-row"><div><h3>${esc(item.text)}</h3><p>${esc(item.planning?.reason || operationLabels[item.operation])}</p></div>${pill(itemStatus(item), item.current ? 'active' : 'waiting')}</div>`;
            if (items.length > 20) content += `<p class="muted small">${items.length - 20} weitere Aufträge in der Queue.</p>`;
        }
        const ids = order(), next = ids[ids.indexOf(selected) + 1];
        content += `<div class="next-step"><div><strong class="small">Wo geht es danach weiter?</strong><p>Nach diesem Bereich folgt die nächste Priorität mit fehlendem Bedarf.<br>Neue Aufrufe können nach dem laufenden Auftrag vorgezogen werden.</p></div>${next ? `<button type="button" data-stage="${next}" data-focus-key="next:${next}">${number(next)} ${esc(definitions.get(next).title)} →</button>` : pill('Warten auf neuen Bedarf')}</div>`;
        content += '<div class="legend" style="margin-top:16px;margin-bottom:0"><span><i class="green"></i>bereit</span><span><i class="orange"></i>in der Queue</span><span><i></i>weiterer Bedarf</span><span>Petrol: deine Auswahl</span><span>Gold: aktueller Bedarf</span></div>';
        html($('detail-content'), content);
    }
    function renderHeader() {
        const value = snapshot, current = active(), total = normalize(value?.total);
        live.dataset.connected = String(connected); live.dataset.state = connected ? value.state : 'disconnected';
        if (value?.updated_at != null) live.dataset.updatedAt = value.updated_at;
        setText($('connection-status'), connected ? 'Live · automatisch aktualisiert' : 'Verbindung unterbrochen');
        $('connection-status').className = 'pill ' + (connected ? 'ready' : 'waiting');
        setText($('tournament-name'), value?.title || 'Turnier wird geladen …');
        const phase = value?.phase === 'registration' ? 'Vor der ersten Auslosung' : value?.phase === 'competition' ? 'Spielbetrieb · erste Auslosung erfolgt' : 'Turnierphase wird ermittelt';
        const gameLabels = { planned: 'geplant', candidate: 'Aufrufkandidaten', preparation: 'in Vorbereitung', oncourt: 'auf dem Feld', finished: 'abgeschlossen' };
        setText($('phase-summary'), connected ? phase + ' · ' + voiceLabel(value.voice) + ' · ' + Object.entries(value.games || {}).map(([id, n]) => n + ' ' + (gameLabels[id] || id)).join(' · ') : 'Aktueller Spiel- und Generierungsstatus unbekannt.');
        html($('conditions'), `<span class="${connected && value?.phase !== 'unknown' ? 'good' : ''}"><i class="dot"></i>${connected && ['registration','competition'].includes(value?.phase) ? 'Planungsstand bekannt' : 'Planungsstand unbekannt'}</span><span class="${connected && value?.state !== 'disabled' ? 'good' : ''}"><i class="dot"></i>${!connected ? 'Lokale Generierung · Status unbekannt' : value.state === 'disabled' ? 'Lokale Generierung ausgeschaltet' : 'Lokale Generierung aktiv'}</span><span class="separator">/</span><span>${esc(phase)}</span><span class="separator">/</span><span>Stimme: ${esc(voiceLabel(value?.voice))}</span>`);
        const inactive = { complete: 'Alles bereit', updating: 'Plan wird aktualisiert', disabled: 'Lokale Generierung ausgeschaltet',
            failed: 'Fehlgeschlagene Aufträge sind offen', idle_pending: value?.updating ? 'Plan wird aktualisiert' : 'Weitere Vorarbeit wartet auf Leerlauf',
            busy_elsewhere: 'Sprachserver arbeitet für ein anderes Turnier', waiting: 'Aufträge warten auf Bearbeitung' };
        const currentItem = queueSnapshot?.items?.find(item => item.current);
        setText($('now-state'), !connected ? 'Verbindung zu BTS unterbrochen' : value.running_count > 1 ? value.running_count + ' Aufträge parallel' :
            value.current?.running && current ? 'Wird gerade vorbereitet' : current ? 'Als Nächstes' : 'Aktueller Stand');
        setText($('now-name'), !connected ? 'Aktueller Auftrag unbekannt' : value.current?.text || inactive[value.state] || 'Planungsstand wird geladen …');
        setText($('now-subtitle'), !connected ? 'Die Verbindung wird automatisch wiederhergestellt.' :
            (current ? (currentItem ? operationLabels[currentItem.operation] : '') || 'Sprachauftrag' : inactive[value.state] || 'BTS aktualisiert die Planung') + ' · ' + voiceLabel(value.voice) +
            (value.current?.retry_at > Date.now() ? ' · nächster Versuch frühestens ' + new Date(value.current.retry_at).toLocaleTimeString('de-DE') : ''));
        setText($('now-why'), !connected ? 'Nach dem Wiederverbinden werden Planung und Queue erneut geladen.' : value.current?.planning?.reason ||
            (current ? definitions.get(current)?.title + '. ' + rules[current] : value.state === 'disabled' ? 'Die lokale Sprachgenerierung ist in den Einstellungen ausgeschaltet.' :
                value.state === 'updating' || value.state === 'idle_pending' && value.updating ?
                    'BTS ermittelt den aktuellen Bedarf. Neue Vorratsaufträge warten auf die aktualisierte Reihenfolge.' :
                    'Fertige Bereiche und Bereiche ohne Bedarf werden übersprungen. Neuer Bedarf wird automatisch eingeordnet.'));
        setText($('total-counts'), connected ? countText(total) : 'Fortschritt derzeit nicht verfügbar.');
        html($('total-bar'), connected ? bar(total) : '');
        followStatus.dataset.active = String(!!current);
        setText(followStatus, !connected ? 'Verbindung unterbrochen – aktueller Generierungsstatus unbekannt.' : current ?
            (value.current?.running ? 'Aktuell: ' : 'Als Nächstes: ') + definitions.get(current)?.title : inactive[value.state] || 'Planungsstand wird ermittelt …');
        $('jump-current').disabled = !connected; $('diagram-current').disabled = !connected;
    }
    function render() {
        if (follow && active()) choose(active(), snapshot.current?.planning, true);
        if (!selected || !order().includes(selected)) choose(active() || order()[0], snapshot?.current?.planning, follow);
        renderHeader(); renderPlan(); renderDetail();
        diagram.select({ stage: selected, area: selectedArea, phase: selectedPhase, event: selectedEvent });
        setText($('diagram-selection'), 'Auswahl: ' + number(selected) + ' ' + definitions.get(selected).title);
    }
    function setView(value, remember = true) {
        view = ['diagram', 'games'].includes(value) ? value : 'overview';
        const chart = view === 'diagram', games = view === 'games';
        document.querySelector('.workspace').classList.toggle('diagram-mode', chart);
        document.querySelector('.workspace').classList.toggle('games-mode', games);
        document.querySelector('.plan').hidden = chart || games; $('detail-column').hidden = chart || games; $('diagram-panel').hidden = !chart;
        gamesPanel.hidden = !games; $('queue').hidden = games; gamesView.show(games);
        for (const id of ['overview', 'diagram', 'games']) { $('view-' + id).setAttribute('aria-selected', String(id === view)); $('view-' + id).tabIndex = id === view ? 0 : -1; }
        setText($('view-note'), games ? 'Alle Spiele in Spielplanreihenfolge · Bereitschaft und fehlende Bausteine pro Durchsage.' : chart ? 'Vollständiger Ablauf · dieselben Daten, Farben und Prioritäten.' : 'Prioritäten, Disziplinen und Begründungen im Überblick.');
        if (chart) diagram.focus('selection');
        if (remember) try { localStorage.setItem('bts-speech-planning-view', view); } catch { /* Storage is optional. */ }
    }
    function jumpCurrent() {
        if (!connected) return;
        if (view === 'games') setView('overview');
        choose(active() || selected, snapshot.current?.planning, true); render();
        if (view === 'diagram') diagram.focus('current');
        const target = view === 'diagram' ? $('diagram-panel') : $('detail-column');
        target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
    }
    function queueUnavailable(message) {
        queueSnapshot = null; queuePanel.dataset.connected = 'false';
        setText(queueSummary, 'Queue derzeit nicht verfügbar.'); setText($('queue-running'), 'Unbekannt');
        setText(queueEmpty, message); queueEmpty.hidden = false; queueList.hidden = true;
        queueList.replaceChildren(); queueRows.clear();
    }
    function renderQueue(value) {
        queueSnapshot = value; queuePanel.dataset.connected = 'true';
        const items = value.items.filter(item => item.status !== 'completed');
        const running = items.filter(item => item.current).length, failed = items.filter(item => item.status === 'failed' && !item.current).length;
        const waiting = items.length - running - failed;
        const runningText = running + (running === 1 ? ' läuft' : ' laufen');
        setText(queueSummary, (value.busy_elsewhere ? 'Es wird auch für ein anderes Turnier gearbeitet. ' : '') + runningText + ' · ' + waiting +
            (waiting === 1 ? ' wartet' : ' warten') + (failed ? ' · ' + failed + ' fehlgeschlagen' : ''));
        setText($('queue-running'), running ? runningText : 'Warteschlange');
        $('queue-running').className = 'pill ' + (running ? 'active' : 'waiting');
        queueList.hidden = !items.length; queueEmpty.hidden = !!items.length;
        setText(queueEmpty, 'Keine offenen Aufträge in der aktuellen Queue. Weiterer Vorrat folgt bei Bedarf.');
        const keep = new Set();
        for (const [index, item] of items.entries()) {
            keep.add(item.key);
            let row = queueRows.get(item.key);
            if (!row) {
                const node = make(queueList, 'li', 'speech_plan_queue_item queue-card');
                const heading = make(node, 'div', 'queue-label');
                row = { node, rank: make(heading, 'span', 'speech_plan_queue_rank'), status: make(heading, 'strong', 'speech_plan_queue_status'),
                    text: make(node, 'h3', 'speech_plan_queue_text'), meta: make(node, 'p', 'speech_plan_queue_meta'), reason: make(node, 'p', 'speech_plan_queue_reason') };
                row.jump = make(node, 'button', 'text-button jump', 'Begründung im Plan ansehen ↗'); row.jump.type = 'button';
                row.jump.onclick = () => {
                    const current = row.item, planning = current.planning || (current.current ? snapshot?.current?.planning : null);
                    const stage = alias(planning?.stage || (current.current ? active() : null));
                    if (!definitions.has(stage)) return;
                    choose(stage, planning); render();
                    if (view === 'diagram') diagram.focus('selection');
                    (view === 'diagram' ? $('diagram-panel') : $('detail-column')).scrollIntoView({ block: 'start' });
                };
                queueRows.set(item.key, row);
            }
            row.item = item;
            row.node.dataset.current = String(!!item.current); row.node.dataset.status = item.status;
            setText(row.rank, item.current ? 'Jetzt' : Number.isInteger(item.position) && item.position > 0 ? item.position + '.' : '–');
            setText(row.status, itemStatus(item)); setText(row.text, item.text || 'Sprachauftrag');
            setText(row.meta, [item.execution?.name, priorities[item.priority], voiceLabel(item.voice), operationLabels[item.operation]].filter(Boolean).join(' · '));
            setText(row.reason, item.planning?.reason || (item.source_key ? 'Benötigter Ausschnitt; die Quellaufnahme muss zuerst fertig sein.' :
                item.priority === 'high' ? 'Tatsächlich ausgelöste Ansage; Bearbeitung in Auslösereihenfolge.' : 'Die Herkunft wird mit dem aktuellen Plan abgeglichen.'));
            row.jump.hidden = !definitions.has(alias(item.planning?.stage || (item.current ? active() : null)));
            if (queueList.children[index] !== row.node) queueList.insertBefore(row.node, queueList.children[index] || null);
        }
        for (const [id, row] of queueRows) if (!keep.has(id)) { row.node.remove(); queueRows.delete(id); }
    }
    function disconnected(message, clearQueue = true) {
        window.btsSpeechHealth?.disconnected(); connected = false;
        gamesView.update(false);
        if (snapshot) snapshot = { ...snapshot, state: 'disconnected', active_stage: null, current: null };
        diagram.disconnect();
        if (clearQueue) queueUnavailable('Verbindung zu BTS unterbrochen. Die Queue wird nach dem Wiederverbinden neu geladen.');
        render(); setText($('now-subtitle'), message);
    }
    function request(values) {
        return new Promise((resolve, reject) => {
            const rid = ++serial, timer = setTimeout(() => { pending.delete(rid); reject(new Error('timeout')); }, 5000);
            pending.set(rid, { resolve, reject, timer });
            socket.send(JSON.stringify({ ...values, rid }));
        });
    }
    let focusSignature = '';
    async function refresh() {
        if (loading || stopped || socket?.readyState !== WebSocket.OPEN) return;
        loading = true;
        const connection = socket;
        try {
            const [planning, queue] = await Promise.allSettled([
                request({ type: 'speech_planning', tournament_key: key }),
                request({ type: 'speech_queue', tournament_key: key, pending_only: true }),
            ]);
            if (stopped || socket !== connection || connection.readyState !== WebSocket.OPEN) return;
            if (planning.status === 'fulfilled' && planning.value.planning) {
                snapshot = diagram.update(planning.value.planning); connected = true;
                gamesView.update(true);
            } else disconnected('Planungsstand derzeit nicht verfügbar.', false);
            if (queue.status === 'fulfilled' && queue.value.queue) renderQueue(queue.value.queue);
            else queueUnavailable('Die Warteschlange konnte nicht geladen werden. Der nächste Abruf erfolgt automatisch.');
            render();
            const location = [snapshot?.state, active(), snapshot?.current?.planning?.event_id, snapshot?.current?.planning?.registration_phase,
                snapshot?.current?.planning?.tablet_phase].join(':');
            if (view === 'diagram' && follow && location !== focusSignature) diagram.focus('current');
            focusSignature = location;
        } catch (_) { disconnected('Planungsstand konnte nicht aktualisiert werden.'); }
        finally { if (socket === connection) loading = false; }
    }
    function connect() {
        if (stopped) return;
        socket = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws/admin');
        socket.onmessage = event => {
            let response;
            try { response = JSON.parse(event.data); } catch (_) { return; }
            if (response.type === 'speech_health') { window.btsSpeechHealth?.update(response.health); return; }
            const waiter = pending.get(response.rid);
            if (!waiter) return;
            clearTimeout(waiter.timer); pending.delete(response.rid);
            if (response.type === 'error') waiter.reject(new Error('server_error')); else waiter.resolve(response);
        };
        socket.onopen = async () => {
            try {
                await request({ type: 'speech_health_subscribe' }).catch(() => {});
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
    document.addEventListener('click', event => {
        const mode = event.target.closest('[data-view]');
        if (mode) { setView(mode.dataset.view); return; }
        const diagramStep = event.target.closest('#overview .flow-step');
        if (diagramStep) {
            const tablet = event.target.closest('.tablet-flow-state'), registration = event.target.closest('.registration-flow-state');
            const planning = tablet ? { event_id: tablet.dataset.eventId, tablet_phase: tablet.dataset.tabletPhase } : registration?.dataset.eventId ?
                { event_id: registration.dataset.eventId, registration_phase: registration.dataset.subphase } : null;
            choose(diagramStep.dataset.stage, planning); render(); return;
        }
        const stage = event.target.closest('[data-stage]');
        if (stage) { choose(stage.dataset.stage); render(); return; }
        const part = event.target.closest('[data-phase]');
        if (part) {
            const events = eventsFor(part.dataset.area);
            selectedArea = part.dataset.area; selectedPhase = part.dataset.phase;
            selectedEvent = part.dataset.event || (events.some(event => String(event.id) === selectedEvent) ? selectedEvent : events[0] ? String(events[0].id) : null);
            selected = selectedArea === 'tablet' ? 'tablet' : 'registration'; follow = false; render();
        }
    });
    $('jump-current').onclick = jumpCurrent;
    $('diagram-current').onclick = () => { choose(active() || selected, snapshot?.current?.planning, true); render(); diagram.focus('current'); };
    $('diagram-start').onclick = () => { follow = false; diagram.focus('start'); };
    $('diagram-fit').onclick = () => {
        fitted = !fitted; $('diagram-fit').setAttribute('aria-pressed', String(fitted));
        setText($('diagram-fit'), fitted ? 'Lesbare Größe' : 'Gesamtbreite'); diagram.fit(fitted); diagram.focus('selection');
    };
    $('diagram-details').onclick = () => { setView('overview'); $('detail-column').scrollIntoView({ block: 'start' }); };
    document.querySelector('.view-switch').onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const views = ['overview', 'diagram', 'games'];
        event.preventDefault(); setView(event.key === 'Home' ? views[0] : event.key === 'End' ? views.at(-1) : views[(views.indexOf(view) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
        $('view-' + view).focus();
    };
    window.addEventListener('pagehide', () => { stopped = true; clearTimeout(reconnect); clearInterval(poll); socket?.close(); });
    try { const saved = localStorage.getItem('bts-speech-planning-view'); if (['diagram', 'games'].includes(saved)) view = saved; } catch { /* Storage is optional. */ }
    render(); setView(view, false); connect();
})();
