'use strict';

const {randomInt, randomUUID} = require('crypto');
const scoring = require('../static/js/match_scoring');
const queue = require('./update_queue');
const manager = require('./btp_manager');
const plans = new Map(), running = new Set();
const PLAN_LIFETIME = 10 * 60 * 1000;

function validate(value) {
 if (value?.mode === 'number' && Number.isSafeInteger(value.number) && value.number > 0) return {mode:'number',number:value.number};
 if (value?.mode === 'time' && typeof value.time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.time)) {
  const date = new Date(value.time + ':00Z');
  if (Number.isFinite(date.getTime()) && date.toISOString().slice(0,16) === value.time) return {mode:'time',time:value.time};
 }
 throw new Error('Bitte eine positive Spielnummer oder ein gültiges Datum mit Uhrzeit angeben.');
}
function within(match, limit) {
 const setup = match.setup || {};
 if (limit.mode === 'number') return Number(setup.match_num) > 0 && Number(setup.match_num) <= limit.number;
 const time = setup.scheduled_date && setup.scheduled_time_str && setup.scheduled_date + 'T' + setup.scheduled_time_str;
 return !!time && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(time) && time.slice(0,16) <= limit.time;
}
function available(match) {
 const setup = match.setup;
 return !!setup && setup.is_match !== false && !setup.now_on_court && !['oncourt','finished'].includes(setup.state) &&
  !match.btp_needsync && !match.btp_call_pending && !match.btp_participant_conflict && !setup.called_timestamp &&
  !require('./match_results_reset').has_result(match) && !Number(match.btp_score_status) &&
  !require('../static/js/btp_entry_status').blocked_players(match).length &&
  !!match.btp_match_ids?.length && (setup.incomplete || ready(match));
}
function ready(match) {
 const size = match.setup?.is_doubles ? 2 : 1;
 return !match.setup?.incomplete && match.setup?.teams?.length === 2 &&
  match.setup.teams.every(team => team.players?.length === size && team.players.every(player => Number(player.btp_id) > 0));
}
function identity(match) {
 return JSON.stringify((match.btp_match_ids || []).map(id => [id.id,id.draw,id.planning]));
}
function generate(setup, tournament, random = randomInt) {
 const format = scoring.normalize_setup_for_calc(setup,tournament).scoring_format;
 if (!Number.isInteger(format.numSets) || format.numSets < 1 || format.numSets > 9 || format.numSets % 2 !== 1 ||
  [format.set_points,format.last_set_points].some(points => !Number.isInteger(points.end_points) || !Number.isInteger(points.max_points) ||
   points.end_points < 1 || points.max_points < points.end_points || points.max_points > 1000)) throw new Error('Das Punktsystem dieses Spiels wird für Zufallsergebnisse nicht unterstützt.');
 const wins = [0,0], sets = [], required = Math.floor(format.numSets / 2) + 1;
 while (Math.max(...wins) < required) {
  const winner = random(2), points = sets.length === format.numSets - 1 ? format.last_set_points : format.set_points;
  // Include ordinary scores and extensions, ending exactly on the winning rally.
  const loserScore = random(points.max_points), winnerScore = Math.min(points.max_points,Math.max(points.end_points,loserScore + 2));
  sets.push(winner === 0 ? [winnerScore,loserScore] : [loserScore,winnerScore]);wins[winner]++;
 }
 return {network_score:sets,team1_won:wins[0] > wins[1],score_status:'normal'};
}
async function tournament(app,key) {
 if (typeof key !== 'string' || !key) throw new Error('Ungültiges Turnier.');
 const current = await app.db.tournaments.findOne_async({key});
 if (!current) throw new Error('Turnier nicht gefunden.');
 if (!current.btp_enabled || current.btp_readonly || manager.get_status(key)?.status !== 'connected') throw new Error('BTP muss schreibend verbunden sein.');
 return current;
}
async function preview(app,key,value) {
 const limit = validate(value);await tournament(app,key);
 const matches = (await app.db.matches.find_async({tournament_key:key})).filter(match => within(match,limit));
 const selected = matches.filter(available).sort((a,b) => limit.mode === 'time'
  ? (a.setup.scheduled_date + a.setup.scheduled_time_str).localeCompare(b.setup.scheduled_date + b.setup.scheduled_time_str) || Number(a.setup.match_num) - Number(b.setup.match_num)
  : Number(a.setup.match_num) - Number(b.setup.match_num));
 for (const [token,plan] of plans) if (plan.expires < Date.now()) plans.delete(token);
 while (plans.size >= 100) plans.delete(plans.keys().next().value);
 const token = randomUUID();
 plans.set(token,{key,limit,expires:Date.now() + PLAN_LIFETIME,matches:selected.map(match => ({id:match._id,identity:identity(match)}))});
 return {token,count:selected.length,skipped:matches.length - selected.length,waiting:selected.filter(match => !ready(match)).length,
  matches:selected.slice(0,100).map(match => ({number:match.setup.match_num,event:match.setup.event_name || '',
   teams:(match.setup.teams || []).map(team => (team.players || []).map(player => player.name).join(' / ')).join(' – '),waiting:!ready(match)}))};
}
async function execute(app,key,token) {
 const plan = plans.get(token);
 if (!plan || plan.key !== key || plan.expires < Date.now()) throw new Error('Die Vorschau ist abgelaufen. Bitte eine neue Vorschau erstellen.');
 if (running.has(key)) throw new Error('Für dieses Turnier läuft bereits ein Zufallslauf.');
 await tournament(app,key);
 // Recheck after the asynchronous connection validation; a double click must
 // never run the same plan twice, even from different admin connections.
 if (running.has(key) || !plans.has(token)) throw new Error('Dieser Zufallslauf wurde bereits gestartet.');
 plans.delete(token);running.add(key);
 const remaining = new Map(plan.matches.map(match => [match.id,match.identity]));
 let changed = 0, unresolvedReads = 0;
 try {
  await manager.sync_random_results(key);
  while (remaining.size) {
   const result = await queue.execute_locked([queue.lock_keys.tournament(key)],queue.named('debug_random_results_' + key,async () => {
    const current = await tournament(app,key), all = await app.db.matches.find_async({tournament_key:key});
    const byId = new Map(all.map(match => [match._id,match])), batch = [];
    for (const [id,expected] of remaining) {
     const match = byId.get(id);
     if (!match || identity(match) !== expected || !within(match,plan.limit) || !available(match)) {remaining.delete(id);continue;}
     if (ready(match)) batch.push({...match,...generate(match.setup,current)});
     if (batch.length === 16) break;
    }
    if (!batch.length) return null;
    const written = await manager.write_random_results(key,batch);
    for (const match of batch) remaining.delete(match._id);
    return written;
   }));
   if (!result) {
    // BTP can publish a winner before resolving the next draw's entries.
    if (!remaining.size || ++unresolvedReads >= 3) break;
    await new Promise(resolve => setTimeout(resolve,250));
    await manager.sync_random_results(key);continue;
   }
   unresolvedReads = 0;
   changed += result.changed;
   // Never await integration while holding the tournament lock: the ordinary
   // importer needs it to resolve winners, group standings and subsequent games.
   await manager.sync_random_results(key);
  }
  return {changed,skipped:plan.matches.length - changed};
 } catch (error) {
  changed += error.confirmed || 0;
  let syncFailed = false;
  try {await manager.sync_random_results(key);} catch (_) {syncFailed = true;}
  throw new Error('Zufallslauf abgebrochen. ' + changed + ' Ergebnisse in BTP bestätigt. ' + error.message +
   (syncFailed ? ' Der Abgleich nach BTS ist noch offen; bitte BTP erneut abgleichen.' : ' Der BTP-Stand wurde nach BTS abgeglichen.') +
   ' Bei einem Übertragungsfehler können weitere Ergebnisse bereits in BTP angekommen sein.');
 } finally {running.delete(key);}
}
module.exports = {validate,within,available,ready,generate,preview,execute};
