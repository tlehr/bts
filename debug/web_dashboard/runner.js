'use strict';

const { run } = require('../live_tournament_drill');
const snapshot = require('./snapshot');
let dashboard, controls, timer, started = false;
function send(message) { if (process.connected) process.send(message, () => {}); }
function publish() { if (dashboard) send({ type: 'snapshot', snapshot: snapshot(dashboard) }); }

process.on('message', async message => {
	if (message.type === 'command' && controls) {
		try {
			if (!['stop', 'pause', 'faster', 'slower'].includes(message.command)) throw new Error('Unbekannter Befehl.');
			controls[message.command](); publish();
			send({ type: 'ack', id: message.id });
		} catch (error) { send({ type: 'ack', id: message.id, error: error.message }); }
		return;
	}
	if (message.type !== 'start' || started) return;
	started = true;
	try {
		await run(message.options, {
			keyboard: false,
			on_dashboard(value) { dashboard = value; timer = setInterval(publish, 1000); },
			on_controls(value) { controls = value; send({ type: 'ready' }); publish(); },
			on_report(report) { publish(); send({ type: 'report', report }); },
		});
	} catch (error) { send({ type: 'failure', error: error.message }); process.exitCode = 1; }
	finally { clearInterval(timer); process.disconnect(); }
});
process.on('disconnect', () => { if (controls) controls.stop(); });
