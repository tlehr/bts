'use strict';

const path = require('path');
const { fork } = require('child_process');

module.exports = async function receiver(url, role) {
	const start = process.hrtime.bigint();
	const child = fork(path.join(__dirname, 'websocket_receiver.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
	let pending;
	const listen = type => new Promise((resolve, reject) => {
		const timeout = setTimeout(() => { pending = null; reject(new Error('WebSocket receiver timed out at ' + type)); }, 15000);
		pending = { type, resolve(value) { clearTimeout(timeout); pending = null; resolve(value); }, reject(error) { clearTimeout(timeout); pending = null; reject(error); } };
	});
	child.on('message', message => {
		if (message.type === 'error') pending?.reject(new Error(message.message));
		else if (message.type === pending?.type) pending.resolve(message);
	});
	child.on('error', error => pending?.reject(error));
	child.on('exit', code => pending?.reject(new Error('WebSocket receiver exited: ' + code)));
	const close = async () => {
		if (child.exitCode !== null || child.signalCode !== null) return;
		const exited = new Promise(resolve => child.once('exit', resolve));
		child.kill(); await exited;
	};
	try {
		const ready = listen('ready'); child.send({ type: 'connect', url: url + (role ? '?role=' + role : ''), role });
		const { clock_ns } = await ready;
		if (BigInt(clock_ns) < start || BigInt(clock_ns) > process.hrtime.bigint()) {
			throw new Error('Receiver monotonic clock is not comparable to server clock');
		}
	} catch (error) { await close(); throw error; }
	return {
		async run(input) {
			const finished = listen('received'); child.send({ type: 'run', ...input });
			return (await finished).received;
		}, close,
	};
};
