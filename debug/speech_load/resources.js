'use strict';

const fs = require('fs/promises');

function parse_stat(text) {
	const end = text.lastIndexOf(')'), columns = text.slice(end + 2).trim().split(/\s+/);
	if (end < 0 || columns.length < 22) throw new Error('invalid process stat');
	return { user_ticks: Number(columns[11]), system_ticks: Number(columns[12]), nice: Number(columns[16]),
		start_ticks: Number(columns[19]), resident_pages: Number(columns[21]) };
}
function parse_io(text) {
	return Object.fromEntries(text.trim().split('\n').map(line => {
		const [key, value] = line.split(':'); return [key, Number(value.trim())];
	}));
}
async function read(pid) {
	try {
		const [stat, io] = await Promise.all([fs.readFile('/proc/' + pid + '/stat', 'utf8'), fs.readFile('/proc/' + pid + '/io', 'utf8')]);
		return { pid, ts: Date.now(), ...parse_stat(stat), io: parse_io(io) };
	} catch (error) {
		return { pid, ts: Date.now(), unavailable: error.code || error.message };
	}
}
function delta(first, last, ticks_per_second) {
	if (!first || !last || first.unavailable || last.unavailable || first.start_ticks !== last.start_ticks) return { available: false };
	const wall_ms = last.ts - first.ts, cpu_ms = (last.user_ticks + last.system_ticks - first.user_ticks - first.system_ticks) * 1000 / ticks_per_second;
	return { available: true, wall_ms, cpu_ms, cpu_percent_one_core: wall_ms > 0 ? cpu_ms * 100 / wall_ms : null, nice: last.nice,
		io: Object.fromEntries(Object.entries(last.io).map(([key, value]) => [key, value - first.io[key]])) };
}
module.exports = { read, parse_stat, parse_io, delta };
