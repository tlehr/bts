'use strict';

const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execute = promisify(execFile);
const { launch } = require('./process');
const { response } = require('./fixture');
const BASELINE = 'cf73f0a731dd26aac4fb360a71b5d2b165deef0f';
const PHASES = ['idle', 'slow-fetch', 'changed-sync', 'unchanged-sync'];

function summary(rows) {
	function stats(values) {
		values.sort((a, b) => a - b);
		const quantile = p => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
		return { count: values.length, median: quantile(0.5), p95: quantile(0.95), max: values.at(-1) ?? null };
	}
	return Object.fromEntries(['call_ms', 'free_ms', 'call_queue_wait_ms', 'call_dispatch_ms', 'call_queue_admission_ms', 'event_loop_max_ms', 'sync_ms', 'queue_high_watermark']
		.map(metric => [metric, stats(rows.map(row => row[metric]).filter(Number.isFinite))]));
}

async function run(options, { signal, log = console.log } = {}) {
	const refs = await Promise.all(options.refs.map(async ref => ({ ref,
		commit: (await execute('git', ['-C', options.bts_dir, 'rev-parse', '--verify', ref + '^{commit}'])).stdout.trim(),
	})));
	const plan = { refs, matches: options.matches, phases: options.phases, samples: options.samples, delay_ms: options.delay_ms };
	if (options.dry_run) return plan;
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bts-queue-responsiveness-'));
	log('Queue comparison reports: ' + directory);
	const result = { ...plan, directory, status: 'running', started_at: new Date().toISOString(),
		node_version: process.version, cpu: os.cpus()[0]?.model, rows: [],
		dependency_lock_sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(options.bts_dir, 'package-lock.json'))).digest('hex'),
		fixture_sha256: crypto.createHash('sha256').update(JSON.stringify(response(options.matches))).digest('hex'),
		limitations: [
			'Deterministic synthetic BTP tournament, no original tournament data. Durable NeDB files and unmodified archived server modules.',
			'BTP send is replaced by a controlled response callback. Tests actual fetch scheduling and real BTP parsing/integration, not TCP or XML decoding.',
			'Actual admin handlers, websocket serialization/outbox and reception in a separate process. No browser speech/rendering or audible-start measurement.',
			'Changed sync modifies match numbers for every match except the probed match; real shared allocation/official resources may still conflict.',
			'Observer wrappers measure scheduler admission/execution and database callbacks; they preserve datastore methods and batch-write certificates.',
			'Integration probes are triggered at the first live match writer start; dispatch after integration completion is explicitly reported.',
			'Queue samples every 20 ms can miss shorter peaks. Event-loop histogram measures scheduling delay, not exclusively CPU execution.',
			'Bootstrap is unmeasured, and the normal server automation timers are not started; real post-fetch follow-up tasks are retained.',
		],
	};
	// Preserve the exact observer source as well as immutable server revisions.
	const source_dir = path.join(directory, 'harness-source'); await fs.mkdir(source_dir);
	result.harness_sha256 = {};
	for (const name of ['fixture.js', 'instrument.js', 'process.js', 'receiver.js', 'run.js', 'server.js', '../queue_responsiveness_benchmark.js']) {
		const source = await fs.readFile(path.join(__dirname, name));
		result.harness_sha256[name] = crypto.createHash('sha256').update(source).digest('hex');
		await fs.writeFile(path.join(source_dir, path.basename(name)), source);
	}
	const save = () => fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(result, null, 2) + '\n');
	await save();
	try {
		for (const [index, ref] of refs.entries()) {
			ref.root = path.join(directory, 'server-' + index); await fs.mkdir(ref.root);
			const archive = ref.root + '.tar';
			await execute('git', ['-C', options.bts_dir, 'archive', '--format=tar', '--output', archive, ref.commit]);
			await execute('tar', ['-xf', archive, '-C', ref.root]); await fs.unlink(archive);
			await fs.symlink(path.join(options.bts_dir, 'node_modules'), path.join(ref.root, 'node_modules'));
			await fs.symlink(path.join(options.bts_dir, 'static/bup/dev'), path.join(ref.root, 'static/bup/dev'));
		}
		for (const phase of options.phases) for (let sample = 0; sample < options.samples; sample++) {
			// Alternate reference order to reduce systematic cache/time effects.
			for (const ref of sample % 2 ? refs.slice().reverse() : refs) {
				if (signal?.aborted) throw new Error('Queue comparison interrupted');
				const name = ref.commit.slice(0, 7) + '-' + phase + '-' + sample;
				const run_dir = path.join(directory, name); await fs.mkdir(run_dir);
				await fs.rm(path.join(ref.root, 'data'), { recursive: true, force: true });
				let server, receiver;
				try {
					log(name + ': starting');
					server = launch(path.join(__dirname, 'server.js'), { root: ref.root, directory: run_dir, count: options.matches, phase, delay_ms: options.delay_ms }, run_dir, 'server', signal);
					const setup = await server.wait('ready');
					receiver = launch(path.join(__dirname, 'receiver.js'), setup, run_dir, 'receiver', signal);
					await receiver.wait('ready');
					server.send({ type: 'start' });
					const probe = await server.wait('probe'); receiver.send({ type: 'probe' });
					const reception = (await receiver.wait('done')).result;
					server.send({ type: 'finish' }); const done = await server.wait('done');
					const measured = JSON.parse(await fs.readFile(done.result, 'utf8'));
					const task = measured.tasks.find(t => t.owner === 'match_call_on_court');
					const elapsed = (end, start) => end && start ? Number(BigInt(end) - BigInt(start)) / 1e6 : null;
					const row = { commit: ref.commit, phase, sample, reception, probe_reason: probe.reason,
						call_ms: reception.call.latency_ms, free_ms: reception.free.latency_ms,
						call_queue_wait_ms: task?.wait_ms ?? null,
						call_observed_blockers: task?.observed_blockers ?? null,
						call_dispatch_ms: elapsed(measured.dispatch.call, reception.call.sent_ns),
						call_queue_admission_ms: elapsed(task?.enqueued_ns, measured.dispatch.call),
						event_loop_max_ms: measured.event_loop.max_ms, sync_ms: elapsed(measured.sync_end_ns, measured.request_ns),
						queue_high_watermark: measured.high_watermark, changed_matches: measured.changed_matches, drained: measured.drained,
						offload_features: measured.offload_features,
						probe_sent_before_sync_end: measured.sync_end_ns ? BigInt(reception.call.sent_ns) < BigInt(measured.sync_end_ns) : null,
						call_enqueued_before_sync_end: measured.sync_end_ns && task?.enqueued_ns ? BigInt(task.enqueued_ns) < BigInt(measured.sync_end_ns) : null,
						diagnostics: done.result,
					};
					result.rows.push(row); await save();
					log(name + ': call ' + row.call_ms.toFixed(1) + ' ms, free ' + row.free_ms.toFixed(1) + ' ms, queue wait ' + row.call_queue_wait_ms?.toFixed(1) + ' ms');
				} finally { await receiver?.stop(); await server?.stop(); }
			}
		}
		result.status = 'completed';
		result.summary = Object.fromEntries(refs.map(ref => [ref.commit, Object.fromEntries(options.phases.map(phase => [phase,
			summary(result.rows.filter(row => row.commit === ref.commit && row.phase === phase)),
		]))]));
		return result;
	} catch (error) { result.status = 'error'; result.error = error.message; throw error; }
	finally { result.finished_at = new Date().toISOString(); await save(); }
}

module.exports = { run, summary, BASELINE, PHASES };
