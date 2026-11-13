'use strict';
const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const planner = require('../bts/btp_sync_plan');
const admin = require('../bts/admin');

let sequence = 0;
async function fixture() {
 const db = await database.init_test(), key = 'queue-publication-' + ++sequence;
 await promisify(db.tournaments.insert.bind(db.tournaments))({ key, btp_enabled: true, last_reset_ts: 1 });
 return { app: { db, wss: { clients: [] } }, key };
}
async function planned(run) {
 const { app, key } = await fixture(), messages = [], notify = admin.notify_change;
 admin.notify_change = (target, tournament_key, ctype, value) => {
  if (target._btp_sync_effects) return notify(target, tournament_key, ctype, value);
  messages.push({ ctype, val: structuredClone(value) });
 };
 try { await planner.sync(app, key, {}, { expected_reset_ts: 1 }, staged => run(staged, key)); }
 finally { admin.notify_change = notify; }
 return { app, key, messages };
}

module.exports.assignmentMessages = async function() {
 return planned(async (staged, key) => {
  for (const [index, id] of ['queue-one', 'queue-two'].entries()) {
   const entry = await promisify(staged.db.tabletoperators.insert.bind(staged.db.tabletoperators))({
    _id: id, tournament_key: key, court: null, start_ts: index, tabletoperator: [{ btp_id: 990001 + index, name: 'Wartetest ' + index }],
   });
   admin.notify_change(staged, key, 'tabletoperator_add', { tabletoperator: entry });
   await staged.db.tabletoperators.update_async({ _id: id }, { $set: { court: 'field-' + index, assigned_match_id: 'match-' + index } }, {});
   const assigned = await staged.db.tabletoperators.findOne_async({ _id: id });
   admin.notify_change(staged, key, 'tabletoperator_removed', { tabletoperator: assigned });
   admin.notify_change(staged, key, 'tabletoperator_removed', { tabletoperator: assigned });
  }
  return true;
 });
};

if (typeof describe === 'function') describe('Committed tablet queue publication', function() {
 it('publishes every distinct queue entry exactly once per notification type', async function() {
  const { messages } = await module.exports.assignmentMessages();
  for (const type of ['tabletoperator_add', 'tabletoperator_removed']) {
   assert.deepStrictEqual(messages.filter(message => message.ctype === type).map(message => message.val.tabletoperator._id), ['queue-one', 'queue-two']);
  }
 });
 it('publishes the assigned state when insertion and assignment happen in the same plan', async function() {
  const { app, messages } = await module.exports.assignmentMessages();
  for (const message of messages) {
   const entry = message.val.tabletoperator, committed = await app.db.tabletoperators.findOne_async({ _id: entry._id });
   assert.deepStrictEqual(entry, committed);
   assert(entry.court != null, 'An assigned operator must not reappear as waiting');
  }
 });
 it('publishes the final partner list and position after repeated staged edits', async function() {
  const { app, messages } = await planned(async (staged, key) => {
   const entry = await promisify(staged.db.tabletoperators.insert.bind(staged.db.tabletoperators))({ _id:'pair',tournament_key:key,court:null,start_ts:1,tabletoperator:[{btp_id:1},{btp_id:2}] });
   admin.notify_change(staged,key,'tabletoperator_add',{tabletoperator:entry});
   await staged.db.tabletoperators.update_async({_id:'pair'},{$set:{tabletoperator:[{btp_id:2}],start_ts:20}},{});
   const current=await staged.db.tabletoperators.findOne_async({_id:'pair'});
   admin.notify_change(staged,key,'tabletoperator_add',{tabletoperator:current});return true;
  });
  assert.strictEqual(messages.length,1);
  assert.deepStrictEqual(messages[0].val.tabletoperator,await app.db.tabletoperators.findOne_async({_id:'pair'}));
 });
});
