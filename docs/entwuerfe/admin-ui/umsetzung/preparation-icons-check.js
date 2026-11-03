'use strict';
/* eslint no-console: off */
const fs = require('fs'), path = require('path');

module.exports = async function({c,open,metrics,key,capture,check,previews}) {
 const checks=[];
 const verify=async(name,expression)=>{try{await check(name,expression);checks.push(name);}catch(error){console.error(JSON.stringify(await c.evaluate('__prepIconButtons(\'CH\').map(node=>({html:node.outerHTML}))')));throw error;}};
 await open(1920,1080);
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await c.evaluate(String.raw`(()=>{
  window.__prepIconDocument=document;window.__prepIconService=btsSpeechService;
  window.__prepIconCancels=0;btsSpeechService.cancel=()=>__prepIconCancels++;
  window.__prepIconEmit=(ctype,val)=>crouting.on_change({tournament_key:curt.key,ctype,val});
  window.__prepIconButtons=id=>[...document.querySelectorAll('.match_preparation_call_button')].filter(node=>node.dataset.location_id===id);
  window.__prepIconButton=__prepIconButtons('CH')[0];
  for(const button of document.querySelectorAll('.match_preparation_call_button'))btsSpeechReadiness.trackText(button,()=>['Testaufruf'],false,{remote:true});
  btsSpeechReadiness.refresh(true);
  window.__prepIconUnchanged=[...document.querySelectorAll('.match_table .player,.match_table .timer'),...__prepIconButtons('SN').flatMap(node=>[node,...node.children])];
  window.__prepIconSaves=[];const original=send;
  window.send=(message,callback)=>{
   if(message.type==='match_preparation_call'){__prepIconSaves.push(structuredClone(message));callback?.(null,{});return;}
   if(message.type==='tournament_get')return setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0);
   original(message,callback);
  };
 })()`);
 await verify('Without hall images every preparation call displays one microphone and its hall initials', String.raw`[...document.querySelectorAll('.match_preparation_call_button')].length>0&&[...document.querySelectorAll('.match_preparation_call_button')].every(node=>node.querySelectorAll('.ico').length===1&&node.querySelectorAll('.ls-call-location').length===1&&node.querySelector('.ls-call-location').textContent===node.dataset.location_id&&!node.querySelector('img'))`);
 await c.evaluate(String.raw`__prepIconButton.focus();__prepIconEmit('location_logo_changed',{location_id:'CH',logo_id:'fixture-court.svg',logo_name:'court.svg'});`);
 await verify('A live hall image replaces both microphone and initials on existing call controls', String.raw`__prepIconButtons('CH').every(node=>node.querySelectorAll('.ls-preparation-custom-icon').length===1&&node.querySelector('img').getAttribute('src')==='/h/preview/logo/fixture-court.svg'&&!node.querySelector('.ico,.ls-call-location'))&&__prepIconButton.isConnected&&document.activeElement===__prepIconButton&&__prepIconUnchanged.every(node=>node.isConnected)`);
 await verify('Custom call controls retain their full hall name, keyboard access and announcement readiness status', String.raw`__prepIconButtons('CH').every(node=>node.getAttribute('aria-label').includes('Campus Hellweg')&&node.getAttribute('role')==='button'&&node.tabIndex===0&&node.dataset.speechState)`);
 await c.evaluate(String.raw`window.__prepIconNodes=__prepIconButtons('CH').flatMap(node=>[node,...node.children]);window.__prepIconMutations=[];window.__prepIconObserver=new MutationObserver(records=>__prepIconMutations.push(...records));__prepIconButtons('CH').forEach(node=>__prepIconObserver.observe(node,{subtree:true,childList:true,attributes:true,characterData:true}));__prepIconEmit('location_logo_changed',{location_id:'CH',logo_id:'fixture-court.svg',logo_name:'court.svg'});cmatch.refresh_unassigned_preparation_context();`);
 await verify('Identical logo updates and preparation refreshes preserve the image nodes with zero control mutations', String.raw`__prepIconMutations.length===0&&__prepIconNodes.every(node=>node.isConnected)&&document.activeElement===__prepIconButton`);
 await c.evaluate(String.raw`__prepIconObserver.disconnect();__prepIconButton.scrollIntoView({block:'center'});`);
 const point=await c.evaluate(String.raw`(()=>{const box=__prepIconButton.querySelector('img').getBoundingClientRect();return{x:box.x+box.width/2,y:box.y+box.height/2}})()`);
 for(const type of ['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
 await verify('Clicking directly on a custom image still calls the correct game into preparation at its hall', String.raw`__prepIconSaves.length===1&&__prepIconSaves[0].type==='match_preparation_call'&&__prepIconSaves[0].match._id===__prepIconButton.dataset.match_id&&__prepIconSaves[0].location_id==='CH'&&__prepIconSaves[0].tournament_key==='preview'`);
 await c.evaluate('__prepIconButton.focus()');
 await key('Enter','Enter',13,'\r');
 await verify('The same custom preparation control remains usable with Enter', String.raw`__prepIconSaves.length===2&&__prepIconSaves[1].location_id==='CH'&&__prepIconSaves[1].match._id===__prepIconButton.dataset.match_id`);
 for(const width of [1920,1280,950,390,320]) {
  await metrics(width,1000);
  for(const density of ['normal','comfort','compact']) {
   await c.evaluate(`for(let i=0;i<3&&document.querySelector('.page-leitstand').dataset.density!==${JSON.stringify(density)};i++)document.querySelector('[data-action="density"]').click()`);
   await verify('Custom preparation images fit their click targets with speech status in the upper right at '+width+' in '+density, String.raw`(()=>{const buttons=__prepIconButtons('CH').filter(node=>node.getBoundingClientRect().width);return buttons.length>0&&buttons.every(node=>{const image=node.querySelector('img').getBoundingClientRect(),button=node.getBoundingClientRect(),row=node.closest('tr').getBoundingClientRect();const status=getComputedStyle(node,'::after'),statusWidth=parseFloat(status.width)+(status.boxSizing==='border-box'?0:parseFloat(status.borderLeftWidth)+parseFloat(status.borderRightWidth)),statusLeft=parseFloat(status.left);return (!Number.isFinite(statusLeft)||Math.abs(statusLeft+statusWidth-node.clientWidth)<.25)&&parseFloat(status.right)===0&&parseFloat(status.top)===0&&status.transform==='none'&&image.width===24&&image.height===18&&image.left>=button.left-.2&&image.right<=button.right+.2&&image.top>=button.top-.2&&image.bottom<=button.bottom+.2&&image.top>=row.top-.2&&image.bottom<=row.bottom+.2;})&&document.documentElement.scrollWidth<=innerWidth+1})()`);
  }
 }
 await verify('Hall images and the other call controls remain separated within the shared preparation area', String.raw`[...document.querySelectorAll('.unassigned_container tr[data-match_id]')].every(row=>{const cell=row.querySelector('td.call_td'),score=row.querySelector('td.score');if(!cell||!score)return true;const right=cell.getBoundingClientRect().right,left=score.getBoundingClientRect().left,boxes=[...cell.querySelectorAll('.match_preparation_call_button,.preparation_debug_icon')].map(node=>node.getBoundingClientRect()).filter(box=>box.width);return boxes.every((box,index)=>box.left>=left-.2&&box.right<=right+.2&&boxes.slice(index+1).every(other=>box.right<=other.left+.2||box.left>=other.right-.2));})`);
 await metrics(1440,1000);
 await c.evaluate(String.raw`for(let i=0;i<3&&document.querySelector('.page-leitstand').dataset.density!=='normal';i++)document.querySelector('[data-action=density]').click();__prepIconButton.scrollIntoView({block:'center'});`);
 await capture('vorbereitungsaufruf-hallenicon',false,{preserveScroll:true});
 await c.evaluate(String.raw`delete curt.locations.find(location=>location._id==='CH').short_name;__prepIconEmit('location_logo_changed',{location_id:'CH',logo_id:null,logo_name:null});`);
 await verify('Clearing a hall image immediately restores the microphone and initials derived from the hall name', String.raw`__prepIconButtons('CH').every(node=>!node.querySelector('img')&&node.querySelector('.ico')&&node.querySelector('.ls-call-location').textContent==='CH')&&__prepIconButton.isConnected&&__prepIconUnchanged.every(node=>node.isConnected)`);
 await c.evaluate(String.raw`__prepIconButton.querySelector('.ico rect').dispatchEvent(new MouseEvent('click',{bubbles:true}));`);
 await verify('Clicking a nested microphone SVG also preserves the correct hall and game', String.raw`__prepIconSaves.length===3&&__prepIconSaves[2].location_id==='CH'&&__prepIconSaves[2].match._id===__prepIconButton.dataset.match_id`);
 await c.evaluate(String.raw`document.querySelector('.leitstand-nav a[href$="/edit"]').click();`);
 await verify('Settings open in the same document with the existing audio service', String.raw`document.querySelector('.page-settings')&&document===__prepIconDocument&&btsSpeechService===__prepIconService&&__prepIconCancels===0`);
 await c.evaluate(String.raw`document.querySelector('.settings-area-link[href$="/edit/locations"]').click();window.__prepIconPreview=()=>document.querySelector('.settings-location-card[data-location-id=CH] .settings-location-symbol');`);
 await verify('The settings preview uses the same microphone and initials as the real preparation control', String.raw`__prepIconPreview().querySelector('.ico')&&__prepIconPreview().querySelector('.ls-call-location').textContent==='CH'&&!__prepIconPreview().querySelector('img')&&__prepIconPreview().getAttribute('aria-label').includes('Campus Hellweg')`);
 await verify('Fallback preview initials sit next to the microphone at the same baseline as the real control', String.raw`(()=>{const symbol=__prepIconPreview(),icon=symbol.querySelector('.ico').getBoundingClientRect(),initials=symbol.querySelector('.ls-call-location').getBoundingClientRect();return icon.width===36&&icon.height===36&&symbol.getBoundingClientRect().height===40&&Math.abs(icon.bottom-initials.bottom)<4&&initials.left>=icon.left&&initials.left<=icon.right+2;})()`);
 await c.evaluate(String.raw`__prepIconEmit('location_logo_changed',{location_id:'CH',logo_id:'fixture-court.svg',logo_name:'court.svg'});`);
 await verify('The selected hall image replaces the complete standard symbol in the settings preview', String.raw`__prepIconPreview().querySelectorAll('img').length===1&&__prepIconPreview().querySelector('img').getAttribute('src')==='/h/preview/logo/fixture-court.svg'&&!__prepIconPreview().querySelector('.ico,.ls-call-location')&&document.querySelector('.settings-location-card[data-location-id=CH] .upload_filename_location').textContent==='court.svg'`);
 await c.evaluate('document.activeElement.blur()');
 await capture('einstellungen-spielort-hallenicon');
 await metrics(390,844);
 await verify('The selected icon preview fits a narrow settings page', String.raw`document.documentElement.scrollWidth<=innerWidth+1&&__prepIconPreview().querySelector('img').getBoundingClientRect().width===36&&__prepIconPreview().getBoundingClientRect().height===40&&[...document.querySelectorAll('.settings-location-symbol')].every(symbol=>{const icon=symbol.querySelector('img,.ico').getBoundingClientRect();return icon.width===36&&icon.height===36&&symbol.getBoundingClientRect().width===60&&symbol.getBoundingClientRect().height===40;})`);
 await capture('einstellungen-spielort-hallenicon-mobil');
 await metrics(1920,1080);
 await c.evaluate(String.raw`__prepIconEmit('location_logo_changed',{location_id:'CH',logo_id:null,logo_name:null});`);
 await verify('Resetting the logo also restores the settings fallback without restarting audio or navigation', String.raw`!__prepIconPreview().querySelector('img')&&__prepIconPreview().querySelector('.ls-call-location').textContent==='CH'&&document===__prepIconDocument&&btsSpeechService===__prepIconService&&__prepIconCancels===0`);
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 await verify('Preparation icon changes produce no browser exceptions',String(exceptions.length===0));
 fs.writeFileSync(path.join(previews,'preparation-icons-verification.json'),JSON.stringify({date:new Date().toISOString().slice(0,10),checks,exceptions:exceptions.length},null,2)+'\n');
};
