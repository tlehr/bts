'use strict';
/* eslint-disable no-console -- Native observer regression; no live services. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 await open(1920,1080,{beforeFixture:()=>c.evaluate('window.__nativeReadiness=btsSpeechReadiness;window.__nativeReadinessService=btsSpeechService')});
 await c.evaluate(`(()=>{
  const qa=window.__speechVisibility={requests:[],geometryReads:0};
  window.btsSpeechReadiness=__nativeReadiness;
  __nativeReadinessService.inspect=async parts=>{qa.requests.push([...parts]);return{speech:{enabled:true,cache_version:'visibility-test'},clips:parts.map(()=>({status:'completed',local:true}))}};
  const native=Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect=function(...args){if(this.dataset.speechVisibilityProbe){qa.geometryReads++;throw new Error('Readiness forced control geometry');}return native.apply(this,args)};
  qa.visible=document.createElement('button');qa.visible.dataset.speechVisibilityProbe='visible';qa.visible.style.cssText='position:fixed;top:180px;left:30px;width:80px;height:30px;z-index:999999';qa.visible.textContent='Visible';document.body.append(qa.visible);
  qa.distant=document.createElement('button');qa.distant.dataset.speechVisibilityProbe='distant';qa.distant.style.cssText='position:absolute;top:20000px;left:30px;width:80px;height:30px';qa.distant.textContent='Distant';document.body.append(qa.distant);
  btsSpeechReadiness.trackText(qa.visible,()=>['Visible probe']);btsSpeechReadiness.trackText(qa.distant,()=>['Distant probe']);
  qa.wait=predicate=>new Promise((resolve,reject)=>{const deadline=performance.now()+4000;const check=()=>{if(predicate())return resolve();if(performance.now()>deadline)return reject(new Error('Intersection readiness did not update'));setTimeout(check,20)};check()});
 })()`);
 await c.evaluate('__speechVisibility.wait(()=>__speechVisibility.visible.dataset.speechState==="ready")');
 const first=await c.evaluate('({requests:__speechVisibility.requests,geometryReads:__speechVisibility.geometryReads,distant:__speechVisibility.distant.dataset.speechState})');
 assert(first.requests.flat().includes('Visible probe')&&!first.requests.flat().includes('Distant probe'),'Only the intersecting control is inspected');
 assert.strictEqual(first.geometryReads,0,'Readiness must not synchronously measure tracked button geometry');
 await c.evaluate('__speechVisibility.distant.scrollIntoView({block:"center"});__speechVisibility.wait(()=>__speechVisibility.distant.dataset.speechState==="ready")');
 const final=await c.evaluate('({requests:__speechVisibility.requests,geometryReads:__speechVisibility.geometryReads,visible:__speechVisibility.visible.dataset.speechState,distant:__speechVisibility.distant.dataset.speechState})');
 assert(final.requests.flat().includes('Distant probe')&&final.distant==='ready','Scrolling into view inspects the new control and updates its status');
 assert.strictEqual(final.geometryReads,0);
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'Native observation must not throw');
 fs.writeFileSync(path.join(previews,'speech-readiness-visibility-verification.json'),JSON.stringify({scope:'Native IntersectionObserver and production readiness controller with a fake inspection service; no live writes.',first,final},null,2)+'\n');
 console.log(JSON.stringify({first,final},null,2));
};
