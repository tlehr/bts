'use strict';

module.exports=async function({c,verify,click,metrics,key,capture}) {
 const footerFits='(()=>{const footer=document.querySelector(\'.match_edit_actions\'),dialog=document.querySelector(\'.ls-match-dialog\').getBoundingClientRect(),box=footer.getBoundingClientRect();return footer===__sharedFooter&&box.height>0&&box.top>=dialog.top&&box.bottom<=dialog.bottom&&[...footer.querySelectorAll(\'button,input\')].filter(control=>!control.closest(\'[hidden]\')).every(control=>control.form===__dialogForm&&control.getClientRects().length)})()';
 const sameSize='(()=>{const box=document.querySelector(\'.ls-match-dialog\').getBoundingClientRect();return Math.abs(box.width-__editSize.width)<.2&&Math.abs(box.height-__editSize.height)<.2})()';
 const reportFits='(()=>{const dialog=document.querySelector(\'.ls-match-dialog\').getBoundingClientRect(),page=document.querySelector(\'.ls-sheet-page\').getBoundingClientRect(),svg=document.querySelector(\'.ls-sheet-page svg\'),box=svg.getBoundingClientRect(),source=svg.viewBox.baseVal,footer=document.querySelector(\'.match_edit_actions\').getBoundingClientRect();return dialog.width<=innerWidth*.9+.2&&dialog.height<=innerHeight*.9+.2&&Math.abs(dialog.left+dialog.width/2-innerWidth/2)<.6&&Math.abs(dialog.top+dialog.height/2-innerHeight/2)<.6&&box.width>0&&box.height>0&&Math.abs(box.width/box.height-source.width/source.height)<.01&&box.left>=page.left-.2&&box.right<=page.right+.2&&box.top>=page.top-.2&&box.bottom<=page.bottom+.2&&box.bottom<=footer.top&&document.querySelector(\'.ls-dialog-expand\').getAttribute(\'aria-pressed\')===\'true\'})()';
 await c.evaluate('window.__sharedFooter=document.querySelector(\'.match_edit_actions\');window.__reportSvg=document.querySelector(\'.ls-sheet-page svg\');window.__windowWrites=__writes.length');
 for(const [width,height] of [[1920,1080],[1000,720],[390,844],[320,568],[844,390]]) {
  await metrics(width,height);await click('#ls-match-tab-1');
  await c.evaluate('window.__editSize=document.querySelector(\'.ls-match-dialog\').getBoundingClientRect()');
  for(const index of [0,2,3,1]) {
   await click('#ls-match-tab-'+index);
   await verify('All tabs retain the Edit dimensions and original working footer: '+index+' at '+width+' by '+height,sameSize+'&&'+footerFits);
  }
  await click('#ls-match-tab-2');await click('.ls-dialog-expand');
  await verify('Expanded report fits 90 percent of the viewport with its original aspect ratio at '+width+' by '+height,reportFits+'&&'+footerFits);
  if(width===1920)await capture('spiel-dialog-bericht-gross',true);
  if(width===390)await capture('spiel-dialog-bericht-mobil',true);
  await click('.ls-dialog-expand');
  await verify('The report toggle restores the Edit dimensions at '+width+' by '+height,sameSize+'&&!document.querySelector(\'.ls-match-dialog\').classList.contains(\'ls-sheet-expanded\')');
 }
 await metrics(1920,1080);await click('#ls-match-tab-2');await click('.ls-dialog-expand');
 await metrics(1000,720);
 await verify('An already expanded report adapts to viewport resizing without clipping or distortion',reportFits);
 await click('#ls-match-tab-0');
 await verify('Leaving the report clears expansion and hides its header button','!document.querySelector(\'.ls-match-dialog\').classList.contains(\'ls-sheet-expanded\')&&document.querySelector(\'.ls-dialog-expand\').hidden&&'+footerFits);
 await c.evaluate('document.querySelector(\'.ls-dialog-tabs button\').focus()');await key('Tab','Tab',9);
 await verify('Keyboard focus skips the hidden edit controls and reaches the remarks action in the common footer','document.activeElement===__sharedFooter.querySelector(\'.ls-remarks-toggle\')');
 await key('Enter','Enter',13,'\r');
 await verify('Keyboard activation opens the separate remarks window without changing the parent draft','document.querySelector(\'.ls-remarks-dialog\').open&&__dialogForm.elements.court_id.value===\'CH_13\'');
 await key('Escape','Escape',27);
 await verify('Keyboard Escape closes only the pristine remarks window and restores its footer opener','!document.querySelector(\'.ls-remarks-dialog\')&&document.activeElement===__sharedFooter.querySelector(\'.ls-remarks-toggle\')&&__dialogForm.isConnected');
 await click('#ls-match-tab-3');
 await verify('The shared footer has no BTP opt-out and hidden edit fields remain part of the same form','!__sharedFooter.querySelector(\'input,label\')&&!__dialogForm.elements.btp_update&&new FormData(__dialogForm).get(\'court_id\')===\'CH_13\'');
 await click('#ls-match-tab-2');
 await c.evaluate('window.__printCalls=0;window.__originalPrint=window.print;window.print=()=>{__printCalls++};document.querySelector(\'.match_scoresheet_buttons button:last-child\').click();window.print=__originalPrint');
 await verify('Printing is an independent action and tab changes preserve the original report and unsaved form','__printCalls===1&&__writes.length===__windowWrites&&document.querySelector(\'.ls-sheet-page svg\')===__reportSvg&&document.querySelector(\'.match_edit_dialog form\')===__dialogForm&&__dialogForm.elements.court_id.value===\'CH_13\'');
 await click('.ls-dialog-expand');
 await c.call('Emulation.setEmulatedMedia',{media:'print'});
 await verify('Expanded report printing hides the common footer and removes all viewport size constraints','getComputedStyle(__sharedFooter).display===\'none\'&&getComputedStyle(document.querySelector(\'.ls-match-dialog\')).maxWidth===\'none\'&&getComputedStyle(document.querySelector(\'.ls-match-dialog\')).maxHeight===\'none\'&&getComputedStyle(document.querySelector(\'.ls-sheet-page\')).containerType===\'normal\'&&getComputedStyle(document.querySelector(\'.ls-edit-panel\')).display===\'none\'&&document.querySelector(\'.ls-sheet-page svg\').getBoundingClientRect().width>0');
 await c.call('Emulation.setEmulatedMedia',{media:''});await click('.ls-dialog-expand');
 await metrics(1920,1080);
};
