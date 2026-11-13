'use strict';
/* eslint-disable no-console -- Isolated reload and native geometry regression. */
const assert=require('assert'),fs=require('fs'),path=require('path'),{nativeReference}=require('./name-measurement-batch-check');
module.exports=async function({c,open,metrics,previews}) {
 const checks=[],check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('OK '+name);};
 const marker=await c.call('Page.addScriptToEvaluateOnNewDocument',{source:'window.addEventListener("pagehide",()=>{try{sessionStorage.setItem("__qaNameCacheStart",String(performance.now()));}catch{}});'});
 try {
  await open(1366,900);
  const snapshot=()=>c.evaluate('[...document.querySelectorAll(\'.team-one,.team-two\')].map(node=>({stacked:node.classList.contains(\'ls-team-stacked\'),labels:[...node.querySelectorAll(\'.player\')].map(player=>player.firstChild.nodeValue)}))');
  const cold=await snapshot();
  await c.evaluate('window.addEventListener("pagehide",()=>{try{sessionStorage.setItem("__qaNameCacheSaveMs",String(performance.now()-Number(sessionStorage.getItem("__qaNameCacheStart"))));}catch{}})');
  await open(1366,900,{reload:true});
  const warm=await snapshot(),cache=await c.evaluate('(()=>{const raw=sessionStorage.getItem("bts-admin-name-metrics-v1"),saved=JSON.parse(raw);return{bytes:raw.length,entries:saved.entries.length,save_ms:Number(sessionStorage.getItem("__qaNameCacheSaveMs"))};})()');
  check('Leaving stores bounded native widths and the next reload preserves every label and stack',cache.entries>0&&cache.bytes<=1024*1024&&JSON.stringify(cold)===JSON.stringify(warm));
  const samples=[];
  for(const width of [1366,1920]) {
   await metrics(width,900);await c.evaluate('new Promise(resolve=>{let stable=0;function frame(){stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame);}requestAnimationFrame(frame);})');
   const native=await c.evaluate('('+nativeReference.toString()+')()');samples.push({width,teams:native.length});
   check('Restored measurements match independent native labels and stacks at '+width,native.length>5&&native.every(item=>item.stacked===item.shouldStack&&JSON.stringify(item.actual)===JSON.stringify(item.expected)));
  }
  await c.evaluate('window.addEventListener("pagehide",()=>sessionStorage.setItem("bts-admin-name-metrics-v1","{"),{once:true})');
  await open(1366,900,{reload:true});
  check('A malformed saved payload rebuilds natively without changing the labels',JSON.stringify(await snapshot())===JSON.stringify(cold));
  check('No uncaught browser exceptions',!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
  const report={checks,cache,samples};fs.writeFileSync(path.join(previews,'name-metrics-cache-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{await c.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:marker.identifier});}
};
