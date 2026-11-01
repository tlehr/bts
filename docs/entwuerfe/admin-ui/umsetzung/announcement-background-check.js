'use strict';

module.exports=async function({c,verify,click,eventually,pause,metrics}) {
 const set=text=>c.evaluate('__announcementSet('+JSON.stringify(text)+')');
 await c.evaluate(String.raw`window.__announcementPending=()=>document.querySelector('.announcement-pending')`);
 // Reproduce the two top cards in the reported layout. Taller unrelated cards
 // must not mask a height regression in the announcement card.
 await click('.board-toolbar-actions [data-action="layout-edit"]');
 for(const id of ['rotation','device','automation','tablets','logs'])await click('[data-board-card="'+id+'"] [data-action="layout-card-hide"]');
 await click('[data-layout-editor] [data-action="layout-edit"]');

 await set('Dieser bestätigte Text wartet im Hintergrund.');await c.evaluate(String.raw`__announcementBefore()`);
 await click('#local_announce_btn');await click('.announcement-background-button');
 await verify('Background waiting closes the dialog, unlocks the board and leaves an accessible cancellable job in the card',String.raw`!__announcementMenu().open&&getComputedStyle(document.body).overflowY!=='hidden'&&!__announcementPending().hidden&&__announcementPending().querySelector('.announcement-pending-status').textContent.includes('Lokal')&&document.activeElement.matches('.announcement-pending-cancel')&&document.querySelector('#local_announce_btn').disabled&&document.querySelector('#remote_announce_btn').disabled&&__localAnnouncements.length===__announcementPlayCount`);
 await verify('A background job keeps actual-call priority without starting playback early',String.raw`__speechPreparationRequests.at(-1).urgent&&__speechPreparationRequests.at(-1).parts[0]==='Dieser bestätigte Text wartet im Hintergrund.'&&__localAnnouncements.length===__announcementPlayCount`);
 await c.evaluate(String.raw`(()=>{const field=document.querySelector('#custom_announcement');field.value='Ein neuer Entwurf während des Wartens.';field.dispatchEvent(new Event('input'));field.focus();})()`);
 await verify('Editing a new draft preserves the confirmed background text and destination',String.raw`!__announcementPending().hidden&&__announcementPending().querySelector('.announcement-pending-text').textContent==='Dieser bestätigte Text wartet im Hintergrund.'&&document.querySelector('#custom_announcement').value==='Ein neuer Entwurf während des Wartens.'`);
 await c.evaluate(String.raw`__speechFixture.status='completed';btsSpeechReadiness.refresh(true)`);await eventually('__localAnnouncements.length===__announcementPlayCount+1');await pause();
 await verify('The original background text plays exactly once without overwriting the new draft or stealing focus',String.raw`__localAnnouncements.length===__announcementPlayCount+1&&__localAnnouncements.at(-1).parts[0]==='Dieser bestätigte Text wartet im Hintergrund.'&&__localAnnouncements.at(-1).speechMode==='server'&&__announcementPending().hidden&&!__announcementMenu().open&&!document.querySelector('#local_announce_btn').disabled&&document.querySelector('#custom_announcement').value==='Ein neuer Entwurf während des Wartens.'&&document.activeElement.id==='custom_announcement'`);

 await set('Remote im Hintergrund, während ein anderer Dialog offen ist.');await c.evaluate(String.raw`__announcementBefore()`);
 await click('#remote_announce_btn');await click('.announcement-background-button');
 await click('tr[data-match_id="match-45"] .preparation_debug_icon');
 await c.evaluate(String.raw`document.querySelector('.ls-call-status-dialog .ls-dialog-footer button').focus();window.__backgroundOtherFocus=document.activeElement;__speechFixture.status='completed';btsSpeechReadiness.refresh(true)`);
 await eventually('__writes.filter(message=>message.type===\'free_announce\').length===__announcementWriteCount+1');
 await verify('Other tournament dialogs remain usable while a background announcement completes',String.raw`document.querySelector('.ls-call-status-dialog').open&&document.activeElement===__backgroundOtherFocus&&!__announcementMenu().open&&__announcementPending().hidden`);
 await verify('Remote background completion sends the selected text once with server output',String.raw`__writes.filter(message=>message.type==='free_announce').length===__announcementWriteCount+1&&__writes.filter(message=>message.type==='free_announce').at(-1).text==='Remote im Hintergrund, während ein anderer Dialog offen ist.'&&__writes.filter(message=>message.type==='free_announce').at(-1).speech_mode==='server'&&__localAnnouncements.length===__announcementPlayCount`);
 await click('.ls-call-status-dialog .ls-dialog-footer button');

 await set('Doppelten Start im Hintergrund verhindern.');await c.evaluate(String.raw`__announcementBefore()`);
 await click('#local_announce_btn');await click('.announcement-background-button');
 await c.evaluate(String.raw`window.__backgroundPrepareCount=__speechPrepared.length`);
 await c.evaluate(String.raw`__announcementMenu().querySelector('.announcement-background-button').click();__announcementMenu().querySelector('.announcement-background-button').click()`);
 await verify('Repeated activation cannot restart an existing background preparation',String.raw`!__announcementMenu().open&&!__announcementPending().hidden&&__speechPrepared.length===__backgroundPrepareCount`);
 await click('.announcement-pending-cancel');await c.evaluate(String.raw`__speechFixture.status='completed'`);await pause();
 await verify('Cancelling in the card prevents later output and re-enables the playback controls',String.raw`__announcementPending().hidden&&!document.querySelector('#local_announce_btn').disabled&&!document.querySelector('#remote_announce_btn').disabled&&__localAnnouncements.length===__announcementPlayCount`);

 await set('Bestätigten Auftrag nach Leeren des Entwurfs abbrechen.');await c.evaluate(String.raw`__announcementBefore()`);
 await click('#local_announce_btn');await click('.announcement-background-button');
 await c.evaluate(String.raw`document.querySelector('#custom_announcement').value='';document.querySelector('#custom_announcement').dispatchEvent(new Event('input'))`);
 await verify('Clearing the draft does not silently discard a confirmed background job',String.raw`!__announcementPending().hidden&&__announcementPending().querySelector('.announcement-pending-text').textContent==='Bestätigten Auftrag nach Leeren des Entwurfs abbrechen.'`);
 await click('.announcement-pending-cancel');
 await verify('Cancelling with an empty draft returns focus to the text field and keeps empty playback controls disabled',String.raw`__announcementPending().hidden&&document.activeElement.id==='custom_announcement'&&document.querySelector('#local_announce_btn').disabled&&document.querySelector('#remote_announce_btn').disabled&&__localAnnouncements.length===__announcementPlayCount`);

 await set('Fehlgeschlagenen Hintergrundauftrag erneut versuchen.');await c.evaluate(String.raw`__announcementBefore()`);
 await click('#local_announce_btn');await click('.announcement-background-button');await c.evaluate(String.raw`__speechFixture.status='failed'`);
 await eventually('__announcementPending().classList.contains(\'is-error\')');
 await verify('Background generation errors stay in the card with retry and cancel instead of reopening the dialog',String.raw`!__announcementMenu().open&&!__announcementPending().hidden&&__announcementPending().querySelector('.announcement-pending-status').getAttribute('role')==='alert'&&!__announcementPending().querySelector('.announcement-pending-retry').hidden&&!__announcementPending().querySelector('.announcement-pending-retry').disabled&&!__announcementPending().querySelector('.announcement-pending-cancel').disabled`);
 await c.evaluate(String.raw`(()=>{const field=document.querySelector('#custom_announcement');field.value='Neuer Entwurf nach dem Fehler.';field.dispatchEvent(new Event('input'));__speechFixture.status='queued';})()`);
 await click('.announcement-pending-retry');
 await verify('A background retry requests the original confirmed text at actual-call priority',String.raw`__speechPreparationRequests.at(-1).urgent&&__speechPreparationRequests.at(-1).parts[0]==='Fehlgeschlagenen Hintergrundauftrag erneut versuchen.'&&!__announcementMenu().open`);
 await c.evaluate(String.raw`__speechFixture.status='completed'`);await eventually('__localAnnouncements.length===__announcementPlayCount+1');
 await verify('Background retry completes once and retains the separate draft',String.raw`__localAnnouncements.at(-1).parts[0]==='Fehlgeschlagenen Hintergrundauftrag erneut versuchen.'&&__localAnnouncements.at(-1).speechMode==='server'&&__announcementPending().hidden&&document.querySelector('#custom_announcement').value==='Neuer Entwurf nach dem Fehler.'`);

 await set('Fehler beim Anfordern im Hintergrund.');await c.evaluate(String.raw`btsSpeechService.prepare=async()=>null;__announcementBefore()`);
 await click('#local_announce_btn');await click('.announcement-background-button');
 await eventually('__announcementPending().classList.contains(\'is-error\')');
 await verify('Failed background preparation requests remain visible without a blocking popup',String.raw`!__announcementMenu().open&&!__announcementPending().hidden&&__announcementPending().querySelector('.announcement-pending-status').textContent.includes('nicht angefordert')&&__localAnnouncements.length===__announcementPlayCount`);
 await click('.announcement-pending-cancel');await c.evaluate(String.raw`btsSpeechService.prepare=__announcementPrepare`);

 await set('Geänderte Einstellungen verwerfen den Hintergrundauftrag.');await c.evaluate(String.raw`__announcementBefore()`);
 await click('#remote_announce_btn');await click('.announcement-background-button');
 await c.evaluate(String.raw`__speechFixture.settings.voice='hallensprecher';btsSpeechReadiness.changed(true);btsSpeechReadiness.refresh(true)`);
 await verify('Changing speech settings cancels background playback as well',String.raw`!__announcementMenu().open&&__announcementPending().hidden&&!document.querySelector('#remote_announce_btn').disabled`);
 await c.evaluate(String.raw`__speechFixture.status='completed'`);await pause();
 await verify('An invalidated background job cannot send a late remote announcement',String.raw`__writes.filter(message=>message.type==='free_announce').length===__announcementWriteCount`);

 await c.evaluate(String.raw`(()=>{
  window.__announcementLayout=()=>Object.fromEntries([
   ['announcement','[data-board-card="announcement"]'],['operators','[data-board-card="operators"]'],
   ['controls','.board-controls'],['games','.board-games'],
   ['text','#custom_announcement'],['buttons','.announcements_btn_container'],
  ].map(([name,selector])=>{const r=document.querySelector(selector).getBoundingClientRect();return [name,name==='games'?[r.top+scrollY]:[r.left+scrollX,r.top+scrollY,r.width,r.height]];}));
  window.__announcementLayoutStable=()=>Object.entries(__announcementLayout()).every(([name,values])=>values.every((value,index)=>Math.abs(value-__announcementLayoutBefore[name][index])<.5));
 })()`);
 for(const [width,height]of [[1920,1080],[390,844],[320,568]]) {
  await metrics(width,height);
  await set('Ein langer Hintergrundauftrag mit einem sehr langen Text, damit die Anzeige in schmalen Kacheln geprüft werden kann und weiterhin abbrechbar bleibt.');
  await verify('Record the idle two-card top layout at '+width,String.raw`(()=>{window.__announcementLayoutBefore=__announcementLayout();return __announcementPending().hidden&&document.querySelector('[data-card-zone="top"]').dataset.cardCount==='2';})()`);
  await click('#local_announce_btn');await click('.announcement-background-button');
  await verify('Background waiting preserves both top card heights, the text area and the games position at '+width,String.raw`!__announcementPending().hidden&&__announcementLayoutStable()`);
  await c.evaluate(String.raw`__announcementPending().scrollIntoView({block:'center'})`);
  await verify('The background controls fit inside the existing text area and remain clickable at '+width,String.raw`(()=>{const p=__announcementPending(),r=p.getBoundingClientRect(),field=document.querySelector('#custom_announcement').getBoundingClientRect();return p.scrollWidth<=p.clientWidth&&r.left>=field.left&&r.right<=field.right&&r.top>=field.top&&r.bottom<=field.bottom&&[...p.querySelectorAll('button')].filter(button=>!button.hidden).every(button=>{const b=button.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom&&button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})})()`);
  await verify('The complete confirmed text and status remain available in the compact job at '+width,String.raw`(()=>{const p=__announcementPending(),cancel=p.querySelector('.announcement-pending-cancel'),description=cancel.getAttribute('aria-describedby').split(' ').map(id=>document.getElementById(id).textContent).join(' ');return p.title.includes(p.querySelector('.announcement-pending-text').textContent)&&p.title.includes(p.querySelector('.announcement-pending-status').textContent)&&description.includes('Lokal')&&description.includes(p.querySelector('.announcement-pending-text').textContent);})()`);
  await c.evaluate(String.raw`__speechFixture.status='failed'`);await eventually('__announcementPending().classList.contains(\'is-error\')');
  await verify('An error and its retry button do not enlarge the top cards or move the games at '+width,String.raw`__announcementLayoutStable()&&!__announcementPending().querySelector('.announcement-pending-retry').hidden&&(()=>{const p=__announcementPending(),r=p.getBoundingClientRect();return p.scrollWidth<=p.clientWidth&&[...p.querySelectorAll('button')].every(button=>{const b=button.getBoundingClientRect();return b.left>=r.left&&b.right<=r.right&&b.top>=r.top&&b.bottom<=r.bottom&&button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2));})})()`);
  await c.evaluate(String.raw`__speechFixture.status='queued'`);await click('.announcement-pending-retry');
  await verify('Retrying retains the idle top layout at '+width,String.raw`!__announcementPending().hidden&&__announcementLayoutStable()`);
  await click('.announcement-pending-cancel');
  await verify('Cancelling restores the full text area without shifting the top layout at '+width,String.raw`__announcementPending().hidden&&__announcementLayoutStable()`);
 }
 await metrics(1920,1080);

 await set('Hintergrundauftrag beim Verlassen der Seite.');await c.evaluate(String.raw`btsSpeechService.prepare=()=>new Promise(resolve=>{window.__backgroundRelease=resolve});__announcementBefore()`);
 await click('#local_announce_btn');await click('.announcement-background-button');
 await c.evaluate(String.raw`document.querySelector('#custom_announcement').closest('form').remove()`);
 await verify('Leaving the form disposes a hidden background job and its card controls',String.raw`!document.querySelector('.announcement-pending')&&!document.querySelector('.announcement-playback-menu')&&__localAnnouncements.length===__announcementPlayCount`);
 await c.evaluate(String.raw`__backgroundRelease();new Promise(resolve=>setTimeout(resolve,50))`);
 await verify('Resolving a disposed background request cannot resume playback',String.raw`__localAnnouncements.length===__announcementPlayCount`);
 await c.evaluate(String.raw`btsSpeechService.prepare=__announcementPrepare;ctournament.ui_show()`);
 await eventually('!!document.querySelector(\'#custom_announcement\')');
};
