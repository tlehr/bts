'use strict';

const assert = require('assert');
const database = require('../bts/database');
const keys = require('../bts/queue_lock_keys');
const { ResourceLockQueue } = require('../bts/resource_lock_queue');
const select = require('../bts/score_sync_locks');
const batch = require('../bts/btp_planner/batch_writes');
const barrier = require('../bts/database_read_barrier');
const planner = require('../bts/btp_sync_plan');
const admin = require('../bts/admin');
const v2 = require('../bts/bupws_v2');
const { EventEmitter } = require('events');
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const score = { match_id: 'two', court_id: 'court', network_score: [[2, 0]], presses: [] };
let sequence = 0;
async function fixture() {
 const db = await database.init_test(), key = 'guard-' + ++sequence;
 const insert = (name, document) => new Promise((resolve, reject) => db[name].insert(document, error => error ? reject(error) : resolve()));
 await insert('tournaments', { key, btp_enabled: true, btp_readonly: true, last_reset_ts: 1 });
 await insert('courts', { _id: 'court', tournament_key: key, match_id: 'two', num: 1 });
 const setup = { court_id: 'court', state: 'oncourt', now_on_court: true, counting: '3x21',
  scoring_format: { numSets: 3, set_points: { end_points: 21, max_points: 30 } },
  needs_preparation_successor: false, needs_preparation_successor_ts: null,
  teams: [{ players: [{ btp_id: 1 }] }, { players: [{ btp_id: 2 }] }] };
 await insert('matches', [{ _id: 'two', tournament_key: key, network_score: [[1, 0]], presses: [], setup },
  { _id: 'one', tournament_key: key, end_ts: 1, team1_won: true,
   setup: { ...setup, state: 'finished', now_on_court: false } }]);
 await turn();
 return { app: { db, wss: { clients: [] }, clock: { now_ms: () => 1000 } }, key };
}

describe('allocation dependency point concurrency', function() {
 it('excludes all document writers and wildcards while allowing only the independent point/dependency pair', function() {
  for (const [normal, point, dependency, all] of [[keys.match, keys.point_match, keys.dependency_match, keys.matches],
   [keys.court, keys.point_court, keys.dependency_court, keys.courts]]) {
   const n = normal('test', 'one'), p = point('test', 'one'), d = dependency('test', 'one');
   assert(keys.any_conflict([n], [p])); assert(keys.any_conflict([n], [d])); assert(!keys.any_conflict([p], [d]));
   for (const scope of [all('test'), keys.tournament('test'), keys.all(), keys.legacy_global()]) {
    assert(keys.any_conflict([scope], [p])); assert(keys.any_conflict([scope], [d]));
   }
   assert(!keys.any_conflict([n], [point('other', 'one')])); assert(!keys.any_conflict([n], [dependency('test', 'two')]));
  }
  let seed = 19;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const families = ['match', 'point-match', 'dependency-match', 'court', 'point-court', 'dependency-court', 'matches', 'courts', 'tournament', 'keyed', 'btp'];
  const key = () => families[random(families.length)] + ':' + ['test', 'other', ''][random(3)] + ':' + random(16);
  for (let i = 0; i < 4000; i++) {
   const a = keys.normalize_list(Array.from({ length: random(25) }, key)), b = keys.normalize_list(Array.from({ length: random(25) }, key));
   assert.strictEqual(keys.normalized_lists_conflict(a, b), a.some(left => b.some(right => keys.lock_conflicts(left, right))));
  }
 });
 it('rechecks the model before granting point locks, including preparation transitions, undo and court mismatches', async function() {
  const { app, key } = await fixture();
  assert.deepStrictEqual(select(app, key, score, 1000), keys.score_update(key, score, { point: true }));
  for (const extra of [{ finish_confirmed: true }, { end_ts: 1000 }, { team1_won: false }, { court_id: 'missing' },
   { network_score: [[21, 18], [10, 7]] }]) assert.strictEqual(select(app, key, { ...score, ...extra }, 1000), null);
  await app.db.matches.update_async({ _id: 'two' }, { $set: { 'setup.needs_preparation_successor': true, 'setup.needs_preparation_successor_ts': 500 } }, {});
  await turn();
  assert.strictEqual(select(app, key, score, 1000), null, 'undo crossing the readiness boundary keeps ordinary locks');
  assert(select(app, key, { ...score, network_score: [[21, 18], [11, 7]] }, 1000));
  await app.db.matches.update_async({ _id: 'two' }, { $set: { end_ts: null } }, {}); await turn();
  assert.strictEqual(select(app, key, score, 1000), null);
 });
 it('does not expose a pending target append but captures an unchanged record during a certified disjoint append', async function() {
  const { app, key } = await fixture(), store = app.db.matches;
  const original = store.persistence.persistNewState, entered = deferred(), gate = deferred();
  store.persistence.persistNewState = function(documents, callback) { entered.resolve(); gate.promise.then(() => original.call(this, documents, callback)); };
  const before = await store.findOne_async({ _id: 'one' });
  const writing = batch.write(store, [{ collection: 'matches', id: 'one', before, after: { ...before, marker: true }, update: { $set: { marker: true } } }], entry => ({ _id: entry.id }));
  await entered.promise;
  try {
   assert(barrier.inspect_disjoint(store, ['two']).allowed);
   assert(!barrier.inspect_disjoint(store, ['one']).allowed);
   assert(select(app, key, score, 1000));
   const result = await new Promise((resolve, reject) => app.db.model.read_score_context_part('match', key, 'two', (error, value, timing) => error ? reject(error) : resolve({ value, timing })));
   assert.strictEqual(result.timing.model_read_decision, 'disjoint_records');
   assert.deepStrictEqual(result.value.network_score, [[1, 0]]);
   const native = store.update; store.update = function(...args) { return native.apply(this, args); };
   assert(!barrier.inspect_disjoint(store, ['two']).allowed, 'changed native hooks revoke the certificate'); store.update = native;
  } finally { gate.resolve(); await writing; store.persistence.persistNewState = original; }
 });
 it('evaluates queued point admission again after a preceding writer changes the readiness marker', async function() {
  const q = new ResourceLockQueue(), gate = deferred(), events = []; let ready = false;
  const dependency = q.execute(() => gate.promise, { locks: [keys.dependency_match('test', 'two')] });
  await turn();
  const point = () => events.push('point');
  point._queue_start_locks = () => ready ? [keys.point_match('test', 'two')] : null;
  const waiting = q.execute(point, { locks: [keys.match('test', 'two')] });
  await turn(); assert.deepStrictEqual(events, []);
  ready = true; await q.execute(() => {}, { locks: [keys.match('other', 'one')] });
  for (let i = 0; i < 5 && !events.length; i++) await turn();
  try { assert.deepStrictEqual(events, ['point']); } finally { gate.resolve(); await Promise.all([dependency, waiting]); }
 });
 for (const fail of [false, true]) it('keeps an actual V2 point and its publication during a related apply' + (fail ? ' which rolls back' : ''), async function() {
  const { app, key } = await fixture(), gate = deferred(), entered = deferred();
  const original = app.db.matches.update_async, notify = admin.notify_change, events = [];
  app.db.matches.update_async = async function(...args) {
   if (args[0]._id === 'one' && args[1].$set) {
    entered.resolve(); await gate.promise; if (fail) throw new Error('simulated apply failure');
   }
   return original.apply(this, args);
  };
  admin.notify_change = function(target, k, type, value) { if (target === app) events.push({ type, value }); return notify(target, k, type, value); };
  const panel = Object.assign(new EventEmitter(), { readyState: 1, client_id: 'point-client', messages: [], sendmsg(payload) { this.messages.push(payload); }, send(raw) { this.messages.push(JSON.parse(raw)); } });
  v2.on_connect(app, panel); panel.last_tournament_key = key; panel.court_id = 'court'; panel.last_v2_match_id = 'two'; panel.panel_devicemode = 'umpire';
  let point;
  const sync = planner.sync(app, key, {}, { expected_reset_ts: 1, skip_unchanged: false }, async staged => {
   await staged.db.matches.update_async({ _id: 'one' }, { $set: { 'setup.teams.0.players.0.last_time_on_court_ts': 100 } }, {});
   const two = await staged.db.matches.findOne_async({ _id: 'two' });
   // The notification refers to current state but owns no additional write.
   admin.notify_change(staged, key, 'match_edit', { match: two });
   return true;
  });
  const result = fail ? assert.rejects(sync, /simulated apply failure/) : sync;
  await entered.promise;
  try {
   point = v2.handle_score_update(app, panel, { tournament_key: key, score });
   await Promise.race([point, new Promise((_, reject) => setTimeout(() => reject(new Error('point blocked by related metadata')), 800))]);
   assert(events.some(event => event.type === 'score' && event.value.network_score[0][0] === 2));
   assert.deepStrictEqual((await app.db.matches.findOne_async({ _id: 'two' })).network_score, [[2, 0]]);
  } finally {
   gate.resolve(); await Promise.all([result, point]); await require('../bts/foreground_work').idle();
   app.db.matches.update_async = original; admin.notify_change = notify; panel.readyState = 3; v2.on_close(app, panel);
  }
  if (fail) assert(!events.some(event => event.type === 'match_edit'));
  else assert(events.some(event => event.type === 'match_edit' && event.value.match?.setup.state === 'oncourt' && event.value.match.network_score[0][0] === 2));
  assert.deepStrictEqual((await app.db.matches.findOne_async({ _id: 'two' })).network_score, [[2, 0]]);
 });
});
