'use strict';
const assert=require('assert'), fs=require('fs/promises'), os=require('os'), path=require('path'), http=require('http');
const {handle}=require('../bts/speech/connection_settings');
const {configuration}=require('../bts/speech/broker');

describe('Server-wide speech connection settings',function(){
 let directory,app,ws,server,url,requests;
 const secret='test-private-key-'+ 'x'.repeat(40);
 const invoke=message=>new Promise(resolve=>{ws.respond=(_message,error,value)=>resolve({error,value});handle(app,ws,{tournament_key:'one',...message});});
 beforeEach(async function(){
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'bts-speech-config-'));
  requests=[];server=http.createServer((req,res)=>{
   requests.push({path:req.url,key:req.headers['x-api-key']});
   if(req.headers['x-api-key']!==secret){res.writeHead(401);res.end('{}');return;}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/health'?{status:'ready'}:{voices:[{voice_id:'hallensprecherin',languages:['de-DE']}]}));
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port;
  app={config_file:path.join(directory,'config.json'),config:{port:4000,speech:{enabled:true,url,api_key:secret,cache_dir:'keep-cache'}}};
  app.speech={broker:{config:configuration(app.config.speech),public_config:()=>({voices:[{voice_id:'hallensprecherin'}]})}};
  app.speech.reconfigure_connection=async next=>{Object.assign(app.speech.broker.config,next);};
  await fs.writeFile(app.config_file,JSON.stringify(app.config));ws={speech_tournament_key:'one'};
 });
 afterEach(async function(){await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});});
 async function get(){const response=await invoke({type:'speech_connection_get'});assert.ifError(response.error);return response.value.connection;}
 it('returns connection and source status without returning credentials or file paths',async function(){
  const view=await get();assert.strictEqual(view.url,url);assert(view.api_key_configured);assert.strictEqual(view.apply_pending,false);assert.strictEqual(view.status.state,'ready');
  const serialized=JSON.stringify(view);assert(!serialized.includes(secret));assert(!serialized.includes(directory));
 });
 it('persists a server-wide address atomically while preserving other settings and the running service',async function(){
  const before=await get(),running=app.speech;
  const reply=await invoke({type:'speech_connection_save',revision:before.revision,values:{url:'http://192.0.2.20:8077',enabled:true}});
  assert.ifError(reply.error);assert.strictEqual(reply.value.connection.apply_pending,false);assert.strictEqual(app.speech,running);assert.strictEqual(running.broker.config.base_url,'http://192.0.2.20:8077');
  const saved=JSON.parse(await fs.readFile(app.config_file,'utf8'));assert.strictEqual(saved.port,4000);assert.strictEqual(saved.speech.cache_dir,'keep-cache');assert.strictEqual(saved.speech.api_key,secret);assert.strictEqual(saved.speech.url,'http://192.0.2.20:8077');
  assert.deepStrictEqual((await fs.readdir(directory)).sort(),['config.json']);assert.strictEqual((await fs.stat(app.config_file)).mode&0o777,0o600);
 });
 it('retains the previous key when the password field is empty',async function(){
  const before=await get();const response=await invoke({type:'speech_connection_save',revision:before.revision,values:{api_key:'',url,enabled:false}});assert.ifError(response.error);
  assert.strictEqual(JSON.parse(await fs.readFile(app.config_file)).speech.api_key,secret);
 });
 it('preserves the running connection if applying fails and retries the saved address without another edit',async function(){
  const before=await get(),apply=app.speech.reconfigure_connection;
  app.speech.reconfigure_connection=async()=>{throw new Error('private-internal-error');};
  const response=await invoke({type:'speech_connection_save',revision:before.revision,values:{url:'http://192.0.2.20:8077'}});
  assert.ifError(response.error);assert(response.value.connection.apply_pending);assert.strictEqual(response.value.connection.status.state,'apply_pending');
  assert.strictEqual(app.speech.broker.config.base_url,url);assert(!JSON.stringify(response).includes('private-internal-error'));
  app.speech.reconfigure_connection=apply;
  const retried=await invoke({type:'speech_connection_save',revision:response.value.connection.revision,values:{}});
  assert.ifError(retried.error);assert.strictEqual(retried.value.connection.apply_pending,false);assert.strictEqual(app.speech.broker.config.base_url,'http://192.0.2.20:8077');
 });
 it('allows replacing the key without echoing it',async function(){
  const before=await get(),next='new-private-key-'+ 'z'.repeat(40);
  const response=await invoke({type:'speech_connection_save',revision:before.revision,values:{api_key:next}});assert.ifError(response.error);assert(!JSON.stringify(response.value).includes(next));
  assert.strictEqual(JSON.parse(await fs.readFile(app.config_file)).speech.api_key,next);
 });
 it('rejects a stale revision without losing the newer saved address',async function(){
  const before=await get();await invoke({type:'speech_connection_save',revision:before.revision,values:{url:'http://192.0.2.20:8077'}});
  const response=await invoke({type:'speech_connection_save',revision:before.revision,values:{url:'http://192.0.2.21:8077'}});assert.strictEqual(response.error.message,'speech_connection_conflict');assert.strictEqual((await get()).url,'http://192.0.2.20:8077');
 });
 it('rejects invalid URL schemes, URL credentials, paths and malformed keys before writing',async function(){
  const before=await get(),original=await fs.readFile(app.config_file,'utf8');
  for(const values of [{url:'file:///tmp/key'},{url:'http://name:password@localhost:8077'},{url:url+'/admin'},{api_key:'short'},{enabled:'true'},{worker:false}]){
   assert((await invoke({type:'speech_connection_save',revision:before.revision,values})).error);
  }
  assert.strictEqual(await fs.readFile(app.config_file,'utf8'),original);
 });
 it('tests the draft using only authenticated health and voice reads and leaves configuration untouched',async function(){
  const original=await fs.readFile(app.config_file,'utf8');const result=await invoke({type:'speech_connection_test',values:{url}});assert.ifError(result.error);assert.strictEqual(result.value.result.state,'ready');
  assert.deepStrictEqual(requests.map(row=>row.path).sort(),['/health','/v1/voices']);assert(requests.every(row=>row.key===secret));assert.strictEqual(await fs.readFile(app.config_file,'utf8'),original);assert(!JSON.stringify(result.value).includes(secret));
 });
 it('reports rejected credentials without exposing the upstream response or draft key',async function(){
  const result=await invoke({type:'speech_connection_test',values:{api_key:'wrong-key-'+ 'b'.repeat(40)}});assert.ifError(result.error);assert.strictEqual(result.value.result.state,'unauthorized');assert(!JSON.stringify(result.value).includes('wrong-key'));
 });
 it('rejects requests without the already loaded tournament',async function(){
  const reply=await invoke({type:'speech_connection_get',tournament_key:'other'});assert.strictEqual(reply.error.message,'tournament_not_loaded');
 });
 it('allows reading and testing an instance without a configuration file but rejects saving',async function(){
  app.config_file=null;const view=await get();assert.strictEqual(view.writable,false);
  assert.strictEqual((await invoke({type:'speech_connection_save',revision:view.revision,values:{url}})).error.message,'speech_connection_read_only');
 });
 it('reports file errors without overwriting the running connection',async function(){
  const before=await get();app.config_file=path.join(directory,'missing/config.json');
  const reply=await invoke({type:'speech_connection_save',revision:before.revision,values:{url}});assert.strictEqual(reply.error.message,'speech_connection_save_failed');assert.strictEqual(app.speech.broker.config.base_url,url);
 });
 it('honors explicit environment overrides and rejects edits of those fields',async function(){
  const previous=process.env.BTS_SPEECH_URL;process.env.BTS_SPEECH_URL=url;
  try {const view=await get();assert(view.locked.url);assert.strictEqual((await invoke({type:'speech_connection_save',revision:view.revision,values:{url}})).error.message,'speech_connection_environment_locked');}
  finally {if(previous===undefined)delete process.env.BTS_SPEECH_URL;else process.env.BTS_SPEECH_URL=previous;}
 });
 it('forwards the selected helper download platform through the speech worker bridge',async function(){
  const Worker=require('../bts/speech/worker_client');const worker=new Worker({config:{},speech_health:{},db:{}},configuration({enabled:false}));
  let payload;worker.call=async(_operation,value)=>{payload=value;return {};};
  await worker.request({type:'speech_helper_bundle',tournament_key:'one',platform:'linux',endpoint:'http://192.0.2.1:4001'});
  assert.strictEqual(payload.platform,'linux');
 });
 it('preserves file-backed credentials when saving an unrelated field',async function(){
  const keyfile=path.join(directory,'key');await fs.writeFile(keyfile,secret);
  app.config.speech={enabled:true,url,api_key_file:keyfile};await fs.writeFile(app.config_file,JSON.stringify(app.config));
  const before=await get();assert(before.api_key_configured);
  const result=await invoke({type:'speech_connection_save',revision:before.revision,values:{url,api_key:''}});assert.ifError(result.error);
  const saved=JSON.parse(await fs.readFile(app.config_file));assert.strictEqual(saved.speech.api_key,undefined);assert.strictEqual(await fs.readFile(keyfile,'utf8'),secret);
 });

});
