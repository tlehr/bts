'use strict';
/* eslint no-undef: off, no-console: off */

module.exports = async function({c,open,metrics,capture,check}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const verify = async (name, fn) => {
  try {await check(name,'(' + fn.toString() + ')()');}
  catch (error) {console.error(JSON.stringify(await run(() => ({html:document.querySelector('.settings-advertisements')?.outerHTML,requests:__adRequests.map(item=>item.message)}))));throw error;}
 };
 const wait = fn => c.evaluate('(async()=>{for(let i=0;i<120;i++){if((' + fn.toString() + ')())return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error("Advertisement UI did not settle");})()');
 await open(1440,1000);
 await run(() => {
  window.__adDocument=document;window.__adSpeech=btsSpeechService;window.__adRequests=[];window.__adExceptions=[];
  window.addEventListener('error',event=>__adExceptions.push(event.message));
  const original=send;window.send=(message,callback)=>{
   if(message.type==='tournament_get')return setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0);
   if(['advertisement_add','advertisement_remove'].includes(message.type)){__adRequests.push({message,callback});return;}
   return original(message,callback);
  };
  window.__adSource=()=>document.querySelector('[name=advertisement_url]');window.__adType=()=>document.querySelector('[name=advertisement_type]');
  window.__adButton=()=>document.querySelector('.settings-advertisement-add');window.__adRow=id=>document.querySelector('[data-advertisement-id="'+id+'"]');
  window.__adInput=value=>{__adSource().value=value;__adSource().dispatchEvent(new Event('input',{bubbles:true}));};
  window.__adAdd=ad=>crouting.on_change({ctype:'advertisement_add',tournament_key:'preview',val:{advertisement:ad}});
  window.__adRemove=id=>crouting.on_change({ctype:'advertisement_removed',tournament_key:'preview',val:{advertisement_id:id}});
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 });
 await wait(()=>!!document.querySelector('.settings-area-link[href$="/edit/advertisements"]'));
 await run(()=>document.querySelector('.settings-area-link[href$="/edit/advertisements"]').click());
 await run(()=>{document.querySelector('.settings-advertisement-url-options').open=true;});
 await verify('Advertisements have two cards, the shared sidebar and explicit server-wide scope',()=>
  location.pathname.endsWith('/edit/advertisements')&&document.querySelector('.settings-area-link[aria-current]').textContent==='Werbung'&&
  [...document.querySelectorAll('.settings-advertisements h2')].map(node=>node.textContent).join('|')==='Werbung hinzufügen|Vorhandene Werbung'&&
  document.querySelector('.settings-advertisements .settings-card-badge').textContent==='Serverweit'&&
  !document.querySelector('.settings-advertisements table'));
 await verify('The empty library offers supported image and video types and disables an empty addition',()=>
  !document.querySelector('.settings-advertisement-empty').hidden&&__adButton().disabled&&
  [...__adType().options].map(option=>option.value).join('|')==='image|video_file_url'&&
  !!document.querySelector('label[for="'+__adSource().id+'"]'));
 await run(()=>{__adInput('javascript:alert(1)');__adButton().click();});
 await verify('Invalid media addresses cannot be submitted',()=>__adRequests.length===0&&!__adSource().checkValidity());
 await run(()=>{
  __adInput('/static/icons/court.svg');__adButton().click();__adButton().click();
 });
 await verify('Adding sends one request with the supported BUP type and guards duplicate clicks',()=>
  __adRequests.length===1&&__adRequests[0].message.type==='advertisement_add'&&__adRequests[0].message.tournament_key==='preview'&&
  __adRequests[0].message.advertisement.type==='image'&&__adRequests[0].message.advertisement.disabled===false&&
  !!__adRequests[0].message.advertisement.id&&document.querySelector('.settings-advertisement-form').disabled&&__adButton().disabled&&
  document.querySelector('.live_settings_status').textContent.includes('gespeichert')===false);
 await run(()=>__adRequests.shift().callback({message:'Synthetic save error'}));
 await verify('A failed addition keeps the draft and enables retry with an inline error',()=>
  __adSource().value==='/static/icons/court.svg'&&!__adButton().disabled&&!document.querySelector('.settings-advertisement-form').disabled&&
  !document.querySelector('.settings-advertisement-url-options .settings-advertisement-error').hidden&&!document.querySelector('.settings-advertisement-url-options .settings-advertisement-error').textContent.includes('Synthetic'));
 await run(()=>{
  __adButton().click();const request=__adRequests.shift(), ad={...request.message.advertisement,_id:'ad-image'};
  __adAdd(ad);request.callback(null,{advertisement:ad});
 });
 await wait(()=>__adRow('ad-image')?.querySelector('img')?.naturalWidth>0);
 await verify('A broadcast followed by a save reply adds one item and finishes the shared save status',()=>
  curt.advertisements.length===1&&document.querySelectorAll('.settings-advertisement').length===1&&__adSource().value===''&&__adButton().disabled&&
  document.querySelector('.live_settings_status').textContent==='Alle Änderungen gespeichert'&&
  __adRow('ad-image').querySelector('.settings-advertisement-state').textContent==='Aktiv');
 await run(()=>{
  window.__adImage=__adRow('ad-image').querySelector('img');window.__adField=__adSource();__adInput('Entwurf bleibt erhalten');
  __adAdd({...curt.advertisements[0]});
  __adAdd({_id:'ad-video',id:'video',type:'video_file_url',url:'/static/example.mp4',disabled:true});
 });
 await verify('Live additions retain the draft and existing image and show video controls without autoplay',()=>
  __adSource()===__adField&&__adSource().value==='Entwurf bleibt erhalten'&&__adRow('ad-image').querySelector('img')===__adImage&&
  curt.advertisements.length===2&&__adRow('ad-video').querySelector('video').controls&&__adRow('ad-video').querySelector('video').muted&&
  !__adRow('ad-video').querySelector('video').autoplay&&__adRow('ad-video').querySelector('video').preload==='none'&&
  __adRow('ad-video').querySelector('.settings-advertisement-state').textContent==='Inaktiv');
 await run(()=>{
  window.__adVideo=__adRow('ad-video').querySelector('video');window.__adPaused=0;__adVideo.pause=()=>__adPaused++;
  document.querySelector('.settings-area-link[href$="/edit/btp"]').click();
 });
 await wait(()=>__adPaused>0);
 await run(()=>document.querySelector('.settings-area-link[href$="/edit/advertisements"]').click());
 await verify('Changing sections pauses video playback and retains the page and draft',()=>
  document===__adDocument&&btsSpeechService===__adSpeech&&__adSource()===__adField&&__adSource().value==='Entwurf bleibt erhalten'&&
  __adRow('ad-video').querySelector('video')===__adVideo);
 await run(()=>__adAdd({_id:'ad-unknown',id:'legacy',type:'legacy',url:'javascript:alert(1)',disabled:false}));
 await verify('Unknown legacy types remain visible and deletable without embedding unsafe media',()=>
  __adRow('ad-unknown').querySelector('h3').textContent.includes('Unbekannter Typ')&&
  !__adRow('ad-unknown').querySelector('img,video,a')&&!__adRow('ad-unknown').querySelector('button').disabled);
 await capture('einstellungen-werbung',true);
 await run(()=>{__adRow('ad-image').querySelector('button svg').dispatchEvent(new MouseEvent('click',{bubbles:true}));__adRow('ad-image').querySelector('button').click();});
 await verify('Deleting through the icon targets the stored record and prevents duplicate requests',()=>
  __adRequests.length===1&&__adRequests[0].message.type==='advertisement_remove'&&__adRequests[0].message.advertisement_id==='ad-image'&&
  __adRow('ad-image').querySelector('button').disabled);
 await run(()=>__adRequests.shift().callback({message:'Synthetic delete failure'}));
 await verify('A failed deletion retains its media and offers retry without losing the add draft',()=>
  !!__adRow('ad-image')&&!__adRow('ad-image').querySelector('button').disabled&&!__adRow('ad-image').querySelector('.settings-advertisement-error').hidden&&
  __adSource().value==='Entwurf bleibt erhalten');
 await run(()=>{
  __adRow('ad-image').querySelector('button').click();const request=__adRequests.shift();__adRemove('ad-image');request.callback(null,{});
 });
 await verify('A successful deletion removes one row and leaves other media and the draft mounted',()=>
  !__adRow('ad-image')&&curt.advertisements.length===2&&__adRow('ad-video').querySelector('video')===__adVideo&&__adSource().value==='Entwurf bleibt erhalten');
 await run(()=>{
  __adInput('  /static/video.mp4  ');__adType().value='video_file_url';__adSource().dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  const request=__adRequests.shift();window.__adSubmitted=request.message.advertisement;
  request.callback(null,{advertisement:{...__adSubmitted,_id:'ad-new-video'}});
 });
 await verify('Enter supports video additions and a save reply updates the list even before a broadcast',()=>
  __adSubmitted.type==='video_file_url'&&__adSubmitted.url==='/static/video.mp4'&&!!__adRow('ad-new-video')&&__adSource().value==='');
 await run(()=>{
  window.__adMutations=0;window.__adObserver=new MutationObserver(items=>__adMutations+=items.length);
  __adObserver.observe(document.querySelector('.settings-advertisement-list'),{childList:true,subtree:true});
  __adAdd({...curt.advertisements.find(item=>item._id==='ad-new-video')});
 });
 await verify('Overlapping broadcast and response updates never duplicate a saved advertisement',()=>
  curt.advertisements.filter(item=>item._id==='ad-new-video').length===1&&document.querySelectorAll('[data-advertisement-id="ad-new-video"]').length===1&&__adMutations===0);
 await run(()=>__adObserver.disconnect());
 for(const width of [1920,950,390,320]) {
  await metrics(width,1000);
  await verify('The advertisement cards and controls fit at '+width+' px',()=>
   document.documentElement.scrollWidth<=innerWidth+1&&[...document.querySelectorAll('.settings-advertisement-preview,.settings-advertisement-add,.settings-advertisement-actions button')]
    .every(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1;}));
  if(width===390)await capture('einstellungen-werbung-mobil',true);
 }
 await run(()=>{
  __adInput('/static/icons/court.svg');__adType().value='image';__adButton().click();
  document.querySelector('.leitstand-nav a[href$="/devices"]').click();
 });
 await wait(()=>!document.querySelector('.page-settings'));
 await run(()=>__adRequests.shift().callback(null,{advertisement:{_id:'too-late',id:'late',type:'image',url:'/static/icons/court.svg'}}));
 await verify('Leaving disposes media and ignores late replies while retaining the document and speech service',()=>
  !document.querySelector('.settings-advertisements')&&document===__adDocument&&btsSpeechService===__adSpeech&&
  !curt.advertisements.some(item=>item._id==='too-late')&&__adExceptions.length===0);
};
