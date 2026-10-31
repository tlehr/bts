'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const {spawn} = require('child_process');
const WebSocket = require('ws');
const assert = require('assert');
const root=path.resolve(__dirname,'../../../..');
const previews=__dirname;
fs.mkdirSync(previews,{recursive:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=10000) { const start=Date.now(); do { const value=await fn();if(value)return value;await delay(60); }while(Date.now()-start<ms);throw new Error('Timed out'); }
class CDP {
 constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();this.events=[];ws.on('message',raw=>{const m=JSON.parse(raw);if(m.id){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p?.reject(new Error(m.error.message)):p?.resolve(m.result);}else this.events.push(m);});}
 call(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params}));});}
 async evaluate(expression){const r=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
}
(async()=>{
 let server,chrome,ws,profile,c,profiling=false;
 const report={checks:[]};
 try{
  server=http.createServer((req,res)=>{
   const url=new URL(req.url,'http://localhost');
   let filename=path.resolve(root,'.'+decodeURIComponent(url.pathname));
   if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
   if(url.pathname.startsWith('/bup/'))filename=path.join(root,'static/bup/dev',url.pathname.slice(5));
   if(url.pathname.startsWith('/bupdev/'))filename=path.join(root,'static/bup/dev',url.pathname.slice(8));
   if(url.pathname.startsWith('/admin/t/preview')) {
    const html=fs.readFileSync(path.join(root,'static/cbts.html'),'utf8').replaceAll('{{static_path}}','/static/').replaceAll('{{root_path}}','/').replaceAll('{{app_root}}','/admin/').replaceAll('{{error_reporting}}','false').replace(/<script src="[^"]*cadmin.js"><\/script>/,'');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
   }
   if(!filename.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
   try{if(fs.statSync(filename).isDirectory())filename=path.join(filename,'index.html');const ext=path.extname(filename);res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.xml':'application/xml'}[ext]||'application/octet-stream'),'Cache-Control':'no-store'});fs.createReadStream(filename).pipe(res);}
   catch(error){res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port+'/static/mockups/admin/';
  profile=fs.mkdtempSync(path.join(os.tmpdir(),'bts-ui-preview-'));
  chrome=spawn(process.env.CHROME_BIN||'/usr/bin/google-chrome',['--headless','--no-sandbox','--disable-dev-shm-usage','--mute-audio','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
  let stderr='';chrome.stderr.on('data',s=>stderr+=s);
  const endpoint=await until(()=>/DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)?.[1]);
  const list=await(await fetch('http://'+new URL(endpoint).host+'/json/list')).json();
  ws=new WebSocket(list.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
  c=new CDP(ws);
  await c.call('Runtime.enable');await c.call('Page.enable');await c.call('Network.enable');
  if(process.env.BTS_UI_PROFILE_FILE) {
   await c.call('Profiler.enable');await c.call('Profiler.setSamplingInterval',{interval:1000});await c.call('Profiler.start');profiling=true;
  }
  const metrics=async(width,height=1050)=>c.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  async function open(width=1920,height=940){
   await metrics(width,height);await c.call('Page.navigate',{url:base.replace('/static/mockups/admin/','/admin/t/preview/')});
   await until(()=>c.evaluate(`document.readyState==='complete'&&typeof ctournament!=='undefined'`));await delay(100);
   await c.evaluate(fs.readFileSync(path.join(__dirname,'fixture.js'),'utf8'));
   await until(()=>c.evaluate(`!!document.querySelector('.leitstand .ls-match')`));await c.evaluate('document.fonts.ready');await delay(150);
  }
  async function snap(name,full=false){
   await c.evaluate("window.scrollTo(0,0);document.querySelectorAll('.board-toast').forEach(node=>node.hidden=true);");
   const params={format:'png',captureBeyondViewport:full};
   if(full){const m=await c.call('Page.getLayoutMetrics');params.clip={x:0,y:0,width:Math.max(m.cssContentSize.width,await c.evaluate('innerWidth')),height:Math.min(m.cssContentSize.height,2400),scale:1};}
   const shot=await c.call('Page.captureScreenshot',params);
   fs.writeFileSync(path.join(previews,name+'.png'),Buffer.from(shot.data,'base64'));
  }



  report.checks=[];
  // Geometry assertions must follow deferred layout/ResizeObserver work. Faster
  // cache hits must not make a check race the frame that updates column widths.
  const check=async(name,expression)=>{const value=await c.evaluate(`(async()=>{await new Promise((resolve,reject)=>{let stable=0,done=false;const timeout=setTimeout(()=>{done=true;reject(new Error('UI layout did not settle'));},4000);const frame=()=>{if(done)return;stable=window.cleitstand?.isUpdating()||window.ctournament?.isUpdating()?0:stable+1;if(stable===3){done=true;clearTimeout(timeout);resolve();}else requestAnimationFrame(frame);};requestAnimationFrame(frame);});return (${expression});})()`);assert(value,name);report.checks.push(name);console.log('OK '+name);};
  const timerFits=`node=>{if(!node)return false;const range=document.createRange();return [...node.querySelector('.timer-value').children].every(part=>{if(!part.textContent)return true;range.selectNodeContents(part);const glyphs=range.getBoundingClientRect(),slot=part.getBoundingClientRect();return glyphs.left>=slot.left-.25&&glyphs.right<=slot.right+.25})}`;
  const timerInkGap=`node=>{const context=document.createElement('canvas').getContext('2d'),range=document.createRange();const ink=part=>{const style=getComputedStyle(part);context.font=[style.fontStyle,style.fontWeight,style.fontSize,style.fontFamily].join(' ');const text=context.measureText(part.textContent);range.selectNodeContents(part);const left=range.getBoundingClientRect().left;return{left:left-text.actualBoundingBoxLeft,right:left+text.actualBoundingBoxRight}};return ink(node.querySelector('.timer-digits')).left-ink(node.querySelector('.timer-sign')).right}`;
  const click=async(selector)=>c.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const arrangement=()=>c.evaluate(`Object.fromEntries(['top','sidebar'].map(zone=>[zone,[...document.querySelector('[data-card-zone="'+zone+'"]').querySelectorAll('[data-board-card]')].map(card=>card.dataset.boardCard)]))`);
  const rotationColumnsFit=`(()=>{const columns=[...document.querySelectorAll('[data-rotation-section="waiting"] .official_queue_column')];if(columns.length!==2)return false;const [left,right]=columns.map(node=>node.getBoundingClientRect());return Math.abs(left.top-right.top)<1&&left.right<=right.left&&columns[0].dataset.nextRole==='umpire'&&columns[1].dataset.nextRole==='service_judge'&&columns[0].querySelector('h4').textContent==='Schiedsrichter'&&columns[1].querySelector('h4').textContent==='Aufschlagrichter'})()`;
  const key=async(value,code,numeric,text)=>{for(const type of ['keyDown','keyUp'])await c.call('Input.dispatchKeyEvent',{type,key:value,code,windowsVirtualKeyCode:numeric,...(type==='keyDown'&&text?{text,unmodifiedText:text}:{})});};
  async function nativeDrag(sourceSelector,targetSelector,{side='center',cancel=false,verify,beforeHover,settle=0,scrollSource=true}={}) {
   await c.evaluate(`document.activeElement?.blur();${scrollSource?`document.querySelector(${JSON.stringify(sourceSelector)}).scrollIntoView({block:'center'});`:''}`);await delay(60);
   const source=await c.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(sourceSelector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`),start=c.events.length;
   await c.call('Input.setInterceptDrags',{enabled:true});
   await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',...source});
   await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...source,button:'left',buttons:1,clickCount:1});
   await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:source.x+10,y:source.y+4,button:'left',buttons:1});
   await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:source.x+22,y:source.y+8,button:'left',buttons:1});
   const drag=await until(()=>c.events.slice(start).find(event=>event.method==='Input.dragIntercepted'));
   if(settle)await delay(settle);
   if(beforeHover)await beforeHover();
   const targetPoint=()=>c.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(targetSelector)}).getBoundingClientRect();return{x:r.x+r.width*${side==='left'?.15:side==='right'?.85:.5},y:r.y+r.height*${side==='top'?.15:side==='bottom'?.85:.5}}})()`);
   let target=await targetPoint();
   await c.call('Input.dispatchDragEvent',{type:'dragEnter',...target,data:drag.params.data});
   await c.call('Input.dispatchDragEvent',{type:'dragOver',...target,data:drag.params.data});
   if(settle)await delay(settle);
   if(verify)await verify(target);
   if(settle){target=await targetPoint();await c.call('Input.dispatchDragEvent',{type:'dragOver',...target,data:drag.params.data});}
   if(cancel) {
    await key('Escape','Escape',27);
    await c.call('Input.dispatchDragEvent',{type:'dragCancel',...target,data:drag.params.data});
   }else await c.call('Input.dispatchDragEvent',{type:'drop',...target,data:drag.params.data});
   await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',buttons:0,clickCount:1});
   await c.call('Input.setInterceptDrags',{enabled:false});
  }

  if(process.argv.includes('--mixed-updates-only')) {
   await require('./mixed-updates-check')({c,open,previews});return;
  }
  if(process.argv.includes('--large-list-updates-only')) {
   await require('./mixed-updates-check')({c,open,previews,matchCount:373,finishedCount:85,clockLimit:600,reportFile:'large-list-update-verification.json'});return;
  }
  if(process.argv.includes('--structural-load-only')) {
   await require('./mixed-updates-check')({c,open,previews,matchCount:373,finishedCount:85,clockLimit:600,structuralChanges:true,reportFile:'structural-load-verification.json'});return;
  }
  if(process.argv.includes('--timer-containment-only')) {
   await require('./mixed-updates-check')({c,open,previews,matchCount:373,finishedCount:85,clockLimit:600,containmentOnly:true});return;
  }
  if(process.argv.includes('--paint-scope-only')) {
   await require('./mixed-updates-check')({c,open,previews,matchCount:373,finishedCount:85,clockLimit:600,paintScopeOnly:true});return;
  }
  if(process.argv.includes('--layout-cache-only')) {
   await require('./layout-cache-check')({c,open,metrics,previews});return;
  }
  if(process.argv.includes('--device-table-cache-only')) {
   await require('./device-table-cache-check')({c,open,check});return;
  }
  if(process.argv.includes('--player-activity-only')) {
   await require('./player-activity-check')({c,open,check,metrics,previews});return;
  }
  if(process.argv.includes('--umpire-tablet-release-only')) {
   await require('./umpire-tablet-release-check')({c,open,check});return;
  }
  if(process.argv.includes('--row-retention-only')) {
   await require('./row-retention-check')({c,open,previews});return;
  }
  if(process.argv.includes('--persistent-rows-only')) {
   await require('./persistent-row-check')({c,check,open,previews});return;
  }
  if(process.argv.includes('--check-in-cursor-only')) {
   await require('./check-in-cursor-check')({c,check,click,open,metrics,previews});return;
  }
  if(process.argv.includes('--density-only')) {
   await require('./density-check')({c,check,click,open,metrics,previews});return;
  }
  if(process.argv.includes('--compact-density-only')) {
   await require('./compact-density-check')({c,check,click,open,metrics,previews,capture:snap});return;
  }
  if(process.argv.includes('--compact-timers-only')) {
   await require('./compact-timer-check')({c,check,click,open,metrics,previews,capture:snap});return;
  }
  if(process.argv.includes('--compact-official-names-only')) {
   await require('./compact-official-names-check')({c,check,click,open,metrics,previews,capture:snap});return;
  }
  if(process.argv.includes('--match-patches-only')) {
   await require('./match-patch-performance-check')({c,open,previews});return;
  }
  if(process.argv.includes('--successor-marker-only')) {
   await require('./successor-marker-check')({c,open,previews});return;
  }
  if(process.argv.includes('--update-ownership-only')) {
   await require('./update-ownership-check')({c,open,previews});return;
  }
  if(process.argv.includes('--preparation-stability-only')) {
   await require('./preparation-stability-check')({c,open,previews});return;
  }
  if(process.argv.includes('--preparation-location-only')) {
   await require('./preparation-location-check')({c,check,click,open,metrics,previews});return;
  }
  if(process.argv.includes('--deferred-matches-only')) {
   await require('./deferred-match-check')({c,check,click,open,metrics,previews});return;
  }
  if(process.argv.includes('--header-cache-only')) {
   await require('./header-cache-check')({c,open,metrics,previews});return;
  }
  if(process.argv.includes('--card-heights-only')) {
   await require('./card-heights-check')({c,check,click,open,metrics,key,delay,previews});return;
  }
  if(process.argv.includes('--logs-only')) {
   await require('./logs-check')({c,check,click,open,metrics,key,previews});return;
  }
  if(process.argv.includes('--date-groups-only')) {
   await require('./date-groups-check')({c,check,click,open,metrics,key,previews});return;
  }
  if(process.argv.includes('--match-dialog-only')) {
   await require('./match-dialog-check')({c,check,click,open,metrics,key,delay,previews});return;
  }
  if(process.argv.includes('--match-place-only')) {
   await require('./match-place-check')({c,verify:check,click,open,metrics});return;
  }
  if(process.argv.includes('--choice-picker-only')) {
   await require('./choice-picker-check')({c,verify:check,click,open,metrics,key,delay});return;
  }
  if(process.argv.includes('--finished-match-only')) {
   await require('./finished-match-check')({c,verify:check,click,open,metrics,key});return;
  }
  if(process.argv.includes('--delete-confirmation-only')) {
   await require('./delete-confirmation-check')({c,verify:check,click,open,metrics,key,delay,capture:snap});return;
  }

  if(process.env.BTS_UPDATE_PERFORMANCE_ONLY==='1'||process.argv.includes('--updates-only')) {
   await require('./update-performance-check')({c,check,open,delay,previews,onlyTypes:process.env.BTS_UPDATE_TYPES?.split(','),reportFile:process.env.BTS_UPDATE_REPORT||'update-performance-verification.json'});
   console.log(JSON.stringify({checks:report.checks.length,kind:'update-performance'}));return;
  }

  await open();
  await check('Echte Turnierleitung zeigt alle 13 Felder und sieben Kacheln mit eigenständiger Rotation',`document.querySelectorAll('.courts_container .court_row').length===13&&document.querySelectorAll('.control-card').length===7&&!!document.querySelector('[data-board-card="logs"]>.errors_scroll_left')&&!document.querySelector('.board-games .errors_scroll_left')&&!!document.querySelector('[data-board-card="rotation"]>.umpire_container')&&!document.querySelector('[data-board-card="operators"] .umpire_container')&&!document.querySelector('.staff-list')`);
  await c.evaluate(`(()=>{window.__officialsOriginal=structuredClone(curt.matches.filter(match=>cmatch.calc_section(match)==='unassigned'));const person=(firstname,lastname,id)=>({firstname,lastname,surname:lastname,name:firstname+' '+lastname,btp_id:id,checked_in:true,check_in_per_match:true});for(const match of curt.matches.filter(match=>cmatch.calc_section(match)==='unassigned')){match.setup.tabletoperators=[];delete match.setup.umpire;delete match.setup.service_judge;}curt.matches.find(match=>match._id==='match-47').setup.umpire=person('Hans','Heinrich',90001);Object.assign(curt.matches.find(match=>match._id==='match-49').setup,{umpire:person('Anton','Anderson',90002),service_judge:person('Bertha','Baller',90003)});curt.matches.find(match=>match._id==='match-45').setup.teams[0].players=[person('Alexander Maximilian','Weber',90010),person('Nina Maria','Hansen',90011)];cmatch.render_unassigned(document.querySelector('.unassigned_container'));cmatch.refresh_unassigned_preparation_context();window.__oldOfficials=document.createElement('style');window.__oldOfficials.textContent='.ls-planned-table{--officials-width:clamp(220px,16cqi,280px)!important}';document.head.append(window.__oldOfficials)})()`);
  await metrics(1424,940);await delay(150);
  await c.evaluate(`window.__officialsBefore={width:document.querySelector('.unassigned_container .umpire_and_tablet').getBoundingClientRect().width,teams:document.querySelector('.unassigned_container .ls-teams').getBoundingClientRect().width,shortened:[...document.querySelectorAll('tr[data-match_id="match-45"] .team-one .player')].some(node=>node.title.includes(node.dataset.lsFullName))};window.__oldOfficials.remove()`);
  await delay(150);
  await check('Freier Platz neben kurzen Offiziellennamen geht vollständig an zuvor gekürzte Spielernamen',`(()=>{const width=document.querySelector('.unassigned_container .umpire_and_tablet').getBoundingClientRect().width,teams=document.querySelector('.unassigned_container .ls-teams').getBoundingClientRect().width;return window.__officialsBefore.shortened&&width<180&&Math.abs((teams-window.__officialsBefore.teams)-(window.__officialsBefore.width-width))<.2&&[...document.querySelectorAll('tr[data-match_id="match-45"] .team-one .player')].every(node=>node.title===(node.dataset.checkInAction||''))&&!document.querySelector('.ls-officials-measuring')})()`);
  await snap('offizielle-inhalt',true);
  await metrics(1920,940);await delay(120);
  await c.evaluate(`window.__shortOfficialsWidth=document.querySelector('.unassigned_container .umpire_and_tablet').getBoundingClientRect().width;window.__shortOfficialMatch=structuredClone(curt.matches.find(match=>match._id==='match-47'));const changed=structuredClone(window.__shortOfficialMatch);Object.assign(changed.setup.umpire,{firstname:'Alexander Maximilian',lastname:'Keo Boun Khoune',surname:'Keo Boun Khoune',name:'Alexander Maximilian Keo Boun Khoune'});crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:changed._id,match:changed}})`);
  await delay(150);
  await check('Ein längerer Offiziellenname erweitert die Spalte nach einer Live-Änderung nur bis zur bisherigen Obergrenze',`(()=>{const width=document.querySelector('.unassigned_container .umpire_and_tablet').getBoundingClientRect().width;return width>window.__shortOfficialsWidth&&width<=280.1&&document.querySelector('tr[data-match_id="match-47"] .name').getAttribute('aria-label')==='Alexander Maximilian Keo Boun Khoune'})()`);
  await c.evaluate(`crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:window.__shortOfficialMatch._id,match:window.__shortOfficialMatch}})`);
  await delay(150);
  await check('Ein kürzerer Offiziellenname gibt seinen Platz wieder frei und erhält die vorhandenen Check-in-Ziele',`Math.abs(document.querySelector('.unassigned_container .umpire_and_tablet').getBoundingClientRect().width-window.__shortOfficialsWidth)<.1&&document.querySelector('tr[data-match_id="match-47"] .person_status_target').getAttribute('role')==='button'&&!document.querySelector('.ls-officials-measuring')`);
  await c.evaluate(`for(const match of window.__officialsOriginal)crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}})`);
  await delay(150);
  const preparationContentFits=`(()=>{const table=document.querySelector('.unassigned_container .ls-planned-table'),heading=table?.querySelector('.ls-preparation-heading');return heading?.colSpan===2&&heading.textContent==='Vorbereitung'&&!table.tHead.textContent.includes('Aktionen')&&[...table.querySelectorAll('tr[data-match_id]')].every(row=>{const score=row.querySelector('td.score').getBoundingClientRect(),calls=row.querySelector('td.call_td').getBoundingClientRect(),info=row.querySelector('.preparation_debug_icon')?.getBoundingClientRect(),timer=row.querySelector('.match_timer .timer')?.getBoundingClientRect(),controls=[...row.querySelectorAll('.match_preparation_call_button,.preparation_debug_icon')].map(node=>node.getBoundingClientRect()).filter(box=>box.width);return calls.width<=80.1&&(!info||Math.abs(calls.right-info.right-8)<.1)&&controls.every((box,index)=>box.left>=score.left+1&&box.right<=calls.right-7.9&&controls.slice(index+1).every(other=>box.right<=other.left||box.left>=other.right))&&(!timer?.width||timer.right<=Math.min(...controls.map(box=>box.left))-1)})})()`;
  await check('Gemeinsame Vorbereitung spart Breite und hält Timer, Hallenaufrufe und Info ohne Überdeckung innerhalb des Rahmens',`document.querySelector('.ls-preparation-heading').getBoundingClientRect().width<=172.1&&${preparationContentFits}`);
  await c.evaluate(`window.__prepSpeechResults=[];for(const button of document.querySelectorAll('.match_preparation_call_button'))btsSpeechReadiness.trackText(button,()=>['Testaufruf'],false,{remote:true})`);
  for(const [status,expected] of [['completed','ready'],['queued','preparing'],['failed','failed']]) {
   await c.evaluate(`window.__speechFixture.status=${JSON.stringify(status)};btsSpeechReadiness.refresh(true)`);
   await c.evaluate(`window.__prepSpeechResults.push([...document.querySelectorAll('.match_preparation_call_button')].every(button=>{const badge=getComputedStyle(button,'::after'),label=button.querySelector('.ls-call-location'),box=button.getBoundingClientRect(),text=label.getBoundingClientRect(),icon=button.querySelector('.ico').getBoundingClientRect(),border=parseFloat(badge.borderLeftWidth)+parseFloat(badge.borderRightWidth),center=box.left+parseFloat(badge.left)+new DOMMatrixReadOnly(badge.transform).m41+(parseFloat(badge.width)+border)/2;return button.dataset.speechState===${JSON.stringify(expected)}&&badge.content!==JSON.stringify(label.textContent)&&label.textContent===button.dataset.locationShortName&&Math.abs(center-(text.left+text.width/2))<.3&&box.top+parseFloat(badge.top)+parseFloat(badge.height)+border<=text.top+.3&&Math.abs(text.left-icon.right+1.8)<.1&&icon.width===16}))`);
  }
  await c.evaluate(`window.__speechFixture.status='completed';btsSpeechReadiness.refresh(true)`);
  await c.evaluate(`window.__prepButtons=[...document.querySelectorAll('.match_preparation_call_button')];cmatch.refresh_unassigned_preparation_context()`);
  await check('Hallenbuchstaben stehen dicht neben dem größeren Aufruf-Icon unter ihrem Statuskreis und bleiben bei Live-Aktualisierungen erhalten',`window.__prepSpeechResults.every(Boolean)&&window.__prepButtons.every(button=>button.isConnected&&button.querySelectorAll('.ls-call-location').length===1)&&${preparationContentFits}`);
  await c.evaluate(`document.querySelector('tr[data-match_id="match-45"] .ls-call-location').scrollIntoView({block:'center'})`);
  const hallClick=await c.evaluate(`(()=>{const box=document.querySelector('tr[data-match_id="match-45"] .ls-call-location').getBoundingClientRect();return{x:box.x+box.width/2,y:box.y+box.height/2}})()`);
  for(const type of ['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,...hallClick,button:'left',clickCount:1});
  await click('tr[data-match_id="match-45"] .preparation_debug_icon');
  await check('Klick auf das Hallenkürzel sendet den richtigen Vorbereitungsaufruf und Info öffnet weiterhin die Aufrufdetails',`window.__writes.some(message=>message.type==='match_preparation_call'&&message.match._id==='match-45'&&message.location_id==='CH')&&document.querySelector('.leitstand-dialog[open] h2').textContent==='Aufrufstatus'`);
  await click('.leitstand-dialog .dialog-heading button');
  await c.evaluate(`window.scrollTo(0,0);window.__prepLocations=curt.locations.slice();curt.locations.push({_id:'WE',name:'Westhalle',short_name:'WE'},{_id:'OS',name:'Osthalle',short_name:'OS'});cmatch.refresh_unassigned_preparation_context()`);
  await check('Vier kompakte Hallenaufrufe nutzen den freien Timerplatz ohne Überdeckung',`document.querySelector('tr[data-match_id="match-50"] .ls-preparation-calls').children.length===4&&${preparationContentFits}`);
  await c.evaluate(`curt.locations=window.__prepLocations;cmatch.refresh_unassigned_preparation_context()`);
  await check('Nach Entfernen zusätzlicher Hallen schrumpft die Vorbereitung wieder auf ihre kompakte Breite',`document.querySelector('.ls-preparation-heading').getBoundingClientRect().width<=172.1&&document.documentElement.scrollWidth<=innerWidth&&${preparationContentFits}`);
  const tabletHintsMatchMockup=`(()=>{const assigned=[...document.querySelectorAll('.player .tablet_inline')],waiting=[...document.querySelectorAll('.player .tabletoperator_waiting_inline')];return assigned.length>0&&waiting.length>0&&[...assigned,...waiting].every(hint=>hint.getAttribute('role')==='img'&&hint.getAttribute('aria-label')===hint.title&&getComputedStyle(hint).backgroundImage==='none'&&hint.querySelector('svg:first-child rect[width="14"][height="20"]')&&[...hint.querySelectorAll('svg')].every(svg=>getComputedStyle(svg).width==='12px'))&&assigned.every(hint=>hint.querySelectorAll('svg').length===1&&hint.title==='Tabletbedienung auf Feld '+hint.querySelector('.ls-resource-court')?.textContent&&getComputedStyle(hint.querySelector('.ls-resource-court')).backgroundImage.includes('court.svg'))&&waiting.every(hint=>hint.querySelectorAll('svg').length===2&&hint.querySelector('svg:nth-child(2) circle[r="9"]')&&hint.title==='Wartet auf Tabletbedienung')&&[...document.querySelectorAll('.courts_container .player .ls-resource-hint')].every(hint=>getComputedStyle(hint).display==='none')})()`;
  await check('Tabletbindungen verwenden die Mockup-Symbole mit separatem Feld oder Warteuhr und verständlichen Hovertexten',tabletHintsMatchMockup);
  await c.evaluate(`window.__tabletHintPlayers=[...document.querySelectorAll('.unassigned_container .player:has(.ls-resource-hint)')].map(node=>({node,text:[...node.childNodes].find(child=>child.nodeType===3)}));window.__tabletHintWrites=window.__writes.length;for(const {node} of window.__tabletHintPlayers){cleitstand.player(node);cleitstand.player(node)}const ids=new Set(window.__tabletHintPlayers.map(({node})=>node.dataset.match_id));for(const match of curt.matches)if(ids.has(match._id))cmatch.update_players(match)`);
  await check('Live-Statusaktualisierungen erhalten die neuen Tabletsymbole ohne Duplikate, geänderte Namen oder Serveraktionen',`${tabletHintsMatchMockup}&&window.__tabletHintPlayers.length>0&&window.__tabletHintPlayers.every(({node,text})=>node.isConnected&&text.parentNode===node)&&window.__writes.length===window.__tabletHintWrites`);
  const dockShown=`!!document.querySelector('#drag-field-dock')?.getClientRects().length`;
  await nativeDrag('tr[data-match_id="match-45"] .match_num','.courts_container tr[data-court_id="CH_13"] .court_number',{
   scrollSource:false,cancel:true,
   verify:()=>check('Sind alle angezeigten Felder sichtbar, bleibt die zusätzliche Ablageleiste beim echten Spielziehen ausgeblendet',`document.querySelector('#drag-field-dock')?.hidden&&!(${dockShown})`),
  });
  await c.evaluate(`cleitstand.matchDrag('match-45');const first=document.querySelector('.courts_container .court_row .court_number');window.scrollTo(0,first.getBoundingClientRect().top+scrollY-document.querySelector('.toprow').getBoundingClientRect().bottom+1)`);
  await delay(80);
  await check('Schon eine teilweise unter dem festen Kopf verdeckte Feldzeile blendet die Ablageleiste ein',dockShown);
  await c.evaluate(`window.scrollTo(0,0)`);await delay(80);
  await check('Zurückscrollen blendet die Zusatzleiste während desselben Drags wieder aus',`!(${dockShown})`);
  const croppedHeight=await c.evaluate(`Math.floor(document.querySelector('.courts_container .court_row:last-child').getBoundingClientRect().bottom)-1`);
  await metrics(1920,croppedHeight);await delay(80);
  await check('Eine am unteren Fensterrand abgeschnittene Feldzeile blendet die Ablageleiste wieder ein',dockShown);
  await metrics(1920,940);await delay(80);
  await check('Mehr Fensterhöhe blendet die Zusatzleiste ohne Neustart des Drags wieder aus',`!(${dockShown})`);
  await c.evaluate(`cleitstand.clearMatchDrag();window.__dockCourts=structuredClone(curt.courts);curt.courts.find(court=>court._id==='CH_13').location_id='SN';cmatch.render_courts(document.querySelector('.courts_container'))`);
  await metrics(1920,croppedHeight);
  await click('#show_location_courts_SN');
  await c.evaluate(`cleitstand.matchDrag('match-45')`);
  await check('Auf diesem Gerät ausgeblendete Spielorte zählen nicht zu den sichtbaren Feldern und erscheinen nicht als Ablageziel',`!(${dockShown})&&!document.querySelector('#drag-field-dock [data-court_id="CH_13"]')`);
  await click('#show_location_courts_SN');
  await c.evaluate(`cleitstand.clearMatchDrag();curt.courts=window.__dockCourts;cmatch.render_courts(document.querySelector('.courts_container'));window.scrollTo(0,0)`);
  await metrics(390,3000);await delay(150);
  await c.evaluate(`cleitstand.matchDrag('match-45')`);
  await check('Eine horizontal breitere Spieltabelle allein blendet die Leiste bei vollständig sichtbaren Feldern nicht ein',`!(${dockShown})`);
  await c.evaluate(`document.querySelector('.courts_container .table-wrap').scrollLeft=100`);await delay(80);
  await check('Horizontal aus dem Bild gescrollte Feldnummern machen die zusätzliche Ablageleiste erreichbar',dockShown);
  await c.evaluate(`document.querySelector('.courts_container .table-wrap').scrollLeft=0`);await delay(80);
  await check('Zurückscrollen zu allen Feldnummern blendet die Leiste wieder aus',`!(${dockShown})`);
  await key('Escape','Escape',27);
  await check('Abbruch entfernt auch die ausgeblendete Ablageleiste vollständig',`!document.querySelector('#drag-field-dock')`);
  await metrics(1920,940);
  await c.evaluate(`window.__hallRowHeights=Object.fromEntries([...document.querySelectorAll('.courts_container .court_row')].map(row=>[row.dataset.court_id,row.getBoundingClientRect().height]));curt.courts.forEach((court,index)=>court.location_id=index%2?'SN':'CH');cmatch.render_courts(document.querySelector('.courts_container'))`);
  await delay(100);
  await check('Abwechselnd nummerierte Felder werden nach Halle unter farbigen, flachen Kopfzeilen gruppiert ohne höhere Spielzeilen',`(()=>{const rows=[...document.querySelectorAll('.courts_container tbody>tr')],headers=rows.filter(row=>row.classList.contains('ls-location-row')),ids=rows.map(row=>row.dataset.courtGroup?'header:'+row.dataset.courtGroup:row.dataset.location_id);return JSON.stringify(ids)===JSON.stringify(['header:CH',...Array(7).fill('CH'),'header:SN',...Array(6).fill('SN')])&&headers.every(header=>header.getBoundingClientRect().height<=20)&&headers[0].classList.contains('highlight_6')&&headers[1].classList.contains('highlight_4')&&getComputedStyle(headers[0].firstChild).backgroundColor!==getComputedStyle(headers[1].firstChild).backgroundColor&&rows.filter(row=>row.dataset.court_id).every(row=>Math.abs(row.getBoundingClientRect().height-window.__hallRowHeights[row.dataset.court_id])<.1)})()`);
  await c.evaluate(`window.__hallAudio=JSON.stringify([...document.querySelectorAll('.device-location-table input')].map(input=>input.checked));window.__hallLiveRow=document.querySelector('.courts_container tr[data-match_id="match-39"]');document.querySelector('.ls-location-row[data-court-group="SN"] button').focus()`);
  await key('Enter','Enter',13,'\r');
  await check('Hallenkopf klappt per Tastatur nur seine Felder ein und speichert die Auswahl unabhängig von den Ansagen',`document.querySelector('.ls-location-row[data-court-group="SN"] button').getAttribute('aria-expanded')==='false'&&document.querySelector('.ls-location-row[data-court-group="SN"]').getBoundingClientRect().height>0&&[...document.querySelectorAll('.courts_container .court_row[data-location_id="SN"]')].every(row=>row.classList.contains('do_not_show'))&&[...document.querySelectorAll('.courts_container .court_row[data-location_id="CH"]')].every(row=>!row.classList.contains('do_not_show'))&&localStorage.getItem('show_location_courts_SN')==='false'&&JSON.stringify([...document.querySelectorAll('.device-location-table input')].map(input=>input.checked))===window.__hallAudio`);
  await c.evaluate(`crouting.on_change({ctype:'score',tournament_key:'preview',val:{match_id:'match-39',network_score:[[12,11]],presses:[],now_on_court:true,court_id:'CH_10'}})`);
  await check('Live-Punkte bleiben auch in eingeklappter Halle aktuell und erhalten ihre Feldzeile',`document.querySelector('.courts_container tr[data-match_id="match-39"]')===window.__hallLiveRow&&window.__hallLiveRow.classList.contains('do_not_show')&&window.__hallLiveRow.querySelector('.match_score').getAttribute('aria-label')==='12:11'&&document.querySelector('.ls-location-row[data-court-group="SN"] button').getAttribute('aria-expanded')==='false'`);
  await snap('hallen-eingeklappt');
  await open();
  await c.evaluate(`curt.courts.forEach((court,index)=>court.location_id=index%2?'SN':'CH');cmatch.render_courts(document.querySelector('.courts_container'))`);
  await check('Nach Neuladen bleibt die Halle eingeklappt und über ihren sichtbaren Kopf wieder erreichbar',`document.querySelector('.ls-location-row[data-court-group="SN"] button').getAttribute('aria-expanded')==='false'&&[...document.querySelectorAll('.courts_container .court_row[data-location_id="SN"]')].every(row=>row.classList.contains('do_not_show'))`);
  await click('.ls-location-row[data-court-group="SN"] button');
  await check('Erneutes Öffnen stellt alle Felder der Halle wieder her und bleibt gerätebezogen gespeichert',`document.querySelector('.ls-location-row[data-court-group="SN"] button').getAttribute('aria-expanded')==='true'&&[...document.querySelectorAll('.courts_container .court_row')].every(row=>!row.classList.contains('do_not_show'))&&localStorage.getItem('show_location_courts_SN')==='true'`);
  await snap('hallen');
  await metrics(390,940);
  await c.evaluate(`document.querySelector('.courts_container .table-wrap').scrollLeft=250`);
  await delay(100);
  await check('Hallennamen und Pfeile bleiben beim horizontalen Scrollen der mobilen Tabelle erreichbar',`(()=>{const wrap=document.querySelector('.courts_container .table-wrap').getBoundingClientRect();return [...document.querySelectorAll('.ls-location-label')].every(label=>{const box=label.getBoundingClientRect();return box.left>=wrap.left&&box.right<=wrap.right})&&document.documentElement.scrollWidth<=innerWidth})()`);
  await open();
  await click('.ls-location-row[data-court-group="CH"] button');
  await c.evaluate(`window.__singleLocations=structuredClone(curt.locations);crouting.on_change({ctype:'locations_changed',tournament_key:'preview',val:{all_locations:curt.locations.filter(location=>location._id==='CH')}})`);
  await check('Bei nur einer Location entfällt die Hallenzeile und zuvor eingeklappte Felder bleiben vollständig erreichbar',`[...document.querySelectorAll('.ls-location-row')].every(row=>!row.getClientRects().length)&&document.querySelectorAll('.courts_container .court_row').length===13&&[...document.querySelectorAll('.courts_container .court_row')].every(row=>!row.classList.contains('do_not_show'))&&document.querySelector('[data-field-counts]').textContent.includes('13 Felder')`);
  await c.evaluate(`crouting.on_change({ctype:'locations_changed',tournament_key:'preview',val:{all_locations:window.__singleLocations}})`);
  await check('Bei mehreren konfigurierten Locations erscheint die Hallenzeile wieder, auch wenn nur eine Felder enthält',`document.querySelector('.ls-location-row[data-court-group="CH"]').getBoundingClientRect().height===19&&document.querySelector('.ls-location-row[data-court-group="CH"] button').getAttribute('aria-expanded')==='true'`);
  await open();
  await c.evaluate(`localStorage.setItem('bts-admin-card-layout-v1',JSON.stringify({top:['operators','announcement','device','automation'],sidebar:[]}))`);
  await open();
  assert.deepEqual(await arrangement(),{top:['operators','announcement','device','automation','rotation','tablets','logs'],sidebar:[]});
  await check('Gespeicherte Anordnung der vier bisherigen Kacheln bleibt erhalten und ergänzt Rotation einmal',`document.querySelectorAll('[data-board-card="rotation"]').length===1`);
  await c.evaluate(`window.__rotationOfficials=structuredClone(curt.umpires);window.__rotationContainer=document.querySelector('.umpire_container');crouting.on_change({ctype:'umpires_changed',tournament_key:'preview',val:{all_umpires:[]}})`);
  await check('Leere Rotation zeigt nur Warteliste und manuelle Pause mit erreichbaren Ablageflächen',`document.querySelectorAll('.official_rotation_compact>.official_section_body').length===2&&!document.querySelector('.official_rotation_compact .official_card_skin')&&document.querySelectorAll('.official_rotation_compact .official_card_drop:only-child').length===3&&document.querySelector('.umpire_container')===window.__rotationContainer`);
  await c.evaluate(`crouting.on_change({ctype:'umpires_changed',tournament_key:'preview',val:{all_umpires:structuredClone(window.__rotationOfficials)}});window.__rotationHadTimer=!!document.querySelector('[data-rotation-section="waiting"] [data-official-id="official-1"] .timer');crouting.on_change({ctype:'umpire_updated',tournament_key:'preview',val:{...window.__rotationOfficials[0],status:'oncourt',umpire_on_court:'CH_4',court_id:'CH_4'}})`);
  await check('Native Offiziellenänderungen entfernen Feld- und Vorbereitungszuordnungen aus der kompakten Rotation',`(()=>{const container=document.querySelector('[data-board-card="rotation"] .umpire_container');return container===window.__rotationContainer&&window.__rotationHadTimer&&container.querySelectorAll('.official_card_skin').length===3&&!container.querySelector('[data-official-id="official-1"],[data-official-id="official-2"],[data-official-id="official-3"]')&&!container.querySelector('.court')&&container.querySelectorAll('.official_section_body').length===2})()`);
  await c.evaluate(`crouting.on_change({ctype:'umpires_changed',tournament_key:'preview',val:{all_umpires:structuredClone(window.__rotationOfficials)}})`);
  await check('Automatische Ruhezeit steht mit laufender Uhr in der Warteliste, manuelle Pause im gemeinsamen Bereich',`!!document.querySelector('[data-rotation-section="waiting"] [data-official-id="official-1"] .timer')&&!document.querySelector('[data-rotation-section="unavailable"] [data-official-id="official-1"]')&&!!document.querySelector('[data-rotation-section="unavailable"] [data-official-id="official-6"]')`);
  await check('Rotationskarten verwenden dieselben Schiedsrichter- und Höhenmessgerät-Symbole wie die Spiele',`['umpire','service_judge'].every(role=>document.querySelector('.official_rotation_compact .official_card_icon.'+role+' .ico')?.innerHTML===document.querySelector('tr[data-match_id="match-45"] .'+role+'.ls-role-icon .ico')?.innerHTML)`);
  await check('Nächste Rollen stehen in getrennten beschrifteten Spalten nebeneinander',`${rotationColumnsFit}&&!!document.querySelector('[data-next-role="umpire"] [data-official-id="official-4"]')&&!!document.querySelector('[data-next-role="service_judge"] [data-official-id="official-5"]')`);
  await c.evaluate(`window.__rotationDropRest=document.querySelector('[data-official-list="service_judge_wait"]>.official_card_drop_terminal').getBoundingClientRect().height`);
  await nativeDrag('[data-official-id="official-4"] .official_card_name','[data-official-list="service_judge_wait"]>.official_card_drop_terminal',{
   settle:160,
   beforeHover:()=>check('Gültige Rotations-Dropzonen wachsen beim Ziehen und halten den sichtbaren Drag-Ursprung in Kartengröße',`(()=>{const target=document.querySelector('[data-official-list="service_judge_wait"]>.official_card_drop_terminal'),source=document.querySelector('[data-official-id="official-4"]');window.__rotationDropActive=target.getBoundingClientRect().height;return target.classList.contains('official_card_drop_active')&&window.__rotationDropActive>window.__rotationDropRest&&source.getBoundingClientRect().height===24&&getComputedStyle(source.querySelector('.official_card_name')).visibility==='visible'})()`),
   verify:point=>check('Beim Hover wächst die Rotations-Dropzone weiter und bleibt unter dem Mauszeiger',`(()=>{const target=document.querySelector('[data-official-list="service_judge_wait"]>.official_card_drop_terminal');return target.classList.contains('official_card_drop_hover_expand')&&target.getBoundingClientRect().height>window.__rotationDropActive&&target.contains(document.elementFromPoint(${point.x},${point.y}))})()`),
  });
  await delay(160);
  await check('Nach dem Ablegen kehren Rotations-Dropzonen zur kompakten Größe zurück',`!document.querySelector('.official_rotation_compact.officials_drag_active,.official_rotation_compact .official_card_placeholder,.official_rotation_compact .official_card_drop_hover_expand')&&document.querySelector('[data-official-list="service_judge_wait"]>.official_card_drop_terminal').getBoundingClientRect().height===window.__rotationDropRest`);
  await c.evaluate(`crouting.on_change({ctype:'umpire_updated',tournament_key:'preview',val:{...window.__rotationOfficials.find(official=>official._id==='official-4'),umpire_wait:null,service_judge_wait:Date.now()}})`);
  await check('Verschieben zwischen den Rollenspalten setzt die nächste Rolle über die bestehende Wartelistenzuordnung',`window.__writes.some(message=>message.type==='official_list_move'&&message.official_id==='official-4'&&message.to_list==='service_judge_wait')&&!!document.querySelector('[data-next-role="service_judge"] [data-official-id="official-4"]')&&!document.querySelector('[data-next-role="umpire"] [data-official-id="official-4"]')`);
  await c.evaluate(`crouting.on_change({ctype:'umpires_changed',tournament_key:'preview',val:{all_umpires:structuredClone(window.__rotationOfficials)}})`);
  await c.evaluate(`window.__rotationMoveCount=window.__writes.filter(message=>message.type==='official_list_move').length`);
  await nativeDrag('[data-official-id="official-1"] .official_card_name','[data-official-list="umpire_wait"]>.official_card_drop_terminal',{
   settle:160,
   verify:()=>check('Eine automatische Ruhezeit vergrößert keine gesperrten Wartelisten-Dropzonen',`!document.querySelector('[data-rotation-section="waiting"] .official_card_drop_active,[data-rotation-section="waiting"] .official_card_drop_hover_expand')&&!!document.querySelector('[data-rotation-section="unavailable"] .official_card_drop_active')`),
  });
  await check('Ziehen innerhalb der Warteliste hebt eine laufende automatische Ruhezeit nicht auf',`window.__writes.filter(message=>message.type==='official_list_move').length===window.__rotationMoveCount&&curt.umpires.find(official=>official._id==='official-1').umpire_pause===window.__rotationOfficials[0].umpire_pause`);
  await nativeDrag('[data-official-id="official-4"] .official_card_name','[data-rotation-section="unavailable"] .official_card_drop_terminal',{settle:160});
  await check('Manuelles Ablegen in Pause verwendet die vorhandene serverseitige Listenzuordnung',`window.__writes.some(message=>message.type==='official_list_move'&&message.official_id==='official-4'&&message.to_list==='umpire_pause'&&message.ordered_official_ids.includes('official-6'))`);
  await c.evaluate(`crouting.on_change({ctype:'umpire_updated',tournament_key:'preview',val:{...window.__rotationOfficials.find(official=>official._id==='official-4'),umpire_wait:null,umpire_manual_pause:Date.now()}})`);
  await check('Bestätigte manuelle Pause wechselt den Bereich und lässt die automatische Ruhezeit unverändert',`!!document.querySelector('[data-rotation-section="unavailable"] [data-official-id="official-4"]')&&!document.querySelector('[data-rotation-section="waiting"] [data-official-id="official-4"]')&&curt.umpires.find(official=>official._id==='official-1').umpire_pause===window.__rotationOfficials[0].umpire_pause`);
  await nativeDrag('[data-official-id="official-4"] .official_card_name','[data-official-list="umpire_wait"]>.official_card_drop_terminal',{settle:160});
  await check('Rückkehr aus manueller Pause verwendet die passende Warteliste und verändert keine wartenden Pausentimer',`(()=>{const move=window.__writes.filter(message=>message.type==='official_list_move'&&message.official_id==='official-4').at(-1);return move.to_list==='umpire_wait'&&!move.ordered_official_ids.includes('official-1')})()`);
  await c.evaluate(`window.__rotationWriteCount=window.__writes.length;crouting.on_change({ctype:'umpire_updated',tournament_key:'preview',val:{...window.__rotationOfficials[0],umpire_pause:null,umpire_wait:Date.now(),status:'ready'}})`);
  await check('Serverseitiger Ablauf entfernt die Ruhezeituhr und behält den Offiziellen ohne eigenen Aufruf in der Warteliste',`!!document.querySelector('[data-rotation-section="waiting"] [data-official-id="official-1"]')&&!document.querySelector('[data-official-id="official-1"] .timer')&&window.__writes.length===window.__rotationWriteCount`);
  await c.evaluate(`crouting.on_change({ctype:'umpires_changed',tournament_key:'preview',val:{all_umpires:structuredClone(window.__rotationOfficials).filter(official=>official._id==='official-6')}})`);
  await nativeDrag('[data-official-id="official-6"] .official_card_name','[data-official-list="umpire_wait"]>.official_card_drop_terminal',{
   settle:160,
   verify:point=>check('Auch eine leere Rollenwarteliste vergrößert ihr Ablageziel beim Hover und bleibt erreichbar',`(()=>{const target=document.querySelector('[data-official-list="umpire_wait"]>.official_card_drop_terminal');return target.matches(':only-child')&&target.classList.contains('official_card_drop_hover_expand')&&target.getBoundingClientRect().height===32&&target.contains(document.elementFromPoint(${point.x},${point.y}))})()`),
  });
  await check('Ablegen in die gewachsene leere Warteliste sendet die richtige Zuordnung',`(()=>{const move=window.__writes.filter(message=>message.type==='official_list_move'&&message.official_id==='official-6').at(-1);return move.to_list==='umpire_wait'&&JSON.stringify(move.ordered_official_ids)===JSON.stringify(['official-6'])})()`);
  await c.evaluate(`crouting.on_change({ctype:'umpires_changed',tournament_key:'preview',val:{all_umpires:structuredClone(window.__rotationOfficials).filter(official=>official._id!=='official-1').map(official=>official._id==='official-5'?{...official,service_judge_wait:null,umpire_wait:Date.now()}:official)}})`);
  await nativeDrag('[data-official-id="official-5"] .official_card_name','[data-official-list="umpire_wait"]>.official_card_drop:first-child',{
   settle:160,
   verify:point=>check('Eine innere Einfügezone wächst auf Kartengröße, während die Endzone wieder kleiner wird',`(()=>{const stack=document.querySelector('[data-official-list="umpire_wait"]'),target=stack.firstElementChild,terminal=stack.lastElementChild;return target.classList.contains('official_card_drop_hover_expand')&&target.getBoundingClientRect().height===24&&terminal.getBoundingClientRect().height===8&&target.contains(document.elementFromPoint(${point.x},${point.y}))})()`),
  });
  await check('Die gewachsene Einfügezone sendet die tatsächliche neue Reihenfolge',`(()=>{const move=window.__writes.filter(message=>message.type==='official_list_move'&&message.official_id==='official-5').at(-1);return move.to_list==='umpire_wait'&&JSON.stringify(move.ordered_official_ids)===JSON.stringify(['official-5','official-4'])})()`);
  await c.evaluate(`window.__rotationCancelWrites=window.__writes.length`);
  await nativeDrag('[data-official-id="official-4"] .official_card_name','[data-official-list="umpire_wait"]>.official_card_drop_terminal',{settle:160,cancel:true});
  await delay(160);
  await check('Abbruch stellt die kompakten Dropzonen ohne Schreibaktion wieder her',`window.__writes.length===window.__rotationCancelWrites&&!document.querySelector('.official_rotation_compact.officials_drag_active,.official_rotation_compact .official_card_placeholder,.official_rotation_compact .official_card_drop_hover_expand')&&document.querySelector('[data-official-list="umpire_wait"]>.official_card_drop_terminal').getBoundingClientRect().height===4`);
  await c.evaluate(`crouting.on_change({ctype:'umpires_changed',tournament_key:'preview',val:{all_umpires:structuredClone(window.__rotationOfficials)}})`);
  const scoreContentFits=`(()=>[...document.querySelectorAll('.courts_container tr.ls-match')].every(row=>{
    const score=row.querySelector('td.score'),calls=row.querySelector('td.call_td');if(!score||!calls)return true;
    const box=score.getBoundingClientRect(),actions=calls.getBoundingClientRect(),officials=row.querySelector('.umpire_and_tablet'),buttons=[...calls.querySelectorAll('button,a,[role="button"]')].filter(button=>button.getBoundingClientRect().width&&getComputedStyle(button).visibility!=='hidden').map(button=>button.getBoundingClientRect());
    return Math.abs(actions.width-108)<.1&&buttons.every((button,index)=>button.left>=actions.left-.1&&button.right<=actions.right-4+.1&&buttons.slice(index+1).every(other=>button.right<=other.left||button.left>=other.right))&&
      [...score.querySelectorAll('.ls-scoreline')].every(node=>node.getBoundingClientRect().right<=box.right-parseFloat(getComputedStyle(score).paddingRight)+1)&&
      [...row.querySelectorAll('.match_timer .timer')].filter(node=>getComputedStyle(node).display!=='none').every(node=>{
        const clock=node.getBoundingClientRect(),leading=clock.right<=box.left,frame=row.getBoundingClientRect();
        const host=node.closest('.match_timer'),display=host.style.getPropertyValue('display'),priority=host.style.getPropertyPriority('display');
        let withoutClock;
        // Hide the wrapper so short-format width reservations remain unchanged.
        try {host.style.setProperty('display','none','important');withoutClock=row.getBoundingClientRect().height;}
        finally {if(display)host.style.setProperty('display',display,priority);else host.style.removeProperty('display');}
        return Math.abs(frame.height-withoutClock)<.1&&clock.top>=frame.top&&clock.bottom<=frame.bottom-1&&
          (leading?clock.left>=officials.getBoundingClientRect().left&&[...officials.querySelectorAll('.name')].every(name=>name.getBoundingClientRect().right<=clock.left):clock.left>=box.left-1)&&clock.right<=actions.right-4+1&&buttons.every(button=>clock.right<=button.left||clock.left>=button.right);
      });
  }))()`;
  await c.evaluate(`window.__scoreLayoutMatches=structuredClone(curt.matches);window.__scoreLayoutFormats=structuredClone(curt.scoring_formats);window.__scoreLayoutEvents=structuredClone(curt.events);window.__threeScoreWidth=document.querySelector('.courts_container td.score').getBoundingClientRect().width;window.__threeTeamWidth=document.querySelector('.courts_container td.ls-teams').getBoundingClientRect().width`);
  console.log('Ergebnisbreite '+JSON.stringify(await c.evaluate(`({sets:document.querySelector('.leitstand').style.getPropertyValue('--score-set-count'),column:getComputedStyle(document.querySelector('.ls-score-column')).width,columnFont:getComputedStyle(document.querySelector('.ls-score-column')).font,scoreFont:getComputedStyle(document.querySelector('.ls-scoreline')).font,cell:document.querySelector('.courts_container td.score').getBoundingClientRect().width,lines:[...document.querySelectorAll('.courts_container .ls-scoreline')].map(node=>node.getBoundingClientRect().width),fits:${scoreContentFits}})`)));
  await check('Drei-Satz-Turnier reserviert nur die benötigte Ergebnisbreite',`(()=>{const cell=document.querySelector('.courts_container td.score'),width=cell.getBoundingClientRect().width,full=Math.max(...[...document.querySelectorAll('.courts_container .ls-scoreline')].map(node=>node.getBoundingClientRect().width));return document.querySelector('.leitstand').style.getPropertyValue('--score-set-count')==='3'&&Math.abs(width-full-8)<2})()&&${scoreContentFits}`);
  await check('Feldaktionen behalten in beiden Dichten vier Pixel rechten Rand und die Vorbereitung bleibt kompakt',`(()=>{const board=document.querySelector('.leitstand'),comfort=board.classList.contains('comfort');try{return [false,true].every(mode=>{board.classList.toggle('comfort',mode);const row=document.querySelector('tr[data-match_id="match-40"]'),button=row.querySelector('.match_confirm_button').getBoundingClientRect(),last=row.querySelector('.ls-set-score:last-child').getBoundingClientRect(),gap=button.left-last.right;return [...document.querySelectorAll('.match_table:not(.ls-planned-table) td.call_td')].every(cell=>Math.abs(cell.getBoundingClientRect().width-108)<.1&&getComputedStyle(cell).paddingRight==='4px')&&gap>=0&&gap<=3&&${scoreContentFits}&&${preparationContentFits}})}finally{board.classList.toggle('comfort',comfort)}})()`);
  await metrics(390,844);
  await delay(150);
  await c.evaluate(`window.__narrowThreeRowHeight=document.querySelector('tr[data-match_id="match-41"]').getBoundingClientRect().height`);
  await check('Auch bei minimaler Ergebnis-Schriftgröße überdecken sich Einspieluhr und beide Buttons nicht',scoreContentFits);
  await metrics(1920,940);
  await c.evaluate(`for(const original of window.__scoreLayoutMatches){const updated=structuredClone(original);updated.setup.counting='1x21';updated.setup.scoring_format=calc.scoring_format_from_counting('1x21');if(Array.isArray(updated.network_score))updated.network_score=updated.network_score.slice(0,1);crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:updated._id,match:updated}})}`);
  await check('Ein-Satz-Turnier reserviert nur einen Satz und hält Einspieluhr sowie beide Aktionen getrennt bedienbar',`(()=>{const cell=document.querySelector('.courts_container td.score'),full=Math.max(...[...document.querySelectorAll('.courts_container .ls-scoreline')].map(node=>node.getBoundingClientRect().width));return document.querySelector('.leitstand').style.getPropertyValue('--score-set-count')==='1'&&Math.abs(cell.getBoundingClientRect().width-full-8)<2&&cell.getBoundingClientRect().width<window.__threeScoreWidth})()&&${scoreContentFits}`);
  await metrics(390,844);
  await delay(150);
  await check('Ein-Satz-Einspieluhr bleibt ohne Überdeckung oder zusätzliche Zeilenhöhe vor dem Ergebnis sichtbar',`(()=>{const row=document.querySelector('tr[data-match_id="match-41"]'),clock=row.querySelector('.match_timer .timer').getBoundingClientRect();return clock.right<row.querySelector('td.score').getBoundingClientRect().left&&row.getBoundingClientRect().height<=window.__narrowThreeRowHeight+.1})()&&${scoreContentFits}`);
  await metrics(1920,940);
  await c.evaluate(`for(const original of window.__scoreLayoutMatches){const updated=structuredClone(original);updated.setup.scoring_format={...calc.scoring_format_from_counting('3x21'),numSets:2};if(Array.isArray(updated.network_score))updated.network_score=updated.network_score.slice(0,2);crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:updated._id,match:updated}})}`);
  await check('Auch Zwei-Satz-Formate behalten die feste Aktionsbreite und getrennt bedienbare Uhren und Buttons',`document.querySelector('.leitstand').dataset.scoreSetCount==='2'&&${scoreContentFits}`);
  await c.evaluate(`(()=>{const updated=structuredClone(curt.matches.find(match=>match._id==='match-44'));updated.setup.counting='5x11_15';updated.setup.scoring_format=calc.scoring_format_from_counting('5x11_15');updated.network_score=[[11,9],[9,11],[11,8],[8,11],[4,2]];crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:updated._id,match:updated}})})()`);
  await check('Gemischtes Turnier erweitert die Spalte für fünf mögliche Sätze ohne Abschneiden',`document.querySelector('.leitstand').style.getPropertyValue('--score-set-count')==='5'&&document.querySelector('.courts_container td.score').getBoundingClientRect().width>window.__threeScoreWidth&&document.querySelectorAll('tr[data-match_id="match-44"] .ls-set-score').length===5&&${scoreContentFits}`);
  await c.evaluate(`for(const original of window.__scoreLayoutMatches)crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:original._id,match:original}})`);
  await check('Entfernen der letzten Fünf-Satz-Paarung gibt die zusätzliche Breite wieder frei',`document.querySelector('.leitstand').style.getPropertyValue('--score-set-count')==='3'&&Math.abs(document.querySelector('.courts_container td.score').getBoundingClientRect().width-window.__threeScoreWidth)<1`);
  await c.evaluate(`curt.scoring_formats={default_id:1,formats:[{id:1,...calc.scoring_format_from_counting('1x21')},{id:5,...calc.scoring_format_from_counting('5x11_15')}]};crouting.on_change({ctype:'update_btp_events',tournament_key:'preview',val:{events:{events:[{name:'MX',stages:[{scoring_format:5}]}]}}})`);
  await check('Eine live zugewiesene Fünf-Satz-Stage passt die Breite vor ihren Spielen an',`document.querySelector('.leitstand').style.getPropertyValue('--score-set-count')==='5'&&document.querySelector('.courts_container td.score').getBoundingClientRect().width>window.__threeScoreWidth`);
  await c.evaluate(`curt.scoring_formats=window.__scoreLayoutFormats;crouting.on_change({ctype:'update_btp_events',tournament_key:'preview',val:{events:window.__scoreLayoutEvents}})`);
  await check('Nach Rückkehr zur Drei-Satz-Zählweise schrumpft die Ergebnisspalte wieder',`document.querySelector('.leitstand').style.getPropertyValue('--score-set-count')==='3'&&Math.abs(document.querySelector('.courts_container td.score').getBoundingClientRect().width-window.__threeScoreWidth)<1&&${scoreContentFits}`);
  await c.evaluate(`(()=>{
    window.__intervalOriginal=structuredClone(curt.matches.find(match=>match._id==='match-44'));
    window.__setInterval=scores=>{
    const changed=structuredClone(window.__intervalOriginal),presses=[],now=Date.now();changed.setup.is_doubles=false;
    const add=(type,extra={})=>presses.push({type,timestamp:now+presses.length*100,...extra});
    const state=()=>calc.remote_state({settings:{negative_timers:true},lang:'de'},changed.setup,presses);
    add('pick_side',{team1_left:true});add('love-all');
    for(const [set,points] of scores.entries()){
      for(let point=0;point<Math.max(...points);point++)for(let team=0;team<2;team++)if(point<points[team])add('score',{side:state().game.team1_left===(team===0)?'left':'right'});
      if(set<scores.length-1){add('postgame-confirm');add('love-all');}
    }
    const shift=20000+(presses.length-1)*100;presses.forEach(press=>press.timestamp-=shift);
    changed.presses=presses;changed.network_score=scores;
    crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:changed._id,match:changed}});
    window.__intervalWidth=document.querySelector('.courts_container td.score').getBoundingClientRect().width;
    };
    window.__setInterval([[17,21],[21,17],[10,11]]);
  })()`);
  await check('Im letzten möglichen Satz nutzt die echte Pausenuhr Aktionen ohne zusätzliche Ergebnisbreite',`(()=>{const row=document.querySelector('tr[data-match_id="match-44"]'),match=curt.matches.find(match=>match._id==='match-44');return row.querySelectorAll('.ls-set-score').length===3&&!!row.querySelector('td.call_td>.match_timer .timer')&&!row.querySelector('td.score .timer')&&cmatch._extract_match_timer_state(match).timer.duration===60000&&Math.abs(window.__intervalWidth-window.__threeScoreWidth)<1})()&&${scoreContentFits}`);
  await check('Satzpause verändert in kompakter und komfortabler Dichte die Zeilenhöhe nicht',`(()=>{const board=document.querySelector('.leitstand'),comfort=board.classList.contains('comfort');try{return [false,true].every(mode=>{board.classList.toggle('comfort',mode);return ${scoreContentFits}})}finally{board.classList.toggle('comfort',comfort)}})()`);
  await snap('satzpause');
  await metrics(1536,940);
  await check('Schmaleres Fenster behält die Pausenuhr im letzten Satz vollständig unter Aktionen',scoreContentFits);
  await metrics(1920,940);
  await c.evaluate(`(()=>{const match=curt.matches.find(match=>match._id==='match-44'),presses=structuredClone(match.presses);for(let point=10;point<21;point++){const state=calc.remote_state({settings:{negative_timers:true},lang:'de'},match.setup,presses);presses.push({type:'score',timestamp:Date.now(),side:state.game.team1_left?'left':'right'})}crouting.on_change({ctype:'score',tournament_key:'preview',val:{match_id:match._id,network_score:[[17,21],[21,17],[21,11]],presses,now_on_court:true,court_id:'CH_1'}})})()`);
  await check('Nach der Uhr unter Aktionen bleibt Bestätigen nach dem letzten Punkt erhalten',`(()=>{const row=document.querySelector('tr[data-match_id="match-44"]');return !!row.querySelector('td.call_td>.match_confirm_button')&&!row.querySelector('.timer')&&!!row.querySelector('td.score>.match_timer')})()`);
  await c.evaluate(`window.__setInterval([[17,21],[21,17],[10,11]])`);
  await c.evaluate(`(()=>{const match=curt.matches.find(match=>match._id==='match-44'),state=calc.remote_state({settings:{negative_timers:true},lang:'de'},match.setup,match.presses),presses=[...match.presses,{type:'score',timestamp:Date.now(),side:state.game.team1_left?'left':'right'}];crouting.on_change({ctype:'score',tournament_key:'preview',val:{match_id:match._id,network_score:[[17,21],[21,17],[11,11]],presses,now_on_court:true,court_id:'CH_1'}})})()`);
  await check('Nächster Punkt beendet die Satzpause und räumt die Aktionsspalte wieder frei',`(()=>{const row=document.querySelector('tr[data-match_id="match-44"]');return !row.querySelector('.match_timer .timer')&&!row.querySelector('td.call_td>.match_timer')&&!!row.querySelector('td.score>.match_timer')&&Math.abs(document.querySelector('.courts_container td.score').getBoundingClientRect().width-window.__threeScoreWidth)<1})()&&${scoreContentFits}`);
  await c.evaluate(`window.__setInterval([[17,21],[10,11]])`);
  await check('Im vorletzten Satz ragt die Pausenuhr ohne zusätzliche Spaltenbreite in Aktionen hinein',`(()=>{const row=document.querySelector('tr[data-match_id="match-44"]'),clock=row.querySelector('td.score>.match_timer .timer');return row.querySelectorAll('.ls-set-score').length===2&&!!clock&&!row.querySelector('td.call_td>.match_timer')&&clock.getBoundingClientRect().right>row.querySelector('td.score').getBoundingClientRect().right&&Math.abs(window.__intervalWidth-window.__threeScoreWidth)<1&&Math.abs(row.querySelector('td.ls-teams').getBoundingClientRect().width-window.__threeTeamWidth)<1})()&&${scoreContentFits}`);
  await check('Überstehende Pausenuhr bleibt über dem grünen Aktionsverlauf sichtbar',`(()=>{const row=document.querySelector('tr[data-match_id="match-44"]'),green=row.classList.contains('preparation_demand_court');try{row.classList.add('preparation_demand_court');const clock=row.querySelector('.match_timer .timer'),box=clock.getBoundingClientRect();return document.elementFromPoint(box.right-4,box.y+box.height/2)?.closest('.timer')===clock}finally{row.classList.toggle('preparation_demand_court',green)}})()`);
  await check('Vorletzter Satz passt in beiden Dichten ohne höhere Spielzeile',`(()=>{const board=document.querySelector('.leitstand'),comfort=board.classList.contains('comfort');try{return [false,true].every(mode=>{board.classList.toggle('comfort',mode);return ${scoreContentFits}})}finally{board.classList.toggle('comfort',comfort)}})()`);
  await snap('satzpause-vorletzter-satz');
  await metrics(1536,940);
  await check('Auch im schmaleren Fenster passen beide Ergebnisse und die Uhr im vorletzten Satz',scoreContentFits);
  await metrics(1920,940);
  await c.evaluate(`crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:window.__intervalOriginal._id,match:window.__intervalOriginal}})`);
  await c.evaluate(`(()=>{
    window.__nameOriginal=structuredClone(curt.matches.find(match=>match._id==='match-44'));
    const changed=structuredClone(window.__nameOriginal);
    Object.assign(changed.setup.teams[0].players[0],{firstname:'Alexander Maximilian',lastname:'Weber',name:'Alexander Maximilian Weber'});
    Object.assign(changed.setup.teams[0].players[1],{firstname:'Nina Maria',lastname:'Hansen',name:'Nina Maria Hansen'});
    crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:changed._id,match:changed}});
    window.__nameRow=document.querySelector('tr[data-match_id="match-44"]');window.__nameGroup=window.__nameRow.querySelector('.team-one');
    window.__nameMembers=[...window.__nameGroup.querySelectorAll('.player')];
    window.__nameLabels=()=>window.__nameMembers.map(node=>[...node.childNodes].find(child=>child.nodeType===3).nodeValue.replaceAll('\\xa0',' '));
    window.__nameSteps=[['Alexander Maximilian Weber','Nina Maria Hansen'],['Alexander Weber','Nina Maria Hansen'],['Alexander Weber','Nina Hansen'],['A. Weber','Nina Hansen'],['A. Weber','N. Hansen']];
    window.__nameGroup.style.width='1000px';window.__nameGroup.classList.add('ls-name-measuring');
    const range=document.createRange();range.selectNodeContents(window.__nameGroup);
    window.__nameWidths=window.__nameSteps.map(labels=>{labels.forEach((name,index)=>{[...window.__nameMembers[index].childNodes].find(child=>child.nodeType===3).nodeValue=name.replace(' ','\\xa0')});return range.getBoundingClientRect().width});
    window.__nameGroup.classList.remove('ls-name-measuring');
    window.__nameRowHeight=window.__nameRow.getBoundingClientRect().height;
  })()`);
  await until(()=>c.evaluate(`JSON.stringify(window.__nameLabels())===JSON.stringify(window.__nameSteps[0])`));
  await check('Spielernamen bleiben bei ausreichender Breite vollständig ausgeschrieben',`window.__nameMembers.every(node=>!node.title)&&window.__nameRow.getBoundingClientRect().height===window.__nameRowHeight`);
  for(const [index,label] of ['Zweiter Vorname des längeren Namens entfällt zuerst','Danach entfällt der zweite Vorname des anderen Spielers','Erst danach wird der längere Vorname auf Initialen gekürzt','Zuletzt wird auch der andere Vorname auf Initialen gekürzt'].entries()) {
    const step=index+1;
    await c.evaluate(`window.__nameGroup.style.width=Math.ceil((window.__nameWidths[${step-1}]+window.__nameWidths[${step}])/2)+'px'`);
    await until(()=>c.evaluate(`JSON.stringify(window.__nameLabels())===JSON.stringify(window.__nameSteps[${step}])`));
    await check(label,`window.__nameRow.getBoundingClientRect().height===window.__nameRowHeight`);
  }
  await check('Gekürzte Spielernamen zeigen ihre vollständigen Namen per Hover und bleiben vollständig durchsuchbar',`window.__nameMembers.every((node,index)=>node.title===window.__nameSteps[0][index]&&node.getAttribute('aria-label')===window.__nameSteps[0][index])&&curt.matches.find(match=>match._id==='match-44').setup.teams[0].players[0].name==='Alexander Maximilian Weber'`);
  await c.evaluate(`document.querySelector('[data-board-search]').value='Maximilian';document.querySelector('[data-board-search]').dispatchEvent(new Event('input'))`);
  await check('Suche findet auch einen ausgeblendeten zweiten Vornamen',`!window.__nameRow.hidden`);
  await c.evaluate(`document.querySelector('[data-board-search]').value='';document.querySelector('[data-board-search]').dispatchEvent(new Event('input'));cmatch.update_players(curt.matches.find(match=>match._id==='match-44'))`);
  await until(()=>c.evaluate(`JSON.stringify(window.__nameLabels())===JSON.stringify(window.__nameSteps[4])`));
  await check('Native Spielerstatus-Aktualisierungen erhalten Namen, Tooltips und vorhandene Spielerknoten',`window.__nameMembers.every((node,index)=>node.isConnected&&node===window.__nameRow.querySelectorAll('.team-one .player')[index]&&node.title===window.__nameSteps[0][index])`);
  await c.evaluate(`window.__nameGroup.style.width='60px'`);
  await until(()=>c.evaluate(`window.__nameRow.getBoundingClientRect().height>window.__nameRowHeight`));
  await check('Erst nach sämtlichen Kürzungen darf eine weiterhin zu breite Paarung umbrechen',`JSON.stringify(window.__nameLabels())===JSON.stringify(window.__nameSteps[4])&&window.__nameMembers.every(node=>node.title)`);
  await c.evaluate(`window.__nameGroup.style.width='1000px'`);
  await until(()=>c.evaluate(`JSON.stringify(window.__nameLabels())===JSON.stringify(window.__nameSteps[0])`));
  await check('Mehr Platz stellt volle Namen ohne Kürzungstooltip und die bisherige Zeilenhöhe wieder her',`window.__nameMembers.every(node=>!node.title)&&window.__nameRow.getBoundingClientRect().height===window.__nameRowHeight`);
  await c.evaluate(`crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:window.__nameOriginal._id,match:window.__nameOriginal}})`);
  await c.evaluate(`(()=>{
    window.__tabletNameOriginal=structuredClone(curt.matches.find(match=>match._id==='match-46'));
    const changed=structuredClone(window.__tabletNameOriginal);
    Object.assign(changed.setup.tabletoperators[0],{firstname:'Alexander Maximilian',lastname:'Weber',name:'Alexander Maximilian Weber'});
    Object.assign(changed.setup.tabletoperators[1],{firstname:'Nina Maria',lastname:'Hansen',name:'Nina Maria Hansen'});
    crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:changed._id,match:changed}});
    window.__tabletNames=document.querySelector('tr[data-match_id="match-46"] .operator-pair .name');window.__tabletNames.style.width='100px';
  })()`);
  await until(()=>c.evaluate(`window.__tabletNames.querySelectorAll('.pair-member')[0].textContent.startsWith('A.')&&window.__tabletNames.querySelectorAll('.pair-member')[1].textContent.startsWith('N.')`));
  await c.evaluate(`window.__tabletNames.click()`);
  await check('Tablet-Paarungen behalten bei gekürzten Namen den Trenner, vollständige Tooltips und ihren gemeinsamen Check-in',`window.__tabletNames.textContent.includes('/')&&[...window.__tabletNames.querySelectorAll('.pair-member')].every((node,index)=>node.title===window.__nameSteps[0][index]+' · '+window.__tabletNames.dataset.checkInAction)&&window.__writes.some(message=>message.type==='match_participant_check_in'&&message.match_id==='match-46'&&message.participant_ids.length===2&&message.checked_in===true)`);
  await c.evaluate(`(()=>{
    curt.tabletoperator_split_doubles=true;
    const changed=structuredClone(curt.matches.find(match=>match._id==='match-46'));changed.setup.tabletoperators[1].firstname='Marie';changed.setup.tabletoperators[1].name='Marie Hansen';
    crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:changed._id,match:changed}});
    window.__individualOperators=[...document.querySelectorAll('tr[data-match_id="match-46"] .operators > .person .name')];window.__individualOperators[1].click();
  })()`);
  await check('Einzeln aufgerufene Tabletbediener behalten verschiedene Namen und ihren jeweiligen Check-in',`!document.querySelector('tr[data-match_id="match-46"] .operator-pair')&&window.__individualOperators.length===2&&window.__individualOperators[0].dataset.lsFullName==='Alexander Maximilian Weber'&&window.__individualOperators[1].dataset.lsFullName==='Marie Hansen'&&window.__writes.at(-1).participant_id===window.__tabletNameOriginal.setup.tabletoperators[1].btp_id&&!window.__writes.at(-1).participant_ids`);
  await c.evaluate(`curt.tabletoperator_split_doubles=false`);
  await c.evaluate(`crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:window.__tabletNameOriginal._id,match:window.__tabletNameOriginal}})`);
  await c.evaluate(`window.__officialName=document.querySelector('tr[data-match_id="match-45"] .umpire_and_tablet > .person .name');window.__officialName.parentElement.style.width='100px'`);
  await until(()=>c.evaluate(`window.__officialName.textContent.replaceAll('\\xa0',' ')==='S. Weber'`));
  await check('Offiziellennamen werden nur bei echtem Platzmangel gekürzt',`window.__officialName.title==='Sven Weber · '+window.__officialName.dataset.checkInAction`);
  await c.evaluate(`window.__officialName.parentElement.style.width='250px'`);
  await until(()=>c.evaluate(`window.__officialName.textContent.replaceAll('\\xa0',' ')==='Sven Weber'`));
  await check('Zusätzlicher Platz stellt auch bei Offiziellen den vollen Namen wieder her',`window.__officialName.title===window.__officialName.dataset.checkInAction`);
  await c.evaluate(`window.__officialName.parentElement.style.width=''`);
  await c.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  const fieldIconsKeepRowHeight=`(()=>{const board=document.querySelector('.leitstand'),comfort=board.classList.contains('comfort'),probe=document.createElement('style');probe.textContent='.leitstand .match_table .court_number :is(.court_num,.court_history,.court_inactive){display:none!important}';try{return [false,true].every(mode=>{board.classList.toggle('comfort',mode);const rows=[...document.querySelectorAll('.leitstand .match_table tbody > tr')],withIcons=rows.map(row=>row.getBoundingClientRect().height);document.head.append(probe);const withoutIcons=rows.map(row=>row.getBoundingClientRect().height);probe.remove();return withIcons.every((height,index)=>height<=withoutIcons[index]+.01)})}finally{probe.remove();board.classList.toggle('comfort',comfort)}})()`;
  await check('Feldgrafiken erhöhen keine Zeilenhöhe in Kompakt- oder Komfortansicht',fieldIconsKeepRowHeight);
  await check('Freie Durchsage hat ein festes höheres Textfeld ohne zusätzliche Bereitschaftszeile',`(()=>{const field=document.querySelector('#custom_announcement'),style=getComputedStyle(field);return field.offsetHeight===72&&style.resize==='none'&&style.overflowY==='auto'&&!document.querySelector('.announcements_container .local_speech_readiness')&&document.querySelector('#local_announce_btn').disabled&&document.querySelector('#remote_announce_btn').disabled})()`);
  await c.evaluate(`document.querySelector('#custom_announcement').value='Zeile\\n'.repeat(25)`);
  await check('Längerer Durchsagentext scrollt innerhalb der unveränderten Höhe',`(()=>{const field=document.querySelector('#custom_announcement');return field.scrollHeight>field.clientHeight&&field.offsetHeight===72})()`);
  await c.evaluate(`window.__speechFixture.status='queued';document.querySelector('#custom_announcement').value='  Durchsage für Halle eins  ';document.querySelector('#custom_announcement').dispatchEvent(new Event('input'));btsSpeechReadiness.refresh(true)`);
  await check('Beide Wiedergabeknöpfe zeigen den tatsächlichen Vorbereitungsstatus mit Symbol und Hovertext',`['#local_announce_btn','#remote_announce_btn'].every(selector=>{const button=document.querySelector(selector);return button.dataset.speechState==='preparing'&&button.title.includes('Wird vorbereitet')&&getComputedStyle(button,'::before').maskImage!=='none'})`);
  await click('#local_announce_btn');
  await check('Unfertige lokale Durchsage öffnet die Auswahl ohne voreilig abzuspielen',`document.querySelector('.announcement-playback-menu').open&&!document.querySelector('.announcement-browser-button').hidden&&window.__localAnnouncements.length===0`);
  await snap('durchsage-auswahl');
  await click('.announcement-wait-button');
  await check('Warten bereitet den genauen Text vor und hält die Wiedergabe bis zur Fertigstellung zurück',`window.__speechPrepared.some(parts=>parts[0]==='Durchsage für Halle eins')&&window.__localAnnouncements.length===0&&document.querySelector('.announcement-playback-menu').open&&document.querySelector('#local_announce_btn').disabled`);
  await c.evaluate(`window.__speechFixture.status='completed'`);
  await until(()=>c.evaluate(`window.__localAnnouncements.length===1`));
  await check('Fertiges Audio startet genau einmal als Serveraudio und schließt die Auswahl',`window.__localAnnouncements[0].speechMode==='server'&&window.__localAnnouncements[0].parts[0]==='Durchsage für Halle eins'&&!document.querySelector('.announcement-playback-menu').open`);
  await c.evaluate(`window.__speechFixture.status='missing';document.querySelector('#custom_announcement').value='Remote Browserdurchsage';document.querySelector('#custom_announcement').dispatchEvent(new Event('input'));btsSpeechReadiness.refresh(true)`);
  await click('#remote_announce_btn');await click('.announcement-browser-button');
  await check('Remote-Auswahl überträgt Browser als Ausgabeart zusammen mit dem unveränderten Text',`window.__writes.filter(message=>message.type==='free_announce').length===1&&window.__writes.some(message=>message.type==='free_announce'&&message.speech_mode==='browser'&&message.text==='Remote Browserdurchsage')`);
  await c.evaluate(`localStorage.setItem('enable_free_announcements','true');crouting.on_change({ctype:'free_announce',tournament_key:'preview',val:{text:'Remote Browserdurchsage',speech_mode:'browser',_announcement_claim_key:'fixture-browser',_announcement_ts:Date.now()}})`);
  await until(()=>c.evaluate(`window.__localAnnouncements.length===2`));
  await check('Das Remote-Ereignis bewahrt die gewählte Ausgabeart bis zur tatsächlichen Wiedergabe',`window.__localAnnouncements[1].speechMode==='browser'&&window.__localAnnouncements[1].parts[0]==='Remote Browserdurchsage'`);
  await c.evaluate(`window.__speechFixture.settings.mode='server';document.querySelector('#custom_announcement').value='Abgebrochene Durchsage';document.querySelector('#custom_announcement').dispatchEvent(new Event('input'));btsSpeechReadiness.refresh(true)`);
  await click('#local_announce_btn');
  await check('Bei deaktiviertem Browser-Fallback wird die Browseroption nicht angeboten',`document.querySelector('.announcement-playback-menu').open&&document.querySelector('.announcement-browser-button').hidden`);
  await click('.announcement-wait-button');await click('.announcement-cancel-button');
  await c.evaluate(`window.__speechFixture.status='completed'`);await delay(1100);
  await check('Abbrechen verhindert eine spätere Wiedergabe auch nach Fertigstellung',`window.__localAnnouncements.length===2&&!document.querySelector('.announcement-playback-menu').open&&!document.querySelector('#local_announce_btn').disabled`);
  await c.evaluate(`window.__speechFixture.status='queued';document.querySelector('#custom_announcement').dispatchEvent(new Event('input'));btsSpeechReadiness.refresh(true)`);
  await click('#remote_announce_btn');await click('.announcement-wait-button');
  await c.evaluate(`document.querySelector('#custom_announcement').value='Geänderter Text';document.querySelector('#custom_announcement').dispatchEvent(new Event('input'));window.__speechFixture.status='completed'`);await delay(1100);
  await check('Eine Textänderung verwirft die wartende Remote-Durchsage',`window.__writes.filter(message=>message.type==='free_announce').length===1&&!document.querySelector('.announcement-playback-menu').open`);
  await c.evaluate(`window.__speechFixture.settings.mode='auto';document.querySelector('#custom_announcement').dispatchEvent(new Event('input'));btsSpeechReadiness.refresh(true)`);
  await click('#remote_announce_btn');
  await check('Bereite Remote-Durchsagen starten direkt mit ihrem Text',`window.__writes.filter(message=>message.type==='free_announce').length===2&&window.__writes.filter(message=>message.type==='free_announce')[1].text==='Geänderter Text'&&!document.querySelector('.announcement-playback-menu').open`);
  await c.evaluate(`window.__savedConfirm=window.confirm;window.confirm=()=>false`);await click('#announce_emergency_btn');
  await check('Die Evakuierungsschaltfläche löst keine freie Durchsage aus',`window.__writes.filter(message=>message.type==='free_announce').length===2`);
  await c.evaluate(`window.confirm=window.__savedConfirm;document.querySelector('#custom_announcement').value='';document.querySelector('#custom_announcement').dispatchEvent(new Event('input'));localStorage.removeItem('enable_free_announcements');btsSpeechReadiness.refresh(true)`);
  await c.evaluate(`window.__oldBtp={enabled:curt.btp_enabled,autofetch:curt.btp_autofetch_enabled,interval:curt.btp_autofetch_timeout_intervall,status:curt.btp_status};curt.btp_enabled=true;curt.btp_autofetch_enabled=true;curt.btp_autofetch_timeout_intervall=30;ctournament.btp_status_changed({val:{status:'connected',next_fetch_ts:Date.now()+28000}})`);
  await c.evaluate(`window.__countdowns=[[30,18000],[99,99000],[100,99000],[100,18000],[3600,3599000]].map(([interval,remaining])=>{curt.btp_autofetch_timeout_intervall=interval;ctournament.btp_status_changed({val:{status:'connected',next_fetch_ts:Date.now()+remaining}});return{prefix:document.querySelector('.toprow_service_badge_prefix').textContent,value:document.querySelector('.toprow_service_badge_timer').textContent}})`);
  await check('Countdown verwendet bis 99 Sekunden Sekundenwerte und darüber dauerhaft Minuten und Sekunden',`window.__countdowns.every((entry,index)=>entry.prefix==='in'&&entry.value===['18 s','99 s','1:39','0:18','59:59'][index])`);
  await c.evaluate(`curt.btp_autofetch_timeout_intervall=30;ctournament.btp_status_changed({val:{status:'connected',next_fetch_ts:Date.now()+28000}});window.__originalServices={bts:curt.status,ticker:curt.ticker_status};ctournament.bts_status_changed({val:{status:'connected'}});ctournament.ticker_status_changed({val:{status:'connected'}});window.dispatchEvent(new CustomEvent('announcement-speech-check-state-changed',{detail:{status:'active',detail:'Audio bereit'}}));window.__activeServices=['.status_badge','.ticker_status_badge','.speech_output_status_badge'].map(selector=>document.querySelector(selector).textContent);ctournament.bts_status_changed({val:{status:'error',message:'Verbindung getrennt'}});ctournament.ticker_status_changed({val:{status:'deactivated'}});window.dispatchEvent(new CustomEvent('announcement-speech-check-state-changed',{detail:{status:'error',detail:'Audio nicht verfügbar'}}))`);
  await check('BTS, Ticker und Sprachausgabe verwenden ausschließlich aktiv oder aus und behalten Fehlerdetails',`window.__activeServices.every(value=>value==='aktiv')&&['.status_badge','.ticker_status_badge','.speech_output_status_badge'].every(selector=>document.querySelector(selector).textContent==='aus')&&document.querySelector('.status_badge').title==='Verbindung getrennt'&&document.querySelector('.speech_output_status_badge').title==='Audio nicht verfügbar'`);
  await c.evaluate(`ctournament.bts_status_changed({val:window.__originalServices.bts});ctournament.ticker_status_changed({val:window.__originalServices.ticker});window.dispatchEvent(new CustomEvent('announcement-speech-check-state-changed',{detail:{status:'untested',detail:'Noch nicht getestet'}}))`);
  await delay(1100);
  await check('BTP-Synchronisieren steht vor dem laufenden Countdown',`(()=>{const button=document.querySelector('.toprow_btp_sync_button');return button?.querySelector('svg')&&!button.disabled&&button.nextElementSibling.matches('.btp_status_badge')&&button.previousElementSibling.matches('.btp_status_label')&&button.getAttribute('aria-label')==='BTP jetzt synchronisieren'})()`);
  await c.evaluate(`window.__service=document.querySelector('.board-service-status[data-service="btp"]');window.__readySymbol=getComputedStyle(window.__service,'::before').maskImage;window.__servicePositions=JSON.stringify([window.__service,document.querySelector('.btp_status_badge'),document.querySelector('.toprow_btp_sync_button')].map(node=>{const r=node.getBoundingClientRect();return[r.left,r.width]}))`);
  await check('Obere Statusanzeigen verwenden die Spielerformatierung mit Symbolen; Spielernamen bleiben ohne Zusatzsymbole',`(()=>{const groups=[...document.querySelectorAll('.board-service-status')],group=getComputedStyle(window.__service),player=getComputedStyle(document.querySelector('.unassigned_container .player.checked_in'));return groups.length===4&&groups.every(node=>getComputedStyle(node,'::before').maskImage!=='none')&&group.backgroundColor===player.backgroundColor&&group.color===player.color&&group.borderTopColor===player.borderTopColor&&group.borderRadius===player.borderRadius&&!document.querySelector('.player-status-icon')})()`);
  await click('.toprow_btp_sync_button');
  await check('BTP-Icon verwendet den bestehenden manuellen Abgleich für das aktuelle Turnier',`window.__writes.filter(message=>message.type==='btp_fetch'&&message.tournament_key==='preview').length===1`);
  const statusRect=await c.evaluate(`(()=>{const r=document.querySelector('.toprow_right').getBoundingClientRect();return{x:Math.floor(r.left)-12,y:0,width:Math.ceil(r.width)+24,height:44,scale:1}})()`);
  const statusShot=await c.call('Page.captureScreenshot',{format:'png',clip:statusRect});fs.writeFileSync(path.join(previews,'statusleiste.png'),Buffer.from(statusShot.data,'base64'));
  await c.evaluate(`ctournament.btp_status_changed({val:{status:'connected',fetch_in_progress:true}});document.querySelector('.toprow_btp_sync_button').click()`);
  await check('Laufender BTP-Abgleich sperrt erneutes Auslösen am Icon',`document.querySelector('.toprow_btp_sync_button').disabled&&window.__writes.filter(message=>message.type==='btp_fetch').length===1`);
  await check('Synchronisierung zeigt ein Uhrsymbol bei unveränderter Breite und rotierendem Sync-Icon',`(()=>{const position=JSON.stringify([window.__service,document.querySelector('.btp_status_badge'),document.querySelector('.toprow_btp_sync_button')].map(node=>{const r=node.getBoundingClientRect();return[r.left,r.width]}));return position===window.__servicePositions&&getComputedStyle(window.__service,'::before').maskImage!==window.__readySymbol&&document.querySelector('.toprow_btp_sync_button .ico').getAnimations().length===1})()`);
  await c.evaluate(`window.__waitingSymbol=getComputedStyle(window.__service,'::before').maskImage;ctournament.btp_status_changed({val:{status:'error',message:'Verbindung getrennt'}})`);
  await check('Fehlerstatus verwendet die rote Spielerformatierung und ein eigenes Fehlersymbol',`(()=>{const group=getComputedStyle(window.__service),player=getComputedStyle(document.querySelector('.unassigned_container .player.not_checked_in')),symbol=getComputedStyle(window.__service,'::before').maskImage;return group.backgroundColor===player.backgroundColor&&group.color===player.color&&group.borderTopColor===player.borderTopColor&&symbol!==window.__readySymbol&&symbol!==window.__waitingSymbol&&document.querySelector('.btp_status_badge').title==='Verbindung getrennt'})()`);
  const failureShot=await c.call('Page.captureScreenshot',{format:'png',clip:statusRect});fs.writeFileSync(path.join(previews,'statusleiste-fehler.png'),Buffer.from(failureShot.data,'base64'));
  await c.evaluate(`curt.btp_enabled=window.__oldBtp.enabled;curt.btp_autofetch_enabled=window.__oldBtp.autofetch;curt.btp_autofetch_timeout_intervall=window.__oldBtp.interval;ctournament.btp_status_changed({val:window.__oldBtp.status})`);
  await check('Zwei Tablet-Paarungen bleiben in der kompakten Warteliste vollständig sichtbar',`(()=>{const list=document.querySelector('.unassigned_tableoperators_content');return list.clientHeight>=list.scrollHeight})()`);
  await check('Warteliste richtet Auf/Ab-Pfeile und Entfernen in getrennten festen Spalten aus',`(()=>{const rows=[...document.querySelectorAll('.tabletoperators_table tbody>tr')],up=document.querySelector('.tabletoperator_move_up_button').getBoundingClientRect(),down=document.querySelector('.tabletoperator_move_down_button').getBoundingClientRect(),removals=rows.map(row=>row.querySelector('.tabletoperator_remove_button').getBoundingClientRect().left),input=document.querySelector('.tabletoperator_add_custom_input').getBoundingClientRect(),add=document.querySelector('.tabletoperator_add_custom_button').getBoundingClientRect();return up.right<=down.left&&Math.max(...removals)-Math.min(...removals)<.1&&input.right<add.left&&document.querySelector('[data-board-card="operators"] .operator-count').textContent==='2'&&rows.every(row=>getComputedStyle(row).backgroundColor==='rgba(0, 0, 0, 0)')})()`);
  await c.evaluate(`window.__queuedOperators=curt.tabletoperators;const extra=structuredClone(curt.tabletoperators[1]);extra._id='tablet-3';extra.start_ts=3;curt.tabletoperators=[...curt.tabletoperators,extra];ctabletoperator.render_unassigned(document.querySelector('.unassigned_tableoperators_container'))`);
  await check('Bei mehr als zwei Einträgen bleiben beide Richtungspfeile nebeneinander und alle Einträge erreichbar',`(()=>{const rows=[...document.querySelectorAll('.tabletoperators_table tbody>tr')],middle=rows[1],up=middle.querySelector('.tabletoperator_move_up_button').getBoundingClientRect(),down=middle.querySelector('.tabletoperator_move_down_button').getBoundingClientRect(),list=document.querySelector('.unassigned_tableoperators_content');list.scrollTop=list.scrollHeight;return rows.length===3&&up.right<=down.left&&Math.abs(up.top-down.top)<.1&&rows.every(row=>row.getBoundingClientRect().height<=26)&&rows[2].getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom+.5&&document.querySelector('[data-board-card="operators"] .operator-count').textContent==='3'})()`);
  await c.evaluate(`curt.tabletoperators=window.__queuedOperators;ctabletoperator.render_unassigned(document.querySelector('.unassigned_tableoperators_container'))`);
  await click('.tabletoperator_move_down_button');await click('.tabletoperator_move_up_button');await click('.tabletoperator_remove_button[data-tabletoperator_id="tablet-2"]');
  await c.evaluate(`(()=>{const input=document.querySelector('.tabletoperator_add_custom_input');input.value='Probe Name';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click('.tabletoperator_add_custom_button');
  await check('Kompakte Wartelisten-Aktionen behalten ihre echten Ziele und das Hinzufügen bei',`[['tabletoperator_move_down','tablet-1'],['tabletoperator_move_up','tablet-2'],['tabletoperator_remove','tablet-2']].every(([type,id])=>window.__writes.some(message=>message.type===type&&message.tabletoperator._id===id))&&window.__writes.some(message=>message.type==='tabletoperator_add'&&message.tabletoperator_name==='Probe Name')`);
  await c.evaluate(`document.querySelector('.tabletoperator_add_custom_input').value='';ctabletoperator.render_unassigned(document.querySelector('.unassigned_tableoperators_container'))`);
  await check('Live-Neuaufbau erhält die kompakte Warteliste und ihre Trennung von der Rotation',`document.querySelectorAll('.tabletoperators_table tbody>tr').length===2&&document.querySelectorAll('[data-board-card="operators"] .operator-count').length===1&&document.querySelector('[data-board-card="operators"] .operator-count').textContent==='2'&&document.querySelector('.tabletoperator_move_up_button').parentElement.cellIndex+1===document.querySelector('.tabletoperator_move_down_button').parentElement.cellIndex&&document.querySelector('[data-board-card="rotation"]>.umpire_container')===window.__rotationContainer&&!document.querySelector('[data-board-card="operators"] .umpire_container')`);
  await c.evaluate(`window.__originOperators=structuredClone(curt.tabletoperators);const original=curt.tabletoperators[0];crouting.on_change({ctype:'tabletoperator_removed',tournament_key:'preview',val:{tabletoperator:{...original,court:'CH_4',assigned_match_id:'match-46'}}});crouting.on_change({ctype:'tabletoperator_add',tournament_key:'preview',val:{tabletoperator:{...original,_id:'returned-tablet',match_id:'match-46',played_on_court:null,court:null}}})`);
  await check('Nach zurückgezogenem Nachfolgespiel zeigt die neue Wartelistenzeile weiterhin das ursprüngliche Feld',`(()=>{const row=document.querySelector('[data-tabletoperator_id="returned-tablet"]').closest('tr');return row.querySelector('.court_history')?.textContent==='13'&&curt.tabletoperators.find(entry=>entry._id==='returned-tablet').played_on_court===null&&document.querySelector('[data-board-card="operators"] .operator-count').textContent==='2'})()`);
  await c.evaluate(`const previous=curt.tabletoperators.find(entry=>entry._id==='returned-tablet');crouting.on_change({ctype:'tabletoperator_removed',tournament_key:'preview',val:{tabletoperator:{...previous,court:-1,assigned_match_id:'match-47'}}});crouting.on_change({ctype:'tabletoperator_add',tournament_key:'preview',val:{tabletoperator:{...previous,_id:'returned-again',match_id:'match-47',court:null,assigned_match_id:null}}});curt.tabletoperators=structuredClone(curt.tabletoperators);ctabletoperator.render_unassigned(document.querySelector('.unassigned_tableoperators_container'))`);
  await check('Auch nach erneutem Aufruf und Rückzug bleibt die Herkunft nach vollständigem Neuaufbau erhalten',`(()=>{const row=document.querySelector('[data-tabletoperator_id="returned-again"]').closest('tr');return row.querySelector('.court_history')?.textContent==='13'&&document.querySelectorAll('.tabletoperators_table tbody>tr').length===2})()`);
  await c.evaluate(`curt.tabletoperators=window.__originOperators;ctabletoperator.render_unassigned(document.querySelector('.unassigned_tableoperators_container'))`);
  await c.evaluate(`curt.courts.find(court=>court._id==='CH_4').is_active=false;cleitstand.refreshCounts()`);
  await check('Gesperrte Felder zählen nicht als frei',`document.querySelector('[data-field-counts]').textContent.includes('1 freie Felder')`);
  await c.evaluate(`curt.courts.find(court=>court._id==='CH_4').is_active=true;cleitstand.refreshCounts();window.__prepRow=document.querySelector('tr[data-match_id="match-45"]');window.__prepClass=window.__prepRow.className;window.__prepRow.classList.remove('highlight_6')`);
  await check('Vorbereitungstimer ohne Hallenfarbe bleibt schwarz mit weißen Ziffern',`(()=>{const style=getComputedStyle(window.__prepRow.querySelector('.timer'));return style.color==='rgb(255, 255, 255)'&&style.backgroundColor==='rgb(17, 17, 17)'})()`);
  await c.evaluate(`window.__prepRow.className=window.__prepClass`);
  await check('Timer verwenden beim ersten Laden Siebensegmentschrift, Uhrsymbol und die passende Hintergrundfarbe',`(()=>{const prepared=document.querySelector('tr[data-match_id="match-45"] .timer');const field=document.querySelector('tr[data-match_id="match-41"] .timer');const pause=document.querySelector('tr[data-match_id="match-48"] .player .timer');return [prepared,field,pause].every(node=>node?.querySelector('.ico')&&getComputedStyle(node.querySelector('.timer-value')).fontFamily.includes('BTS Segment'))&&getComputedStyle(field).backgroundColor==='rgb(17, 17, 17)'&&getComputedStyle(pause).backgroundColor==='rgb(175, 69, 62)'})()`);
  await c.evaluate(`(()=>{
    const now=Date.now(),setup={match_id:'timer-qa',is_match:true,is_doubles:false,counting:'3x21',scoring_format:calc.scoring_format_from_counting('3x21'),teams:[{players:['Alice Example']},{players:['Bob Example']}],warmup:'call-down',warmup_start:180,warmup_ready:120,called_timestamp:now-140000};
    const presses=[{type:'pick_side',timestamp:now-32000,team1_left:true},{type:'love-all',timestamp:now-31000}];for(let point=1;point<=11;point++)presses.push({type:'score',timestamp:now-31000+point*1000,side:'left'});
    const states=[cmatch._extract_match_timer_state({setup,presses:[]}),cmatch._extract_match_timer_state({setup,presses}),{settings:{negative_timers:false},timer:{start:now-300000,upwards:true}}];
    const originalClock=curt.test_clock;curt.test_clock={mode:'fixed',fixed_ts:now};const table=document.createElement('table');table.className='match_table';document.querySelector('.leitstand').append(table);const body=table.createTBody();
    const nodes=states.map((state,index)=>{const row=body.insertRow();if(index===2)row.className='ls-preparation highlight_6';const cell=row.insertCell();cell.className='match_timer';cmatch.create_timer(state,cell,'#cccccc','#ff0000');return cell.querySelector('.timer');});window.__timerQa={now,originalClock,table,nodes,states};
  })()`);
  await check('Einspielzeit und Pause verwenden bei gleicher Restzeit ihre unterschiedlichen Feld-Warnschwellen',`(()=>{const [warmup,pause,preparation]=window.__timerQa.nodes;return warmup.classList.contains('timer_exigent')&&getComputedStyle(warmup).color==='rgb(255, 0, 0)'&&!pause.classList.contains('timer_exigent')&&getComputedStyle(pause).color==='rgb(255, 255, 255)'&&!preparation.classList.contains('timer_exigent')&&getComputedStyle(preparation).color==='rgb(197, 107, 255)'})()`);
  await c.evaluate(`curt.test_clock.fixed_ts=window.__timerQa.now+20000`);await delay(1100);
  await check('Pausentimer wechselt beim Feld-Warnzeitpunkt live auf rote Ziffern und Uhrsymbol',`window.__timerQa.nodes.slice(0,2).every(node=>node.classList.contains('timer_exigent')&&getComputedStyle(node).color==='rgb(255, 0, 0)'&&getComputedStyle(node.querySelector('.ico')).color==='rgb(255, 0, 0)'&&node.querySelector('.timer-value').textContent==='0:20')`);
  await c.evaluate(`window.__timerQa.clockIcons=window.__timerQa.nodes.map(node=>node.querySelector('.ico'));curt.test_clock.fixed_ts=window.__timerQa.now+40000`);await delay(1100);
  await check('Timer bleibt genau bei 0:00 rot und pulsiert erst nach Ablauf',`window.__timerQa.nodes.slice(0,2).every((node,index)=>node.classList.contains('timer_exigent')&&!node.classList.contains('timer_overdue')&&getComputedStyle(node).color==='rgb(255, 0, 0)'&&node.querySelector('.timer-value').textContent==='0:00'&&node.querySelector('.ico')===window.__timerQa.clockIcons[index]&&node.querySelector('.ico').getAnimations().length===0)`);
  await c.evaluate(`curt.test_clock.fixed_ts=window.__timerQa.now+52000`);await delay(1100);
  await check('Überzogene Timer bleiben wie am Feld rot und zeigen die negative Restzeit',`window.__timerQa.nodes.slice(0,2).every(node=>node.classList.contains('timer_exigent')&&getComputedStyle(node).color==='rgb(255, 0, 0)'&&node.querySelector('.timer-value').textContent==='-0:12')`);
  await check('Nur das überzogene Uhrsymbol pulsiert durch seine Deckkraft ohne Strichstärken-, Positions- oder Größenwechsel',`window.__timerQa.nodes.slice(0,2).every((node,index)=>{const icon=node.querySelector('.ico'),animation=icon.getAnimations()[0];if(icon!==window.__timerQa.clockIcons[index]||!animation||!node.classList.contains('timer_overdue'))return false;animation.pause();animation.currentTime=0;const bright=parseFloat(getComputedStyle(icon).opacity),stroke=getComputedStyle(icon).strokeWidth,before=icon.getBoundingClientRect();animation.currentTime=600;const dim=parseFloat(getComputedStyle(icon).opacity),sameStroke=stroke===getComputedStyle(icon).strokeWidth,after=icon.getBoundingClientRect();animation.play();return bright>dim*1.5&&sameStroke&&before.width===after.width&&before.height===after.height&&before.left===after.left&&node.querySelector('.timer-value').getAnimations().length===0})`);
  await c.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await check('Reduzierte Bewegung zeigt das überzogene Uhrsymbol dauerhaft kräftiger statt pulsierend',`window.__timerQa.nodes.slice(0,2).every(node=>{const icon=node.querySelector('.ico');return icon.getAnimations().length===0&&parseFloat(getComputedStyle(icon).strokeWidth)===3.2})`);
  await c.call('Emulation.setEmulatedMedia',{features:[]});
  await c.evaluate(`curt.test_clock.fixed_ts=window.__timerQa.now-30000`);await delay(1100);
  await check('Zurückgesetzte Timer verlassen den Warnzustand und behalten die Siebensegmentdarstellung',`window.__timerQa.nodes.slice(0,2).every(node=>!node.classList.contains('timer_exigent')&&!node.classList.contains('timer_overdue')&&node.querySelector('.ico').getAnimations().length===0&&getComputedStyle(node).color==='rgb(255, 255, 255)'&&getComputedStyle(node.querySelector('.timer-value')).fontFamily.includes('BTS Segment'))`);
  await c.evaluate(`curt.test_clock=window.__timerQa.originalClock;window.__timerQa.table.remove();delete window.__timerQa`);
  await c.evaluate(`(async()=>{
    const original=structuredClone(curt.matches.find(match=>match._id==='match-41')),positions=[];
    for(const points of [[],[[0,0]]]){
      const changed=structuredClone(original);changed.network_score=points;
      crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:changed._id,match:changed}});
      // Use a probe without the native clock's independent tick overwriting
      // manual fitting values now that score updates preserve live timers.
      const live=document.querySelector('tr[data-match_id="match-41"] .match_timer .timer');live.replaceWith(live.cloneNode(true));
      for(const time of ['7:37','-7:37','12:23','-12:23','123:45','-123:45','1234:56','-1234:56','1:23:45','-1:23:45','-10:10','-20:20','9:59','10:00','-10:00','20:20','9:59','-20:06:25','-20:27:53','-2000:00','7:37']){
        const row=document.querySelector('tr[data-match_id="match-41"]'),node=row.querySelector('.match_timer .timer');cleitstand.timerDisplay(node,time);
        await new Promise(resolve=>requestAnimationFrame(resolve));
        const box=node.getBoundingClientRect(),icon=node.querySelector('.ico').getBoundingClientRect(),digits=node.querySelector('.timer-digits').getBoundingClientRect();
        positions.push({time,score:row.querySelector('.match_score').textContent,left:box.left,top:box.top,width:box.width,height:box.height,iconLeft:icon.left,digitsLeft:digits.left,text:node.querySelector('.timer-value').textContent,font:parseFloat(getComputedStyle(node.querySelector('.timer-digits')).fontSize),inset:node.querySelector('.timer-value').style.getPropertyValue('--timer-leading-inset'),unsignedWide:node.querySelector('.timer-value').classList.contains('timer-positive-long'),compactSign:!!node.querySelector('.timer-value').style.getPropertyValue('--timer-sign-width'),signWidth:node.querySelector('.timer-sign').getBoundingClientRect().width,inkGap:time.startsWith('-')?(${timerInkGap})(node):null,fits:(${timerFits})(node)});
      }
    }
    crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:original._id,match:original}});window.__timerPositions=positions;
  })()`);
  await check('Uhr bleibt ohne Spielstand und bei 0:0 an derselben Position ohne zusätzliche Zeilenhöhe',`(()=>{const positions=window.__timerPositions,half=positions.length/2;return positions.slice(0,half).every((p,index)=>{const zero=positions[index+half];return p.score===''&&zero.score==='0:0'&&Math.abs(p.left-zero.left)<.1&&Math.abs(p.top-zero.top)<.1&&Math.abs(p.height-zero.height)<.1})})()`);
  await check('Zusätzliche Stellen und führende Einsen behalten die Timerbreite und die Position des Uhrsymbols',`(()=>{const positions=window.__timerPositions,normal=positions.filter(p=>!p.inset&&!p.unsignedWide&&!p.compactSign);return ['left','iconLeft','width','height'].every(key=>Math.max(...positions.map(p=>p[key]))-Math.min(...positions.map(p=>p[key]))<.1)&&Math.max(...normal.map(p=>p.digitsLeft))-Math.min(...normal.map(p=>p.digitsLeft))<.1&&positions.every(p=>p.text===p.time)})()`);
  await check('Eine führende Eins nutzt ihren Leerraum für größere Ziffern mit sichtbarem Abstand zum Minus',`(()=>{const positions=window.__timerPositions,one=positions.find(p=>p.time==='-10:10'),two=positions.find(p=>p.time==='-20:20');return !!one.inset&&!two.inset&&one.font>two.font+1&&one.width===two.width&&one.digitsLeft<two.digitsLeft&&positions.filter(p=>p.time.startsWith('-1')).every(p=>p.inkGap>1)})()`);
  await check('Bei langen negativen Zeiten schrumpft der Minusbereich mit der Schrift und gibt Platz für die Ziffern frei',`(()=>{const positions=window.__timerPositions,short=positions.find(p=>p.time==='-7:37'),long=positions.find(p=>p.time==='-20:20'),hours=positions.find(p=>p.time==='-20:06:25'),half=positions.length/2,restored=positions[half-1];return !short.compactSign&&long.compactSign&&hours.compactSign&&long.signWidth<short.signWidth&&hours.signWidth<long.signWidth&&Math.abs(long.signWidth/long.font-hours.signWidth/hours.font)<.01&&positions.filter(p=>p.compactSign).every(p=>p.inkGap>.5)&&!restored.compactSign&&restored.signWidth===short.signWidth})()`);
  await check('Positive Zeiten ab 10:00 nutzen den Minusplatz und geben ihn bei negativen oder kurzen Werten wieder frei',`(()=>{const positions=window.__timerPositions,short=positions.filter(p=>p.time==='9:59'),positive=positions.find(p=>p.time==='10:00'),negative=positions.find(p=>p.time==='-10:00'),long=positions.find(p=>p.time==='20:20'),signed=positions.find(p=>p.time==='-20:20'),hours=positions.find(p=>p.time==='1:23:45');return short.every(p=>!p.unsignedWide&&p.signWidth>0)&&positive.unsignedWide&&positive.signWidth===0&&!negative.unsignedWide&&negative.signWidth>0&&long.unsignedWide&&long.signWidth===0&&long.font>signed.font+1&&positive.font>negative.font&&hours.unsignedWide&&hours.signWidth===0})()`);
  await check('Lange Minuten- und Stundenwerte passen durch kleinere Schrift vollständig in das reservierte Format -n:nn',`(()=>{const positions=window.__timerPositions,half=positions.length/2;return positions.every(p=>p.fits)&&positions[3].font<positions[0].font&&positions[2].font>positions[3].font&&positions[4].font<positions[2].font&&positions[6].font<positions[4].font&&positions[8].font<positions[0].font&&positions[half].font===positions[0].font})()`);
  await check('Zuweisen und Ergebnisbestätigung behalten ihre Knopfbreite und vier Pixel Abstand zum Tabellenrand',`document.querySelector('.ls-empty .call_td .btn').offsetWidth===104&&document.querySelector('.match_confirm_button').offsetWidth===104&&['.ls-empty .call_td .btn','.match_confirm_button'].every(selector=>{const button=document.querySelector(selector),cell=button.closest('td');return Math.abs(cell.getBoundingClientRect().right-button.getBoundingClientRect().right-4)<.1})`);
  console.log('Dichte '+JSON.stringify(await c.evaluate(`({cards:[...document.querySelectorAll('.control-card')].map(card=>card.offsetHeight),rows:[...document.querySelectorAll('.courts_container tbody tr')].map(row=>row.offsetHeight),prepared:[45,46].map(number=>document.querySelector('tr[data-match_id="match-'+number+'"]').getBoundingClientRect().bottom),innerHeight,body:document.documentElement.scrollWidth,table:document.querySelector('.courts_container').scrollWidth,width:document.querySelector('.courts_container').clientWidth})`)));
  await check('Full HD behält die ersten beiden Vorbereitungsspiele sichtbar',`[45,46].every(number=>document.querySelector('tr[data-match_id="match-'+number+'"]').getBoundingClientRect().bottom<=innerHeight)`);
  await check('Einheitliche Spielstände und zehn Spalten je Spielzeile',`[...document.querySelectorAll('.courts_container tbody tr[data-match_id]')].every(row=>row.cells.length===10)&&new Set([...document.querySelectorAll('.courts_container .ls-scoreline')].map(node=>getComputedStyle(node).fontSize)).size===1`);
  await check('Plan, Disziplin und Runde haben eigene Spalten mit den richtigen Werten',`[...document.querySelectorAll('.leitstand .match_table[data-leitstand-head]')].every(table=>JSON.stringify([...table.tHead.rows[0].cells].slice(3,table.classList.contains('ls-finished-table')?8:6).map(cell=>cell.textContent))===JSON.stringify(table.classList.contains('ls-finished-table')?['Plan','Beginn','Ende','Disziplin','Runde']:['Plan','Disziplin','Runde']))&&[...document.querySelectorAll('.leitstand tr.ls-match')].every(row=>{const setup=curt.matches.find(match=>match._id===row.dataset.match_id).setup;return row.cells.length===(row.closest('.finished_container')?11:10)&&row.querySelector('.match_properties').firstChild?.textContent===setup.scheduled_time_str&&row.querySelector('.match_discipline').textContent===setup.event_name&&row.querySelector('.match_round').textContent===setup.match_name})`);
  await check('Ortsauswahl und Audio verwenden die bestehenden unabhängigen Schalter',`document.querySelectorAll('.device-location-table tbody tr').length===2&&document.querySelectorAll('.device-location-table input').length===4&&!!document.getElementById('show_location_courts_CH')&&!!document.getElementById('enable_announcement_calls_CH')`);
  await c.evaluate(`window.__scoreRow=document.querySelector('tr[data-match_id="match-44"]');window.__scoreNode=window.__scoreRow.querySelector('.match_score');window.__otherRow=document.querySelector('tr[data-match_id="match-43"]');crouting.on_change({ctype:'score',tournament_key:'preview',val:{match_id:'match-44',network_score:[[9,9]],presses:[],shuttle_count:4,now_on_court:true,court_id:'CH_1'}})`);
  await check('Live-Punkt aktualisiert Ergebnis ohne Zeilen oder Nachbarspiel zu ersetzen',`document.querySelector('tr[data-match_id="match-44"]')===window.__scoreRow&&document.querySelector('tr[data-match_id="match-43"]')===window.__otherRow&&window.__scoreRow.querySelector('.match_score')===window.__scoreNode&&window.__scoreNode.textContent==='9:9'&&window.__scoreNode.querySelector('.score-colon').textContent===':'&&cmatch.count_match_score_targets(curt.matches.find(match=>match._id==='match-44'))===1&&cmatch.count_match_timer_targets('match-44')===1`);
  await c.evaluate(`crouting.on_change({ctype:'score',tournament_key:'preview',val:{match_id:'match-44',network_score:[[21,15],[21,18]],presses:[],now_on_court:true,court_id:'CH_1'}})`);
  await check('Letzter Punkt markiert sofort den grünen Nachfolgerbedarf ohne neue Serverdiagnose',`window.__scoreRow.classList.contains('preparation_demand_court')&&getComputedStyle(window.__scoreRow).getPropertyValue('--status-edge').trim()==='#2f6638'&&getComputedStyle(window.__scoreRow.querySelector('.call_td')).backgroundImage.includes('linear-gradient')&&!!window.__scoreRow.querySelector('.match_confirm_button')`);
  await c.evaluate(`crouting.on_change({ctype:'score',tournament_key:'preview',val:{match_id:'match-44',network_score:[[9,9]],presses:[],now_on_court:true,court_id:'CH_1'}})`);
  await check('Korrigierter letzter Punkt entfernt den beendeten Zustand und dessen grüne Markierung',`!window.__scoreRow.classList.contains('preparation_demand_court')&&!window.__scoreRow.querySelector('.match_confirm_button')&&window.__scoreRow===document.querySelector('tr[data-match_id="match-44"]')`);
  await c.evaluate(`const updated=structuredClone(curt.matches.find(match=>match._id==='match-44'));Object.assign(updated.setup,{scheduled_time_str:'9:05',event_name:'MX U17',match_name:'HF'});crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:updated._id,match:updated}})`);
  await check('Live-Änderungen aktualisieren die drei Metadatenspalten ohne zusätzliche Zellen',`(()=>{const row=document.querySelector('tr[data-match_id="match-44"]');return row===window.__scoreRow&&row.cells.length===10&&row.querySelector('.match_properties').firstChild?.textContent==='9:05'&&row.querySelector('.match_discipline').textContent==='MX U17'&&row.querySelector('.match_round').textContent==='HF'})()`);
  await check('Zentrierte Uhrzeiten bleiben vollständig sichtbar und richten ihre Doppelpunkte in beiden Dichten aus',`(()=>{const board=document.querySelector('.leitstand'),comfort=board.classList.contains('comfort');try{return [false,true].every(mode=>{board.classList.toggle('comfort',mode);const positions=[...document.querySelectorAll('.courts_container .ls-time-colon')].map(node=>node.getBoundingClientRect().left);return document.querySelector('tr[data-match_id="match-44"] .ls-time-hours').textContent==='9'&&positions.length>1&&Math.max(...positions)-Math.min(...positions)<.1&&[...document.querySelectorAll('.courts_container .ls-scheduled-time')].every(clock=>{const box=clock.getBoundingClientRect(),cell=clock.parentElement.getBoundingClientRect(),style=getComputedStyle(clock.parentElement);return box.left>=cell.left+parseFloat(style.paddingLeft)-.1&&box.right<=cell.right-parseFloat(style.paddingRight)+.1})})}finally{board.classList.toggle('comfort',comfort)}})()`);
  await click('tr[data-match_id="match-37"] .match_confirm_button');
  await check('Ergebnisbestätigung sendet Spiel und richtiges Feld',`window.__writes.some(message=>message.type==='confirm_match_finished'&&message.match_id==='match-37'&&message.court_id==='CH_2')`);
  await c.evaluate(`const changed=structuredClone(curt.matches.find(match=>match._id==='match-37'));changed.team1_won=true;changed.btp_winner=1;changed.setup.state='finished';changed.setup.now_on_court=false;crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:changed._id,match:changed}})`);
  await check('Bestätigtes Spiel zieht in Ergebnisse um und gibt genau sein Feld frei',`document.querySelector('.finished_container tr[data-match_id="match-37"]').cells.length===11&&document.querySelector('.finished_container tr[data-match_id="match-37"] .match_discipline').textContent==='MX U19'&&document.querySelector('tr[data-court_id="CH_2"]').classList.contains('ls-empty')&&document.querySelector('tr[data-court_id="CH_2"]').cells.length===4&&[...document.querySelector('tr[data-court_id="CH_2"]').cells].reduce((sum,cell)=>sum+cell.colSpan,0)===10&&!document.querySelector('tr[data-court_id="CH_2"]').dataset.match_id&&document.querySelector('tr[data-court_id="CH_1"]').dataset.match_id==='match-44'`);
  await check('Feld bleibt nach der Ergebnisbestätigung rechts grün bis zum nächsten Aufruf',`(()=>{const row=document.querySelector('tr[data-court_id="CH_2"]');return row.classList.contains('preparation_demand_court')&&getComputedStyle(row.querySelector('.call_td')).backgroundImage.includes('linear-gradient')&&!document.querySelector('.finished_container tr[data-match_id="match-37"]').classList.contains('preparation_demand_court')})()`);
  await c.evaluate(`const successor=structuredClone(curt.matches.find(match=>match._id==='match-52'));Object.assign(successor.setup,{state:'oncourt',now_on_court:true,court_id:'CH_2',location_id:'CH',called_timestamp:Date.now(),highlight:0});successor.network_score=[[0,0]];crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:successor._id,match:successor}})`);
  await check('Neuer Feldaufruf entfernt die grüne Markierung des Vorgängers am selben Feld',`(()=>{const row=document.querySelector('tr[data-court_id="CH_2"]');return row.dataset.match_id==='match-52'&&!row.classList.contains('ls-empty')&&!row.classList.contains('preparation_demand_court')&&getComputedStyle(row.querySelector('.call_td')).backgroundImage==='none'})()`);
  await click('tr[data-match_id="match-46"] .operator-pair .name');
  await check('Tablet-Paarung sendet einen gemeinsamen Check-in',`window.__writes.some(message=>message.type==='match_participant_check_in'&&message.match_id==='match-46'&&message.participant_ids.length===2&&message.checked_in===true)`);
  await click('tr[data-match_id="match-45"] .player.not_checked_in');
  await check('Einzelner Spieler-Check-in bleibt getrennt erreichbar',`window.__writes.some(message=>message.type==='match_player_check_in'&&message.match_id==='match-45'&&message.checked_in===true)`);
  await click('.automation_center_toggle');
  await check('Automatik nutzt die vorhandene serverseitige Steuerung',`window.__writes.some(message=>JSON.stringify(message).includes('automation_enabled'))`);
  await click('.ls-location-row[data-court-group="CH"] button');
  await check('Hallenfilter blendet nur die gewählten Orte aus; Audioschalter bleiben unabhängig',`[...document.querySelectorAll('.courts_container .court_row')].every(row=>row.classList.contains('do_not_show'))&&document.querySelector('.ls-location-row[data-court-group="CH"] button').getAttribute('aria-expanded')==='false'&&document.querySelector('.ls-location-row').getBoundingClientRect().height>0&&document.getElementById('enable_announcement_calls_CH').checked===false`);
  await click('.ls-location-row[data-court-group="CH"] button');
  await c.evaluate(`document.querySelector('[data-board-search]').value='Mia';document.querySelector('[data-board-search]').dispatchEvent(new Event('input',{bubbles:true}))`);
  await check('Suche filtert die Spielzeilen',`document.querySelector('.courts_container tbody tr[hidden]')&&document.querySelector('.courts_container tbody tr:not([hidden])')`);
  await c.evaluate(`document.querySelector('[data-board-search]').value='';document.querySelector('[data-board-search]').dispatchEvent(new Event('input',{bubbles:true}))`);
  await click('tr[data-match_id="match-45"] .ls-match-open');
  await check('Drei-Punkte-Knopf öffnet den bestehenden Editor mit vier Reitern',`document.querySelector('.match_edit_dialog .ls-dialog-tabs').children.length===4&&!!document.querySelector('.match_edit_dialog input[name="match_num"]')`);
  await c.evaluate(`document.querySelector('.match_edit_dialog input[name="match_num"]').value='145'`);
  await click('#ls-match-tab-3');
  await check('Rohdaten stehen im gleichen Dialog bereit',`document.querySelector('.ls-raw-panel pre').textContent.includes('match-45')&&!document.querySelector('.ls-raw-panel').hidden`);
  await click('#ls-match-tab-1');
  await check('Reiterwechsel erhält die Formulareingaben',`document.querySelector('.match_edit_dialog input[name="match_num"]').value==='145'`);
  await click('#ls-match-tab-2');
  await until(()=>c.evaluate(`!!document.querySelector('.ls-sheet-panel svg')`),15000);
  await check('Bestehender Schiedsrichterzettel rendert im selben Dialog',`!!document.querySelector('.ls-sheet-panel .single_scoresheet')&&document.querySelectorAll('.match_edit_dialog .dialog-actions .match_scoresheet_buttons button').length===2`);
  await check('Der Spiel-Dialog zeigt einen Schließenknopf auch außerhalb des Bearbeiten-Reiters',`!!document.querySelector('.ls-dialog-close')&&document.querySelector('.ls-dialog-close').getClientRects().length>0&&![...document.querySelector('.match_edit_dialog').childNodes].some(node=>node.nodeType===3&&node.textContent.includes('[object Object]'))`);
  await snap('spiel-dialog');
  await click('.ls-dialog-close');
  await check('Dialogschließen gibt den Fokus an das richtige Spiel zurück',`!document.querySelector('.match_edit_dialog')&&document.activeElement.matches('tr[data-match_id="match-45"] .ls-match-open')`);
  await click('tr[data-match_id="match-51"] .ls-match-open');
  await check('Unvollständige Teams sperren nur den Schiedsrichterzettel',`document.querySelector('#ls-match-tab-2').disabled&&!document.querySelector('#ls-match-tab-3').disabled`);
  await click('.ls-dialog-close');
  await c.evaluate(`document.querySelector('#custom_announcement').value='Erhaltene Durchsage'`);
  await click('.board-toolbar-actions [data-action="layout-edit"]');
  await nativeDrag('[data-board-card="operators"] h2','[data-board-card="device"]');
  assert.deepEqual((await arrangement()).top,['device','announcement','operators','automation','rotation','tablets','logs']);
  await nativeDrag('[data-board-card="automation"] h2','[data-card-zone="sidebar"]');
  assert.deepEqual((await arrangement()).sidebar,['automation']);
  await nativeDrag('[data-board-card="device"] h2','[data-board-card="automation"]');
  assert.deepEqual(await arrangement(),{top:['automation','announcement','operators','rotation','tablets','logs'],sidebar:['device']});
  await check('Kacheln lassen sich exakt tauschen und zwischen oberer Reihe und Sidebar verschieben',`document.querySelector('[data-card-zone="sidebar"] [data-board-card="device"]')&&document.querySelector('#custom_announcement').value==='Erhaltene Durchsage'&&!document.querySelector('#drag-field-dock')`);
  await nativeDrag('[data-board-card="rotation"] h2','[data-board-card="device"]',{side:'bottom'});
  assert.deepEqual(await arrangement(),{top:['automation','announcement','operators','tablets','logs'],sidebar:['device','rotation']});
  await check('Rotation lässt sich mit erhaltener Offiziellenliste eigenständig in die Sidebar ziehen',`document.querySelector('[data-card-zone="sidebar"] [data-board-card="rotation"] .umpire_container')===window.__rotationContainer&&document.querySelectorAll('[data-board-card="rotation"] .official_card_skin').length===4`);
  await check('Auch in der Sidebar bleiben die beiden nächsten Rollen nebeneinander',rotationColumnsFit);
  await c.evaluate(`(async()=>{
    // Keep the live fixture timer running independently of the measurement values.
    const source=document.querySelector('[data-board-card="rotation"] .official_card_timer .timer').closest('.official_card_frame'),card=source.cloneNode(true);card.removeAttribute('data-official-id');source.after(card);
    const node=card.querySelector('.timer'),time=node.querySelector('.timer-value'),digits=node.querySelector('.timer-digits'),icon=node.querySelector('.ico');
    const settled=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    cleitstand.timerDisplay(node,'-0:00');await settled();
    const snapshot=()=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,cardHeight:card.getBoundingClientRect().height,font:parseFloat(getComputedStyle(digits).fontSize),fits:(${timerFits})(node),text:time.textContent,sameIcon:node.querySelector('.ico')===icon});
    const baseline=snapshot();cleitstand.timerDisplay(node,'-123:45');await settled();const long=snapshot();
    cleitstand.timerDisplay(node,'-0:00');node.style.maxWidth='58px';await settled();const narrow=snapshot();
    node.style.removeProperty('max-width');await settled();const restored=snapshot();
    time.style.fontFamily='monospace';cleitstand.timerDisplay(node,'-10:10');await settled();const fallback=snapshot();card.remove();
    window.__timerFit={baseline,long,narrow,restored,fallback};
  })()`);
  await check('Lange Rotationszeiten passen vollständig in dieselbe Timerfläche und erhöhen keine Kartenzeile',`(()=>{const {baseline,long}=window.__timerFit;return baseline.fits&&long.fits&&long.text==='-123:45'&&long.font<baseline.font&&Math.abs(long.width-baseline.width)<.1&&long.height===baseline.height&&long.cardHeight===baseline.cardHeight&&long.sameIcon})()`);
  await check('Schmaler Platz reduziert die Schrift automatisch und stellt sie bei mehr Platz wieder her',`(()=>{const {baseline,narrow,restored}=window.__timerFit;return narrow.fits&&restored.fits&&narrow.font<restored.font&&Math.abs(restored.font-baseline.font)<.1&&narrow.height===baseline.height&&narrow.cardHeight===baseline.cardHeight&&narrow.sameIcon&&restored.sameIcon})()`);
  await check('Auch eine Ersatzschrift wird nach ihrer tatsächlichen Breite ohne abgeschnittene Zeichen eingepasst',`window.__timerFit.fallback.fits&&window.__timerFit.fallback.text==='-10:10'&&window.__timerFit.fallback.sameIcon`);
  await click('[data-layout-editor] [data-action="layout-edit"]');
  await check('Fertiges Layout wird im produktiven Browserschlüssel gespeichert',`JSON.parse(localStorage.getItem('bts-admin-card-layout-v1')).sidebar[0]==='device'`);
  await c.evaluate(`window.__rotationSidebarWrites=window.__writes.length`);
  await nativeDrag('[data-official-id="official-4"] .official_card_name','[data-rotation-section="unavailable"] .official_card_drop_terminal',{
   settle:160,cancel:true,
   verify:async point=>{
    await check('Wachsende Dropzonen bleiben auch in der Sidebar unter dem Mauszeiger erreichbar',`(()=>{const card=document.querySelector('[data-card-zone="sidebar"] [data-board-card="rotation"]'),target=card.querySelector('[data-rotation-section="unavailable"] .official_card_drop_terminal');return target.classList.contains('official_card_drop_hover_expand')&&target.getBoundingClientRect().height===32&&target.contains(document.elementFromPoint(${point.x},${point.y}))})()`);
    const clip=await c.evaluate(`(()=>{const r=document.querySelector('[data-card-zone="sidebar"] [data-board-card="rotation"]').getBoundingClientRect();return{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}})()`);
    const shot=await c.call('Page.captureScreenshot',{format:'png',clip});fs.writeFileSync(path.join(previews,'rotation-dropzonen.png'),Buffer.from(shot.data,'base64'));
   },
  });
  await delay(160);
  await check('Abbruch in der Sidebar erhält Offizielle und Anordnung ohne Schreibaktion',`window.__writes.length===window.__rotationSidebarWrites&&!document.querySelector('.official_rotation_compact.officials_drag_active,.official_rotation_compact .official_card_drop_hover_expand')&&document.querySelectorAll('[data-card-zone="sidebar"] [data-board-card="rotation"] .official_card_skin').length===4`);
  await snap('sidebar');
  await metrics(1920,400);
  await c.evaluate(`document.querySelector('tr[data-match_id="match-45"]').scrollIntoView({block:'center'})`);
  await nativeDrag('tr[data-match_id="match-45"] .match_num','#drag-field-dock [data-court_id="CH_13"]',{
   verify:()=>check('Spielziehen ergänzt weiter erreichbare freie Felder, wenn Feldzeilen außerhalb des Bildes liegen',`${dockShown}&&!!document.querySelector('#drag-field-dock [data-court_id="CH_13"]')`)
  });
  await check('Ablegen sendet die echte Feldzuweisung für das gewählte Spiel',`window.__writes.some(message=>message.type==='match_call_on_court'&&message.match_id==='match-45'&&message.court_id==='CH_13')`);
  await open(1600,1050);
  await check('Seitenneuladen stellt die persönliche Kachelanordnung einschließlich Rotation wieder her',`document.querySelector('[data-card-zone="sidebar"] [data-board-card="device"]')&&document.querySelector('[data-card-zone="sidebar"] [data-board-card="rotation"] .umpire_container')&&!document.querySelector('.board-sidebar').hidden`);
  await metrics(1536,750);
  await check('Ansicht bei 125 Prozent Full-HD-Zoom bleibt ohne horizontalen Seitenüberlauf',`document.documentElement.scrollWidth<=innerWidth`);
  await check('Feldgrafiken erhalten die Zeilenhöhen auch bei 125 Prozent Full-HD-Zoom',fieldIconsKeepRowHeight);
  await metrics(390,844);await c.evaluate(`window.scrollTo(0,0)`);
  await check('Mobile Ansicht bleibt ohne horizontalen Seitenüberlauf',`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.board-sidebar').getBoundingClientRect().bottom<=document.querySelector('.board-games').getBoundingClientRect().top`);
  await check('Mobiles Fenster erhält die getrennten Rollenspalten in der Rotationskachel',rotationColumnsFit);
  await c.evaluate(`window.__rotationMobileWrites=window.__writes.length`);
  await nativeDrag('[data-official-id="official-4"] .official_card_name','[data-rotation-section="unavailable"] .official_card_drop_terminal',{
   settle:160,cancel:true,
   verify:point=>check('In der schmalen Ansicht wachsen Dropzonen ohne Seitenüberlauf und bleiben erreichbar',`(()=>{const target=document.querySelector('[data-rotation-section="unavailable"] .official_card_drop_terminal');return document.documentElement.scrollWidth<=innerWidth&&target.classList.contains('official_card_drop_hover_expand')&&target.getBoundingClientRect().height===32&&target.contains(document.elementFromPoint(${point.x},${point.y}))})()`),
  });
  await delay(160);
  await check('Abbruch im schmalen Fenster stellt die kompakte Rotation ohne Schreibaktion wieder her',`window.__writes.length===window.__rotationMobileWrites&&!document.querySelector('.official_rotation_compact.officials_drag_active,.official_rotation_compact .official_card_drop_hover_expand')&&document.querySelectorAll('[data-board-card="rotation"] .official_card_skin').length===4`);
  await check('Feldgrafiken erhalten die Zeilenhöhen und die gemeinsame Vorbereitung passt auch im mobilen Fenster',`${fieldIconsKeepRowHeight}&&${preparationContentFits}`);
  await snap('mobil');
  await metrics(1920,940);
  await c.evaluate(`(()=>{
    window.__finishForSort=(id,date,plan,start,end)=>{
      const match=structuredClone(curt.matches.find(match=>match._id===id));
      Object.assign(match,{team1_won:true,btp_winner:1,end_ts:end?Date.parse(end):null,duration_ms:start&&end?Date.parse(end)-Date.parse(start):null,presses:[]});
      Object.assign(match.setup,{state:'finished',now_on_court:false,scheduled_date:date,scheduled_time_str:plan});
      crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:id,match}});
    };
    __finishForSort('match-37','2026-10-29','11:00','2026-10-29T10:00:00Z','2026-10-29T11:00:00Z');
    __finishForSort('match-40','2026-10-29','10:00','2026-10-29T10:30:00Z','2026-10-29T11:20:00Z');
    __finishForSort('match-32','2026-10-30','08:00','2026-10-29T23:10:00Z','2026-10-29T23:40:00Z');
    __finishForSort('match-30','','',null,null);
    window.__finishedOrder=()=>[...document.querySelectorAll('.finished_container tbody>tr[data-match_id]')].map(row=>row.dataset.match_id).join(',');
    window.__finishedRows=[...document.querySelectorAll('.finished_container tbody>tr[data-match_id]')];
    window.__finishedPlayers=__finishedRows.map(row=>row.querySelector('.player'));
    window.__sortWrites=__writes.length;
    window.__sortOtherRows=[...document.querySelectorAll('.courts_container tr[data-court_id],.unassigned_container tr[data-match_id]')];
  })()`);
  await check('Beendete Spiele zeigen vier Sortierknöpfe für Spielnummer und Zeiten mit neuestem Ende zuerst',`JSON.stringify([...document.querySelector('.ls-finished-table thead tr').cells].slice(2,6).map(cell=>cell.textContent))==='["#","Plan","Beginn","Ende"]'&&document.querySelectorAll('.ls-finished-table .ls-time-sort').length===4&&document.querySelector('.ls-finished-table [aria-sort="descending"] .ls-time-sort').dataset.sortKey==='end'&&__finishedOrder()==='match-32,match-40,match-37,match-30'`);
  await check('Ohne gezählte Bälle in beendeten Spielen fehlt die ganze Ballspalte trotz Ballzahlen auf dem Feld',`curt.matches.find(match=>match._id==='match-36').shuttle_count===3&&!document.querySelector('.ls-finished-table .ls-shuttle-column,.ls-finished-table .match_shuttle_count,.ls-finished-table th.ls-shuttle-count')&&document.querySelector('.ls-finished-table colgroup').children.length===11&&[...document.querySelectorAll('.ls-finished-table tbody>tr[data-match_id]')].every(row=>row.cells.length===11)`);
  await c.evaluate(`curt.matches.find(match=>match._id==='match-37').shuttle_count=2;cmatch.update_match_score(curt.matches.find(match=>match._id==='match-37'))`);
  await check('Die erste live gezählte Ballanzahl ergänzt Bälle rechts neben Ergebnis',`document.querySelector('.ls-finished-table thead tr').lastElementChild.textContent==='Bälle'&&document.querySelector('.ls-finished-table thead tr').lastElementChild.previousElementSibling.textContent==='Ergebnis'&&document.querySelectorAll('.ls-finished-table .ls-shuttle-column').length===1&&[...document.querySelectorAll('.ls-finished-table tbody>tr[data-match_id]')].every(row=>row.cells.length===12&&row.lastElementChild.classList.contains('ls-shuttle-count'))&&document.querySelector('.finished_container tr[data-match_id="match-37"] .match_shuttle_count_number').textContent==='2'`);
  await check('Ungezählte Spiele zeigen einen Gedankenstrich und die Ballzahl steht nicht mehr unter Plan',`[...document.querySelectorAll('.finished_container tr:not([data-match_id="match-37"]) .match_shuttle_count_number')].every(node=>node.textContent==='—'&&getComputedStyle(node.closest('td')).display==='table-cell')&&!document.querySelector('.finished_container .match_properties .match_shuttle_count')&&__finishedRows.every((row,index)=>row.isConnected&&row.querySelector('.player')===__finishedPlayers[index])`);
  await c.evaluate(`(()=>{const match=structuredClone(curt.matches.find(match=>match._id==='match-37'));match.shuttle_count=5;crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}})})()`);
  await check('Eine native Ballkorrektur aktualisiert genau einen Wert ohne doppelte Zellen',`document.querySelector('.finished_container tr[data-match_id="match-37"] .match_shuttle_count_number').textContent==='5'&&document.querySelectorAll('.ls-finished-table th.ls-shuttle-count').length===1&&[...document.querySelectorAll('.ls-finished-table tbody>tr[data-match_id]')].every(row=>row.cells.length===12&&row.querySelectorAll('td.match_shuttle_count').length===1)`);
  await c.evaluate(`for(const [id,count] of [['match-40',1],['match-37',0]]){const match=curt.matches.find(match=>match._id===id);match.shuttle_count=count;cmatch.update_match_score(match)}`);
  await check('Eine andere gezählte Begegnung hält die Ballspalte nach Rücksetzen des ersten Wertes sichtbar',`document.querySelector('.finished_container tr[data-match_id="match-37"] .match_shuttle_count_number').textContent==='—'&&document.querySelector('.finished_container tr[data-match_id="match-40"] .match_shuttle_count_number').textContent==='1'&&document.querySelector('.ls-finished-table colgroup').children.length===12`);
  await c.evaluate(`curt.matches.find(match=>match._id==='match-40').shuttle_count=null;cmatch.update_match_score(curt.matches.find(match=>match._id==='match-40'))`);
  await check('Die letzte zurückgesetzte Ballzahl entfernt Überschrift, Spalte und Zellen vollständig',`!document.querySelector('.ls-finished-table .ls-shuttle-column,.ls-finished-table .match_shuttle_count,.ls-finished-table th.ls-shuttle-count')&&document.querySelector('.ls-finished-table colgroup').children.length===11&&[...document.querySelectorAll('.ls-finished-table tbody>tr[data-match_id]')].every(row=>row.cells.length===11)&&__finishedOrder()==='match-32,match-40,match-37,match-30'`);
  await c.evaluate(`curt.matches.find(match=>match._id==='match-37').shuttle_count=7;cmatch.render_finished(document.querySelector('.finished_container'))`);
  await check('Vollständiger Tabellenneuaufbau übernimmt Ballzahlen und stellt die bedingte Spalte wieder her',`document.querySelectorAll('.ls-finished-table .ls-shuttle-column').length===1&&document.querySelector('.finished_container tr[data-match_id="match-37"] .match_shuttle_count_number').textContent==='7'&&[...document.querySelectorAll('.ls-finished-table tbody>tr[data-match_id]')].every(row=>row.cells.length===12)`);
  await c.evaluate(`(()=>{const input=document.querySelector('[data-board-search]');input.value='Emil Wagner';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await check('Suche verändert die Ballspalte nicht wenn das gezählte Spiel ausgefiltert ist',`document.querySelector('.finished_container tr[data-match_id="match-37"]').hidden&&!document.querySelector('.finished_container tr[data-match_id="match-40"]').hidden&&!!document.querySelector('.ls-finished-table th.ls-shuttle-count')`);
  await c.evaluate(`(()=>{const input=document.querySelector('[data-board-search]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));curt.matches.find(match=>match._id==='match-37').shuttle_count=0;cmatch.update_match_score(curt.matches.find(match=>match._id==='match-37'));window.__finishedRows=[...document.querySelectorAll('.finished_container tbody>tr[data-match_id]')];window.__finishedPlayers=__finishedRows.map(row=>row.querySelector('.player'));window.__sortWrites=__writes.length})()`);
  await click('.ls-time-sort[data-sort-key="plan"]');
  await check('Plan aufsteigend berücksichtigt das Spieldatum und lässt fehlende Werte am Ende',`__finishedOrder()==='match-40,match-37,match-32,match-30'&&document.querySelector('.ls-finished-table [aria-sort="ascending"] .ls-time-sort').dataset.sortKey==='plan'`);
  await click('.ls-time-sort[data-sort-key="plan"]');
  await check('Ein zweiter Klick sortiert Plan absteigend und lässt fehlende Werte weiterhin am Ende',`__finishedOrder()==='match-32,match-37,match-40,match-30'&&document.querySelectorAll('.ls-finished-table th:not([aria-sort="none"])[aria-sort]').length===1`);
  await click('.ls-time-sort[data-sort-key="start"]');
  await check('Beginn sortiert nach dem tatsächlichen Start statt nach Ende oder Plan',`__finishedOrder()==='match-37,match-40,match-32,match-30'`);
  await click('.ls-time-sort[data-sort-key="start"]');
  await check('Beginn absteigend ordnet echte Zeitstempel auch über Mitternacht korrekt',`__finishedOrder()==='match-32,match-40,match-37,match-30'`);
  await click('.ls-time-sort[data-sort-key="end"]');
  await check('Ende aufsteigend sortiert chronologisch und behandelt fehlende Endzeiten getrennt',`__finishedOrder()==='match-37,match-40,match-32,match-30'`);
  await c.evaluate(`document.querySelector('.ls-time-sort[data-sort-key="end"]').focus()`);
  await key('Enter','Enter',13,'\r');
  await check('Die Tastatur schaltet die Sortierrichtung mit erhaltenem Fokus um',`__finishedOrder()==='match-32,match-40,match-37,match-30'&&document.activeElement?.dataset.sortKey==='end'&&document.activeElement.closest('th').getAttribute('aria-sort')==='descending'`);
  await check('Sortieren erhält vorhandene Spiel- und Spielernamensknoten und sendet keine Änderung',`__writes.length===__sortWrites&&__finishedRows.every((row,index)=>row.isConnected&&row.querySelector('.player')===__finishedPlayers[index])&&__sortOtherRows.every(row=>row.isConnected)`);
  await c.evaluate(`(()=>{const match=structuredClone(curt.matches.find(match=>match._id==='match-37'));match.end_ts=Date.parse('2026-10-29T11:40:00Z');match.duration_ms=6000000;crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}})})()`);
  await check('Eine Live-Endkorrektur wird in die gewählte Sortierung einsortiert',`__finishedOrder()==='match-32,match-37,match-40,match-30'&&document.querySelector('.ls-time-sort[data-sort-key="end"]').closest('th').getAttribute('aria-sort')==='descending'`);
  await click('.ls-time-sort[data-sort-key="start"]');
  await c.evaluate(`(()=>{const match=curt.matches.find(match=>match._id==='match-37');match.presses=[{type:'love-all',timestamp:Date.parse('2026-10-29T11:10:00Z')}];cmatch.update_match_score(match)})()`);
  await check('Eine direkte Startkorrektur sortiert neu und lässt die Ergebniszelle frei von Aktionen',`__finishedOrder()==='match-40,match-37,match-32,match-30'&&!document.querySelector('.finished_container .match_confirm_button,.finished_container td.call_td')`);
  await click('.ls-time-sort[data-sort-key="plan"]');
  await c.evaluate(`(()=>{const match=structuredClone(curt.matches.find(match=>match._id==='match-32'));match.setup.scheduled_date='2026-10-28';crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}})})()`);
  await check('Eine geänderte Ansetzung sortiert Plan nach dem neuen Datum',`__finishedOrder()==='match-32,match-40,match-37,match-30'`);
  await c.evaluate(`__finishForSort('match-36','2026-10-29','09:30','2026-10-29T10:15:00Z','2026-10-29T10:45:00Z')`);
  await check('Ein neu beendetes Spiel übernimmt die aktive Plansortierung',`__finishedOrder()==='match-32,match-36,match-40,match-37,match-30'`);
  await check('Ein neu beendetes Spiel mit gezählten Bällen blendet die Spalte wieder ein',`document.querySelector('.finished_container tr[data-match_id="match-36"] .match_shuttle_count_number').textContent==='3'&&!!document.querySelector('.ls-finished-table th.ls-shuttle-count')`);
  await c.evaluate(`cmatch.reorder_match_row(curt.matches.find(match=>match._id==='match-40'),'finished')`);
  await check('Native Zeilenumsortierung erhält die persönliche Wahl der Zeitspalte',`__finishedOrder()==='match-32,match-36,match-40,match-37,match-30'`);
  await c.evaluate(`cmatch.render_finished(document.querySelector('.finished_container'))`);
  await check('Vollständiger Neuaufbau erhält Sortierspalte und Richtung',`__finishedOrder()==='match-32,match-36,match-40,match-37,match-30'&&document.querySelector('.ls-finished-table [aria-sort="ascending"] .ls-time-sort').dataset.sortKey==='plan'&&[...document.querySelectorAll('.finished_container tr.ls-match')].every(row=>row.cells.length===12)`);
  // Column geometry applies to visible games. Open every date explicitly;
  // the date-group suite verifies the default collapsed days separately.
  await c.evaluate(`for(const toggle of document.querySelectorAll('.finished_container .ls-date-toggle'))if(toggle.getAttribute('aria-expanded')==='false')toggle.click()`);
  for(const width of [1920,1536,390]) {
   await metrics(width,width===390?844:940);
   await check('Sortierbare Zeitüberschriften passen bei '+width+' Pixeln ohne Seitenüberlauf',`document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.ls-finished-table .ls-time-sort')].every(button=>{const r=button.getBoundingClientRect(),cell=button.closest('th').getBoundingClientRect();return r.width>0&&r.left>=cell.left&&r.right<=cell.right})`);
   await check('Ballspalte bleibt bei '+width+' Pixeln vollständig sichtbar und von der Planzeit getrennt',`[...document.querySelectorAll('.ls-finished-table .match_shuttle_count_number')].every(number=>{const r=number.getBoundingClientRect(),cell=number.closest('td').getBoundingClientRect();return r.width>0&&r.left>=cell.left&&r.right<=cell.right})&&!document.querySelector('.finished_container .match_properties .match_shuttle_count')`);
  }
  await metrics(1920,940);await click('.board-toolbar-actions [data-action="density"]');
  await check('Komfortansicht erhält kompakte Sortierknöpfe und vollständige Zeitwerte',`[...document.querySelectorAll('.ls-finished-table .ls-time-sort')].every(button=>button.getBoundingClientRect().width<=button.closest('th').clientWidth)&&[...document.querySelectorAll('.finished_container .ls-play-time time')].every(time=>/^\\d{2}:\\d{2}$/.test(time.textContent))`);
  await c.evaluate(`(()=>{document.body.style.paddingBottom='100vh';const table=document.querySelector('.finished_container');window.scrollTo(0,table.getBoundingClientRect().top+scrollY-80)})()`);
  const finishedClip=await c.evaluate(`(()=>{const r=document.querySelector('.finished_container').getBoundingClientRect();return{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}})()`);
  const finishedShot=await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:finishedClip});
  fs.writeFileSync(path.join(previews,'beendete-spiele.png'),Buffer.from(finishedShot.data,'base64'));
  await click('.board-toolbar-actions [data-action="density"]');
  await c.evaluate(`(()=>{const match=structuredClone(curt.matches.find(match=>match._id==='match-37'));delete match.team1_won;delete match.btp_winner;match.end_ts=null;match.duration_ms=null;match.presses=[];match.network_score=[];Object.assign(match.setup,{state:'scheduled',now_on_court:false,court_id:null});crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}})})()`);
  await check('Zurückgenommener Abschluss erhält wieder normale Aktionen und keine Zeit-Sortierknöpfe in anderen Listen',`__finishedOrder()==='match-32,match-36,match-40,match-30'&&document.querySelector('.unassigned_container tr[data-match_id="match-37"]').cells.length===10&&!document.querySelector('.unassigned_container .ls-time-sort,.courts_container .ls-time-sort')`);
  await c.evaluate(`(()=>{const match=structuredClone(curt.matches.find(match=>match._id==='match-36'));delete match.team1_won;delete match.btp_winner;match.end_ts=null;match.duration_ms=null;match.presses=[];match.network_score=[];Object.assign(match.setup,{state:'scheduled',now_on_court:false,court_id:null});crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}})})()`);
  await check('Rücknahme des letzten Abschlusses mit Ballzahl entfernt die Ballspalte',`__finishedOrder()==='match-32,match-40,match-30'&&!document.querySelector('.ls-finished-table th.ls-shuttle-count,.ls-finished-table .ls-shuttle-column,.ls-finished-table td.match_shuttle_count')&&curt.matches.find(match=>match._id==='match-36').shuttle_count===3`);
  await c.evaluate(`__finishForSort('match-36','2026-10-29','09:30','2026-10-29T10:15:00Z','2026-10-29T10:45:00Z')`);
  await c.evaluate(`cmatch.remove_match_from_gui(curt.matches.find(match=>match._id==='match-36'),'finished')`);
  await check('Native Entfernung der letzten gezählten Zeile entfernt auch die Ballspalte',`!document.querySelector('.finished_container tr[data-match_id="match-36"],.ls-finished-table th.ls-shuttle-count,.ls-finished-table .ls-shuttle-column')&&[...document.querySelectorAll('.ls-finished-table tbody>tr[data-match_id]')].every(row=>row.cells.length===11)`);
  await require('./tablets-check')({c,check,click,open,metrics,key,nativeDrag,delay,previews});
  await require('./layout-hidden-check')({c,check,click,open,metrics,key,nativeDrag,delay,previews});
  await require('./live-updates-check')({c,check,open,delay});
  await require('./granular-updates-check')({c,check,open,delay});
  await metrics(1920,940);await click('.board-toolbar-actions [data-action="layout-edit"]');await click('[data-action="layout-reset"]');await click('[data-layout-editor] [data-action="layout-edit"]');
  await open(1920,940);
  await snap('full-hd');
  await click('.board-toolbar-actions [data-action="layout-edit"]');
  await click('[data-board-card="device"] [data-action="layout-card-zone"]');
  await click('[data-layout-editor] [data-action="layout-edit"]');
  await snap('sidebar');
  await metrics(390,844);await snap('mobil');
  const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown').map(event=>event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text);
  const failed=c.events.filter(event=>event.method==='Network.responseReceived'&&event.params.response.status>=400).map(event=>event.params.response.url);
  const consoleErrors=c.events.filter(event=>event.method==='Runtime.consoleAPICalled'&&event.params.type==='error').map(event=>event.params.args.map(arg=>arg.value||arg.description).join(' '));
  assert.equal(consoleErrors.length,0,JSON.stringify(consoleErrors));
  console.log('Exceptions '+JSON.stringify(exceptions));console.log('Assets '+JSON.stringify(failed));
  assert.equal(exceptions.length,0);assert.equal(failed.length,0);
  fs.writeFileSync(path.join(previews,'verification.json'),JSON.stringify({date:'2026-10-29',scope:'Echte Frontend-Module; isolierte statische Vorschau und simulierte Serverantworten. Keine Verbindung zum laufenden BTS oder Sprachserver.',checks:report.checks,exceptions,consoleErrors,failedAssets:failed},null,2)+'\n');
  console.log(JSON.stringify({checks:report.checks.length,exceptions:exceptions.length,failedAssets:failed.length}));
 }catch(error){console.error(error.stack);process.exitCode=1;
 }finally{
  if(profiling) {
   try {const result=await c.call('Profiler.stop');fs.writeFileSync(process.env.BTS_UI_PROFILE_FILE,JSON.stringify(result.profile));}
   catch(error){console.error('UI profile: '+error.message);process.exitCode=1;}
  }
  if(ws)ws.terminate();
  if(chrome){const done=new Promise(r=>chrome.once('exit',r));chrome.kill('SIGTERM');await Promise.race([done,delay(4000)]);}
  if(server){server.closeAllConnections();server.close();}
  if(profile){await delay(350);fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
