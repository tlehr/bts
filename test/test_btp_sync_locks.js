'use strict';

const assert = require('assert');
const { copy } = require('../bts/btp_sync_effects');
const classify = require('../bts/btp_sync_locks/match_changes');
const resources = require('../bts/btp_sync_locks/resources');
const keys = require('../bts/queue_lock_keys');
const Relations = require('../bts/tournament_model/relations');

function match(id, player = 1, court = 'court') {
	return { _id: id, setup: { state: 'ready', court_id: court,
		teams: [{ players: [{ btp_id: player, name: 'Player', checked_in: false }] }],
		umpire: { _id: 'official', btp_id: 10, name: 'Umpire', checked_in: true },
	} };
}
function scope(old, next, effects = [], indexed = true) {
	const before = { matches: [old, match('related-player', 1, 'other-court'), match('related-court', 2), match('unrelated', 3, 'third')] };
	if (indexed) before.relations = before.matches.reduce((relations, doc) => relations.with_match(doc._id, null, doc), new Relations());
	return resources('test', before, [{ collection: 'matches', id: old._id, before: old, after: next }], effects);
}

describe('BTP sync lock dependencies', function() {
	for (const [label, change] of [
		['group rankings', next => { next.setup.btp_group_rankings = [{ rank: 1, name: 'Player' }]; }],
		['player surname', next => { next.setup.teams[0].players[0].lastname = 'New surname'; }],
		['player profile', next => { next.setup.teams[0].players[0].name = 'New name'; }],
		['official profile', next => { next.setup.umpire.name = 'New umpire name'; }],
		['removed profile field', next => { delete next.setup.teams[0].players[0].name; }],
	]) {
		it(`locks only the changed match for ${label}, retaining allocation locks`, function() {
			const old = match('changed');
			const next = copy(old);
			change(next);
			const plan = scope(old, next);
			assert.deepStrictEqual([...plan.locked_matches], ['changed']);
			assert(!plan.locks.includes(keys.court('test', 'court')));
			for (const domain of ['preparation', 'auto_call', 'umpires', 'tabletoperators']) assert(plan.locks.includes(keys[domain]('test')));
			assert.strictEqual(plan.diagnostics.local_only_changes, 1);
			assert.strictEqual(plan.diagnostics.additional_match_locks, 0);
			assert.deepStrictEqual(plan, scope(old, next, [], false));
		});
	}
	for (const [label, reason, change] of [
		['match order', 'scheduling', next => { next.match_order = 12; }],
		['check-in', 'participants', next => { next.setup.teams[0].players[0].checked_in = true; }],
		['player pause', 'participants', next => { next.setup.teams[0].players[0].last_time_on_court_ts = 123; }],
		['tablet operator association', 'participants', next => { next.setup.teams[0].players[0].state = 'BAY'; }],
		['opponent', 'participants', next => { next.setup.teams[0].players[0].btp_id = 2; }],
		['team order', 'participants', next => { next.setup.teams.unshift({ players: [] }); }],
		['official check-in', 'officials', next => { next.setup.umpire.checked_in = false; }],
		['official identity', 'officials', next => { next.setup.umpire.btp_id = 11; }],
		['official removal', 'officials', next => { delete next.setup.umpire; }],
		['court move', 'court', next => { next.setup.court_id = 'new-court'; }],
		['preparation successor', 'state', next => { next.setup.needs_preparation_successor = true; }],
		['scheduling', 'scheduling', next => { next.setup.scheduled_time_str = '12:30'; }],
		['quarterfinal tablet operator rule', 'scheduling', next => { next.setup.match_name = 'VF'; }],
		['scoring format', 'scoring', next => { next.setup.scoring_format = { numSets: 1 }; }],
		['bye graph', 'links', next => { next.setup.links = { winner: 'next-match' }; }],
		['bye winner', 'result', next => { next.btp_winner = 1; }],
		['finish', 'result', next => { next.team1_won = true; next.end_ts = 123; }],
		['player inventory', 'identity', next => { next.btp_player_ids = [2]; }],
		['new unknown setup field', 'unknown_setup', next => { next.setup.future_dependency = true; }],
		['new unknown player field', 'participants', next => { next.setup.teams[0].players[0].future_dependency = true; }],
	]) {
		it(`retains related matches and courts for ${label}`, function() {
			const old = match('changed');
			const next = copy(old);
			change(next);
			next.setup.btp_group_rankings = [{ rank: 1 }];
			const plan = scope(old, next);
			assert.deepStrictEqual(classify(old, next), [reason]);
			assert(plan.locked_matches.has('related-player'));
			assert(plan.locked_matches.has('related-court'));
			assert(!plan.locked_matches.has('unrelated'));
			assert(plan.locks.includes(keys.court('test', 'court')));
			assert.strictEqual(plan.diagnostics.expansion_reasons[reason], 1);
			assert.deepStrictEqual(plan, scope(old, next, [], false));
		});
	}
	it('honors explicit effects even when a match change only contains metadata', function() {
		const old = match('changed');
		const next = copy(old);
		next.setup.btp_group_rankings = [{ rank: 1 }];
		const plan = scope(old, next, [{ resources: { matches: ['unrelated'], players: [1], courts: ['court'] } }]);
		assert.strictEqual(plan.locked_matches.size, 4);
		assert.strictEqual(plan.diagnostics.direct_match_locks, 1);
		assert.strictEqual(plan.diagnostics.additional_match_locks, 3);
		assert.deepStrictEqual(plan.diagnostics.dependency_matches, { effect: 1, player: 2, court: 2 });
	});
	for (const [label, edit] of [
		['match number', next => { next.setup.match_num = 12; }],
		['match order', next => { next.match_order = 12; }],
	]) {
		it(`protects selection and direct matches without relation or allocation locks for ${label}`, function() {
			const old = match('changed'); delete old.setup.umpire;
			const next = copy(old); edit(next);
			const plan = scope(old, next);
			assert.strictEqual(plan.diagnostics.allocation_scope, 'ordering_only');
			assert(plan.locks.includes(keys.selection('test')));
			assert(plan.locked_matches.has('changed'));
			assert(!plan.locked_matches.has('related-player'));
			assert(!plan.locked_matches.has('related-court'));
			assert(!plan.locked_matches.has('unrelated'));
			assert(!plan.locks.includes(keys.court('test', 'court')));
			assert.strictEqual(plan.diagnostics.additional_match_locks, 0);
			for (const domain of ['preparation', 'auto_call', 'umpires', 'tabletoperators']) assert(!plan.locks.includes(keys[domain]('test')));
			assert.deepStrictEqual(plan, scope(old, next, [], false));
		});
	}
	it('does not narrow mixed ordering, profile, unknown, result or opaque-effect plans', function() {
		for (const edit of [
			next => { next.setup.teams[0].players[0].name = 'Changed'; },
			next => { next.setup.future_dependency = true; },
			next => { next.future_dependency = true; },
			next => { next.team1_won = true; },
			next => { next.setup.scheduled_time_str = '12:30'; },
		]) {
			const old = match('changed'), next = copy(old); next.setup.match_num = 12; edit(next);
			const plan = scope(old, next);
			assert.strictEqual(plan.diagnostics.allocation_scope, 'full');
			for (const domain of ['preparation', 'auto_call', 'umpires', 'tabletoperators']) assert(plan.locks.includes(keys[domain]('test')));
		}
		const old = match('changed'); delete old.setup.umpire;
		const next = copy(old); next.setup.match_num = 12;
		for (const effect of [
			{ resources: { hidden_bye: true } }, { resources: { matches: ['changed'] } },
			{ resources: { notification: { ctype: 'match_edit', value: { _id: 'unrelated' } } } },
			{ resources: { notification: { ctype: 'match_edit', value: { _id: 'changed', all_courts: [] } } } },
		]) assert.strictEqual(scope(old, next, [effect]).diagnostics.allocation_scope, 'full');
		assert.strictEqual(scope(old, next, [{ resources: { notification: { ctype: 'match_edit', value: next } } },
			{ resources: { deferred_job: true } }]).diagnostics.allocation_scope, 'ordering_only');
	});
	it('allows number/signature bookkeeping while preserving BTP identities and notification targets', function() {
		const old = match('changed'); delete old.setup.umpire;
		old.btp_match_ids = [{ id: 1, nr: 1, draw: 2, planning: 3 }];
		const next = copy(old); next.setup.match_num = 12; next.btp_match_ids[0].nr = 12; next._btp_sync_signature = 'new';
		const notification = [{ resources: { notification: { ctype: 'match_edit', value: { match__id: 'changed', match: next } } } }];
		assert.strictEqual(scope(old, next, notification).diagnostics.allocation_scope, 'ordering_only');
		next.btp_match_ids[0].id = 9;
		assert.strictEqual(scope(old, next, notification).diagnostics.allocation_scope, 'full');
	});
	it('retains allocation protection for tablet-operator choices and existing official assignments', function() {
		const old = match('changed'), next = copy(old); next.setup.match_num = 12;
		assert.strictEqual(scope(old, next).diagnostics.allocation_scope, 'ordering_with_allocation');
		delete old.setup.umpire; delete next.setup.umpire;
		const plan = resources('test', { tournaments: [{ tabletoperator_enabled: true }], matches: [old] },
			[{ collection: 'matches', id: old._id, before: old, after: next }], []);
		assert.strictEqual(plan.diagnostics.allocation_scope, 'ordering_with_allocation');
		for (const domain of ['preparation', 'auto_call', 'umpires', 'tabletoperators']) assert(plan.locks.includes(keys[domain]('test')));
	});
	it('retains inventories on insertion and deletion and does not compare dates by reference', function() {
		const old = match('changed');
		assert.deepStrictEqual(classify(undefined, old), ['lifecycle']);
		assert.deepStrictEqual(classify(old, undefined), ['lifecycle']);
		assert(scope(old, undefined).locked_matches.has('related-player'));
		old.end_ts = new Date(123);
		const next = copy(old);
		next.setup.btp_group_rankings = [{ rank: 1 }];
		assert.deepStrictEqual(classify(old, next), []);
		next.end_ts = new Date(456);
		assert.deepStrictEqual(classify(old, next), ['result']);
	});
});
