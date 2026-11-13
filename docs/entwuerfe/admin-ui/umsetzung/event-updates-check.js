'use strict';
/* eslint-disable no-console -- Isolated native browser regression report. */
const assert=require('assert'),fs=require('fs'),path=require('path'),server=require('../../../../bts/admin_response/event_updates');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 const negotiated=await c.evaluate('(()=>{const original=window.send,requests=[];window.send=message=>requests.push(message);try{ctournament.switch_tournament(\'preview\',()=>{});return requests[0]?.events_delta===2;}finally{window.send=original;}})()');
 assert(negotiated,'The current browser negotiates compact event updates');
 await c.evaluate(`(()=>{
  const qa=window.__eventQA={receipts:[],serial:0,requests:[]};
  qa.score=document.querySelector('.courts_container .match_score');qa.name=document.querySelector('.courts_container .player').firstChild;
  qa.unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__eventQA)qa.receipts.push(receipt);});
  qa.connection=conn(()=>{},message=>crouting.on_change(message));
  qa.receive=value=>{const serial=++qa.serial;qa.connection._test_handle_message({data:JSON.stringify({type:'change',tournament_key:'preview',ctype:'update_btp_events',val:value,__eventQA:serial})});return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Event receipt did not settle')),4000);const frame=()=>{const found=qa.receipts.find(receipt=>receipt.message.__eventQA===serial);if(found){clearTimeout(timeout);resolve(found);}else requestAnimationFrame(frame);};requestAnimationFrame(frame);});};
 })()`);
 const data={events:Array.from({length:24},(_,id)=>({id,name:'Event '+id,is_drawn:true,match_count:1,stages:[{id:id+1000,stage_type:1,entries:Array.from({length:50},(_,id)=>({id,team:{players:[{name:'Player '+id}]}}))}]}))};
 const ws={},ticket=server.begin(ws,'preview',2),full=server.prepare({events:data})(ws,'preview');server.finish(ticket,{events:data});
 const seeded=await c.evaluate('__eventQA.receive('+JSON.stringify(full)+')');assert.strictEqual(seeded.status,'presented');
 const changed=structuredClone(data);changed.events[4].stages[0].entries[2].team.players[0].name='Neu angemeldet';
 const delta=server.prepare({events:changed})(ws,'preview');assert(delta.events_delta);assert.strictEqual(delta.events_delta.patched?.length,1,'A single changed entry uses a bounded field patch');
 const receipt=await c.evaluate('__eventQA.receive('+JSON.stringify(delta)+')');assert.strictEqual(receipt.status,'presented');
 assert(receipt.message.val.events_delta&&!receipt.message.val.events,'The receipt retains the actual compact wire payload');
 assert.strictEqual(await c.evaluate('JSON.stringify(curt.events)'),JSON.stringify(changed),'The ordinary handlers see the complete new catalog');
 assert(await c.evaluate('__eventQA.score===document.querySelector(".courts_container .match_score")&&__eventQA.name.isConnected'),'Catalog updates preserve the current score and player objects');
 const small=JSON.stringify(delta).length,large=JSON.stringify(full).length;assert(small<large/8,'A single discipline edit should not resend the complete catalog');
 await c.evaluate('(()=>{const qa=__eventQA;qa.send=window.send;window.send=(message,callback)=>message.type===\'tournament_get\'?qa.requests.push({message,callback}):qa.send(message,callback);})()');
 const broken=structuredClone(delta);broken.events_delta.base='missing-revision';
 await c.evaluate('__eventQA.receive('+JSON.stringify(broken)+')');
 await new Promise(resolve=>setTimeout(resolve,180));
 assert(await c.evaluate('__eventQA.requests.length===1&&__eventQA.requests[0].message.events_delta===2'),'A missing baseline requests one authoritative recovery snapshot');
 assert.strictEqual(await c.evaluate('JSON.stringify(curt.events)'),JSON.stringify(changed),'A rejected delta must not partially change the live catalog');
 await c.evaluate('(()=>{const qa=__eventQA;qa.requests[0].callback(null,{tournament:structuredClone(curt)});window.send=qa.send;qa.unsubscribe();})()');
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'Compact catalog updates have no browser exceptions');
 const result={checks:8,full_bytes:large,delta_bytes:small,receipt_status:receipt.status,jobs:receipt.ui_jobs.map(job=>job.name)};
 fs.writeFileSync(path.join(previews,'event-updates-verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
};
