'use strict';

const { performance } = require('perf_hooks');
const traces = require('../performance/traces');

// Reserve the response's position before starting its encoder. Later updates
// must follow this snapshot on the same socket, or an older overview could
// overwrite a newer live update. Other sockets and server work remain free.
module.exports = function outbox(ws, encode = require('./encoder').encode) {
	let active = false, closed = false, encoding = false;
	const pending = [];
	let encoding_started = 0;
	ws.on('close', () => { closed = true; for (const entry of pending) traces.end(entry.wait_span, true); pending.length = 0; });
	const tracked = message => ({ context: traces.capture(), wait_span: traces.begin('admin:' + (message?.ctype || message?.type || 'snapshot'), 'send_wait') });
	const encode_small = (message, context = traces.capture()) => traces.with_context(context, () => {
		const span = traces.begin('admin_update_encode', 'encoding');
		try { const bytes = JSON.stringify(message); traces.end(span); return bytes; }
		catch (error) { traces.end(span, error); throw error; }
	});
	const send = (encoded, details, job) => {
		traces.end(job?.wait_span, closed);
		if (!closed && (ws.readyState === undefined || ws.readyState === 1)) {
			traces.with_context(job?.context, () => {
				const span = traces.begin('admin:' + (job?.message?.ctype || details?.ctype || 'message'), 'send_enqueue');
				try { ws.send(encoded, { binary: false }); traces.end(span); }
				catch (error) { traces.end(span, error); throw error; }
			});
			if (details) ws.emit('bts:message_sent', details);
		}
	};
	function drain() {
		if (encoding) return;
		if (closed) { pending.length = 0; active = false; return; }
		while (pending.length && !pending[0].encode && !pending[0].reserved) {
			const entry = pending.shift(); send(entry.encoded, entry.details, entry);
		}
		if (pending[0]?.reserved) return;
		const job = pending.shift();
		if (!job) { active = false; return; }
		encoding = true;
		traces.end(job.wait_span);
		encoding_started = performance.now();
		const start = process.hrtime.bigint();
		const encode_span = traces.with_context(job.context, () => traces.begin('admin_snapshot_encode', 'encoding'));
		Promise.resolve().then(() => traces.with_context(job.context, () => traces.run(encode_span,
			() => encode(job.message, { tournament_key: job.key })))).then(result => ({ bytes: result.bytes ?? result, execution: result.execution || 'background' }), error => {
			if (closed) return {};
			// Encoder failure/overload does not lose the response. Its detached
			// snapshot remains available for the ordinary encoder.
			require('../server_diagnostics').log(ws.app, job.key, '[bts] admin response encoder fallback: ' + error.message);
			return { bytes: JSON.stringify(job.message), execution: 'main_fallback' };
		}).then(({ bytes, execution }) => {
			traces.end(encode_span, null, { execution });
			traces.end(job.wait_span, closed);
			if (closed) return;
			const encoded = typeof bytes === 'string' ? bytes : Buffer.from(bytes);
			ws.emit('bts:response_encoded', { rid: job.message.rid, bytes: Buffer.byteLength(encoded), execution,
				elapsed_ms: Number(process.hrtime.bigint() - start) / 1e6 });
			send(encoded, null, job);
		}).catch(error => {
			traces.end(encode_span, error);
			if (!closed) send(JSON.stringify({ type: 'error', rid: job.message.rid, message: error.message }), null, job);
		}).finally(() => { encoding = false; drain(); });
	}
	return {
		stats() {
			return { pending: pending.length, active: encoding ? 1 : 0,
				oldest_pending_ms: pending.length ? Math.round(performance.now() - pending[0].queued) : 0,
				active_ms: encoding ? Math.round(performance.now() - encoding_started) : 0,
				reserved: pending.filter(entry => entry.reserved).length };
		},
		send(message) {
			if (closed) return;
			// Freeze small updates when queued, rather than retaining mutable data.
			const start = ws.listenerCount('bts:message_sent') ? process.hrtime.bigint() : null;
			const encoded = encode_small(message);
			const details = start && { rid: message.rid, ctype: message.ctype, bytes: Buffer.byteLength(encoded),
				elapsed_ms: Number(process.hrtime.bigint() - start) / 1e6 };
			const entry = { encoded, details, queued: performance.now(), ...tracked(message) };
			if (active) pending.push(entry); else send(encoded, details, entry);
		},
		shared(packet) {
			if (closed) return;
			// One immutable text payload for a broadcast, with each socket's own
			// reservation, wait span and delivery event. Retain bytes, not live DTOs.
			const details = ws.listenerCount('bts:message_sent') ? { rid: packet.rid, ctype: packet.ctype,
				bytes: packet.bytes.length, elapsed_ms: packet.elapsed_ms } : null;
			const message = { type: packet.type, ctype: packet.ctype };
			const entry = { encoded: packet.bytes, details, message, queued: performance.now(), ...tracked(message) };
			if (active) pending.push(entry); else send(packet.bytes, details, entry);
		},
		large(message, key) {
			if (closed) return;
			pending.push({ message, key, encode: true, queued: performance.now(), ...tracked(message) });
			if (!active) { active = true; drain(); }
		},
		reserve() {
			if (closed) return { reserved: true, queued: performance.now() };
			const entry = { reserved: true, queued: performance.now(), ...tracked() };
			if (!closed) { pending.push(entry); if (!active) { active = true; drain(); } }
			return entry;
		},
		complete(entry, message, key, background = true) {
			if (closed || !entry.reserved) return;
			Object.assign(entry, background ? { message, key, encode: true } : { encoded: encode_small(message, entry.context) });
			entry.reserved = false;
			drain();
		},
	};
};

// Created afresh for each notify_change call, never cached across revisions.
// Server WebSockets send an unmasked text frame and do not mutate this Buffer.
module.exports.prepare_broadcast = function(message) {
	const span = traces.begin('admin_broadcast_encode', 'encoding'), started = performance.now();
	try {
		const bytes = Buffer.from(JSON.stringify(message));
		const packet = { bytes, rid: message.rid, type: message.type, ctype: message.ctype, elapsed_ms: performance.now() - started };
		traces.end(span); return packet;
	} catch (error) { traces.end(span, error); throw error; }
};
