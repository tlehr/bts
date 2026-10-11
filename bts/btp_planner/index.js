'use strict';

const path = require('path');
const WorkerClient = require('../offload/client');
const profile = require('../offload/profile');
const { COLLECTIONS } = require('./staging');
const client = new WorkerClient('sync_plan_worker', path.join(__dirname, 'worker.js'));
let next_session = 0;

function delta(before, previous) {
	let upserts = 0, removed = 0;
	const collections = Object.fromEntries(COLLECTIONS.map(collection => {
		const old = new Map((previous?.[collection] || []).map(doc => [doc._id, doc]));
		const changes = [];
		for (const doc of before[collection]) {
			if (old.get(doc._id) !== doc) changes.push(doc);
			old.delete(doc._id);
		}
		upserts += changes.length; removed += old.size;
		return [collection, { upserts: changes, removed: [...old.keys()] }];
	}));
	return { collections, upserts, removed };
}

async function plan(cache, before, app, tkey, response_json, options) {
	if (!cache.worker_session) cache.worker_session = ++next_session;
	const fresh = !cache.worker_source || cache.worker_generation !== client.generation;
	const changes = delta(before, fresh ? null : cache.worker_source);
	const payload = { session: cache.worker_session, base_revision: cache.worker_revision || 0,
		operation: options.worker_operation, tkey, response_json,
		patch_return: profile.enabled('sync_plan_patch_return'),
		clock: require('./clock').snapshot(app.clock),
		options: { expected_reset_ts: options.expected_reset_ts },
		timing_enabled: profile.timing_enabled(),
		trace_enabled: require('../performance/traces').enabled(),
		...(fresh ? { seed: before } : { delta: changes.collections }) };
	const context = { tournament_key: tkey, planner_operation: options.worker_operation,
		session: cache.worker_session, seed: fresh, input_upserts: changes.upserts, input_removed: changes.removed,
		return_format: payload.patch_return ? 'patches' : 'documents' };
	let result = await client.run(payload, context);
	if (result.needs_seed) result = await client.run({ ...payload, seed: before, delta: undefined }, { ...context, seed: true, reseed: true });
	if (payload.patch_return) {
		const start = process.hrtime.bigint();
		result.changes = require('./changes').decode(result.changes, before);
		result.phases.restore_ms = require('../offload/timing').ms(process.hrtime.bigint() - start);
	}
	cache.worker_source = before; cache.worker_generation = client.generation; cache.worker_revision = result.revision;
	result.clock = payload.clock;
	return result;
}

module.exports = { plan, delta, client };
