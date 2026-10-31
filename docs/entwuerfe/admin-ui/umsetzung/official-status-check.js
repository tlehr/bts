'use strict';

module.exports=async function({c,verify,delay,capture}) {
 await c.evaluate(`(()=>{
  window.__officialContextDraft={clock:curt.test_clock,umpires:curt.umpires};
  window.__officialPauseBase=Date.now();curt.test_clock={mode:'fixed',fixed_ts:__officialPauseBase};
  curt.umpires=curt.umpires.map(person=>({...person}));
  const person=name=>curt.umpires.find(person=>person.name===name);
  person('Sven Weber').umpire_pause=__officialPauseBase+65000;
  Object.assign(person('Bertha Baller'),{service_judge_wait:null,service_judge_pause:__officialPauseBase+4000});
  person('Anton Anderson').umpire_pause=__officialPauseBase-1;
  Object.assign(person('Toni Meier'),{umpire_on_court:'CH_2',umpire_pause:__officialPauseBase+90000});
  person('Kim Wolf').service_judge_on_court='CH_13';
  window.__officialContextRow=name=>__officialVisible('umpire').find(row=>row.querySelector('.ls-official-option-label').textContent.startsWith(name));
  btsOfficialPicker.closeAll();__officialOpen('umpire');
 })()`);
 await verify('Both official roles show the actual field graphic and accessible field number','__officialContextRow(\'Toni Meier\').querySelector(\'.ls-resource-court\').textContent===\'2\'&&__officialContextRow(\'Kim Wolf\').querySelector(\'.ls-resource-court\').textContent===\'13\'&&__officialContextRow(\'Toni Meier\').querySelector(\'.ls-resource-court\').getAttribute(\'aria-label\').includes(\'Feld 2\')');
 await verify('Active automatic pauses show a red clock with remaining time for both roles','[\'Sven Weber\',\'Bertha Baller\'].every(name=>{const pause=__officialContextRow(name).querySelector(\'.ls-official-pause\');return !pause.hidden&&pause.querySelector(\'svg\')&&getComputedStyle(pause).color===\'rgb(175, 69, 62)\';})&&__officialContextRow(\'Sven Weber\').querySelector(\'.ls-official-pause>span\').textContent===\'1:05\'&&__officialContextRow(\'Bertha Baller\').querySelector(\'.ls-official-pause>span\').textContent===\'0:04\'');
 await verify('Manual and expired pauses have no countdown and an occupied field takes priority','[\'Hans Heinrich\',\'Anton Anderson\',\'Toni Meier\'].every(name=>__officialContextRow(name).querySelector(\'.ls-official-pause\').hidden)');
 await c.evaluate('window.__officialDetailMutations=[];window.__officialDetailObserver=new MutationObserver(records=>__officialDetailMutations.push(...records));__officialDetailObserver.observe(__officialPopup(\'umpire\'),{attributes:true,characterData:true,childList:true,subtree:true});btsOfficialPicker.refreshDetails()');
 await verify('Repeated field and pause details produce no DOM mutations','__officialDetailMutations.length===0');
 await c.evaluate('__officialDetailObserver.disconnect()');
 await capture('spiel-dialog-offizielle-status');
 await c.evaluate('window.__officialPauseRow=__officialContextRow(\'Sven Weber\');window.__officialPauseText=__officialPauseRow.querySelector(\'.ls-official-pause>span\').firstChild;window.__officialPauseMutations=[];window.__officialPauseObserver=new MutationObserver(records=>__officialPauseMutations.push(...records));__officialPauseObserver.observe(__officialPauseRow,{childList:true,subtree:true});curt.test_clock.fixed_ts+=2000');
 await delay(1200);
 await verify('The shared live countdown changes only its cached text and retains the suggestion row','__officialContextRow(\'Sven Weber\')===__officialPauseRow&&__officialPauseText===__officialPauseRow.querySelector(\'.ls-official-pause>span\').firstChild&&__officialPauseText.nodeValue===\'1:03\'&&__officialPauseMutations.length===0');
 await c.evaluate('__officialPauseObserver.disconnect();curt.test_clock.fixed_ts=__officialPauseBase+66000');
 await delay(1200);
 await verify('Expired pause clocks disappear without rebuilding their official entries','__officialContextRow(\'Sven Weber\')===__officialPauseRow&&__officialPauseRow.querySelector(\'.ls-official-pause\').hidden&&__officialContextRow(\'Bertha Baller\').querySelector(\'.ls-official-pause\').hidden');
 await c.evaluate('window.__officialFieldRow=__officialContextRow(\'Toni Meier\');crouting.on_change({ctype:\'umpire_updated\',tournament_key:\'preview\',val:{...curt.umpires.find(person=>person.name===\'Toni Meier\'),umpire_on_court:\'CH_5\'}})');
 await verify('A native official update changes the open field indicator while preserving its row and search focus','__officialContextRow(\'Toni Meier\')===__officialFieldRow&&__officialFieldRow.querySelector(\'.ls-resource-court\').textContent===\'5\'&&document.activeElement===__officialInput(\'umpire\')');
 await c.evaluate('crouting.on_change({ctype:\'umpires_changed\',tournament_key:\'preview\',val:{all_umpires:curt.umpires.map(person=>person.name===\'Toni Meier\'?{...person,umpire_on_court:\'CH_12\'}:person)}})');
 await verify('A bulk official update retains the open selection, full option list and cached field element','__officialContextRow(\'Toni Meier\')===__officialFieldRow&&__officialFieldRow.querySelector(\'.ls-resource-court\').textContent===\'12\'&&curt.umpires.every(person=>__officialVisible(\'umpire\').some(row=>row.querySelector(\'.ls-official-option-label\').textContent.startsWith(person.name)))&&__officialSelect(\'umpire\').value===\'Sven Weber\'&&__officialSelect(\'service_judge\').value===\'Kim Wolf\'');
 await c.evaluate('curt.umpires.find(person=>person.name===\'Sven Weber\').umpire_pause=__officialPauseBase+180000;btsOfficialPicker.refreshDetails();window.__officialOpenPending=btsTimerUpdates.stats().pending;btsOfficialPicker.closeAll();window.__officialClosedPending=btsTimerUpdates.stats().pending');
 await verify('Closing the picker cancels its single shared countdown wakeup','__officialOpenPending===__officialClosedPending+1&&__officialPopup(\'umpire\').hidden');
 await c.evaluate('curt.test_clock=__officialContextDraft.clock;curt.umpires=__officialContextDraft.umpires;ctournament.update_officials();__officialOpen(\'umpire\');delete window.__officialContextDraft');
};
