'use strict';
const assert=require('assert');
module.exports=async function({c,open,check,metrics}) {
 await open(1366,768);
 await c.evaluate(`localStorage.setItem('bts-admin-density-v2','compact');localStorage.setItem('bts-admin-card-layout-v1',JSON.stringify({top:['operators','announcement'],sidebar:['automation','rotation','tablets','logs','device']}))`);
 await open(1366,768);
 for(const width of [1366,1280,1600,1601]) {
  await metrics(width,768);
  await check('Name layout settles at '+width,`!cleitstand.isUpdating()`);
  const result=await c.evaluate(`(async()=>{
   const teams=[...document.querySelectorAll('.team-one,.team-two')].filter(node=>node.querySelectorAll('.player').length===2&&node.getClientRects().length);
   const snapshot=()=>teams.map(node=>[node.classList.contains('ls-team-stacked'),node.closest('tr').getBoundingClientRect().height,[...node.querySelectorAll('.player')].map(player=>player.firstChild.nodeValue)]);
   for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);
   const baseline=snapshot(),initial=JSON.stringify(baseline);let changes=0;const differences=[];
   for(let frame=0;frame<120;frame++){
    if(frame%15===0)window.dispatchEvent(new Event('resize'));
    await new Promise(requestAnimationFrame);
    if(JSON.stringify(snapshot())!==initial){changes++;if(differences.length<3)differences.push({frame,teams:snapshot().map((value,index)=>JSON.stringify(value)!==JSON.stringify(baseline[index])?{index,before:baseline[index],after:value}:null).filter(Boolean)});}
   }
   return {differences,teams:teams.length,changes,zoom:parseFloat(getComputedStyle(document.body).zoom)||1,shortened:teams.some(node=>[...node.querySelectorAll('.player')].some(player=>player.firstChild.nodeValue.includes('.')))};
  })()`);
  assert(result.teams>0,'Exercise doubles teams');
  assert.equal(result.changes,0,'Names and row heights stay stable at '+width+': '+JSON.stringify(result.differences));
  assert.equal(result.zoom,width<=1600?.8:1,'Compact scaling boundary');
  if(width===1280)assert(result.shortened,'Abbreviation remains active');
  console.log('OK Stable doubles and names over 120 frames at '+width+'px');
  await check('No horizontal game scrollbar at '+width,`[...document.querySelectorAll('.table-wrap')].filter(node=>node.getClientRects().length).every(node=>node.scrollWidth<=node.clientWidth+1)`);
 }
};
