'use strict';
const assert=require('assert');
const {SpeechBroker,configuration}=require('../bts/speech/broker');
const {ServerDemand}=require('../bts/speech/helpers/demand');
const {RemoteHelpers}=require('../bts/speech/helpers/remote');
const context=require('../bts/speech/context');
const secret='central-fixture-'+ 'x'.repeat(40);
const part=name=>context.sourcePart({before:'',text:'Wir erwarten '+name+' zum nächsten Spiel.',after:''});

describe('BTS reports demand to centrally managed helpers',function(){
 let b,d,calls,clock;
 beforeEach(function(){
  clock=1700000000000;calls=[];
  b=new SpeechBroker(configuration({enabled:true,api_key:secret,url:'http://speech.example:8077',cache_enabled:false}),{now:()=>clock});
  b.identity='test';b.context_version='bts-context-v1';b.metadata_verified=true;b.server_helper_dispatch=true;
  d=b.helpers=new ServerDemand(b);
  b.request=async(url,key,method,path,body)=>{calls.push({url,key,method,path,body});return {items:body.items.map((item,i)=>({key:item.key,job:{...item.request,job_id:(i+1).toString(16).padStart(32,'0'),status:'processing',execution:{kind:'helper',name:'Server-assigned host',phase:'synthesis',running:true}}}))};};
 });
 it('reports normalized sources and priorities without worker identifiers or leases',async function(){
  b.prepare([part('Anna'),part('Berta')],{priority:'high'},'default');
  await d.step();
  assert.strictEqual(calls[0].path,'/v1/helpers/demand');assert.strictEqual(calls[0].body.items.length,2);
  assert(calls[0].body.items.every(row=>row.request.priority==='high'&&row.tournaments[0]==='default'));
  assert(!JSON.stringify(calls[0].body).includes('worker_id'));assert(!JSON.stringify(calls[0].body).includes('lease'));
  assert(b.queue('default').items.every(row=>row.execution.name==='Server-assigned host'));
  assert.strictEqual(b.current,null);
 });
 it('refreshes interest in centrally running work and permits a new high priority request into a full batch',async function(){
  b.prepare(Array.from({length:32},(_,i)=>part('Spieler '+String.fromCharCode(65+i))),{priority:'low'},'default');
  await d.step();assert.strictEqual(calls[0].body.items.length,32);
  b.prepare([part('Dringend')],{priority:'high'},'default');clock+=1001;await d.step();
  assert.strictEqual(calls[1].body.owner,calls[0].body.owner);
  assert.strictEqual(calls[1].body.items[0].request.priority,'high');assert.strictEqual(calls[1].body.items.length,32);
 });
 it('does not offer terminal source quality failures again',async function(){
  b.prepare([part('Anna')],{priority:'high'},'default');
  b.request=async(_url,_key,_method,_path,body)=>({items:body.items.map(item=>({key:item.key,job:{...item.request,job_id:'a'.repeat(32),status:'failed',error:{code:'source_quality_failed'}}}))});
  await d.step();const entry=[...b.entries.values()][0];assert.strictEqual(entry.status,'failed');assert.strictEqual(entry.terminal_failure,true);
  clock+=1001;let rows;b.request=async(_u,_k,_m,_p,body)=>{rows=body.items;return {items:[]};};await d.step();assert.deepStrictEqual(rows,[]);
 });
 it('uses the ordinary server path when central dispatch is unsupported',async function(){
  b.server_helper_dispatch=false;b.prepare([part('Anna')],{priority:'normal'},'default');await d.step();assert.strictEqual(calls.length,0);
 });
 it('proxies management to the selected server and preserves friendly errors',async function(){
  const remote=new RemoteHelpers(b);b.request=async(url,key,method,path,body)=>{calls.push({url,key,method,path,body});return {workers:[],runtime:null};};
  const snapshot=await remote.snapshot('one');assert.strictEqual(snapshot.endpoint,'http://speech.example:8077');
  await remote.pair();await remote.bundle('http://speech.example:8077','linux');await remote.test('one','hallensprecher','worker');await remote.control('worker','pause');
  assert(calls.every(call=>call.url==='http://speech.example:8077'&&call.key===secret));
  assert.deepStrictEqual(calls.map(call=>call.path),['/v1/helpers?tournament=one','/v1/helpers/pair','/v1/helpers/bundle','/v1/helpers/test','/v1/helpers/control']);
  assert.deepStrictEqual(calls[2].body,{endpoint:'http://speech.example:8077',platform:'linux'});
  b.request=async()=>{throw Object.assign(new Error('private'),{status:404});};await assert.rejects(remote.snapshot('one'),/helper_server_update_required/);
 });
});
