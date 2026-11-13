'use strict';
/* eslint-disable no-console -- Native DOM retention and geometry regressions. */
const assert=require('assert'),fs=require('fs');
module.exports=async function({c,open,metrics}) {
 await require('./call-status-benchmark')({c,open,afterSetup:async()=>{
  const result=await c.evaluate(`(async()=>{
   const settle=__statusBench.settle,checks={},evidence={};
   curt.displays[0].court_id='C0';curt.displays[0].battery={level:.50,charging:true};cleitstand.refreshTablets();await settle();
   const row=document.querySelector('[data-tablet-client-id="21"]'),children=[...row.querySelectorAll('*')],fill=row.querySelector('.ls-tablet-battery-fill'),charge=row.querySelector('.ls-tablet-battery-charge');
   const records=[],observer=new MutationObserver(batch=>records.push(...batch));observer.observe(row,{subtree:true,attributes:true,childList:true,characterData:true});
   const update=(level,charging)=>{curt.displays[0].battery={level,charging};cleitstand.refreshTablets()};
   update(.51,true);await Promise.resolve();records.push(...observer.takeRecords());
   checks.batteryNodesRetained=children.every(node=>node.isConnected)&&charge===row.querySelector('.ls-tablet-battery-charge')&&fill===row.querySelector('.ls-tablet-battery-fill');
   evidence.batteryMutations=records.length;checks.batteryNoChildReplacement=records.every(record=>record.type!=='childList');checks.batteryCaptionAndFill=fill.style.width==='25.5px'&&[...row.querySelectorAll('.ls-tablet-percent')].every(node=>node.textContent==='51%');
   records.length=0;update(.511,true);await Promise.resolve();checks.sameVisiblePercentNoMutations=records.length+observer.takeRecords().length===0;
   update(.24,false);checks.warningAndBoltHidden=row.querySelector('.ls-tablet-battery').classList.contains('is-low')&&[...row.querySelectorAll('.ls-tablet-charging')].every(node=>node.hidden&&getComputedStyle(node).display==='none');
   update(.09,true);checks.criticalAndCharging=row.querySelector('.ls-tablet-battery').classList.contains('is-critical')&&row.querySelector('.ls-tablet-battery').classList.contains('is-charging')&&[...row.querySelectorAll('.ls-tablet-charging')].every(node=>!node.hidden);
   update(1,true);checks.fullStopsAnimation=!row.querySelector('.ls-tablet-battery').classList.contains('is-charging')&&fill.style.width==='50px';
   update(null,false);checks.unknown=row.querySelector('.ls-tablet-battery').classList.contains('is-unknown')&&fill.hidden&&row.querySelector('.ls-tablet-percent').textContent==='—';
   update(.80,true);checks.batteryRecovered=fill.style.width==='40px'&&!fill.hidden&&charge===row.querySelector('.ls-tablet-battery-charge');observer.disconnect();
   curt.displays[0].court_id='C1';cleitstand.refreshTablets();checks.changedCourtVisible=row.querySelector('.ls-tablet-field').textContent==='2';
   cleitstand.refreshCounts();await settle();const countRecords=[],countObserver=new MutationObserver(batch=>countRecords.push(...batch));
   document.querySelectorAll('.ls-location-row,.ls-history-pages,[data-field-counts]').forEach(node=>countObserver.observe(node,{subtree:true,attributes:true,childList:true,characterData:true}));
   for(let i=0;i<5;i++)cleitstand.refreshCounts();await Promise.resolve();countRecords.push(...countObserver.takeRecords());checks.unchangedCountsNoMutations=countRecords.length===0;evidence.countMutations=countRecords.length;countObserver.disconnect();
   curt.btp_enabled=curt.btp_autofetch_enabled=true;curt.btp_autofetch_timeout_intervall=30;
   const status={status:'connected',next_fetch_ts:Date.now()+29500,message:''};ctournament.btp_status_changed({val:status});
   const badge=document.querySelector('.btp_status_badge'),prefix=badge.querySelector('.toprow_service_badge_prefix'),clock=badge.querySelector('.toprow_service_badge_timer'),text=clock.firstChild;
   const badgeRecords=[],badgeObserver=new MutationObserver(batch=>badgeRecords.push(...batch));badgeObserver.observe(badge,{subtree:true,attributes:true,childList:true,characterData:true});
   for(let i=0;i<5;i++)ctournament.btp_status_changed({val:{...status}});await Promise.resolve();badgeRecords.push(...badgeObserver.takeRecords());checks.unchangedCountdownNoMutations=badgeRecords.length===0;evidence.unchangedBadgeMutations=badgeRecords.length;
   badgeRecords.length=0;ctournament.btp_status_changed({val:{...status,next_fetch_ts:status.next_fetch_ts-1000}});await Promise.resolve();badgeRecords.push(...badgeObserver.takeRecords());
   checks.countdownTextRetained=prefix===badge.querySelector('.toprow_service_badge_prefix')&&clock===badge.querySelector('.toprow_service_badge_timer')&&text===clock.firstChild&&clock.textContent==='29 s';
   checks.countdownOneTextWrite=badgeRecords.length===1&&badgeRecords[0].type==='characterData';badgeObserver.disconnect();
   ctournament.btp_status_changed({val:{status:'error',message:'Testfehler'}});checks.errorBadge=badge.textContent==='Fehler'&&badge.classList.contains('status_error')&&badge.title==='Testfehler';
   ctournament.btp_status_changed({val:{...status,fetch_in_progress:true}});checks.fetchBadge=badge.textContent==='läuft'&&badge.classList.contains('is-fetching');
   ctournament.btp_status_changed({val:status});checks.countdownRestored=!!badge.querySelector('.toprow_service_badge_timer')&&badge.classList.contains('is-countdown')&&!badge.classList.contains('is-fetching');
   curt.btp_enabled=false;ctournament.btp_status_changed({val:{status:'deactivated'}});checks.offBadge=badge.textContent==='aus'&&!badge.querySelector('.toprow_service_badge_timer');
   window.__retention={checks,evidence};
   const container=document.querySelector('.unassigned_container'),table=container.querySelector('.ls-planned-table'),rows=[...table.querySelectorAll('tr[data-match_id]')].slice(0,2),captions=rows.map(row=>row.querySelector('.ls-call-location'));
   const originals=captions.map(node=>node.textContent);
   const refresh=(changedRows,full=false)=>cleitstand.refreshUnassigned(container,{controlsChanged:true,boundariesChanged:false,structureChanged:full,changedRows});
   const width=()=>parseFloat(table.style.getPropertyValue('--preparation-width'));
   const compare=async(name)=>{await settle();const targeted=width();refresh(null,true);await settle();checks[name]=targeted===width();evidence[name]={targeted,full:width()};return targeted};
   captions[0].textContent='M'.repeat(40);refresh([rows[0]]);const first=await compare('growingWidthMatchesFull');
   captions[1].textContent='W'.repeat(65);refresh([rows[1]]);const second=await compare('secondMaximumMatchesFull');checks.grew=second>first&&first>92;
   captions[0].textContent=originals[0];refresh([rows[0]]);await compare('unaffectedMaximumRetained');checks.secondMaximumRetained=width()===second;
   captions[1].textContent=originals[1];refresh([rows[1]]);await compare('shrinkingWidthMatchesFull');checks.widthRestored=width()===92;
   captions[0].textContent='M'.repeat(40);refresh([rows[0]]);await settle();__retention.widthBeforeResize=width();
   __retention.refresh=()=>refresh(null,true);__retention.width=width;
   return {checks,evidence};
  })()`);
  for(const width of [1000,1920]) {
   await metrics(width,1080);await c.evaluate('__statusBench.settle()');
   const evidence=await c.evaluate('(async()=>{const targeted=__retention.width();__retention.refresh();await __statusBench.settle();return{targeted,full:__retention.width()}})()');
   result.checks['resize'+width]=evidence.targeted===evidence.full;result.evidence['resize'+width]=evidence;
  }
  const extra=await c.evaluate(`(async()=>{
   const checks={},evidence={},settle=__statusBench.settle,table=document.querySelector('.ls-planned-table');
   const compare=async key=>{await settle();const targeted=__retention.width();__retention.refresh();await settle();checks[key]=targeted===__retention.width();evidence[key]={targeted,full:__retention.width()}};
   const toggle=table.querySelector('.ls-date-row button');toggle.click();await compare('dateCollapsed');checks.collapsedMinimum=__retention.width()===92;
   toggle.click();await compare('dateExpanded');checks.expandedWidthRestored=__retention.width()>92;
   for(let i=0;i<3;i++){document.querySelector('[data-action="density"]').click();await compare('density'+i)}
   const wide=table.querySelector('tr[data-match_id="status-26"]'),other=table.querySelector('tr[data-match_id="status-27"]');wide.remove();
   cleitstand.refreshUnassigned(table.closest('.unassigned_container'),{controlsChanged:true,boundariesChanged:false,structureChanged:false,changedRows:[other]});
   await compare('removedMaximum');checks.removedMaximumReleased=__retention.width()===92;
   return {checks,evidence};
  })()`);
  Object.assign(result.checks,extra.checks);Object.assign(result.evidence,extra.evidence);
  assert(Object.values(result.checks).every(Boolean),'Every retention and geometry check must pass: '+JSON.stringify(result));
  assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No browser exceptions');
  if(process.env.BTS_DOM_RETENTION_REPORT)fs.writeFileSync(process.env.BTS_DOM_RETENTION_REPORT,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
 }});
};
