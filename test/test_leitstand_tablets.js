'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const context = { localStorage: { getItem: () => null } };
vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/cleitstand'), 'utf8'), context);
const rows = (tournament, sort) => JSON.parse(JSON.stringify(context.cleitstand.tabletDevices(tournament, sort)));
const device = (id, extra = {}) => ({ client_id: id, online: true, panel_devicemode: 'umpire', ...extra });

describe('Tablet card data', function() {
    it('includes connected tablets once and excludes offline devices and displays', function() {
        const tournament = { displays: [device('1'), device('1'), device('2', { online: false }),
            device('3', { panel_devicemode: 'display' }), device('deleted'), device(null)] };
        assert.deepStrictEqual(rows(tournament).map(row => row.id), ['1']);
    });

    it('uses the assigned device profile and falls back to the panel mode for older records', function() {
        const tournament = { displaysettings: [{ id: 'tablet', devicemode: 'umpire' }, { id: 'tv', devicemode: 'display' }],
            displays: [device('1', { panel_devicemode: 'display', displaysetting_id: 'tablet' }),
                device('2', { displaysetting_id: 'tv' }), device('3')] };
        assert.deepStrictEqual(rows(tournament).map(row => row.id), ['1', '3']);
    });

    it('keeps zero percent and charging separate from unavailable battery readings', function() {
        const tournament = { displays: [device('empty', { battery: { level: 0, charging: true } }),
            device('full', { battery: { level: 1 } }), device('unknown', { battery: { charging: true } })] };
        const devices = rows(tournament, { key: 'battery', direction: 1 });
        assert.deepStrictEqual(devices.map(row => row.percent), [0, 100, null]);
        assert.deepStrictEqual(devices.map(row => row.charging), [true, false, true]);
    });

    it('warns red through ten percent and yellow through twenty-five percent, also while charging', function() {
        const displays = [0, 0.1, 0.11, 0.25, 0.26, 1].map((level, index) => device(String(index), { battery: { level, charging: true } }));
        assert.deepStrictEqual(rows({ displays }, { key: 'battery', direction: 1 }).map(row => row.status),
            ['critical', 'critical', 'low', 'low', 'normal', 'normal']);
    });

    it('does not invent battery readings from missing, nonnumeric or out-of-range values', function() {
        const displays = [undefined, null, '', '0.5', NaN, Infinity, -0.1, 1.1].map((level, index) => device(String(index), { battery: { level } }));
        assert(rows({ displays }).every(row => row.percent === null && row.status === 'unknown'));
    });

    it('orders battery readings in either direction with unknown readings last', function() {
        const displays = [device('unknown'), device('high', { battery: { level: 0.8 } }), device('low', { battery: { level: 0.2 } })];
        assert.deepStrictEqual(rows({ displays }, { key: 'battery', direction: 1 }).map(row => row.id), ['low', 'high', 'unknown']);
        assert.deepStrictEqual(rows({ displays }, { key: 'battery', direction: -1 }).map(row => row.id), ['high', 'low', 'unknown']);
    });

    it('sorts court numbers naturally and keeps unassigned tablets last', function() {
        const tournament = { courts: [{ _id: 'ten', num: '10' }, { _id: 'two', num: '2' }],
            displays: [device('a', { court_id: 'ten' }), device('b', { court_id: 'two' }), device('c'), device('d', { court_id: 'deleted' })] };
        assert.deepStrictEqual(rows(tournament).map(row => row.id), ['b', 'a', 'c', 'd']);
        assert.deepStrictEqual(rows(tournament, { key: 'court', direction: -1 }).map(row => row.id), ['a', 'b', 'c', 'd']);
    });

    it('resolves court and location labels without changing the source data or array order', function() {
        const tournament = { locations: [{ _id: 'hall', name: 'Sporthalle', short_name: 'SH' }], courts: [{ _id: 'field', num: '3', location_id: 'hall' }],
            displays: [device('b', { court_id: 'field', hostname: 'Tablet B' }), device('a', { court_id: 'field', hostname: 'Tablet A' })] };
        const original = JSON.stringify(tournament), devices = rows(tournament);
        assert.deepStrictEqual(devices.map(row => row.id), ['a', 'b']);
        assert.strictEqual(devices[0].location, 'Sporthalle');
        assert.strictEqual(devices[0].locationShort, 'SH');
        assert.strictEqual(JSON.stringify(tournament), original);
    });

    it('shows supplied IPv4 and IPv6 addresses and does not infer an IP from a numeric client ID', function() {
        const displays = [device('1', { hostname: 'tablet-one', client_ip: '::ffff:192.168.1.21' }),
            device('2', { hostname: '192.168.1.22' }), device('3', { ip: '2001:db8::23' }), device('24')];
        const devices = rows({ displays });
        assert.strictEqual(devices.find(row => row.id === '1').ip, '192.168.1.21');
        assert.strictEqual(devices.find(row => row.id === '2').ip, '192.168.1.22');
        assert.strictEqual(devices.find(row => row.id === '2').hostname, 'Tablet 2');
        assert.strictEqual(devices.find(row => row.id === '3').ip, '2001:db8::23');
        assert.strictEqual(devices.find(row => row.id === '24').ip, '');
    });
});
