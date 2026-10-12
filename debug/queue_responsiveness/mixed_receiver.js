'use strict';

const fs = require('fs/promises');
const path = require('path');

async function main(options) {
	const { parse_args, run } = require(options.client_module);
	const reception = new (require(path.join(path.dirname(options.client_module), 'reception/transport')))();
	await reception.ready;
	const argv = ['--base-url', options.url, '--tournament', 'default', '--seed', '519-mixed',
		'--expected-matches', String(options.count), '--point-min-ms', String(options.point_min_ms), '--point-max-ms', String(options.point_max_ms),
		'--score-gap-min-ms', '0', '--score-gap-max-ms', '0', '--max-runtime-ms', String(options.duration_ms),
		'--no-dashboard', '--report', path.join(options.directory, 'client-result.json')];
	if (options.scenario) argv.push('--scenario', options.scenario);
	const args = parse_args(argv);
	args.quiet = true;
	const ws = new reception.WebSocket(options.url.replace(/^http/, 'ws') + '/ws/admin');
	const probes = [], pending = new Map(), answers = new Set();
	let controls, timer, report, stopping = false, running = false;
	ws.on('error', error => process.send({ type: 'error', message: error.message }));
	ws.on('message', (raw, _binary, timing) => {
		const received_ns = BigInt(timing.received_ns);
		const message = JSON.parse(raw.toString());
		if (message.type === 'error') { process.send({ type: 'error', message: message.message }); return; }
		if (message.type === 'answer') answers.add(message.rid);
		if (message.type !== 'change') return;
		const key = message.ctype === 'free_announce' ? message.val?._announcement_claim_key :
			message.ctype === 'match_called_on_court' && message.val?._id === options.match_id ? 'call' : null;
		if (!pending.has(key)) return;
		const row = pending.get(key); pending.delete(key);
		row.received_ns = String(received_ns); row.latency_ms = Number(received_ns - BigInt(row.sent_ns)) / 1e6;
	});
	await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
	function send(kind) {
		const rid = kind === 'call' ? 'call' : 'free-' + probes.length;
		const row = { kind, rid, sent_ns: String(process.hrtime.bigint()) }; probes.push(row); pending.set(rid, row);
		ws.send(JSON.stringify(kind === 'call' ? { type: 'match_call_on_court', rid, tournament_key: 'default',
			match_id: options.match_id, court_id: options.court_id } : { type: 'free_announce', rid, tournament_key: 'default',
			text: 'Mixed workload probe', announcement_claim_key: rid }));
	}
	process.send({ type: 'ready' });
	process.on('message', async message => {
		if (message.type === 'probe') { send('call'); send('free'); timer = setInterval(() => send('free'), 2000); }
		if (message.type === 'start') {
			if (running) return;
			running = true;
			try {
				await run(args, { keyboard: false, WebSocketTransport: reception.WebSocket, reception,
					on_controls: value => { controls = value; }, on_report: value => { report = value; } });
				clearInterval(timer);
				// Reception and the response are independent; require both.
				const deadline = Date.now() + 5000;
				while ((pending.size || probes.some(row => !answers.has(row.rid))) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
				ws.close();
				await reception.flush();
				await fs.writeFile(path.join(options.directory, 'probe-result.json'), JSON.stringify({ probes,
					reception: reception.snapshot(), unanswered: probes.filter(row => !answers.has(row.rid)).length }));
				if (!report || report.failure || pending.size || probes.some(row => !answers.has(row.rid))) throw new Error(report?.failure || 'Missing client report/events/answers');
				if (!report.tablet_to_tv_ms.count || !report.tablet_to_admin_ms.count) throw new Error('No matched score reception at TV/admin');
				await reception.close();
				if (stopping) process.exit(0);
				process.send({ type: 'done', result: path.join(options.directory, 'client-result.json') });
			} catch (error) { clearInterval(timer); ws.terminate(); await reception.close(); process.send({ type: 'error', message: error.message }); }
		}
		if (message.type === 'stop') {
			stopping = true; clearInterval(timer); ws.terminate();
			if (report || !running) { await reception.close(); process.exit(0); }
			else controls?.stop();
		}
	});
}

if (require.main === module) main(JSON.parse(process.argv[2])).catch(error => { process.send?.({ type: 'error', message: error.message }); process.exit(1); });
