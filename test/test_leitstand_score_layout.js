'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const calc = require('../static/bup/dev/js/calc');
const context = { calc, localStorage: { getItem: () => null } };
vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/cleitstand'), 'utf8'), context);
const maximum = context.cleitstand.maxSetCount;
const format = (id, numSets) => ({ id, numSets });

describe('Tournament board score column capacity', function() {
    it('uses the configured default even before matches have been created', function() {
        for (const count of [1, 3, 5]) {
            assert.strictEqual(maximum({ scoring_formats: { default_id: 7, formats: [format(7, count)] } }), count);
        }
        assert.strictEqual(maximum({}), 3);
    });

    it('uses the largest assigned format without reserving unused registered formats', function() {
        const tournament = { scoring_formats: { default_id: 1, formats: [format(1, 1), format(5, 5)] },
            matches: [{ setup: { scoring_format: format(1, 1) } }] };
        assert.strictEqual(maximum(tournament), 1);
        tournament.matches.push({ setup: { scoring_format: format(3, 3) } });
        assert.strictEqual(maximum(tournament), 3);
        tournament.matches.push({ setup: { scoring_format: format(5, 5) } });
        assert.strictEqual(maximum(tournament), 5);
    });

    it('includes assigned stage formats before their matches exist', function() {
        const tournament = { scoring_formats: { default_id: 1, formats: [format(1, 1), format(5, 5)] },
            events: { events: [{ stages: [{ scoring_format: '5' }] }] } };
        assert.strictEqual(maximum(tournament), 5);
        tournament.events.events[0].stages[0].scoring_format = null;
        assert.strictEqual(maximum(tournament), 1);
    });

    it('supports legacy counting and explicit format overrides', function() {
        for (const [counting, count] of [['1x21', 1], ['3x21', 3], ['5x11_15', 5]]) {
            assert.strictEqual(maximum({ matches: [{ setup: { counting } }] }), count);
        }
        assert.strictEqual(maximum({ matches: [{ setup: { counting: '1x21', scoring_format: format(5, 5) } }] }), 5);
    });

    it('retains already recorded sets after a format change', function() {
        assert.strictEqual(maximum({ matches: [{ setup: { counting: '1x21' }, network_score: [[21, 19], [19, 21], [4, 2]] }] }), 3);
    });

    it('uses the tournament default for missing match settings and handles invalid settings', function() {
        assert.strictEqual(maximum({ scoring_formats: { default_id: 1, formats: [format(1, 1)] }, matches: [{ setup: {} }] }), 1);
        assert.strictEqual(maximum({ matches: [{ setup: { counting: 'unknown' } }] }), 3);
    });
});
