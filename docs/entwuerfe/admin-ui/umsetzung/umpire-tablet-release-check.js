'use strict';

module.exports = async function({ c, open, check }) {
 await open(1424,940);
 await c.evaluate(`(()=>{
  const saved=structuredClone(curt),native=window.send;
  window.send=(message,callback)=>{
   if(message.type==='tournament_edit_prop')saved[message.field]=message.value;
   if(message.type==='tournament_get')return setTimeout(()=>callback(null,{tournament:structuredClone(saved)}),0);
   return native(message,callback);
  };
 })()`);
 await c.evaluate(`crouting.navigate_to('t/:key/edit',{key:'preview'})`);
 await check('Settings offer the new release option with an explanation',`(()=>{const input=document.querySelector('[name="tabletoperator_release_on_umpire_enabled"]');return input&&!input.disabled&&!input.checked&&input.closest('label').textContent.includes('bei Feldaufruf mit Schiedsrichter freigeben')&&input.title.includes('nächsten Wartenden dieses Feldes');})()`);
 await c.evaluate(`document.querySelector('[name="tabletoperator_release_on_umpire_enabled"]').click()`);
 await check('The release option saves through the normal live settings request',`curt.tabletoperator_release_on_umpire_enabled===true&&__writes.some(message=>message.type==='tournament_edit_prop'&&message.field==='tabletoperator_release_on_umpire_enabled'&&message.value===true)`);
 await c.evaluate(`document.querySelector('[name="tabletoperator_with_umpire_enabled"]').click()`);
 await check('Requesting both umpire and tablet operator disables the waiver while keeping its saved preference',`curt.tabletoperator_with_umpire_enabled===true&&document.querySelector('[name="tabletoperator_release_on_umpire_enabled"]').disabled&&document.querySelector('[name="tabletoperator_release_on_umpire_enabled"]').checked`);
 await c.evaluate(`document.querySelector('[name="tabletoperator_with_umpire_enabled"]').click()`);
 await check('Removing the extra operator requirement makes the release option available again',`!curt.tabletoperator_with_umpire_enabled&&!document.querySelector('[name="tabletoperator_release_on_umpire_enabled"]').disabled`);
 await c.evaluate(`document.querySelector('[name="tabletoperator_enabled"]').click()`);
 await check('Disabling tablet service disables the new suboption',`!curt.tabletoperator_enabled&&document.querySelector('[name="tabletoperator_release_on_umpire_enabled"]').disabled`);
 await c.evaluate(`document.querySelector('[name="tabletoperator_enabled"]').click()`);
 await check('Re-enabling tablet service restores the release control',`curt.tabletoperator_enabled&&!document.querySelector('[name="tabletoperator_release_on_umpire_enabled"]').disabled`);
 await c.evaluate(`crouting.navigate_to('t/:key/',{key:'preview'});crouting.navigate_to('t/:key/edit',{key:'preview'})`);
 await check('Reopening settings retains the selected release option',`curt.tabletoperator_enabled&&document.querySelector('[name="tabletoperator_release_on_umpire_enabled"]').checked&&!document.querySelector('[name="tabletoperator_release_on_umpire_enabled"]').disabled`);
 await c.evaluate(`crouting.navigate_to('t/:key/',{key:'preview'})`);
 await check('Returning to the games reloads the saved setting',`!!document.querySelector('[data-board-card="operators"] .operator-count')&&curt.tabletoperator_release_on_umpire_enabled`);
 await c.evaluate(`(()=>{window.__waiverRows=[...document.querySelectorAll('.courts_container .court_row,.unassigned_container tr.match')];window.__waiverBefore=Number(document.querySelector('[data-board-card="operators"] .operator-count').textContent);const entry=curt.tabletoperators.find(row=>row.court==null);crouting.on_change({ctype:'tabletoperator_removed',tournament_key:'preview',val:{tabletoperator:{...entry,court:-1,release_reason:'umpire',released_for_match_id:'match-44'}}});})()`);
 await check('A waived duty immediately reduces the operator count and preserves all existing game rows',`Number(document.querySelector('[data-board-card="operators"] .operator-count').textContent)===__waiverBefore-1&&__waiverRows.every(row=>row.isConnected)`);
 console.log(JSON.stringify({checks:9,kind:'umpire-tablet-release'}));
};
