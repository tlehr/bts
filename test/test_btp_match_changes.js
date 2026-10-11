'use strict';

const assert = require('assert');
const changes = require('../bts/btp_match_changes');
const { inputs, documents, add_excluded_records } = require('./btp_match_changes_fixture');
const { refresh } = require('../bts/btp_match_changes/dependencies');

describe('incremental BTP match selection', function() {
	function baseline(count = 3) {
		const db = {};
		const input = inputs(count);
		const docs = documents(input);
		const select = next_docs => changes.select(db, 'default', input, next_docs || docs);
		select().finish();
		return { input, docs, select, db };
	}
	it('selects only a changed player\'s two matches among 519, including parser planning nodes', function() {
		const { input, select } = baseline(519);
		assert.strictEqual(select().matches.length, 0);
		input.state.players.get(1).CheckedIn = [true];
		const delta = select();
		assert.deepStrictEqual(delta.matches.map(bm => bm.ID[0]), [1, 2]);
		assert.strictEqual(delta.timing.skipped_by_delta, 517);
		delta.finish();
		assert.strictEqual(select().matches.length, 0);
	});
	it('excludes 519 extra raw records before local matching but retains them in the graph', function() {
		const input = inputs(519);
		const docs = documents(input);
		const excluded = add_excluded_records(input);
		const id = input.match_id;
		input.match_id = node => {
			assert.ok(node.ID[0] < 100000, 'excluded records must never enter match input indexing');
			return id(node);
		};
		const db = {};
		const first = changes.select(db, 'default', input, docs);
		assert.strictEqual(first.matches.length, 519);
		first.finish();
		const idle = changes.select(db, 'default', input, docs);
		assert.strictEqual(idle.timing.raw_incoming, 1038);
		assert.strictEqual(idle.timing.excluded_from_selection, 519);
		assert.strictEqual(idle.timing.incoming, 519);
		assert.strictEqual(idle.timing.selected, 0);
		assert.strictEqual(idle.timing.skipped_by_delta, 519);
		assert.strictEqual(idle.timing.local_changes, 0);
		input.state.players.get(1).CheckedIn = [true];
		assert.deepStrictEqual(changes.select(db, 'default', input, docs).matches.map(bm => bm.ID[0]), [1, 2]);
		// Excluded node removal must invalidate graph work rather than disappear
		// unnoticed merely because it has no local match.
		const work = { hidden_candidates: excluded };
		idle.remember_dependencies(work); idle.finish();
		input.state.matches.pop();
		input.state.planning_nodes.delete('10_' + excluded.at(-1).PlanningID[0]);
		assert.strictEqual(changes.select(db, 'default', input, docs).cached_dependencies, undefined);
	});
	it('observes profiles and topology of excluded raw sources through their consumers', function() {
		for (const reverse of [false, true]) {
			const { input, docs, select } = baseline();
			const source = input.state.planning_nodes.get('10_5');
			source.ID = [700];
			if (reverse) { source.IsMatch = [true]; source.ReverseHomeAway = [true]; }
			input.state.matches.push(source);
			select().finish();
			const idle = select();
			assert.strictEqual(idle.matches.length, 0);
			assert.strictEqual(idle.timing.excluded_from_selection, 1);
			source.bts_winners = [{ ...source.bts_winners[0], CheckedIn: [true] }];
			assert.deepStrictEqual(select().matches.map(bm => bm.ID[0]), [3]);
			select().finish();
			const cached = select();
			cached.remember_dependencies({ hidden_candidates: [source] }); cached.finish();
			source.EntryID = [999];
			const edited = select();
			assert.strictEqual(edited.cached_dependencies, undefined);
			assert.strictEqual(edited.matches.length, docs.length);
		}
	});
	it('rechecks excluded nodes that become integratable without dropping cached hidden dependencies', function() {
		for (const reverse of [false, true]) {
			const { input, select } = baseline();
			const node = { ...input.state.matches[0], ID: [900], PlanningID: [700], IsMatch: [reverse],
				...(reverse ? { ReverseHomeAway: [true] } : {}) };
			input.state.matches.push(node);
			input.state.planning_nodes.set('10_700', node);
			const first = select();
			first.remember_dependencies({ hidden_candidates: [node] }); first.finish();
			assert.strictEqual(select().matches.length, 0);
			node.IsMatch = [true]; delete node.ReverseHomeAway;
			const delta = select();
			assert.strictEqual(delta.cached_dependencies, undefined);
			assert.deepStrictEqual(delta.matches.map(bm => bm.ID[0]), [1, 2, 3, 900]);
		}
	});
	it('detects nested player entry Maps and profile edits', function() {
		const { input, select } = baseline();
		input.state.players.get(1).entries.set(10, 'withdrawn');
		assert.deepStrictEqual(select().matches.map(bm => bm.ID[0]), [1, 2]);
	});
	it('selects only one match for its per-match check-in bits among 519', function() {
		const { input, select } = baseline(519);
		input.state.matches[0].Status = 5;
		const delta = select();
		assert.deepStrictEqual(delta.matches.map(bm => bm.ID[0]), [1]);
		assert.strictEqual(delta.timing.skipped_by_delta, 518);
	});
	it('ignores live points and history but selects a local check-in', function() {
		const { docs, select } = baseline();
		const point = { ...docs[0], network_score: [[5, 4]], presses: [{ score: [5, 4] }],
			duration_ms: 1000, network_team1_serving: false, _btp_sync_signature: 'updated-signature' };
		assert.strictEqual(select([point, ...docs.slice(1)]).matches.length, 0);
		point.setup = JSON.parse(JSON.stringify(point.setup));
		point.setup.teams[0].players[0].checked_in = true;
		// Stored revisions are immutable: the check-in is a replacement document.
		assert.deepStrictEqual(select([{ ...point }, ...docs.slice(1)]).matches.map(bm => bm.ID[0]), [1]);
	});
	it('keeps pending result confirmation eligible even without another edit', function() {
		const { docs, select } = baseline();
		const pending = [{ ...docs[0], btp_needsync: true }, ...docs.slice(1)];
		select(pending).finish();
		assert.deepStrictEqual(select(pending).matches.map(bm => bm.ID[0]), [1]);
	});
	it('revisits the draw for remote/local results, changed opponents and removed dependencies', function() {
		for (const edit of ['remote_result', 'local_result', 'opponents', 'removal']) {
			const { input, docs, select } = baseline();
			let current = docs;
			if (edit === 'remote_result') input.state.matches[0].Winner = [2];
			if (edit === 'local_result') current = [{ ...docs[0], team1_won: false }, ...docs.slice(1)];
			if (edit === 'opponents') input.state.matches[0].bts_players[0] = [{ ID: [999] }];
			if (edit === 'removal') current = docs.slice(1);
			assert.strictEqual(select(current).matches.length, 3, edit);
		}
	});
	it('detects hidden graph changes and selects an immediate consumer of a hidden player profile', function() {
		const { input, select } = baseline();
		const entry = input.state.planning_nodes.get('10_5');
		entry.bts_winners = [{ ...entry.bts_winners[0], Lastname: ['Changed hidden source'] }];
		assert.deepStrictEqual(select().matches.map(bm => bm.ID[0]), [3]);
		entry.WinnerTo = [10000];
		assert.strictEqual(select().matches.length, 3);
	});
	it('selects changed court occupancy and official assignment', function() {
		const { input, select } = baseline();
		input.on_court.add(2);
		assert.deepStrictEqual(select().matches.map(bm => bm.ID[0]), [2]);
		select().finish();
		input.state.matches[2].Official1ID = [4];
		select().finish();
		input.officials.set('4', { _id: 'umpire', btp_id: 4, name: 'Changed', checked_in: true });
		assert.deepStrictEqual(select().matches.map(bm => bm.ID[0]), [3]);
	});
	it('revisits all matches for tournament reset, scoring, warmup and club configuration', function() {
		for (const edit of ['reset', 'scoring', 'warmup', 'club']) {
			const { input, select } = baseline();
			if (edit === 'reset') input.tournament.last_reset_ts++;
			if (edit === 'scoring') input.scoring_formats.set(1, { score: 15 });
			if (edit === 'warmup') input.tournament.warmup = 'ready';
			if (edit === 'club') input.state.clubs.get(1).Name = ['Renamed'];
			assert.strictEqual(select().matches.length, 3, edit);
		}
	});
	it('discards failed baselines and keeps edits after planning visible on retries', function() {
		const { input, select, docs } = baseline();
		input.state.players.get(1).CheckedIn = [true];
		const plan = select();
		plan.finish();
		const concurrent = { ...docs[2], forward_loser: true };
		assert.ok(select([...docs.slice(0, 2), concurrent]).matches.includes(input.state.matches[2]));
		select().finish(new Error('write failed'));
		assert.strictEqual(select().matches.length, 3);
	});
	it('keeps result invalidation inside the affected draw', function() {
		const input = inputs();
		input.state.draws.set(11, { ...input.state.draws.get(10), ID: [11], Name: ['Other draw'] });
		for (const planning of [5, 6, 10002]) input.state.planning_nodes.get('10_' + planning).DrawID = [11];
		const docs = documents(input);
		docs[2].btp_match_ids[0].draw = 11;
		const db = {};
		changes.select(db, 'default', input, docs).finish();
		input.state.matches[0].Winner = [1];
		assert.deepStrictEqual(changes.select(db, 'default', input, docs).matches.map(bm => bm.ID[0]), [1, 2]);
	});
	it('resolves planning source keys with mixed numeric/string IDs', function() {
		const input = inputs();
		const source = input.state.planning_nodes.get('10_5');
		source.DrawID = ['10'];
		source.PlanningID = ['5'];
		const docs = documents(input);
		const db = {};
		changes.select(db, 'default', input, docs).finish();
		source.bts_winners = [{ ...source.bts_winners[0], CheckedIn: [true] }];
		assert.deepStrictEqual(changes.select(db, 'default', input, docs).matches.map(bm => bm.ID[0]), [3]);
	});
	it('invalidates cached hidden dependencies when there are no visible matches', function() {
		const input = inputs();
		input.state.matches = [];
		const db = {};
		const initial = changes.select(db, 'default', input, []);
		const work = { hidden_candidates: [999] };
		initial.remember_dependencies(work);
		initial.finish();
		assert.strictEqual(changes.select(db, 'default', input, []).cached_dependencies, work);
		input.state.planning_nodes.get('10_10000').Winner = [1];
		assert.strictEqual(changes.select(db, 'default', input, []).cached_dependencies, undefined);
	});
	it('accepts only its own successful nondependency writes as baselines and observes later edits', function() {
		const { docs, select } = baseline();
		const delta = select();
		const written = JSON.parse(JSON.stringify(docs[0]));
		written.setup.teams[0].players[0].checked_in = true;
		delta.remember_local(written);
		delta.finish();
		const current = [written, ...docs.slice(1)];
		assert.strictEqual(select(current).matches.length, 0);
		const concurrent = { ...written, setup: { ...written.setup, preparation_call_deferred: true } };
		assert.deepStrictEqual(select([concurrent, ...docs.slice(1)]).matches.map(bm => bm.ID[0]), [1]);
		const result = { ...written, team1_won: false };
		const finished = select(current);
		finished.remember_local(result);
		finished.finish();
		assert.strictEqual(select([result, ...docs.slice(1)]).matches.length, 3);
	});
	it('invalidates cached hidden candidates when a planning node becomes visible', function() {
		const { input, select } = baseline();
		const hidden = { ...input.state.matches[0], ID: [9], PlanningID: [700] };
		input.state.planning_nodes.set('10_700', hidden);
		const delta = select();
		const work = { hidden_candidates: [hidden] };
		delta.remember_dependencies(work);
		delta.finish();
		assert.strictEqual(select().cached_dependencies, work);
		input.state.matches.push(hidden);
		assert.strictEqual(select().cached_dependencies, undefined);
	});
	it('invalidates topology order rather than reusing predecessor labels from another order', function() {
		const { input, select } = baseline();
		const delta = select();
		delta.remember_dependencies({});
		delta.finish();
		input.state.planning_nodes = new Map([...input.state.planning_nodes].reverse());
		assert.strictEqual(select().cached_dependencies, undefined);
		assert.strictEqual(select().matches.length, 3);
	});
	it('refreshes raw/planning/current references while retaining unchanged topology and labels', function() {
		const input = inputs(1);
		const old = input.state.matches[0];
		const current = { ...old, bts_players: [[{ ID: [1], Lastname: ['New'] }], []] };
		const local = { ...documents(input)[0], network_score: [[8, 6]] };
		local.btp_match_ids[0].nr = 1;
		const state = { ...input.state, matches: [current], planning_nodes: new Map([['10_10000', current]]) };
		const lookup = { raw_match_by_key: new Map([['10_10000', old]]),
			incoming_by_key: new Map(), visible_nodes_by_draw: new Map(), resolved_link_cache: new Map([['key', 'Label']]) };
		const next = refresh(lookup, state, [local]);
		assert.strictEqual(next.raw_match_by_key.get('10_10000'), current);
		assert.strictEqual(next.planning_node_by_key.get('10_10000'), current);
		assert.strictEqual(next.current_match_by_key.get('10_10000'), local);
		assert.strictEqual(next.current_match_by_draw_match_nr.get('10_1'), local);
		assert.strictEqual(next.raw_match_by_draw_match_nr.get('10_1'), current);
		assert.strictEqual(next.incoming_by_key, lookup.incoming_by_key);
		assert.strictEqual(next.resolved_link_cache, lookup.resolved_link_cache);
		assert.strictEqual(lookup.raw_match_by_key.get('10_10000'), old);
	});
});
