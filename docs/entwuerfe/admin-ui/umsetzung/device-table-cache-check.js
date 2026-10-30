'use strict';
/* eslint-disable quotes -- Browser expressions contain quoted selectors. */
module.exports=async function({c,open,check}) {
 await open(1424,940);
 await c.evaluate(`crouting.navigate_to('t/:key/edit',{key:'preview'})`);
 await check('Device settings mount the table used by incremental updates',`!!document.querySelector('.display_tbody [data-display_id="21"]')`);
 await c.evaluate(`window.__deviceCache={body:document.querySelector('.display_tbody'),row:document.querySelector('[data-display_id="21"]')};curt.displays.find(display=>display.client_id==='21').wait_for_done=true;ctournament.update_display(curt.displays.find(display=>display.client_id==='21'),{tablets:false})`);
 await check('A mounted device table still receives acknowledgement state',`__deviceCache.row.classList.contains('wait_for_done')`);
 await c.evaluate(`crouting.navigate_to('t/:key/',{key:'preview'})`);
 await check('Leaving device settings detaches the cached table',`!__deviceCache.body.isConnected&&!!document.querySelector('.leitstand')`);
 const idle=await c.evaluate(`(()=>{const query=document.querySelectorAll,qa=__deviceCache;let searches=0;document.querySelectorAll=function(selector,...args){if(selector==='.display_tbody')searches++;return query.call(this,selector,...args)};try{const display=curt.displays.find(display=>display.client_id==='21');display.wait_for_done=false;for(let i=0;i<1000;i++)ctournament.update_display(display,{tablets:false});return{searches,oldUnchanged:qa.row.classList.contains('wait_for_done')}}finally{document.querySelectorAll=query}})()`);
 await check('Device traffic neither searches for an absent table nor changes its detached rows',`${idle.searches===0&&idle.oldUnchanged}`);
 await c.evaluate(`crouting.navigate_to('t/:key/edit',{key:'preview'})`);
 await check('Reopening settings replaces the old table reference',`document.querySelector('.display_tbody')!==__deviceCache.body`);
 await c.evaluate(`(()=>{const display=curt.displays.find(display=>display.client_id==='21');display.wait_for_done=true;ctournament.update_display(display,{tablets:false});crouting.on_change({type:'change',ctype:'display_status_changed',tournament_key:'preview',val:{display_court_displaysetting:{client_id:'99',hostname:'Neues Tablet',online:true}}})})()`);
 await check('Existing and newly connected devices update the newly mounted table',`document.querySelector('.display_tbody [data-display_id="21"]').classList.contains('wait_for_done')&&document.querySelector('.display_tbody [data-display_id="99"]').textContent.includes('Neues Tablet')&&!__deviceCache.body.querySelector('[data-display_id="99"]')`);
};
