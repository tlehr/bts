'use strict';

// The unmodified tournament test client, with its separate reception worker.
// All mutation targets are supplied by the disposable parent server.
async function main(options) {
	const path = require('path');
	const { parse_args, run } = require(options.client_module);
	const reception = new (require(path.join(path.dirname(options.client_module), 'reception/transport')))();
	await reception.ready;
	const argv = ['--base-url', options.url, '--tournament', 'default', '--seed', 'speech-load-confirmation',
		'--expected-matches', '373', '--point-min-ms', '3200', '--point-max-ms', '6400',
		'--score-gap-min-ms', '0', '--score-gap-max-ms', '0', '--max-runtime-ms', String(options.duration_ms),
		'--no-dashboard', '--report', options.report];
	if (options.duration_ms === 600000) argv.push('--scenario', 'benchmark');
	const args = parse_args(argv); args.quiet = true;
	let controls, report, running = false, timer;
	process.on('disconnect', () => { controls?.stop(); process.exit(1); });
	process.on('message', async message => {
		if (message.type === 'stop') { controls?.stop(); return; }
		if (message.type !== 'start' || running) return;
		running = true;
		const began = Date.now();
		timer = setInterval(() => process.send?.({ type: 'progress', elapsed_ms: Date.now() - began }), 30000);
		try {
			await run(args, { keyboard: false, WebSocketTransport: reception.WebSocket, reception,
				on_controls: value => { controls = value; }, on_report: value => { report = value; } });
			if (!report || report.failure || !report.tablet_to_tv_ms.count || !report.tablet_to_admin_ms.count) {
				throw new Error(report?.failure || 'Normal test produced no matched reception');
			}
			await reception.close(); process.send?.({ type: 'done', report });
		} catch (error) { await reception.close(); process.send?.({ type: 'error', message: error.stack }); }
		finally { clearInterval(timer); }
	});
	process.send?.({ type: 'ready' });
}
if (require.main === module) process.once('message', options => main(options).catch(error => {
	process.send?.({ type: 'error', message: error.stack }); process.exit(1);
}));
