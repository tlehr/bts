'use strict';
const defaults = require('../../../../bts/displaysettings_defaults');

module.exports = async function({c, verify, capture}) {
 await c.evaluate(String.raw`(()=>{
  window.__durationDialogCommands=[];window.__durationDialogReplies=[];
  window.__durationDialogArrowsFit=node=>{const input=node.getBoundingClientRect(),arrows=node.nextElementSibling.getBoundingClientRect();return node.nextElementSibling.children.length===2&&[...node.nextElementSibling.children].every(button=>button.type==='button')&&arrows.left>input.left&&arrows.right<=input.right&&arrows.top>=input.top&&arrows.bottom<=input.bottom&&arrows.height>=input.height-3&&parseFloat(getComputedStyle(node).paddingRight)>=arrows.width+4;};
  const original=send;window.send=(message,callback)=>{
   if(['tournament_edit_scoring_format','edit_display_setting'].includes(message.type)){__durationDialogCommands.push(structuredClone(message));__durationDialogReplies.push(callback);return;}
   if(message.type==='tournament_get')return setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0);
   original(message,callback);
  };
  const points={end_points:21,max_points:30,interval_enabled:true,interval_at:11,interval_duration_ms:60000,break_before_set_duration_ms:120000};
  curt.scoring_formats={default_id:9001,formats:[{id:9001,name:'Testformat Zeitfelder',numSets:3,set_points:{...points},last_set_points:{...points}}]};
  ctournament.update_scoring_formats();document.querySelector('.settings-area-link[href$="/edit/scoring"]').click();
  document.querySelector('[data-scoring-format-id="9001"]').click();
 })()`);
 await verify('Both normal and deciding-set pauses use the shared duration input with contained arrows in the scoring dialog', String.raw`document.querySelectorAll('.scoring_format_edit_dialog .duration-input').length===4&&document.querySelector('.scoring_format_edit_dialog [name="set_points_interval_duration_s"]').value==='1:00'&&document.querySelector('.scoring_format_edit_dialog [name="last_set_points_break_before_set_duration_s"]').value==='2:00'&&[...document.querySelectorAll('.scoring_format_edit_dialog .duration-input')].every(node=>node.parentElement.querySelector('.duration-input-unit').textContent==='Minuten'&&__durationDialogArrowsFit(node))`);
 await c.evaluate('document.querySelector(".scoring_format_edit_dialog .duration-input").scrollIntoView({block:"center"})');
 const arrow=await c.evaluate('(()=>{const bounds=document.querySelector(".scoring_format_edit_dialog .duration-input-increase").getBoundingClientRect();return{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};})()');
 await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',...arrow});
 await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...arrow,button:'left',buttons:1,clickCount:1});
 await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...arrow,button:'left',buttons:0,clickCount:1});
 await verify('A duration arrow edits the scoring pause without submitting or closing the dialog', String.raw`document.querySelector('.scoring_format_edit_dialog [name="set_points_interval_duration_s"]').value==='2:00'&&__durationDialogCommands.length===0&&document.querySelector('.scoring_format_edit_dialog')`);
 await c.evaluate(String.raw`(()=>{const form=document.querySelector('.scoring_format_edit_dialog form');form.querySelector('[name="set_points_interval_duration_s"]').value='1:05';form.querySelector('[name="set_points_break_before_set_duration_s"]').value='2:30';form.requestSubmit();})()`);
 await verify('Saving a scoring format converts the common input back into milliseconds', String.raw`__durationDialogCommands.at(-1)?.type==='tournament_edit_scoring_format'&&__durationDialogCommands.at(-1).scoring_format.set_points.interval_duration_ms===65000&&__durationDialogCommands.at(-1).scoring_format.set_points.break_before_set_duration_ms===150000&&__durationDialogCommands.at(-1).scoring_format.last_set_points.interval_duration_ms===60000`);
 await capture('einstellungen-zeitfelder-punktsystem');
 await c.evaluate('__durationDialogReplies.shift()(null,{})');
 const profile = {...defaults.build_default_tablet_setting({key:'preview'}), id:'duration-tablet', description:'Testprofil Zeitfelder', button_block_timeout:'100'};
 await c.evaluate(`curt.displaysettings.push(${JSON.stringify(profile)});crouting.navigate_to('t/preview/edit/s/duration-tablet')`);
 await c.evaluate('(async()=>{for(let i=0;i<100;i++){if(document.querySelector(\'.display_setting_edit_dialog\'))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(\'Display settings did not open\');})()');
 await verify('Tablet and network timings show minutes:seconds with contained arrows and their existing millisecond values', String.raw`document.querySelectorAll('.display_setting_edit_dialog .duration-input').length===3&&document.querySelector('.display_setting_edit_dialog [name="button_block_timeout"]').value==='0:00,1'&&document.querySelector('.display_setting_edit_dialog [name="network_timeout"]').value==='0:10'&&document.querySelector('.display_setting_edit_dialog [name="network_update_interval"]').value==='0:10'&&[...document.querySelectorAll('.display_setting_edit_dialog .duration-input')].every(__durationDialogArrowsFit)`);
 await c.evaluate('document.querySelector(\'.display_setting_edit_dialog [name="network_timeout"]\').scrollIntoView({block:"center"})');
 await capture('einstellungen-zeitfelder-geraete',false,{preserveScroll:true});
 await c.evaluate(String.raw`(()=>{const form=document.querySelector('.display_setting_edit_dialog form');for(const [name,value]of [['button_block_timeout','0:00,25'],['network_timeout','1:05'],['network_update_interval','0:05']]){const input=form.querySelector('[name="'+name+'"]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}form.requestSubmit();})()`);
 await verify('Saving device settings converts fractional and full durations into the original millisecond fields', String.raw`__durationDialogCommands.at(-1)?.type==='edit_display_setting'&&__durationDialogCommands.at(-1).displaysetting.button_block_timeout==='250'&&__durationDialogCommands.at(-1).displaysetting.network_timeout==='65000'&&__durationDialogCommands.at(-1).displaysetting.network_update_interval==='5000'`);
 await c.evaluate('__durationDialogReplies.shift()(null,{})');
 await verify('The duration dialogs close normally and leave the settings workspace available', String.raw`!document.querySelector('.scoring_format_edit_dialog,.display_setting_edit_dialog')&&document.querySelector('.page-settings')&&current_view==='edit'`);
 await c.evaluate('document.querySelector(\'.settings-area-link[href$="/edit/officials"]\').click()');
 await capture('einstellungen-zeitfelder-dialoge');
};
