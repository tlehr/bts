'use strict';
const fs=require('fs'),path=require('path');

module.exports=async function({c,open,metrics,capture,verify,previews}) {
 const settle=expression=>c.evaluate('(async()=>{for(let i=0;i<150;i++){if('+expression+')return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error("Speech workspace did not settle");})()');
 await open(1920,1080);
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await c.evaluate(String.raw`(()=>{
  window.__speechPlaybackGate=true;const input=document.querySelector('#custom_announcement');input.value='Ansage beim Wechsel zum Sprachsystem';input.dispatchEvent(new Event('input'));document.querySelector('#local_announce_btn').dataset.speechState='ready';document.querySelector('#local_announce_btn').click();
  window.__systemDocument=document;window.__systemService=btsSpeechService;window.__systemCancels=0;window.__systemUnloads=0;btsSpeechService.cancel=()=>__systemCancels++;window.addEventListener('beforeunload',()=>__systemUnloads++);
 })()`);
 await settle('typeof __releaseSpeechPlayback==="function"');
 await c.evaluate(String.raw`document.querySelector('.leitstand-nav a[href$="/speech-planning/"]').click()`);
 await verify('Opening the speech system from tournament control retains the actual running announcement once',String.raw`document.querySelector('.page-speech')&&document===__systemDocument&&btsSpeechService===__systemService&&announcementPlaybackActive&&__localAnnouncements.length===1&&__systemCancels===0&&__systemUnloads===0`);
 await settle('document.querySelector(".speech-system-plan")?.contentDocument?.querySelector("#view-games")');
 await c.evaluate(String.raw`window.__systemFrame=document.querySelector('.speech-system-plan');window.__systemPlan=__systemFrame.contentDocument;window.__systemControls=[...document.querySelectorAll('.page-speech input,.page-speech select')];`);
 await verify('The original preparation overview, state diagram, game readiness and concrete queue remain available',String.raw`__systemPlan.querySelector('#view-overview')&&__systemPlan.querySelector('#view-diagram')&&__systemPlan.querySelector('#view-games')&&__systemPlan.querySelector('#queue')&&__systemPlan.querySelector('.masthead').getBoundingClientRect().height===0&&__systemFrame.getBoundingClientRect().height>0`);
 await c.evaluate(String.raw`__systemPlan.querySelector('#view-games').click()`);
 await verify('The existing game view still opens inside the shared workspace',String.raw`!__systemPlan.querySelector('#games-panel').hidden&&__systemPlan.querySelector('.games-search')&&document.querySelector('.speech-system-plan')===__systemFrame`);
 await c.evaluate(String.raw`__systemPlan.querySelector('#view-diagram').click()`);
 await verify('The state diagram retains export, print and selection tools',String.raw`!__systemPlan.querySelector('#diagram-panel').hidden&&__systemPlan.querySelector('#download')&&__systemPlan.querySelector('#print')&&__systemPlan.querySelector('#diagram-current')`);
 await c.evaluate(String.raw`__systemPlan.querySelector('#view-overview').click()`);
 for(const width of [1920,390,320]) {
  await metrics(width,1000);
  await verify('Shared speech workspace and embedded plan fit at '+width,String.raw`(()=>{const box=document.querySelector('.page-speech').getBoundingClientRect();return box.width<=1440.5&&box.left>=0&&box.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+1&&__systemPlan.documentElement.scrollWidth<=__systemFrame.clientWidth+1;})()`);
  if(width===1920)await capture('sprachsystem-vorbereitung');
  if(width===390)await capture('sprachsystem-vorbereitung-mobil');
 }
 await metrics(1920,1080);
 await c.evaluate(String.raw`document.querySelector('#speech-tab-preparation').focus();document.querySelector('.speech-system-tabs').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));`);
 await verify('Tab keyboard navigation selects playback and moves focus without rebuilding controls or stopping audio',String.raw`document.querySelector('.page-speech').dataset.speechSection==='playback'&&document.activeElement.id==='speech-tab-playback'&&__systemControls.every(node=>node.isConnected)&&announcementPlaybackActive&&__localAnnouncements.length===1&&__systemCancels===0`);
 await capture('sprachsystem-wiedergabe');
 await c.evaluate(String.raw`document.querySelector('#speech-tab-pronunciation').click();history.back()`);
 await settle('document.querySelector(".page-speech")?.dataset.speechSection==="playback"');
 await verify('Browser Back restores the previous speech tab with its existing controls and plan',String.raw`location.pathname.endsWith('/speech-planning/playback')&&__systemControls.every(node=>node.isConnected)&&document.querySelector('.speech-system-plan')===__systemFrame`);
 await c.evaluate('history.forward()');await settle('document.querySelector(".page-speech")?.dataset.speechSection==="pronunciation"');
 await verify('Browser Forward restores pronunciation without disturbing playback',String.raw`location.pathname.endsWith('/speech-planning/pronunciation')&&announcementPlaybackActive&&__systemCancels===0`);
 await c.evaluate(String.raw`document.querySelector('.speech-system-settings a').click()`);
 await verify('The settings link returns directly to the six configuration fields while the announcement continues',String.raw`document.querySelector('.page-settings').dataset.settingsSection==='speech'&&document.querySelector('[name=no_match_cascade_announcements_enabled]')&&!document.querySelector('.page-speech')&&announcementPlaybackActive&&__localAnnouncements.length===1&&__systemUnloads===0`);
 await c.evaluate(String.raw`document.querySelector('.leitstand-nav a[href$="/certificates"]').click();document.querySelector('.leitstand-nav a[href$="/speech-planning/"]').click()`);
 await verify('Certificate navigation also opens the speech system in the same document with uninterrupted audio',String.raw`document===__systemDocument&&document.querySelector('.page-speech')&&announcementPlaybackActive&&__systemCancels===0&&__systemUnloads===0&&__localAnnouncements.length===1`);
 await c.evaluate(String.raw`document.querySelector('.leitstand-nav a[href$="/edit"]').click();window.__speechPlaybackGate=false;__releaseSpeechPlayback()`);
 for(const area of ['','playback','pronunciation']) {
  await c.evaluate('crouting.navigate_to('+JSON.stringify('t/preview/speech-planning/'+area)+')');
  const start=c.events.length;await c.call('Page.reload');
  for(let i=0;!c.events.slice(start).some(event=>event.method==='Page.loadEventFired');i++) {
   if(i===200)throw new Error('Speech workspace reload did not finish');await new Promise(resolve=>setTimeout(resolve,20));
  }
  await c.evaluate(fs.readFileSync(path.join(previews,'fixture.js'),'utf8'));
  await settle('!!document.querySelector(".page-speech")');
  await verify('Reloading the speech-system URL directly opens '+(area||'preparation'),`document.querySelector('.page-speech').dataset.speechSection===${JSON.stringify(area||'preparation')}&&document.querySelector('.board-page-title').textContent==='BTS – Sprachsystem'&&document.querySelectorAll('.page-speech').length===1`);
 }
 await c.evaluate(String.raw`window.__systemQueueRequests=0;const queue=btsSpeechService.queue;btsSpeechService.queue=async()=>{__systemQueueRequests++;return queue();};document.querySelector('.leitstand-nav a[href$="/edit"]').click()`);
 await c.evaluate('(async()=>{await new Promise(resolve=>setTimeout(resolve,3200));})()');
 await verify('Leaving the speech system releases its queue polling, frame and workspace',String.raw`!document.querySelector('.page-speech,.speech-system-plan')&&__systemQueueRequests===0&&document.querySelector('.page-settings')`);
};
