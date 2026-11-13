'use strict';
const assert = require('assert');
const wire = require('../bts/admin_response/call_status');
const client = require('../static/js/call_status_updates');
const project = require('../bts/call_status/project');
const section = 'diagnostics_by_match_id';
function snapshot(revision, selections, epoch = 'server') {return {call_status:{epoch,revision},selections};}
function rows(value) {return client.apply({},null,value);}
function row(id, data = {}) {return {location_id:id,manual_callable_match_ids:['one'],[section]:{one:{eligible:true,rules:[{key:'ready',passed:true}]}},...data};}
describe('incremental shared call status delivery', function() {
 it('reuses equal location and per-game diagnoses across a new calculation', async function() {
  const selection = {location_id:'hall',diagnostics_by_match_id:{one:{eligible:true,rules:[]},two:{eligible:false,rules:[]}}};
  const before = await project([selection]);
  const same = await project([structuredClone(selection)],before);
  assert.strictEqual(same[0],before[0]);
  const next = structuredClone(selection);next.diagnostics_by_match_id.two.eligible = true;
  const after = await project([next],before);
  assert.strictEqual(after[0].diagnostics_by_match_id.one,before[0].diagnostics_by_match_id.one);
  assert.notStrictEqual(after[0].diagnostics_by_match_id.two,before[0].diagnostics_by_match_id.two);
 });
 it('sends only a changed game and retains other row identities on the client', function() {
  const hall = row('hall'), other = row('other'), before = snapshot(1,[hall,other]);
  const changed = {...hall,[section]:{...hall[section],two:{eligible:false}}};
  const after = snapshot(2,[changed,other]), delta = wire.patch(before,after), old = rows(before);
  assert.strictEqual(delta.selections,undefined);
  assert.deepStrictEqual(Object.keys(delta.selections_delta.changed[0][section].set),['two']);
  const actual = client.apply(old,before.call_status,delta);
  assert.deepStrictEqual(actual,rows(after));assert.strictEqual(actual.other,old.other);
  assert.strictEqual(actual.hall[section].one,old.hall[section].one);
 });
 it('merges added/removed locations, diagnoses and optional location fields without changing the baseline', function() {
  const a = row('hall',{optional:5}), before = snapshot(1,[a,row('removed')]);
  const b = {...a,manual_callable_match_ids:[],[section]:{two:{eligible:false}}};delete b.optional;
  const after = snapshot(2,[b,row('added')]), old = rows(before), delta = wire.patch(before,after);
  assert.deepStrictEqual(client.apply(old,before.call_status,delta),rows(after));
  assert(old.removed);assert(old.hall.optional === 5);assert(old.hall[section].one);
 });
 it('advances metadata with an empty patch and retains every location', function() {
  const a = row('hall'),before = snapshot(1,[a]),after = snapshot(2,[a]),old = rows(before);
  const delta = wire.patch(before,after);assert.deepStrictEqual(delta.selections_delta.changed,[]);
  assert.strictEqual(client.apply(old,before.call_status,delta).hall,old.hall);
 });
 it('rejects missing revisions, another server and malformed patches atomically', function() {
  const before = snapshot(1,[row('hall')]),after = snapshot(2,[row('hall')]),delta = wire.patch(before,after),old = rows(before);
  for (const status of [null,{epoch:'other',revision:1},{epoch:'server',revision:0},{epoch:'server',revision:2}]) assert.strictEqual(client.apply(old,status,delta),null);
  const bad = structuredClone(delta);bad.selections_delta.changed.push({location_id:'missing',fields:{value:2}});
  assert.strictEqual(client.apply(old,before.call_status,bad),null);assert.deepStrictEqual(old,rows(before));
 });
 it('ignores non-subscribers and other tournaments and preserves full updates for old clients', function() {
  const ws = {}, legacy = {}, before = snapshot(1,[row('hall')]),after = snapshot(2,[row('hall')]);
  assert.strictEqual(wire.prepare(before)(ws,'default'),null);
  wire.finish(wire.begin(ws,'default',true),before);wire.finish(wire.begin(legacy,'default',false),before);
  assert(wire.prepare(after)(ws,'default').selections_delta);
  assert.strictEqual(wire.prepare(after)(legacy,'default'),after);
  assert.strictEqual(wire.prepare(after)(ws,'other'),null);
 });
 it('uses a full push during subscription and preserves a newer pushed baseline over a delayed response', function() {
  const ws = {},before = snapshot(1,[row('hall')]),next = snapshot(2,[row('hall')]),last = snapshot(3,[row('hall')]);
  const ticket = wire.begin(ws,'default',true);
  assert.strictEqual(wire.prepare(next)(ws,'default'),next);wire.finish(ticket,before);
  assert.strictEqual(wire.prepare(last)(ws,'default').selections_delta.base,2);
 });
 it('shares a prepared patch across clients with the same baseline and resets after a server restart', function() {
  const before = snapshot(1,[row('hall')]),next = Object.freeze(snapshot(2,[row('hall')])),a = {},b = {};
  for (const ws of [a,b]) wire.finish(wire.begin(ws,'default',true),before);
  const deliver = wire.prepare(next);assert.strictEqual(deliver(a,'default'),deliver(b,'default'));
  const restarted = snapshot(1,[row('hall')],'restarted');assert.strictEqual(wire.prepare(restarted)(a,'default'),restarted);
 });
 it('does not publish the same immutable revision twice to a subscriber', function() {
  const before = snapshot(1,[row('hall')]),next = Object.freeze(snapshot(2,[row('hall')])),ws = {};
  wire.finish(wire.begin(ws,'default',true),before);
  assert(wire.prepare(next)(ws,'default').selections_delta);
  assert.strictEqual(wire.prepare(next)(ws,'default'),null);
 });
 it('substantially reduces a status revision containing 584 games', async function() {
  // Bounded synthetic diagnoses reproduce the shape, without depending on a local live test artifact.
  const selection = {location_id:'hall',diagnostics_by_match_id:Object.fromEntries(Array.from({length:584},(_,i)=>['m'+i,{eligible:false,rules:Array.from({length:20},(_,n)=>({key:'rule'+n,passed:true,detail:'unchanged diagnostic'}))}]))};
  const before = snapshot(1,await project([selection]));
  const next = structuredClone(selection);next.diagnostics_by_match_id.m42.rules[0].passed = false;
  const after = snapshot(2,await project([next],before.selections)),delta = wire.patch(before,after);
  assert(JSON.stringify(delta).length < JSON.stringify(after).length * .01);
  assert.deepStrictEqual(client.apply(rows(before),before.call_status,delta),rows(after));
 });
});
