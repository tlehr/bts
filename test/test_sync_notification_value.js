'use strict';

const assert = require('assert');
const { deepCopy } = require('nedb/lib/model');
const resolve = require('../bts/btp_planner/notification_value');

describe('committed sync notification values', function() {
	const current = { _id: 'one', setup: { state: 'oncourt' }, presses: [{ type: 'score' }], btp_winner: 1 };
	const umpire = { _id: 'official', name: 'Current' };
	const state = { courts: [{ _id: 'court' }], locations: [], umpires: [umpire] };

	it('keeps numeric court order when replacing a planned list with committed court records', function() {
		const numbers = [13, 11, 8, 12, 6, 1, 2, 3, 4, 5, 7, 9, 10];
		const courts = numbers.map(num => ({ _id: 'court-' + num, num: String(num), match_id: 'match-' + num }));
		const actual = resolve({ value: { all_courts: [] } }, null, null, { ...state, courts });
		assert.deepStrictEqual(actual.all_courts.map(court => Number(court.num)), Array.from({ length: 13 }, (_, i) => i + 1));
		assert.deepStrictEqual(courts.map(court => Number(court.num)), numbers, 'do not reorder the committed snapshot in place');
		assert(actual.all_courts.every(court => courts.includes(court)), 'retain the committed court records without recopying them');
	});

	it('preserves the full payload for match, wrapper, player, official and collection notifications', function() {
		for (const [value, match, official] of [
			[{ _id: 'one', setup: { state: 'scheduled' }, presses: [] }, current, null],
			[{ match: { _id: 'one', setup: {} }, annotation: { timestamp: new Date(1) }, all_courts: [] }, current, null],
			[{ match__id: 'one', setup: {}, btp_winner: 0, checked_in: true }, current, null],
			[{ _id: 'official', name: 'Before' }, null, umpire],
			[{ _id: 'official', match: { _id: 'one' } }, current, umpire],
			[{ all_courts: [], all_locations: [], all_umpires: [], marker: { value: 1 } }, null, null],
			[{ _id: 'removed', setup: {} }, null, null],
			[null, null, null],
		]) {
			const original = deepCopy(value);
			let expected = deepCopy(value);
			if (match) {
				if (expected.match) expected.match = match;
				else if (expected.match__id) expected = { ...expected, setup: match.setup, btp_winner: match.btp_winner };
				else expected = match;
			}
			if (official) expected = official;
			if (expected?.all_courts) expected.all_courts = state.courts;
			if (expected?.all_locations) expected.all_locations = state.locations;
			if (expected?.all_umpires) expected.all_umpires = state.umpires;
			const actual = resolve({ value }, match, official, state);
			assert.deepStrictEqual(actual, expected);
			assert.deepStrictEqual(value, original);
			if (actual?.annotation) {
				actual.annotation.marker = true;
				assert.strictEqual(value.annotation.marker, undefined);
				assert.strictEqual(actual.annotation.timestamp.getTime(), 1);
			}
		}
	});

	it('does not traverse obsolete histories, setups or replaced collection rows', function() {
		const obsolete = {};
		Object.defineProperty(obsolete, 'presses', { enumerable: true, get() { throw new Error('Discarded history traversed'); } });
		const notification = { value: { match: obsolete, all_courts: [obsolete], marker: { active: true } } };
		const actual = resolve(notification, current, null, state);
		assert.strictEqual(actual.match, current);
		assert.deepStrictEqual(actual.all_courts, state.courts);
		assert.strictEqual(actual.all_courts[0], state.courts[0]);
		assert.notStrictEqual(actual.marker, notification.value.marker);
		assert.strictEqual(resolve({ value: { match__id: 'one', setup: obsolete } }, current, null, state).setup, current.setup);
		assert.strictEqual(resolve({ value: obsolete }, current, null, state), current);
	});
});
