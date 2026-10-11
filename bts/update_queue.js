'use strict';

const lock_keys = require('./queue_lock_keys');
const { ResourceLockQueue } = require('./resource_lock_queue');

const queue = new ResourceLockQueue();

function instance() {
	return {
		execute(task, ...args) {
			return queue.execute(task, {
				args,
				locks: task?._queue_locks || [lock_keys.legacy_global()],
				mode: 'global',
			});
		},
		set_hang_reporter(fn) {
			queue.set_hang_reporter(fn);
		},
		stats() {
			return queue.stats();
		},
	};
}

function named(name, task) {
	task._queue_name = name;
	return task;
}

function hang_after(ms, task) {
	task._queue_hang_after_ms = ms;
	return task;
}

function locks(lock_list, task) {
	task._queue_locks = lock_keys.normalize_list(lock_list);
	return task;
}

function exclusive(task) {
	task._queue_exclusive = true;
	task._queue_locks = lock_keys.normalize_list([...(task._queue_locks || []), lock_keys.all()]);
	return task;
}

function keyed_instance(key) {
	return {
		execute(task, ...args) {
			return execute_keyed(key, task, ...args);
		},
	};
}

function execute_keyed(key, task, ...args) {
	const task_locks = task?._queue_locks || [lock_keys.keyed(key)];
	return queue.execute(task, {
		args,
		locks: task_locks,
		key,
		mode: 'keyed',
	});
}

function execute_locked(lock_list, task, ...args) {
	return queue.execute(task, {
		args,
		locks: lock_keys.normalize_list(lock_list),
		mode: 'locked',
	});
}

function stats() {
	return queue.stats();
}

module.exports = {
	execute_keyed,
	execute_locked,
	exclusive,
	hang_after,
	instance,
	keyed_instance,
	locks,
	lock_keys,
	named,
	stats,
};
