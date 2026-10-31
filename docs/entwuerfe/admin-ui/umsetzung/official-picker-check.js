'use strict';

module.exports=async function({c,verify,click,metrics,key,delay,capture}) {
 await c.evaluate(`(()=>{
  window.__officialOriginal=curt.umpires;
  window.__officialForm=document.querySelector('.match_edit_dialog form');
  window.__officialSelect=role=>__officialForm.elements[role+'_name'];
  window.__officialInput=role=>__officialSelect(role).closest('.ls-official-picker').querySelector('.ls-official-input');
  window.__officialPopup=role=>document.getElementById(__officialInput(role).getAttribute('aria-controls'));
  window.__officialVisible=role=>[...__officialPopup(role).querySelectorAll('.ls-official-option')].filter(row=>!row.hidden);
  window.__officialOpen=role=>{__officialInput(role).focus();__officialInput(role).click();};
  window.__officialSearch=(role,text)=>{__officialOpen(role);__officialInput(role).value=text;__officialInput(role).dispatchEvent(new Event('input',{bubbles:true}));};
  window.__officialChoose=(role,name)=>{const select=__officialSelect(role),option=[...select.options].find(option=>option.value===name),popup=__officialPopup(role);const row=[...popup.querySelectorAll('.ls-official-option')].find(row=>row.querySelector('.ls-official-option-label').textContent===option.textContent);row.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));row.click();};
 })()`);
 await verify('Both official fields use labelled comboboxes with hidden canonical form values and role icons','[\'umpire\',\'service_judge\'].every(role=>{const select=__officialSelect(role),input=__officialInput(role);return select.hidden&&input.getAttribute(\'role\')===\'combobox\'&&input.closest(\'label\').htmlFor===input.id&&input.previousElementSibling.querySelector(\'svg\')})&&__officialForm.elements.show_all_officials.closest(\'label\').hidden');
 await c.evaluate('__officialOpen(\'umpire\')');
 await verify('Opening the assigned umpire with no search shows every official once, including pause and on-court entries','(()=>{const options=__officialVisible(\'umpire\'),names=options.map(row=>row.querySelector(\'.ls-official-option-label\').textContent);return !__officialPopup(\'umpire\').hidden&&curt.umpires.every(person=>names.some(name=>name.startsWith(person.name)))&&options.length===new Set(options.map(row=>row.textContent)).size&&!!__officialPopup(\'umpire\').querySelector(\'.ls-official-group:not([hidden])\')})()');
 await verify('Each list entry uses the icon of its actual official role','(()=>{const entries=__officialVisible(\'umpire\'),umpire=entries.find(row=>row.querySelector(\'.ls-official-option-label\').textContent===\'Anton Anderson\'),service=entries.find(row=>row.textContent.startsWith(\'Bertha Baller\'));return umpire.querySelector(\'.ls-official-icon svg circle\')&&!service.querySelector(\'.ls-official-icon svg circle\')&&service.querySelector(\'.ls-official-icon svg path\')})()');
 await require('./official-status-check')({c,verify,delay,capture});
 await c.evaluate('curt.umpires=[...curt.umpires,{_id:\'official-search-test\',name:\'Jörg Müller\',is_umpire:true,is_service_judge:true},{_id:\'official-safe-text\',name:\'<img src=x> Official\',is_umpire:true}];btsOfficialPicker.closeAll();__officialSearch(\'umpire\',\'JORG MULLER\')');
 await verify('Reopening reads newly registered officials and filters case and accents without a minimum query length','__officialVisible(\'umpire\').length===2&&__officialVisible(\'umpire\')[0].textContent===\'Jörg Müller\'');
 await c.evaluate('window.__officialCached=__officialVisible(\'umpire\')[0];__officialSearch(\'umpire\',\'j\')');
 await verify('Searching retains the existing matching row instead of rebuilding it','__officialVisible(\'umpire\').includes(__officialCached)&&__officialPopup(\'umpire\').querySelectorAll(\'img\').length===0');
 await c.evaluate('__officialSearch(\'umpire\',\'zzzz-no-match\')');
 await key('Enter','Enter',13);
 await verify('No-match text is explicit and arbitrary typed text cannot replace the assigned official','!__officialPopup(\'umpire\').querySelector(\'.ls-official-empty\').hidden&&__officialSelect(\'umpire\').value===\'Sven Weber\'&&document.querySelector(\'.match_edit_dialog\')');
 await key('Escape','Escape',27);
 await verify('Escape closes only the options and restores the selected name while the game stays open','__officialPopup(\'umpire\').hidden&&__officialInput(\'umpire\').value===\'Sven Weber\'&&__officialInput(\'umpire\').getAttribute(\'aria-expanded\')===\'false\'&&document.querySelector(\'.match_edit_dialog\')');
 await c.evaluate('__officialSearch(\'umpire\',\'\')');
 await verify('An empty query restores all officials and renders user names as plain text','__officialVisible(\'umpire\').some(row=>row.textContent===\'<img src=x> Official\')&&!__officialPopup(\'umpire\').querySelector(\'img\')');
 await c.evaluate('__officialChoose(\'umpire\',\'Kim Wolf\')');
 await verify('Choosing the current service judge as umpire swaps both canonical roles and displayed values','__officialSelect(\'umpire\').value===\'Kim Wolf\'&&__officialSelect(\'service_judge\').value===\'Sven Weber\'&&__officialInput(\'umpire\').value===\'Kim Wolf\'&&__officialInput(\'service_judge\').value===\'Sven Weber\'');
 await c.evaluate('__officialOpen(\'service_judge\');__officialChoose(\'service_judge\',\'Kim Wolf\')');
 await verify('The opposite role swap also retains two distinct officials','__officialSelect(\'umpire\').value===\'Sven Weber\'&&__officialSelect(\'service_judge\').value===\'Kim Wolf\'');
 await c.evaluate('__officialOpen(\'umpire\')');await key('End','End',35);await key('Enter','Enter',13);
 await verify('Keyboard clearing the umpire also releases and disables the service judge','__officialSelect(\'umpire\').value===\'\'&&__officialSelect(\'service_judge\').value===\'\'&&__officialInput(\'service_judge\').disabled&&__officialSelect(\'service_judge\').disabled&&__officialPopup(\'service_judge\').hidden');
 await c.evaluate('__officialSearch(\'umpire\',\'jorg\')');await key('ArrowDown','ArrowDown',40);await key('Home','Home',36);await key('Enter','Enter',13);
 await verify('Keyboard selection assigns the highlighted registered official and enables the second role','__officialSelect(\'umpire\').value===\'Jörg Müller\'&&!__officialInput(\'service_judge\').disabled&&__officialPopup(\'umpire\').hidden');
 await c.evaluate('__officialOpen(\'umpire\')');await key('Tab','Tab',9);await delay(180);
 await verify('Tab leaves the combobox and closes its list without submitting the game','__officialPopup(\'umpire\').hidden&&document.querySelector(\'.match_edit_dialog\')&&__officialForm===document.querySelector(\'.match_edit_dialog form\')');
 for(const [width,height] of [[1920,1080],[390,844],[320,568],[844,390]]) {
  await metrics(width,height);
  await c.evaluate('btsOfficialPicker.closeAll();__officialInput(\'umpire\').scrollIntoView({block:\'center\'});__officialOpen(\'umpire\')');
  await verify('The official list stays on screen and follows its input at '+width+' by '+height,'(()=>{const popup=__officialPopup(\'umpire\'),box=popup.getBoundingClientRect(),input=__officialInput(\'umpire\').getBoundingClientRect();return !popup.hidden&&box.left>=7.9&&box.right<=innerWidth-7.9&&box.top>=0&&box.bottom<=innerHeight&&box.height>30&&Math.abs(box.width-input.width)<1&&popup.scrollWidth<=popup.clientWidth+1})()');
 }
 await metrics(1920,1080);await c.evaluate('btsOfficialPicker.closeAll();__officialInput(\'umpire\').scrollIntoView({block:\'center\'});__officialSearch(\'umpire\',\'\')');
 await capture('spiel-dialog-offizielle');
 await c.evaluate('__officialChoose(\'umpire\',\'Sven Weber\');__officialOpen(\'service_judge\');__officialChoose(\'service_judge\',\'Kim Wolf\');curt.umpires=__officialOriginal;btsOfficialPicker.closeAll()');
 await click('#ls-match-tab-3');
 await verify('Changing tabs closes both lists and keeps the official draft intact','[\'umpire\',\'service_judge\'].every(role=>__officialPopup(role).hidden)&&__officialSelect(\'umpire\').value===\'Sven Weber\'&&__officialSelect(\'service_judge\').value===\'Kim Wolf\'');
 await click('#ls-match-tab-1');
 await c.evaluate('document.querySelector(\'.edit_match_container\').scrollTop=0');
};
