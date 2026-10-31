'use strict';
const fs=require('fs'),path=require('path');
module.exports=async function({c,check,click,open,metrics,previews,capture}) {
 const checks=[],samples=[],verify=async(name,expression)=>{await check(name,expression);checks.push(name);};
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const selectors=['tr[data-match_id="match-41"] .match_timer .timer','tr[data-match_id="match-45"] .match_timer .timer','tr[data-match_id="match-48"] .player .timer'];
  const qa=window.__clockInkQA={};
  // Independent copies keep native clock ticks from overwriting test values.
  qa.clocks=selectors.map(selector=>{const live=document.querySelector(selector),copy=live.cloneNode(true);live.replaceWith(copy);cleitstand.timerDisplay(copy,'0:23');return copy;});
  qa.rows=qa.clocks.map(node=>node.closest('tr'));qa.names=qa.rows.flatMap(row=>[...row.querySelectorAll('.player')]);qa.parts=qa.clocks.map(node=>[...node.querySelectorAll('.ico,.timer-value,.timer-sign,.timer-digits')]);
  qa.same=()=>qa.rows.every(row=>row.isConnected)&&qa.names.every(node=>node.isConnected)&&qa.parts.every((parts,index)=>parts.every(node=>qa.clocks[index].contains(node)));
  qa.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  qa.geometry=()=>qa.clocks.map(node=>{
   const box=node.getBoundingClientRect(),digits=node.querySelector('.timer-digits'),ink=digits.getBoundingClientRect(),style=getComputedStyle(node),bounds=node.closest('tr').getBoundingClientRect();
   const range=document.createRange();range.selectNodeContents(digits);const text=range.getBoundingClientRect();
   return{value:node.getAttribute('aria-label'),height:box.height,width:box.width,rowHeight:bounds.height,inkHeight:ink.height,top:ink.top-box.top-parseFloat(style.borderTopWidth),bottom:box.bottom-ink.bottom-parseFloat(style.borderBottomWidth),fits:text.left>=box.left-.15&&text.right<=box.right+.15,font:getComputedStyle(digits).fontSize,transform:getComputedStyle(digits).transform};
  });
 })()`);
 await verify('Clock fixtures cover field, preparation and player pause timers','__clockInkQA.clocks.length===3&&__clockInkQA.same()');
 await click('.board-toolbar-actions [data-action="density"]');await click('.board-toolbar-actions [data-action="density"]');
 for(const width of [1920,1536,390]) {
  await metrics(width,width===390?844:1080);
  await verify('Compact clocks settle after resizing to '+width,'__clockInkQA.same()');
  const baseline=await c.evaluate('__clockInkQA.geometry()'),values=[];
  for(const value of ['0:23','-0:23','10:23','-10:23','1:01:55','-1:01:55','-20:06:25']) {
   await c.evaluate(`__clockInkQA.clocks.forEach(node=>cleitstand.timerDisplay(node,${JSON.stringify(value)}));__clockInkQA.frames()`);
   values.push(...(await c.evaluate('__clockInkQA.geometry()')).map((sample,index)=>({...sample,index,expectedWidth:baseline[index].width,expectedHeight:baseline[index].height,expectedRowHeight:baseline[index].rowHeight})));
  }
  samples.push({width,values});console.log(JSON.stringify({width,samples:values.length,top:[Math.min(...values.map(value=>value.top)),Math.max(...values.map(value=>value.top))],bottom:[Math.min(...values.map(value=>value.bottom)),Math.max(...values.map(value=>value.bottom))]}));
  await verify('Short, negative and hour values leave 1px above and below the digits at '+width,String(values.every(value=>Math.abs(value.top-1)<.15&&Math.abs(value.bottom-1)<.15)));
  await verify('Long values fit while clock widths, heights and rows stay fixed at '+width,String(values.every(value=>value.fits&&Math.abs(value.width-value.expectedWidth)<.15&&Math.abs(value.height-value.expectedHeight)<.15&&Math.abs(value.rowHeight-value.expectedRowHeight)<.15)));
 }
 await metrics(1920,1080);await verify('Clock fitting preserves every existing game and player','__clockInkQA.same()');
 await c.evaluate(`__clockInkQA.clocks.forEach(node=>cleitstand.timerDisplay(node,'-1:01:55'));__clockInkQA.frames()`);
 await capture('kompakt-uhren');
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');await verify('Compact timer fitting produces no browser exceptions',String(exceptions.length===0));
 fs.writeFileSync(path.join(previews,'compact-timer-verification.json'),JSON.stringify({date:'2026-10-31',checks,exceptions:exceptions.length,samples},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
