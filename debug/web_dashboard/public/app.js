/* eslint-env browser */
'use strict';

(() => {
	const $ = id => document.getElementById(id);
	const text = (id, value) => { $(id).textContent = value; };
	const age = value => value == null ? '—' : value < 1000 ? Number(value.toFixed(1)).toLocaleString('de-DE') + ' ms' : (value / 1000).toFixed(1) + ' s';
	const clock = value => { const sec = Math.max(0, Math.floor(value / 1000)); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); };
	const phases = { 'checkin-and-play': 'Einchecken & Spielen', load: 'Belastungsphase', idle: 'Ruhephase · Rückstand abbauen', 'load-after-idle': 'Erneute Belastung' };
	const statuses = { idle: 'Bereit', starting: 'Verbinden', running: 'Läuft', stopping: 'Wird beendet', completed: 'Abgeschlossen', interrupted: 'Beendet', error: 'Fehler' };
	const views = { overview: ['Wie läuft dein Turnier?', 'Punktanzeige und Rückstau auf einen Blick.'], queues: ['Wo wartet die Arbeit?', 'Verarbeitung, Wartezeiten und Warteschlangen im Verlauf.'],
		courts: ['Was passiert auf den Feldern?', 'Alle simulierten TVs und Tablets im Überblick.'], payloads: ['Welche Nachrichten kommen an?', 'Empfangene Typen und Messwerte über den gesamten Test.'], events: ['Was ist passiert?', 'Hinweise verständlich zusammengefasst, Details bei Bedarf.'] };
	let config, current = { status: 'idle', id: null }, history = [], view = 'overview', socket, reconnect, busy = false;
	let settings_open = false, connected = false, last_message = 0, queue_selection = new Set(), shown_error = false;
	const known_queues = new Set();
	function notice(message, success = false) { text('notice', message); $('notice').className = 'notice' + (success ? ' success' : ''); $('notice').hidden = !message; }
	async function post(url, data) {
		const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BTS-Test-Token': config.token }, body: JSON.stringify(data) });
		const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Die Anfrage konnte nicht ausgeführt werden.'); return result;
	}
	function settings() {
		return Object.fromEntries(config.fields.map(field => {
			const input = $('settings-form').elements.namedItem(field.key);
			return [field.key, field.type === 'boolean' ? input.checked : field.type === 'number' && input.value !== '' ? Number(input.value) : input.value];
		}));
	}
	function apply_defaults() {
		const values = config.defaults[$('mode').value];
		for (const field of config.fields) {
			const input = $('settings-form').elements.namedItem(field.key);
			if (field.type === 'boolean') input.checked = values[field.key]; else input.value = values[field.key];
		}
		mode_help();
	}
	function mode_help() {
		const benchmark = $('mode').value === 'benchmark';
		text('mode-description', benchmark ? '2 Minuten Einchecken & Spielen → 4 Minuten Belastung → 2 Minuten Ruhe → 2 Minuten Belastung. Pause und Tempo folgen der Sequenz; sie endet automatisch.'
			: 'Spielt bis zum Stopp oder zur Laufzeitbegrenzung weiter. Pause und Tempo kannst du während des Tests ändern.');
		for (const key of ['max_runtime_ms', 'checkin_min_ms', 'checkin_max_ms']) $('settings-form').elements.namedItem(key).disabled = benchmark;
	}
	function setup_fields() {
		const groups = { sequence: 'Testsequenz', tempo: 'Punkte & Tempo', checkin: 'Check-ins im freien Test', scoring: 'Spielverlauf', battery: 'Simulierte Tablets', diagnostics: 'Diagnose' };
		for (const [group, title] of Object.entries(groups)) {
			const section = document.createElement('section'); section.className = 'advanced-group';
			const heading = document.createElement('h3'); heading.textContent = title; section.append(heading);
			const grid = document.createElement('div'); grid.className = 'advanced-grid'; section.append(grid);
			for (const field of config.fields.filter(item => item.group === group)) {
				const label = document.createElement('label'), input = document.createElement('input');
				input.name = field.key; input.type = field.type === 'boolean' ? 'checkbox' : field.type;
				if (field.min != null) { input.min = field.min; input.max = field.max; input.step = field.step || 1; }
				if (field.type === 'boolean') label.className = 'checkbox-label';
				label.append(document.createTextNode(field.label), input); grid.append(label);
			}
			$('advanced-fields').append(section);
		}
	}
	function friendly(reason) {
		const count = /^Expected (\d+) matches, found (\d+)/.exec(reason);
		if (count) return 'Das Turnier hat ' + count[2] + ' Spiele; der Test erwartet ' + count[1] + '. Passe die erwartete Spielanzahl unter „Weitere Einstellungen“ an (0 = beliebig).';
		if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/.test(reason)) return 'Der BTS-Server ist nicht erreichbar. Prüfe Serveradresse, Port und ob BTS gestartet ist.';
		if (reason === 'Invalid URL') return 'Bitte eine vollständige Serveradresse eingeben, zum Beispiel https://localhost:4433.';
		if (reason === 'No sustained backlog observed') return 'Kein anhaltender Rückstau beobachtet.';
		if (reason === 'No fresh server telemetry') return 'Es fehlen aktuelle Servermesswerte.';
		if (reason === 'Some DB queues lack telemetry') return 'Einige Datenbank-Warteschlangen können noch nicht gemessen werden.';
		if (reason.includes('waiting >1s')) return reason.split(':')[0] + ': Aufgaben warten seit mindestens 10 Sekunden länger als eine Sekunde.';
		if (reason.includes('backlog growing')) return reason.split(':')[0] + ': Der Rückstand wächst seit etwa 30 Sekunden.';
		if (reason.includes('Event loop')) return 'Der Server reagiert seit mindestens 10 Sekunden verzögert.';
		if (reason.includes('expired unmatched')) return reason.split(':')[0] + ': Einige Punkte konnten innerhalb von 30 Sekunden nicht zugeordnet werden.';
		if (reason.includes('point reception delayed')) return reason.split(':')[0] + ': Punkte kommen verzögert an oder warten auf Empfang.';
		if (reason.includes('Timeout')) return 'Der Server antwortet nicht rechtzeitig auf die Diagnoseabfrage.';
		if (reason.includes('compatible performance')) return 'Die Serverversion stellt noch keine passende Performance-Messung bereit.';
		return reason;
	}
	function table(container, headers, rows) {
		const element = document.createElement('table'), head = document.createElement('thead'), line = document.createElement('tr');
		for (const title of headers) { const cell = document.createElement('th'); cell.textContent = title; line.append(cell); } head.append(line); element.append(head);
		const body = document.createElement('tbody');
		for (const row of rows) { const tr = document.createElement('tr'); for (const value of row) { const td = document.createElement('td'); td.textContent = value ?? '—'; tr.append(td); } body.append(tr); }
		element.append(body); container.replaceChildren(element);
		if (!rows.length) { const empty = document.createElement('p'); empty.className = 'helper'; empty.textContent = 'Noch keine Messwerte vorhanden.'; container.append(empty); }
	}
	function series(key, label, color, get) { return { key, label, color, points: history.map(point => ({ ts: point.ts, value: get(point) })) }; }
	function queue_series(field, aggregate = false) {
		const groups = [...new Map(history.flatMap(point => point.queues.map(row => [row.key, row.name]))).entries()];
		if (aggregate) return [['locks', 'Locks', row => row.name === 'Locks'], ['db', 'Datenbank', row => row.name.startsWith('DB ')],
			['worker', 'Worker', row => row.name.startsWith('Worker ')], ['send', 'Admin-Versand', row => row.name === 'Admin send']]
			.map(([key, label, match], i) => series(key, label, window.DrillCharts.colors[i], point => {
				if (!point.measured || key === 'db' && point.unobserved_db?.length) return null;
				const rows = point.queues.filter(match); return rows.length && rows.some(row => row[field] == null) ? null : rows.reduce((sum, row) => sum + (row[field] || 0), 0);
			}));
		return groups.map(([key, label], i) => series(key, label, window.DrillCharts.colors[i % 8], point => point.queues.find(row => row.key === key)?.[field] ?? null)).filter(line => queue_selection.has(line.key));
	}
	function render_overview(snapshot) {
		const tv = snapshot.receipts[0], admin = snapshot.receipts[1];
		text('tv-p95', age(tv.p95)); text('admin-p95', age(admin.p95));
		text('tv-samples', tv.count + ' Punkte in der letzten Minute'); text('admin-samples', admin.count + ' Punkte in der letzten Minute');
		const fresh = snapshot.probe.age_ms != null && snapshot.probe.age_ms + (snapshot.probe.rtt_ms || 0) <= 5000 && !(snapshot.unobserved_db || []).length;
		text('pending-total', fresh ? snapshot.queues.reduce((sum, row) => sum + row.pending, 0) : '—');
		text('oldest', 'Älteste Wartezeit: ' + (fresh ? age(Math.max(0, ...snapshot.queues.map(row => row.oldest_pending_ms || 0))) : 'keine aktuellen Daten'));
		text('occupied', snapshot.courts.filter(court => court.match && ['oncourt', 'called'].includes(court.status)).length + ' / ' + snapshot.courts.length);
		text('points-total', snapshot.points + ' Punkte · ' + snapshot.checkins + (snapshot.settings.scenario ? ' Spieler-Check-ins' : ' Spiele eingecheckt'));
		window.DrillCharts.draw($('latency-chart'), [series('tv', 'TV', '#4268df', point => point.tv_p95), series('admin', 'Admin', '#169d83', point => point.admin_p95)], 'ms', 'Empfangslatenz p95 für TV und Admin');
		window.DrillCharts.draw($('backlog-chart'), queue_series('pending', true), 'Aufgaben', 'Anzahl wartender Serveraufgaben');
		table($('reception-table'), ['Ziel', 'p95 · 1 Min.', 'p99 · 1 Min.', 'Ausstehend', 'Ältestes Update', 'Abgelaufen · gesamt', 'Ø · gesamt', 'p95 · gesamt', 'p99 · gesamt', 'Maximum · gesamt', 'Zuordnung · gesamt'],
			snapshot.receipts.map(row => { const total = snapshot.cumulative[row.target.toLowerCase()]; return [row.target, age(row.p95), age(row.p99), row.pending, age(row.oldest_ms), row.expired, age(total.mean), age(total.p95), age(total.p99), age(total.max), total.count + ' / ' + total.sent_updates]; }));
		text('drain', snapshot.drain ? snapshot.drain.finished_ms == null ? 'Letzte Pause: Warteschlangen noch nicht für drei Sekunden durchgehend leer.' : 'Letzte Pause: wartende Queues nach ' + age(snapshot.drain.finished_ms) + ' abgebaut und mindestens drei Sekunden leer.' : 'Der Rückstandsabbau wird während einer Pause gemessen.');
	}
	function render_queues(snapshot) {
		window.DrillProcessing.render(snapshot, history, current.id);
		const opened = new Set([...$('blockers').querySelectorAll('details[open]')].map(element => element.dataset.key));
		window.DrillFlow.render($('flow'), snapshot);
		window.DrillCharts.draw($('queue-chart'), queue_series('pending'), 'Aufgaben', 'Wartende Aufgaben je Warteschlange');
		window.DrillCharts.draw($('wait-chart'), queue_series('oldest_ms'), 'ms', 'Älteste wartende Aufgabe je Warteschlange');
		table($('queue-table'), ['Warteschlange', 'Warten', 'Laufen', 'Älteste Wartezeit', 'Eingang / s', 'Abschluss / s', 'Änderung · 1 Min.', 'Höchststand*', 'Fehler / abgelehnt'],
			snapshot.queues.map(row => [row.name, row.pending, row.active, age(row.oldest_pending_ms), row.incoming == null ? '—' : row.incoming.toFixed(1), row.done == null ? '—' : row.done.toFixed(1), row.delta > 0 ? '+' + row.delta : row.delta, row.high_watermark, (row.failed_count || 0) + ' / ' + (row.rejected_count || 0)]));
		$('blockers').replaceChildren();
		for (const task of snapshot.lock?.pending_tasks || []) {
			const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
			details.dataset.key = task.task + JSON.stringify(task.locks); details.open = opened.has(details.dataset.key);
			summary.textContent = task.task + ' wartet ' + age(task.wait_ms) + ' · blockiert durch ' + (task.blocked_by || []).map(item => item.task).join(', ');
			pre.textContent = JSON.stringify(task, null, 2); details.append(summary, pre); $('blockers').append(details);
		}
		const active_tasks = [...(snapshot.lock?.active_tasks || []).map(task => ({ ...task, source: 'Locks' })),
			...snapshot.queues.filter(row => row.name !== 'Locks' && row.active && row.active_task)
				.map(row => ({ task: row.active_task, runtime_ms: row.active_ms, source: row.name }))];
		for (const task of active_tasks) {
			const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
			details.dataset.key = 'active:' + task.source + ':' + task.task; details.open = opened.has(details.dataset.key);
			summary.textContent = task.source + ': ' + task.task + ' läuft seit ' + age(task.runtime_ms);
			pre.textContent = JSON.stringify(task, null, 2); details.append(summary, pre); $('blockers').append(details);
		}
		const selected = document.createElement('details'), summary = document.createElement('summary'); selected.dataset.key = 'curves'; selected.open = opened.has('curves'); summary.textContent = 'Kurven auswählen'; selected.append(summary);
		const box = document.createElement('div'); box.className = 'advanced-grid';
		for (const row of snapshot.queues) {
			const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = queue_selection.has(row.key); label.className = 'checkbox-label'; label.append(input, document.createTextNode(row.name));
			input.addEventListener('change', () => { if (input.checked) queue_selection.add(row.key); else queue_selection.delete(row.key); render_queues(snapshot); }); box.append(label);
		} selected.append(box); $('blockers').append(selected);
		window.DrillCharts.draw($('loop-chart'), [series('loop-p95', 'p95', '#4268df', point => point.loop_p95), series('loop-max', 'Maximum', '#d69035', point => point.loop_max)], 'ms', 'Verzögerung der Node.js Event Loop');
		text('probe-detail', '* Höchststand = wartend + laufend seit Queue-Start. Diagnosealter: ' + age(snapshot.probe.age_ms) + ' · Anfrage/Antwort: ' + age(snapshot.probe.rtt_ms) + ' · Diagnosefehler: ' + snapshot.probe.failures + ' · Admin-Transportpuffer: ' + (snapshot.buffered_bytes ?? '—') + ' Bytes.');
	}
	function render_courts(snapshot) {
		const nodes = snapshot.courts.map(court => {
			const card = document.createElement('article'); card.className = 'panel court';
			const top = document.createElement('div'); top.className = 'court-top';
			const heading = document.createElement('h3'); heading.textContent = 'Feld ' + (court.num ?? court.name ?? court.id);
			const badge = document.createElement('span'); badge.className = 'badge' + (court.tv_connected ? '' : ' neutral'); badge.textContent = court.error ? 'Verbindungsfehler' : court.tv_connected ? 'TV verbunden' : 'TV verbindet'; top.append(heading, badge);
			const teams = document.createElement('div'); teams.className = 'court-teams'; teams.textContent = court.teams.join(' gegen ');
			const score = document.createElement('div'); score.className = 'court-score'; score.textContent = court.score || '—';
			const state = document.createElement('p'); state.className = 'muted'; state.textContent = court.match ? 'Spiel ' + court.match + ' · ' + ({ oncourt: 'Auf dem Feld', called: 'Aufgerufen', finished: 'Beendet' }[court.status] || court.status || '') : 'Wartet auf ein Spiel';
			const meta = document.createElement('div'); meta.className = 'court-meta';
			for (const value of ['TV zuletzt: ' + age(court.tv_last_ms), 'Admin zuletzt: ' + age(court.admin_last_ms), 'TV Ø 1 Min.: ' + age(court.tv_mean_ms), 'Admin Ø 1 Min.: ' + age(court.admin_mean_ms), 'Tablet: ' + (court.tablet_battery == null ? '—' : court.tablet_battery + '%' + (court.tablet_charging ? ' · lädt' : '')), court.updates + ' TV-Updates']) { const item = document.createElement('span'); item.textContent = value; meta.append(item); }
			card.append(top, teams, score, state, meta);
			if (court.drill_status || court.error) { const info = document.createElement('p'); info.className = 'helper'; info.textContent = court.error || court.drill_status; card.append(info); }
			return card;
		}); $('courts').replaceChildren(...nodes);
	}
	function event_title(event) {
		if (event.label.startsWith('Lock task:')) return 'Serveraufgabe mit langer Lauf- oder Wartezeit: ' + event.label.slice(10);
		if (event.label === 'Long running lock task') return 'Serveraufgabe läuft ungewöhnlich lange';
		if (event.label.startsWith('Queue failures:')) return 'Fehlgeschlagene Aufgaben: ' + event.label.slice(15);
		if (event.label.includes('Server restarted')) return 'Server neu gestartet · Queue-Verläufe beginnen neu';
		if (event.label.includes('Queues drained')) return 'Rückstand während der Pause abgebaut';
		const names = { 'live-drill:start': 'Test gestartet', 'live-drill:point': 'Punkt gesendet', 'live-drill:finish-confirm': 'Spielende bestätigt', 'live-drill:checkin:player': 'Spieler eingecheckt', 'live-drill:checkin': 'Spiel eingecheckt', 'live-drill:phase': 'Neue Testphase', 'live-drill:paused': 'Eingaben pausiert', 'live-drill:resumed': 'Eingaben fortgesetzt', 'live-drill:speed': 'Tempo geändert', 'live-drill:slow-admin-latency': 'Punkt kommt verzögert bei Admin an', 'live-drill:slow-display-latency': 'Punkt kommt verzögert am TV an' };
		return names[event.label] || event.label.replace('live-drill:', 'Test: ');
	}
	function render_events(snapshot) {
		const opened = new Set([...$('events').querySelectorAll('details[open]')].map(element => element.dataset.key));
		const filter = $('event-filter').value;
		const events = snapshot.events.filter(event => filter === 'all' || filter === 'server' && event.kind === 'server' || filter === 'important' &&
			(event.kind === 'server' || /error|failed|slow|repair|phase|paused|resumed|start|profile/.test(event.label)));
		$('events').replaceChildren(...events.map(event => {
			const details = document.createElement('details'); details.className = 'event';
			details.dataset.key = event.kind + ':' + event.ts + ':' + event.label; details.open = opened.has(details.dataset.key);
			const summary = document.createElement('summary'), time = document.createElement('time'), badge = document.createElement('span');
			time.textContent = new Date(event.ts).toLocaleTimeString('de-DE'); badge.className = 'badge neutral'; badge.textContent = event.kind === 'server' ? 'Server' : 'Test';
			summary.append(time, badge, document.createTextNode(event_title(event)));
			const pre = document.createElement('pre'); pre.textContent = JSON.stringify(event.details, null, 2); details.append(summary, pre); return details;
		}));
		if (!events.length) { const empty = document.createElement('p'); empty.className = 'helper'; empty.textContent = 'Bisher keine Ereignisse für diesen Filter.'; $('events').append(empty); }
		text('process-log', current.logs?.join('') || 'Keine zusätzlichen Prozessmeldungen.');
	}
	function render() {
		const active = ['starting', 'running', 'stopping'].includes(current.status), snapshot = current.snapshot;
		if (active && snapshot) {
			$('mode').value = current.mode;
			for (const field of config.fields) {
				const input = $('settings-form').elements.namedItem(field.key);
				if (field.type === 'boolean') input.checked = snapshot.settings[field.key]; else input.value = snapshot.settings[field.key] ?? '';
			}
		}
		$('settings-form').hidden = active && !settings_open; $('settings-toggle').hidden = !active;
		text('settings-toggle', settings_open ? 'Einstellungen ausblenden' : 'Einstellungen anzeigen');
		for (const input of $('settings-form').querySelectorAll('input, select, button')) input.disabled = active || busy || !connected;
		if (!active) mode_help();
		$('run-controls').hidden = !active && !snapshot; $('progress-wrap').hidden = !snapshot;
		text('run-state', statuses[current.status]); text('setup-title', active ? 'Dein Test läuft' : 'Test einrichten');
		text('setup-hint', active ? (snapshot?.settings.base_url || '') + ' · Turnier ' + (snapshot?.settings.tournament_key || '') : 'Der Test spielt im aktuellen Turnierstand weiter und sendet echte Punkte und Check-ins.');
		$('download').hidden = !current.report_available;
		text('download', current.report_available && active ? 'Zwischenbericht herunterladen ↓' : 'Bericht herunterladen ↓');
		for (const command of ['stop', 'pause', 'faster', 'slower']) $(command).disabled = !active || busy || !connected || current.status === 'stopping' || (command !== 'stop' && (!current.ready || current.mode === 'benchmark'));
		text('pause', snapshot?.paused ? 'Fortsetzen' : 'Pause');
		text('connection', connected ? '● Dashboard verbunden' : '○ Verbindung unterbrochen · verbindet erneut'); $('connection').className = 'connection' + (connected ? ' connected' : '');
		if (current.error) { notice(friendly(current.error)); shown_error = true; }
		else if (shown_error) { notice(''); shown_error = false; }
		$('empty').hidden = !!snapshot; $('live-content').hidden = !snapshot;
		if (!snapshot) {
			$('health').className = 'health ' + (current.error ? 'error' : 'unknown');
			text('health-title', current.error ? 'Der Test konnte nicht gestartet werden' : active ? 'Verbindung zum BTS-Server wird hergestellt' : 'Bereit für den ersten Test');
			text('health-reason', current.error ? friendly(current.error) : active ? 'Die ersten Messwerte erscheinen nach dem Verbinden.' : 'Wähle deinen BTS-Server und dein Testturnier. Der Test startet erst mit dem Startknopf.');
			return;
		}
		for (const row of snapshot.queues) if (!known_queues.has(row.key)) { known_queues.add(row.key); if (row.pending || ['Locks', 'DB matches', 'DB tournaments', 'DB courts', 'Admin send'].includes(row.name) || row.name.startsWith('Worker ')) queue_selection.add(row.key); }
		const age_ms = Date.now() - snapshot.ts, stale = active && age_ms > 5000;
		const level = current.status === 'error' ? 'error' : !connected || stale ? 'unknown' : snapshot.status.level.toLowerCase();
		$('health').className = 'health ' + level;
		text('health-icon', level === 'ok' ? '✓' : level === 'warn' || level === 'error' ? '!' : '○');
		text('health-title', level === 'error' ? 'Der Test konnte nicht fortgesetzt werden' : level === 'unknown' ? 'Noch keine verlässliche Einschätzung' : level === 'warn' ? 'Hier lohnt sich ein genauer Blick' : active ? 'Der Test läuft bisher unauffällig' : 'Ergebnis des letzten Tests');
		text('health-reason', stale || !connected ? 'Die Verbindung oder aktuelle Messdaten fehlen. Alte Werte bleiben zur Orientierung sichtbar.' : snapshot.status.reasons.map(friendly).join(' '));
		text('runtime', clock(snapshot.runtime_ms)); text('phase', snapshot.phase ? phases[snapshot.phase.name] : snapshot.paused ? 'Eingaben pausiert' : 'Freier Test');
		const duration = snapshot.settings.max_runtime_ms;
		$('progress').hidden = !duration; $('progress').value = duration ? Math.min(100, snapshot.runtime_ms / duration * 100) : 0;
		text('progress-text', duration ? clock(snapshot.runtime_ms) + ' / ' + clock(duration) + ' · ' + Math.min(100, Math.round(snapshot.runtime_ms / duration * 100)) + '%' : 'Keine feste Laufzeit · bis zum manuellen Stopp');
		text('tempo-text', 'Punktabstand ' + (snapshot.settings.point_min_ms / 1000).toFixed(1) + '–' + (snapshot.settings.point_max_ms / 1000).toFixed(1) + ' s');
		if (view === 'overview') render_overview(snapshot);
		else if (view === 'queues') render_queues(snapshot);
		else if (view === 'courts') render_courts(snapshot);
		else if (view === 'payloads') table($('payload-table'), ['Quelle', 'Nachrichtentyp', 'Anzahl', 'Zuordnungen', 'Ø', 'Minimum', 'p95', 'p99', 'Maximum'], ['tv', 'admin'].flatMap(source => snapshot.payloads[source].map(row => [source === 'tv' ? 'TV' : 'Admin', row.type, row.count, row.latency_count, age(row.avg), age(row.min), age(row.p95), age(row.p99), age(row.max)])));
		else render_events(snapshot);
	}
	function accept(state, point = null, reset_history = false, reconnect_state = false) {
		// HTTP control replies can arrive after a newer live update. Never let an
		// older response overwrite the final report or restart a stopped display.
		if (!reconnect_state && state.revision < (current.revision || 0)) return;
		if (reset_history || state.id !== current.id) { history = []; known_queues.clear(); queue_selection = new Set(); }
		current = state;
		if (state.history) history = state.history;
		if (point) { history = history.filter(entry => entry.ts !== point.ts && entry.ts >= point.ts - 300000); history.push(point); history = history.slice(-301); }
		render();
	}
	async function connect() {
		try { config.token = (await (await fetch('/api/config')).json()).token; }
		catch (_) { connected = false; render(); reconnect = setTimeout(connect, 1500); return; }
		socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/live?token=' + encodeURIComponent(config.token));
		socket.addEventListener('open', () => { connected = true; render(); });
		socket.addEventListener('message', event => { last_message = Date.now(); const message = JSON.parse(event.data); accept(message.state, message.point, message.reset_history, message.type === 'state'); });
		socket.addEventListener('close', () => { connected = false; render(); clearTimeout(reconnect); reconnect = setTimeout(connect, 1500); });
		socket.addEventListener('error', () => socket.close());
	}
	async function action(fn) {
		busy = true; notice(''); render();
		try { await fn(); } catch (error) { notice(friendly(error.message)); }
		finally { busy = false; render(); }
	}
	async function init() {
		config = await (await fetch('/api/config')).json(); setup_fields(); apply_defaults();
		$('mode').addEventListener('change', () => { const connection = { base_url: $('settings-form').elements.base_url.value, tournament_key: $('settings-form').elements.tournament_key.value }; apply_defaults(); for (const [key, value] of Object.entries(connection)) $('settings-form').elements.namedItem(key).value = value; });
		$('settings-form').addEventListener('submit', event => { event.preventDefault(); action(async () => accept(await post('/api/start', { mode: $('mode').value, settings: settings() }))); });
		$('check').addEventListener('click', () => action(async () => {
			const values = settings(); const result = await post('/api/check', { base_url: values.base_url, tournament_key: values.tournament_key });
			$('tournaments').replaceChildren(...(result.tournaments || []).map(tournament => { const option = document.createElement('option'); option.value = tournament.key; option.label = tournament.name; return option; }));
			notice(result.message, true);
		}));
		$('settings-toggle').addEventListener('click', () => { settings_open = !settings_open; render(); });
		for (const command of ['stop', 'pause', 'faster', 'slower']) $(command).addEventListener('click', () => action(async () => accept(await post('/api/control', { command }))));
		for (const button of document.querySelectorAll('.nav')) button.addEventListener('click', () => {
			view = button.dataset.view; for (const nav of document.querySelectorAll('.nav')) { nav.classList.toggle('active', nav === button); if (nav === button) nav.setAttribute('aria-current', 'page'); else nav.removeAttribute('aria-current'); }
			for (const page of document.querySelectorAll('[data-page]')) page.hidden = page.dataset.page !== view;
			text('page-title', views[view][0]); text('page-description', views[view][1]); render();
		});
		$('event-filter').addEventListener('change', render);
		connect();
		setInterval(() => { if (connected && last_message && Date.now() - last_message > 6000 && ['running', 'starting'].includes(current.status)) socket.close(); else if (current.snapshot && ['running', 'starting'].includes(current.status)) render(); }, 2000);
	}
	init().catch(error => notice('Das Dashboard konnte nicht geladen werden: ' + error.message));
})();
