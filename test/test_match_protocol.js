'use strict';

const assert = require('assert');
const { promisify } = require('util');
const database = require('../bts/database');
const protocol = require('../bts/match_protocol');
const write_score = require('../bts/score_write');
const admin = require('../bts/admin');
const { calls, parseClaim } = require('../static/js/announcement_text');

async function fixture({ fail = false } = {}) {
 const db = await database.init_test();
 const start = Date.UTC(2026, 9, 30, 10), app = { db, clock: { now_ms: () => app.time }, time: start };
 const persist = db.matches.persistence.persistNewState;
 let reject_write = false;
 if (fail) db.matches.persistence.persistNewState = function(documents, callback) {
  if (reject_write) return setImmediate(() => callback(new Error('Append failed')));
  return persist.call(this, documents, callback);
 };
 protocol.attach(app);
 const match = { _id: 'one', tournament_key: 'example', presses: [], setup: { state: 'scheduled',
  teams: [1, 2].map(btp_id => ({ players: [{ btp_id, name: 'Player ' + btp_id, checked_in: false }] })) } };
 await promisify(db.matches.insert.bind(db.matches))(match);
 await promisify(db.courts.insert.bind(db.courts))({ _id: 'court-9', num: '9', tournament_key: 'example' });
 const update = async values => { app.time += 1000; await db.matches.update_async({ _id: 'one' }, { $set: values }, {}); };
 const entries = () => db.logs.find_async({ kind: 'match_protocol', match_id: 'one' });
 const request = (handler, values = {}, peer = {}) => new Promise((resolve, reject) => handler(app,
  { ...peer, respond: (_message, error, response) => error ? reject(error) : resolve(response) },
  { tournament_key: 'example', match_id: 'one', ...values }));
 return { app, db, match, update, entries, request, fail: () => { reject_write = true; } };
}

describe('Organisational match protocol', function() {
 for (const { kind, label } of Object.values(calls)) it('records playback per device for ' + kind, async function() {
  const f = await fixture(), messages = [], viewer = { sendmsg: message => messages.push(message) };
  admin.on_connect(f.app, viewer);
  try {
   admin.notify_change(f.app, 'example', kind, { match__id: 'one', setup: f.match.setup });
   const broadcast = messages.find(message => message.ctype === kind);
   const claim = parseClaim(broadcast.val._announcement_claim_key);
   assert.strictEqual(claim.match_id, 'one');assert.strictEqual(claim.kind, kind);
   await f.request(protocol.handle_playback, { claim_key: claim.id, provider: 'server', device_id: 'speaker-device' }, { hostname: 'Speaker', _socket: { remoteAddress: '192.168.1.20' } });
   const events = await f.entries();
   assert.strictEqual(events.length, 1);assert(events[0].text.startsWith(label + ' mit Serveraudio abgespielt'));
   assert.strictEqual(events[0].call_id, claim.id);assert.strictEqual(events[0].requested_at, f.app.time);
   assert.strictEqual(events[0].device.hostname, 'Speaker');
  } finally { admin.on_close(f.app, viewer); }
 });

 for (const { kind } of Object.values(calls).filter(call => /^(?:second_|begin_to_play)/.test(call.kind))) it('retains the game ID through the actual ' + kind + ' handler', async function() {
  const f = await fixture(), messages = [], viewer = { sendmsg: message => messages.push(message) };
  admin.on_connect(f.app, viewer);
  try {
   await f.request(admin['handle_' + kind], { match_id: 'one', setup: f.match.setup });
   const broadcast = messages.find(message => message.ctype === kind);
   assert(broadcast);assert.strictEqual(parseClaim(broadcast.val._announcement_claim_key).match_id, 'one');
  } finally { admin.on_close(f.app, viewer); }
 });

 it('distinguishes repeated button presses even while the tournament clock is fixed', async function() {
  const f = await fixture(), messages = [], viewer = { sendmsg: message => messages.push(message) };
  admin.on_connect(f.app, viewer);
  try {
   for (let count = 0; count < 2; count++) admin.notify_change(f.app, 'example', 'match_preparation_call', { match__id: 'one', match: f.match });
   const claims = messages.map(message => message.val._announcement_claim_key);
   assert.notStrictEqual(claims[0], claims[1]);
   for (const claim_key of claims) await f.request(protocol.handle_playback, { claim_key, provider: 'server', device_id: 'same-device' });
   assert.strictEqual((await f.entries()).length, 2);
  } finally { admin.on_close(f.app, viewer); }
 });

 it('does not invent events while importing existing matches', async function() {
  const f = await fixture();
  assert.deepStrictEqual(await f.entries(), []);
 });

 it('keeps preparation history after its timestamp is removed by the court call', async function() {
  const f = await fixture();
  await f.update({ 'setup.state': 'preparation', 'setup.preparation_call_timestamp': f.app.time });
  const preparation = (await f.entries())[0];
  assert.strictEqual(preparation.text, 'Spiel in Vorbereitung aufgerufen');
  await f.update({ 'setup.state': 'oncourt', 'setup.now_on_court': true, 'setup.court_id': 'court-9', 'setup.called_timestamp': f.app.time,
   'setup.preparation_call_timestamp': null });
  const response = await f.request(protocol.handle_get);
  assert.strictEqual(response.tournament_key, 'example');
  assert(response.events.some(event => event._id === preparation._id));
  assert(response.events.some(event => event.text === 'Spiel auf Feld 9 aufgerufen'));
 });

 it('records complete attendance only on a real change, including a later withdrawal', async function() {
  const f = await fixture();
  await f.update({ 'setup.teams.0.players.0.checked_in': true });
  assert.deepStrictEqual(await f.entries(), []);
  await f.update({ 'setup.teams.1.players.0.checked_in': true });
  assert.strictEqual((await f.entries())[0].type, 'players_present');
  await f.update({ 'setup.teams.1.players.0.checked_in': true });
  assert.strictEqual((await f.entries()).length, 1);
  await f.update({ 'setup.teams.1.players.0.checked_in': false });
  assert((await f.entries()).some(event => event.type === 'players_absent'));
 });

 it('records assignment details without treating ordinary participant flags as reassignment', async function() {
  const f = await fixture();
  await f.update({ 'setup.court_id': 'court-9', 'setup.tabletoperators': [{ btp_id: 3, name: 'Tablet Person' }] });
  assert.strictEqual((await f.entries())[0].text, 'Feld und Tabletbedienung zugewiesen · Feld 9 · Tablet Person');
  await f.update({ 'setup.tabletoperators.0.checked_in': true });
  assert.strictEqual((await f.entries()).length, 1);
  await f.update({ 'setup.tabletoperators': [], 'setup.umpire': { name: 'Referee' } });
  const events = await f.entries();
  assert(events.some(event => event.text === 'Tabletbedienung freigegeben'));
  assert(events.some(event => event.text === 'Schiedsrichter zugewiesen · Referee'));
 });

 it('records postponement and cancellation without claiming the audio was played', async function() {
  const f = await fixture();
  await f.update({ 'setup.preparation_call_deferred': true });
  await f.update({ 'setup.preparation_call_deferred': false, 'setup.now_on_court': true, 'setup.called_timestamp': f.app.time });
  await f.update({ 'setup.now_on_court': false });
  const events = await f.entries();
  assert(events.some(event => event.type === 'preparation_deferred'));
  assert(events.some(event => event.type === 'call_cancelled'));
  assert(!events.some(event => event.type === 'audio_played'));
 });

 it('does not interpret the reset of check-ins during match completion as absence', async function() {
  const f = await fixture();
  const ready = structuredClone(f.match);ready.setup.teams.forEach(team => team.players.forEach(player => { player.checked_in = true; }));
  const finished = structuredClone(ready);finished.setup.state = 'finished';finished.setup.teams.forEach(team => team.players.forEach(player => { player.checked_in = false; }));
  assert(!protocol.transitions(ready, finished, f.app.time).some(event => event.type === 'players_absent'));
 });

 it('adds no protocol writes or reads for a stream of ordinary point updates', async function() {
  const f = await fixture();
  await f.update({ 'setup.state': 'oncourt', 'setup.now_on_court': true, 'setup.called_timestamp': f.app.time, 'setup.court_id': 'court-9' });
  await f.entries();
  const insert = f.db.logs.insert, read = f.db.matches.find, one = f.db.matches.findOne;
  let writes = 0, reads = 0;
  f.db.logs.insert = function(...args) { writes++;return insert.apply(this, args); };
  f.db.matches.find = function(...args) { reads++;return read.apply(this, args); };
  f.db.matches.findOne = function(...args) { reads++;return one.apply(this, args); };
  const started = performance.now();
  for (let point = 1; point <= 30; point++) await new Promise((resolve, reject) => write_score(f.db.matches,
   { _id: 'one', tournament_key: 'example' }, { network_score: [[point, 0]], presses: [{ type: 'score', side: 'left', timestamp: point }] },
   error => error ? reject(error) : resolve()));
  assert.strictEqual(writes, 0);assert.strictEqual(reads, 0);
  assert(performance.now() - started < 500);
  assert(require('../bts/btp_planner/batch_writes').supported(f.db.matches), 'Direct/batch score writes remain supported');
 });

 it('does not record a state change whose append fails', async function() {
  const f = await fixture({ fail: true });f.fail();
  await assert.rejects(f.update({ 'setup.state': 'preparation', 'setup.preparation_call_timestamp': f.app.time }), /Append failed/);
  assert.deepStrictEqual(await f.entries(), []);
 });

 it('records a successful batch update through the same persistence boundary', async function() {
  const f = await fixture(), before = await f.db.matches.findOne_async({ _id: 'one' });
  const after = structuredClone(before);after.setup.state = 'preparation';after.setup.preparation_call_timestamp = f.app.time;
  const change = { id: 'one', before, after, update: { $set: { setup: after.setup } } };
  await require('../bts/btp_planner/batch_writes').write(f.db.matches, [change], entry => ({ _id: entry.id }));
  const entries = await f.entries();
  assert.strictEqual(entries.length, 1);assert.strictEqual(entries[0].type, 'preparation_called');
 });

 it('discards staged batch changes that are rolled back before persistence', async function() {
  const f = await fixture(), before = await f.db.matches.findOne_async({ _id: 'one' });
  const after = structuredClone(before);after.setup.state = 'preparation';after.setup.preparation_call_timestamp = f.app.time;
  const changes = [{ id: 'one', before, after, update: { $set: { setup: after.setup } } },
   { id: 'missing', before: { _id: 'missing' }, after: { _id: 'missing' }, update: { $set: { invalid: true } } }];
  await assert.rejects(require('../bts/btp_planner/batch_writes').write(f.db.matches, changes, entry => ({ _id: entry.id })), /lost/);
  assert.deepStrictEqual(await f.entries(), []);
  assert.strictEqual((await f.db.matches.findOne_async({ _id: 'one' })).setup.state, 'scheduled');
 });

 it('returns only the requested tournament and match, even after restarting the protocol listener', async function() {
  const f = await fixture();
  await f.update({ 'setup.preparation_call_deferred': true });
  await promisify(f.db.logs.insert.bind(f.db.logs))({ kind: 'match_protocol', tournament_key: 'different', match_id: 'one', text: 'Other tournament' });
  protocol.attach({ ...f.app });
  const response = await f.request(protocol.handle_get);
  assert.strictEqual(response.events.length, 1);
  await assert.rejects(f.request(protocol.handle_get, { tournament_key: 'different' }), /Match not found/);
 });

 it('persists real playback receipts once and distinguishes server audio and browser speech', async function() {
  const f = await fixture();
  for (let count = 0; count < 2; count++) await f.request(protocol.handle_playback, { claim_key: 'match_called_on_court:one:123', provider: 'server' });
  await f.request(protocol.handle_playback, { claim_key: 'match_preparation_call:one:124', provider: 'browser' });
  const events = await f.entries();
  assert.strictEqual(events.length, 2);
  assert(events.some(event => event.text.startsWith('Spielaufruf mit Serveraudio abgespielt')));
  assert(events.some(event => event.text.startsWith('Vorbereitungsaufruf mit Browserstimme abgespielt')));
  await assert.rejects(f.request(protocol.handle_playback, { claim_key: 'invalid', provider: 'server' }), /Invalid/);
  await assert.rejects(f.request(protocol.handle_playback, { claim_key: 'match_called_on_court:one:123', provider: 'other' }), /Invalid/);
 });

 it('keeps the same audio call separate for each device and deduplicates its tabs and reconnects', async function() {
  const f = await fixture();
  const receipt = { claim_key: 'match_called_on_court:one:123', provider: 'server', device_id: 'device-atlantis' };
  const atlantis = { hostname: 'atlantis', _socket: { remoteAddress: '::ffff:192.168.1.10' } };
  await f.request(protocol.handle_playback, receipt, atlantis);
  await f.request(protocol.handle_playback, receipt, { ...atlantis });
  await f.request(protocol.handle_playback, { ...receipt, device_id: 'device-borealis' }, { hostname: 'borealis', _socket: { remoteAddress: '192.168.1.11' } });
  const events = await f.entries();
  assert.strictEqual(events.length, 2);
  assert(events.some(event => event.text.endsWith('atlantis (192.168.1.10)') && event.device.id === 'device-atlantis'));
  assert(events.some(event => event.text.endsWith('borealis (192.168.1.11)') && event.device.id === 'device-borealis'));
 });
});
