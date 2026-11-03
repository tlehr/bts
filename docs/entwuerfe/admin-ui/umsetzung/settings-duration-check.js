'use strict';

module.exports = async function({c, verify, key, capture}) {
 await c.evaluate(String.raw`(()=>{
  window.__durationFields=[...document.querySelectorAll('.settings-content .duration-input')];
  window.__durationSaved=__durationFields.map(node=>({name:node.name,value:curt[node.name],initial:node.btsDuration.initial}));
  window.__durationField=name=>document.querySelector('.settings-content [name="'+name+'"]');
  window.__durationEdit=(name,text)=>{const node=__durationField(name);__settingsSection(node.closest('[data-settings-section]').dataset.settingsSection);node.value=text;node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));};
 })()`);
 await verify('All fifteen duration settings share minutes:seconds inputs and a visible minutes suffix', String.raw`__durationFields.length===15&&__durationFields.every(node=>node.type==='text'&&node.placeholder==='0:00'&&node.btsDuration&&node.parentElement.querySelector('.settings-field-unit').textContent==='Minuten'&&node.getAttribute('aria-describedby'))&&!document.querySelector('.settings-content input[type=time]')`);
 for (const [name, text, stored] of [
  ['tabletoperator_break_seconds','5:30',330],
  ['preparation_call_time_limit_before_scheduled_minutes','30:30',30.5],
  ['self_check_in_called_overlay_duration_ms','0:12,5',12500],
  ['announcement_pause_time_ms','0:00.125',.125],
  ['btp_autofetch_timeout_intervall','0:01,5',1.5],
 ]) {
  await c.evaluate(`__durationEdit(${JSON.stringify(name)},${JSON.stringify(text)})`);
  await verify('Entering '+text+' in '+name+' preserves its existing storage unit', `__settingsCommands.at(-1).field===${JSON.stringify(name)}&&__settingsCommands.at(-1).value===${stored}`);
  await c.evaluate(`__settingsReply(${JSON.stringify(name)})`);
 }
 await verify('Second fractions normalize to a decimal comma while retaining millisecond precision', String.raw`__durationField('announcement_pause_time_ms').value==='0:00,125'&&__durationField('self_check_in_called_overlay_duration_ms').value==='0:12,5'&&__durationField('btp_autofetch_timeout_intervall').value==='0:01,5'`);
 for (const [name, text] of [
  ['tabletoperator_break_seconds',''],['tabletoperator_break_seconds','5'],['tabletoperator_break_seconds','0:60'],
  ['technical_official_break_after_assignment_seconds','60:01'],
  ['preparation_call_time_limit_before_scheduled_minutes','180:01'],
  ['self_check_in_called_overlay_duration_ms','0:00'],
 ]) {
  await c.evaluate(`window.__durationBefore=__settingsCommands.length;__durationEdit(${JSON.stringify(name)},${JSON.stringify(text)})`);
  await verify('Invalid or out-of-range duration '+JSON.stringify(text)+' cannot save '+name, `__settingsCommands.length===__durationBefore&&__durationField(${JSON.stringify(name)}).getAttribute('aria-invalid')==='true'&&!__durationField(${JSON.stringify(name)}).checkValidity()`);
  await c.evaluate(`__durationField(${JSON.stringify(name)}).btsDuration.write(curt[${JSON.stringify(name)}]??__durationField(${JSON.stringify(name)}).btsDuration.initial);document.activeElement.blur()`);
 }
 await c.evaluate(String.raw`__settingsSection('officials');__durationField('tabletoperator_break_seconds').focus();__durationField('tabletoperator_break_seconds').setSelectionRange(4,4)`);
 await key('ArrowUp','ArrowUp',38);
 await verify('Arrow Up in the seconds part increases the duration by one second', String.raw`__durationField('tabletoperator_break_seconds').value==='5:31'&&__settingsCommands.at(-1).value===331`);
 await c.evaluate(String.raw`__settingsReply('tabletoperator_break_seconds');__durationField('tabletoperator_break_seconds').setSelectionRange(0,0)`);
 await key('ArrowDown','ArrowDown',40);
 await verify('Arrow Down in the minutes part decreases the duration by one minute', String.raw`__durationField('tabletoperator_break_seconds').value==='4:31'&&__settingsCommands.at(-1).value===271`);
 await c.evaluate(String.raw`__settingsReply('tabletoperator_break_seconds');__durationEdit('tabletoperator_break_seconds','6:00');__durationField('tabletoperator_break_seconds').value='6:30';__settingsReply('tabletoperator_break_seconds',{message:'Synthetic delayed duration error'})`);
 await verify('A failed older save preserves a newer duration draft', String.raw`__durationField('tabletoperator_break_seconds').value==='6:30'&&curt.tabletoperator_break_seconds===271`);
 await c.evaluate(String.raw`__durationField('tabletoperator_break_seconds').focus();__flowEmit('tabletoperator_break_seconds',330)`);
 await verify('A remote duration update preserves the focused draft', String.raw`__durationField('tabletoperator_break_seconds').value==='6:30'&&curt.tabletoperator_break_seconds===330`);
 await c.evaluate(String.raw`document.activeElement.blur();__flowEmit('tabletoperator_break_seconds',335)`);
 await verify('An unfocused duration receives live numeric values in the common minutes:seconds format', String.raw`__durationField('tabletoperator_break_seconds').value==='5:35'&&__durationFields.every(node=>node.isConnected)`);
 await c.evaluate(String.raw`__durationEdit('tabletoperator_break_seconds','5:40');__settingsReply('tabletoperator_break_seconds',{message:'Synthetic duration error'})`);
 await verify('A failed current save restores the previous duration without losing its format', String.raw`__durationField('tabletoperator_break_seconds').value==='5:35'&&curt.tabletoperator_break_seconds===335`);
 await c.evaluate(String.raw`__settingsSection('debug');__settingsSetClock('offset');__durationField('test_clock_offset_minutes').value='-2:30';document.querySelector('[name="test_clock_offset_target"]').value='';__durationField('test_clock_offset_minutes').closest('.settings-card').querySelector('.settings-card-actions .btn').click()`);
 await verify('The Debug clock accepts a negative minutes:seconds offset and sends milliseconds', String.raw`__settingsClockRequests.at(-1).mode==='offset'&&__settingsClockRequests.at(-1).offset_ms===-150000`);
 await c.evaluate(String.raw`__settingsClockReply({mode:'offset',fixed_ts:null,offset_ms:-150000})`);
 await verify('The confirmed clock offset retains seconds instead of rounding to whole minutes', String.raw`__durationField('test_clock_offset_minutes').value==='-2:30'`);
 await c.evaluate(String.raw`document.querySelector('[name="test_clock_reset"]').click();__settingsClockReply({mode:'real',fixed_ts:null,offset_ms:0})`);
 await c.evaluate(String.raw`(()=>{
  for(const {name,value,initial} of __durationSaved) {
   if(name==='test_clock_offset_minutes')continue;
   const node=__durationField(name);node.btsDuration.write(value??initial);curt[name]=value;
  }
  __settingsSection('officials');document.activeElement.blur();
 })()`);
 await c.evaluate('Promise.all([...document.querySelectorAll(".settings-area-link")].flatMap(node=>node.getAnimations()).map(animation=>animation.finished))');
 await capture('einstellungen-zeitfelder');
 await verify('Duration changes retain all mounted settings and the uninterrupted announcement', String.raw`__settingsPending.length===0&&__durationFields.every(node=>node.isConnected)&&announcementPlaybackActive&&__settingsCancels===0&&__settingsUnloads===0`);
};
