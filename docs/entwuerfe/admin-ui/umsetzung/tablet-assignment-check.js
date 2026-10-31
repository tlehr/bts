'use strict';

module.exports=async function({c,verify,metrics,capture}) {
 await c.evaluate('window.__emptyTabletValues=[...document.querySelectorAll(\'.tabletoperator_assignment_picker input\')].map(input=>[input,input.value]);window.__emptyTabletIcon=document.querySelector(\'.tabletoperator_assignment_selected_icon\').cloneNode(true)');
 await verify('An unassigned tablet shows the same muted placeholder as an unassigned official','(()=>{const input=document.querySelector(\'.tabletoperator_assignment_input\');return input.value===\'\'&&input.placeholder===\'Tablet nicht besetzen\'&&input.matches(\':placeholder-shown\')&&getComputedStyle(input,\'::placeholder\').color===getComputedStyle(document.querySelector(\'.ls-official-input\'),\'::placeholder\').color})()');
 await c.evaluate('document.querySelector(\'.tabletoperator_assignment_input\').focus()');
 await c.call('Input.insertText',{text:'M'});
 await verify('The first real keystroke replaces the tablet placeholder without adding it to the replacement name','document.querySelector(\'.tabletoperator_assignment_input\').value===\'M\'&&document.querySelector(\'[name="tabletoperator_replacement_name"]\').value===\'M\'&&!document.querySelector(\'.tabletoperator_assignment_input\').matches(\':placeholder-shown\')');
 await c.evaluate('const input=document.querySelector(\'.tabletoperator_assignment_input\');input.value=\'\';input.dispatchEvent(new Event(\'input\',{bubbles:true}));input.blur()');
 await verify('Clearing a search restores the empty placeholder without requesting an operator release','document.querySelector(\'.tabletoperator_assignment_input\').matches(\':placeholder-shown\')&&document.querySelector(\'.tabletoperator_assignment_input\').value===\'\'&&document.querySelector(\'[name="tabletoperator_assignment_id"]\').value===\'\'&&document.querySelector(\'[name="tabletoperator_replacement_name"]\').value===\'\'');
 await c.evaluate('document.querySelector(\'.tabletoperator_assignment_input\').focus();[...document.querySelectorAll(\'.tabletoperator_assignment_option\')].find(row=>row.querySelector(\'.tabletoperator_assignment_label\').textContent===\'Tablet nicht besetzen\').dispatchEvent(new MouseEvent(\'mousedown\',{bubbles:true,cancelable:true}))');
 await verify('Explicitly releasing the tablet keeps the placeholder and retains the actual release command','document.querySelector(\'.tabletoperator_assignment_input\').matches(\':placeholder-shown\')&&document.querySelector(\'[name="tabletoperator_assignment_id"]\').value===\'__release_tabletoperators__\'&&document.querySelector(\'[name="tabletoperator_replacement_name"]\').value===\'\'');
 await c.evaluate('for(const[input,value]of __emptyTabletValues)input.value=value;document.querySelector(\'.tabletoperator_assignment_selected_icon\').replaceChildren(...__emptyTabletIcon.childNodes);document.querySelector(\'.tabletoperator_assignment_suggestions\').style.display=\'none\'');
 await c.evaluate(`(()=>{
  const form=document.querySelector('.match_edit_dialog form');
  window.__assignmentDraft={matches:curt.matches,values:[...form.querySelectorAll('.tabletoperator_assignment_picker input')].map(input=>[input,input.value]),icon:document.querySelector('.tabletoperator_assignment_selected_icon').cloneNode(true)};
  window.__assignmentInput=document.querySelector('.tabletoperator_assignment_input');
  window.__searchAssignment=()=>{__assignmentInput.value='Max';__assignmentInput.dispatchEvent(new Event('input',{bubbles:true}));};
  window.__assignmentOption=name=>[...document.querySelectorAll('.tabletoperator_assignment_option')].find(row=>row.querySelector('.tabletoperator_assignment_label').textContent.startsWith(name));
  const person=(btp_id,name)=>({btp_id,name,now_tablet_on_court:'CH_12',now_playing_on_court:'CH_11'});
  const karl=person(990300,'Karl Maximilian Weyand'),max=person(990099,'Max Hahn'),gebauer=person(990257,'Maxim Gebauer'),sisic=person(990077,'Maxim Sisic'),playing=person(990078,'Max Playing');
  const preparation=(person,num,called)=>({setup:{state:'preparation',preparation_call_timestamp:called,scheduled_date:'2026-10-30',scheduled_time_str:'18:00',match_num:num,teams:[{players:[person]}]}});
  window.__assignmentKarl=preparation(karl,230,2000);window.__assignmentMax=preparation(max,229,1000);
  window.__assignmentLive={setup:{state:'oncourt',now_on_court:true,court_id:'CH_6',teams:[{players:[playing]}],tabletoperators:[gebauer]}};
  const planned=(person,date,time)=>({setup:{state:'scheduled',scheduled_date:date,scheduled_time_str:time,teams:[{players:[person]}]}});
  const far=person(990079,'Max Far'),near=person(990080,'Max Near'),several=person(990081,'Max Several'),unknown=person(990082,'Max Unknown'),ten=person(990083,'Max Ten');
  window.__assignmentExpected=['Maxim Sisic','Max Far','Max Near','Max Several','Max Unknown','Karl Maximilian Weyand','Max Hahn','Maxim Gebauer','Max Ten'];
  window.__assignmentOrder=selector=>[...document.querySelector(selector).children].map(row=>{const label=row.querySelector('.tabletoperator_assignment_label')||row.firstElementChild;return __assignmentExpected.find(name=>label?.textContent.startsWith(name));}).filter(Boolean);
  curt.matches=[...curt.matches,
   {team1_won:true,setup:{state:'finished',now_on_court:false,court_id:'CH_1',teams:[{players:[]}],tabletoperators:[karl,max,sisic,gebauer]}},
   __assignmentKarl,__assignmentMax,__assignmentLive,
   planned(far,'2026-10-31','09:00'),planned(near,'2026-10-30','21:00'),planned(several,'2026-10-31','20:00'),planned(several,'2026-10-30','19:00'),planned(unknown),
   {setup:{state:'oncourt',now_on_court:true,court_id:'CH_10',teams:[{players:[ten]}]}}];
  __searchAssignment();
 })()`);
 await verify('Prepared players show microphones rather than historical tablet or court assignments','[\'Karl Maximilian Weyand\',\'Max Hahn\'].every(name=>{const row=__assignmentOption(name);return row.querySelector(\'[aria-label="In Vorbereitung"] svg\')&&!row.querySelector(\'.ls-resource-court\')})');
 await verify('Only actual court occupants receive playing and tablet field indicators','(()=>{const tablet=__assignmentOption(\'Maxim Gebauer\'),playing=__assignmentOption(\'Max Playing\');return tablet.querySelector(\'[aria-label="Tabletbedienung auf Feld 6"] svg\')&&tablet.querySelector(\'.ls-resource-court\').textContent===\'6\'&&playing.querySelector(\'[aria-label="Spielt auf Feld 6"] .ls-resource-court\')&&!playing.querySelector(\'svg\')})()');
 await verify('A former tablet operator without a current assignment remains unmarked','!__assignmentOption(\'Maxim Sisic\').querySelector(\'svg,.ls-resource-court\')&&__assignmentOption(\'Max Hahn\').textContent.includes(\'18:00 #229\')');
 await verify('Search results follow availability, full next-game date, preparation call and numeric field order','JSON.stringify(__assignmentOrder(\'.tabletoperator_assignment_suggestions\'))===JSON.stringify(__assignmentExpected)');
 await c.evaluate('(()=>{const host=document.createElement(\'div\');host.id=\'assignment-other-search\';document.body.append(host);const picker=cmatch.render_tabletoperator_player_picker(host,{});[...document.querySelectorAll(\'.tabletoperator_replacement_suggestions\')].at(-1).id=\'assignment-other-suggestions\';picker.input.value=\'Max\';picker.input.dispatchEvent(new Event(\'input\',{bubbles:true}));})()');
 await verify('The standalone tablet participant search uses the same availability order','JSON.stringify(__assignmentOrder(\'#assignment-other-suggestions\'))===JSON.stringify(__assignmentExpected)');
 await c.evaluate('document.getElementById(\'assignment-other-suggestions\').remove();document.getElementById(\'assignment-other-search\').remove()');
 for(const width of [1920,390,320]) {
  await metrics(width,width===1920?1080:844);
  await c.evaluate('__assignmentInput.scrollIntoView({block:\'center\'});__searchAssignment()');
  await verify('Assignment suggestions and their icons fit the input at '+width+' pixels','(()=>{const list=document.querySelector(\'.tabletoperator_assignment_suggestions\'),box=list.getBoundingClientRect(),input=__assignmentInput.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth&&Math.abs(box.width-input.width)<1&&getComputedStyle(list).fontSize===getComputedStyle(__assignmentInput).fontSize&&[\'Karl Maximilian Weyand\',\'Max Hahn\'].every(name=>{const row=__assignmentOption(name),icon=row.querySelector(\'.ls-tablet-assignment-icon\').getBoundingClientRect(),label=row.querySelector(\'.tabletoperator_assignment_label\').getBoundingClientRect();return icon.right<=label.left&&label.right<=box.right})})()');
 }
 await metrics(1920,1080);await c.evaluate('__searchAssignment()');
 await capture('spiel-dialog-tablet-status');
 await c.evaluate('__assignmentMax.setup.preparation_call_timestamp=3000;__searchAssignment()');
 await verify('A repeated preparation call reorders the existing open search immediately','__assignmentOrder(\'.tabletoperator_assignment_suggestions\').indexOf(\'Max Hahn\')<__assignmentOrder(\'.tabletoperator_assignment_suggestions\').indexOf(\'Karl Maximilian Weyand\')');
 await c.evaluate('__assignmentKarl.setup.preparation_call_deferred=true;__assignmentLive.team1_won=false;__searchAssignment()');
 await verify('The same open picker removes withdrawn preparation and newly finished tablet assignments','!__assignmentOption(\'Karl Maximilian Weyand\').querySelector(\'svg,.ls-resource-court\')&&!__assignmentOption(\'Maxim Gebauer\').querySelector(\'svg,.ls-resource-court\')');
 await c.evaluate('Object.assign(__assignmentKarl.setup,{state:\'oncourt\',now_on_court:true,court_id:\'CH_9\'});__searchAssignment()');
 await verify('A subsequent court call replaces preparation with the current playing field','__assignmentOption(\'Karl Maximilian Weyand\').querySelector(\'[aria-label="Spielt auf Feld 9"] .ls-resource-court\').textContent===\'9\'&&!__assignmentOption(\'Karl Maximilian Weyand\').querySelector(\'svg\')');
 await c.evaluate('__assignmentOption(\'Max Hahn\').dispatchEvent(new MouseEvent(\'mousedown\',{bubbles:true,cancelable:true}))');
 await verify('Selecting a prepared player still retains the intended participant identity in the draft','__assignmentInput.value===\'Max Hahn\'&&document.querySelector(\'[name="tabletoperator_replacement_btp_id"]\').value===\'990099\'&&document.querySelector(\'[name="tabletoperator_replacement_name"]\').value===\'Max Hahn\'');
 await c.evaluate('(()=>{curt.matches=__assignmentDraft.matches;for(const[input,value]of __assignmentDraft.values)input.value=value;document.querySelector(\'.tabletoperator_assignment_selected_icon\').replaceChildren(...__assignmentDraft.icon.childNodes);document.querySelector(\'.tabletoperator_assignment_suggestions\').style.display=\'none\';delete window.__assignmentDraft;})()');
};
