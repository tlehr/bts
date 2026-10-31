'use strict';

module.exports = async function({c, verify, click, open, key, metrics, capture}) {
 const locked = '[\'match_status\',\'court_id\',\'umpire_name\',\'service_judge_name\'].every(name=>document.querySelector(\'.match_edit_dialog form\').elements[name].disabled)&&[...document.querySelectorAll(\'.ls-choice-trigger,.ls-official-input,.ls-official-toggle,.tabletoperator_assignment_input\')].every(node=>node.disabled)';
 const finishFixture = '(()=>{const match=curt.matches.find(item=>item._id===\'match-45\');Object.assign(match,{team1_won:false,btp_winner:2,end_ts:123456,network_score:[[19,21],[18,21]]});Object.assign(match.setup,{state:\'finished\',now_on_court:false,court_id:\'CH_2\',location_id:\'CH\',tabletoperators:[{name:\'Tablet Operator\',btp_id:1234}]});window.__finishedSource=structuredClone(match);})()';
 const prepare = async () => {
  await open(1920,1080);await c.evaluate(finishFixture);await click('tr[data-match_id="match-45"] .ls-match-open');await click('#ls-match-tab-1');
  await c.evaluate('window.__reopenRequests=[];window.__normalReopenSend=window.send;window.send=(message,callback)=>{if(message.type===\'match_reopen\'){__reopenRequests.push({message,callback});return;}return __normalReopenSend(message,callback)};window.__reopenedResult=()=>{const match=structuredClone(__finishedSource);Object.assign(match.setup,{state:\'scheduled\',now_on_court:false,preparation_call_deferred:true,highlight:0});match.score_status=\'normal\';for(const key of [\'team1_won\',\'btp_winner\',\'end_ts\',\'tabletoperator_finish_ts\',\'score_status_network_score\'])delete match[key];return match};');
 };
 await prepare();
 await verify('A valid finished game has no permanent rules or missing-assignment warnings', '!document.querySelector(\'.match_edit_rules\')&&[...document.querySelectorAll(\'.ls-choice-error\')].every(node=>node.hidden)');
 await verify('Finished games lock native and visible assignment controls and stay pristine', `${locked}&&document.querySelector('[name="match_status"]').value==='finished'&&document.querySelector('.match_save_button').disabled&&document.querySelector('.tabletoperator_assignment_input').value==='Tablet Operator'`);
 await click('[data-field="court_id"] .ls-choice-trigger');await click('[data-field="match_status"] .ls-choice-trigger');await click('.ls-official-toggle');
 await verify('Locked status, place and official buttons cannot open their lists','!document.querySelector(\'.ls-choice-options:not([hidden]),.ls-official-options:not([hidden])\')&&__reopenRequests.length===0');
 for(const tab of [0,1,2,3]) {
  await click('#ls-match-tab-'+tab);
  await verify('Reopen is a footer action available in tab '+tab, '!document.querySelector(\'.match_edit_reopen_button\').hidden&&document.querySelector(\'.match_edit_reopen_button\').closest(\'.match_edit_actions\')&&!document.querySelector(\'.match_edit_reopen_button\').disabled');
 }
 await click('.match_edit_reopen_button');
 await verify('Reopen asks in a yellow warning and defaults to Cancel before any write', '(()=>{const dialog=document.querySelector(\'.bts-confirm-dialog.is-warning\');return dialog?.open&&dialog.querySelector(\'.bts-confirm-warning\')&&document.activeElement.matches(\'.bts-confirm-cancel\')&&[\'Punktestand und Zählhistorie bleiben erhalten\',\'Sieger- und Abschlussmarkierungen\',\'erneut abgeschlossen\',\'Folgespiele\',\'BTP-Daten\'].every(text=>dialog.textContent.includes(text))&&__reopenRequests.length===0;})()');
 for(const [width,height] of [[320,568],[844,390]]) {
  await metrics(width,height);
  await verify('The reopen warning and its actions fit '+width+' by '+height, '(()=>{const dialog=document.querySelector(\'.bts-confirm-dialog\'),box=dialog.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&box.top>=0&&box.bottom<=innerHeight&&dialog.scrollWidth<=dialog.clientWidth&&[...dialog.querySelectorAll(\'button\')].every(node=>{const r=node.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;});})()');
 }
 await metrics(1920,1080);if(capture)await capture('spiel-dialog-abschluss-zuruecknehmen',true);
 await key('Escape','Escape',27);
 await verify('Cancelling preserves the finished game and all locks without sending', `${locked}&&!document.querySelector('.bts-confirm-dialog')&&__reopenRequests.length===0&&curt.matches.find(item=>item._id==='match-45').end_ts===123456`);
 await click('#ls-match-tab-1');await click('[name="override_colors_checkbox"]');
 await verify('Unapplied appearance edits block reopening with an explanation', 'document.querySelector(\'.match_edit_reopen_button\').disabled&&document.querySelector(\'.match_edit_reopen_button\').title===\'Änderungen zuerst übernehmen.\'');
 await click('[name="override_colors_checkbox"]');await click('.match_edit_reopen_button');
 await c.evaluate('document.querySelector(\'.match_edit_reopen_button\').click()');
 await verify('Repeated reopening attempts keep a single warning', 'document.querySelectorAll(\'.bts-confirm-dialog\').length===1&&__reopenRequests.length===0');
 await click('.bts-confirm-accept');
 await verify('Approval sends only game identity and waits with all footer actions locked', `__reopenRequests.length===1&&JSON.stringify(Object.keys(__reopenRequests[0].message).sort())===JSON.stringify(['match_id','tournament_key','type'])&&__reopenRequests[0].message.match_id==='match-45'&&document.querySelector('.match_edit_reopen_button').textContent==='Wird wieder geöffnet …'&&[...document.querySelectorAll('.dialog-actions button')].every(button=>button.disabled)&&${locked}`);
 await c.evaluate('__reopenRequests[0].callback({message:\'Synthetic reopen failure\'})');
 await verify('A failed reopening keeps the finished game locked and permits retry', `${locked}&&!document.querySelector('.match_edit_reopen_button').disabled&&curt.matches.find(item=>item._id==='match-45').btp_winner===2`);
 await click('.match_edit_reopen_button');await click('.bts-confirm-accept');
 await c.evaluate('__reopenRequests[1].callback(null,{match:__reopenedResult()})');
 await verify('Successful reopening displays the acknowledged deferred game with editable controls', 'document.querySelector(\'#ls-match-tab-1\').getAttribute(\'aria-selected\')===\'true\'&&!document.querySelector(\'.match_edit_dialog form\').dataset.finishedLocked&&[\'match_status\',\'court_id\',\'umpire_name\'].every(name=>!document.querySelector(\'.match_edit_dialog form\').elements[name].disabled)&&!document.querySelector(\'.tabletoperator_assignment_input\').disabled&&document.querySelector(\'[name="match_status"]\').value===\'deferred\'&&document.querySelector(\'.match_edit_reopen_button\').hidden&&document.querySelector(\'.match_save_button\').disabled');
 await verify('Reopening retains points and the canonical court and assignments', '(()=>{const match=curt.matches.find(item=>item._id===\'match-45\');return JSON.stringify(match.network_score)===JSON.stringify(__finishedSource.network_score)&&match.setup.court_id===\'CH_2\'&&match.setup.tabletoperators[0].name===\'Tablet Operator\'&&match.setup.umpire.name===__finishedSource.setup.umpire.name&&!match.btp_winner&&!match.end_ts;})()');
 await click('[name="override_colors_checkbox"]');
 await c.evaluate('crouting.on_change({ctype:\'score\',tournament_key:\'preview\',val:{match_id:\'match-45\',team1_won:false,btp_winner:2,end_ts:999999,network_score:[[19,21],[18,21]],presses:[]}})');
 await verify('A live finish locks assignments immediately while retaining an unrelated appearance draft', `${locked}&&!document.querySelector('.match_save_button').disabled&&document.querySelector('[name="override_colors_checkbox"]').checked&&!document.querySelector('.match_edit_reopen_button').hidden`);
 await click('[name="override_colors_checkbox"]');
 await verify('Reverting the appearance after a live finish restores pristine actions', 'document.querySelector(\'.match_save_button\').disabled&&!document.querySelector(\'.match_edit_reopen_button\').disabled');
 await click('.match_edit_cancel_button');

 await prepare();await click('[name="override_colors_checkbox"]');
 await c.evaluate('const field=document.querySelector(\'[name="court_id"]\');field.value=\'CH_13\';field.dispatchEvent(new Event(\'change\',{bubbles:true}))');
 await click('.match_save_button');
 await verify('Saving other fields retains all canonical finished assignments despite disabled controls and attempted tampering', '(()=>{const message=__writes.at(-1);return message.type===\'match_edit\'&&message.match.setup.court_id===\'CH_2\'&&message.match.setup.umpire.name===__finishedSource.setup.umpire.name&&message.match.setup.service_judge.name===__finishedSource.setup.service_judge.name&&JSON.stringify(message.match.setup.tabletoperators)===JSON.stringify(__finishedSource.setup.tabletoperators)&&message.match.setup.state===\'finished\'&&message.match.btp_winner===2&&!message.tabletoperator_assignment_id&&!message.tabletoperator_replacement_name;})()');

 await prepare();await click('.match_edit_reopen_button');await click('.bts-confirm-accept');
 await click('tr[data-match_id="match-44"] .ls-match-open');
 await c.evaluate('__reopenRequests[0].callback(null,{match:__reopenedResult()})');
 await verify('A late reopen response cannot replace a different game dialog','document.querySelector(\'.match_edit_dialog\').dataset.editMatch_id===\'match-44\'||document.querySelector(\'.match_edit_dialog\').getAttribute(\'data-edit-match_id\')===\'match-44\'');
 await click('.match_edit_cancel_button');
 await open(1920,1080);await click('tr[data-match_id="match-45"] .ls-match-open');
 await c.evaluate('crouting.on_change({ctype:\'score\',tournament_key:\'preview\',val:{match_id:\'match-45\',team1_won:true,btp_winner:1,end_ts:98765,network_score:[[21,19],[21,18]],presses:[]}})');
 await click('#ls-match-tab-1');
 await verify('A live finish on a pristine form locks its fields without inventing unsaved changes',`${locked}&&document.querySelector('.match_save_button').disabled`);
 await click('.match_edit_cancel_button');
};
