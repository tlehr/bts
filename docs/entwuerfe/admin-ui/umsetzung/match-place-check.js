'use strict';

module.exports = async function({c, verify, click, open, metrics, capture}) {
 const edit = async () => {await click('tr[data-match_id="match-45"] .ls-match-open');await click('#ls-match-tab-1');};
 const set = async (name, value) => c.evaluate(`(()=>{const input=document.querySelector('.match_edit_dialog form').elements[${JSON.stringify(name)}];input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const valid = 'document.querySelector(\'.match_edit_dialog form\').elements.court_id.validity.valid';
 const last = '__writes.at(-1).match';
 await open(1920,1080);await edit();
 await verify('Preparation has a single status option without a location name', '(()=>{const field=document.querySelector(\'[name="match_status"]\');return field.value===\'preparation\'&&[...field.options].filter(option=>option.value===\'preparation\').length===1&&![...field.options].some(option=>/CH|SN|Campus|Sporthalle/.test(option.textContent));})()');
 await verify('The field is labelled Ort/Feld and selects the current preparation location', `document.querySelector('[name="court_id"]').closest('label').textContent.startsWith('Ort/Feld:')&&document.querySelector('[name="court_id"]').value==='location:CH'&&${valid}`);
 await verify('Multiple locations appear once with subordinate court entries', '(()=>{const field=document.querySelector(\'[name="court_id"]\'),options=[...field.options],locations=options.filter(option=>option.dataset.kind===\'location\');return !field.querySelector(\'optgroup\')&&locations.length===2&&locations[0].textContent===\'Campus Hellweg\'&&locations[0].value===\'location:CH\'&&locations[0].nextElementSibling.textContent===\'Feld 1\'&&locations[0].nextElementSibling.dataset.level===\'1\'&&locations[1].textContent===\'Sporthalle Nord\'&&options.filter(option=>option.textContent===\'Campus Hellweg\').length===1;})()');
 await verify('Preparation location appears in the metadata, separate from the status badge', 'document.querySelector(\'.ls-dialog-status\').textContent===\'In Vorbereitung\'&&document.querySelector(\'.ls-dialog-meta\').textContent.includes(\'Campus Hellweg\')');
 await verify('Unfinished matches never offer Finished as a selectable status', '![...document.querySelector(\'[name="match_status"]\').options].some(option=>option.value===\'finished\')');
 await set('court_id','');
 await verify('Preparation without a location shows only the concrete missing-place warning and triangle', `!${valid}&&document.querySelector('[name="court_id"]').validationMessage==='Ort fehlt'&&!document.querySelector('[data-field="court_id"] .ls-choice-error').hidden&&!!document.querySelector('[data-field="court_id"] .ls-choice-error svg path')&&!document.querySelector('.match_edit_rules')`);
 await verify('Missing preparation location disables Apply and explains why on hover and in the footer', `(()=>{const save=document.querySelector('.match_save_button'),hint=document.querySelector('.dialog-actions-hint');return save.disabled&&save.title==='Ort fehlt'&&hint.textContent==='Ort fehlt'&&save.getAttribute('aria-describedby')===hint.id;})()`);
 await click('#ls-match-tab-3');await click('.match_save_button');
 await verify('Apply stays disabled with its missing-location reason on other tabs and a click sends nothing', `__writes.length===0&&document.querySelector('#ls-match-tab-3').getAttribute('aria-selected')==='true'&&document.querySelector('.match_save_button').disabled&&document.querySelector('.match_save_button').title==='Ort fehlt'`);
 await c.evaluate('document.querySelector(\'.match_edit_dialog form\').requestSubmit()');
 await verify('Submitting an invalid form still opens Edit and focuses the place without sending a request', '__writes.length===0&&document.querySelector(\'#ls-match-tab-1\').getAttribute(\'aria-selected\')===\'true\'&&document.activeElement.closest(\'.ls-choice-picker\')?.dataset.field===\'court_id\'');
 await set('court_id','location:SN');
 await verify('A location alone is sufficient for preparation and removes the warning',`${valid}&&document.querySelector('[data-field="court_id"] .ls-choice-error').hidden`);
 await verify('Choosing a preparation location immediately enables Apply and removes its missing-place explanation', `!document.querySelector('.match_save_button').disabled&&!document.querySelector('.match_save_button').hasAttribute('title')&&document.querySelector('.dialog-actions-hint').textContent===''`);
 await set('match_status','on_court');
 await verify('On court rejects a location-only assignment with Field missing and a warning triangle', `!${valid}&&document.querySelector('[name="court_id"]').validationMessage==='Feld fehlt'&&!document.querySelector('[data-field="court_id"] .ls-choice-error').hidden&&!!document.querySelector('[data-field="court_id"] .ls-choice-error svg path')`);
 await verify('Missing playing court disables Apply with its own concrete hover explanation', `document.querySelector('.match_save_button').disabled&&document.querySelector('.match_save_button').title==='Feld fehlt'&&document.querySelector('.dialog-actions-hint').textContent==='Feld fehlt'`);
 await click('.match_save_button');await verify('An invalid on-court assignment sends no edit','__writes.length===0');
 await set('court_id','CH_13');
 await verify('Choosing a real court immediately enables Apply and clears the old hover explanation', `!document.querySelector('.match_save_button').disabled&&!document.querySelector('.match_save_button').hasAttribute('title')&&!document.querySelector('.dialog-actions-hint').textContent.includes('Feld fehlt')`);
 await click('.match_save_button');
 await verify('On-court submission sends a real court ID and derives its location', `!document.querySelector('.match_edit_dialog')&&${last}.setup.court_id==='CH_13'&&${last}.setup.location_id==='CH'&&${last}.setup.now_on_court===true&&__writes.at(-1).type==='match_edit'`);

 await edit();await set('court_id','location:SN');await click('.match_save_button');
 await verify('Location-only preparation is submitted without a fabricated court ID', `${last}.setup.state==='preparation'&&${last}.setup.location_id==='SN'&&${last}.setup.court_id===''&&${last}.setup.now_on_court===false`);
 await edit();await set('court_id','CH_13');await click('.match_save_button');
 await verify('Preparation may also specify a court and its location', `${last}.setup.state==='preparation'&&${last}.setup.court_id==='CH_13'&&${last}.setup.location_id==='CH'`);
 await edit();await set('match_status','scheduled');await set('court_id','location:SN');await click('.match_save_button');
 await verify('A scheduled game may be assigned only to a location', `${last}.setup.state==='scheduled'&&${last}.setup.location_id==='SN'&&${last}.setup.court_id===''`);
 await edit();await set('match_status','scheduled');await set('court_id','');await click('.match_save_button');
 await verify('A scheduled game may remain completely unassigned', `${last}.setup.state==='scheduled'&&!${last}.setup.location_id&&!${last}.setup.court_id`);

 await open(1920,1080);
 await c.evaluate('(()=>{const match=curt.matches.find(item=>item._id===\'match-45\');Object.assign(match,{team1_won:false,btp_winner:2,end_ts:123456,network_score:[[19,21],[18,21]]});Object.assign(match.setup,{state:\'finished\',now_on_court:false,court_id:\'CH_1\'});})()');
 await edit();
 await verify('Finished games show a selected disabled Finished status', '(()=>{const field=document.querySelector(\'[name="match_status"]\');return field.value===\'finished\'&&field.selectedOptions[0].disabled&&field.selectedOptions[0].textContent===\'Beendet\'&&document.querySelector(\'.match_edit_finish_button\').hidden;})()');
 await click('[name="override_colors_checkbox"]');await click('.match_save_button');
 await verify('Editing a finished game retains its status, winner and saved result despite the disabled option', `${last}.setup.state==='finished'&&${last}.setup.now_on_court===false&&${last}.team1_won===false&&${last}.btp_winner===2&&${last}.end_ts===123456&&JSON.stringify(${last}.network_score)==='[[19,21],[18,21]]'`);
 for (const status of ['retired','no_match','walkover']) {
  await c.evaluate(`curt.matches.find(item=>item._id==='match-45').score_status=${JSON.stringify(status)}`);
  await edit();await click('[name="override_colors_checkbox"]');await click('.match_save_button');
  await verify('Finished status preserves the existing '+status+' result', `${last}.setup.state==='finished'&&${last}.score_status===${JSON.stringify(status)}&&${last}.team1_won===false&&${last}.btp_winner===2`);
 }

 await open(1920,1080);await c.evaluate('curt.locations=curt.locations.filter(location=>location._id===\'CH\')');await edit();
 await verify('With one location only court choices are displayed', '!document.querySelector(\'[name="court_id"] optgroup\')&&![...document.querySelector(\'[name="court_id"]\').options].some(option=>option.value.startsWith(\'location:\'))&&document.querySelector(\'[name="court_id"]\').options.length===14');
 await verify('The only location satisfies preparation even before a court is selected', `${valid}&&document.querySelector('[name="court_id"]').value===''`);
 await click('[name="override_colors_checkbox"]');await click('.match_save_button');
 await verify('The only location is included when saving preparation without a court', `${last}.setup.state==='preparation'&&${last}.setup.location_id==='CH'&&!${last}.setup.court_id`);
 await edit();await set('match_status','on_court');
 await verify('A single location still cannot replace a court for an on-court match',`!${valid}`);

 await open(390,844);await edit();
 await verify('Status and place controls fit the mobile dialog', '[\'match_status\',\'court_id\'].every(name=>{const field=document.querySelector(\'[data-field="\'+name+\'"] .ls-choice-trigger\'),card=field.closest(\'.match_edit_card\');return field.getBoundingClientRect().width>0&&field.getBoundingClientRect().right<=card.getBoundingClientRect().right&&card.scrollWidth<=card.clientWidth;})');
 if(capture)await capture('spiel-dialog-ort-feld');
 await open(1920,1080);await c.evaluate('curt.locations=[]');await edit();
 await verify('Preparation is prevented when no location exists',`!${valid}`);
 await set('match_status','scheduled');await verify('Switching to scheduled clears preparation validation and enables Apply without requiring a location',`${valid}&&!document.querySelector('.match_save_button').disabled&&!document.querySelector('.match_save_button').hasAttribute('title')`);
 await metrics(1920,1080);
};
