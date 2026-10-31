'use strict';

module.exports=async function({c,verify,click,metrics,key,capture,open}) {
 await open(1920,1080);
 await c.evaluate('window.confirm=()=>true;window.__queueInput=document.querySelector(\'.tabletoperator_add_custom_input\');window.__queuePopup=document.getElementById(__queueInput.getAttribute(\'aria-controls\'));window.__queueSearch=()=>{__queueInput.scrollIntoView({block:\'center\'});__queueInput.focus();__queueInput.value=\'Pickerprobe\';__queueInput.dispatchEvent(new Event(\'input\',{bubbles:true}))};window.__pickerNames=popup=>[...popup.querySelectorAll(\'[role=option]\')].map(row=>row.querySelector(\'.tabletoperator_assignment_label\').textContent).filter(name=>name.startsWith(\'Pickerprobe\'));window.__pickerBareNames=popup=>__pickerNames(popup).map(name=>name.split(\' (\')[0]);');
 try {
  await verify('The queue field uses the shared combobox with a muted search placeholder and matching search icon','__queueInput.getAttribute(\'role\')===\'combobox\'&&__queueInput.matches(\':placeholder-shown\')&&__queueInput.placeholder===\'Spieler suchen oder Namen eingeben\'&&__queueInput.closest(\'.tabletoperator_picker\').querySelector(\'[aria-label="Spieler suchen oder Namen eingeben"] svg\')&&getComputedStyle(__queueInput,\'::placeholder\').color===\'rgb(109, 125, 128)\'');
 } catch(error) {
  throw new Error(error.message+' '+JSON.stringify(await c.evaluate('({role:__queueInput.getAttribute(\'role\'),value:__queueInput.value,placeholder:__queueInput.placeholder,color:getComputedStyle(__queueInput,\'::placeholder\').color,icon:__queueInput.closest(\'.tabletoperator_picker\').querySelector(\'.tabletoperator_selected_icon\').outerHTML})')));
 }
 await c.evaluate('(()=>{const person=(btp_id,name)=>({btp_id,name:\'Pickerprobe \'+name}),free=person(999701,\'Frei\'),plan=person(999702,\'Plan\'),prep=person(999703,\'Vorbereitung\'),play=person(999704,\'Feld\'),tablet=person(999705,\'Tablet\');window.__pickerExpected=[free.name,plan.name,prep.name,play.name,tablet.name];window.__pickerQueueExpected=__pickerExpected.slice(0,2);curt.matches.push({team1_won:true,setup:{state:\'finished\',teams:[{players:[free]}]}},{setup:{state:\'scheduled\',scheduled_date:\'2026-11-01\',scheduled_time_str:\'14:00\',match_num:701,teams:[{players:[plan]}]}},{setup:{state:\'preparation\',preparation_call_timestamp:1234,teams:[{players:[prep]}]}},{setup:{state:\'oncourt\',now_on_court:true,court_id:\'CH_2\',teams:[{players:[play]}]}},{setup:{state:\'oncourt\',now_on_court:true,court_id:\'CH_10\',teams:[{players:[]}],tabletoperators:[tablet]}})})()');
 await c.evaluate('__queueInput.focus()');await c.call('Input.insertText',{text:'P'});
 await verify('The first typed letter replaces the queue placeholder without being submitted','__queueInput.value===\'P\'&&!__queueInput.matches(\':placeholder-shown\')&&__writes.length===0');
 await c.evaluate('__queueSearch()');
 await verify('Queue suggestions exclude preparation, playing and active tablet roles and retain the availability order','JSON.stringify(__pickerBareNames(__queuePopup))===JSON.stringify(__pickerQueueExpected)');
 for(const [width,height] of [[1920,1080],[1000,720],[390,844]]) {
  await metrics(width,height);await c.evaluate('__queueSearch()');
  await verify('The queue suggestion list matches its input width and font on screen at '+width+' pixels','(()=>{const box=__queuePopup.getBoundingClientRect(),input=__queueInput.getBoundingClientRect();return __queuePopup.style.display!==\'none\'&&box.left>=0&&box.right<=innerWidth+.2&&box.top>=0&&box.bottom<=innerHeight+.2&&Math.abs(box.width-input.width)<1&&getComputedStyle(__queuePopup).fontSize===getComputedStyle(__queueInput).fontSize})()');
 }
 await c.evaluate("window.__waitingBefore=curt.tabletoperators;curt.tabletoperators=[...curt.tabletoperators,{_id:'already-waiting-probe',court:null,tabletoperator:[{btp_id:999701,name:'Pickerprobe Frei'},{btp_id:999702,name:'Pickerprobe Plan'}]}];__queueSearch()");
 await verify('Already waiting people disappear from an existing picker, including both members of a pair','__pickerNames(__queuePopup).length===0');
 await c.evaluate("__queueInput.value='  PICKERPROBE   FREI  ';__queueInput.dispatchEvent(new Event('input',{bubbles:true}));__queueInput.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
 await verify('Typing an already waiting name disables Add, explains the reason and cannot submit a duplicate','document.querySelector(\'.tabletoperator_add_custom_button\').disabled&&__queueInput.validationMessage.includes(\'bereits auf der Warteliste\')&&__writes.length===0');
 await c.evaluate('curt.tabletoperators=__waitingBefore;__queueSearch()');
 await verify('Removing waiting entries makes their members available again without rebuilding the picker','JSON.stringify(__pickerBareNames(__queuePopup))===JSON.stringify(__pickerQueueExpected)');
 for(const name of ['Vorbereitung','Feld','Tablet']) {
  await c.evaluate("__queueInput.value='Pickerprobe "+name+"';__queueInput.dispatchEvent(new Event('input',{bubbles:true}));__queueInput.form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))");
  await verify('Busy '+name+' participants cannot be added by typing their name','document.querySelector(\'.tabletoperator_add_custom_button\').disabled&&__queueInput.validationMessage.length>0&&__writes.length===0');
 }
 await metrics(1920,1080);await c.evaluate('__queueSearch();window.__queueLabels=__pickerNames(__queuePopup);window.__queueRowStyle=getComputedStyle(__queuePopup.querySelector(\'[role=option]\')).cssText;');
 await key('Home','Home',36);await key('ArrowDown','ArrowDown',40);await key('Enter','Enter',13);
 await verify('Keyboard selection retains the participant identity and closes the list without adding automatically','__queueInput.value===\'Pickerprobe Plan\'&&document.querySelector(\'[name="tabletoperator_btp_id"]\').value===\'999702\'&&__queuePopup.style.display===\'none\'&&__writes.length===0');
 await click('.tabletoperator_add_custom_button');
 await verify('Adding the selected person still uses the real queue action with the selected ID','__writes.at(-1).type===\'tabletoperator_add\'&&__writes.at(-1).tabletoperator_name===\'Pickerprobe Plan\'&&__writes.at(-1).tabletoperator_btp_id===\'999702\'');
 await c.evaluate('__queueInput.select()');await c.call('Input.insertText',{text:'Eigener Name'});await click('.tabletoperator_add_custom_button');
 await verify('Typing another name clears the previous selected ID and preserves free-text additions','__writes.at(-1).tabletoperator_name===\'Eigener Name\'&&__writes.at(-1).tabletoperator_btp_id===null');
 await c.evaluate('__queueSearch()');await key('Escape','Escape',27);
 await verify('Escape closes queue suggestions while retaining the query','__queuePopup.style.display===\'none\'&&__queueInput.value===\'Pickerprobe\'&&__queueInput.getAttribute(\'aria-expanded\')===\'false\'');
 await c.evaluate('__queueSearch()');await capture('tablet-suche-kachel',true);
 await click('tr[data-match_id="match-45"] .ls-match-open');
 await verify('Opening a game closes the card popup without removing its picker or query','__queuePopup.isConnected&&__queuePopup.style.display===\'none\'&&__queueInput.value===\'Pickerprobe\'');
 await click('#ls-match-tab-1');
 await c.evaluate('window.__matchingDialogInput=document.querySelector(\'.tabletoperator_assignment_input\');__matchingDialogInput.scrollIntoView({block:\'center\'});__matchingDialogInput.focus();__matchingDialogInput.value=\'Pickerprobe\';__matchingDialogInput.dispatchEvent(new Event(\'input\',{bubbles:true}));window.__matchingDialogPopup=document.getElementById(__matchingDialogInput.getAttribute(\'aria-controls\'));');
 await verify('The dialog retains assignment choices for busy players with the same row formatting as the queue','JSON.stringify(__pickerBareNames(__matchingDialogPopup))===JSON.stringify(__pickerExpected)&&getComputedStyle(__matchingDialogPopup.querySelector(\'[role=option]\')).fontSize===getComputedStyle(__queuePopup.querySelector(\'[role=option]\')).fontSize&&getComputedStyle(__matchingDialogPopup.querySelector(\'[role=option]\')).padding===getComputedStyle(__queuePopup.querySelector(\'[role=option]\')).padding');
 await verify('Dialog suggestions retain the status symbols before names and include the next match time','(()=>{const rows=[...__matchingDialogPopup.querySelectorAll(\'[role=option]\')],prep=rows.find(row=>row.querySelector(\'.tabletoperator_assignment_label\').textContent.startsWith(\'Pickerprobe Vorbereitung\')),play=rows.find(row=>row.querySelector(\'.tabletoperator_assignment_label\').textContent.startsWith(\'Pickerprobe Feld\')),tablet=rows.find(row=>row.querySelector(\'.tabletoperator_assignment_label\').textContent.startsWith(\'Pickerprobe Tablet\'));return prep.querySelector(\'[aria-label="In Vorbereitung"] svg\')&&play.querySelector(\'.ls-resource-court\').textContent===\'2\'&&tablet.querySelector(\'[aria-label="Tabletbedienung auf Feld 10"] svg\')&&rows.find(row=>row.querySelector(\'.tabletoperator_assignment_label\').textContent.startsWith(\'Pickerprobe Plan\')).textContent.includes(\'14:00 #701\')&&rows.every(row=>row.lastElementChild.classList.contains(\'tabletoperator_assignment_label\'))})()');
 await key('Escape','Escape',27);
 await verify('The same Escape behaviour closes just the dialog suggestions and keeps the game open','__matchingDialogPopup.style.display===\'none\'&&!!document.querySelector(\'.match_edit_dialog\')');
 await c.evaluate('__matchingDialogInput.click()');
 await c.evaluate('ctabletoperator.render_unassigned(document.querySelector(\'.unassigned_tableoperators_container\'))');
 await verify('Refreshing the queue disposes its own popup and leaves the open dialog picker working','!__queuePopup.isConnected&&__matchingDialogPopup.isConnected&&__matchingDialogPopup.style.display!==\'none\'&&JSON.stringify(__pickerBareNames(__matchingDialogPopup))===JSON.stringify(__pickerExpected)');
 await click('#ls-match-tab-3');
 await verify('Changing game tabs closes its tablet popup without losing the query','__matchingDialogPopup.style.display===\'none\'&&__matchingDialogInput.value===\'Pickerprobe\'');
 await click('.ls-dialog-close');
 if(await c.evaluate("!!document.querySelector('.bts-confirm-dialog.is-warning')"))await click('.bts-confirm-accept');
 await c.evaluate('__queueInput=document.querySelector(\'.tabletoperator_add_custom_input\');__queuePopup=document.getElementById(__queueInput.getAttribute(\'aria-controls\'));__queueSearch()');
 await verify('The queue picker still opens after closing a dialog with the same suggestions and no stale popup','__queuePopup.isConnected&&__queuePopup.style.display!==\'none\'&&JSON.stringify(__pickerBareNames(__queuePopup))===JSON.stringify(__pickerQueueExpected)&&document.querySelectorAll(\'.tabletoperator_suggestions\').length===1&&!__queueInput.closest(\'.tabletoperator_picker\').querySelector(\'[name="tabletoperator_assignment_id"]\')');
 await c.evaluate("(()=>{const match=curt.matches.find(match=>match.setup.teams?.some(team=>team.players?.some(player=>player.btp_id===999704)));match.team1_won=false;match.setup.state='finished';window.__finishEntry={_id:'finished-picker-person',court:null,tabletoperator:[{btp_id:999704,name:'Pickerprobe Feld'}]};curt.tabletoperators.push(__finishEntry);__queueSearch()})()");
 await verify('After game completion a person automatically placed on the queue remains excluded from search','JSON.stringify(__pickerBareNames(__queuePopup))===JSON.stringify(__pickerQueueExpected)');
 await c.evaluate('__finishEntry.court=-1;__queueSearch()');
 await verify('After completion and queue removal the former player is available without old court flags blocking them','__pickerBareNames(__queuePopup).length===3&&__pickerBareNames(__queuePopup).includes(\'Pickerprobe Feld\')');
 await c.evaluate("__queueInput.value='Pickerprobe Feld';__queueInput.dispatchEvent(new Event('input',{bubbles:true}))");
 await verify('A finished and released player can be entered again with an enabled Add button','!document.querySelector(\'.tabletoperator_add_custom_button\').disabled&&!__queueInput.validationMessage');

};
