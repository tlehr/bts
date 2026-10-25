'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const utils = require('../static/bup/dev/js/utils');
const { cmp_scheduled_match_order } = require('../bts/match_automation');

function harness() {
	const matches = [1, 2, 3].map(id => ({ _id: 'm' + id, match_order: id + 1, presses: [], score_status: 'normal',
		setup: { state: 'scheduled', scheduled_date: '2026-10-23', scheduled_time_str: '10:30', match_num: id } }));
	const calls = { reorder: [], update: [] }, routes = [];
	const context = {
		curt: { key: 'default', matches }, utils, console,
		setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {}, requestAnimationFrame() {},
		window: { addEventListener() {} }, document: { querySelector() { return null; }, querySelectorAll() { return []; } },
		crouting: { register(regex, load, handler) { routes.push({ regex, handler }); } },
		change: { default_handler(render, handlers) { return handlers; } },
		uiu: { qsEach() {} },
		cerror: { silent(message) { throw new Error(message); } },
		cmatch: {
			calc_section(match) { return match.setup.state === 'finished' ? 'finished' : 'unassigned'; },
			cmp_match_order: cmp_scheduled_match_order,
			reorder_match_row(...args) { calls.reorder.push(args); },
			update_match(...args) { calls.update.push(args); },
			update_player_status_indicators_for_match_players() {},
		},
	};
	vm.createContext(context);
	vm.runInContext(fs.readFileSync(require.resolve('../static/js/ctournament'), 'utf8'), context);
	return { context, matches, calls, routes, update: context.ctournament.update_match };
}

describe('live tournament match ordering', function() {
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

	it('updates and repositions only the affected row when its scheduled time changes too', function() {
		const h = harness(), target = h.matches[2];
		const incoming = structuredClone(target);
		incoming.match_order = 7;
		incoming.setup.scheduled_time_str = '09:00';
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(target.setup.scheduled_time_str, '09:00');
		assert.deepStrictEqual(h.matches.map(match => match._id), ['m3', 'm1', 'm2']);
		assert.deepStrictEqual(h.calls.update, [[target, 'unassigned', 'unassigned']]);
		assert.strictEqual(h.calls.reorder.length, 0);
	});

	it('does not sort the match list again for unrelated metadata changes', function() {
		const h = harness(), target = h.matches[1];
		h.matches.sort = () => { throw new Error('unnecessary list sort'); };
		const incoming = structuredClone(target);
		incoming.setup.event_name = 'Changed event';
		h.update({ val: { match__id: target._id, match: incoming } });
		assert.strictEqual(h.calls.reorder.length, 0);
		assert.strictEqual(h.calls.update.length, 1);
		assert.strictEqual(h.calls.update[0][0], target);
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
