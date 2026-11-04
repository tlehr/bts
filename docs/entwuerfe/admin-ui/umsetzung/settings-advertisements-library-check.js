'use strict';
/* eslint no-undef: off, no-console: off */

module.exports = async function({c,open,metrics,capture,check,removeSaved,copyLegacy,removeFile}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const wait = fn => c.evaluate('(async()=>{for(let i=0;i<200;i++){if((' + fn.toString() + ')())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error("Advertisement library did not settle");})()');
 const verify = async (name,fn) => {
  try {await check(name,'(' + fn.toString() + ')()');}
  catch (error) {console.error(JSON.stringify(await run(()=>({dialog:document.querySelector('.settings-advertisement-dialog')?.outerHTML,errors:__libraryErrors,ads:curt.advertisements}))));throw error;}
 };
 await open(1440,1000);
 await run(()=>{
  window.__libraryDocument=document;window.__librarySpeech=btsSpeechService;window.__libraryErrors=[];
  window.addEventListener('error',event=>__libraryErrors.push(event.message));
  const original=send;window.send=(message,callback)=>message.type==='tournament_get'?setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0):original(message,callback);
  window.__libraryNativeFetch=fetch;window.__libraryFail=false;window.__libraryHold=false;window.__librarySelects=[];
  window.fetch=(url,options)=>{
   if(String(url).endsWith('/advertisements/library')&&__libraryFail)return Promise.reject(new Error('Synthetic loading failure'));
   if(String(url).endsWith('/advertisements/library/select')) {
    __librarySelects.push({url,options});
    if(__libraryHold)return new Promise((resolve,reject)=>{window.__releaseLibrarySelect=()=>__libraryNativeFetch(url,options).then(resolve,reject);});
   }
   return __libraryNativeFetch(url,options);
  };
  window.__adLibrary=()=>document.querySelector('.settings-advertisement-dialog');
  window.__adLibraryButton=()=>document.querySelector('.settings-advertisement-library-button');
  window.__openAdLibrary=()=>{__adLibraryButton().focus();__adLibraryButton().click();};
  window.__closeAdLibrary=()=>__adLibrary().querySelector('.ls-dialog-close').click();
  window.__chooseStored=id=>__adLibrary().querySelector('input[value="'+id+'"]').click();
  window.__useStored=()=>__adLibrary().querySelector('form').requestSubmit();
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 });
 await wait(()=>!!document.querySelector('.settings-area-link[href$="/edit/advertisements"]'));
 await run(()=>document.querySelector('.settings-area-link[href$="/edit/advertisements"]').click());
 await verify('A saved-file gallery is available next to the upload action',()=>
  !!__adLibraryButton()&&__adLibraryButton().parentElement===document.querySelector('.settings-advertisement-upload').parentElement&&!__adLibraryButton().disabled);
 await run(()=>__openAdLibrary());
 await wait(()=>__adLibrary()?.textContent.includes('Noch keine gespeicherten'));
 await verify('An empty server library opens as a native modal with the shared blurred backdrop',()=>
  __adLibrary().matches(':modal')&&getComputedStyle(__adLibrary(),'::backdrop').backdropFilter==='blur(2px)'&&
  __adLibrary().querySelector('[type=submit]').disabled);
 await run(()=>__closeAdLibrary());
 await verify('Closing returns focus to the library action without changing advertisements',()=>
  !__adLibrary()&&document.activeElement===__adLibraryButton()&&curt.advertisements.length===0);
 await run(async()=>{
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
  const context=canvas.getContext('2d');context.fillStyle='#105b64';context.fillRect(0,0,320,180);context.fillStyle='#fff';context.font='bold 28px Arial';context.fillText('SPONSOR',72,100);
  const image=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  async function store(bytes,name) {
   const response=await fetch('/h/preview/advertisements/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent(name)},body:bytes});
   const {advertisement}=await response.json();ctournament.add_advertisement({val:{advertisement}});return advertisement;
  }
  window.__storedCurrent=await store(image,'Aktueller Sponsor.png');window.__storedOld=await store(image,'Früherer Sponsor.png');
  const stream=canvas.captureStream(10),chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
  for(let i=0;i<6;i++){context.fillStyle=i%2?'#fff':'#105b64';context.fillRect(0,0,12,12);await new Promise(resolve=>setTimeout(resolve,90));}
  recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
  window.__storedVideo=await store(new Blob(chunks,{type:'video/webm'}),'Werbefilm.webm');
 });
 for (const name of ['__storedOld','__storedVideo']) await removeSaved(await c.evaluate(name+'._id'));
 const legacy=await copyLegacy(await c.evaluate('__storedOld.asset_id'));await c.evaluate('window.__storedLegacy='+JSON.stringify(legacy));
 await run(()=>{
  ctournament.remove_advertisement({val:{advertisement_id:__storedOld._id}});ctournament.remove_advertisement({val:{advertisement_id:__storedVideo._id}});
  document.querySelector('[name=advertisement_url]').value='https://beispiel.de/entwurf.png';
  const transfer=new DataTransfer();transfer.items.add(new File(['draft'],'Entwurf.png',{type:'image/png'}));const file=document.querySelector('[name=advertisement_file]');file.files=transfer.files;file.dispatchEvent(new Event('change'));
  __openAdLibrary();
 });
 await wait(()=>__adLibrary()?.querySelectorAll('.settings-advertisement-choice').length===4);
 await verify('The gallery lists current files and removed image/video uploads with their original names',()=>
  __adLibrary().textContent.includes('Aktueller Sponsor.png')&&__adLibrary().textContent.includes('Früherer Sponsor.png')&&__adLibrary().textContent.includes('Werbefilm.webm')&&
  __adLibrary().textContent.includes('Datei vom')&&__adLibrary().querySelector('input[value="'+__storedCurrent.asset_id+'"]').disabled&&
  !__adLibrary().querySelector('input[value="'+__storedOld.asset_id+'"]').disabled&&__adLibrary().textContent.includes('Bereits in der Liste'));
 await wait(()=>__adLibrary().querySelector('input[value="'+__storedOld.asset_id+'"]').parentElement.querySelector('img').naturalWidth===320);
 await run(async()=>{
  window.__libraryVideo=__adLibrary().querySelector('video');__libraryVideo.scrollIntoView({block:'center'});await __libraryVideo.play();__libraryVideo.pause();
 });
 await verify('The gallery displays the saved image and a playable video without automatic playback',()=>
  __libraryVideo.videoWidth===320&&!__libraryVideo.autoplay&&__libraryVideo.muted&&__libraryVideo.controls&&!__libraryVideo.error);
 await capture('einstellungen-werbung-galerie');
 await run(()=>{__chooseStored(__storedOld.asset_id);__closeAdLibrary();});
 await verify('Cancelling preserves both drafts, pauses gallery videos and does not add an item',()=>
  !__adLibrary()&&__libraryVideo.paused&&!__libraryVideo.hasAttribute('src')&&curt.advertisements.length===1&&
  document.querySelector('[name=advertisement_url]').value==='https://beispiel.de/entwurf.png'&&document.querySelector('[name=advertisement_file]').files[0].name==='Entwurf.png');
 await run(()=>{__libraryFail=true;__openAdLibrary();});
 await wait(()=>__adLibrary()?.textContent.includes('konnten nicht geladen'));
 await verify('Loading failures leave the gallery open with retry',()=>
  __adLibrary().querySelector('[type=submit]').disabled&&[...__adLibrary().querySelectorAll('button')].some(button=>button.textContent==='Erneut laden'&&!button.hidden));
 await run(()=>{__libraryFail=false;[...__adLibrary().querySelectorAll('button')].find(button=>button.textContent==='Erneut laden').click();});
 await wait(()=>__adLibrary()?.querySelectorAll('input').length===4);
 await run(()=>{__libraryHold=true;__chooseStored(__storedOld.asset_id);__useStored();__useStored();});
 await verify('Reusing a file sends one selection request and blocks duplicate submissions',()=>
  __librarySelects.length===1&&JSON.parse(__librarySelects[0].options.body).asset_id===__storedOld.asset_id&&
  __adLibrary().querySelector('[type=submit]').disabled&&__adLibrary().querySelector('.ls-dialog-close').disabled);
 await run(()=>{__releaseLibrarySelect();__libraryHold=false;});
 await wait(()=>!__adLibrary());
 await verify('The actual library selection restores a removed advertisement using the same file URL',()=>
  curt.advertisements.length===2&&curt.advertisements.find(ad=>ad.asset_id===__storedOld.asset_id)?.url===__storedOld.url&&
  curt.advertisements.find(ad=>ad.asset_id===__storedOld.asset_id)?.name==='Früherer Sponsor.png'&&
  document.querySelector('.live_settings_status').textContent==='Alle Änderungen gespeichert');
 await run(()=>__openAdLibrary());
 await wait(()=>__adLibrary()?.querySelectorAll('input').length===4);
 await verify('A reused file is marked as already present the next time the gallery opens',()=>
  __adLibrary().querySelector('input[value="'+__storedOld.asset_id+'"]').disabled);
 for(const width of [1920,950,390,320]) {
  await metrics(width,1000);
  await verify('Gallery previews and footer fit at '+width+' px',()=>{
   const dialog=__adLibrary(),bounds=dialog.getBoundingClientRect(),footer=dialog.querySelector('footer').getBoundingClientRect();
   return bounds.left>=0&&bounds.right<=innerWidth+1&&bounds.top>=0&&bounds.bottom<=innerHeight+1&&footer.bottom<=innerHeight+1&&
    [...dialog.querySelectorAll('.settings-advertisement-choice,button')].every(node=>{const box=node.getBoundingClientRect();return !box.width||box.left>=bounds.left&&box.right<=bounds.right+1;});
  });
  if(width===390)await capture('einstellungen-werbung-galerie-mobil');
 }
 await metrics(1440,1000);
 await run(()=>__chooseStored(__storedLegacy));await removeFile(legacy);
 await run(()=>__useStored());
 await wait(()=>__adLibrary()?.textContent.includes('nicht mehr vorhanden'));
 await verify('A file removed after listing produces a recoverable selection error',()=>
  !__adLibrary().querySelector('[type=submit]').disabled&&curt.advertisements.length===2);
 await run(()=>{__chooseStored(__storedVideo.asset_id);__useStored();});
 await wait(()=>!__adLibrary());
 await verify('Choosing another file after an error restores the saved video entry',()=>
  curt.advertisements.length===3&&curt.advertisements.find(ad=>ad.asset_id===__storedVideo.asset_id)?.type==='video_file_url');
 await run(()=>{__openAdLibrary();crouting.navigate_to('t/preview/devices');});
 await wait(()=>!document.querySelector('.page-settings'));
 await verify('Leaving closes the gallery, releases its media and preserves the shared page and speech service',()=>
  !__adLibrary()&&document===__libraryDocument&&btsSpeechService===__librarySpeech&&__libraryErrors.length===0);
 await run(()=>{window.fetch=__libraryNativeFetch;});
};
