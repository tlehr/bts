'use strict';
/* eslint-disable no-console, quotes -- Native browser checks embed JavaScript scripts. */
const fs=require('fs'),assert=require('assert');
module.exports=async({c,open,previews})=>require('./call-status-benchmark')({c,open,afterSetup:async()=>{
 const result=await c.evaluate(`(async()=>{
  const qa={tvRefreshes:0,foreignProjections:0},refresh=cleitstand.refreshTablets,silent=cerror.silent;
  cleitstand.refreshTablets=function(...args){qa.tvRefreshes++;return refresh.apply(this,args)};
  cerror.silent=message=>{if(!/^Display .* is (online|offline)$/.test(message))silent(message);};
  const status=value=>crouting.on_change({ctype:'display_status_changed',tournament_key:'preview',val:{display_court_displaysetting:value}});
  const row=id=>document.querySelector('[data-tablet-client-id="'+id+'"]');
  const stats=id=>crouting.on_change({ctype:'display_render_stats',tournament_key:'preview',val:{client_id:id,display_render_stats:{ack_count:1}}});
  try {
   const tabletRows=[...document.querySelectorAll('[data-tablet-client-id]')],observer=new MutationObserver(()=>{});
   observer.observe(document.querySelector('[data-board-card="tablets"]'),{subtree:true,childList:true,attributes:true,characterData:true});
   for(let i=0;i<100;i++)status({client_id:'30',hostname:'Hall Display '+i,battery:{level:i/100,charging:false}});
   status({client_id:'30',online:false});stats('30');status({client_id:'new-tv',online:true,panel_devicemode:'display'});
   await btsAdminUpdates.whenSettled();await __statusBench.settle();
   qa.tvMutations=observer.takeRecords().length;observer.disconnect();qa.tvRowsRetained=tabletRows.every(node=>node.isConnected);
   qa.tvRefreshCount=qa.tvRefreshes;qa.tvModelCurrent=curt.displays.find(d=>d.client_id==='30').hostname==='Hall Display 99';
   const foreign=curt.displays.find(d=>d.client_id==='22'),hostname=foreign.hostname;
   Object.defineProperty(foreign,'hostname',{configurable:true,enumerable:true,get(){qa.foreignProjections++;return hostname}});
   document.querySelector('.ls-tablet-sort[data-sort-key="battery"]').click();await __statusBench.settle();
   qa.foreignProjections=0;qa.tvRefreshes=0;const target=row('21'),other=row('22'),otherHTML=other.innerHTML;
   status({client_id:'21',battery:{level:.02,charging:false}});await btsAdminUpdates.whenSettled();await __statusBench.settle();
   qa.batteryFirst=document.querySelector('[data-tablet-client-id]').dataset.tabletClientId==='21';
   qa.batteryCorrect=row('21')===target&&target.querySelector('.ls-tablet-percent').textContent==='2%';
   qa.otherUnchanged=row('22')===other&&other.innerHTML===otherHTML;
   const before=qa.foreignProjections;status({client_id:'21',battery:{level:.99,charging:true}});await btsAdminUpdates.whenSettled();await __statusBench.settle();
   qa.batterySortCorrect=[...document.querySelectorAll('[data-tablet-client-id]')].map(node=>node.dataset.tabletClientId).join(',')==='23,22,21,24';
   qa.foreignAfterSecond=qa.foreignProjections-before;
   Object.defineProperty(foreign,'hostname',{value:hostname,writable:true,configurable:true,enumerable:true});
   status({client_id:'new-tablet',online:true,panel_devicemode:'umpire',hostname:'New Tablet',battery:{level:.3}});await __statusBench.settle();
   qa.newTablet=!!row('new-tablet');status({client_id:'new-tablet',online:false});await __statusBench.settle();qa.offlineRemoved=!row('new-tablet');
   const alias={client_id:21,online:true,panel_devicemode:'umpire',hostname:'Legacy duplicate',battery:{level:.1}};curt.displays.push(alias);
   status({client_id:21,battery:{level:.2}});await __statusBench.settle();qa.duplicateAliasCorrect=row('21').querySelector('.ls-tablet-percent').textContent==='99%';
   curt.displays=curt.displays.filter(device=>device!==alias);
   status({client_id:'21',court_id:curt.courts[0]._id});await __statusBench.settle();const court=curt.courts[0],oldNumber=court.num;court.num='101';
   status({client_id:'21',battery:{level:.88,charging:false}});await __statusBench.settle();qa.metadataFallback=row('21').querySelector('.ls-tablet-field').textContent==='101'&&row('21').querySelector('.ls-tablet-percent').textContent==='88%';
   court.num=oldNumber;status({client_id:'21',battery:{level:.87,charging:false}});await __statusBench.settle();
   const previous=row('21');ctournament.ui_show();await __statusBench.settle();const rebuilt=row('21');status({client_id:'21',battery:{level:.66,charging:false}});await btsAdminUpdates.whenSettled();await __statusBench.settle();
   qa.rebuildCurrent=!previous.isConnected&&rebuilt===row('21')&&rebuilt.querySelector('.ls-tablet-percent').textContent==='66%';
   return {...qa,errors:__statusErrors};
  } finally {cleitstand.refreshTablets=refresh;cerror.silent=silent;}
 })()`);
 fs.writeFileSync(previews+'/tablet-update-scope-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 assert(result.tvRowsRetained&&result.tvModelCurrent&&result.batteryFirst&&result.batteryCorrect&&result.otherUnchanged&&result.batterySortCorrect&&result.newTablet&&result.offlineRemoved&&result.rebuildCurrent&&result.duplicateAliasCorrect&&result.metadataFallback&&!result.errors.length,'Actual device data, battery, ordering, connection changes and rebuilt references stay correct');
 assert.strictEqual(result.tvRefreshCount,0,'TV status must not rebuild tablet descriptors');
 assert.strictEqual(result.tvMutations,0,'TV status cannot change the tablet card');
 assert.strictEqual(result.foreignProjections,0,'A battery update must not project another tablet');
 assert.strictEqual(result.foreignAfterSecond,0,'The next battery update must retain the same independent projection');
}});
