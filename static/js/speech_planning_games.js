'use strict';

window.btsSpeechPlanningGames = function(panel, request, key) {
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char]));
    const rows = new Map(), calls = new Map(), cache = new WeakMap();
    let snapshot = null, selected = null, visible = false, connected = false, fresh = false, loading = false, again = false, timer, last = 0;
    let clockTimer, clockBase = Date.now(), clockReceived = Date.now(), clockFixed = false;
    const html = (node, value) => { if (cache.get(node) !== value) { node.innerHTML = value; cache.set(node, value); } };
    const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
    const attr = (node, name, value) => { if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value)); };
    const labels = { ready: 'Bereit', processing: 'Wird erzeugt', queued: 'In der Queue', failed: 'Fehler',
        missing: 'Noch zu erzeugen', blocked: 'Angaben fehlen', none: 'Nicht benötigt' };
    const states = { oncourt: 'Auf dem Feld', preparation: 'In Vorbereitung', candidate: 'Aufrufkandidaten', finished: 'Beendet', scheduled: 'Geplant',
        ready: 'Geplant', incomplete: 'Teilnehmer offen', blocked: 'Gesperrt' };
    const symbols = { oncourt: '●', preparation: '◷', candidate: '↗', finished: '✓', scheduled: '○', incomplete: '?', blocked: 'Ⅱ' };
    const highlights = { 1: '#ffd838', 2: '#ff79ab', 3: '#fbad4b', 4: '#1dace6', 5: '#5ce1b8', 6: '#c56bff' };
    const elapsed = game => {
        if (game.preparation_call_timestamp == null) return '–:––';
        const seconds = Math.max(0, Math.floor((clockBase + (clockFixed ? 0 : Date.now() - clockReceived) - game.preparation_call_timestamp) / 1000));
        return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    };
    const matchLabel = game => game.match_state === 'preparation' ? 'In Vorbereitung seit ' + elapsed(game) + (game.court ? ' [für Feld ' + game.court + ']' : '') :
        game.court && ['oncourt', 'finished'].includes(game.match_state) ? (game.match_state === 'finished' ? 'Beendet auf Feld ' : 'Auf Feld ') + game.court : states[game.match_state] || 'Unbekannt';
    const courtIcon = game => `<span class="game-court-icon" role="img" aria-label="${esc(game.court)}" title="Feld ${esc(game.court)}">${esc(game.court)}</span>`;
    function renderClocks() {
        if (!visible || !connected || !fresh) return;
        for (const row of rows.values()) if (row.game?.match_state === 'preparation') {
            if (row.clock) text(row.clock, elapsed(row.game));
            if (row.caption) text(row.caption, matchLabel(row.game));
        }
    }
    const metric = value => `<span class="game-status ${value.state}">${esc(value.state === 'blocked' && value.reasons?.length === 1 ? value.reasons[0] : labels[value.state] || 'Unbekannt')}</span>` +
        (value.total ? `<small>${value.ready}/${value.total} Bausteine bereit${value.missing ? ' · ' + value.missing + ' fehlen' : ''}</small>` : '') +
        (value.failed ? `<small>${value.failed} fehlgeschlagen</small>` : '') +
        (value.state === 'blocked' && value.reasons?.length === 1 ? '' :
            (value.reasons || []).map(reason => `<small>${esc(reason)}</small>`).join(''));
    panel.innerHTML = `<div class="panel-header"><h2>Spiele · Bereitschaft der Durchsagen</h2><p>Reihenfolge wie im Spielplan. Die Spalten zählen eindeutige Bausteine je Spiel bzw. Aufrufart. Ohne feste Feldzuweisung werden alle möglichen aktiven Felder geprüft. Bei offenen Begegnungen kann der vollständige Teilnehmerbestand der Disziplin als Vorrat dienen. Details zeigen die geprüften Varianten.</p></div>
      <div class="games-tools"><label>Spiel suchen <input type="search" class="games-search" placeholder="Spielnummer, Disziplin oder Spieler"></label><label>Spielstatus <select class="games-state-filter"><option value="all">Alle Spiele</option><option value="unfinished">Nicht beendet</option>${Object.entries(states).filter(([id]) => id !== 'ready').map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label><span class="games-summary" role="status">Spiele werden geladen …</span></div><div class="games-state-legend" aria-label="Spielstatus und Anzahl"></div>
      <p class="games-notice" role="status"></p><div class="games-table-wrap"><table class="games-table"><caption class="sr-only">Bereitschaft der Durchsagen pro Spiel in Spielplanreihenfolge</caption><thead><tr><th scope="col">Spiel</th><th scope="col">Zeit / Disziplin</th><th scope="col">Spieler</th><th scope="col">Gesamt</th><th scope="col">Spielaufruf</th><th scope="col">Vorbereitung</th><th scope="col">Spielbeginn</th><th scope="col">Weitere Aufrufe</th></tr></thead></table></div>`;
    const table = panel.querySelector('table'), notice = panel.querySelector('.games-notice'), summary = panel.querySelector('.games-summary');
    const search = panel.querySelector('.games-search');
    const stateFilter = panel.querySelector('.games-state-filter'), legend = panel.querySelector('.games-state-legend');
    const filter = () => {
        const query = search.value.trim().toLocaleLowerCase('de');
        let count = 0;
        for (const row of rows.values()) {
            const matchesState = stateFilter.value === 'all' || stateFilter.value === 'unfinished' && row.matchState !== 'finished' || row.matchState === stateFilter.value;
            const hidden = !!query && !row.search.includes(query) || !matchesState;
            if (row.node.hidden !== hidden) row.node.hidden = hidden;
            if (!hidden) count++;
        }
        const ready = snapshot?.items?.filter(game => game.state === 'ready').length || 0;
        text(summary, count + ' von ' + rows.size + ' Spielen · ' + ready + ' vollständig bereit');
        html(legend, Object.entries(states).filter(([id]) => id !== 'ready').map(([id, label]) => {
            const count = snapshot?.items?.filter(game => game.match_state === id).length || 0;
            return `<span class="game-match-status ${id}">${symbols[id]} ${esc(label)} <strong>${count}</strong></span>`;
        }).join(''));
    };
    function renderDetails() {
        const row = rows.get(selected);
        if (!row) return;
        const detail = snapshot?.detail;
        if (!connected || !fresh || detail?.id !== selected) {
            text(row.message, !connected || !fresh ? 'Status derzeit unbekannt.' : 'Details werden geladen …');
            row.message.hidden = false; row.list.hidden = true; return;
        }
        row.message.hidden = true; row.list.hidden = false;
        const live = new Set();
        let previous = null;
        for (const call of detail.announcements) {
            live.add(call.id);
            let item = calls.get(call.id);
            if (!item || item.node.parentNode !== row.list) {
                const node = document.createElement('details'); node.className = 'game-announcement';
                node.innerHTML = '<summary></summary><div class="game-announcement-body"></div>';
                item = { node, heading: node.querySelector('summary'), body: node.querySelector('div') }; calls.set(call.id, item);
            }
            const next = previous ? previous.nextSibling : row.list.firstChild;
            if (next !== item.node) row.list.insertBefore(item.node, next);
            previous = item.node;
            html(item.heading, `<strong>${esc(call.label || call.group)}</strong><span>${metric(call)}</span>`);
            html(item.body, (call.unresolved ? `<p class="game-unresolved">${esc(call.unresolved)}</p>` : '') +
                (call.text ? `<p class="game-announcement-text">${esc(call.text)}</p>` : '') +
                (call.components.length ? `<ul>${call.components.map(part => `<li><span>${esc(part.text)}</span><span class="game-status ${esc(part.state)}">${esc(labels[part.state])}${part.error ? ' · ' + esc(part.error) : ''}</span></li>`).join('')}</ul>` : ''));
        }
        for (const [id, item] of calls) if (!live.has(id) || item.node.parentNode !== row.list) { item.node.remove(); calls.delete(id); }
    }
    function render(updateRows = true) {
        if (!snapshot) return;
        const current = connected && fresh;
        attr(panel, 'data-connected', current);
        text(notice, !connected ? 'Verbindung unterbrochen · angezeigter Stand ist veraltet.' : !fresh ? 'Spielstatus derzeit nicht verfügbar. Erneuter Abruf erfolgt automatisch.' : snapshot.disabled ? 'Lokale Sprachvorbereitung ist ausgeschaltet.' :
            snapshot.updating ? 'Die Vorbereitung wird aktualisiert. Angezeigt wird der zuletzt ermittelte Stand.' :
                !snapshot.items.length ? 'Im aktuellen Plan sind keine Spiele vorhanden.' : '');
        if (!updateRows) { renderClocks(); renderDetails(); return; }
        let previous = table.tHead;
        const live = new Set();
        for (const game of snapshot.items) {
            live.add(game.id);
            let row = rows.get(game.id);
            if (!row) {
                const node = document.createElement('tbody'); node.dataset.gameId = game.id;
                node.innerHTML = '<tr><th scope="row"><button type="button" class="game-toggle" aria-expanded="false"></button><div class="game-match-label"></div></th><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr><tr class="game-details" hidden><td colspan="8"><p></p><div class="game-announcements"></div></td></tr>';
                row = { node, cells: [...node.rows[0].cells], button: node.querySelector('button'), matchLabel: node.querySelector('.game-match-label'), details: node.rows[1], message: node.rows[1].querySelector('p'), list: node.querySelector('.game-announcements') };
                row.button.onclick = () => {
                    selected = selected === game.id ? null : game.id;
                    for (const [id, value] of rows) { if (value.details.hidden !== (id !== selected)) value.details.hidden = id !== selected; attr(value.button, 'aria-expanded', id === selected); }
                    for (const item of calls.values()) item.node.remove();
                    calls.clear(); render(); void refresh();
                };
                ['Zeit / Disziplin', 'Spieler', 'Gesamt', 'Spielaufruf', 'Vorbereitung', 'Spielbeginn', 'Weitere Aufrufe'].forEach((label, i) => { row.cells[i + 1].dataset.label = label; });
                rows.set(game.id, row);
            }
            if (previous.nextSibling !== row.node) table.insertBefore(row.node, previous.nextSibling);
            previous = row.node;
            text(row.button, (selected === game.id ? '▾ ' : '▸ ') + (game.number ?? '–'));
            attr(row.button, 'aria-label', 'Spiel ' + (game.number ?? 'ohne Nummer') + ': Durchsagen anzeigen');
            attr(row.button, 'aria-expanded', selected === game.id); if (row.details.hidden !== (selected !== game.id)) row.details.hidden = selected !== game.id;
            const revision = JSON.stringify(game);
            if (row.revision !== revision) {
                row.revision = revision;
                row.matchState = game.match_state;
                row.game = game;
                row.node.style.setProperty('--game-preparation-color', highlights[game.highlight] || highlights[6]);
                attr(row.node, 'data-match-state', game.match_state);
                const status = game.match_state === 'preparation' ? `In Vorbereitung seit <time class="game-preparation-time">${elapsed(game)}</time>${game.court ? ' [für Feld ' + courtIcon(game) + ']' : ''}` :
                    ['oncourt', 'finished'].includes(game.match_state) && game.court ? (game.match_state === 'finished' ? 'Beendet auf Feld ' : 'Auf Feld ') + courtIcon(game) : `${symbols[game.match_state] || '○'} ${esc(matchLabel(game))}`;
                html(row.matchLabel, `<span class="game-match-status ${esc(game.match_state)}">${status}</span>`);
                html(row.cells[1], `<strong>${esc([game.time, game.round, game.event].filter(Boolean).join(' · '))}</strong><small>${esc(game.date)}${game.date ? ' · ' : ''}<span class="game-match-caption">${esc(matchLabel(game))}</span></small>`);
                row.clock = row.matchLabel.querySelector('.game-preparation-time'); row.caption = row.cells[1].querySelector('.game-match-caption');
                html(row.cells[2], `${game.teams.map(team => `<span class="game-team">${esc(team || 'Teilnehmer noch offen')}</span>`).join('<small>gegen</small>')}${game.location ? `<small>${esc(game.location)}</small>` : ''}`);
                html(row.cells[3], metric(game));
                game.columns.forEach((column, i) => html(row.cells[i + 4], metric(column)));
                row.search = [game.number, game.date, game.time, game.event, game.round, ...game.teams].join(' ').toLocaleLowerCase('de');
            }
            attr(row.node, 'data-speech-state', current ? game.state : 'unknown');
        }
        for (const [id, row] of rows) if (!live.has(id)) { row.node.remove(); rows.delete(id); }
        if (!live.has(selected)) { selected = null; calls.clear(); }
        filter(); renderClocks(); renderDetails();
    }
    async function refresh() {
        if (!visible || !connected) return;
        if (loading) { again = true; return; }
        clearTimeout(timer);
        if (Date.now() - last < 550) { timer = setTimeout(refresh, 550 - (Date.now() - last)); return; }
        loading = true; last = Date.now();
        const selectedAtRequest = selected;
        try {
            const response = await request({ type: 'speech_games', tournament_key: key,
                ...(selected ? { match_id: selected } : {}), ...(snapshot?.revision ? { revision: snapshot.revision } : {}) });
            if (!visible || !connected) return;
            if (!response.games) throw new Error('speech_games_unavailable');
            const value = response.games;
            clockBase = Number.isFinite(value.now_ts) ? value.now_ts : Date.now(); clockReceived = Date.now(); clockFixed = value.clock_fixed === true;
            const updateRows = !value.unchanged || panel.dataset.connected !== 'true';
            snapshot = { ...value, items: value.unchanged ? snapshot?.items || [] : value.items || [],
                detail: selectedAtRequest === selected ? value.detail : null };
            fresh = true; render(updateRows);
            if (selectedAtRequest !== selected) again = true;
        } catch (_) { fresh = false; render(); text(notice, 'Spielstatus derzeit nicht verfügbar. Erneuter Abruf erfolgt automatisch.'); }
        finally { loading = false; if (again) { again = false; void refresh(); } }
    }
    search.oninput = filter;
    stateFilter.onchange = filter;
    return {
        show(value) {
            visible = value; clearInterval(clockTimer);
            if (visible) { render(); void refresh(); clockTimer = setInterval(renderClocks, 1000); }
            else clearTimeout(timer);
        },
        update(value) { connected = value; if (!connected) { fresh = false; clearTimeout(timer); render(); } else void refresh(); },
    };
};
