'use strict';
const assert = require('assert');
const {format, parse} = require('../static/js/duration_input');

describe('Settings durations in minutes:seconds', function() {
    for (const [value, text] of [[0, '0:00'], [59, '0:59'], [60, '1:00'], [330, '5:30'], [3600, '60:00'], [10800, '180:00'], [.1, '0:00,1'], [1.001, '0:01,001'], [59.999, '0:59,999']]) {
        it('formats and restores ' + value + ' seconds without changing the stored interval', function() {
            assert.strictEqual(format(value), text);assert.strictEqual(parse(text), value);
        });
    }
    it('converts the same visible duration into the three existing storage units', function() {
        assert.strictEqual(parse('5:30', {unit:'seconds'}), 330);
        assert.strictEqual(parse('5:30', {unit:'minutes'}), 5.5);
        assert.strictEqual(parse('5:30', {unit:'milliseconds'}), 330000);
        assert.strictEqual(format(5.5, {unit:'minutes'}), '5:30');
        assert.strictEqual(format(330000, {unit:'milliseconds'}), '5:30');
    });
    it('keeps millisecond precision, supports a decimal comma or point and normalizes shorter seconds', function() {
        assert.strictEqual(parse('0:00,125', {unit:'milliseconds'}), 125);
        assert.strictEqual(parse('0:00.125', {unit:'milliseconds'}), 125);
        assert.strictEqual(format(parse('1:5')), '1:05');
        assert.strictEqual(format(59.9996), '1:00');
    });
    it('supports negative offsets only when explicitly enabled', function() {
        assert(Number.isNaN(parse('-2:30')));
        assert.strictEqual(parse('-2:30', {unit:'milliseconds', signed:true}), -150000);
        assert.strictEqual(format(-150000, {unit:'milliseconds'}), '-2:30');
    });
    it('distinguishes an optional empty value from a zero-length pause', function() {
        assert.strictEqual(parse('', {nullable:true}), null);
        assert.strictEqual(parse('0:00', {nullable:true}), 0);
        assert.strictEqual(format(null), '');
        assert.strictEqual(format(0), '0:00');
    });
    for (const text of ['', '30', '1:60', '1:99', '1:2:30', '1.5:00', 'abc', 'NaN', 'Infinity', '1e2:00', '1:00,0001', '9007199254740991:00']) {
        it('rejects ambiguous or invalid duration ' + JSON.stringify(text), function() {assert(Number.isNaN(parse(text)));});
    }
});
