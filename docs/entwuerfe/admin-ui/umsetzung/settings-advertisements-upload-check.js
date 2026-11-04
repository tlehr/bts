'use strict';
/* eslint no-undef: off, no-console: off */

module.exports = async function({c,open,metrics,capture,check}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const wait = fn => c.evaluate('(async()=>{for(let i=0;i<200;i++){if((' + fn.toString() + ')())return;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error("Upload did not settle");})()');
 const verify = async (name,fn) => {
  try {await check(name,'(' + fn.toString() + ')()');}
  catch (error) {console.error(JSON.stringify(await run(()=>({html:document.querySelector('.settings-advertisements')?.outerHTML,errors:__uploadErrors,ads:curt.advertisements}))));throw error;}
 };
 await open(1440,1000);
 await run(()=>{
  window.__uploadDocument=document;window.__uploadSpeech=btsSpeechService;window.__uploadErrors=[];
  window.addEventListener('error',event=>__uploadErrors.push(event.message));
  const original=send;window.send=(message,callback)=>message.type==='tournament_get'?setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0):original(message,callback);
  window.__uploadFile=()=>document.querySelector('[name=advertisement_file]');window.__uploadButton=()=>document.querySelector('.settings-advertisement-upload');
  window.__chooseAd=file=>{const transfer=new DataTransfer();transfer.items.add(file);__uploadFile().files=transfer.files;__uploadFile().dispatchEvent(new Event('change',{bubbles:true}));};
  window.__uploadCanvas=document.createElement('canvas');__uploadCanvas.width=320;__uploadCanvas.height=180;
  const context=__uploadCanvas.getContext('2d');context.fillStyle='#105b64';context.fillRect(0,0,320,180);context.fillStyle='#fff';context.font='bold 32px Arial';context.fillText('SPONSOR',66,100);
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 });
 await wait(()=>!!document.querySelector('.settings-area-link[href$="/edit/advertisements"]'));
 await run(()=>document.querySelector('.settings-area-link[href$="/edit/advertisements"]').click());
 await verify('Direct file upload is primary while manual addresses remain available',()=>
  !!__uploadFile()&&__uploadButton().disabled&&!document.querySelector('.settings-advertisement-url-options').open&&
  __uploadFile().accept.includes('.mp4')&&__uploadFile().accept.includes('.webm')&&
  !!document.querySelector('label[for="'+__uploadFile().id+'"]'));
 await run(()=>{
  __chooseAd(new File(['bad'],'Werbung.svg',{type:'image/svg+xml'}));__uploadButton().click();
 });
 await verify('Unsupported selections are rejected before upload and keep the file selectable',()=>
  !document.querySelector('.settings-advertisements .settings-advertisement-error').hidden&&!__uploadFile().matches(':disabled')&&curt.advertisements.length===0);
 await run(()=>{__chooseAd(new File(['not an actual image'],'Defekt.png',{type:'image/png'}));__uploadButton().click();});
 await wait(()=>!__uploadButton().disabled);
 await verify('A rejected HTTP upload retains the selected file and shows the server explanation',()=>
  __uploadFile().files[0].name==='Defekt.png'&&!document.querySelector('.settings-advertisements .settings-advertisement-error').hidden&&
  document.querySelector('.settings-advertisements .settings-advertisement-error').textContent.includes('PNG')&&curt.advertisements.length===0&&
  !document.querySelector('.settings-advertisement-error-details').hidden&&document.querySelector('.settings-advertisement-error-details').textContent.includes('HTTP 400')&&
  document.querySelector('.settings-advertisement-error-details').textContent.includes('Dateiformat prüfen'));
 await run(async()=>{
  const blob=await new Promise(resolve=>__uploadCanvas.toBlob(resolve,'image/png'));
  __chooseAd(new File([blob],'Sponsor Ä.png',{type:'image/png'}));__uploadButton().click();
 });
 await wait(()=>curt.advertisements.length===1&&!__uploadFile().files.length);
 await wait(()=>document.querySelector('.settings-advertisement img')?.naturalWidth>0);
 await verify('An actual HTTP image upload appears immediately with its original name and decoded preview',()=>
  curt.advertisements[0].name==='Sponsor Ä.png'&&curt.advertisements[0].type==='image'&&!!curt.advertisements[0].asset_id&&
  document.querySelector('.settings-advertisement h3').textContent==='Sponsor Ä.png'&&document.querySelector('.settings-advertisement-kind').textContent==='Bild'&&
  document.querySelector('.settings-advertisement img').naturalWidth===320&&document.querySelector('.live_settings_status').textContent==='Alle Änderungen gespeichert'&&
  document.querySelector('.settings-advertisement-error-details').hidden&&!document.querySelector('.settings-advertisement-error-details pre').textContent);
 await run(async()=>{
  const chunks=[],stream=__uploadCanvas.captureStream(10),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
  for(let i=0;i<6;i++) {__uploadCanvas.getContext('2d').fillStyle=i%2?'#fff':'#105b64';__uploadCanvas.getContext('2d').fillRect(0,0,12,12);await new Promise(resolve=>setTimeout(resolve,90));}
  recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
  __chooseAd(new File(chunks,'Werbefilm.webm',{type:'video/webm'}));__uploadButton().click();
 });
 await wait(()=>curt.advertisements.length===2&&!__uploadFile().files.length);
 await run(async()=>{const video=document.querySelector('.settings-advertisement video');await video.play();video.pause();});
 await verify('An actual uploaded WebM is playable from the BTS media endpoint',()=>
  curt.advertisements[1].type==='video_file_url'&&curt.advertisements[1].name==='Werbefilm.webm'&&
  document.querySelector('.settings-advertisement video').videoWidth===320&&!document.querySelector('.settings-advertisement video').error&&
  document.querySelector('.settings-advertisement video').paused&&!document.querySelector('.settings-advertisement video').autoplay);
 await run(async()=>{
  const response=await fetch(curt.advertisements[1].url,{headers:{Range:'bytes=0-15'}});
  window.__uploadRange={status:response.status,range:response.headers.get('content-range'),bytes:(await response.arrayBuffer()).byteLength};
 });
 await verify('The video endpoint supports the byte ranges needed for seeking',()=>__uploadRange.status===206&&__uploadRange.bytes===16&&__uploadRange.range.startsWith('bytes 0-15/'));
 await capture('einstellungen-werbung-upload',true);
 await run(()=>{
  window.__uploadNativeXHR=XMLHttpRequest;window.__uploadFakeRequests=[];
  window.XMLHttpRequest=class {
   constructor(){this.upload={};}
   open(method,url){this.method=method;this.url=url;}
   setRequestHeader(){}
   send(body){this.body=body;__uploadFakeRequests.push(this);}
   abort(){this.aborted=true;this.onabort();}
  };
  __chooseAd(new File(['video'],'Weiterer Film.mp4',{type:'video/mp4'}));__uploadButton().click();__uploadButton().click();
  __uploadFakeRequests[0].upload.onprogress({lengthComputable:true,loaded:5,total:10});
 });
 await verify('Large-file uploads show progress, block duplicate sends and can be cancelled',()=>
  __uploadFakeRequests.length===1&&__uploadFakeRequests[0].body instanceof File&&__uploadFakeRequests[0].url==='/h/preview/advertisements/upload'&&
  document.querySelector('.settings-advertisement-progress').value===.5&&document.querySelector('.settings-advertisement-upload-footer').textContent.includes('50 %')&&
  __uploadFile().matches(':disabled')&&!document.querySelector('.settings-advertisement-upload-actions button').hidden);
 await run(()=>document.querySelector('.settings-advertisement-upload-actions button').click());
 await verify('Cancellation retains the file for retry and ends the saving state',()=>
  __uploadFakeRequests[0].aborted&&__uploadFile().files[0].name==='Weiterer Film.mp4'&&!__uploadButton().disabled&&
  document.querySelector('.settings-advertisement-upload-footer').textContent.includes('abgebrochen')&&
  document.querySelector('.live_settings_status').textContent==='Alle Änderungen gespeichert'&&curt.advertisements.length===2);
 await run(()=>{
  __uploadButton().click();__uploadFakeRequests[1].onerror();
 });
 await verify('Connection errors keep the file and offer retry with an inline error',()=>
  !__uploadButton().disabled&&__uploadFile().files[0].name==='Weiterer Film.mp4'&&
  !document.querySelector('.settings-advertisements .settings-advertisement-error').hidden&&document.querySelector('.settings-advertisements .settings-advertisement-error').textContent.includes('Verbindung'));
 await run(()=>{__uploadButton().click();__uploadFakeRequests[2].upload.onprogress({lengthComputable:true,loaded:10,total:10});});
 await verify('Completed transfers show the saving phase and cannot be cancelled while registering the file',()=>
  document.querySelector('.settings-advertisement-upload-actions button').disabled&&
  document.querySelector('.settings-advertisement-upload-footer').textContent.includes('wird gespeichert')&&__uploadButton().disabled&&
  document.querySelector('.settings-advertisement-error-details').hidden);
 await run(()=>{const request=__uploadFakeRequests[2];request.status=500;request.response={message:'Die Datei konnte nicht gespeichert werden.',code:'EEXIST',stage:'Speicherordner anlegen',
  details:'EEXIST: file already exists, mkdir /server/data/advertisements'};request.onload();});
 await run(()=>{document.querySelector('.settings-advertisement-error-details').open=true;});
 await verify('A server failure preserves the file and displays its HTTP status, error code, step and cause',()=>
  !__uploadButton().disabled&&__uploadFile().files[0].name==='Weiterer Film.mp4'&&curt.advertisements.length===2&&
  document.querySelector('.settings-advertisements .settings-advertisement-error').textContent.includes('gespeichert')&&
  !document.querySelector('.settings-advertisement-error-details').hidden&&['HTTP 500','Fehlercode: EEXIST','Schritt: Speicherordner anlegen','mkdir /server/data/advertisements']
   .every(text=>document.querySelector('.settings-advertisement-error-details pre').textContent.includes(text)));
 for(const width of [1920,950,390,320]) {
  await metrics(width,1000);
  await verify('Upload controls and media previews fit at '+width+' px',()=>
   document.documentElement.scrollWidth<=innerWidth+1&&[__uploadFile(),__uploadButton(),...document.querySelectorAll('.settings-advertisement-preview')]
    .every(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1;}));
  if(width===390)await capture('einstellungen-werbung-upload-mobil',true);
 }
 await run(()=>{__uploadButton().click();document.querySelector('.leitstand-nav a[href$="/devices"]').click();});
 await wait(()=>!document.querySelector('.page-settings'));
 await verify('Leaving the page aborts an active upload and preserves the shared speech service',()=>
  __uploadFakeRequests[3].aborted&&document===__uploadDocument&&btsSpeechService===__uploadSpeech&&__uploadErrors.length===0);
 await run(()=>{window.XMLHttpRequest=__uploadNativeXHR;});
};
