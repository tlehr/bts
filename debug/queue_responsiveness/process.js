'use strict';

const { fork } = require('child_process');
const fs = require('fs');

function launch(entry, options, directory, name, signal) {
	const fd = fs.openSync(directory + '/' + name + '.log', 'wx');
	let child;
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('BTS_')));
	try { child = fork(entry, [JSON.stringify(options)], { env, stdio: ['ignore', fd, fd, 'ipc'] }); }
	finally { fs.closeSync(fd); }
	const messages = [], waiters = [];
	let failure, exited, stopping = false;
	const closed = new Promise(resolve => child.once('exit', (code, signal) => { exited = { code, signal }; resolve(exited); }));
	function flush() {
		for (const waiter of waiters.slice()) {
			const index = messages.findIndex(message => message.type === waiter.type);
			if (index >= 0 || failure) {
				clearTimeout(waiter.timeout); waiters.splice(waiters.indexOf(waiter), 1);
				if (failure) waiter.reject(failure); else waiter.resolve(messages.splice(index, 1)[0]);
			}
		}
	}
	child.on('message', message => {
		if (message.type === 'error') failure = new Error(name + ': ' + message.message);
		else messages.push(message);
		flush();
	});
	child.on('error', error => { failure = error; flush(); });
	child.on('exit', (code, signal) => {
		if (!stopping) { failure ||= new Error(name + ' exited before completion: ' + (signal || code)); flush(); }
	});
	const abort = () => { failure = new Error('Queue comparison interrupted'); flush(); child.kill('SIGINT'); };
	signal?.addEventListener('abort', abort, { once: true });
	if (signal?.aborted) abort();
	return {
		child,
		send: message => { if (!exited && child.connected) child.send(message); },
		wait(type, timeout_ms = 45000) { return new Promise((resolve, reject) => {
			const waiter = { type, resolve, reject };
			waiter.timeout = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); reject(new Error(name + ': timed out waiting for ' + type)); }, timeout_ms);
			waiters.push(waiter); flush();
		}); },
		async stop() {
			stopping = true;
			signal?.removeEventListener('abort', abort);
			if (exited) return;
			if (child.connected) child.send({ type: 'stop' }); else child.kill('SIGTERM');
			let timer;
			try { await Promise.race([closed, new Promise(resolve => { timer = setTimeout(() => { child.kill('SIGKILL'); closed.then(resolve); }, 3000); })]); }
			finally { clearTimeout(timer); }
		},
	};
}

module.exports = { launch };
