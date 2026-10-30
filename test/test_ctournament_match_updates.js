'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const utils = require('../static/bup/dev/js/utils');
const { cmp_scheduled_match_order } = require('../bts/match_automation');

function harness() {
	const matches = [1, 2, 3].map(id => ({ _id: 'm' + id, match_order: id + 1, presses: [], score_status: 'normal',
		setup: { state: 'scheduled', scheduled_date: '2026-10-23', scheduled_time_str: '10:30', match_num: id } }));
	const calls = { reorder: [], update: [], score: [], players: [], playerIds: [], metadata: [], demand: [] }, routes = [];
	const context = {
		curt: { key: 'default', matches }, utils, console,
		setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}, requestAnimationFrame() {},
		window: { addEventListener() {} }, document: { querySelector() { return null; }, querySelectorAll() { return []; } },
		crouting: { register(regex, load, handler) { routes.push({ regex, handler }); } },
		change: { default_handler(render, handlers) { return handlers; } },
		uiu: { qsEach() {} },
		cerror: { silent(message) { throw new Error(message); } },
		send(_message, callback) { callback(null, { selections: [] }); },
		cmatch: {
			calc_section(match) { return match.setup.state === 'finished' ? 'finished' : 'unassigned'; },
			cmp_match_order: cmp_scheduled_match_order,
			reorder_match_row(...args) { calls.reorder.push(args); },
			update_match(...args) { calls.update.push(args); },
			update_match_score(...args) { calls.score.push(args); },
			update_match_metadata(match, fields) { calls.metadata.push([match, Array.from(fields)]); },
			update_preparation_demand_court_markers(match) { calls.demand.push(match); },
			update_player_status_indicators_for_match_players(...args) { calls.players.push(args); },
			update_player_status_indicators_for_player_ids(ids) { calls.playerIds.push(Array.from(ids)); },
			refresh_unassigned_preparation_context() {},
		},
	};
	vm.createContext(context);
	vm.runInContext(fs.readFileSync(require.resolve('../static/js/ctournament'), 'utf8'), context);
	return { context, matches, calls, routes, update: context.ctournament.update_match };
}

describe('live tournament match ordering', function() {
	it('keeps device acknowledgement traffic out of document searches while the device table is unmounted', function() {
		const h = harness();
		h.context.document.querySelectorAll = () => assert.fail('No device table lookup is needed without a mounted device table');
		h.context.document.querySelector = () => assert.fail('No device table lookup is needed without a mounted device table');
		for (let index = 0; index < 1000; index++) h.context.ctournament.update_display({client_id:'one'}, {tablets:false});
	});
	it('applies the successor flag with the point, including false and a cleared timestamp', function() {
		const h = harness(), match = h.matches[0], handler = h.routes.find(route => route.regex.test('t/default/')).handler;
		for (const needed of [true, false]) {
			handler.score({ val: { match_id: match._id, network_score: [[21, 18], [10, 7]], presses: [],
				needs_preparation_successor: needed, needs_preparation_successor_ts: needed ? 12345 : null } });
			assert.strictEqual(match.setup.needs_preparation_successor, needed);
			assert.strictEqual(match.setup.needs_preparation_successor_ts, needed ? 12345 : null);
		}
		assert.strictEqual(h.calls.score.length, 2);
		assert.strictEqual(h.calls.update.length, 0);
		handler.score({ val: { match_id: match._id, network_score: [[21, 18], [9, 7]], presses: [] } });
		assert(!('needs_preparation_successor' in match.setup), 'older score messages must not retain an out-of-date flag');
	});

	it('patches a successor-only snapshot without rebuilding the row or its score', function() {
		const h = harness(), match = h.matches[0], incoming = structuredClone(match);
		incoming.setup.needs_preparation_successor = true;
		incoming.setup.needs_preparation_successor_ts = 12345;
		h.update({ val: { match__id: match._id, match: incoming } });
		assert.strictEqual(h.calls.update.length, 0);
		assert.strictEqual(h.calls.score.length, 0);
		assert.strictEqual(h.calls.players.length, 0);
		assert.deepStrictEqual(h.calls.demand, [match]);
	});

    it('copies changed or cleared durations through the incremental update without rebuilding a row', function() {
        const h = harness(), match = h.matches[0], incoming = structuredClone(match);
        incoming.duration_ms = 1800000;
        h.update({ val: { match__id: match._id, match: incoming } });
        assert.strictEqual(match.duration_ms, 1800000);
        assert.deepStrictEqual(h.calls.score, [[match]]);
        assert.strictEqual(h.calls.update.length, 0);
        assert.strictEqual(h.calls.reorder.length, 0);
        incoming.duration_ms = null;
        h.update({ val: { match__id: match._id, match: incoming } });
        assert.strictEqual(match.duration_ms, null);
        assert.strictEqual(h.calls.score.length, 2);
        assert.strictEqual(h.calls.update.length, 0);
    });

    it('patches a score/history-only full snapshot without refreshing players or rebuilding its row', function() {
        const h = harness(), match = h.matches[0], incoming = structuredClone(match);
        incoming.network_score = [[7, 8]];
        incoming.presses = [{ type: 'score', timestamp: 1234 }];
        h.update({ val: { match__id: match._id, match: incoming } });
        assert.deepStrictEqual(h.calls.score, [[match]]);
        assert.strictEqual(h.calls.update.length, 0);
        assert.strictEqual(h.calls.players.length, 0);
        h.update({ val: { match__id: match._id, match: structuredClone(incoming) } });
        assert.strictEqual(h.calls.score.length, 1, 'an identical follow-up is a no-op');
    });

    it('keeps the existing setup and player nodes untouched for identical player status messages', function() {
        const h = harness(), match = h.matches[0], setup = match.setup;
        const handler = h.routes.find(route => route.regex.test('t/default/')).handler;
        handler.update_player_status({ val: { match__id: match._id, setup: structuredClone(setup) } });
        assert.strictEqual(match.setup, setup);
        assert.strictEqual(h.calls.players.length, 0);
        const changed = structuredClone(setup);
        changed.teams = [{ players: [{ btp_id: 1, checked_in: true }] }];
        handler.update_player_status({ val: { match__id: match._id, setup: changed } });
        assert.strictEqual(match.setup, changed);
        assert.strictEqual(h.calls.players.length, 1);
        assert.strictEqual(h.calls.players[0][0], match);
        assert.strictEqual(h.calls.players[0][1].previous_setup, setup);
        handler.update_player_status({ val: { match__id: match._id, setup: structuredClone(changed) } });
        assert.strictEqual(h.calls.players.length, 1);
    });

	it('refreshes only previous and current participants when queue entries change', function() {
		const h = harness(), handler = h.routes.find(route => route.regex.test('t/default/')).handler;
		h.context.curt.tabletoperators = [{ _id: 'queue', court: null, tabletoperator: [{ btp_id: 1 }, { btp_id: 2 }] }];
		handler.tabletoperator_add({ val: { tabletoperator: { _id: 'queue', court: null, tabletoperator: [{ btp_id: 2 }] } } });
		handler.tabletoperator_removed({ val: { tabletoperator: { _id: 'queue', court: 'court_1', tabletoperator: [{ btp_id: 2 }] } } });
		assert.deepStrictEqual(h.calls.playerIds, [['1', '2'], ['2']]);
		assert.strictEqual(h.calls.update.length, 0);
	});

	it('applies live pronunciation additions in the same order as after reloading and refreshes readiness', function() {
		const h = harness(), changes = [];
		h.context.curt.normalizations = [{ _id: 'j-specific', origin: 'Nguyen', replace: 'Nuehjen', language: 'de-DE' }];
		h.context.btsSpeechReadiness = { changed: () => changes.push(true) };
		h.context.ctournament.add_normalization({ val: { normalization: { _id: 'Z-general', origin: 'Ng', replace: 'Nick', language: 'de-DE' } } });
		assert.deepStrictEqual(h.context.curt.normalizations.map(n => n._id), ['Z-general', 'j-specific']);
		const texts = require('../static/js/announcement_text')({ tournament: h.context.curt,
			translate: key => key === 'announcements:lang' ? 'de-DE' : key });
		assert.strictEqual(texts.normalizeNames('Nguyen'), 'Nickuyen');
		h.context.ctournament.remove_normalization({ val: { normalization_id: 'Z-general' } });
		assert.strictEqual(texts.normalizeNames('Nguyen'), 'Nuehjen');
		assert.strictEqual(changes.length, 2);
		assert.strictEqual(h.calls.update.length, 0, 'pronunciation updates need no match-table rebuild');
	});

	it('applies a changed BTP order by moving only the affected row', function() {
		const h = harness(), target = h.matches[2];
		const incoming = { ...structuredClone(target), match_order: 1, _btp_sync_signature: 'new' };
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(target.match_order, 1);
		assert.deepStrictEqual(h.matches.map(match => match._id), ['m3', 'm1', 'm2']);
		assert.deepStrictEqual(h.calls.reorder, [[target, 'unassigned']]);
		assert.strictEqual(h.calls.update.length, 0);
	});

	it('patches the planned time and repositions the existing row without updating players or scores', function() {
		const h = harness(), target = h.matches[2];
		const incoming = structuredClone(target);
		incoming.match_order = 7;
		incoming.setup.scheduled_time_str = '09:00';
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(target.setup.scheduled_time_str, '09:00');
		assert.deepStrictEqual(h.matches.map(match => match._id), ['m3', 'm1', 'm2']);
		assert.deepStrictEqual(h.calls.metadata, [[target, ['scheduled_time_str']]]);
		assert.deepStrictEqual(h.calls.reorder, [[target, 'unassigned']]);
		assert.strictEqual(h.calls.update.length, 0);
		assert.strictEqual(h.calls.score.length, 0);
		assert.strictEqual(h.calls.players.length, 0);
	});

	it('does not sort the match list again for unrelated metadata changes', function() {
		const h = harness(), target = h.matches[1];
		h.matches.sort = () => { throw new Error('unnecessary list sort'); };
		const incoming = structuredClone(target);
		incoming.setup.event_name = 'Changed event';
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(h.calls.reorder.length, 0);
		assert.strictEqual(h.calls.update.length, 0);
		assert.deepStrictEqual(h.calls.metadata, [[target, ['event_name']]]);
		assert.strictEqual(h.calls.score.length, 0);
	});

	it('changes only the preparation clock when its start timestamp changes', function() {
		const h = harness(), target = h.matches[0];
		target.setup.state = 'preparation';
		target.setup.preparation_call_timestamp = 10000;
		const incoming = structuredClone(target);
		incoming.setup.preparation_call_timestamp = 20000;
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(target.setup.preparation_call_timestamp, 20000);
		assert.deepStrictEqual(h.calls.score, [[target]]);
		assert.strictEqual(h.calls.metadata.length, 0);
		assert.strictEqual(h.calls.update.length, 0);
		assert.strictEqual(h.calls.players.length, 0);
	});

	it('patches changed metadata and scores together without reconstructing the row', function() {
		const h = harness(), target = h.matches[0], incoming = structuredClone(target);
		incoming.setup.match_name = 'Finale';
		incoming.network_score = [[12, 15]];
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.deepStrictEqual(h.calls.metadata, [[target, ['match_name']]]);
		assert.deepStrictEqual(h.calls.score, [[target]]);
		assert.strictEqual(h.calls.update.length, 0);
		assert.strictEqual(h.calls.players.length, 0);
	});

	it('retains the structural update for unknown setup fields or changed pairings', function() {
		for (const update of [setup => { setup.new_unknown_dependency = true; }, setup => { setup.teams = [{ players: [{ btp_id: 123, name: 'Neue Person' }] }]; }]) {
			const h = harness(), target = h.matches[0], incoming = structuredClone(target);
			update(incoming.setup);
			h.update({ val: { match__id: target._id, match: incoming } });
			assert.deepStrictEqual(h.calls.update, [[target, 'unassigned', 'unassigned']]);
			assert.strictEqual(h.calls.metadata.length, 0);
		}
	});

	it('does not touch the DOM for an update containing only unchanged data and bookkeeping', function() {
		const h = harness(), target = h.matches[1];
		h.matches.sort = () => { throw new Error('unnecessary list sort'); };
		const incoming = { ...structuredClone(target), _btp_sync_signature: 'new' };
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(h.calls.reorder.length, 0);
		assert.strictEqual(h.calls.update.length, 0);
	});

	it('also updates the order used by the public upcoming view', function() {
		const h = harness(), target = h.matches[0];
		const incoming = { ...structuredClone(target), match_order: 0 };
		const route = h.routes.find(route => route.regex.test('t/default/upcoming'));
		route.handler.match_edit({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(target.match_order, 0);
		assert.deepStrictEqual(h.matches.map(match => match._id), ['m2', 'm3', 'm1']);
	});
});
