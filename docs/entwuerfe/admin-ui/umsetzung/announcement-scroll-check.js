'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 await open(1920,1080);
 const checks=[];
 const verify=async(label,expression)=>{assert(await c.evaluate(expression),label);checks.push(label);};
 await c.evaluate(`(()=>{
  window.__scrollPlays=0;window.__scrollForms=[];window.__scrollSpeechStatus='queued';
  for(let i=0;i<2;i++) {
   const form=document.createElement('form'),textarea=document.createElement('textarea'),localButton=document.createElement('button'),remoteButton=document.createElement('button');
   localButton.type=remoteButton.type='button';textarea.value='Isolierte Durchsage '+i;form.append(textarea,localButton,remoteButton);document.body.append(form);
   const service={settings:()=>({key:'preview',voice:'hallensprecherin',language:'de-DE',mode:'server',enabled:true,max_text:1200,max_part_length:1200}),prepare:async()=>({speech:{enabled:true}}),inspect:async()=>({speech:{enabled:true},clips:[{status:__scrollSpeechStatus}]})};
   const controller=createFreeAnnouncementForm({form,textarea,localButton,remoteButton,service,playLocal:()=>__scrollPlays++,playRemote:()=>__scrollPlays++});
   __scrollForms.push({form,textarea,localButton,controller});
  }
  window.__scrollSettle=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 })();true`);
 await verify('Closed announcement forms allow background scrolling','getComputedStyle(document.body).overflow!==\'hidden\'');
 await c.evaluate('__scrollForms[0].localButton.click();true');
 await verify('Opening the actual native announcement dialog locks background scrolling','__scrollForms[0].form.querySelector(\'dialog\').open&&getComputedStyle(document.body).overflow===\'hidden\'&&__scrollPlays===0');
 await c.evaluate('__scrollForms[1].localButton.click();__scrollSettle()');
 await verify('A second independent announcement form retains its native dialog','__scrollForms.every(item=>item.form.querySelector(\'dialog\').open)&&getComputedStyle(document.body).overflow===\'hidden\'');
 await c.evaluate('__scrollForms[0].controller.dispose();__scrollSettle()');
 await verify('Disposing one form preserves the other open dialog and its scroll lock','!__scrollForms[0].form.querySelector(\'dialog\')&&__scrollForms[1].form.querySelector(\'dialog\').open&&getComputedStyle(document.body).overflow===\'hidden\'');
 await c.evaluate('__scrollForms[1].form.querySelector(\'.announcement-background-button\').click();__scrollSettle()');
 await verify('Waiting in the background releases scrolling while preserving the pending announcement','!__scrollForms[1].form.querySelector(\'dialog\').open&&!__scrollForms[1].form.querySelector(\'.announcement-pending\').hidden&&getComputedStyle(document.body).overflow!==\'hidden\'&&__scrollPlays===0');
 await c.evaluate('window.__scrollConfirmation=btsDialogActions.confirm({owner:__scrollForms[1].form,title:\'Andere Aktion\',message:\'Isolierte Dialogprüfung\',confirmLabel:\'OK\',cancelLabel:\'Abbrechen\'});window.__scrollOtherFocus=document.activeElement;__scrollSpeechStatus=\'completed\';true');
 await c.evaluate('new Promise((resolve,reject)=>{const end=performance.now()+3500;function check(){if(__scrollPlays===1)return resolve();if(performance.now()>end)return reject(Error(\'Background announcement did not complete\'));setTimeout(check,25);}check();})');
 await verify('Background completion preserves another native modal, its focus and its scroll lock','!!document.querySelector(\'.bts-confirm-dialog[open]\')&&document.activeElement===__scrollOtherFocus&&getComputedStyle(document.body).overflow===\'hidden\'&&__scrollPlays===1');
 await c.evaluate('document.querySelector(\'.bts-confirm-cancel\').click();__scrollConfirmation');
 await verify('Closing the other modal releases scrolling after background playback','!document.querySelector(\'.bts-confirm-dialog[open]\')&&getComputedStyle(document.body).overflow!==\'hidden\'&&__scrollPlays===1');
 await c.evaluate('__scrollPlays=0;__scrollSpeechStatus=\'queued\';__scrollForms[1].localButton.click();__scrollForms[1].form.querySelector(\'.announcement-background-button\').click();__scrollSettle()');
 await c.evaluate('__scrollForms[1].form.querySelector(\'.announcement-pending-cancel\').click();__scrollSettle()');
 await verify('Cancelling a pending announcement keeps scrolling available and releases its controls','__scrollForms[1].form.querySelector(\'.announcement-pending\').hidden&&!__scrollForms[1].localButton.disabled&&getComputedStyle(document.body).overflow!==\'hidden\'&&__scrollPlays===0');
 await c.evaluate('__scrollForms[1].localButton.click();__scrollForms[1].form.querySelector(\'.announcement-cancel-button\').click();__scrollSettle()');
 await verify('Cancelling the modal releases its scroll lock','!__scrollForms[1].form.querySelector(\'dialog\').open&&getComputedStyle(document.body).overflow!==\'hidden\'');
 await c.evaluate('__scrollForms[1].localButton.click();__scrollForms[1].textarea.value+=\' geändert\';__scrollForms[1].textarea.dispatchEvent(new Event(\'input\',{bubbles:true}));__scrollSettle()');
 await verify('Editing the text closes an unconfirmed dialog and releases scrolling','!__scrollForms[1].form.querySelector(\'dialog\').open&&getComputedStyle(document.body).overflow!==\'hidden\'&&__scrollPlays===0');
 await c.evaluate('__scrollForms[1].localButton.click();__scrollForms[1].form.remove();__scrollSettle()');
 await verify('Removing an open owner form removes its modal and releases scrolling','!__scrollForms[1].form.querySelector(\'dialog\')&&getComputedStyle(document.body).overflow!==\'hidden\'&&__scrollPlays===0');
 await c.evaluate('__scrollForms[0].form.remove();delete window.__scrollForms;true');
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');assert.strictEqual(exceptions.length,0,JSON.stringify(exceptions));
 fs.writeFileSync(path.join(previews,'announcement-scroll-verification.json'),JSON.stringify({checks,exceptions:0},null,2)+'\n');
 process.stdout.write(JSON.stringify({checks:checks.length,exceptions:0})+'\n');
};
