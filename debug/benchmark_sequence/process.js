'use strict';

const fs = require('fs');
const { spawn } = require('child_process');

function pause(ms, signal) {
	return new Promise((resolve, reject) => {
		const aborted = () => { clearTimeout(timer); cleanup(); reject(new Error('Sequence interrupted')); };
		const cleanup = () => signal?.removeEventListener('abort', aborted);
		const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
		signal?.addEventListener('abort', aborted, { once: true });
		if (signal?.aborted) aborted();
	});
}

function wait_for_abort(signal) {
	let aborted;
	const promise = new Promise((resolve, reject) => {
		aborted = () => reject(new Error('Sequence interrupted'));
		signal?.addEventListener('abort', aborted, { once: true });
		if (signal?.aborted) aborted();
	});
	return { promise, close: () => signal?.removeEventListener('abort', aborted) };
}

class OwnedProcess {
	constructor(entry, args, env, cwd, log_path) {
		const fd = fs.openSync(log_path, 'wx');
		try { this.child = spawn(process.execPath, [entry, ...args], { cwd, env, stdio: ['ignore', fd, fd] }); }
		finally { fs.closeSync(fd); }
		this.pid = this.child.pid;
		this.result = null;
		this.done = new Promise(resolve => {
			this.child.once('error', error => { this.spawn_error = error; });
			this.child.once('close', (code, signal) => {
				this.result = { code, signal, error: this.spawn_error?.message || null }; resolve(this.result);
			});
		});
	}
	async stop(grace_ms = 10000) {
		if (this.result) return this.result;
		this.child.kill('SIGINT');
		let timer;
		try {
			return await Promise.race([this.done, new Promise(resolve => {
				timer = setTimeout(() => { this.child.kill('SIGKILL'); this.done.then(resolve); }, grace_ms);
			})]);
		} finally { clearTimeout(timer); }
	}
}

module.exports = { OwnedProcess, pause, wait_for_abort };
