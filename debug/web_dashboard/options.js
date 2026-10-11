'use strict';

const { parse_args } = require('../live_tournament_drill');

// All simulation settings remain accessible; presentation and output files are
// handled by the web application rather than accepted as arbitrary paths.
const fields = [
	['base_url', '--base-url', 'BTS-Server', 'text', 'connection'],
	['tournament_key', '--tournament', 'Turnierkennung', 'text', 'connection'],
	['point_min_ms', '--point-min-ms', 'Punktabstand mindestens (ms)', 'number', 'tempo', 50, 120000],
	['point_max_ms', '--point-max-ms', 'Punktabstand höchstens (ms)', 'number', 'tempo', 50, 120000],
	['expected_matches', '--expected-matches', 'Erwartete Spiele (0 = beliebig)', 'number', 'sequence', 0, 100000],
	['seed', '--seed', 'Zufalls-Seed (leer = Standard des Modus)', 'text', 'sequence'],
	['max_runtime_ms', '--max-runtime-ms', 'Laufzeitbegrenzung (ms; 0 = unbegrenzt)', 'number', 'sequence', 0, 86400000],
	['score_all_active', '', 'Auf allen aktiven Feldern spielen', 'boolean', 'tempo'],
	['score_gap_min_ms', '--score-gap-min-ms', 'Zusatzabstand mindestens (ms)', 'number', 'tempo', 0, 120000],
	['score_gap_max_ms', '--score-gap-max-ms', 'Zusatzabstand höchstens (ms)', 'number', 'tempo', 0, 120000],
	['pause_visible_ms', '--pause-visible-ms', 'Sichtbare Spielpause mindestens (ms)', 'number', 'tempo', 0, 120000],
	['checkin_min_ms', '--checkin-min-ms', 'Check-in-Abstand mindestens (ms)', 'number', 'checkin', 1, 3600000],
	['checkin_max_ms', '--checkin-max-ms', 'Check-in-Abstand höchstens (ms)', 'number', 'checkin', 1, 3600000],
	['score_probability_min', '--score-probability-min', 'Punktwahrscheinlichkeit Team 1 mindestens', 'number', 'scoring', 0, 1, 0.01],
	['score_probability_max', '--score-probability-max', 'Punktwahrscheinlichkeit Team 1 höchstens', 'number', 'scoring', 0, 1, 0.01],
	['display_ack_render_ms', '--display-ack-render-ms', 'Simulierte TV-Verarbeitungszeit (ms)', 'number', 'diagnostics', 0, 60000],
	['slow_latency_ms', '--slow-latency-ms', 'Langsame Empfangsereignisse ab (ms; 0 = aus)', 'number', 'diagnostics', 0, 60000],
	['processing_traces', '', 'Verarbeitungsschritte und Locks aufzeichnen', 'boolean', 'diagnostics'],
	['server_telemetry', '', 'Serverdiagnose abfragen (aus: nur Eventempfang)', 'boolean', 'diagnostics'],
	['tablet_battery_min', '--tablet-battery-min', 'Anfangsakku mindestens (%)', 'number', 'battery', 1, 100],
	['tablet_battery_max', '--tablet-battery-max', 'Anfangsakku höchstens (%)', 'number', 'battery', 1, 100],
	['tablet_battery_drain_min', '--tablet-battery-drain-min', 'Akkuverlust mindestens (% je Update)', 'number', 'battery', 0, 100, 0.01],
	['tablet_battery_drain_max', '--tablet-battery-drain-max', 'Akkuverlust höchstens (% je Update)', 'number', 'battery', 0, 100, 0.01],
	['tablet_charging_ratio', '--tablet-charging-ratio', 'Anteil ladender Tablets', 'number', 'battery', 0, 1, 0.01],
	['tablet_charge_min', '--tablet-charge-min', 'Akkuzuwachs mindestens (% je Update)', 'number', 'battery', 0, 100, 0.01],
	['tablet_charge_max', '--tablet-charge-max', 'Akkuzuwachs höchstens (% je Update)', 'number', 'battery', 0, 100, 0.01],
].map(([key, flag, label, type, group, min, max, step]) => ({ key, flag, label, type, group, min, max, step }));

function defaults(mode = 'benchmark') {
	const options = parse_args(mode === 'benchmark' ? ['--scenario', 'benchmark', '--plain-log'] : ['--plain-log']);
	return Object.fromEntries(fields.map(field => [field.key, options[field.key] ?? '']));
}

function build_options(input) {
	if (!input || !['benchmark', 'interactive'].includes(input.mode)) throw new Error('Bitte einen Testmodus wählen.');
	const values = { ...defaults(input.mode), ...input.settings };
	const argv = input.mode === 'benchmark' ? ['--scenario', 'benchmark'] : [];
	for (const field of fields) {
		const value = values[field.key];
		if (field.type === 'boolean') {
			if (typeof value !== 'boolean') throw new Error(field.label + ': ungültiger Wert.');
			const flags = { processing_traces: ['--no-processing-traces', '--processing-traces'], server_telemetry: ['--no-server-telemetry', '--server-telemetry'], score_all_active: ['--score-one-active', '--score-all-active'] };
			argv.push(flags[field.key][Number(value)]);
		} else if (field.type === 'number') {
			if (value === '' && field.key === 'expected_matches' && input.mode === 'interactive') continue;
			const number = Number(value);
			if (!Number.isFinite(number) || number < field.min || number > field.max || (!field.step && !Number.isInteger(number))) {
				throw new Error(field.label + ': Wert außerhalb des erlaubten Bereichs.');
			}
			argv.push(field.flag, String(number));
		} else {
			if (typeof value !== 'string' || value.length > 512 || value.startsWith('--')) throw new Error(field.label + ': ungültiger Text.');
			if (field.key === 'seed' && value === '') continue;
			if (!value.trim()) throw new Error(field.label + ' fehlt.');
			argv.push(field.flag, value.trim());
		}
	}
	const url = new URL(values.base_url);
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('BTS-Adresse muss eine HTTP- oder HTTPS-Adresse sein.');
	const options = parse_args(argv.concat('--plain-log'));
	return { ...options, quiet: true, report_path: null };
}

module.exports = { fields, defaults, build_options };
