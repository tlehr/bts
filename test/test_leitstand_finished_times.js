'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const context = { calc: require('../static/bup/dev/js/calc'), localStorage: { getItem: () => null } };
vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/cleitstand'), 'utf8'), context);
const times = match => JSON.parse(JSON.stringify(context.cleitstand.matchTimes(match)));

describe('Finished match times', function() {
    it('derives the actual start from saved duration without loading deferred histories', function() {
        assert.deepStrictEqual(times({ end_ts: 200000, duration_ms: 50000, presses_deferred: true,
            setup: { called_timestamp: 1000 } }), { start: 150000, end: 200000 });
    });

    it('uses the first game start instead of the call, warmup or later sets', function() {
        assert.deepStrictEqual(times({ end_ts: 10000, duration_ms: 500, setup: { called_timestamp: 500 },
            presses: [{ type: 'pick_side', timestamp: 800 }, { type: 'love-all', timestamp: 1000 },
                { type: 'love-all', timestamp: 7000 }] }), { start: 1000, end: 10000 });
    });

    it('honors undo and redo when the recorded start is corrected', function() {
        const presses = [{ type: 'love-all', timestamp: 1000 }, { type: 'undo', timestamp: 2000 }];
        assert.strictEqual(times({ presses, end_ts: 10000, duration_ms: 9000 }).start, null);
        assert.strictEqual(times({ presses: presses.concat({ type: 'redo', timestamp: 3000 }), end_ts: 10000 }).start, 1000);
        assert.strictEqual(times({ presses: presses.concat({ type: 'love-all', timestamp: 4000 }), end_ts: 10000 }).start, 4000);
    });

    it('preserves unknown times instead of substituting the planned time or epoch', function() {
        assert.deepStrictEqual(times({ setup: { called_timestamp: 1000, scheduled_time_str: '10:00' } }), { start: null, end: null });
        assert.deepStrictEqual(times({ end_ts: null, duration_ms: 1000 }), { start: null, end: null });
        assert.deepStrictEqual(times({ end_ts: 2000 }), { start: null, end: 2000 });
    });

    it('rejects invalid durations and a start after the recorded finish', function() {
        for (const duration_ms of [0, -1, Infinity, 'invalid', 3000]) {
            assert.strictEqual(times({ end_ts: 2000, duration_ms }).start, null);
        }
        assert.strictEqual(times({ end_ts: 2000, presses: [{ type: 'love-all', timestamp: 3000 }] }).start, null);
    });

    it('supports legacy end timestamps and leaves the original history untouched', function() {
        assert.deepStrictEqual(times({ setup: { end_ts: 2000 }, duration_ms: 1000 }), { start: 1000, end: 2000 });
        const match = { end_ts: 5000, presses: [{ type: 'love-all', timestamp: 1000 }, { type: 'undo', timestamp: 2000 }] };
        const original = JSON.stringify(match);
        times(match);
        assert.strictEqual(JSON.stringify(match), original);
    });
});

describe('Finished match sorting', function() {
    const sorted = (matches, key, direction = 1) => Array.from(context.cleitstand.sortFinishedMatches(matches, key, direction), match => match._id);
    const match = (_id, end_ts, duration_ms, setup = {}) => ({ _id, end_ts, duration_ms, setup });

    it('sorts numeric and string match numbers naturally in both directions independently of dates', function() {
        const matches = [match('hundred', 3000, 1000, { match_num: 100, scheduled_date: '2026-10-28' }),
            match('two', 5000, 1000, { match_num: '2', scheduled_date: '2026-10-30' }),
            match('ten', 4000, 1000, { match_num: 10, scheduled_date: '2026-10-29' })];
        const original = JSON.stringify(matches);
        assert.deepStrictEqual(sorted(matches, 'number'), ['two', 'ten', 'hundred']);
        assert.deepStrictEqual(sorted(matches, 'number', -1), ['hundred', 'ten', 'two']);
        assert.strictEqual(JSON.stringify(matches), original);
    });

    it('keeps missing match numbers last in either direction', function() {
        const matches = [match('empty', null, null, { match_num: '' }), match('null', null, null, { match_num: null }),
            match('undefined', null, null), match('ten', null, null, { match_num: 10 }), match('two', null, null, { match_num: 2 })];
        assert.deepStrictEqual(sorted(matches, 'number'), ['two', 'ten', 'empty', 'null', 'undefined']);
        assert.deepStrictEqual(sorted(matches, 'number', -1), ['ten', 'two', 'empty', 'null', 'undefined']);
    });

    it('preserves natural ordering for match numbers with letter suffixes', function() {
        const matches = ['12b', '100', '12a', '2'].map(number => match(number, null, null, { match_num: number }));
        assert.deepStrictEqual(sorted(matches, 'number'), ['2', '12a', '12b', '100']);
        assert.deepStrictEqual(sorted(matches, 'number', -1), ['100', '12b', '12a', '2']);
    });

    it('sorts actual starts separately from finishes in both directions', function() {
        const matches = [match('short', 9000, 1000), match('long', 10000, 8000)];
        assert.deepStrictEqual(sorted(matches, 'start'), ['long', 'short']);
        assert.deepStrictEqual(sorted(matches, 'start', -1), ['short', 'long']);
        assert.deepStrictEqual(sorted(matches, 'end'), ['short', 'long']);
        assert.deepStrictEqual(sorted(matches, 'end', -1), ['long', 'short']);
    });

    it('orders planned times by date and numeric hours rather than their display text', function() {
        const matches = [match('later-day', null, null, { scheduled_date: '2026-10-30', scheduled_time_str: '08:00' }),
            match('later-hour', null, null, { scheduled_date: '2026-10-29', scheduled_time_str: '10:00' }),
            match('earlier', null, null, { scheduled_date: '2026-10-29', scheduled_time_str: '9:05' })];
        assert.deepStrictEqual(sorted(matches, 'plan'), ['earlier', 'later-hour', 'later-day']);
        assert.deepStrictEqual(sorted(matches, 'plan', -1), ['later-day', 'later-hour', 'earlier']);
    });

    it('keeps missing and invalid times last in either direction', function() {
        for (const key of ['plan', 'start', 'end']) {
            const matches = [match('unknown', null, null, { scheduled_time_str: '25:60' }),
                match('later', 5000, 1000, { scheduled_time_str: '10:00' }),
                match('earlier', 3000, 1000, { scheduled_time_str: '09:00' })];
            assert.deepStrictEqual(sorted(matches, key), ['earlier', 'later', 'unknown']);
            assert.deepStrictEqual(sorted(matches, key, -1), ['later', 'earlier', 'unknown']);
        }
    });

    it('sorts actual timestamps chronologically across midnight', function() {
        const matches = [match('after', Date.parse('2026-10-29T23:20:00Z'), 600000),
            match('before', Date.parse('2026-10-29T22:50:00Z'), 600000)];
        for (const key of ['start', 'end']) assert.deepStrictEqual(sorted(matches, key), ['before', 'after']);
    });

    it('breaks ties by numeric match number and ID without changing match data or input order', function() {
        const matches = [match('game-10', 5000, 1000, { match_num: 10 }),
            match('game-3', 5000, 1000, { match_num: 2 }), match('game-2', 5000, 1000, { match_num: 2 })];
        const original = JSON.stringify(matches);
        for (const direction of [1, -1]) assert.deepStrictEqual(sorted(matches, 'end', direction), ['game-2', 'game-3', 'game-10']);
        assert.strictEqual(JSON.stringify(matches), original);
    });
});
