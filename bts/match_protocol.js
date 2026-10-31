'use strict';

const crypto = require('crypto');
const uuid = require('uuid/v4');
const { calls, parseClaim } = require('../static/js/announcement_text');
const call_kinds = new Set(Object.values(calls).map(call => call.kind));
const attached = new WeakSet();
const hostnames = new Map();
const now = app => app.clock?.now_ms() ?? Date.now();
const valid_time = value => Number.isFinite(Number(value)) && Number(value) > 0;
const list = people => Array.isArray(people) ? people.filter(Boolean) : [];
const names = people => list(people).map(person => person.name || [person.firstname, person.lastname || person.surname].filter(Boolean).join(' ')).filter(Boolean).join(' / ');
const people_key = people => JSON.stringify(list(people).map(person => [person.btp_id ?? person._id ?? null, person.name, person.firstname, person.lastname || person.surname]));
const present = setup => !!(Array.isArray(setup.teams) && setup.teams.length === 2 && setup.teams.every(team => Array.isArray(team?.players) && team.players.length && team.players.every(player => player?.checked_in === true)));

function transitions(before, after, timestamp, court_label = id => id) {
 if (!before?.setup || !after?.setup || before.tournament_key !== after.tournament_key) return [];
 const old = before.setup, setup = after.setup, events = [];
 const add = (type, text, time = timestamp) => events.push({ type, text, timestamp: Number(time) });
 const lastPress = after.presses?.at(-1);
 if (lastPress?.type === 'note' && JSON.stringify(lastPress) !== JSON.stringify(before.presses?.at(-1))) {
  const role = require('../static/js/scoresheet_remarks').roleLabel(lastPress.note_role || 'umpire');
  add(lastPress.note_deleted ? 'umpire_remarks_deleted' : lastPress.note_target ? 'umpire_remarks_changed' : 'umpire_remarks',
   (lastPress.note_deleted ? 'Bemerkung gelöscht · ' : lastPress.note_target ? 'Bemerkung korrigiert · ' : 'Bemerkung ergänzt · ') + role + ': ' + lastPress.val, lastPress.timestamp || timestamp);
 }
 const finished = setup.state === 'finished' || typeof after.team1_won === 'boolean';
 if (setup.state === 'preparation' && valid_time(setup.preparation_call_timestamp) && setup.preparation_call_timestamp !== old.preparation_call_timestamp) {
  add('preparation_called', 'Spiel in Vorbereitung aufgerufen', setup.preparation_call_timestamp);
 }
 if (!finished && !setup.now_on_court && present(old) !== present(setup)) {
  add(present(setup) ? 'players_present' : 'players_absent', present(setup) ? 'Paarungen vollständig anwesend' : 'Anwesenheit der Paarungen zurückgenommen');
 }
 const court_changed = (old.court_id || null) !== (setup.court_id || null);
 const tablet_changed = people_key(old.tabletoperators) !== people_key(setup.tabletoperators);
 if (court_changed && tablet_changed && setup.court_id && setup.tabletoperators?.length) {
  add('assignment', 'Feld und Tabletbedienung zugewiesen · Feld ' + court_label(setup.court_id) + ' · ' + names(setup.tabletoperators));
 } else {
  if (court_changed) add('court_assignment', setup.court_id ? 'Feld ' + court_label(setup.court_id) + ' zugewiesen' : 'Feldzuweisung aufgehoben');
  if (tablet_changed) add('tablet_assignment', setup.tabletoperators?.length ? 'Tabletbedienung zugewiesen · ' + names(setup.tabletoperators) : 'Tabletbedienung freigegeben');
 }
 for (const [role, label] of [['umpire', 'Schiedsrichter'], ['service_judge', 'Aufschlagrichter']]) {
  if (people_key(old[role] ? [old[role]] : []) !== people_key(setup[role] ? [setup[role]] : [])) {
   add(role + '_assignment', setup[role] ? label + ' zugewiesen · ' + names([setup[role]]) : label + ' freigegeben');
  }
 }
 if (!finished && setup.now_on_court && valid_time(setup.called_timestamp) && (!old.now_on_court || setup.called_timestamp !== old.called_timestamp)) {
  add('called_on_court', 'Spiel auf Feld ' + court_label(setup.court_id) + ' aufgerufen', setup.called_timestamp);
 } else if (!finished && old.now_on_court && !setup.now_on_court) add('call_cancelled', 'Feldaufruf zurückgenommen');
 if (!finished && !!old.preparation_call_deferred !== !!setup.preparation_call_deferred) {
  add('preparation_deferred', setup.preparation_call_deferred ? 'Vorbereitung zurückgestellt' : 'Vorbereitung wieder freigegeben');
 }
 return events;
}

function write(app, key, match_id, events) {
 if (!events.length) return;
 const recorded_ts = Date.now();
 const documents = events.map((event, order) => ({ _id: uuid(), kind: 'match_protocol', tournament_key: key, match_id, recorded_ts, order, ...event }));
 for (const document of documents) app.db.logs.insert(document, (error, saved) => {
  if (error?.errorType === 'uniqueViolated') return;
  if (error) { console.warn('[bts] match protocol could not be saved:', error.message); return; } // eslint-disable-line no-console
  require('./admin').notify_change(app, key, 'match_protocol_event', { match_id, event: saved });
 });
}

function attach(app) {
 const store = app.db?.matches;
 if (!store?.updateIndexes || !store.persistence?.persistNewState || !app.db.logs || attached.has(store)) return;
 attached.add(store);
 const pending = new WeakMap(), update = store.updateIndexes, persist = store.persistence.persistNewState;
 store.updateIndexes = function(old, next) {
  const result = update.apply(this, arguments);
  for (const pair of Array.isArray(old) ? old : [{ oldDoc: old, newDoc: next }]) {
   const events = transitions(pair.oldDoc, pair.newDoc, now(app), id => app.db.model?.tournament(pair.newDoc.tournament_key).courts.get(String(id))?.data?.num || id);
   if (events.length) pending.set(pair.newDoc, events);
  }
  return result;
 };
 store.persistence.persistNewState = function(documents, callback) {
  return persist.call(this, documents, error => {
   for (const document of documents) {
    const events = pending.get(document);pending.delete(document);
    // Index staging and failed/rolled-back batches must never create history.
    // History has its own append queue and does not hold up point receipts.
    if (!error && events) write(app, document.tournament_key, document._id, events);
   }
   if (callback) callback(error);
  });
 };
}

function handle_get(app, ws, msg) {
 if (!msg.tournament_key || !msg.match_id) return ws.respond(msg, new Error('Missing tournament_key or match_id'));
 app.db.matches.findOne({ tournament_key: msg.tournament_key, _id: msg.match_id }, (error, match) => {
  if (error || !match) return ws.respond(msg, error || new Error('Match not found in tournament'));
  app.db.logs.find({ kind: 'match_protocol', tournament_key: msg.tournament_key, match_id: msg.match_id }).sort({ timestamp: 1, recorded_ts: 1, order: 1 }).exec((error, events) => {
   ws.respond(msg, error, { tournament_key: msg.tournament_key, match_id: msg.match_id, events });
  });
 });
}

function handle_playback(app, ws, msg) {
 const claim = parseClaim(msg.claim_key);
 if (!claim || !['server', 'browser'].includes(msg.provider) || !msg.tournament_key) return ws.respond(msg, new Error('Invalid match playback receipt'));
 const { match_id } = claim;
 app.db.matches.findOne({ tournament_key: msg.tournament_key, _id: match_id }, async (error, match) => {
  if (error || !match) return ws.respond(msg, error || new Error('Match not found in tournament'));
  const timestamp = now(app), device = await device_info(ws, msg);
  const _id = 'match-audio-' + crypto.createHash('sha256').update(JSON.stringify([msg.tournament_key, msg.claim_key, device.id])).digest('hex');
  const label = device.hostname || device.ip || 'Gerät ' + device.id.slice(0, 8);
  const text = claim.label + (msg.provider === 'server' ? ' mit Serveraudio abgespielt' : ' mit Browserstimme abgespielt') + ' · ' + label + (device.ip && label !== device.ip ? ' (' + device.ip + ')' : '');
  write(app, msg.tournament_key, match_id, [{ _id, type: 'audio_played', timestamp, text, device, call_id: claim.id, call_kind: claim.kind, requested_at: claim.requested_at }]);
  ws.respond(msg);
 });
}

async function device_info(ws, msg) {
 const ip = String(ws._socket?.remoteAddress || '').replace(/^::ffff:/, '');
 const supplied = String(msg.device_id || '');
 const id = /^[a-zA-Z0-9_-]{8,100}$/.test(supplied) ? supplied : ip || 'unknown';
 let hostname = ws.hostname || null;
 if (!hostname && ip) {
  if (!hostnames.has(ip)) {
   if (hostnames.size >= 256) hostnames.delete(hostnames.keys().next().value);
   hostnames.set(ip, new Promise(resolve => {
    if (ip === '127.0.0.1' || ip === '::1') return resolve(require('os').hostname());
    const timeout = setTimeout(() => resolve(null), 300);
    require('dns').reverse(ip, (error, names) => { clearTimeout(timeout);resolve(error ? null : names?.[0] || null); });
   }));
  }
  hostname = await hostnames.get(ip);
 }
 return { id, hostname, ip: ip || null };
}

function identify_announcement(type, payload) {
 if (!payload || !call_kinds.has(type)) return payload;
 const match_id = payload.match__id || payload.match_id || payload.match?._id || payload._id || payload.setup?._match_id;
 if (!match_id || payload._announcement_claim_key) return payload;
 return { ...payload, _announcement_claim_key: type + ':' + match_id + ':' + payload._announcement_ts + ':' + uuid() };
}

module.exports = { attach, transitions, handle_get, handle_playback, identify_announcement };
