'use strict';
/* eslint no-console: off */

module.exports = async function({c, verify:check, key, capture}) {
 const verify=async(name,expression)=>{
  try{await check(name,expression);}
  catch(error){console.error(JSON.stringify(await c.evaluate('({active:document.activeElement?.outerHTML,fields:[...document.querySelectorAll(".settings-content .duration-input")].filter(node=>!node.closest("[hidden]")).map(node=>({name:node.name,value:node.value,start:node.selectionStart,end:node.selectionEnd,rect:node.getBoundingClientRect().toJSON()})),commands:window.__durationEditingCommands})')));throw error;}
 };
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await c.evaluate(String.raw`(()=>{
  window.__durationEditingCommands=[];window.__durationEditingFail=false;
  const original=send;window.__durationEditingSend=original;
  window.send=(message,callback)=>{
   if(message.type==='tournament_edit_prop') {
    __durationEditingCommands.push(structuredClone(message));
    if(__durationEditingFail){__durationEditingFail=false;setTimeout(()=>callback({message:'Synthetic duration editing error'}),0);return;}
   }
   original(message,callback);
  };
  window.__durationEditingField=name=>document.querySelector('.settings-content [name="'+name+'"]');
  window.__durationEditingPart=(node,name)=>{
   const colon=node.value.indexOf(':'),decimal=node.value.search(/[,.]/);
   return name==='minutes'?[0,colon]:name==='seconds'?[colon+1,decimal<0?node.value.length:decimal]:[decimal+1,node.value.length];
  };
  window.__durationEditingSelected=(name,part)=>{
   const node=__durationEditingField(name),[start,end]=__durationEditingPart(node,part);
   return document.activeElement===node&&node.selectionStart===start&&node.selectionEnd===end;
  };
  document.querySelector('.settings-area-link[href$="/edit/officials"]').click();
  const node=__durationEditingField('tabletoperator_break_seconds');
  curt.tabletoperator_break_seconds=330;node.btsDuration.write(330);document.activeElement.blur();
 })()`);
 const field='tabletoperator_break_seconds';
 const selected=part=>`__durationEditingSelected(${JSON.stringify(field)},${JSON.stringify(part)})`;
 const clickPart=async(name,part)=>{
  await c.evaluate(`__durationEditingField(${JSON.stringify(name)}).scrollIntoView({block:'center'})`);
  const point=await c.evaluate(`(()=>{
   const node=__durationEditingField(${JSON.stringify(name)}),style=getComputedStyle(node),bounds=node.getBoundingClientRect();
   const [start,end]=__durationEditingPart(node,${JSON.stringify(part)}),context=document.createElement('canvas').getContext('2d');
   context.font=style.font;const width=text=>context.measureText(text).width;
   return {x:bounds.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft)+(width(node.value.slice(0,start))+width(node.value.slice(0,end)))/2,y:bounds.top+bounds.height/2};
  })()`);
  await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
  await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
 };
 const type=async text=>{for(const character of text)await c.call('Input.insertText',{text:character});};
 const clickArrow=async(name,direction)=>{
  await c.evaluate(`__durationEditingField(${JSON.stringify(name)}).scrollIntoView({block:'center'})`);
  const point=await c.evaluate(`(()=>{const button=__durationEditingField(${JSON.stringify(name)}).nextElementSibling.querySelector('.duration-input-${direction}'),bounds=button.getBoundingClientRect();return{x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};})()`);
  await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
  await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
 };
 await verify('Every duration setting has two labelled mouse arrows without adding Tab stops', String.raw`[...document.querySelectorAll('.settings-content .duration-input')].length===15&&[...document.querySelectorAll('.settings-content .duration-input')].every(node=>node.nextElementSibling.classList.contains('duration-input-stepper')&&node.nextElementSibling.children.length===2&&[...node.nextElementSibling.children].every(button=>button.type==='button'&&button.tabIndex===-1&&button.getAttribute('aria-label')))`);
 await clickPart(field,'seconds');
 await verify('A real mouse click selects the whole seconds part even when the duration was unfocused', selected('seconds'));
 await type('42');
 await verify('Typing two digits replaces seconds without changing minutes or saving an unfinished edit', String.raw`__durationEditingField('tabletoperator_break_seconds').value==='5:42'&&__durationEditingCommands.length===0`);
 await key('Enter','Enter',13,'\r');
 await verify('Enter saves the duration in its original unit and retains the seconds highlight', `curt.tabletoperator_break_seconds===342&&__durationEditingCommands.at(-1).value===342&&${selected('seconds')}`);
 await clickPart(field,'minutes');
 await verify('Clicking minutes selects the complete minutes part', selected('minutes'));
 await type('12');
 await key('Enter','Enter',13,'\r');
 await verify('Multi-digit minute entry preserves the existing seconds', `__durationEditingField('tabletoperator_break_seconds').value==='12:42'&&curt.tabletoperator_break_seconds===762&&${selected('minutes')}`);
 await key('ArrowUp','ArrowUp',38);
 await verify('Arrow Up changes the selected minutes and preserves the selection through the save response', `curt.tabletoperator_break_seconds===822&&${selected('minutes')}`);
 await c.evaluate('window.__durationEditingBefore=__durationEditingCommands.length');
 await key('ArrowRight','ArrowRight',39);
 await verify('Arrow Right selects seconds without writing a setting', `${selected('seconds')}&&__durationEditingCommands.length===__durationEditingBefore`);
 await key('ArrowDown','ArrowDown',40);
 await key('ArrowDown','ArrowDown',40);
 await verify('Repeated Arrow Down edits the highlighted seconds after each completed save', `__durationEditingField('tabletoperator_break_seconds').value==='13:40'&&curt.tabletoperator_break_seconds===820&&${selected('seconds')}`);
 await key('ArrowLeft','ArrowLeft',37);
 await type('8:09');
 await key('Enter','Enter',13,'\r');
 await verify('Typing a colon advances to seconds without inserting a duplicate separator', `__durationEditingField('tabletoperator_break_seconds').value==='8:09'&&curt.tabletoperator_break_seconds===489&&${selected('seconds')}`);
 await c.evaluate('window.__durationEditingFail=true');
 await key('ArrowUp','ArrowUp',38);
 await verify('A failed save restores the previous duration with the same part still selected', `__durationEditingField('tabletoperator_break_seconds').value==='8:09'&&curt.tabletoperator_break_seconds===489&&${selected('seconds')}`);
 await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
 await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
 await verify('Ctrl+A can still select the entire duration for copying or replacement', String.raw`(()=>{const node=__durationEditingField('tabletoperator_break_seconds');return node.selectionStart===0&&node.selectionEnd===node.value.length;})()`);
 await type('6:30');
 await key('Enter','Enter',13,'\r');
 await verify('Typing a complete duration after Select All replaces it cleanly', `__durationEditingField('tabletoperator_break_seconds').value==='6:30'&&curt.tabletoperator_break_seconds===390&&${selected('seconds')}`);
 await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38,modifiers:8});
 await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38,modifiers:8});
 await verify('Shift+Arrow Up changes minutes even when seconds were selected', `curt.tabletoperator_break_seconds===450&&${selected('minutes')}`);
 await key('Tab','Tab',9);
 await verify('Tab leaves the duration control using normal form navigation', `document.activeElement!==__durationEditingField(${JSON.stringify(field)})`);
 await c.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
 await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
 await verify('Returning with Shift+Tab initially selects minutes', selected('minutes'));
 await c.evaluate(String.raw`document.activeElement.blur();document.querySelector('.settings-area-link[href$="/edit/calls"]').click();__durationEditingField('preparation_call_time_limit_before_scheduled_minutes').btsDuration.write(120.5)`);
 await clickPart('preparation_call_time_limit_before_scheduled_minutes','minutes');
 await type('125');
 await key('Enter','Enter',13,'\r');
 await verify('Minutes remain unrestricted by a two-digit clock mask and preserve fractional stored minutes', String.raw`__durationEditingField('preparation_call_time_limit_before_scheduled_minutes').value==='125:30'&&curt.preparation_call_time_limit_before_scheduled_minutes===125.5`);
 await c.evaluate(String.raw`document.activeElement.blur();document.querySelector('.settings-area-link[href$="/edit/speech"]').click();__durationEditingField('announcement_pause_time_ms').btsDuration.write(.125)`);
 await clickPart('announcement_pause_time_ms','fraction');
 await key('ArrowUp','ArrowUp',38);
 await verify('Fractional seconds can be selected and adjusted without losing millisecond precision', String.raw`__durationEditingSelected('announcement_pause_time_ms','fraction')&&__durationEditingField('announcement_pause_time_ms').value==='0:00,126'&&curt.announcement_pause_time_ms===.126`);
 await c.evaluate(String.raw`document.activeElement.blur();document.querySelector('.settings-area-link[href$="/edit/officials"]').click();__durationEditingField('tabletoperator_break_seconds').btsDuration.write(0);curt.tabletoperator_break_seconds=0`);
 await clickPart(field,'seconds');
 await key('ArrowDown','ArrowDown',40);
 await verify('Arrow editing respects the existing minimum instead of creating negative durations', `__durationEditingField('tabletoperator_break_seconds').value==='0:00'&&curt.tabletoperator_break_seconds===0&&${selected('seconds')}`);
 await c.evaluate(String.raw`__durationEditingField('tabletoperator_break_seconds').btsDuration.write(330);curt.tabletoperator_break_seconds=330`);
 await clickPart(field,'seconds');
 await verify('Clicking an already highlighted part keeps it selected with the shared petrol highlight', `${selected('seconds')}&&getComputedStyle(__durationEditingField(${JSON.stringify(field)}),'::selection').backgroundColor==='rgb(14, 90, 99)'`);
 await c.evaluate('window.__durationEditingBefore=__durationEditingCommands.length');
 await clickArrow(field,'increase');
 await clickArrow(field,'increase');
 await verify('Repeated mouse clicks increase the selected seconds without blurring the field or sending duplicate saves', `curt.tabletoperator_break_seconds===332&&__durationEditingCommands.length===__durationEditingBefore+2&&${selected('seconds')}`);
 await clickArrow(field,'decrease');
 await verify('The lower mouse arrow decreases seconds while keeping the same highlight', `curt.tabletoperator_break_seconds===331&&${selected('seconds')}`);
 await clickPart(field,'minutes');
 await clickArrow(field,'increase');
 await verify('The mouse arrows edit minutes when minutes are selected', `curt.tabletoperator_break_seconds===391&&${selected('minutes')}`);
 await verify('Both arrow hit areas lie inside the original duration input with reserved text space and no suffix overlap', String.raw`(()=>{const node=__durationEditingField('tabletoperator_break_seconds'),input=node.getBoundingClientRect(),arrows=node.nextElementSibling.getBoundingClientRect(),suffix=node.parentElement.querySelector('.settings-field-unit').getBoundingClientRect();return arrows.left>input.left&&arrows.right<=input.right&&arrows.top>=input.top&&arrows.bottom<=input.bottom&&arrows.height>=input.height-3&&suffix.left>=input.right&&parseFloat(getComputedStyle(node).paddingRight)>=arrows.width+4;})()`);
 await c.evaluate(String.raw`__durationEditingField('tabletoperator_break_seconds').readOnly=true;window.__durationEditingBefore=__durationEditingCommands.length`);
 await verify('Read-only duration fields disable both mouse arrows', String.raw`[...__durationEditingField('tabletoperator_break_seconds').nextElementSibling.children].every(button=>button.disabled)`);
 await c.evaluate(String.raw`__durationEditingField('tabletoperator_break_seconds').nextElementSibling.firstElementChild.click()`);
 await verify('A disabled mouse arrow cannot change or save the duration', String.raw`curt.tabletoperator_break_seconds===391&&__durationEditingCommands.length===__durationEditingBefore`);
 await c.evaluate(String.raw`__durationEditingField('tabletoperator_break_seconds').readOnly=false;__durationEditingField('tabletoperator_break_seconds').disabled=true`);
 await verify('Changing the duration disabled state also disables its mouse arrows', String.raw`[...__durationEditingField('tabletoperator_break_seconds').nextElementSibling.children].every(button=>button.disabled)`);
 await c.evaluate(String.raw`__durationEditingField('tabletoperator_break_seconds').disabled=false`);
 await verify('Re-enabling the input restores both mouse arrows', String.raw`[...__durationEditingField('tabletoperator_break_seconds').nextElementSibling.children].every(button=>!button.disabled)`);
 await c.evaluate(String.raw`__durationEditingField('tabletoperator_break_seconds').btsDuration.write(0);curt.tabletoperator_break_seconds=0`);
 await clickPart(field,'seconds');
 await clickArrow(field,'decrease');
 await verify('Mouse decrement respects the existing minimum', `curt.tabletoperator_break_seconds===0&&__durationEditingField(${JSON.stringify(field)}).value==='0:00'&&${selected('seconds')}`);
 await c.evaluate(String.raw`__durationEditingField('tabletoperator_break_seconds').btsDuration.write(330);curt.tabletoperator_break_seconds=330;document.activeElement.blur()`);
 await clickArrow(field,'increase');
 await verify('Using an unfocused duration arrow starts with minutes and returns focus to the input', `curt.tabletoperator_break_seconds===390&&${selected('minutes')}`);
 await c.evaluate(String.raw`__durationEditingField('tabletoperator_break_seconds').btsDuration.write(330);curt.tabletoperator_break_seconds=330`);
 await clickPart(field,'seconds');
 await capture('einstellungen-zeitfelder-markierung',false,{preserveScroll:true});
 const drag=await c.evaluate(String.raw`(()=>{const node=__durationEditingField('tabletoperator_break_seconds'),bounds=node.getBoundingClientRect(),style=getComputedStyle(node),context=document.createElement('canvas').getContext('2d');context.font=style.font;const left=bounds.left+parseFloat(style.borderLeftWidth)+parseFloat(style.paddingLeft);return{start:left+1,end:left+context.measureText(node.value).width-1,y:bounds.top+bounds.height/2};})()`);
 await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.start,y:drag.y});
 await c.call('Input.dispatchMouseEvent',{type:'mousePressed',x:drag.start,y:drag.y,button:'left',buttons:1,clickCount:1});
 await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.end,y:drag.y,button:'left',buttons:1});
 await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.end,y:drag.y,button:'left',buttons:0,clickCount:1});
 await verify('Dragging across the duration preserves a deliberate selection over both parts', String.raw`(()=>{const node=__durationEditingField('tabletoperator_break_seconds');return node.selectionStart===0&&node.selectionEnd===node.value.length;})()`);
 await c.call('Input.insertText',{text:'4:05,5'});
 await key('Enter','Enter',13,'\r');
 await verify('Pasting a complete duration still preserves all parts and fractional seconds', String.raw`__durationEditingField('tabletoperator_break_seconds').value==='4:05,5'&&curt.tabletoperator_break_seconds===245.5`);
 await c.evaluate('document.activeElement.blur();window.send=__durationEditingSend');
 await verify('Leaving the edited field finishes its normal blur save before the settings owner is removed', String.raw`curt.tabletoperator_break_seconds===245.5&&__durationEditingField('tabletoperator_break_seconds').isConnected`);
};
