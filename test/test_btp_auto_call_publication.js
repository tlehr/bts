'use strict';

const assert = require('assert');
const {promisify} = require('util');
const database = require('../bts/database');
const manager = require('../bts/btp_manager');
const {BTPConn} = require('../bts/btp_conn');
const match_utils = require('../bts/match_utils');

describe('BTP auto-call publication', function() {
 this.timeout(10000);
 for(const outage of [false,true]) it(outage?'persists an offline worker call and replays it through a replacement connection':
  'publishes a worker-planned court call through the actual BTP connection', async function() {
  const db=await database.init_test(),key='btp-publication',app={db,wss:{clients:[]},clock:{now_ms:()=>1000000}};
  const insert=(collection,value)=>promisify(db[collection].insert.bind(db[collection]))(value);
  const tournament={key,btp_enabled:true,official_rotation_mode:'disabled',call_next_possible_scheduled_match_in_preparation:true,
   call_on_court_only_preparation_enabled:true,call_on_court_only_preparation_minutes:0,call_on_court_participant_readiness_mode:'disabled',btp_settings:{check_in_per_match:true}};
  await insert('tournaments',tournament);
  await insert('courts',{_id:'field',tournament_key:key,btp_id:9,num:1,location_id:'hall',is_active:true});
  await insert('matches',{_id:'prepared',tournament_key:key,btp_id:key+'-prepared',btp_match_ids:[{id:101,draw:1,planning:1}],match_order:42,
   setup:{is_match:true,incomplete:false,state:'preparation',location_id:'hall',preparation_call_timestamp:1,match_num:1,
    teams:[{players:[{btp_id:1,name:'Player A',checked_in:true}]},{players:[{btp_id:2,name:'Player B',checked_in:true}]}]}});
  const connect=BTPConn.prototype.connect,send=BTPConn.prototype.send,requests=[],stored_at_send=[];
  let online=!outage,connection;
  BTPConn.prototype.connect=function(){this.key_unicode='session';connection=this;};
  BTPConn.prototype.send=function(request,callback){
   requests.push(request);
   stored_at_send.push(db.matches.getAllData().find(match=>match._id==='prepared'));
   callback(online?{Action:[{Result:[1]}]}:null,online?null:new Error('BTP offline'));
  };
  try {
   manager.reconfigure(app,tournament);
   await new Promise((resolve,reject)=>match_utils.queue_auto_call_matches_on_free_courts(app,key,error=>error?reject(error):resolve()));
   for(let turn=0;turn<100&&!requests.some(request=>request.Update?.Tournament?.Matches);turn++)await new Promise(resolve=>setImmediate(resolve));
   const called=await db.matches.findOne_async({_id:'prepared'});
   assert.equal(called.setup.state,'oncourt');
   assert.equal(called.btp_call_pending,true,'The worker must persist the call until BTP readback');
   if(outage){
    assert(!requests.some(request=>request.Update?.Tournament?.Courts),'Do not send a court before the match update succeeds');
    online=true;
    manager.reconfigure(app,tournament);
    await connection.pushall();
   }
   assert(stored_at_send.every(match=>match.btp_call_pending===true&&match.setup.state==='oncourt'),
    'The call must already be committed before any external request');
   const courts=requests.flatMap(request=>request.Update?.Tournament?.Courts||[]).map(row=>row.Court);
   const matches=requests.flatMap(request=>request.Update?.Tournament?.Matches||[]).map(row=>row.Match);
   assert(courts.some(court=>court.ID===9&&court.MatchID===101),'The actual court assignment must reach BTP');
   assert(matches.some(match=>match.ID===101&&match.CourtID===9),'The match must carry its assigned court');
   assert(matches.some(match=>match.ID===101&&match.Status===5),'Both players must be checked in for the called match');
  } finally {
   manager.reconfigure(app,{...tournament,btp_enabled:false});BTPConn.prototype.connect=connect;BTPConn.prototype.send=send;
  }
 });
});
