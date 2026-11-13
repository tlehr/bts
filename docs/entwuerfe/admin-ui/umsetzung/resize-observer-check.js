'use strict';
/* eslint-disable no-console -- Isolated ResizeObserver diagnostics and regression. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,metrics,previews}) {
 await c.call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
  const qa=window.__resizeLoop={phase:'load',errors:[]};
  window.addEventListener('error',event=>{if(event instanceof ErrorEvent)qa.errors.push({message:event.message,phase:qa.phase});});
 })()`});
 const instrument=require('./startup-check').instrumentation;
 await open(1366,900,{startup:true,beforeFixture:()=>c.evaluate('('+instrument.toString()+')()'),transformFixture:source=>source.replace('tournament:structuredClone(fixture)','tournament:__startup.make(fixture)')});
 await c.evaluate('__startup.ready');
 const samples=[],reference=require('./name-measurement-batch-check').nativeReference;
 for(const [width,density]of [[1920,'compact'],[1000,'compact'],[768,'normal'],[500,'compact'],[1366,'normal'],[1366,'compact']]) {
  await c.evaluate(`__resizeLoop.phase=${JSON.stringify(width+'/'+density)}`);await metrics(width,900);
  await c.evaluate(`(()=>{const button=document.querySelector('[data-action="density"]');for(let i=0;i<3&&document.querySelector('.leitstand').dataset.density!==${JSON.stringify(density)};i++)button.click();return __startup.settle();})()`);
  const native=await c.evaluate('('+reference.toString()+')()');
  assert(native.length>5&&native.every(item=>item.stacked===item.shouldStack&&JSON.stringify(item.actual)===JSON.stringify(item.expected)),'Native labels and stacking at '+width+'/'+density);
  samples.push(await c.evaluate('({phase:__resizeLoop.phase,errors:__resizeLoop.errors.length,rows:document.querySelectorAll(".ls-match").length,pending:cleitstand.isUpdating()})'));
 }
 await c.evaluate(`(async()=>{
  __resizeLoop.phase='font and content change';document.fonts.dispatchEvent(new Event('loadingdone'));
  const match=structuredClone(curt.matches.find(match=>match.setup.now_on_court));Object.assign(match.setup.teams[0].players[0],{name:'Alexander Maximilian Constantin Müller-Schwennsen',firstname:'Alexander Maximilian Constantin',lastname:'Müller-Schwennsen'});
  crouting.on_change({ctype:'match_edit',tournament_key:curt.key,val:{match__id:match._id,match}});await __startup.settle();
 })()`);
 const result=await c.evaluate('({errors:__resizeLoop.errors,rows:document.querySelectorAll(".ls-match").length,pending:cleitstand.isUpdating(),probes:document.querySelectorAll(".ls-layout-probe").length})');
 const report={scope:'Isolated native ResizeObserver, 512 synthetic matches, repeated viewport/density, font and name changes. No error filtering or preventDefault.',samples,...result};
 fs.writeFileSync(process.env.BTS_RESIZE_REPORT||path.join(previews,'resize-observer-verification.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({errors:result.errors.length,first:result.errors[0],samples},null,2));
 assert(result.errors.length===0,'No window error events, including undelivered ResizeObserver notifications');
 assert(!result.pending&&result.rows===512&&result.probes===0,'All rows survive and fitting settles');
};
