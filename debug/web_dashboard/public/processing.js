/* eslint-env browser */
'use strict';

window.DrillProcessing = (() => {
	const $ = id => document.getElementById(id);
	const time = value => value == null ? '—' : value < 1000 ? Number(value.toFixed(1)).toLocaleString('de-DE') + ' ms' : (value / 1000).toFixed(2) + ' s';
	const types = { point: 'Punktänderung', finish: 'Spielende', sync: 'BTP-Sync', calling: 'Vorbereitung / Aufruf', admin: 'Admin-Übersicht', other: 'Serveraufgabe' };
	const kinds = { lock_wait: 'Lock-Warten', lock_hold: 'Lock gehalten', db_wait: 'DB-Warten', db_run: 'DB-Verarbeitung',
		worker_wait: 'Worker-Warten', worker_run: 'Worker-Auftrag', worker_phase: 'Im Worker', phase: 'Verarbeitungsschritt',
		send_wait: 'Versand wartet', send_enqueue: 'An WebSocket übergeben', encoding: 'Antwort kodieren', transport: 'BTP-Anfrage / Antwort',
		queue_wait: 'Vorgänger abwarten', operation: 'Gesamter Vorgang' };
	kinds.offload = 'Ausgelagerte / vorbereitete Arbeit';
	const names = { handle_score_update_v2: 'Punkt / Spielende (V2)', handle_score_update: 'Punkt / Spielende (V1)', fetch_sync_apply: 'Sync übernehmen',
		admin_tournament_snapshot: 'Admin-Übersicht zusammenstellen', admin_match_copy: 'Spielübersicht kopieren', admin_match_read: 'Spielübersicht lesen',
		owner_check: 'Tablet-Zuständigkeit prüfen', duplicate_check: 'Doppelte Punktmeldung erkennen',
		load_context: 'Spiel und Spielfeld laden', validate: 'Spielzustand prüfen', build_update: 'Änderung berechnen', db_update_match: 'Spiel speichern',
		notify_score_and_display_fanout_start: 'Admin informieren / TV-Updates auslösen', finish_cleanup: 'Spieler und Offizielle freigeben',
		court_clear_after_finish: 'Spielfeld freigeben', auto_preparation: 'Vorbereitung aktualisieren', auto_call_free_courts: 'Freie Felder aufrufen',
		incremental_snapshot: 'Lokale Objekte lesen', incremental_worker_plan: 'Änderungen im Worker planen', incremental_refresh: 'Planungszustand aktualisieren',
		incremental_diff: 'Änderungen und betroffene Ressourcen bestimmen', incremental_validate: 'Plan unter Locks validieren',
		incremental_writes: 'Geänderte Objekte speichern', incremental_publish: 'Änderungen veröffentlichen', incremental_cache: 'Vergleichszustand merken',
		btp_request_response: 'BTP-Daten holen', sync_serialization: 'Vorherigen Sync abwarten', incremental_replan: 'Plan erneut berechnen',
		incremental_point_rebase: 'Zwischenzeitliche Punkte übernehmen', normalize_sync_state: 'Zustände normalisieren',
		integrate_matches: 'Spiele integrieren', integrate_player_state: 'Spielerzustände integrieren', integrate_now_on_court: 'Feldbelegung abgleichen' };
	const title = row => names[row.name] || row.name.replace(/^load_context_/, 'Lesen: ').replace(/^device_info_/, 'Tablet-Info: ');
	const lock_title = lock => {
		const [kind, tournament, id] = lock.split(':');
		if (kind === 'court') { const court = snapshot?.courts.find(row => row.id.replace(/[:\s]+/g, '_') === id); return court ? 'Spielfeld ' + (court.num || court.name || id) : 'Spielfeld ' + id; }
		if (kind === 'match') return 'Spiel ' + id;
		return ({ tournament: 'Turnier ' + tournament, matches: 'Alle Spiele · ' + tournament, courts: 'Alle Spielfelder · ' + tournament,
			umpires: 'Offizielle', tabletoperators: 'Tablet-Zuordnung', preparation: 'Vorbereitung', 'auto-call': 'Automatische Aufrufe',
			sync: 'Sync-Integration', all: 'Alle Ressourcen', legacy: 'Globaler Lock' })[kind] || lock;
	};
	const is_kind = kind => row => row.kind === kind;
	const is_name = name => row => row.kind === 'phase' && row.name === name;
	const step = (label, match, optional = false) => ({ label, match, optional });
	const shared = [step('Auf Locks warten', is_kind('lock_wait')), step('Locks halten', is_kind('lock_hold'))];
	const point_steps = [shared[0], step('Laden', is_name('load_context')), step('Prüfen', is_name('validate')),
		step('Änderung berechnen', is_name('build_update')), step('Speichern', is_name('db_update_match')), step('Events auslösen', is_name('notify_score_and_display_fanout_start'))];
	const branches = [step('Lock-Haltedauer', is_kind('lock_hold')), step('DB-Warten', is_kind('db_wait')), step('DB-Ausführung', is_kind('db_run')),
		step('Worker-Warten', is_kind('worker_wait')), step('Worker-Auftrag', is_kind('worker_run')),
		step('TV-Versand', row => row.kind === 'send_enqueue' && row.name.startsWith('tv:')),
		step('Admin wartet auf Versand', is_kind('send_wait')), step('Admin-Versand', row => row.kind === 'send_enqueue' && row.name.startsWith('admin:'))];
	const plans = {
		point: point_steps,
		finish: [...point_steps, step('Spieler / Offizielle freigeben', is_name('finish_cleanup')), step('Feld freigeben', is_name('court_clear_after_finish')),
			step('Vorbereitung', is_name('auto_preparation'), true), step('Aufruf', is_name('auto_call_free_courts'), true)],
			sync: [step('BTP-Daten holen', is_kind('transport'), true), step('Vorgänger abwarten', is_kind('queue_wait')), step('Daten geändert?', is_name('incremental_fingerprint')),
			step('Lokale Objekte lesen', is_name('incremental_snapshot')), step('Planen', row => ['incremental_worker_plan', 'incremental_refresh'].includes(row.name)),
			step('Änderungen bestimmen', is_name('incremental_diff')), shared[0], step('Plan validieren', is_name('incremental_validate')),
			step('Änderungen speichern', is_name('incremental_writes')), step('Veröffentlichen', is_name('incremental_publish'))],
		calling: [step('Vorgänger abwarten', is_kind('queue_wait')), step('Lokale Objekte lesen', is_name('incremental_snapshot')),
			step('Kandidaten planen', row => ['incremental_worker_plan', 'auto_call_precheck'].includes(row.name)), shared[0],
			step('Plan validieren', is_name('incremental_validate')), step('Speichern', is_name('incremental_writes')), step('Aufruf auslösen', is_name('incremental_publish'))],
		other: [...shared, step('DB-Warten', is_kind('db_wait')), step('DB-Verarbeitung', is_kind('db_run'))],
		admin: [step('Übersicht zusammenstellen', is_name('admin_tournament_snapshot')), step('Spiele lesen', is_name('admin_match_read')),
			step('Spiele kopieren', is_name('admin_match_copy'), true), step('Antwort kodieren', is_kind('encoding')), step('Versandübergabe', is_kind('send_enqueue'))],
	};
	let snapshot, history = [], chosen_step = null, selected = null, run_id = null;
	const frozen = new Map();
	function element(tag, text, class_name) {
		const node = document.createElement(tag); if (text != null) node.textContent = text; if (class_name) node.className = class_name; return node;
	}
	function stage_card(definition, rows, lane) {
		const matching = rows.filter(definition.match), slowest = matching.reduce((best, row) => !best || row.p95 > best.p95 ? row : best, null);
		const button = element('button', null, 'flow-node stage-button' + (slowest?.p95 > 100 ? ' waiting' : ''));
		button.type = 'button'; button.dataset.stage = definition.label;
		button.append(element('h3', definition.label), element('strong', slowest ? time(slowest.p95) : '—'),
			element('p', matching.length > 1 ? 'Höchster Schritt-p95 · ' + matching.length + ' Messstellen' : slowest ? 'p95 · ' + slowest.count + ' Ausführungen' : 'Bisher nicht aufgezeichnet'),
			element('small', definition.optional ? 'Bei Bedarf' : lane === 'branch' ? 'Teilzeit / paralleler Zweig' : 'Verarbeitungsschritt'));
		if (matching.some(row => row.skipped)) button.append(element('p', matching.reduce((sum, row) => sum + (row.skipped || 0), 0) + ' × übersprungen / unverändert'));
		button.classList.toggle('selected', chosen_step?.label === definition.label);
		button.addEventListener('click', () => { chosen_step = definition; draw(); }); return button;
	}
	function stages(rows) {
		const container = $('stage-details'); container.replaceChildren();
		const chosen = chosen_step ? rows.filter(chosen_step.match) : rows.filter(row => row.kind === 'operation');
		container.append(element('h3', chosen_step ? chosen_step.label + ' · Messstellen' : 'Gesamtdauer der Vorgänge'));
		const table = element('table'), heading = element('tr');
		for (const value of ['Messstelle', 'Art', 'Anzahl', 'Letzte', 'Ø', 'p95*', 'Maximum', 'Fehler', 'Übersprungen']) heading.append(element('th', value));
		const thead = element('thead'); thead.append(heading); table.append(thead);
		const tbody = element('tbody');
		for (const row of chosen) {
			const tr = element('tr'); for (const value of [title(row), kinds[row.kind] || row.kind, row.count, time(row.last), time(row.mean), time(row.p95), time(row.max), row.failed, row.skipped || 0]) tr.append(element('td', value)); tbody.append(tr);
		} table.append(tbody); const wrap = element('div', null, 'table-wrap'); wrap.append(table); container.append(wrap);
		if (!chosen.length) container.append(element('p', 'Noch keine Ausführung gemessen. Fehlende Werte sind keine Nullmessung.', 'helper'));
		const lines = chosen.slice(0, 8).map((row, i) => ({ key: row.key, label: title(row), color: window.DrillCharts.colors[i],
			points: history.map(point => ({ ts: point.ts, value: point.measured ? point.stages?.find(value => value.key === row.key)?.p95 ?? null : null })) }));
		window.DrillCharts.draw($('stage-chart'), lines, 'ms', 'p95 der ausgewählten Verarbeitungsschritte im Verlauf');
	}
	function show_trace(trace) {
		const container = $('trace-timeline'); container.replaceChildren();
		if (!trace) { $('trace-summary').textContent = 'Noch kein passender Vorgang aufgezeichnet.'; return; }
		const rows = trace.spans || [], now = snapshot?.ts || Date.now();
		const duration = row => row.duration_ms ?? Math.max(0, now - row.start_ts);
		const total = Math.max(1, trace.duration_ms || 0, ...rows.map(row => (row.offset_ms || 0) + duration(row)));
		const waits = rows.filter(row => row.kind === 'lock_wait'), largest_wait = Math.max(0, ...waits.map(duration));
		const receipt = trace.reception;
		$('trace-summary').textContent = types[trace.type] + ' #' + trace.id + ' · ' + (trace.status === 'running' ? 'läuft noch' : trace.status === 'error' ? 'Fehler' : 'abgeschlossen') +
			' · Servervorgang ' + time(trace.duration_ms) + ' · längstes Lock-Warten ' + time(largest_wait) +
			(trace.skipped ? ' · übersprungen: ' + (trace.reason || 'unverändert') : '') + (trace.match_id ? ' · Spiel ' + trace.match_id : '') +
			(receipt ? ' · Tablet → TV ' + time(receipt.tv_ms) + ' · Tablet → Admin ' + time(receipt.admin_ms) : '') +
			(trace.dropped_spans ? ' · ' + trace.dropped_spans + ' Schritte wegen Aufzeichnungslimit ausgelassen' : '');
		if (trace.status !== 'running' && trace.pending_spans) $('trace-summary').textContent += ' · ' + trace.pending_spans + ' Hintergrund-/Versandschritte noch offen';
		const axis = element('div', null, 'timeline-axis'); axis.append(element('span', 'Serverzeit seit Vorgangsbeginn'), element('span', time(total))); container.append(axis);
		const opened = new Set(frozen.get(trace.id) || []);
		for (const row of [...rows].sort((a, b) => (a.offset_ms || 0) - (b.offset_ms || 0) || a.id - b.id)) {
			const details = element('details', null, 'timeline-entry'); details.open = opened.has(row.id);
			const summary = element('summary'), label = element('span', title(row), 'timeline-label');
			const track = element('span', null, 'timeline-track'), bar = element('span', null, 'timeline-bar ' + (/wait/.test(row.kind) ? 'wait' : row.kind === 'lock_hold' ? 'hold' : 'work'));
			bar.style.left = Math.min(99.5, (row.offset_ms || 0) / total * 100) + '%'; bar.style.width = Math.max(.5, duration(row) / total * 100) + '%';
			track.append(bar); summary.append(label, track, element('span', time(duration(row)), 'timeline-duration'));
			const explanation = element('p', (kinds[row.kind] || row.kind) + ' · Beginn +' + time(row.offset_ms || 0) +
				' · ' + (row.status === 'running' ? 'noch aktiv' : row.status === 'error' ? 'Fehler' : 'beendet'), 'helper');
			details.append(summary, explanation);
			if (row.kind === 'lock_hold') details.append(element('p', 'Gehaltene Locks: ' + (row.locks || []).map(lock_title).join(', ') + (row.locks_truncated ? ' · ' + row.locks_truncated + ' weitere im Detail ausgelassen' : ''), 'lock-description'));
			else if (row.held_locks?.length) details.append(element('p', 'Bei Beginn gehaltene Locks: ' + row.held_locks.map(lock_title).join(', ') + (row.held_locks_truncated ? ' · ' + row.held_locks_truncated + ' weitere ausgelassen' : ''), 'lock-description'));
			for (const blocker of row.blockers || []) {
				const conflicting = blocker.conflicting_locks || [];
				details.append(element('p', 'Beobachteter Blockierer: ' + (names[blocker.task] || blocker.task) + ' (#' + blocker.id + ', ' + (blocker.state === 'active' ? 'läuft' : 'wartet vor diesem Vorgang') + '). Ressourcen: ' + (conflicting.length ? conflicting : blocker.locks || []).map(lock_title).join(', '), 'lock-description'));
				const owner = [...(snapshot.processing?.active || []), ...(snapshot.processing?.completed || [])].find(item => item.id === blocker.operation_id);
				if (owner) { const button = element('button', 'Blockierenden Vorgang #' + owner.id + ' öffnen', 'button secondary'); button.type = 'button';
					button.addEventListener('click', () => { selected = owner; $('flow-type').value = owner.type; chosen_step = null; draw(); }); details.append(button); }
			}
			if (row.kind === 'lock_wait') details.append(element('p', row.blockers?.length ? 'Der Blockierer wurde während des Wartens beobachtet. Die gesamte Wartezeit umfasst auch Scheduling.' : 'Kein Lock-Konflikt beobachtet; die Wartezeit kann durch Scheduling entstehen.', 'helper'));
			const raw = element('details'); raw.open = opened.has('raw:' + row.id);
			raw.append(element('summary', 'Technische Messdaten'), element('pre', JSON.stringify(row, null, 2))); details.append(raw);
			raw.addEventListener('toggle', () => { if (raw.open) opened.add('raw:' + row.id); else opened.delete('raw:' + row.id); frozen.set(trace.id, [...opened]); });
			details.addEventListener('toggle', () => { if (details.open) opened.add(row.id); else opened.delete(row.id); frozen.set(trace.id, [...opened]); });
			container.append(details);
		}
		if (!rows.length) container.append(element('p', 'Keine Schritte erfasst; die Detailaufzeichnung war möglicherweise ausgeschaltet.', 'helper'));
	}
	function draw() {
		if (!snapshot) return;
		const processing = snapshot.processing, type = $('flow-type').value;
		$('processing-status').textContent = !processing ? 'Der Server liefert noch keine Ablaufaufzeichnung. BTS nach dem Update neu starten.'
			: !snapshot.settings.processing_traces ? 'Detailaufzeichnung für diesen Test ausgeschaltet.'
				: 'Detailaufzeichnung ' + (processing.enabled ? 'aktiv' : 'ausgelaufen') + ' · serverweite Sitzung ' + processing.session +
				' · ' + (processing.active_total ?? processing.active?.length ?? 0) + ' Vorgänge aktiv · ' + (processing.remaining || 0) + ' Berichte noch abzuholen' +
				(snapshot.probe.age_ms == null || snapshot.probe.age_ms + (snapshot.probe.rtt_ms || 0) > 5000 ? ' · Messdaten veraltet' : '') +
				(processing.gap || processing.dropped_traces ? ' · Aufzeichnungslimit erreicht; Export enthält Angaben zur Abdeckung.' : '');
		const rows = (processing?.stages || []).filter(row => row.type === type), plan = $('processing-plan'); plan.replaceChildren();
		const lane = element('div', null, 'flow-stages processing-stages');
		for (const definition of plans[type]) lane.append(stage_card(definition, rows, 'main')); plan.append(lane);
		if (type === 'sync' || type === 'point') plan.append(element('p', type === 'sync' ? 'Entscheidungen: Daten unverändert → Verarbeitung überspringen. Plan veraltet → Locks freigeben und neu planen. Worker-Ausführung hält keine Turnier-Locks.'
			: 'Entscheidungen: doppelte Punktmeldung → überspringen. Spielende → Freigaben und nächste Aufrufe. TV- und Admin-Aktualisierung können parallel weiterlaufen.', 'helper flow-decision'));
		const branch = element('div', null, 'flow-branches');
		for (const definition of branches) branch.append(stage_card(definition, rows, 'branch')); plan.append(branch); stages(rows);
		const choices = [...new Map([...(processing?.active || []), ...(processing?.completed || [])].filter(trace => trace.type === type)
			.map(trace => [trace.id, trace])).values()];
		const order = $('trace-order').value;
		const weight = trace => order === 'slow' ? trace.duration_ms || 0 : order === 'wait' ? Math.max(0, ...(trace.spans || []).filter(row => row.kind === 'lock_wait').map(row => row.duration_ms || 0)) : order === 'errors' ? trace.status === 'error' ? 1 : 0 : trace.start_ts;
		choices.sort((a, b) => weight(b) - weight(a) || b.start_ts - a.start_ts);
		if (selected) {
			const updated = choices.find(trace => trace.id === selected.id); if (updated) selected = updated;
			else choices.unshift(selected);
		}
		$('trace-select').replaceChildren(...choices.slice(0, 100).map(trace => { const option = element('option',
			new Date(trace.start_ts).toLocaleTimeString('de-DE') + ' · #' + trace.id + ' · ' + types[trace.type] + ' · ' + time(trace.duration_ms) + (trace.status === 'error' ? ' · Fehler' : '')); option.value = trace.id; return option; }));
		if (selected) $('trace-select').value = selected.id;
		show_trace(selected || choices[0]);
		$('trace-select').onchange = () => { selected = choices.find(trace => String(trace.id) === $('trace-select').value); show_trace(selected); };
	}
	for (const id of ['flow-type', 'trace-order']) $(id).addEventListener('change', () => { if (id === 'flow-type') chosen_step = null; selected = null; draw(); });
	return { render(value, points, id) {
		if (run_id !== id || snapshot?.server_id !== value.server_id) { selected = null; chosen_step = null; frozen.clear(); }
		run_id = id; snapshot = value; history = points; draw();
	} };
})();
