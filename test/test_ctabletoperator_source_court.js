'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const context = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/ctabletoperator'), 'utf8'), context);
const source = context.ctabletoperator.source_court;
const pair = () => [{ btp_id: 1, name: 'Felix Example', last_time_on_court_ts: 100 },
    { btp_id: 2, name: 'Victoria Example', last_time_on_court_ts: 100 }];
const entry = (extra = {}) => ({ _id: 'returned', match_id: 'next', tabletoperator: pair(),
    played_on_court: null, court: null, start_ts: 100, ...extra });
const original = (extra = {}) => entry({ _id: 'original', match_id: 'finished', assigned_match_id: 'next',
    played_on_court: 'court-12', court: -1, source_match_end_ts: 100, ...extra });
const tournament = records => ({ courts: [{ _id: 'court-12', num: 12 }, { _id: 'court-8', num: 8 }],
    tabletoperators: records });

describe('Tablet operator source court display', function() {
    it('preserves an explicit origin and supports both court lookups', function() {
        const current = entry({ played_on_court: 'court-8' });
        const model = tournament([original(), current]);
        assert.strictEqual(source(current, model), model.courts[1]);
        model.courts_by_id = { 'court-8': { _id: 'court-8', num: '8A' } };
        assert.strictEqual(source(current, model), model.courts_by_id['court-8']);
    });

    it('restores the original court after the next match was withdrawn without changing stored data', function() {
        const current = entry(), model = tournament([original(), current]);
        model.matches = [{ _id: 'next', setup: { court_id: 'court-8' } }];
        const before = JSON.stringify(model);
        assert.strictEqual(source(current, model).num, 12);
        assert.strictEqual(JSON.stringify(model), before);
    });

    it('follows repeated withdrawals and terminates even when an assignment refers back to itself', function() {
        const intermediate = entry({ assigned_match_id: 'later', court: -1 });
        const current = entry({ _id: 'again', match_id: 'later' });
        const cycle = entry({ _id: 'cycle', match_id: 'later', assigned_match_id: 'later', court: -1 });
        for (const records of [[original(), intermediate, current, cycle], [cycle, current, intermediate, original()]]) {
            assert.strictEqual(source(current, tournament(records)).num, 12);
        }
    });

    it('retains the source when a pair returns in reversed order or only one member returns', function() {
        for (const people of [pair().reverse(), [pair()[1]]]) {
            const current = entry({ tabletoperator: people });
            assert.strictEqual(source(current, tournament([original(), current])).num, 12);
        }
    });

    it('does not borrow a source from a different partner or from equal names with different player IDs', function() {
        for (const people of [[pair()[0], { btp_id: 3, name: 'Other Partner' }],
            pair().map(player => ({ ...player, btp_id: player.btp_id + 10 }))]) {
            const current = entry({ tabletoperator: people });
            assert.strictEqual(source(current, tournament([original(), current])), null);
        }
    });

    it('requires a previous assignment to this match, including for manually added or unidentified entries', function() {
        for (const current of [entry({ match_id: 'manually_added' }), entry({ match_id: 'unrelated' }),
            entry({ tabletoperator: [] }), entry({ tabletoperator: [{}] }), entry({ tabletoperator: {} })]) {
            assert.strictEqual(source(current, tournament([null, original(), current])), null);
        }
    });

    it('uses finish timestamps without letting queue reordering or a later finish change an older origin', function() {
        const current = entry({ start_ts: 1 });
        const newer = original({ _id: 'newer', played_on_court: 'court-8', source_match_end_ts: 200, start_ts: -100 });
        const model = tournament([newer, current, original({ start_ts: 99999 })]);
        assert.strictEqual(source(current, model).num, 12);
        current.tabletoperator.forEach(player => { player.last_time_on_court_ts = 200; });
        assert.strictEqual(source(current, model).num, 8);
    });

    it('leaves unknown explicit courts and conflicting sources blank instead of guessing', function() {
        const current = entry();
        const conflict = original({ _id: 'conflict', played_on_court: 'court-8' });
        assert.strictEqual(source(current, tournament([original(), conflict, current])), null);
        assert.strictEqual(source(entry({ played_on_court: 'deleted-court' }), tournament([original()])), null);
    });

    it('supports legacy names without player IDs only along the existing assignment link', function() {
        const people = pair().map(player => ({ name: player.name, btp_id: -1 }));
        const previous = original({ tabletoperator: people, source_match_end_ts: undefined });
        const current = entry({ tabletoperator: [...people].reverse() });
        assert.strictEqual(source(current, tournament([previous, current])).num, 12);
    });
});
