'use strict';
/* eslint-disable no-console -- Isolated native browser check. */
const assert = require('assert');
module.exports = async function({c,open}) {
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await open(1920,1080);
 const result = await c.evaluate(`(async()=>{
  const settle=()=>new Promise((resolve,reject)=>{let stable=0;const limit=performance.now()+10000;const frame=()=>{if(performance.now()>limit)return reject(Error('Status UI did not settle'));stable=cleitstand.isUpdating()||ctournament.isUpdating()?0:stable+1;if(stable===3)resolve();else requestAnimationFrame(frame)};requestAnimationFrame(frame)});
  await settle();
  const match=curt.matches.find(item=>item._id==='match-53'),result={};
  let refreshes=0;const refresh=cmatch.refresh_unassigned_preparation_context;
  cmatch.refresh_unassigned_preparation_context=function(...args){refreshes++;return refresh.apply(this,args)};
  const snapshot=(revision,allowed=true,epoch='shared-test')=>({call_status:{epoch,revision,evaluated_at:Date.now(),valid_until:null},selections:curt.locations.map(location=>({location_id:location._id,manual_callable_match_ids:allowed?[match._id]:[],diagnostics_by_match_id:{},call_on_court_diagnostics_by_match_id:{}}))});
  const buttons=()=>[...document.querySelectorAll('.unassigned_container tr[data-match_id="'+match._id+'"] .match_preparation_call_button')].map(node=>node.dataset.location_id).sort().join(',');
  ctournament.apply_call_status(snapshot(1),'preview');await settle();result.allowed=buttons()==='CH,SN';
  const before=refreshes;ctournament.apply_call_status(snapshot(1,false),'preview');result.duplicateIgnored=refreshes===before&&buttons()==='CH,SN';
  change.default_handler(()=>{throw Error('Status push rerendered the whole board')})( {ctype:'call_status_changed',tournament_key:'preview',val:snapshot(2,false)} );
  await settle();result.pushRemovedButtons=buttons()==='';
  ctournament.apply_call_status(snapshot(1),'preview');result.lateResponseIgnored=buttons()==='';
  ctournament.apply_call_status(snapshot(3),'other-tournament');result.wrongTournamentIgnored=buttons()==='';
  ctournament.apply_call_status(snapshot(1,true,'restarted-server'),'preview');await settle();result.restartAccepted=buttons()==='CH,SN';
  ctournament.apply_call_status(snapshot(10,false),'preview');result.oldServerIgnored=buttons()==='CH,SN';
  curt.preparation_call_debug_icons_enabled=true;curt.preparation_call_debug_output_enabled=false;
  const value=snapshot(1,true,'projected-status');
  const diagnosis={manual_eligible:true,criteria_eligible:true,within_call_window:true,rules:[{key:'player_pause',passed:true,detail:'first explanation'}]};
  value.selections[0].diagnostics_by_match_id[match._id]=diagnosis;
  ctournament.apply_call_status(value,'preview');await settle();
  const icon=document.querySelector('.unassigned_container tr[data-match_id="'+match._id+'"] .preparation_debug_icon');icon.focus();
  result.tooltipOnDemand=icon.title.includes('first explanation');
  const refreshBeforeDetails=refreshes;
  const patch=(revision,detail)=>({call_status:{epoch:'projected-status',revision},selections_delta:{epoch:'projected-status',base:revision-1,removed:[],changed:[{
   location_id:value.selections[0].location_id,fields:{},unset:[],diagnostics_by_match_id:{set:{[match._id]:{...diagnosis,rules:[{key:'player_pause',passed:true,detail}]}},remove:[]},
  }]}});
  ctournament.apply_call_status(patch(2,'updated hovered explanation'),'preview');await settle();
  result.detailsDoNotVisitRows=refreshes===refreshBeforeDetails;
  result.focusedTooltipFresh=icon.isConnected&&icon.title.includes('updated hovered explanation');
  icon.click();await settle();
  ctournament.apply_call_status(patch(3,'new live dialog explanation'),'preview');await settle();
  result.openDialogFresh=document.querySelector('.ls-call-status-dialog')?.textContent.includes('new live dialog explanation')===true;
  result.detailsKeepControls=buttons()==='CH,SN'&&refreshes===refreshBeforeDetails;
  cmatch.refresh_unassigned_preparation_context=refresh;
  return {...result,refreshes};
 })()`);
 for(const [name,passed] of Object.entries(result)) if(name!=='refreshes') assert.strictEqual(passed,true,name);
 assert.strictEqual(result.refreshes,4);
 console.log(JSON.stringify({checks:result}));
};
