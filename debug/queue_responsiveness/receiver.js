'use strict';

const WebSocket = require('ws');

async function main(options) {
	const ws = new WebSocket(options.url), result = {};
	let sent, received = 0, completed = false;
	const answers = new Set();
	const now = () => String(process.hrtime.bigint());
	ws.on('error', error => process.send({ type: 'error', message: error.message }));
	ws.on('message', raw => {
		const received_ns = now();
		const message = JSON.parse(raw.toString());
		if (message.type === 'error') { process.send({ type: 'error', message: message.message }); return; }
		if (message.type === 'answer' && ['call', 'free'].includes(message.rid)) answers.add(message.rid);
		if (message.type === 'change' && ((message.ctype === 'match_called_on_court' && message.val?._id === options.match_id) ||
			(message.ctype === 'free_announce' && message.val?._announcement_claim_key === 'queue-probe'))) {
			const kind = message.ctype === 'free_announce' ? 'free' : 'call';
			if (!result[kind]) { result[kind] = { sent_ns: sent, received_ns, latency_ms: Number(BigInt(received_ns) - BigInt(sent)) / 1e6 }; received++; }
		}
		if (!completed && received === 2 && answers.size === 2) { completed = true; process.send({ type: 'done', result }); }
	});
	await new Promise(resolve => ws.once('open', resolve));
	process.send({ type: 'ready' });
	process.on('message', message => {
		if (message.type === 'probe') {
			sent = now();
			ws.send(JSON.stringify({ type: 'match_call_on_court', rid: 'call', tournament_key: 'default', match_id: options.match_id, court_id: options.court_id }));
			ws.send(JSON.stringify({ type: 'free_announce', rid: 'free', tournament_key: 'default', text: 'Queue probe', announcement_claim_key: 'queue-probe' }));
			process.send({ type: 'sent', sent_ns: sent });
		}
		if (message.type === 'stop') { ws.terminate(); process.exit(0); }
	});
}

if (require.main === module) main(JSON.parse(process.argv[2])).catch(error => { process.send?.({ type: 'error', message: error.message }); process.exit(1); });
