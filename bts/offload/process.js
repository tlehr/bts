'use strict';

const { EventEmitter } = require('events');
const { fork } = require('child_process');

// Worker-shaped IPC with a separate libuv pool. File operations in worker
// threads otherwise share the parent's pool, including NeDB point appends.
class ProcessWorker extends EventEmitter {
	constructor(filename, { workerData }) {
		super();
		this.child = fork(filename, [], { serialization: 'advanced', execArgv: [],
			stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
		this.pid = this.child.pid;
		this.exited = false;
		this.closed = new Promise(resolve => {
			this.child.once('close', code => { this.exited = true; resolve(code); });
		});
		this.child.on('message', message => this.emit('message', message));
		this.child.on('error', error => this.emit('error', error));
		this.child.on('exit', (code, signal) => { this.exited = true; this.emit('exit', code, signal); });
		try { this.postMessage({ type: 'initialize', workerData }); }
		catch (error) { queueMicrotask(() => this.emit('error', error)); }
	}

	postMessage(message) {
		if (!this.child.connected) throw new Error('speech_process_disconnected');
		this.child.send(message, error => { if (error && !this.exited) this.emit('error', error); });
	}

	unref() { this.child.unref(); this.child.channel?.unref(); }

	terminate() {
		if (!this.exited) this.child.kill();
		return this.closed;
	}
}

module.exports = ProcessWorker;
