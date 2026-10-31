'use strict';

module.exports = async function({c, verify, click, metrics, key, delay, capture, open}) {
 await open(1920, 1080);
 await c.evaluate(`window.__nativeDeleteConfirmations=0;window.confirm=()=>{__nativeDeleteConfirmations++;return false;};
  window.__deleteSend=window.send;window.__deleteRequests=[];
  window.send=(message,callback)=>message.type==='match_delete'?__deleteRequests.push({message,callback}):__deleteSend(message,callback);`);
 await click('tr[data-match_id="match-44"] .ls-match-open');await click('#ls-match-tab-1');
 await c.evaluate(`const field=document.querySelector('.match_edit_dialog form').elements.court_id;field.value='CH_13';field.dispatchEvent(new Event('change',{bubbles:true}));`);
 await click('.match_edit_delete_button');
 await verify('Deletion uses our modal alert dialog with an accessible heading, explanation and explicit footer actions', `(()=>{
  const dialog=document.querySelector('.bts-confirm-dialog');return dialog?.open&&dialog.matches(':modal')&&dialog.getAttribute('role')==='alertdialog'&&
  getComputedStyle(dialog).borderTopWidth==='2px'&&getComputedStyle(dialog).borderTopColor==='rgb(125, 46, 41)'&&
  dialog.querySelector('.bts-confirm-heading>svg.bts-confirm-warning[aria-hidden="true"][focusable="false"] path')&&
  document.getElementById(dialog.getAttribute('aria-labelledby')).textContent==='Spiel 44 lokal aus BTS löschen?'&&getComputedStyle(dialog.querySelector('h2')).color==='rgb(255, 255, 255)'&&getComputedStyle(dialog.querySelector('h2')).backgroundColor==='rgb(175, 69, 62)'&&
  document.getElementById(dialog.getAttribute('aria-describedby')).classList.contains('bts-confirm-content')&&
  dialog.querySelector('.bts-confirm-cancel').textContent==='Abbrechen'&&dialog.querySelector('.bts-confirm-accept').textContent==='Spiel löschen'&&__nativeDeleteConfirmations===0&&__deleteRequests.length===0;
 })()`);
 await verify('The entire explanation fits on a large screen and retains all four consequences and the final undo warning', `(()=>{
  const content=document.querySelector('.bts-confirm-content');return content.scrollHeight<=content.clientHeight+1&&content.querySelectorAll('li').length===4&&
  ['Zählhistorie','Feldbelegung','keinen Spielabschluss','Folgespiele','BTP','Logeinträge','keine Rückgängig-Funktion'].every(part=>content.textContent.includes(part));
 })()`);
 await verify('Cancel has initial focus and the background draft remains intact', `document.activeElement.matches('.bts-confirm-cancel')&&document.querySelector('.match_edit_dialog form').elements.court_id.value==='CH_13'&&!document.querySelector('.match_save_button').disabled`);
 await key('Tab', 'Tab', 9);
 await verify('Tab moves to the deliberate destructive action within the confirmation', `document.activeElement.matches('.bts-confirm-accept')`);
 await key('Tab', 'Tab', 9);await key('Tab', 'Tab', 9);
 await verify('Keyboard focus cycles through the scrollable explanation and back to Cancel', `document.activeElement.matches('.bts-confirm-cancel')`);
 await key('Enter', 'Enter', 13, '\r');
 await verify('Enter on the initially safe action cancels without losing the game draft', `!document.querySelector('.bts-confirm-dialog')&&!!document.querySelector('.match_edit_dialog')&&__deleteRequests.length===0&&document.querySelector('.match_edit_dialog form').elements.court_id.value==='CH_13'`).catch(async error=>{throw new Error(error.message+' '+JSON.stringify(await c.evaluate("({confirmation:!!document.querySelector('.bts-confirm-dialog'),game:!!document.querySelector('.match_edit_dialog'),requests:__deleteRequests.length,court:document.querySelector('.match_edit_dialog form')?.elements.court_id.value,focus:document.activeElement.className})")));});
 await click('.match_edit_delete_button');await key('Escape', 'Escape', 27);
 await verify('Escape closes only the confirmation and restores focus to Delete without a native prompt', `!document.querySelector('.bts-confirm-dialog')&&!!document.querySelector('.match_edit_dialog')&&document.activeElement.matches('.match_edit_delete_button')&&__nativeDeleteConfirmations===0&&__deleteRequests.length===0`);
 await click('.match_edit_delete_button');
 await c.call('Input.dispatchMouseEvent', {type: 'mousePressed', x: 3, y: 3, button: 'left', clickCount: 1});
 await c.call('Input.dispatchMouseEvent', {type: 'mouseReleased', x: 3, y: 3, button: 'left', clickCount: 1});
 await verify('Clicking the backdrop cancels only the confirmation and sends nothing', `!document.querySelector('.bts-confirm-dialog')&&!!document.querySelector('.match_edit_dialog')&&__deleteRequests.length===0`);
 await c.evaluate(`document.querySelector('.match_edit_delete_button').click();document.querySelector('.match_edit_delete_button').click();`);
 await verify('Repeated clicks create one confirmation and never submit implicitly', `document.querySelectorAll('.bts-confirm-dialog').length===1&&__deleteRequests.length===0`);
 await metrics(1920, 1080);await capture('spiel-loeschen', true);
 for (const [width, height] of [[1000, 720], [390, 844], [320, 568], [568, 320]]) {
  await metrics(width, height);
  await verify('Confirmation, heading and both actions remain on screen without horizontal overflow at '+width+' × '+height, `(()=>{
   const dialog=document.querySelector('.bts-confirm-dialog'),box=dialog.getBoundingClientRect(),content=dialog.querySelector('.bts-confirm-content');
   return box.left>=15.5&&box.top>=15.5&&box.right<=innerWidth-15.5&&box.bottom<=innerHeight-15.5&&
    dialog.scrollWidth<=dialog.clientWidth+1&&content.scrollWidth<=content.clientWidth+1&&
    [...dialog.querySelectorAll('h2,button')].every(node=>{const r=node.getBoundingClientRect();return r.top>=box.top&&r.bottom<=box.bottom&&r.left>=box.left&&r.right<=box.right;});
  })()`);
  await c.evaluate(`(()=>{window.__confirmFooterTop=document.querySelector('.bts-confirm-actions').getBoundingClientRect().top;const content=document.querySelector('.bts-confirm-content');content.scrollTop=content.scrollHeight;})()`);
  await verify('The final text is reachable by scrolling while the actions stay fixed at '+width+' × '+height, `(()=>{
   const content=document.querySelector('.bts-confirm-content'),last=content.lastElementChild,box=content.getBoundingClientRect(),text=last.getBoundingClientRect();
   return text.bottom<=box.bottom+.5&&text.top>=box.top-.5&&Math.abs(document.querySelector('.bts-confirm-actions').getBoundingClientRect().top-__confirmFooterTop)<.5;
  })()`);
  if (width===390) await capture('spiel-loeschen-mobil', true);
 }
 await c.evaluate(`(()=>{window.__confirmScroll=scrollY;const content=document.querySelector('.bts-confirm-content');content.scrollTop=0;content.focus();})()`);
 await key('PageDown', 'PageDown', 34);await delay(150);
 await verify('Keyboard scrolling reaches the long explanation without moving the tournament page', `document.querySelector('.bts-confirm-content').scrollTop>0&&scrollY===__confirmScroll`);
 await capture('spiel-loeschen-querformat', true);
 await click('.bts-confirm-cancel');await metrics(1920, 1080);
 await click('.match_edit_delete_button');await key('Tab', 'Tab', 9);await key('Enter', 'Enter', 13, '\r');
 await verify('Explicit keyboard approval sends exactly one deletion and enters the normal pending state', `!document.querySelector('.bts-confirm-dialog')&&__deleteRequests.length===1&&__deleteRequests[0].message.id==='match-44'&&__deleteRequests[0].message.tournament_key==='preview'&&document.querySelector('.match_edit_delete_button').disabled`);
 await c.evaluate(`__deleteRequests[0].callback({message:'Synthetic delete failure'});__deleteRequests=[];`);
 await verify('A failed confirmed deletion preserves the draft and requires a fresh confirmation on retry', `!!document.querySelector('.match_edit_dialog')&&!document.querySelector('.bts-confirm-dialog')&&!document.querySelector('.match_edit_delete_button').disabled&&document.querySelector('.match_edit_dialog form').elements.court_id.value==='CH_13'`);
 await click('.match_edit_delete_button');
 await click('tr[data-match_id="match-45"] .ls-match-open');
 await verify('Replacing the underlying game disposes its confirmation and cannot delete the replacement', `!document.querySelector('.bts-confirm-dialog')&&document.querySelector('.match_edit_dialog').dataset.editMatch_id==='match-45'&&__deleteRequests.length===0`);
 await click('.match_edit_cancel_button');

 // The shared confirmation API must also clean up when its owner disappears
 // without going through a normal dialog close, and must not interpret text as HTML.
 await c.evaluate(`window.__confirmOwner=document.createElement('div');document.body.append(__confirmOwner);window.__removedOwnerAnswer=null;
  btsDialogActions.confirm({owner:__confirmOwner,title:'Text <img src=x>',message:'• <script>unsafe</script>',confirmLabel:'OK',cancelLabel:'Cancel'}).then(answer=>__removedOwnerAnswer=answer);void 0;`);
 await verify('Neutral confirmations retain the normal heading and treat supplied content as plain text', `!document.querySelector('.bts-confirm-dialog.is-danger,.bts-confirm-dialog img,.bts-confirm-dialog script,.bts-confirm-warning')&&getComputedStyle(document.querySelector('.bts-confirm-heading')).color==='rgb(255, 255, 255)'&&getComputedStyle(document.querySelector('.bts-confirm-heading')).backgroundColor==='rgb(14, 90, 99)'&&document.querySelector('.bts-confirm-content li').textContent==='<script>unsafe</script>'`);
 await c.evaluate('__confirmOwner.remove()');
 await verify('Removing the owner cancels the outstanding confirmation and removes its modal', `__removedOwnerAnswer===false&&!document.querySelector('.bts-confirm-dialog')`);
 await c.evaluate('window.send=__deleteSend');
};
