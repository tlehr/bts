'use strict';
/* eslint quotes: ["error", "single", {"allowTemplateLiterals": true}] -- Browser expressions use template literals. */
const assert = require('assert');
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));

// Check rendered pixels as well as DOM state: GIF playback is not a CSS Animation.
module.exports = async function({c,check,selector,width,height,asset}) {
 const read = body => c.evaluate('(async()=>{const battery=document.querySelector('+JSON.stringify(selector)+'),charge=battery.querySelector(\'[class$="battery-charge"]\'),gauge=battery.querySelector(\'[class$="battery-gauge"]\'),fill=battery.querySelector(\'[class$="battery-fill"]\');'+body+'})()');
 const scroll = await c.evaluate('({x:scrollX,y:scrollY})');
 const snapshot = async clip => (await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip})).data;
 try {
  const setup = await read(`battery.scrollIntoView({block:'center'});const image=getComputedStyle(charge).backgroundImage;const url=image.slice(5,-2);const dimensions=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve([img.naturalWidth,img.naturalHeight]);img.onerror=()=>reject(new Error('Charging GIF could not load'));img.src=url;});const clip=node=>{const r=node.getBoundingClientRect();return{x:Math.ceil(r.left+scrollX)+2,y:Math.ceil(r.top+scrollY)+2,width:Math.floor(r.width)-4,height:Math.floor(r.height)-4,scale:1};};return{url,dimensions,clip:clip(gauge),foreground:clip(fill),actual:fill.getBoundingClientRect().width,text:battery.textContent,background:getComputedStyle(fill).backgroundColor};`);
  assert(setup.url.endsWith('/images/'+asset),'Uses the shared GIF asset');
  assert.deepEqual(setup.dimensions,[width,height],'GIF matches native meter dimensions');
  await check('Ladeanzeige verwendet das gemeinsame GIF in Originalgröße ohne CSS-Animation ('+width+' px)',`(()=>{const battery=document.querySelector(${JSON.stringify(selector)}),charge=battery.querySelector('[class$="battery-charge"]'),style=getComputedStyle(charge);return style.display==='block'&&style.backgroundSize==='auto'&&style.backgroundPosition==='0% 0%'&&charge.getAnimations().length===0&&charge.getBoundingClientRect().width===${width};})()`);
  const frames=[],foreground=[];
  for(let index=0;index<5;index++) {
   frames.push(await snapshot(setup.clip));foreground.push(await snapshot(setup.foreground));
   if(index<4)await delay(650);
  }
  assert(new Set(frames).size>1,'The actual GIF changes the visible background');
  assert.equal(new Set(foreground).size,1,'Real foreground pixels remain unchanged throughout playback');
  assert(await read(`return fill.getBoundingClientRect().width===${setup.actual}&&battery.textContent===${JSON.stringify(setup.text)}&&getComputedStyle(fill).backgroundColor===${JSON.stringify(setup.background)};`));
  await check('GIF bewegt den Hintergrund bei unverändertem echtem Ladestand, Prozentwert und Warnfarbe ('+width+' px)','true');
  // Different actual levels must cover one shared 0–100% animation, rather than stretch its visible remainder.
  const comparison = await read(`const host=document.createElement('div');host.id='battery-gif-comparison';host.className=battery.closest('.page-devices')?'page-devices':'leitstand';host.style.cssText='position:fixed;left:40px;top:100px;z-index:2147483647;display:flex;gap:24px;padding:10px;width:400px;min-height:0;background:white';for(const level of [.2,.8]){const copy=battery.cloneNode(true);copy.querySelector('[class$="battery-fill"]').style.width=${width}*level+'px';copy.querySelectorAll('.devices-battery-value,.ls-tablet-percent').forEach(node=>node.textContent=Math.round(level*100)+'%');host.append(copy);}document.body.append(host);const bounds=host.getBoundingClientRect();return{clip:{x:bounds.left+scrollX,y:bounds.top+scrollY,width:bounds.width,height:bounds.height,scale:1},positions:[...host.querySelectorAll('[class$="battery-gauge"]')].map(node=>{const r=node.getBoundingClientRect();return{x:Math.round(r.left-bounds.left)+1,y:Math.round(r.top-bounds.top)+2};})};`);
  try {
   let hidden=false,lowFirst=false,bothAtSameFront=false;
   for(let index=0;index<16;index++) {
    const pixels=await snapshot(comparison.clip);
    const fronts=await c.evaluate(`(async()=>{const image=new Image();image.src='data:image/png;base64,${pixels}';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const context=canvas.getContext('2d');context.drawImage(image,0,0);return ${JSON.stringify(comparison.positions)}.map(position=>{const data=context.getImageData(position.x,position.y,${width},1).data;let end=-1;for(let x=0;x<${width};x++){const offset=x*4;if(data[offset]===185&&data[offset+1]===223&&data[offset+2]===199)end=x;}return end;});})()`);
    hidden ||= fronts[0]<0&&fronts[1]<0;
    lowFirst ||= fronts[0]>=0&&fronts[1]<0;
    bothAtSameFront ||= fronts[1]>=0&&Math.abs(fronts[0]-fronts[1])<=1;
    if(hidden&&lowFirst&&bothAtSameFront)break;
    await delay(160);
   }
   assert(hidden&&lowFirst&&bothAtSameFront,'20% and 80% foregrounds reveal the same unscaled GIF at different times, then share its front');
   await check('20 und 80 Prozent verdecken dasselbe GIF unterschiedlich lange, ohne Skalierung nach Ladestand ('+width+' px)','true');
  } finally {await c.evaluate('document.querySelector("#battery-gif-comparison")?.remove()');}
  await c.call('Network.setBlockedURLs',{urls:['*battery-gif-test-failure*']});
  const failure = setup.url+'?battery-gif-test-failure=1';
  const failed = await read(`charge.style.backgroundImage='url('+JSON.stringify(${JSON.stringify(failure)})+')';return new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(false);image.onerror=()=>resolve(true);image.src=${JSON.stringify(failure)};});`);
  assert(failed,'The fallback test must actually fail to load its GIF');
  // The explicit Image request and the CSS background have separate load
  // lifecycles. Let the failed background reach paint before comparing pixels.
  await read('await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);');
  const fallbackClip = await read(`const r=gauge.getBoundingClientRect();return{x:Math.ceil(r.left+scrollX)+2,y:Math.ceil(r.top+scrollY)+2,width:Math.floor(r.width)-4,height:Math.floor(r.height)-4,scale:1};`);
  const fallback = await snapshot(fallbackClip);
  await read('charge.style.display="none";');
  const staticBattery = await snapshot(fallbackClip);
  if(fallback!==staticBattery) {
   const pixels=await c.evaluate(`(async()=>{const images=await Promise.all(${JSON.stringify([fallback,staticBattery])}.map(async data=>{const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();return image}));const canvas=document.createElement('canvas');canvas.width=images[0].width;canvas.height=images[0].height;const ctx=canvas.getContext('2d'),data=images.map(image=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);return ctx.getImageData(0,0,canvas.width,canvas.height).data});const differences=[];for(let i=0;i<data[0].length;i+=4)if([0,1,2,3].some(n=>data[0][i+n]!==data[1][i+n]))differences.push({x:(i/4)%canvas.width,y:Math.floor(i/4/canvas.width),before:[...data[0].slice(i,i+4)],after:[...data[1].slice(i,i+4)]});return{count:differences.length,examples:differences.slice(0,10)}})()`);
   // Compositing the transparent layer can round an edge channel by 1–2/255.
   // Permit at most two such pixels, never a visible residual charging area.
   assert(pixels.count<=2&&pixels.examples.every(pixel=>pixel.before.every((value,i)=>Math.abs(value-pixel.after[i])<=2)),'A failed GIF renders like the static battery: '+JSON.stringify(pixels));
  }
  assert(await read(`return fill.getBoundingClientRect().width===${setup.actual}&&battery.textContent===${JSON.stringify(setup.text)}&&getComputedStyle(fill).backgroundColor===${JSON.stringify(setup.background)}&&[...battery.querySelectorAll('[class$="-charging"]')].some(node=>!node.hidden&&node.getClientRects().length);`));
  await check('Blockiertes GIF fällt sichtbar auf den echten Akkustand mit Prozentzahl und Ladeblitz zurück ('+width+' px)','true');
 } finally {
  await read('charge.style.removeProperty("background-image");charge.style.removeProperty("display");');
  await c.call('Network.setBlockedURLs',{urls:[]});
  await c.evaluate('scrollTo('+scroll.x+','+scroll.y+')');
 }
};
