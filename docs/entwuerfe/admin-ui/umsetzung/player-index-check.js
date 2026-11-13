'use strict';

const assert=require('assert');
const fs=require('fs');

// Exercise real player nodes and the MutationObserver index in the large-board
// fixture. Score, role and action bindings must not be searched for a player.
module.exports=async function({c,open,previews}) {
 await require('./call-status-benchmark')({c,open,afterSetup:async()=>{
  const result=await c.evaluate(`(async()=>{
   const match=curt.matches[30],row=document.querySelector('tr[data-match_id="'+match._id+'"]');
   cmatch.update_players(match);await btsAdminUpdates.whenSettled();await __statusBench.settle();
   const nonplayers=new WeakSet([...row.querySelectorAll('[data-match_id]'),row].filter(node=>!node.classList.contains('player')));
   const native=Element.prototype.matches;let foreignTests=0;
   Element.prototype.matches=function(...args){if(nonplayers.has(this))foreignTests++;return native.apply(this,args);};
   const player=match.setup.teams[0].players[0],node=row.querySelector('.player[data-btp_id="'+player.btp_id+'"]');
   try {player.checked_in=!player.checked_in;cmatch.update_player_status_indicators_for_match_players(match,{immediate:true});}
   finally {Element.prototype.matches=native;}
   await btsAdminUpdates.whenSettled();await __statusBench.settle();
   const checked=node.classList.contains(player.checked_in?'checked_in':'not_checked_in');
   player.btp_id=990123;node.setAttribute('data-btp_id','990123');player.checked_in=!player.checked_in;cmatch.update_players(match);
   await btsAdminUpdates.whenSettled();await __statusBench.settle();
   const reattributed=node.classList.contains(player.checked_in?'checked_in':'not_checked_in');
   const parent=node.parentNode,next=node.nextSibling,oldClass=node.className;
   node.remove();player.checked_in=!player.checked_in;cmatch.update_players(match);
   const detachedUntouched=node.className===oldClass;parent.insertBefore(node,next);cmatch.update_players(match);
   await btsAdminUpdates.whenSettled();await __statusBench.settle();
   return {nonplayer_selector_tests:foreignTests,checked,reattributed,detachedUntouched,
    reinserted:node.classList.contains(player.checked_in?'checked_in':'not_checked_in'),errors:__statusErrors};
  })()`);
  fs.writeFileSync(previews+'/player-index-verification.json',JSON.stringify(result,null,2)+'\n');
  assert(result.checked&&result.reattributed&&result.detachedUntouched&&result.reinserted&&!result.errors.length,
   'Actual player status, changed identity, detach and reinsert remain correct');
  assert.strictEqual(result.nonplayer_selector_tests,0,'Player updates must not test score, role and action nodes');
 }});
};
