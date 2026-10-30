'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const context = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../static/js/cumpires.js'), 'utf8'), context);
const rotation = context.cumpires.rotation_lists;
const ids = list => Array.from(list, official => official._id);
const official = (id, fields = {}) => ({
  _id: id, is_umpire: true, is_service_judge: true,
  umpire_on_court: null, service_judge_on_court: null,
  is_planed_as_umpire: false, is_planed_as_service_judge: false,
  ...fields,
});

describe('Compact official rotation', function() {
  it('keeps automatic rest in the matching waiting queue without clearing its deadline', function() {
    const resting = official('rest', { umpire_pause: 90000, status: 'pause' });
    const before = structuredClone(resting);
    const lists = rotation({ umpires: [resting] });
    assert.deepStrictEqual(ids(lists.waiting.umpire), ['rest']);
    assert.deepStrictEqual(ids(lists.unavailable), []);
    assert.strictEqual(lists.waiting.umpire[0], resting);
    assert.deepStrictEqual(resting, before);
  });

  it('combines only explicit manual pauses and inactive markers in the unavailable area', function() {
    const lists = rotation({ umpires: [
      official('auto', { service_judge_pause: 999 }),
      official('manual-umpire', { umpire_manual_pause: 200 }),
      official('manual-service', { service_judge_manual_pause: 300 }),
      official('inactive', { inactive_list: 100 }),
    ] });
    assert.deepStrictEqual(ids(lists.unavailable), ['inactive', 'manual-umpire', 'manual-service']);
    assert.deepStrictEqual(ids(lists.waiting.service_judge), ['auto']);
  });

  it('places unmarked officials in waiting rather than automatically marking them unavailable', function() {
    const lists = rotation({ umpires: [official('new'), official('service', { is_umpire: false }), official('imported', { is_umpire: false, is_service_judge: false, inactive_list: 123 })] });
    assert.deepStrictEqual(ids(lists.waiting.umpire), ['imported', 'new']);
    assert.deepStrictEqual(ids(lists.waiting.service_judge), ['service']);
    assert.deepStrictEqual(ids(lists.unavailable), []);
  });

  it('excludes court, preparation and other current match assignments', function() {
    const lists = rotation({
      matches: [
        { setup: { state: 'preparation', umpire: { _id: 'prepared' } } },
        { setup: { state: 'scheduled', service_judge: { _id: 'assigned' } } },
        { setup: { state: 'finished', umpire: { _id: 'finished' } } },
      ],
      umpires: [
        official('court', { umpire_on_court: 'c1' }),
        official('planned', { is_planed_as_service_judge: true }),
        official('prepared'), official('assigned'), official('finished'),
      ],
    });
    assert.deepStrictEqual(ids(lists.waiting.umpire), ['finished']);
    assert.deepStrictEqual(ids(lists.unavailable), []);
  });

  it('accepts a released official despite stale legacy status when assignment fields are cleared', function() {
    const lists = rotation({ umpires: [official('released', { status: 'standby', umpire_wait: 123 })] });
    assert.deepStrictEqual(ids(lists.waiting.umpire), ['released']);
  });

  it('handles older snapshots containing only court or preparation status', function() {
    const lists = rotation({ umpires: [{ _id: 'court', status: 'oncourt' }, { _id: 'prepared', status: 'standby' }, { _id: 'ready', status: 'ready' }] });
    assert.deepStrictEqual(ids(lists.waiting.umpire), ['ready']);
  });

  it('uses native waiting timestamps and rest deadlines for stable per-role ordering', function() {
    const lists = rotation({ umpires: [official('later', { umpire_wait: 300 }), official('rest', { umpire_pause: 200 }), official('first', { umpire_wait: 100 })] });
    assert.deepStrictEqual(ids(lists.waiting.umpire), ['first', 'rest', 'later']);
  });

  it('keeps an expired rest in waiting until the server releases it and never makes it a manual pause', function() {
    const resting = official('expired', { service_judge_pause: 1 });
    const lists = rotation({ umpires: [resting] });
    assert.deepStrictEqual(ids(lists.waiting.service_judge), ['expired']);
    assert.deepStrictEqual(ids(lists.unavailable), []);
    assert.strictEqual(resting.service_judge_pause, 1);
  });

  it('uses one waiting queue without duplicate officials in umpire-only mode', function() {
    const lists = rotation({ official_rotation_mode: 'umpire_only', umpires: [official('dual', { umpire_wait: 100, service_judge_wait: 100 }), official('service', { service_judge_pause: 200 })] });
    assert.deepStrictEqual(ids(lists.waiting.umpire).sort(), ['dual', 'service']);
    assert.deepStrictEqual(ids(lists.waiting.service_judge), []);
  });
});
