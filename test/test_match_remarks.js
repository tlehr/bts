'use strict';
const assert = require('assert');
const {promisify} = require('util');
const database = require('../bts/database');
const admin = require('../bts/admin');
const protocol = require('../bts/match_protocol');
const report = require('../static/js/scoresheet_remarks');

async function fixture(finished = true) {
 const db = await database.init_test(), app = {db,clock:{now_ms:()=>12345678}};
 const match = {_id:'one',tournament_key:'example',presses:[{type:'score',team:0,timestamp:10},
  {type:'note',val:'BUP: Unterbrechung',timestamp:11},{type:'postmatch-confirm',timestamp:12}],network_score:[[21,14],[21,15]],
  setup:{state:finished?'finished':'oncourt',now_on_court:!finished,court_id:'court-1',teams:[],umpire:{name:'Umpire'},tabletofficial:'Player'}};
 if(finished){match.team1_won=true;match.end_ts=123;}
 else {
  Object.assign(match.setup,{is_match:true,is_doubles:false,counting:'3x21',teams:[{players:[{name:'Alice'}]},{players:[{name:'Bob'}]}]});
  match.presses=[{type:'pick_side',team1_left:true,timestamp:1},{type:'love-all',timestamp:2},{type:'score',side:'left',timestamp:10}];
  match.network_score=[[1,0]];
 }
 await promisify(db.matches.insert.bind(db.matches))(match);
 await promisify(db.courts.insert.bind(db.courts))({_id:'court-1',tournament_key:'example',match_id:finished?null:'one',num:1});
 await promisify(db.tournaments.insert.bind(db.tournaments))({key:'example',btp_enabled:false,automation_enabled:false,tabletoperator_enabled:false});
 protocol.attach(app);
 const read = () => db.matches.findOne_async({_id:'one'});
 const request = (values = {},handler = admin.handle_match_remarks_save) => new Promise((resolve,reject) => handler(app,
  {respond:(_msg,error,result)=>error?reject(error):resolve(result)},
  {type:'match_remarks_save',tournament_key:'example',match_id:'one',remark_id:'note-one',remark:'Bemerkung',...values}));
 return {db,app,match,read,request};
}

describe('Official remarks appended to the BUP history', function() {
 it('appends one BUP-compatible note after match completion without changing any result or previous press',async function() {
  const f=await fixture(),before=await f.read(),messages=[],viewer={sendmsg:message=>messages.push(message)};
  admin.on_connect(f.app,viewer);
  try {
   const response=await f.request({remark:'  Erste Zeile\r\nZweite Zeile  '}),after=await f.read();
   const note={type:'note',val:'Erste Zeile\nZweite Zeile',timestamp:12345678,note_id:'note-one',source:'tournament-control',note_role:'umpire',score:before.network_score};
   assert.deepStrictEqual(after,{...before,presses:[...before.presses,note]});
   assert.deepStrictEqual(response,{match_id:'one',presses:after.presses});
   assert(!Object.hasOwn(after,'scoresheet_notes'));
   assert.strictEqual(messages.filter(message=>message.ctype==='match_remarks').length,1);
   assert(!messages.some(message=>['score','match_edit','court_current_match'].includes(message.ctype)));
   const entries=await f.db.logs.find_async({kind:'match_protocol',match_id:'one'});
   assert(entries.some(entry=>entry.type==='umpire_remarks'));
  } finally {admin.on_close(f.app,viewer);}
 });
 it('records the live score without ending, moving or changing the game',async function() {
  const f=await fixture(false),before=await f.read();
  await f.request();const after=await f.read();
  assert.deepStrictEqual(after.presses.at(-1).score,[[1,0]]);
  assert.deepStrictEqual(after.setup,before.setup);assert.strictEqual(after.end_ts,undefined);
  assert.deepStrictEqual(after.presses.slice(0,-1),before.presses);
  assert.strictEqual((await f.db.courts.findOne_async({_id:'court-1'})).match_id,'one');
 });
 it('preserves parallel additions from different users',async function() {
  const f=await fixture();
  await Promise.all([f.request({remark:'First'}),f.request({remark:'Second',remark_id:'note-two'})]);
  assert.deepStrictEqual((await f.read()).presses.slice(-2).map(press=>press.val),['First','Second']);
 });
 it('deduplicates retries without adding a second note or protocol event',async function() {
  const f=await fixture();await Promise.all([f.request(),f.request()]);
  await f.request();
  assert.strictEqual((await f.read()).presses.filter(press=>press.note_id==='note-one').length,1);
  const events=await f.db.logs.find_async({kind:'match_protocol',match_id:'one',type:'umpire_remarks'});
  assert.strictEqual(events.length,1);
  await assert.rejects(f.request({remark:'Changed retry'}),/andere Bemerkung/);
 });
 it('rejects invalid input and cross-tournament requests without mutation',async function() {
  const f=await fixture(),before=await f.read();
  for(const values of [{remark:'x'.repeat(4001)},{remark:'  '},{remark:{}},{remark_id:undefined},{remark_id:{$ne:null}},
   {tournament_key:'other'},{match_id:'missing'},{match_id:{$ne:null}}]) {
   await assert.rejects(f.request(values));assert.deepStrictEqual(await f.read(),before);
  }
 });
 it('reports persistence failures without recording a successful protocol event',async function() {
  const f=await fixture();
  f.db.matches.persistence.persistNewState=(_documents,callback)=>callback(new Error('Synthetic disk failure'));
  await assert.rejects(f.request(),/disk failure/);
  assert.strictEqual((await f.db.logs.find_async({kind:'match_protocol'})).length,0);
 });
 it('saves combined color and remark edits for a completed game',async function() {
  const f=await fixture(),before=await f.read();
  await f.request({id:'one',match:{...before,setup:{...before.setup,override_colors:{bg0:'#123456'}}},old_court:'court-1',remark:'Official note'},admin.handle_match_edit);
  const after=await f.read();
  assert.strictEqual(after.presses.at(-1).val,'Official note');
  assert.deepStrictEqual(after.setup.override_colors,{bg0:'#123456'});
  assert.deepStrictEqual(after.presses.slice(0,-1),before.presses);
 });
 it('validates the note before any combined metadata edit',async function() {
  const f=await fixture(),before=await f.read();
  await assert.rejects(f.request({id:'one',match:{...before,setup:{...before.setup,override_colors:{bg0:'#123456'}}},old_court:'court-1',remark:' '},admin.handle_match_edit));
  assert.deepStrictEqual(await f.read(),before);
 });
 it('moves remarks from the first dialog version into note presses on the next addition',async function() {
  const f=await fixture();await f.db.matches.update_async({_id:'one'},{$set:{scoresheet_notes:'Previous dialog remark'}},{});
  assert(report.text(await f.read()).includes('Previous dialog remark'));
  await f.request();
  const after=await f.read();
  assert(!Object.hasOwn(after,'scoresheet_notes'));
  assert.deepStrictEqual(after.presses.slice(-2).map(press=>press.val),['Previous dialog remark','Bemerkung']);
  await f.request();assert.strictEqual((await f.read()).presses.length,after.presses.length);
 });
 for(const version of ['bupws','bupws_v2']) it('keeps appended notes when '+version+' resends a stale finish for a released court',async function() {
  const f=await fixture();await f.request();const before=await f.read(),messages=[];
  const ws={readyState:1,court_id:'court-1',sendmsg:message=>messages.push(message),send:message=>messages.push(message),_socket:{remoteAddress:'127.0.0.1'}};
  await require('../bts/'+version).handle_score_update(f.app,ws,{tournament_key:'example',score:{match_id:'one',court_id:'court-1',
   presses:f.match.presses,network_score:[[21,14],[21,15]],finish_confirmed:true,team1_won:true}});
  ws.readyState=3;
  assert.deepStrictEqual(await f.read(),before);assert(messages.length);
 });
 it('does not confirm the same game again just because notes follow its confirmation',async function() {
  const f=await fixture();await f.request();const before=await f.read();
  await f.request({court_id:'court-1'},admin.handle_confirm_match_finished);
  assert.deepStrictEqual((await f.read()).presses,before.presses);
 });
 it('includes notes-only reports in the bulk export',async function() {
  const f=await fixture();await f.db.matches.update_async({_id:'one'},{$set:{presses:[]}},{});await f.request();
  const reports=await f.request({},admin.handle_fetch_allscoresheets_data);
  assert(JSON.stringify(reports).includes('Bemerkung'));
 });
 it('combines BUP and tournament notes and respects undo and redo',function() {
  const presses=[{type:'note',val:'BUP'},{type:'note',val:'Undone'},{type:'undo'},
   {type:'note',val:'Tournament',source:'tournament-control'}];
  assert.strictEqual(report.text({presses}),'BUP\n\nTournament');
  assert.deepStrictEqual(report.stateForReport({presses}).presses,presses);
  const note={type:'note',val:'Restored'};
  assert.strictEqual(report.text({presses:[note,{type:'undo'},{type:'redo'}]}),'Restored');
 });
 it('keeps the native report history and undo targets intact',function() {
  const point={type:'score',side:'left'},note={type:'note',val:'Undone note'};
  const state={presses:[point,note,{type:'undo'}]};
  const preview=report.stateForReport(state);
  assert.deepStrictEqual(preview.presses,[point,note,{type:'undo'}]);
  assert.strictEqual(report.text(preview),'');
  assert.deepStrictEqual(state.presses,[point,note,{type:'undo'}]);
 });
 it('includes legacy dialog notes in the native report without mutating the saved history',function() {
  const state={presses:[{type:'note',val:'BUP'}]},match={...state,scoresheet_notes:'Previous dialog note'};
  assert.deepStrictEqual(report.stateForReport(state,match).presses,[...state.presses,{type:'note',val:'Previous dialog note',note_id:'legacy'}]);
  assert.strictEqual(state.presses.length,1);
 });
 it('corrects a BUP note by appending a version with its own time and score',async function() {
  const f=await fixture(),before=await f.read(),original=report.entries(before)[0];
  const values={remark:'Korrigierte Bemerkung',remark_target:original.key,remark_previous:original.latest_key};
  await f.request(values);const after=await f.read(),entry=report.entries(after)[0];
  assert.deepStrictEqual(after.presses.slice(0,-1),before.presses);
  assert.strictEqual(entry.val,values.remark);assert.strictEqual(entry.versions.length,2);
  assert.strictEqual(entry.versions[0].val,'BUP: Unterbrechung');
  assert.deepStrictEqual(entry.versions[1].score,before.network_score);
  await f.request(values);assert.strictEqual((await f.read()).presses.length,after.presses.length);
  const events=await f.db.logs.find_async({kind:'match_protocol',type:'umpire_remarks_changed'});
  assert.strictEqual(events.length,1);assert(events[0].text.includes(values.remark));
 });
 it('rejects conflicting or unchanged corrections without losing either original or draft',async function() {
  const f=await fixture(),entry=report.entries(await f.read())[0];
  const base={remark_target:entry.key,remark_previous:entry.latest_key};
  await assert.rejects(f.request({...base,remark:entry.val}),/unverändert/);
  const results=await Promise.allSettled([f.request({...base,remark:'First correction'}),f.request({...base,remark:'Other correction',remark_id:'other-id'})]);
  assert.strictEqual(results.filter(result=>result.status==='fulfilled').length,1);
  assert(results.find(result=>result.status==='rejected').reason.message.includes('inzwischen geändert'));
  assert.strictEqual(report.entries(await f.read())[0].versions.length,2);
 });
 it('corrects legacy dialog notes and still deduplicates a retried correction',async function() {
  const f=await fixture();await f.db.matches.update_async({_id:'one'},{$set:{scoresheet_notes:'Legacy note'}},{});
  const values={remark:'Revised legacy',remark_target:'legacy',remark_previous:'legacy'};
  await f.request(values);await f.request(values);
  const entries=report.entries(await f.read());assert.strictEqual(entries.length,2);
  assert.deepStrictEqual(entries[1].versions.map(version=>version.val),['Legacy note','Revised legacy']);
 });
 it('reconstructs the exact score for an older BUP remark before later rallies',async function() {
  const f=await fixture(false),match=await f.read();
  match.presses.push({type:'note',val:'Old BUP note',timestamp:11},{type:'score',side:'left',timestamp:12});
  const note=report.entries(match)[0];assert.deepStrictEqual(note.versions[0].score,[[1,0]]);
 });
 it('retains the original BUP wording in the audit history when a later tablet snapshot omits it',async function() {
  const f=await fixture(),before=await f.read(),original=report.entries(before)[0];
  await f.request({remark:'Revised BUP note',remark_target:original.key,remark_previous:original.latest_key});
  const after=await f.read(),merged=require('../bts/match_remarks').merge(after,before.presses.filter(press=>press.type!=='note'));
  assert.deepStrictEqual(report.entries({...after,presses:merged})[0].versions.map(version=>version.val),['BUP: Unterbrechung','Revised BUP note']);
 });
 it('serializes remarks with concurrent points and captures the score at their actual save position',async function() {
  for(const noteFirst of [true,false]) {
   const f=await fixture(false),ws={readyState:1,court_id:'court-1',sendmsg(){},send(){},_socket:{remoteAddress:'127.0.0.1'}};
   try {
    const point=()=>require('../bts/bupws_v2').handle_score_update(f.app,ws,{tournament_key:'example',score:{
     match_id:'one',court_id:'court-1',presses:[...f.match.presses,{type:'score',side:'left',timestamp:20}],network_score:[[2,0]],
    }});
    await Promise.all(noteFirst?[f.request(),point()]:[point(),f.request()]);
    const after=await f.read();assert.deepStrictEqual(after.network_score,[[2,0]]);
    assert.deepStrictEqual(after.presses.find(press=>press.note_id==='note-one').score,noteFirst?[[1,0]]:[[2,0]]);
   } finally {ws.readyState=3;}
  }
 });
 for(const version of ['bupws','bupws_v2']) it('keeps control remarks across live '+version+' points, undo, reconnect echoes and finish',async function() {
  const f=await fixture(false);await f.request();const initial=await f.read(),saved=initial.presses.at(-1),messages=[];
  const ws={readyState:1,court_id:'court-1',sendmsg:message=>messages.push(message),send:message=>messages.push(message),_socket:{remoteAddress:'127.0.0.1'}};
  const handler=require('../bts/'+version).handle_score_update;
  const presses=[...f.match.presses,{type:'score',side:'left',timestamp:20}];
  const submit=async(history,network_score,extra={})=>{
   await handler(f.app,ws,{tournament_key:'example',score:{match_id:'one',court_id:'court-1',presses:history,network_score,...extra}});
   const after=await f.read();assert.deepStrictEqual(after.presses.filter(press=>press.note_id===saved.note_id),[saved]);return after;
  };
  const next=await submit(presses,[[2,0]]);assert.deepStrictEqual(next.network_score,[[2,0]],JSON.stringify(messages));
  const undone=await submit([...presses,{type:'undo',timestamp:21}],[[1,0]]);
  assert.deepStrictEqual(require('../static/bup/dev/js/calc').remote_state({},undone.setup,undone.presses).game.score,[1,0]);
  const echo=await submit([...presses,{...saved,val:'Stale or altered tablet echo'}],[[2,0]]);
  assert.strictEqual(report.entries(echo).at(-1).val,'Bemerkung');
  const finished=await submit([...presses,{type:'resigned',team_id:1,timestamp:22},{type:'postmatch-confirm',timestamp:23}],[[21,0],[21,0]],{finish_confirmed:true,team1_won:true,end_ts:23});
  ws.readyState=3;assert.strictEqual(finished.setup.now_on_court,false);
 });
 for(const role of ['umpire','tournament_control','referee']) it('records the selected '+role+' role during and after the game',async function() {
  for(const finished of [false,true]) {
   const f=await fixture(finished),before=await f.read();await f.request({remark_role:role});const after=await f.read();
   assert.strictEqual(after.presses.at(-1).note_role,role);assert.strictEqual(after.presses.at(-1).source,'tournament-control');
   assert.deepStrictEqual(after.setup,before.setup);assert.deepStrictEqual(after.network_score,before.network_score);
   assert(report.text(after).includes((role==='umpire'?'':report.roleLabel(role)+': ')+'Bemerkung'));
   await assert.rejects(f.request({remark_role:role==='umpire'?'referee':'umpire'}),/andere Bemerkung/);
  }
 });
 it('allows role-only corrections and retains the role of each version',async function() {
  const f=await fixture();await f.request({remark_role:'referee'});const note=report.entries(await f.read()).at(-1);
  await f.request({remark_id:'role-change',remark:note.val,remark_role:'tournament_control',remark_target:note.key,remark_previous:note.latest_key});
  const changed=report.entries(await f.read()).at(-1);
  assert.deepStrictEqual(changed.versions.map(version=>version.role),['referee','tournament_control']);
  assert.strictEqual(report.text(await f.read()).split('Turnierleitung: ').length,2);
 });
 it('rejects invalid roles and deletion requests without mutating the game',async function() {
  const f=await fixture(),before=await f.read();
  for(const values of [{remark_role:'admin'},{remark_role:'constructor'},{remark_role:'__proto__'},{remark_role:{}},
   {remark_delete:'true'},{remark_delete:true},{remark_delete:true,remark_target:'missing',remark_previous:'missing'}]) {
   await assert.rejects(f.request(values));assert.deepStrictEqual(await f.read(),before);
  }
 });
 for(const finished of [false,true]) it('deletes a remark '+(finished?'after':'during')+' the game while preserving its audit history',async function() {
  const f=await fixture(finished);await f.request({remark_role:'referee'});const before=await f.read(),note=report.entries(before).at(-1);
  const deletion={remark_id:'delete-note',remark_delete:true,remark:undefined,remark_target:note.key,remark_previous:note.latest_key};
  await f.request(deletion);const after=await f.read(),deleted=report.entries(after,{includeDeleted:true}).at(-1);
  assert.deepStrictEqual(after.presses.slice(0,-1),before.presses);assert.deepStrictEqual(after.setup,before.setup);
  assert.deepStrictEqual(after.network_score,before.network_score);assert.strictEqual(after.end_ts,before.end_ts);
  assert.strictEqual(after.presses.at(-1).note_deleted,true);assert.strictEqual(deleted.role,'referee');
  assert.strictEqual(deleted.deleted,true);assert.deepStrictEqual(deleted.versions.map(version=>version.deleted),[false,true]);
  assert.deepStrictEqual(deleted.versions.at(-1).score,before.network_score);assert.strictEqual(deleted.versions.at(-1).timestamp,12345678);
  assert(!report.text(after).includes('Bemerkung'));assert(!report.entries(after).some(entry=>entry.key===note.key));
  await f.request(deletion);assert.deepStrictEqual(await f.read(),after);
  assert.strictEqual((await f.db.logs.find_async({kind:'match_protocol',type:'umpire_remarks_deleted'})).length,1);
  await assert.rejects(f.request({...deletion,remark_id:'repeat-delete'}),/gelöscht/);
  await assert.rejects(f.request({remark_id:'edit-deleted',remark:'Resurrection',remark_target:note.key,remark_previous:deleted.latest_key}),/gelöscht/);
 });
 it('does not delete a correction made after the version selected for deletion',async function() {
  const f=await fixture(),note=report.entries(await f.read())[0];
  const target={remark_target:note.key,remark_previous:note.latest_key};
  await f.request({...target,remark:'Newer version'});const before=await f.read();
  await assert.rejects(f.request({...target,remark_delete:true,remark_id:'stale-delete'}),/inzwischen geändert/);
  assert.deepStrictEqual(await f.read(),before);
 });
 it('keeps a deleted BUP note deleted across stale tablet snapshots and point undo',async function() {
  const f=await fixture(false),before=await f.read();
  const bupNote={type:'note',val:'BUP note to delete',timestamp:11,note_role:'umpire'};
  await f.db.matches.update_async({_id:'one'},{$push:{presses:bupNote}},{});
  const note=report.entries(await f.read())[0];
  await f.request({remark_id:'delete-bup',remark_delete:true,remark_target:note.key,remark_previous:note.latest_key});
  const saved=await f.read();
  for(const history of [[...before.presses,bupNote,{type:'undo'}],before.presses]) {
   const merged=require('../bts/match_remarks').merge(saved,history);
   assert.strictEqual(report.text({...saved,presses:merged}),'');
   const deleted=report.entries({...saved,presses:merged},{includeDeleted:true})[0];
   assert.strictEqual(deleted.deleted,true);assert.strictEqual(deleted.versions[0].val,bupNote.val);
  }
 });

});
