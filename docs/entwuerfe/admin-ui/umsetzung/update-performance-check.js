'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const cases=require('./update-performance-cases'),{assess,limits}=require('./update-performance-budget');
function inventory() {
 const root=path.resolve(__dirname,'../../../..'),change=fs.readFileSync(path.join(root,'static/js/change.js'),'utf8');
 const all=new Set([...change.matchAll(/case '([^']+)':/g)].map(match=>match[1]));
 const tournament=fs.readFileSync(path.join(root,'static/js/ctournament.js'),'utf8');
 const route=tournament.slice(tournament.indexOf("_route_single(/t\\/([a-z0-9]+)\\/$/"));
 for(const match of route.slice(0,route.indexOf('}));')).matchAll(/^\s+([a-z_]+):\s/gm))all.add(match[1]);
 return [...all].sort();
}
module.exports=async function({c,check,open,delay,previews,onlyTypes=null,reportFile='update-performance-verification.json'}) {
 const types=inventory(),missing=types.filter(type=>!cases[type]);assert.deepStrictEqual(missing,[],'Every incoming update type needs a performance fixture');
 const initialize=async()=>{await open(1920,1080);await delay(150);
 await c.evaluate(`(()=>{
  for(let i=curt.matches.length;i<128;i++){const m=structuredClone(curt.matches.find(m=>m._id==='match-53'));m._id='performance-'+i;m.setup.match_num=1000+i;m.setup.teams.forEach((team,t)=>team.players.forEach((p,j)=>{p.btp_id=100000+i*10+t*2+j;p.name='Testperson '+p.btp_id;p.firstname='Testperson';p.lastname=String(p.btp_id)}));curt.matches.push(m)}
  curt.advertisements=[];curt.scoring_formats={formats:[],default_id:null};
  curt.registration_player_comments={'test-player':{to_registration:{text:'Test',read:false}}};curt.registration_stage_comments={'test-stage':{to_registration:{text:'Test',read:false}}};
  window.__perfSeed=structuredClone(curt);window.__perfReceipts=[];window.__perfUnsubscribe=btsAdminUpdates.subscribe(receipt=>{__perfReceipts.push(receipt);if(__perfReceipts.length>1000)__perfReceipts.shift()});
  window.__perfConnection=conn(()=>{},crouting.on_change);window.clone=id=>structuredClone(curt.matches.find(m=>m._id===id));window.edit=(id,change)=>{const m=clone(id);change(m);return {match__id:id,match:m}};
  window.announcement=()=>{const setup=clone('match-44').setup;setup.umpire=structuredClone(curt.umpires[0]);setup.service_judge=structuredClone(curt.umpires[1]);return {match__id:'match-44',setup,_announcement_ts:Date.now()}};
  window.__perfSilent=cerror.silent;cerror.silent=message=>{if((__perfType==='queue_hang_warning'&&message.startsWith('BTS hängt'))||(__perfType==='emergency_announce'&&message.startsWith('Evakuierungsdurchsage')))return;throw new Error('Unexpected diagnostic: '+message)};
  window.__perfReset=async()=>{Object.keys(curt).forEach(key=>delete curt[key]);Object.assign(curt,structuredClone(__perfSeed));curt.normalizations=[{_id:'test-normal',origin:'Test',replace:'Test',language:'de-DE'}];curt.advertisements=[{_id:'test-ad',name:'Test'}];curt.displays[0].wait_for_done=true;curt.displays[0].wait_for_ctype='test';curt.displays[0].wait_for_message_id='test-message';ctournament.ui_show();await new Promise(resolve=>{const poll=()=>{if(cleitstand.isUpdating()||ctournament.isUpdating())requestAnimationFrame(poll);else requestAnimationFrame(()=>requestAnimationFrame(resolve))};poll()})};
 })()`);
 };
 const report={date:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Berlin'}),scope:'Native Turnierleitungsseite mit 128 synthetischen Spielen und simulierten Serverantworten; keine Verbindung zu laufenden Diensten.',method:'Frische Browserseite je Nachrichtentyp, jeweils drei Updates durch die echte Empfangswarteschlange. Messung endet erst mit einer Quittierung nach abgeschlossener UI-Arbeit und zwei sichtbaren Browserframes. Neuaufbau vor jeder Probe liegt außerhalb der Messung.',limits,paths:[],failures:[]};
 for(const type of (onlyTypes?types.filter(type=>onlyTypes.includes(type)):types)) {
  const [payload,expected,kind='small']=cases[type],samples=[];
  try {
   await initialize();
   for(let sample=0;sample<3;sample++) {
    await c.evaluate(`window.__perfType=${JSON.stringify(type)};__perfReset()`);
    const receipt=await c.evaluate(`new Promise((resolve,reject)=>{const tag=${JSON.stringify(type+':'+sample)},timeout=setTimeout(()=>{unsubscribe();reject(new Error('Missing presentation receipt: '+tag))},7000),unsubscribe=btsAdminUpdates.subscribe(receipt=>{if(receipt.message.__performance_case===tag){unsubscribe();clearTimeout(timeout);try{if(!(${expected})){reject(new Error('Expected model/DOM change missing: '+tag));return}resolve({status:receipt.status,presented_at:receipt.presented_at,timings:receipt.timings,error:receipt.error})}catch(error){reject(error)}}});__perfConnection._test_handle_message({data:JSON.stringify({type:'change',ctype:${JSON.stringify(type)},tournament_key:'preview',val:(${payload}),__performance_case:tag})})})`);
    samples.push(receipt);
   }
   const result=assess(samples,kind);report.paths.push({type,kind,...result,measurements:samples});
   await check('Laufzeit und UI-Quittierung: '+type,`true`);
  } catch(error) {report.failures.push({type,message:error.message,samples});console.log('FAIL performance '+type+': '+error.message);}
 }
 await require('./local-update-performance-check')({c,check,initialize,report,onlyTypes});
 await c.evaluate(`if(window.__perfSilent)cerror.silent=__perfSilent;window.__perfUnsubscribe?.()`);
 fs.writeFileSync(path.join(previews,path.basename(reportFile)),JSON.stringify(report,null,2)+'\n');
 assert.deepStrictEqual(report.failures,[],'Every update path must meet its presentation budget');
};
module.exports.inventory=inventory;
