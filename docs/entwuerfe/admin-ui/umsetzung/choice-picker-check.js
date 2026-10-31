'use strict';

module.exports = async function({c, verify, click, open, metrics, key, delay, capture}) {
 const button = name => `[data-field="${name}"] .ls-choice-trigger`;
 const popup = name => `.ls-choice-options[data-field="${name}"]`;
 const option = (name, value) => `${popup(name)} [data-value="${value}"]`;
 await open(1920,1080);
 await c.evaluate('curt.courts.push({_id:\'SN_1\',num:\'1\',location_id:\'SN\',is_active:true})');
 await click('tr[data-match_id="match-45"] .ls-match-open');await click('#ls-match-tab-1');
 await verify('Status and place use labelled select-only buttons without a text input', '[\'match_status\',\'court_id\'].every(name=>{const wrapper=document.querySelector(\'.ls-choice-picker[data-field="\'+name+\'"]\'),trigger=wrapper.querySelector(\'button\');return wrapper.querySelector(\'select\').hidden&&!wrapper.querySelector(\'input\')&&trigger.type===\'button\'&&trigger.getAttribute(\'role\')===\'combobox\'&&trigger.getAttribute(\'aria-autocomplete\')===\'none\'&&trigger.getAttribute(\'aria-expanded\')===\'false\'&&wrapper.closest(\'label\').htmlFor===trigger.id;})');
 await verify('New selection fields share the official picker border, colour and minimum height', '(()=>{const official=getComputedStyle(document.querySelector(\'.ls-official-input\'));return [...document.querySelectorAll(\'.ls-choice-trigger\')].every(node=>{const style=getComputedStyle(node);return style.borderTopColor===official.borderTopColor&&style.borderTopLeftRadius===official.borderTopLeftRadius&&style.backgroundColor===official.backgroundColor&&node.getBoundingClientRect().height>=30;});})()');
 await click(button('court_id'));
 await verify('Place list shows every location exactly once followed directly by its courts', `(()=>{const list=document.querySelector('${popup('court_id')}'),rows=[...list.children],north=rows.find(row=>row.dataset.value==='location:CH'),south=rows.find(row=>row.dataset.value==='location:SN');return !list.hidden&&!list.querySelector('input,[role="presentation"]')&&rows.filter(row=>row.textContent==='Campus Hellweg').length===1&&rows.filter(row=>row.textContent==='Sporthalle Nord').length===1&&north.nextElementSibling.dataset.value==='CH_1'&&south.nextElementSibling.dataset.value==='SN_1'&&new Set(rows.map(row=>row.dataset.value)).size===rows.length;})()`);
 await verify('Subordinate courts are indented and use the existing numbered field graphic', `(()=>{const location=document.querySelector('${option('court_id','location:CH')}'),court=document.querySelector('${option('court_id','CH_1')}');return parseFloat(getComputedStyle(court).paddingLeft)>parseFloat(getComputedStyle(location).paddingLeft)+15&&location.querySelector('svg')&&court.querySelector('.ls-resource-court').textContent==='1'&&getComputedStyle(court.querySelector('.ls-resource-court')).backgroundImage.includes('court.svg');})()`);
 await verify('The current location has a visible checkmark and accessible selection state', `document.querySelector('${option('court_id','location:CH')}').getAttribute('aria-selected')==='true'&&getComputedStyle(document.querySelector('${option('court_id','location:CH')} .ls-choice-check')).opacity==='1'&&document.querySelector('${button('court_id')}').getAttribute('aria-expanded')==='true'`);
 await c.evaluate(`window.__choiceRow=document.querySelector('${option('court_id','CH_1')}')`);
 await key('Escape','Escape',27);
 await verify('Escape closes only the choices and keeps the game, value and pristine draft', `document.querySelector('${popup('court_id')}').hidden&&document.querySelector('.match_edit_dialog form').elements.court_id.value==='location:CH'&&document.querySelector('.match_save_button').disabled&&!document.querySelector('.bts-confirm-dialog')&&document.activeElement.matches('${button('court_id')}')&&__writes.length===0`);
 await click(button('court_id'));
 await verify('Reopening reuses existing option elements',`document.querySelector('${option('court_id','CH_1')}')===__choiceRow`);
 if(capture)await capture('spiel-dialog-ort-auswahl',true);
 await click(option('court_id','SN_1'));
 await verify('Choosing a court updates the native value, field graphic and location context without submitting', `document.querySelector('.match_edit_dialog form').elements.court_id.value==='SN_1'&&document.querySelector('${button('court_id')} .ls-choice-label').textContent==='Feld 1'&&document.querySelector('${button('court_id')} .ls-choice-context').textContent==='Sporthalle Nord'&&document.querySelector('${button('court_id')} .ls-resource-court').textContent==='1'&&document.querySelector('${popup('court_id')}').hidden&&!document.querySelector('.match_save_button').disabled&&__writes.length===0`);
 await click(button('court_id'));await click(button('match_status'));
 await verify('Opening status closes place and shows the matching status icons', `document.querySelector('${popup('court_id')}').hidden&&!document.querySelector('${popup('match_status')}').hidden&&document.querySelector('${option('match_status','preparation')} [data-symbol="mic"] svg')&&document.querySelector('${option('match_status','on_court')} [data-symbol="play"] svg')&&!document.querySelector('${popup('match_status')} input')`);
 if(capture)await capture('spiel-dialog-status-auswahl',true);
 await key('Home','Home',36);await key('ArrowDown','ArrowDown',40);await key('ArrowDown','ArrowDown',40);await key('Enter','Enter',13);
 await verify('Keyboard selection changes the status and leaves the original form unsent', `document.querySelector('[name="match_status"]').value==='on_court'&&document.querySelector('${button('match_status')} .ls-choice-symbol').dataset.symbol==='play'&&document.querySelector('${popup('match_status')}').hidden&&__writes.length===0`);
 await click(button('court_id'));await key('Home','Home',36);await key('Enter','Enter',13);
 await verify('Clearing a required place shows its validation message at the visible control', `document.querySelector('[name="court_id"]').value===''&&document.querySelector('${button('court_id')}').getAttribute('aria-invalid')==='true'&&!document.querySelector('[data-field="court_id"] .ls-choice-error').hidden&&document.querySelector('[data-field="court_id"] .ls-choice-error').textContent.includes('Feld fehlt')`);
 await click('#ls-match-tab-3');await click('.match_save_button');
 await verify('A missing field disables Apply with a hover explanation even on another tab', `document.querySelector('#ls-match-tab-3').getAttribute('aria-selected')==='true'&&document.querySelector('.match_save_button').disabled&&document.querySelector('.match_save_button').title==='Feld fehlt'&&__writes.length===0`);
 await c.evaluate('document.querySelector(\'.match_edit_dialog form\').requestSubmit()');
 await verify('Native validation from another tab still focuses the custom place control and prevents a write', `document.querySelector('#ls-match-tab-1').getAttribute('aria-selected')==='true'&&document.activeElement.matches('${button('court_id')}')&&__writes.length===0`);
 await key(' ','Space',32,' ');await key('End','End',35);await key('Enter','Enter',13);
 await verify('Space and End can select the final court and clear the validation error', `document.querySelector('[name="court_id"]').value==='SN_1'&&document.querySelector('${button('court_id')}').getAttribute('aria-invalid')==='false'&&document.querySelector('[data-field="court_id"] .ls-choice-error').hidden`);
 await click(button('court_id'));await key('Tab','Tab',9);await delay(20);
 await verify('Tab leaves the list without changing or submitting the selected value', `document.querySelector('${popup('court_id')}').hidden&&document.querySelector('[name="court_id"]').value==='SN_1'&&__writes.length===0`);
 await click(button('court_id'));await c.evaluate('document.querySelector(\'.ls-official-input\').focus()');
 await verify('Opening the official picker closes the select-only popup', `document.querySelector('${popup('court_id')}').hidden&&!!document.querySelector('.ls-official-options:not([hidden])')`);
 await click(button('match_status'));
 await verify('Opening status closes the official popup', `!document.querySelector('.ls-official-options:not([hidden])')&&!document.querySelector('${popup('match_status')}').hidden`);
 await c.evaluate('document.querySelector(\'.tabletoperator_assignment_input\').focus()');
 await verify('Opening the tablet picker also closes status and place', '!document.querySelector(\'.ls-choice-options:not([hidden])\')');

 for(const [width,height] of [[1920,1080],[390,844],[320,568],[844,390]]) {
  await metrics(width,height);
  for(const name of ['match_status','court_id']) {
   await c.evaluate(`document.querySelector('${button(name)}').scrollIntoView({block:'center'})`);await click(button(name));
   await verify(name+' choices and equally tall controls fit the viewport at '+width+' by '+height, `(()=>{const list=document.querySelector('${popup(name)}'),box=list.getBoundingClientRect(),trigger=document.querySelector('${button(name)}').getBoundingClientRect();return !list.hidden&&box.left>=7.9&&box.right<=innerWidth-7.9&&box.top>=0&&box.bottom<=innerHeight+.1&&box.height>30&&Math.abs(box.width-trigger.width)<1&&list.scrollWidth<=list.clientWidth+1&&(()=>{const fields=[...document.querySelectorAll('.ls-choice-trigger')].map(node=>node.getBoundingClientRect()),labels=[...document.querySelectorAll('.ls-choice-picker')].map(node=>node.closest('label').querySelector('.match_edit_field_label').getBoundingClientRect());return fields.every(field=>Math.abs(field.height-fields[0].height)<.1)&&(fields[0].left===fields[1].left||Math.abs(labels[0].top-labels[1].top)<.1);})();})()`);
   if(capture&&width===390&&name==='court_id')await capture('spiel-dialog-ort-auswahl-mobil',true);
   await key('Escape','Escape',27);
  }
 }
 await metrics(1920,1080);await c.evaluate('document.querySelector(\'.edit_match_container\').scrollTop=0');await click(button('court_id'));await click('#ls-match-tab-0');
 await verify('Changing tabs closes both selection lists while retaining the draft', '!document.querySelector(\'.ls-choice-options:not([hidden])\')&&document.querySelector(\'[name="court_id"]\').value===\'SN_1\'&&document.querySelector(\'[name="match_status"]\').value===\'on_court\'');
 await click('#ls-match-tab-1');await click('.match_save_button');
 await verify('Apply submits canonical status, court and location through the existing edit path', '!document.querySelector(\'.match_edit_dialog\')&&!document.querySelector(\'.ls-choice-options\')&&__writes.length===1&&__writes[0].type===\'match_edit\'&&__writes[0].match.setup.now_on_court===true&&__writes[0].match.setup.court_id===\'SN_1\'&&__writes[0].match.setup.location_id===\'SN\'');

 await c.evaluate('(()=>{const match=curt.matches.find(item=>item._id===\'match-45\');match.setup.state=\'finished\';match.setup.now_on_court=false;match.team1_won=true;match.btp_winner=1;})()');
 await click('tr[data-match_id="match-45"] .ls-match-open');await click('#ls-match-tab-1');await click(button('match_status'));
 await click(option('match_status','finished'));
 await verify('Finished games lock the whole status control and keep its list closed', `document.querySelector('${button('match_status')}').disabled&&document.querySelector('[name="match_status"]').disabled&&document.querySelector('${popup('match_status')}').hidden&&document.querySelector('[name="match_status"]').value==='finished'&&document.querySelector('.match_save_button').disabled&&__writes.length===1`);
 await key('End','End',35);
 await verify('Keyboard input cannot change the status of a finished game', `document.querySelector('[name="match_status"]').value==='finished'&&document.querySelector('${popup('match_status')}').hidden`);
 await click('.match_edit_cancel_button');
 await verify('Closing disposes the controls and all detached popup lists','!document.querySelector(\'.ls-choice-options,.match_edit_dialog\')');
};
