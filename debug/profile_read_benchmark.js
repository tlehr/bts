'use strict';
/* eslint-disable no-console -- Standalone isolated benchmark report. */
const path=require('path'),fs=require('fs'),assert=require('assert'),{EventEmitter}=require('events');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),load=file=>require(path.join(root,file));
(async()=>{
 const database=load('bts/database'),v2=load('bts/bupws_v2'),db=await database.init_test(),app={db};
 const insert=(table,value)=>new Promise((resolve,reject)=>db[table].insert(value,error=>error?reject(error):resolve()));
 await insert('tournaments',{key:'read-benchmark',automation_enabled:false,btp_enabled:false});
 await insert('courts',{_id:'court-1',num:1,tournament_key:'read-benchmark',match_id:'match-1'});
 await insert('matches',{_id:'match-1',tournament_key:'read-benchmark',network_score:[[0,0]],presses:[],setup:{match_id:'match-1',court_id:'court-1',now_on_court:true,state:'oncourt',counting:'3x21',warmup:'none',teams:[{players:[]},{players:[]}]}});
 const tournament=await db.tournaments.findOne_async({key:'read-benchmark'});
 await load('bts/displaysettings_defaults').ensure_default_displaysettings(app,tournament);
 const panels=[];
 for(const [id,mode,court] of [['scorer','umpire','court-1'],['unassigned','umpire',null],['tv','display','court-1']]){
  const ws=Object.assign(new EventEmitter(),{readyState:1,client_id:id,hostname:id,messages:[],send(raw){this.messages.push(JSON.parse(raw));},sendmsg(payload){this.messages.push(payload);}});
  v2.on_connect(app,ws);ws.last_tournament_key='read-benchmark';ws.panel_devicemode=mode;ws.court_id=court||undefined;
  await insert('display_court_displaysettings',{client_id:id,hostname:id,panel_devicemode:mode,displaysetting_id:mode==='umpire'?tournament.displaysettings_general_tablet:tournament.displaysettings_general,...(court?{court_id:court}:{})});
  await v2.send_current_state(app,ws,'read-benchmark');panels.push(ws);
 }
 const idle=async()=>{await load('bts/foreground_work').idle();for(let i=0;i<200;i++){if(Object.values(db).filter(s=>s?.executor).every(s=>!s.executor.queue.running()&&!s.executor.queue.length()))return;await new Promise(r=>setTimeout(r,5));}throw new Error('DB did not settle');};
 await idle();
 const counts=()=>Object.fromEntries(Object.entries(db).filter(([,store])=>store?.executor).map(([name,store])=>[name,load('bts/database_tasks').health(store).completed_count]));
 const before=counts(),start=performance.now();
 for(let point=1;point<=20;point++){
  await v2.handle_score_update(app,panels[0],{tournament_key:'read-benchmark',score:{match_id:'match-1',court_id:'court-1',network_score:[[point,0]],presses:[],device:{battery:{level:.8,charging:false}}}});
  await idle();
 }
 const after=counts(),operations=Object.fromEntries(Object.keys(after).map(k=>[k,after[k]-before[k]]));
 const result={scope:'Isolated in-memory backend, 20 scores, one scoring tablet, one unassigned tablet and one assigned TV; no network or external services.',points:20,operations,total:Object.values(operations).reduce((a,b)=>a+b,0),elapsed_ms:performance.now()-start,tv_points:panels[2].messages.filter(m=>m.type==='display_points_update').length};
 assert.strictEqual(result.tv_points,20);assert.strictEqual((await db.matches.findOne_async({_id:'match-1'})).network_score[0][0],20);
 for(const ws of panels){ws.readyState=3;v2.on_close(app,ws);}
 console.log(JSON.stringify(result));if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
