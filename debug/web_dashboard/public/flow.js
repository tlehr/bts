/* eslint-env browser */
'use strict';

window.DrillFlow = (() => {
	const age = value => value == null ? '—' : value < 1000 ? Math.round(value) + ' ms' : (value / 1000).toFixed(1) + ' s';
	function card(title, value, subtitle, waiting = false) {
		const element = document.createElement('div'); element.className = 'flow-node' + (waiting ? ' waiting' : '');
		const heading = document.createElement('h3'); heading.textContent = title;
		const number = document.createElement('strong'); number.textContent = value;
		const detail = document.createElement('p'); detail.textContent = subtitle;
		element.append(heading, number, detail); return element;
	}
	function aggregate(rows) {
		return { pending: rows.reduce((sum, row) => sum + row.pending, 0), active: rows.reduce((sum, row) => sum + row.active, 0),
			oldest: Math.max(0, ...rows.map(row => row.oldest_pending_ms || 0)) };
	}
	function render(container, snapshot) {
		container.replaceChildren();
		const queues = snapshot.queues, lock = aggregate(queues.filter(row => row.name === 'Locks'));
		const db = aggregate(queues.filter(row => row.name.startsWith('DB '))), send = aggregate(queues.filter(row => row.name === 'Admin send'));
		const fresh = snapshot.probe.age_ms != null && snapshot.probe.age_ms + (snapshot.probe.rtt_ms || 0) <= 5000;
		const stage = document.createElement('div'); stage.className = 'flow-stages';
		const qcard = (title, row, observed = true) => card(title, fresh && observed ? row.pending + ' warten' : 'Keine aktuellen Daten',
			fresh && observed ? row.active + ' laufen · älteste: ' + age(row.oldest) : 'Messung fehlt oder ist veraltet', fresh && observed && row.pending > 0);
		stage.append(card('Tablet sendet Punkte', snapshot.points + ' Punkte', 'Simulation im Testprozess'), qcard('Locks & Verarbeitung', lock),
			qcard('Datenbank', db, !(snapshot.unobserved_db || []).length), qcard('Admin-Versand', send)); container.append(stage);
		const branch = document.createElement('div'); branch.className = 'flow-branches';
		const label = document.createElement('span'); label.className = 'branch-label'; label.textContent = 'Parallel / Empfang'; branch.append(label);
		const workers = aggregate(queues.filter(row => row.name.startsWith('Worker ')));
		branch.append(qcard('Hintergrund-Worker', workers));
		for (const row of snapshot.receipts) branch.append(card(row.target === 'TV' ? 'TV hat den Punkt' : 'Admin hat den Punkt', age(row.p95),
			'p95 letzte Minute · ' + row.pending + ' Updates ausstehend', row.oldest_ms > 1000));
		branch.append(card('Sync mit BTP', 'Parallel', 'Kein eigener Transport-Messwert'));
		container.append(branch);
	}
	return { render };
})();
