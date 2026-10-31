'use strict';

const assert = require('assert');
const { statuses, effectiveNow } = require('../static/js/official_picker');

describe('Official picker field and pause context', function() {
 it('resolves both official roles to configured field numbers and locations', function() {
  const context = statuses({ locations: [{ _id: 'hall', name: 'Hall' }], courts: [{ _id: 'opaque', num: '12', location_id: 'hall' }], umpires: [
   { name: 'Umpire', umpire_on_court: 'opaque' }, { name: 'Service', service_judge_on_court: 'court_2' }, { name: 'Idle', umpire_on_court: false },
  ] });
  assert.strictEqual(context.get('Umpire').courtNumber, '12');assert.strictEqual(context.get('Umpire').location, 'Hall');
  assert.strictEqual(context.get('Service').courtNumber, '2');assert.strictEqual(context.get('Idle').courtNumber, null);
 });
 it('uses actual match assignments as a fallback while ignoring historical and prepared assignments', function() {
  const game = (name, extra, setup) => ({ ...extra, setup: { now_on_court: true, court_id: 'court_7', umpire: { name }, ...setup } });
  const context = statuses({ matches: [game('Current'), game('Finished', { team1_won: false }), game('Ended', { end_ts: 1 }),
   game('Special', { score_status: 'walkover' }), game('Preparation', {}, { now_on_court: false, state: 'preparation' })] });
  assert.strictEqual(context.get('Current').courtNumber, '7');
  for (const name of ['Finished', 'Ended', 'Special', 'Preparation']) assert.strictEqual(context.has(name), false);
 });
 it('uses the latest valid automatic pause deadline and never treats manual pause starts as deadlines', function() {
  const context = statuses({ umpires: [
   { name: 'Pause', umpire_pause: 1000, service_judge_pause: '2000', umpire_manual_pause: 999999 },
   { name: 'Manual', umpire_manual_pause: 999999 }, { name: 'Invalid', umpire_pause: Infinity, service_judge_pause: 'invalid' },
  ] });
  assert.strictEqual(context.get('Pause').pauseUntil, 2000);assert.strictEqual(context.get('Manual').pauseUntil, 0);assert.strictEqual(context.get('Invalid').pauseUntil, 0);
 });
 it('uses the tournament fixed or offset clock and falls back to wall time for invalid clock values', function() {
  assert.strictEqual(effectiveNow({}, 1000), 1000);
  assert.strictEqual(effectiveNow({ test_clock: { mode: 'fixed', fixed_ts: '2000' } }, 1000), 2000);
  assert.strictEqual(effectiveNow({ test_clock: { mode: 'offset', offset_ms: -300 } }, 1000), 700);
  for (const mode of ['fixed', 'offset']) assert.strictEqual(effectiveNow({ test_clock: { mode, fixed_ts: 'bad', offset_ms: 'bad' } }, 1000), 1000);
 });
 it('refreshes canonical assignments without changing source objects or carrying over old field data', function() {
  const tournament = { umpires: [{ _id: 'a', name: 'Current', umpire_on_court: 'court_12' }] }, before = structuredClone(tournament);
  assert.strictEqual(statuses(tournament).get('Current').courtNumber, '12');assert.deepStrictEqual(tournament, before);
  tournament.umpires[0].umpire_on_court = null;tournament.umpires[0].umpire_pause = 3000;
  const next = statuses(tournament).get('Current');assert.strictEqual(next.courtNumber, null);assert.strictEqual(next.pauseUntil, 3000);
 });
});
