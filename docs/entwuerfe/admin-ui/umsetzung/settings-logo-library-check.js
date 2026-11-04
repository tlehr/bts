'use strict';
/* eslint no-undef: off, no-console: off */
const assert = require('assert');

module.exports = async function({c,open,metrics,capture,check}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const verify = async(name,fn) => {
  try {await check(name,'(' + fn.toString() + ')()');}
  catch(error) {
   console.error(JSON.stringify(await run(()=>({section:document.querySelector('.page-settings')?.dataset.settingsSection,
    panel:document.querySelector('#settings-display-panel-display')?.innerHTML.slice(0,4500),dialog:__logoDialog()?.outerHTML}))));
   console.error(JSON.stringify(c.events.filter(event=>event.method==='Runtime.exceptionThrown').map(event=>event.params.exceptionDetails)));throw error;
  }
 };
 const wait = fn => c.evaluate('(async()=>{for(let i=0;i<150;i++){if((' + fn.toString() + ')())return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error("Logo picker did not settle");})()');
 await open(1440,1000);
 await run(() => {
  window.__logoDocument=document;window.__logoSpeech=btsSpeechService;window.__logoLoads=[];window.__logoSelections=[];window.__logoUploads=[];
  window.__logoItems=[{id:'logo-other.svg',name:'Vereinslogo.svg',uploaded_at:Date.UTC(2026,10,3)},
   {id:'logo-current.svg',name:'Aktuelles Logo.svg',uploaded_at:Date.UTC(2026,10,2)},
   {id:'logo-old.svg',name:'',uploaded_at:Date.UTC(2026,10,1)}];
  Object.assign(curt,{logo_id:'logo-current.svg',logo_name:'Aktuelles Logo.svg',logo_background_color:'#123456',logo_foreground_color:'#eeeeee'});
  const original=send;window.send=(message,callback)=>{
   if(message.type==='tournament_get')return setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0);
   if(message.type==='tournament_logo_list'){__logoLoads.push({message,callback});return;}
   if(message.type==='tournament_select_logo'){__logoSelections.push({message,callback});return;}
   if(message.type==='tournament_upload_logo'){__logoUploads.push({message,callback});return;}
   original(message,callback);
  };
  window.__logoDialog=()=>document.querySelector('.settings-logo-dialog');
  window.__logoOpen=()=>{const button=document.querySelector('.settings-logo-library-button');button.focus();button.click();};
  window.__logoList=(error=null,items=__logoItems)=>__logoLoads.shift().callback(error,{logos:structuredClone(items)});
  window.__logoAccept=()=>__logoDialog().querySelector('form').requestSubmit();
  window.__logoChoose=id=>__logoDialog().querySelector('input[value="'+id+'"]').click();
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 });
 await wait(()=>!!document.querySelector('.settings-area-link[href$="/edit/devices"]'));
 await run(()=>document.querySelector('.settings-area-link[href$="/edit/devices"]').click());
 await verify('The logo library is next to the upload in the first display card',()=>
  document.querySelector('#settings-display-panel-display .settings-card h2').textContent==='Turnierlogo'&&
  !!document.querySelector('#settings-display-panel-display .settings-logo-library-button')&&
  !document.querySelector('.settings-general .settings-branding')&&!!document.querySelector('.logo_form input[type=file]'));
 await run(()=>__logoOpen());
 await verify('The picker opens as a native modal and reports loading',()=>
  __logoDialog().matches(':modal')&&__logoDialog().textContent.includes('Logos werden geladen')&&
  __logoLoads[0].message.tournament_key==='preview'&&getComputedStyle(__logoDialog(),'::backdrop').backdropFilter==='blur(2px)');
 await run(()=>__logoList({message:'Synthetic listing failure'}));
 await verify('A failed list request offers retry without changing the logo',()=>
  !__logoDialog().querySelector('button[hidden]')&&__logoDialog().textContent.includes('nicht geladen')&&curt.logo_id==='logo-current.svg');
 await run(()=>{[...__logoDialog().querySelectorAll('button')].find(button=>button.textContent==='Erneut laden').click();__logoList();});
 await wait(()=>[...__logoDialog().querySelectorAll('img')].every(image=>image.complete&&image.naturalWidth>0));
 await verify('The gallery previews existing files, marks the current logo and labels older unnamed files',()=>
  __logoDialog().querySelectorAll('.settings-logo-choice').length===3&&__logoDialog().querySelector('input').value==='logo-current.svg'&&
  __logoDialog().querySelector('input:checked').value==='logo-current.svg'&&__logoDialog().querySelector('.settings-logo-choice-current').textContent==='Aktuelles Logo'&&
  __logoDialog().textContent.includes('Vereinslogo.svg')&&__logoDialog().textContent.includes('Logo vom')&&__logoDialog().querySelector('[type=submit]').disabled);
 await capture('einstellungen-logo-galerie');
 await run(()=>{__logoChoose('logo-other.svg');[...__logoDialog().querySelectorAll('button')].find(button=>button.textContent==='Abbrechen').click();});
 await verify('Cancelling a selection preserves the logo and returns focus to its opener',()=>
  !__logoDialog()&&curt.logo_id==='logo-current.svg'&&__logoSelections.length===0&&document.activeElement.classList.contains('settings-logo-library-button'));
 await run(()=>{__logoOpen();__logoList();__logoChoose('logo-other.svg');__logoAccept();__logoAccept();});
 await verify('Applying a logo sends one existing-file selection and blocks duplicate submissions',()=>
  __logoSelections.length===1&&__logoSelections[0].message.logo_id==='logo-other.svg'&&__logoSelections[0].message.tournament_key==='preview'&&
  __logoDialog().querySelector('[type=submit]').disabled&&__logoDialog().querySelector('.ls-dialog-close').disabled);
 await run(()=>__logoSelections.shift().callback({message:'Das Logo ist nicht mehr vorhanden.'}));
 await verify('A failed selection remains open with the chosen logo and an enabled retry',()=>
  __logoDialog().textContent.includes('nicht mehr vorhanden')&&__logoDialog().querySelector('input:checked').value==='logo-other.svg'&&!__logoDialog().querySelector('[type=submit]').disabled);
 await run(()=>{__logoAccept();__logoSelections.shift().callback(null,{logo_id:'logo-other.svg',logo_name:'Vereinslogo.svg'});});
 await verify('A successful selection updates the preview and filename while retaining both tournament colors',()=>
  !__logoDialog()&&curt.logo_id==='logo-other.svg'&&document.querySelector('[name=logo_preview_img]').getAttribute('src')==='/h/preview/logo/logo-other.svg'&&
  document.querySelector('#upload_filename').textContent==='Vereinslogo.svg'&&curt.logo_background_color==='#123456'&&curt.logo_foreground_color==='#eeeeee');
 await run(()=>{__logoOpen();__logoList(null,[]);});
 await verify('An empty library explains how to upload and prevents applying an empty choice',()=>
  __logoDialog().textContent.includes('Noch keine gespeicherten Logos')&&__logoDialog().querySelector('[type=submit]').disabled);
 await run(()=>{__logoDialog().querySelector('.ls-dialog-close').click();const transfer=new DataTransfer();transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'],'Neues Logo.svg',{type:'image/svg+xml'}));const input=document.querySelector('.logo_form input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change'));});
 await wait(()=>__logoUploads.length===1);
 await verify('Uploading a new file keeps the existing upload command available',()=>
  __logoUploads[0].message.name==='Neues Logo.svg'&&__logoUploads[0].message.data_url.startsWith('data:image/svg+xml;base64,')&&__logoUploads[0].message.tournament_key==='preview');
 await run(()=>{
  __logoUploads.shift().callback(null,{});__logoItems.push({id:'logo-upload.svg',name:'Neues Logo.svg',uploaded_at:Date.now()});
  crouting.on_change({ctype:'logo_changed',tournament_key:'preview',val:{logo_id:'logo-upload.svg',logo_name:'Neues Logo.svg'}});
  __logoOpen();__logoList();
 });
 await verify('A new upload is available the next time the gallery opens',()=>
  __logoDialog().querySelectorAll('input').length===4&&__logoDialog().querySelector('input:checked').value==='logo-upload.svg');
 for(const width of [1920,950,390,320]) {
  await metrics(width,1000);
  await verify('The logo gallery and its footer fit at '+width+' px',()=>{
   const dialog=__logoDialog(),bounds=dialog.getBoundingClientRect(),footer=dialog.querySelector('footer').getBoundingClientRect();
   return bounds.left>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight&&dialog.scrollWidth<=dialog.clientWidth+1&&footer.bottom<=bounds.bottom&&
    [...dialog.querySelectorAll('.settings-logo-choice,button')].every(node=>{const box=node.getBoundingClientRect();return !box.width||box.left>=bounds.left&&box.right<=bounds.right;});
  });
  if(width===390)await capture('einstellungen-logo-galerie-mobil');
 }
 await run(()=>{__logoDialog().querySelector('.ls-dialog-close').click();__logoOpen();crouting.navigate_to('t/preview/devices');});
 await wait(()=>!__logoDialog());
 await run(()=>__logoList());
 await verify('Leaving the settings disposes the picker and ignores a late listing response',()=>
  !__logoDialog()&&document===__logoDocument&&btsSpeechService===__logoSpeech&&!!document.querySelector('.page-devices'));
 assert.deepStrictEqual(c.events.filter(event=>event.method==='Runtime.exceptionThrown').map(event=>event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text),[]);
};
