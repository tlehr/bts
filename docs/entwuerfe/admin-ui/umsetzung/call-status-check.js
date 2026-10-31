'use strict';
/* eslint no-console: off */
const fs=require('fs'),path=require('path');

module.exports=async function({c,check,click,open,metrics,previews,key}) {
 const checks=[],verify=async(name,expression)=>{await check(name,expression);checks.push(name);};
 await open(1920,1080);
 await c.evaluate(`(()=>{
  window.__callStatusRule=(key,passed=true,extra={})=>({key,passed,...extra});
  const rule=__callStatusRule;
  window.__callStatusSelections=[
   {location_id:'CH',diagnostics_by_match_id:{'match-48':{manual_eligible:true,eligible:false,rules:[
    rule('participants_complete'),rule('not_finished'),rule('player_pause',false,{detail:'Lara Seidel: noch 2 Minuten Pause. <img src=x onerror=alert(1)>'}),
    rule('technical_officials_available'),rule('frontier_time_limit',false,{enabled:false,group:'window'}),
   ]}}},
   {location_id:'SN',diagnostics_by_match_id:{'match-48':{manual_eligible:false,eligible:false,rules:[
    rule('participants_complete',false,{detail:'Eine Paarung steht noch nicht fest.'}),rule('not_finished'),
   ]}}},
  ];
  window.__callStatusOriginalSend=send;window.__callStatusReads=0;
  window.send=(message,callback)=>{
   if(message.type==='preparation_selection_get'){__callStatusReads++;const response=structuredClone(__callStatusSelections);setTimeout(()=>callback?.(null,{selections:response}),0);return;}
   return __callStatusOriginalSend(message,callback);
  };
  window.__callStatusDialog=()=>document.querySelector('.ls-call-status-dialog');
  window.__callStatusGroup=(location,group)=>__callStatusDialog().querySelector('[data-location-id="'+location+'"] [data-group="'+group+'"]');
  window.__callStatusChange=mutate=>{const match=structuredClone(curt.matches.find(item=>item._id==='match-48'));mutate(match);crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}});};
  ctournament.request_location_preparation_selections();
 })()`);
 await verify('Structured diagnostics are loaded through the existing preparation response','!ctournament.isUpdating()');
 const trigger='tr[data-match_id="match-48"] .preparation_debug_icon';
 await c.evaluate(`document.querySelector('${trigger}').focus();window.__callStatusInitialReads=__callStatusReads`);
 await key('Enter','Enter',13,'\r');
 await verify('Keyboard activation opens the named information dialog with the game number','!!__callStatusDialog()?.open&&__callStatusDialog().querySelector(\'h2\').textContent===\'Aufrufstatus · Spiel 48\'&&document.getElementById(__callStatusDialog().getAttribute(\'aria-labelledby\'))===__callStatusDialog().querySelector(\'h2\')');
 await verify('Opening the dialog adds no diagnostic requests or write commands','__callStatusReads===__callStatusInitialReads&&__writes.length===0');
 await verify('Manual and automatic release are reported separately','[...__callStatusDialog().querySelectorAll(\'.ls-call-summary .ls-call-state\')].map(node=>node.dataset.state).join(\',\')===\'ready,blocked\'');
 await verify('Locations and call types are separate labelled sections','[...__callStatusDialog().querySelectorAll(\'.ls-call-location>h3\')].map(node=>node.textContent).join(\',\')===\'Campus Hellweg,Sporthalle Nord\'&&__callStatusDialog().querySelectorAll(\'.ls-call-group\').length===4');
 await verify('Only unmet enabled conditions appear in the visible blockers','__callStatusGroup(\'CH\',\'manual\').querySelector(\'.ls-call-blockers\').hidden&&__callStatusGroup(\'CH\',\'automatic\').querySelector(\'.ls-call-blockers li\').textContent.includes(\'Lara Seidel\')&&__callStatusGroup(\'CH\',\'automatic\').querySelectorAll(\'.ls-call-blockers li\').length===1');
 await verify('Fulfilled and disabled checks start collapsed and disabled failures are not blockers','[...__callStatusDialog().querySelectorAll(\'.ls-call-checks\')].every(node=>!node.open)&&__callStatusGroup(\'CH\',\'automatic\').querySelector(\'[data-state="disabled"]\').textContent.includes(\'Zeitgrenze\')');
 await verify('Diagnostic details are rendered as text, including markup and names','!__callStatusDialog().querySelector(\'img\')&&__callStatusGroup(\'CH\',\'automatic\').textContent.includes(\'<img src=x onerror=alert(1)>\')&&!__callStatusDialog().querySelector(\'pre\')');
 await c.evaluate('(()=>{const details=__callStatusGroup(\'CH\',\'automatic\').querySelector(\'.ls-call-checks\');details.open=true;details.querySelector(\'summary\').focus();window.__callStatusExpanded=details;window.__callStatusFocus=document.activeElement;__callStatusSelections[0].diagnostics_by_match_id[\'match-48\'].rules.find(rule=>rule.key===\'player_pause\').passed=true;__callStatusSelections[0].diagnostics_by_match_id[\'match-48\'].eligible=true;ctournament.request_location_preparation_selections();})()');
 await verify('A new server diagnosis updates the open status and removes a resolved blocker','__callStatusGroup(\'CH\',\'automatic\').querySelector(\'.ls-call-state\').dataset.state===\'ready\'&&__callStatusGroup(\'CH\',\'automatic\').querySelector(\'.ls-call-blockers\').hidden');
 await verify('Live diagnosis preserves the same expanded disclosure and keyboard focus','__callStatusExpanded===__callStatusGroup(\'CH\',\'automatic\').querySelector(\'.ls-call-checks\')&&__callStatusExpanded.open&&document.activeElement===__callStatusFocus');
 await c.evaluate(String.raw`crouting.on_change({ctype:'prop_changed',tournament_key:'preview',val:{field:'automation_enabled',value:false}})`);
 await verify('Pausing automation is reflected live while manual calling stays available',String.raw`[...__callStatusDialog().querySelectorAll('.ls-call-summary .ls-call-state')].map(node=>node.dataset.state).join(',')==='ready,disabled'&&__callStatusDialog().querySelector('.ls-call-summary .ls-call-state[data-state="disabled"]').title.includes('pausiert')`);
 await c.evaluate(String.raw`crouting.on_change({ctype:'prop_changed',tournament_key:'preview',val:{field:'automation_enabled',value:true}});crouting.on_change({ctype:'prop_changed',tournament_key:'preview',val:{field:'call_preparation_matches_automatically_enabled',value:false}})`);
 await verify('A disabled preparation automation is distinct from satisfied prerequisites',String.raw`__callStatusDialog().querySelector('.ls-call-summary .ls-call-state[data-state="disabled"]').title.includes('ausgeschaltet')&&__callStatusGroup('CH','automatic').querySelector('.ls-call-state').dataset.state==='ready'`);
 await c.evaluate(String.raw`crouting.on_change({ctype:'prop_changed',tournament_key:'preview',val:{field:'call_preparation_matches_automatically_enabled',value:true}})`);
 await verify('Resuming automation restores its status without resetting disclosure state',String.raw`[...__callStatusDialog().querySelectorAll('.ls-call-summary .ls-call-state')].every(node=>node.dataset.state==='ready')&&__callStatusExpanded.open`);
 await c.evaluate('window.__callStatusMutations=[];window.__callStatusObserver=new MutationObserver(records=>__callStatusMutations.push(...records));__callStatusObserver.observe(__callStatusDialog(),{childList:true,subtree:true,attributes:true,characterData:true});ctournament.request_location_preparation_selections()');
 await verify('An unchanged diagnosis does not mutate or rebuild the dialog','__callStatusMutations.length===0');
 await c.evaluate(`__callStatusObserver.disconnect();__callStatusSelections=[{location_id:'CH',call_on_court_diagnostics_by_match_id:{'match-48':{eligible:true,court_diagnostics:[
  {court_id:'CH_13',court_num:13,eligible:true,rules:[__callStatusRule('players_checked_in'),__callStatusRule('call_on_court_preparation_age'),__callStatusRule('call_on_court_frontier_match_limit',false,{enabled:false,group:'window'})]},
  {court_id:'CH_4',court_num:4,eligible:false,rules:[__callStatusRule('players_checked_in',false,{detail:'Lara Seidel fehlt.'}),__callStatusRule('call_on_court_preparation_age')]},
  {court_id:'CH_2',court_num:2,eligible:true,rules:[__callStatusRule('players_checked_in')]},
 ]}}}];__callStatusChange(match=>{match.setup.state='preparation';match.setup.location_id='CH';match.setup.preparation_call_timestamp=Date.now()-180000});ctournament.request_location_preparation_selections()`);
 await verify('Starting preparation changes the open dialog to field checks for its assigned location','__callStatusDialog().querySelectorAll(\'.ls-call-location\').length===1&&__callStatusDialog().querySelectorAll(\'.ls-call-summary-row\').length===1&&__callStatusDialog().querySelector(\'.ls-call-summary-row\').textContent.includes(\'Aufruf aufs Feld\')');
 await verify('Fields are sorted numerically and an eligible free field opens first','[...__callStatusDialog().querySelectorAll(\'.ls-call-group\')].map(node=>node.dataset.group).join(\',\')===\'CH_2,CH_4,CH_13\'&&__callStatusGroup(\'CH\',\'CH_13\').open&&!__callStatusGroup(\'CH\',\'CH_2\').open');
 await verify('An occupied field is blocked even when rule diagnostics omit field availability','__callStatusGroup(\'CH\',\'CH_2\').querySelector(\'.ls-call-state\').dataset.state===\'blocked\'&&__callStatusGroup(\'CH\',\'CH_2\').textContent.includes(\'Feld ist belegt.\')');
 await click('.ls-call-location [data-group="CH_4"]>summary');
 await verify('Other field checks can be inspected individually','__callStatusGroup(\'CH\',\'CH_4\').open&&__callStatusGroup(\'CH\',\'CH_4\').querySelector(\'.ls-call-blockers\').textContent.includes(\'Lara Seidel fehlt.\')');
 await c.evaluate('(()=>{const match=structuredClone(curt.matches.find(item=>item._id===\'match-44\'));window.__callStatusOccupant=structuredClone(match);match.setup.court_id=\'CH_13\';crouting.on_change({ctype:\'match_edit\',tournament_key:\'preview\',val:{match__id:match._id,match}})})()');
 await verify('A live court occupant immediately blocks the last otherwise eligible field','__callStatusDialog().querySelector(\'.ls-call-summary .ls-call-state\').dataset.state===\'blocked\'&&__callStatusGroup(\'CH\',\'CH_13\').textContent.includes(\'Feld ist belegt.\')');
 await c.evaluate('crouting.on_change({ctype:\'match_edit\',tournament_key:\'preview\',val:{match__id:\'match-44\',match:__callStatusOccupant}})');
 await verify('Freeing a field restores readiness without losing an expanded field section','__callStatusDialog().querySelector(\'.ls-call-summary .ls-call-state\').dataset.state===\'ready\'&&__callStatusGroup(\'CH\',\'CH_4\').open');
 for(const [width,height]of [[320,568],[390,844],[1920,1080]]) {
  await metrics(width,height);
  await c.evaluate('__callStatusDialog().querySelectorAll(\'details\').forEach(node=>node.open=true);__callStatusDialog().querySelector(\'.dialog-content\').scrollTop=0');
  await verify('Header, content and footer fit the viewport at '+width,'(()=>{const d=__callStatusDialog(),r=d.getBoundingClientRect(),footer=d.querySelector(\'.ls-dialog-footer\').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&r.height<=innerHeight*.9+1&&d.scrollWidth<=d.clientWidth&&footer.bottom<=r.bottom&&d.querySelector(\'.ls-dialog-close\').offsetWidth===28})()');
  await c.evaluate('__callStatusDialog().querySelector(\'.dialog-content\').scrollTop=10000');
  await verify('The close action remains visible when only the content scrolls at '+width,'(()=>{const d=__callStatusDialog(),body=d.querySelector(\'.dialog-content\'),f=d.querySelector(\'.ls-dialog-footer\').getBoundingClientRect();return body.scrollWidth<=body.clientWidth&&body.getBoundingClientRect().bottom<=f.top+1&&f.bottom<=innerHeight&&getComputedStyle(d.querySelector(\'.ls-dialog-footer\')).flexShrink===\'0\'})()');
 }
 await c.evaluate('__callStatusDialog().querySelector(\'.dialog-content\').scrollTop=80;window.__callStatusScroll=__callStatusDialog().querySelector(\'.dialog-content\').scrollTop;__callStatusSelections[0].call_on_court_diagnostics_by_match_id[\'match-48\'].court_diagnostics[1].rules[0].detail=\'Lara Seidel ist weiterhin nicht eingecheckt.\';ctournament.request_location_preparation_selections()');
 await verify('Changed details preserve content scroll position and expanded sections','__callStatusDialog().querySelector(\'.dialog-content\').scrollTop===__callStatusScroll&&__callStatusGroup(\'CH\',\'CH_4\').open');
 await c.evaluate('__callStatusSelections=[];ctournament.request_location_preparation_selections()');
 await verify('Missing diagnostics show a neutral message instead of a stale release','__callStatusDialog().querySelector(\'.ls-call-summary .ls-call-state\').dataset.state===\'unknown\'&&!__callStatusDialog().querySelector(\'.dialog-content>.ls-call-empty\').hidden&&!__callStatusDialog().querySelector(\'.ls-call-location\')');
 await c.evaluate('__callStatusSelections=[{location_id:\'CH\',call_on_court_diagnostics_by_match_id:{\'match-48\':{eligible:true,court_diagnostics:[]}}}];ctournament.request_location_preparation_selections()');
 await verify('Empty field diagnostics retain an explicit unknown state','__callStatusGroup(\'CH\',\'unknown\').open&&__callStatusGroup(\'CH\',\'unknown\').querySelector(\'.ls-call-state\').dataset.state===\'unknown\'&&!__callStatusGroup(\'CH\',\'unknown\').querySelector(\'.ls-call-empty\').hidden');
 await c.evaluate('__callStatusChange(match=>{match.setup.now_on_court=true;match.setup.court_id=\'CH_4\';match.setup.state=\'oncourt\'})');
 await verify('A game starting on court clears obsolete eligibility while the dialog stays open','__callStatusDialog().querySelector(\'.ls-call-summary\').hidden&&!__callStatusDialog().querySelector(\'.ls-call-location\')&&__callStatusDialog().textContent.includes(\'bereits auf dem Feld\')');
 await c.evaluate('__callStatusChange(match=>{match.setup.state=\'finished\';match.team1_won=false})');
 await verify('Match completion replaces old conditions with the finished state','__callStatusDialog().textContent.includes(\'Das Spiel ist beendet.\')&&__callStatusDialog().querySelector(\'.ls-call-summary\').hidden');
 await click('.ls-call-status-dialog .ls-dialog-footer button');
 await verify('Footer close disposes the dialog','!__callStatusDialog()');
 // Restore a visible opener to check native Escape and focus restoration.
 await c.evaluate(`__callStatusChange(match=>{match.setup.now_on_court=false;match.setup.court_id=null;match.setup.state='scheduled';match.setup.location_id=null;delete match.team1_won});document.querySelector('${trigger}').focus()`);
 await key(' ','Space',32,' ');
 await verify('Space also activates the information control','!!__callStatusDialog()?.open');
 await key('Escape','Escape',27);
 await verify('Escape closes the dialog and restores focus to the information control',`!__callStatusDialog()&&document.activeElement.matches('${trigger}')`);
 await click(trigger);await click('.ls-call-status-dialog .ls-dialog-close');
 await verify('The shared header close control works as well','!__callStatusDialog()');
 await click(trigger);await c.evaluate('cleitstand.unmount()');
 await verify('Leaving the board disposes its status dialog','!__callStatusDialog()');
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 await verify('The status dialog causes no browser exceptions or tournament writes',String(!exceptions.length)+'&&__writes.length===0');
 fs.writeFileSync(path.join(previews,'call-status-verification.json'),JSON.stringify({date:'2026-11-01',checks,exceptions:exceptions.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
