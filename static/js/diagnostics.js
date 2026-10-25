'use strict';

(function() {
    const $ = id => document.getElementById(id), pending = new Map(), logRows = new Map(), pageRows = new Map();
    const roles = { admin: 'Adminseite', display: 'Anzeige', umpire: 'Zähltablet', client: 'Client', 'speech-planning': 'Sprachvorbereitung', diagnostics: 'Diagnose' };
    const levels = { error: 'Fehler', warn: 'Warnung', info: 'Info', debug: 'Detail' };
    const sources = { ...roles, server: 'BTS-Server', speech: 'Sprachprozess', control: 'Fernsteuerung' };
    const scopes = { page: 'Einzelne Seite', device: 'Gerät', role: 'Seitentyp', tournament: 'Turnier', all: 'Alle Seiten' };
    const states = { scheduled: 'Vorgemerkt', waiting: 'Wartet', reloading: 'Wird neu geladen', reconnected: 'Wieder verbunden',
        unreachable: 'Nicht erreichbar', disconnected: 'Noch nicht wieder verbunden', cancelled: 'Abgebrochen', expired: 'Abgelaufen' };
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[char]));
    const time = ts => new Date(ts).toLocaleString('de-DE');
    let ws, serial = 0, stopped = false, busy = false, cursor = 0, generation = 0, paused = false, exporting = false, pageFilter = '', snapshot, selectedTab = 'logs';
    function error(message) { $('error').textContent = message; $('error').hidden = !message; }
    function rpc(type, fields = {}) {
        if (ws?.readyState !== 1) return Promise.reject(new Error('Nicht verbunden'));
        return new Promise((resolve, reject) => {
            const rid = ++serial, timer = setTimeout(() => { pending.delete(rid); reject(new Error('Zeitüberschreitung')); }, 6000);
            pending.set(rid, { resolve, reject, timer }); ws.send(JSON.stringify({ type, rid, ...fields }));
        });
    }
    function filters() {
        return { source: $('source').value, level: $('level').value, search: $('search').value.slice(0, 200), page_id: pageFilter,
            since: $('since').value ? new Date($('since').value).getTime() : null, until: $('until').value ? new Date($('until').value).getTime() : null };
    }
    function showTab(value) {
        selectedTab = value; $('logs-panel').hidden = value !== 'logs'; $('devices-panel').hidden = value !== 'devices';
        for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-pressed', String(button.dataset.tab === value));
        void refresh();
    }
    function renderLogs(value) {
        cursor = value.cursor;
        for (const row of value.items) {
            let node = logRows.get(row.id);
            if (!node) { node = document.createElement('li'); logRows.set(row.id, node); }
            const content = `<details><summary><span class="severity ${esc(row.level)}">${esc(levels[row.level] || row.level)}</span><time>${esc(time(row.updated_at))}</time><span class="source">${esc(sources[row.source] || row.source)}${row.count > 1 ? ' · ' + row.count + '×' : ''}</span><strong>${esc(row.message.split('\n')[0].slice(0, 230))}</strong></summary><div class="log-body"><pre>${esc(row.message)}</pre><p>${esc([row.path, row.device_id ? 'Gerät ' + row.device_id : '', row.tournament_key, row.match_id ? 'Spiel-ID ' + row.match_id : '', row.court_id ? 'Feld ' + row.court_id : '', row.trace_id ? 'Vorgang ' + row.trace_id : '', row.version ? 'Version ' + row.version : ''].filter(Boolean).join(' · '))}</p>${row.client_ts ? `<p>Clientzeit: ${esc(time(row.client_ts))} · erstmals empfangen: ${esc(time(row.ts))}</p>` : ''}</div></details>`;
            const open = node.querySelector('details')?.open;
            if (node.dataset.revision !== String(row.revision)) { node.innerHTML = content; node.dataset.revision = row.revision; node.querySelector('details').open = !!open; }
            node.dataset.order = row.revision;
        }
        const rows = [...logRows.values()].sort((a, b) => Number(b.dataset.order) - Number(a.dataset.order));
        let previous = null;
        for (const node of rows.slice(0, 500)) {
            const next = previous ? previous.nextSibling : $('logs').firstChild;
            if (next !== node) $('logs').insertBefore(node, next); previous = node;
        }
        for (const node of rows.slice(500)) { node.remove(); for (const [id, value] of logRows) if (value === node) logRows.delete(id); }
        $('empty-logs').hidden = logRows.size > 0; $('empty-logs').textContent = 'Keine passenden Meldungen.';
        $('log-summary').textContent = logRows.size + ' angezeigt · ' + value.retained + ' gespeichert' + (value.truncated ? ' · weitere Meldungen über Export' : '') +
            (value.dropped ? ' · ' + value.dropped + ' Meldungen verworfen' : '') + (value.write_error ? ' · Speicherfehler: ' + value.write_error : '');
    }
    function renderDevices(value) {
        const live = new Set();
        const pages = [...value.pages].sort((a, b) => a.device_id.localeCompare(b.device_id) || a.path.localeCompare(b.path));
        for (const page of pages) {
            live.add(page.id);
            let row = pageRows.get(page.id);
            if (!row) { row = document.createElement('tr'); pageRows.set(page.id, row); $('devices').appendChild(row); }
            const content = `<td><strong>${esc(page.label)}</strong><small>${esc(page.device_id)}</small><small>${esc(page.address)} · Seite ${esc(page.id.slice(0, 8))}</small></td><td>${esc(roles[page.role] || page.role)}<small>${esc(page.path)}</small></td><td>${esc(page.tournament_key || '–')}<small>${esc([page.match_id ? 'Spiel-ID ' + page.match_id : '', page.court_id ? 'Feld ' + page.court_id : ''].filter(Boolean).join(' · '))}</small></td><td><span class="online ${page.online ? 'yes' : 'no'}">${page.online ? 'Verbunden' : 'Getrennt'}</span><small>${esc(page.version)}</small><small>Letzter Kontakt: ${esc(time(page.last_seen))}</small></td><td><button data-reload="page" data-value="${esc(page.id)}">Seite neu laden</button><button data-reload="device" data-value="${esc(page.device_id)}">Gerät neu laden</button><button data-logs="${esc(page.id)}">Logs dieser Seite</button></td>`;
            if (row._content !== content) { row.innerHTML = content; row._content = content; }
        }
        for (const [id, row] of pageRows) if (!live.has(id)) { row.remove(); pageRows.delete(id); }
        $('device-summary').textContent = new Set(pages.map(page => page.device_id)).size + ' Geräte · ' + pages.filter(page => page.online).length + ' Seiten verbunden';
        $('commands').innerHTML = value.commands.map(command => `<article><div class="command-heading"><strong>${esc(time(command.at))} · ${esc(scopes[command.scope] || command.scope)} · ${command.targets.length} Seiten</strong>${command.targets.some(target => ['scheduled', 'waiting'].includes(target.state)) ? `<button data-cancel="${esc(command.id)}">Ausstehende abbrechen</button>` : ''}</div><ul>${command.targets.map(target => `<li><span>${esc(target.path)} · ${esc(target.page_id.slice(0, 8))}</span><strong>${esc(states[target.state] || target.state)}</strong>${target.reason ? `<span>${esc(target.reason)}</span>` : ''}${target.version ? `<small>Version ${esc(target.version)}</small>` : ''}</li>`).join('')}</ul></article>`).join('') || '<p class="empty">Noch keine Neuladeaufträge.</p>';
        updateTargets();
    }
    function updateTargets() {
        const scope = $('reload-scope').value, value = $('reload-value').value;
        $('reload-value-label').hidden = scope === 'all';
        const options = scope === 'role' ? Object.entries(roles) : [...new Set((snapshot?.pages || []).map(page => page.tournament_key).filter(Boolean))].map(key => [key, key]);
        const content = options.map(([key, label]) => `<option value="${esc(key)}">${esc(label)}</option>`).join('');
        if ($('reload-value')._content !== content) { $('reload-value').innerHTML = content; $('reload-value')._content = content; if (options.some(([key]) => key === value)) $('reload-value').value = value; }
    }
    async function refresh() {
        if (busy || exporting || ws?.readyState !== 1 || stopped) return;
        busy = true;
        const currentGeneration = generation;
        try {
            const [status, logs] = await Promise.all([rpc('diagnostics_snapshot'), selectedTab === 'logs' && !paused ? rpc('diagnostics_logs', { filter: { ...filters(), cursor, limit: 200 } }) : null]);
            if (status.diagnostics_error) throw new Error(status.diagnostics_error);
            snapshot = status.diagnostics; renderDevices(snapshot);
            const dropped = snapshot.store.dropped + snapshot.pages.reduce((sum, page) => sum + (page.client_dropped || 0) + (page.dropped || 0), 0);
            $('connection').textContent = 'Live · Serverversion ' + snapshot.version + (snapshot.store.ready ? ' · Logprozess aktiv' : ' · Logprozess nicht verfügbar') +
                (dropped ? ' · ' + dropped + ' Meldungen in Server-/Clientpuffern verworfen' : '');
            $('verbose').checked = snapshot.verbose_until > Date.now();
            if (logs?.diagnostics_error) throw new Error(logs.diagnostics_error);
            if (logs?.logs && currentGeneration === generation) renderLogs(logs.logs);
            if (snapshot.store.error) error('Logspeicherung: ' + snapshot.store.error); else error('');
        } catch (failure) { error('Diagnose derzeit nicht verfügbar: ' + failure.message); }
        finally { busy = false; }
    }
    async function action(type, fields) {
        try { const result = await rpc(type, fields); if (result.diagnostics_error) throw new Error(result.diagnostics_error); await refresh(); }
        catch (failure) { error(failure.message); }
    }
    function connect() {
        if (stopped) return;
        ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/admin');
        ws.onopen = () => { void refresh(); };
        ws.onmessage = event => {
            let value; try { value = JSON.parse(event.data); } catch (_) { return; }
            const entry = pending.get(value.rid); if (!entry) return;
            clearTimeout(entry.timer); pending.delete(value.rid); value.type === 'error' ? entry.reject(new Error(value.message)) : entry.resolve(value);
        };
        ws.onclose = () => {
            $('connection').textContent = 'Verbindung unterbrochen · angezeigter Stand ist veraltet'; busy = false;
            for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Verbindung unterbrochen')); } pending.clear();
            if (!stopped) setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
    }
    document.addEventListener('click', event => {
        const tab = event.target.closest('[data-tab]'); if (tab) return showTab(tab.dataset.tab);
        const target = event.target.closest('[data-reload]'); if (target) return void action('diagnostics_reload', { scope: target.dataset.reload, value: target.dataset.value });
        const cancel = event.target.closest('[data-cancel]'); if (cancel) return void action('diagnostics_cancel', { id: cancel.dataset.cancel });
        const logs = event.target.closest('[data-logs]'); if (logs) { pageFilter = logs.dataset.logs; $('clear-page').hidden = false; reset(); showTab('logs'); }
    });
    function reset() { cursor = 0; generation++; logRows.clear(); $('logs').replaceChildren(); void refresh(); }
    for (const id of ['source', 'level', 'since', 'until']) $(id).onchange = reset;
    let searchTimer; $('search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(reset, 300); };
    $('clear-page').onclick = () => { pageFilter = ''; $('clear-page').hidden = true; reset(); };
    $('reload-scope').onchange = updateTargets;
    $('reload-group').onclick = () => action('diagnostics_reload', { scope: $('reload-scope').value, value: $('reload-scope').value === 'all' ? '' : $('reload-value').value });
    $('verbose').onchange = () => action('diagnostics_verbose', { enabled: $('verbose').checked });
    $('pause').onclick = () => { paused = !paused; $('pause').setAttribute('aria-pressed', String(paused)); $('pause').textContent = paused ? 'Live-Ansicht fortsetzen' : 'Live-Ansicht pausieren'; if (!paused) void refresh(); };
    $('export').onclick = async () => {
        if (exporting) return;
        exporting = true; $('export').disabled = true;
        try {
            const selectedFilters = filters();
            await new Promise(resolve => setTimeout(resolve, 250));
            let response = await rpc('diagnostics_logs', { filter: { ...selectedFilters, export: true } });
            if (!response.logs) throw new Error(response.diagnostics_error || 'Export nicht verfügbar');
            const metadata = response.logs, items = [...metadata.items];
            while (response.logs.next_offset != null) {
                await new Promise(resolve => setTimeout(resolve, 250));
                response = await rpc('diagnostics_logs', { filter: { export_id: metadata.export_id, export_offset: response.logs.next_offset } });
                if (!response.logs) throw new Error(response.diagnostics_error || 'Export abgebrochen');
                items.push(...response.logs.items);
            }
            const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), filters: selectedFilters,
                cursor: metadata.cursor, total: metadata.total, items }, null, 2)], { type: 'application/json' });
            const href = URL.createObjectURL(blob), a = document.createElement('a'); a.href = href; a.download = 'bts-diagnose-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
        } catch (failure) { error(failure.message); }
        finally { exporting = false; $('export').disabled = false; }
    };
    const interval = setInterval(refresh, 2000);
    window.addEventListener('pagehide', () => { stopped = true; clearInterval(interval); clearTimeout(searchTimer); ws?.close(); });
    connect();
})();
