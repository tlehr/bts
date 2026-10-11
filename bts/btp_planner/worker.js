'use strict';

const staging = require('./staging');
const sessions = new Map();

function source_state(previous, delta) {
	return Object.fromEntries(staging.COLLECTIONS.map(collection => {
		const docs = new Map((previous?.[collection] || []).map(doc => [doc._id, doc]));
		for (const id of delta[collection].removed) docs.delete(id);
		for (const doc of delta[collection].upserts) docs.set(doc._id, doc);
		return [collection, [...docs.values()].sort((a, b) => String(a._id).localeCompare(String(b._id)))];
	}));
}

require('../offload/worker')(async payload => {
	const traces = require('../performance/traces');
	if (!payload.trace_enabled) return plan_work(payload);
	traces.enable();
	return traces.operation('worker_plan', { type: payload.operation === 'auto_call' ? 'calling' : 'sync' }, async () => {
		const result = await plan_work(payload);
		result.value.diagnostic_phases = traces.capture().record.spans.filter(row => row.kind === 'phase');
		return result;
	});
});

async function plan_work(payload) {
	let session = sessions.get(payload.session);
	if (!payload.seed && (!session || session.revision !== payload.base_revision)) return { value: { needs_seed: true } };
	if (payload.seed) session = { db: staging.memory_db(), revision: 0 };
	sessions.delete(payload.session); sessions.set(payload.session, session);
	while (sessions.size > 32) sessions.delete(sessions.keys().next().value);
	try {
		process.env.BTS_BTP_SYNC_TIMING = payload.timing_enabled ? '1' : '0';
		const before = payload.seed || source_state(session.source_state, payload.delta);
		const start = process.hrtime.bigint();
		const copied_records = await staging.refresh(session.db, before, session.stage_state, session.source_state);
		session.source_state = before;
		const refresh_end = process.hrtime.bigint();
		const app = session.app || (session.app = { db: session.db, wss: { clients: [] }, _btp_serializable_effects: true });
		app._btp_sync_effects = [];
		app.clock = require('./clock').create(payload.clock);
		let result;
		if (payload.operation === 'btp') {
			result = await require('../btp_sync')._integrate_snapshot(app, payload.tkey, JSON.parse(payload.response_json), payload.options);
		} else if (payload.operation === 'auto_call') {
			const rules = require('../match_automation'), select = rules.calculate_call_on_court_selection;
			session.selection_calls = 0;
			rules.calculate_call_on_court_selection = (...args) => { session.selection_calls++; return select(...args); };
			try {
				result = await new Promise((resolve, reject) => require('../match_utils')._plan_auto_call_once(app, payload.tkey,
					error => error ? reject(error) : resolve(true)));
			} finally { rules.calculate_call_on_court_selection = select; }
		} else throw new Error('Unknown planner operation');
		await session.db.wait_for_writes();
		session.stage_state = staging.planning_snapshot(session.db);
		const integration_end = process.hrtime.bigint();
		const changes = await staging.differences(before, session.stage_state, session.db);
		const { ms } = require('../offload/timing');
		const returned_changes = payload.patch_return ? require('./changes').encode(changes)
			: changes.map(({ collection, id, after, update }) => ({ collection, id, after, update }));
		return { value: { result, changes: returned_changes,
			effects: app._btp_sync_effects, revision: ++session.revision, copied_records,
			selection_calls: payload.operation === 'auto_call' ? session.selection_calls : null,
			phases: { refresh_ms: ms(refresh_end - start), integrate_ms: ms(integration_end - refresh_end),
				diff_ms: ms(process.hrtime.bigint() - integration_end) } } };
	} catch (error) { sessions.delete(payload.session); throw error; }
}
