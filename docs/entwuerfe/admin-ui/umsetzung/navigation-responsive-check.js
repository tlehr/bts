'use strict';
/* eslint-disable no-console -- Standalone browser verification reports its results. */
const assert = require('assert'), fs = require('fs'), path = require('path');

module.exports = async function({c, open, metrics, check, key, previews}) {
 const checks = [], verify = async (name, expression) => {
  try {await check(name, expression);checks.push(name);}
  catch (error) {console.error(JSON.stringify(await c.evaluate('__navigationSample()')));throw error;}
 };
 await open(1920, 1080);
 await c.evaluate(`window.__navigationSample=()=>{
  const header=document.querySelector('.leitstand-header'),nav=header.querySelector('.leitstand-nav'),rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  return {width:innerWidth,header:rect(header),nav:rect(nav),status:rect(header.querySelector('.toprow_right')),stacked:header.classList.contains('has-stacked-navigation'),compact:nav.classList.contains('is-compact'),links:[...nav.children].map(link=>({label:link.textContent,accessible:link.getAttribute('aria-label'),active:link.hasAttribute('aria-current'),visible:getComputedStyle(link.querySelector('span')).visibility!=='hidden',...rect(link)}))};
 };`);
 await c.evaluate(String.raw`window.__navigationSettle=async()=>{
  let stable=0;
  for(let attempt=0;attempt<60;attempt++) {
   await new Promise(resolve=>requestAnimationFrame(resolve));
   const animations=document.querySelector('.leitstand-nav').getAnimations({subtree:true}).filter(animation=>animation.playState!=='finished');
   if(!animations.length&&!cleitstand.isUpdating()&&!ctournament.isUpdating()){if(++stable===4)return;}else stable=0;
   if(animations.length)await Promise.allSettled(animations.map(animation=>animation.finished));
  }
  throw new Error('Navigation animations did not settle');
 };
 window.__navigationTransitionSample=async()=>{
  await new Promise(resolve=>requestAnimationFrame(resolve));
  const label=document.querySelector('.leitstand-nav a[href$="/edit"] span'),animation=label.getAnimations().find(item=>item.transitionProperty==='max-width');
  if(!animation)return null;
  const duration=animation.effect.getTiming().duration;animation.pause();animation.currentTime=duration/2;
  const sample={duration,width:parseFloat(getComputedStyle(label).maxWidth),limit:parseFloat(label.parentElement.style.getPropertyValue('--navigation-label-width'))};
  animation.play();return sample;
 };`);
 const samples = [];
 for (const page of ['Turnierleitung', 'Urkunden']) {
  if (page === 'Urkunden') await c.evaluate('document.querySelector(\'.leitstand-nav a[href$="/certificates"]\').click()');
  for (const width of [1920, 1600, 1440, 1366, 1280, 1100, 1024, 800, 700, 640, 390, 320]) {
   await metrics(width, 1080);
   await c.evaluate('__navigationSettle()');
   await verify(page + ': navigation fits without clipping or overlap at ' + width, `(()=>{
    const sample=__navigationSample();return sample.links.length===6&&sample.links.every(link=>link.accessible===link.label&&link.left>=0&&link.right<=innerWidth+.5&&link.top>=sample.header.top&&link.bottom<=sample.header.bottom)&&sample.header.height<=89&&sample.header.right<=innerWidth+.5&&(sample.stacked||sample.nav.right<=sample.status.left+.5)&&sample.links.every(link=>link.visible===(link.active||!sample.compact));
   })()`);
   if (width >= 1280) await verify(page + ': tabs stay in the first header row at ' + width, '!__navigationSample().stacked&&__navigationSample().header.height<=45');
   samples.push({page, ...await c.evaluate('__navigationSample()')});
  }
  await metrics(1280, 1080);
  await c.evaluate('__navigationSettle()');
  await verify(page + ': compact navigation keeps the active name visible', `__navigationSample().compact&&__navigationSample().links.filter(link=>link.visible).length===1&&__navigationSample().links.find(link=>link.active).label===${JSON.stringify(page)}`);
  const before = await c.evaluate('(()=>{const link=document.querySelector(\'.leitstand-nav a[href$="/edit"]\'),r=link.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,height:__navigationSample().header.height,width:r.width};})()');
  await c.call('Input.dispatchMouseEvent', {type:'mouseMoved', x:before.x, y:before.y});
  await c.evaluate('(async()=>{window.__navigationOpening=await __navigationTransitionSample();await __navigationSettle();})()');
  await verify(page + ': the inline name expands through intermediate widths', '__navigationOpening&&__navigationOpening.duration>0&&__navigationOpening.width>0&&__navigationOpening.width<__navigationOpening.limit');
  await verify(page + ': hovering expands the normal inline tab while retaining the active name and header height', String.raw`(()=>{const sample=__navigationSample(),last=sample.links.at(-1),link=document.querySelector('.leitstand-nav a[href$="/edit"]'),label=link.querySelector('span'),icon=link.querySelector('svg'),r=label.getBoundingClientRect(),i=icon.getBoundingClientRect();return last.visible&&sample.links.find(item=>item.active).visible&&getComputedStyle(label).position==='static'&&r.left>=i.right&&r.top>=last.top&&r.bottom<=last.bottom&&last.width>`+before.width+String.raw`+10&&sample.header.height===`+before.height+String.raw`;})()`);
  await c.call('Input.dispatchMouseEvent', {type:'mouseMoved', x:0, y:200});
  await c.evaluate('(async()=>{window.__navigationClosing=await __navigationTransitionSample();await __navigationSettle();})()');
  await verify(page + ': leaving the tab smoothly collapses its name again', '__navigationClosing&&__navigationClosing.duration>0&&__navigationClosing.width>0&&__navigationClosing.width<__navigationClosing.limit&&!__navigationSample().links.at(-1).visible');
  await c.evaluate('document.querySelector(\'.leitstand-nav a[href$="/edit"]\').previousElementSibling.focus()');
  await key('Tab', 'Tab', 9);
  await c.evaluate('__navigationSettle()');
  await verify(page + ': keyboard focus reveals the name and all icon links remain accessible', 'document.activeElement.matches(\'.leitstand-nav a[href$="/edit"]\')&&__navigationSample().links.at(-1).visible');
  await c.evaluate('document.activeElement.blur()');
  for(const width of [1024, 390, 320]) {
   await metrics(width, 1080);await c.evaluate('__navigationSettle()');
   const target=await c.evaluate(String.raw`(()=>{const r=document.querySelector('.leitstand-nav a[href$="/edit"]').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`);
   await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',...target});await c.evaluate('__navigationSettle()');
   await verify(page+': inline expansion fits without covering icons or service indicators at '+width,String.raw`(()=>{const s=__navigationSample();return s.links.at(-1).visible&&s.links.find(link=>link.active).visible&&s.links.every((link,index)=>link.left>=0&&link.right<=innerWidth+.5&&(!index||link.left>=s.links[index-1].right-.5))&&(s.stacked||s.links.at(-1).right<=s.status.left+.5)&&s.header.height<=89;})()`);
   await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:200});await c.evaluate('__navigationSettle()');
  }
  await metrics(1920, 1080);
  await c.evaluate('__navigationSettle()');
  await verify(page + ': resizing wider restores all names', '!__navigationSample().compact&&!__navigationSample().stacked&&__navigationSample().links.every(link=>link.visible)');
 }
 await c.evaluate('window.__navigationFont=document.createElement(\'style\');__navigationFont.textContent=\'.leitstand-header{font-family:monospace!important}.leitstand-nav a{font:14px monospace!important}\';document.head.append(__navigationFont)');
 await metrics(1280, 1080);
 await verify('Different font metrics trigger fitting without clipping on the certificate page', '(()=>{const s=__navigationSample();return s.compact&&!s.stacked&&s.links.every(link=>link.left>=0&&link.right<=s.status.left+.5)&&s.header.height<=45;})()');
 await c.evaluate('__navigationFont.remove();document.querySelector(\'.leitstand-nav a[href="/admin/t/preview/"]\').click()');
 await metrics(1920, 1080);
 await verify('Returning to the board releases the old observer and restores expanded navigation', '!!document.querySelector(\'.page-leitstand\')&&!__navigationSample().compact&&!__navigationSample().stacked&&__navigationSample().links.every(link=>link.visible)');
 const exceptions = c.events.filter(event => event.method === 'Runtime.exceptionThrown');
 assert.strictEqual(exceptions.length, 0, JSON.stringify(exceptions));
 fs.writeFileSync(path.join(previews, 'navigation-responsive-verification.json'), JSON.stringify({date:'2026-11-02', checks, samples, exceptions:exceptions.length}, null, 2) + '\n');
 console.log(JSON.stringify({checks:checks.length, exceptions:exceptions.length}));
};
