'use strict';
const assert=require('assert');
module.exports=async function({c,open,check,metrics}) {
 await open(1366,768);
 await c.evaluate(`localStorage.setItem('bts-admin-card-layout-v1',JSON.stringify({top:['operators','announcement'],sidebar:['automation','rotation','tablets','logs','device']}))`);
 await open(1366,768);
 for(const density of ['normal','compact','comfort']) {
  await c.evaluate(`for(let i=0;i<3&&document.querySelector('.leitstand').dataset.density!==${JSON.stringify(density)};i++)document.querySelector('[data-action="density"]').click()`);
  for(const enabled of [true,false]) {
   await c.evaluate(`curt.preparation_call_debug_icons_enabled=${enabled};cmatch.refresh_unassigned_preparation_context()`);
   await check('Preparation icons toggle '+density+' '+enabled,`[...document.querySelectorAll('.ls-planned-table tr[data-match_id]')].filter(row=>row.getClientRects().length).every(row=>!!row.querySelector('.preparation_debug_icon')===${enabled})`);
   await c.evaluate(`(()=>{const groups=[...document.querySelectorAll('.ls-preparation-calls')].filter(node=>node.children.length&&node.getClientRects().length);if(groups.length<2)throw new Error('Need preparation call groups');while(groups[0].children.length<6)groups[0].append(groups[0].firstElementChild.cloneNode(true));while(groups[1].children.length>1)groups[1].lastElementChild.remove();window.dispatchEvent(new Event('resize'))})()`);
   for(const width of [1920,1366,1280,1240,1200,1150,1100,1024]) {
    await metrics(width,768);
    const label=density+', info '+enabled+', '+width+'px';
    await check('No horizontal table scrolling: '+label,`[...document.querySelectorAll('.table-wrap')].filter(node=>node.getClientRects().length).every(node=>node.scrollWidth<=node.clientWidth+1)`);
    await check('Preparation calls and info align without overlap: '+label,`(()=>{
     const scale=parseFloat(getComputedStyle(document.body).zoom)||1;
     const cells=[...document.querySelectorAll('.ls-planned-table td.call_td')].filter(node=>node.getClientRects().length);
     return cells.length>0&&cells.every(cell=>{const r=cell.getBoundingClientRect(),calls=cell.querySelector('.ls-preparation-calls'),info=cell.querySelector('.preparation_debug_icon');
      if(!calls?.children.length)return !info||Math.abs(r.right-info.getBoundingClientRect().right-8*scale)<1;
      const c=calls.getBoundingClientRect();
      if(!info)return Math.abs(r.right-c.right-8*scale)<1;
      const i=info.getBoundingClientRect();
      return Math.abs(r.right-i.right-8*scale)<1&&c.right<=i.left+1&&Math.abs(c.top-i.top)<=3*scale&&i.top>=r.top-1&&i.bottom<=r.bottom+1;
     });
    })()`);
   }
  }
 }
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No browser exceptions');
};
