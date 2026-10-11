'use strict';

const assert = require('assert');

const { _describe, _it } = require('./tutils.js');
const update_queue = require('../bts/update_queue');
const { ResourceLockQueue } = require('../bts/resource_lock_queue');

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique_key(name) {
	return `${name}:${Date.now()}:${Math.random()}`;
}

_describe('update_queue keyed execution', () => {
	_it('runs tasks with the same key serially', async () => {
		const key = unique_key('same');
		let active = 0;
		let max_active = 0;
		const task = update_queue.named('same-key-task', async () => {
			active++;
			max_active = Math.max(max_active, active);
			await sleep(10);
			active--;
		});

		await Promise.all([
			update_queue.execute_keyed(key, task),
			update_queue.execute_keyed(key, task),
			update_queue.execute_keyed(key, task),
		]);

		assert.strictEqual(max_active, 1);
	});

	_it('runs tasks with different keys in parallel', async () => {
		let active = 0;
		let max_active = 0;
		const make_task = (name) => update_queue.named(name, async () => {
			active++;
			max_active = Math.max(max_active, active);
			await sleep(20);
			active--;
		});

		await Promise.all([
			update_queue.execute_keyed(unique_key('parallel-a'), make_task('parallel-a')),
			update_queue.execute_keyed(unique_key('parallel-b'), make_task('parallel-b')),
		]);

		assert.strictEqual(max_active, 2);
	});

	_it('lets an exclusive keyed task wait without being overtaken by new keyed tasks', async () => {
		const events = [];
		const long_key = unique_key('long');
		const exclusive_key = unique_key('exclusive');
		const later_key = unique_key('later');

		const long_task = update_queue.named('long-key-task', async () => {
			events.push('long-start');
			await sleep(25);
			events.push('long-end');
		});
		const exclusive_task = update_queue.exclusive(update_queue.named('exclusive-key-task', async () => {
			events.push('exclusive-start');
			await sleep(5);
			events.push('exclusive-end');
		}));
		const later_task = update_queue.named('later-key-task', async () => {
			events.push('later-start');
		});

		const long_promise = update_queue.execute_keyed(long_key, long_task);
		await sleep(1);
		const exclusive_promise = update_queue.execute_keyed(exclusive_key, exclusive_task);
		const later_promise = update_queue.execute_keyed(later_key, later_task);
		await Promise.all([long_promise, exclusive_promise, later_promise]);

		assert(events.indexOf('long-end') < events.indexOf('exclusive-start'));
		assert(events.indexOf('exclusive-end') < events.indexOf('later-start'));
	});

	_it('runs tasks with non-conflicting resource locks in parallel', async () => {
		let active = 0;
		let max_active = 0;
		const make_task = (name, locks) => update_queue.locks(locks, update_queue.named(name, async () => {
			active++;
			max_active = Math.max(max_active, active);
			await sleep(20);
			active--;
		}));

		await Promise.all([
			update_queue.execute_keyed(unique_key('match-a'), make_task('match-a', [
				update_queue.lock_keys.match('default', 'match-a'),
				update_queue.lock_keys.court('default', 'court-a'),
			])),
			update_queue.execute_keyed(unique_key('match-b'), make_task('match-b', [
				update_queue.lock_keys.match('default', 'match-b'),
				update_queue.lock_keys.court('default', 'court-b'),
			])),
		]);

		assert.strictEqual(max_active, 2);
	});

	_it('serializes tasks with the same resource lock', async () => {
		let active = 0;
		let max_active = 0;
		const make_task = (name) => update_queue.locks([
			update_queue.lock_keys.match('default', 'shared-match'),
		], update_queue.named(name, async () => {
			active++;
			max_active = Math.max(max_active, active);
			await sleep(10);
			active--;
		}));

		await Promise.all([
			update_queue.execute_keyed(unique_key('resource-a'), make_task('resource-a')),
			update_queue.execute_keyed(unique_key('resource-b'), make_task('resource-b')),
		]);

		assert.strictEqual(max_active, 1);
	});

	_it('lets collection locks block item locks in the same tournament', async () => {
		const events = [];
		const collection_task = update_queue.locks([
			update_queue.lock_keys.matches('default'),
		], update_queue.named('matches-lock-task', async () => {
			events.push('collection-start');
			await sleep(20);
			events.push('collection-end');
		}));
		const match_task = update_queue.locks([
			update_queue.lock_keys.match('default', 'm1'),
		], update_queue.named('match-lock-task', async () => {
			events.push('match-start');
		}));

		await Promise.all([
			update_queue.execute_keyed(unique_key('collection'), collection_task),
			update_queue.execute_keyed(unique_key('match'), match_task),
		]);

		assert.deepStrictEqual(events, ['collection-start', 'collection-end', 'match-start']);
	});

	_it('does not let tournament locks block independent BTP fetch locks', async () => {
		const events = [];
		let release_tournament;
		const tournament_started = new Promise(resolve => {
			release_tournament = resolve;
		});
		const btp_task = update_queue.locks([
			update_queue.lock_keys.btp('default'),
		], update_queue.named('btp-task', async () => {
			events.push('btp-start');
			const tournament_task = update_queue.locks([
				update_queue.lock_keys.tournament('default'),
			], update_queue.named('nested-tournament-task', async () => {
				events.push('tournament');
				release_tournament();
			}));
			await update_queue.instance().execute(tournament_task);
			events.push('btp-end');
		}));

		const promise = update_queue.instance().execute(btp_task);
		await tournament_started;
		await promise;

		assert.deepStrictEqual(events, ['btp-start', 'tournament', 'btp-end']);
	});

	_it('does not block score finish updates behind BTP fetch locks', () => {
		const locks = update_queue.lock_keys.score_update('default', {
			match_id: 'match-1',
			court_id: 'court-1',
		}, { finish: true });

		assert(locks.includes(update_queue.lock_keys.match('default', 'match-1')));
		assert(locks.includes(update_queue.lock_keys.court('default', 'court-1')));
		assert(!locks.includes(update_queue.lock_keys.btp('default')));
	});

	_it('lets points on an unrelated court finish during cleanup while protecting the finishing court and allocation', async () => {
		const queue = new ResourceLockQueue(), keys = update_queue.lock_keys, events = [];
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const finish_locks = keys.score_update('default', { match_id: 'finishing', court_id: 'one' }, { finish: true });
		const finishing = queue.execute(() => gate, { locks: finish_locks });
		const same = queue.execute(() => events.push('same'), { locks: keys.score_update('default', { match_id: 'same', court_id: 'one' }) });
		const other = queue.execute(() => events.push('other'), { locks: keys.score_update('default', { match_id: 'other', court_id: 'two' }) });
		const allocation = queue.execute(() => events.push('allocation'), { locks: [keys.courts('default'), keys.auto_call('default')] });
		try {
			await other;
			assert.deepStrictEqual(events, ['other']);
		} finally { release(); await Promise.all([finishing, same, allocation]); }
		assert.deepStrictEqual(events, ['other', 'same', 'allocation']);
		assert(keys.score_update('default', { match_id: 'unknown-court' }, { finish: true }).includes(keys.courts('default')));
	});
});

_describe('resource lock scheduler', () => {
	_it('correlates a slow score wait with the blocking task and the actual conflicting resources', async () => {
		const queue = new ResourceLockQueue(), warnings = [], warn = console.warn;
		const previous = process.env.BTS_UPDATE_QUEUE_SLOW_TASK_MS;
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		process.env.BTS_UPDATE_QUEUE_SLOW_TASK_MS = '1';
		console.warn = line => warnings.push(line);
		const first = queue.execute(update_queue.named('sync-commit', () => gate), {
			locks: ['match:default:1', 'match:default:2', 'court:default:1'],
		});
		const score = update_queue.named('score', () => 'done');
		score._queue_trace_id = 'test-trace';
		const second = queue.execute(score, { locks: ['match:default:1', 'court:default:2'], key: 'test-score' });
		try {
			await queue.execute(() => {}, { locks: ['court:other:1'] });
			await sleep(5);
			release(); await first; await second;
			const rows = warnings.map(line => JSON.parse(line.slice(line.indexOf('{'))));
			const blocked = rows.find(row => row.trace_id === 'test-trace');
			assert(blocked.observed_lock_conflict);
			assert.strictEqual(blocked.blocked_by[0].id, rows.find(row => row.task === 'sync-commit').id);
			assert.deepStrictEqual(blocked.blocked_by[0].conflicting_locks, ['match:default:1']);
			assert.strictEqual(blocked.blocked_by[0].state, 'active');
			assert(blocked.enqueued_ts <= blocked.start_ts && blocked.start_ts <= blocked.ts);
			assert(blocked.blocked_by[0].start_ts <= blocked.blocked_by[0].observed_ts);
		} finally {
			release(); await Promise.all([first, second]); console.warn = warn;
			if (previous === undefined) delete process.env.BTS_UPDATE_QUEUE_SLOW_TASK_MS;
			else process.env.BTS_UPDATE_QUEUE_SLOW_TASK_MS = previous;
		}
	});

	_it('keeps conflicting tasks in order while an independent court progresses', async () => {
		const queue = new ResourceLockQueue();
		const events = [];
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const first = queue.execute(async () => {
			events.push('first-start');
			await gate;
			events.push('first-end');
		}, { locks: ['court:default:1'] });
		const second = queue.execute(() => { events.push('second'); }, { locks: ['courts:default'] });
		const third = queue.execute(() => { events.push('third'); }, { locks: ['court:default:2'] });
		try {
			await queue.execute(() => { events.push('independent'); }, { locks: ['court:other:1'] });
			assert.deepStrictEqual(events, ['first-start', 'independent']);
			assert.deepStrictEqual(queue.stats().pending_tasks[1].blocked_by[0].state, 'pending');
		} finally {
			release();
			await Promise.all([first, second, third]);
		}
		assert.deepStrictEqual(events, ['first-start', 'independent', 'first-end', 'second', 'third']);
	});

	_it('releases locks after failure and retains the reason a task waited', async () => {
		const queue = new ResourceLockQueue();
		let release;
		const gate = new Promise(resolve => { release = resolve; });
		const expected = new Error('task failed');
		const first = queue.execute(async () => {
			await gate;
			throw expected;
		}, { locks: ['match:default:1'] });
		const rejected = assert.rejects(first, err => err === expected);
		const second = queue.execute(() => 'done', { locks: ['match:default:1'] });
		await queue.execute(() => {}, { locks: ['match:other:1'] });
		release();
		await rejected;
		assert.strictEqual(await second, 'done');
		const recent = queue.recent_tasks[queue.recent_tasks.length - 1];
		assert.strictEqual(recent.wait_blocked_by[0].state, 'active');
		assert.deepStrictEqual(recent.wait_blocked_by[0].locks, ['match:default:1']);
		assert.strictEqual(queue.stats().failed_count, 1);
		assert.strictEqual(queue.stats().active, false);
	});
});
