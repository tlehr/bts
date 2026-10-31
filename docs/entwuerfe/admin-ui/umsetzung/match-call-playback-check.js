'use strict';

const assert=require('assert');
const {promisify}=require('util');
const admin=require('../../../../bts/admin');
const protocol=require('../../../../bts/match_protocol');
const {calls}=require('../../../../static/js/announcement_text');

// Exercise native server fanout/handlers, the real browser change dispatcher,
// text builders and playback queue, then store/display the resulting receipt.
// Only the audio device itself is a fixture; all data is isolated in memory.
module.exports=async function({c,verify,capture}) {
 const db=await require('../../../../bts/database').init_test(),app={db},messages=[];
 const viewer={sendmsg:message=>messages.push(structuredClone(message))};
 const request=(handler,values,peer={})=>new Promise((resolve,reject)=>handler(app,{...peer,respond:(_msg,error,response)=>error?reject(error):resolve(response)},values));
 const match=await c.evaluate('(()=>{const match=structuredClone(curt.matches.find(match=>match._id===\'match-44\'));Object.assign(match.setup,{umpire:{name:\'Hans Heinrich\'},service_judge:{name:\'Bertha Baller\'},tabletoperators:[{name:\'Theo Lang\'}]});return match})()');
 await promisify(db.matches.insert.bind(db.matches))(match);
 await c.evaluate('localStorage.setItem(\'enable_announcement_calls_CH\',\'true\');localStorage.setItem(\'enable_announcement_preparations_CH\',\'true\');curt.announcement_pause_time_ms=.001;window.__allCallReceipts=()=>__writes.filter(message=>message.type===\'match_protocol_playback\');window.__allCallStart=__allCallReceipts().length;');
 admin.on_connect(app,viewer);
 let count=0,previous;
 try {
  for(const {kind,label}of Object.values(calls)) {
   const start=messages.length;
   if(/^(?:second_|begin_to_play)/.test(kind))await request(admin['handle_'+kind],{tournament_key:'preview',match_id:match._id,setup:match.setup});
   else admin.notify_change(app,'preview',kind,kind==='match_preparation_call'||kind==='match_no_match_announcement'?{match__id:match._id,match,winning_team_index:0}:match);
   const message=messages.slice(start).find(message=>message.ctype===kind);
   assert(message,'Native announcement exists for '+kind);
   count++;
   const provider=count%2?'server':'browser';
   await c.evaluate('window.__speechPlaybackResult='+JSON.stringify({status:'ok',provider,started:true})+';crouting.on_change('+JSON.stringify(message)+')');
   // Layout frames do not wait for the asynchronous Web Lock or audio queue.
   await c.evaluate('(async()=>{const until=performance.now()+2000;while(__allCallReceipts().length<__allCallStart+'+count+'&&performance.now()<until)await new Promise(resolve=>setTimeout(resolve,20));})()');
   await verify('Native '+kind+' keeps its game identity through actual playback','__allCallReceipts().length===__allCallStart+'+count+'&&__allCallReceipts().at(-1).claim_key==='+JSON.stringify(message.val._announcement_claim_key)+'&&__allCallReceipts().at(-1).provider==='+JSON.stringify(provider));
   const receipt=await c.evaluate('__allCallReceipts().at(-1)');
   await request(protocol.handle_playback,receipt,{hostname:'Hallensprecher',_socket:{remoteAddress:'192.168.1.20'}});
   const saved=(await db.logs.find_async({kind:'match_protocol',call_id:receipt.claim_key}))[0];
   assert.strictEqual(saved.call_kind,kind);assert(saved.text.startsWith(label));
   await c.evaluate('crouting.on_change('+JSON.stringify({ctype:'match_protocol_event',tournament_key:'preview',val:{match_id:match._id,event:saved}})+')');
   await verify('The '+kind+' playback appears separately with time and device','[...document.querySelectorAll(\'.ls-protocol-entry\')].some(row=>row.textContent.includes('+JSON.stringify(saved.text)+')&&row.querySelector(\'time\').dateTime==='+JSON.stringify(new Date(saved.timestamp).toISOString())+')');
   previous=message;
  }
  await c.evaluate('crouting.on_change('+JSON.stringify(previous)+')');
  await verify('Replaying an already received call does not create another device receipt','__allCallReceipts().length===__allCallStart+'+count);
  const message={...previous,val:{...previous.val,_announcement_claim_key:'match_preparation_call:match-44:1000:disabled'}};
  message.ctype='match_preparation_call';message.val={match__id:match._id,match,_announcement_claim_key:message.val._announcement_claim_key};
  await c.evaluate('localStorage.setItem(\'enable_announcement_preparations_CH\',\'false\');crouting.on_change('+JSON.stringify(message)+')');
  await verify('A device with preparation audio switched off does not claim successful playback','__allCallReceipts().length===__allCallStart+'+count);
  await c.evaluate('localStorage.setItem(\'enable_announcement_preparations_CH\',\'true\');delete window.__speechPlaybackResult');
  await capture('spiel-dialog-alle-aufrufe');
 } finally {admin.on_close(app,viewer);}
};
