'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,metrics,previews}) {
 await open(1920,1080);
 const settle=()=>c.evaluate('new Promise(resolve=>{let stable=0;const next=()=>{stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(next);};requestAnimationFrame(next)})');
 await c.evaluate('curt.btp_enabled=true;cleitstand.btpSync()');await settle();
 const repeated=await c.evaluate(`(async()=>{
  const qa=window.__headerQA={headerReads:0,fontReads:0,styleWrites:0};
  qa.descriptor=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetHeight');qa.style=window.getComputedStyle;
  Object.defineProperty(HTMLElement.prototype,'offsetHeight',{...qa.descriptor,get(){if(this.classList.contains('toprow'))qa.headerReads++;return qa.descriptor.get.call(this);}});
  window.getComputedStyle=function(element,...args){if(element.classList.contains('btp_status_badge'))qa.fontReads++;return qa.style.call(this,element,...args);};
  const sidebar=document.querySelector('.board-sidebar'),observer=new MutationObserver(records=>qa.styleWrites+=records.length);observer.observe(sidebar,{attributes:true,attributeFilter:['style']});
  for(let n=0;n<10;n++)cleitstand.btpSync();cleitstand.refreshCounts();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));observer.disconnect();
  return{headerReads:qa.headerReads,fontReads:qa.fontReads,styleWrites:qa.styleWrites,position:qa.style.call(window,document.querySelector('.toprow')).position,pageClass:document.body.classList.contains('leitstand-view')};
 })()`);
 assert(repeated.headerReads===0&&repeated.fontReads===0&&repeated.styleWrites===0,'Unchanged board updates must reuse header/font measurements and preserve the sidebar style');
 assert(repeated.pageClass&&repeated.position==='sticky','The static page state retains the existing sticky header styles');
 await metrics(1000,1080);await settle();
 const resized=await c.evaluate(`(()=>{
  const qa=__headerQA,header=document.querySelector('.toprow'),sidebar=document.querySelector('.board-sidebar'),before=qa.fontReads;cleitstand.btpSync();
  const result={sidebarCorrect:parseFloat(sidebar.style.getPropertyValue('--card-sidebar-top'))===qa.descriptor.get.call(header)+8,newFontReads:qa.fontReads-before};
  Object.defineProperty(HTMLElement.prototype,'offsetHeight',qa.descriptor);window.getComputedStyle=qa.style;return result;
 })()`);
 assert(resized.sidebarCorrect&&resized.newFontReads===1,'Resizing updates the sidebar offset and invalidates the BTP font cache exactly once');
 const remount=await c.evaluate('(()=>{cleitstand.unmount();const removed=!document.body.classList.contains("leitstand-view");ctournament.ui_show();return{removed,restored:document.body.classList.contains("leitstand-view")}})()');
 assert(remount.removed&&remount.restored,'Leaving and rebuilding the board releases and restores the page state');
 await c.evaluate('const longGames=document.createElement("div");longGames.style.height="12000px";document.querySelector(".board-games").append(longGames)');
 const scrollSamples=[];
 for(const width of [1920,1000,390]) {
  await metrics(width,1080);await settle();
  for(const offset of [0,1200,5000,'document.documentElement.scrollHeight']) {
   await c.evaluate(`window.scrollTo(0,${offset})`);await settle();
   const sample=await c.evaluate(`(()=>{const header=document.querySelector('.toprow'),rect=header.getBoundingClientRect();return {width:innerWidth,scrollY,top:rect.top,height:rect.height,visible:header.contains(document.elementFromPoint(20,8)),sidebarOffset:parseFloat(document.querySelector('.board-sidebar').style.getPropertyValue('--card-sidebar-top'))}})()`);
   assert(Math.abs(sample.top)<.5&&sample.height>0&&sample.visible&&Math.abs(sample.sidebarOffset-sample.height-8)<.5,'The header must remain visible at every scroll depth and viewport width: '+JSON.stringify(sample));
   scrollSamples.push(sample);
  }
 }
 const report={date:'2026-10-30',checks:4+scrollSamples.length,repeated,resized,remount,scrollSamples};fs.writeFileSync(path.join(previews,'header-cache-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
};
