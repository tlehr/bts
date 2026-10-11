'use strict';

const milliseconds = ns => Math.round(Number(ns) / 1e5) / 10;
const cpu_ms = microseconds => Math.round(microseconds / 100) / 10;

class DecodeTiming {
	constructor(context, packet_bytes) {
		this.context = { tournament_key: context.tournament_key, action: context.action };
		this.emit = context.emit;
		this.log_enabled = context.enabled ?? require('../server_diagnostics').sync_timing_enabled(context.tournament_key);
		this.start_ts = Date.now();
		this.started = process.hrtime.bigint();
		this.cpu_started = process.cpuUsage();
		this.packet_bytes = packet_bytes;
		this.phases = [];
		this.finished = false;
	}
	measure(phase, work) {
		const started = process.hrtime.bigint();
		const cpu_started = process.cpuUsage();
		const start_ts = Date.now();
		let failed = false;
		try { return work(); }
		catch (error) { failed = true; throw error; }
		finally {
			const ended = process.hrtime.bigint();
			const cpu = process.cpuUsage(cpu_started);
			this.phases.push({ phase, duration_ms: milliseconds(ended - started),
				start_ts, cpu_ms: cpu_ms(cpu.user + cpu.system), status: failed ? 'error' : 'ok' });
			require('../performance/traces').phase('btp_decode_' + phase, start_ts, milliseconds(ended - started), { error: failed, execution: 'main' });
		}
	}
	finish(error) {
		if (this.finished) return;
		this.finished = true;
		const ended = process.hrtime.bigint();
		const cpu = process.cpuUsage(this.cpu_started);
		const failed = this.phases.find(row => row.status === 'error');
		const record = { ...this.context, start_ts: this.start_ts, ts: Date.now(),
			duration_ms: milliseconds(ended - this.started),
			cpu_user_ms: cpu_ms(cpu.user), cpu_system_ms: cpu_ms(cpu.system),
			packet_bytes: this.packet_bytes, compressed_bytes: Math.max(0, this.packet_bytes - 4),
			xml_bytes: this.xml_bytes, status: error ? 'error' : 'ok',
			...(error ? { failed_phase: failed?.phase || 'header', error_type: error.name || 'Error' } : {}),
			phases: this.phases,
		};
		// Diagnostics must not turn a valid response into a protocol failure.
		try {
			if (this.emit) this.emit(record);
			else if (this.log_enabled) console.warn('[bts] btp_fetch:response_decode ' + JSON.stringify(record)); // eslint-disable-line no-console
		}
		catch (_) { /* Preserve the decoder result even if the log sink fails. */ }
	}
}

module.exports = function decode_timing(context = {}, packet_bytes) {
	if (!(context.enabled ?? require('../server_diagnostics').sync_timing_enabled(context.tournament_key)) &&
		!(require('../performance/traces').enabled() && require('../performance/traces').capture()?.record)) return null;
	return new DecodeTiming(context, packet_bytes);
};
