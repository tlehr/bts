'use strict';
const assert=require('assert'),{EventEmitter}=require('events'),admin=require('../bts/admin'),wshandler=require('../bts/wshandler');
const {fixture}=require('./tournament_model_fixture'),updates=require('../static/js/event_updates'),outbox=require('../bts/admin_response/outbox');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
describe('negotiated event updates through admin sockets',function(){
 it('negotiates snapshots, shares matching deltas, preserves reserved ordering and keeps legacy bytes complete',async function(){
  const {db}=await fixture(),app={db},sockets=[];
  const events={events:Array.from({length:20},(_,id)=>({id,name:'Event '+id,stages:[{entries:Array.from({length:30},(_,id)=>({id,name:'Player '+id}))}]}))};
  await db.tournaments.update_async({key:'test'},{$set:{events}},{});
  function socket(){const ws=new EventEmitter();ws.readyState=1;ws.messages=[];ws.send=(bytes,options)=>{assert.strictEqual(options.binary,false);ws.messages.push(JSON.parse(bytes.toString()));};wshandler.handle(admin,app,ws);sockets.push(ws);return ws;}
  const recipients=[socket(),socket(),socket()];
  try{
   for(const [index,ws]of recipients.entries()){
    admin.handle_tournament_get(app,ws,{key:'test',rid:'init',events_delta:index<2});
    for(let n=0;!ws.messages.some(m=>m.rid==='init');n++){assert(n<1000,'snapshot did not arrive');await turn();}
   }
   const states=recipients.map(ws=>ws.messages.find(m=>m.rid==='init').tournament);
   assert(states[0].events_revision&&states[1].events_revision);assert.strictEqual(states[2].events_revision,undefined);
   recipients.forEach(ws=>{ws.messages=[];});
   const held=recipients[0].reserve_response({rid:'held',key:'test'}),changed=JSON.parse(JSON.stringify(events));changed.events[1].name='Neu';
   const original=outbox.prepare_broadcast;let encodings=0;
   outbox.prepare_broadcast=function(...args){encodings++;return original(...args);};
   try{admin.notify_change(app,'test','update_btp_events',{events:changed});}finally{outbox.prepare_broadcast=original;}
   assert.strictEqual(encodings,2,'one shared encoding per compact/full variant');
   assert.strictEqual(recipients[0].messages.length,0);assert(recipients[1].messages[0].val.events_delta);
   assert.deepStrictEqual(recipients[2].messages[0].val,{events:changed});
   changed.events[1].name='Later sender mutation';held(null,{held:true});await turn();
   for(const [index,ws]of recipients.entries()){
    const message=ws.messages.find(m=>m.ctype==='update_btp_events');assert(message);
    const result=updates.apply(states[index],message.val);assert(result);assert.strictEqual(result.events[1].name,'Neu');
   }
   admin.handle_tournament_get(app,recipients[0],{key:'test',rid:'entries',events_delta:2});
   for(let n=0;!recipients[0].messages.some(m=>m.rid==='entries');n++){assert(n<1000);await turn();}
   const current=recipients[0].messages.find(m=>m.rid==='entries').tournament,next=JSON.parse(JSON.stringify(events));
   next.events[3].stages[0].entries[2].name='One changed entry';
   admin.notify_change(app,'test','update_btp_events',{events:next});
   const latest=recipients[0].messages.filter(m=>m.ctype==='update_btp_events').at(-1);
   assert.strictEqual(latest.val.events_delta.patched.length,1,'the actual snapshot request negotiates individual-entry updates');
   assert.strictEqual(latest.val.events_delta.changed.length,0);
   assert.deepStrictEqual(updates.apply(current,latest.val),next);
  }finally{for(const ws of sockets){ws.readyState=3;ws.emit('close');}}
 });
});
