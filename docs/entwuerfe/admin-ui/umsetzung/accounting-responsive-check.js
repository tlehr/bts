'use strict';
const assert=require('assert');
module.exports=async function({c,open,check,click,metrics,key}) {
 await open(1366,768);
 await c.evaluate(`
  curt.accounting_entries=Array.from({length:4},(_,i)=>({id:'charge-'+i,kind:'charge',buyer_type:'player',buyer_id:String(i+1),player_id:String(i+1),player_name:i?'Maximilian Alexander Mustermann-Schneider':'Mia Becker',buyer_name:i?'Maximilian Alexander Mustermann-Schneider':'Mia Becker',club:'Badminton-Sportgemeinschaft Musterstadt und Umgebung',state:'Nordrhein-Westfalen',description:'Meldegeld Jugend-Doppel und weitere Turniergebühren',amount:1234.56+i,created_at:'2026-11-07T10:00:00Z'}));
  curt.accounting_items=[{id:'qa-item',name:'Turnierverpflegung und zusätzliche Trainingsbälle',unit_price:12.5,sale_unit:'Teilnehmer',billing_type:'optional',note:'Ausgabe am Infostand nach Vorlage der Buchungsbestätigung'}];
  window.__accountingResponsiveSend=send;
  window.send=(message,callback)=>message.type==='tournament_get'?setTimeout(()=>callback(null,{tournament:structuredClone(curt)}),0):__accountingResponsiveSend(message,callback);
 `);
 await click('.leitstand-nav a[href$="/accounting"]');
 await c.evaluate(`for(let pass=0;pass<3;pass++)document.querySelectorAll('.accounting_tree_toggle[aria-expanded="false"]').forEach(button=>button.click())`);
 for(const width of [1920,1366,1280,1100,1080,1024,768,390,320]) {
  await metrics(width,768);
  await check('Accounting fits the page at '+width,`document.documentElement.scrollWidth<=innerWidth`);
  await check('Accounting table has no horizontal scrollbar at '+width,`document.querySelector('.accounting_table_wrap').scrollWidth<=document.querySelector('.accounting_table_wrap').clientWidth+1`);
  await check('Accounting labels and forms do not overflow at '+width,`[...document.querySelectorAll('.page-accounting *')].filter(node=>node.getClientRects().length&&node.clientWidth>0&&!node.matches('input,select,textarea')&&getComputedStyle(node).overflowX==='visible').every(node=>node.scrollWidth<=node.clientWidth+2)`);
  await check('Summary amounts and currency stay on one line at '+width,`[...document.querySelectorAll('.accounting_summary_value')].every(node=>{const range=document.createRange();range.selectNodeContents(node);return range.getClientRects().length===1&&node.scrollWidth<=node.clientWidth+1})`);
  await check('Full article notes remain visible at '+width,`getComputedStyle(document.querySelector('.accounting_item_note')).whiteSpace==='normal'&&getComputedStyle(document.querySelector('.accounting_item_note')).overflowX==='visible'`);
 }
 for(const [width,height] of [[1366,600],[1024,600],[390,560],[320,560]]) {
  await metrics(width,height);
  for(const action of ['Postenliste','Zahlung','Artikel','Beleg','Layout bearbeiten']) {
   await c.evaluate(`(()=>{const button=[...document.querySelectorAll('.page-accounting button')].find(node=>node.textContent===${JSON.stringify(action)});if(!button)throw new Error('Missing accounting action');button.click()})()`);
   await check(action+' stays accessible at '+width+'x'+height,`(()=>{const dialog=document.querySelector('.dialog_bg .dialog');if(!dialog)return false;const r=dialog.getBoundingClientRect(),style=getComputedStyle(dialog);return r.left>=0&&r.right<=innerWidth+.5&&r.top>=0&&r.bottom<=innerHeight+.5&&dialog.scrollWidth<=dialog.clientWidth+1&&(dialog.scrollHeight<=dialog.clientHeight+1||['auto','scroll'].includes(style.overflowY))})()`);
   await key('Escape','Escape',27);
   await check(action+' closes with Escape',`!document.querySelector('.dialog_bg')`);
  }
 }
 assert(!c.events.some(event=>event.method==='Runtime.exceptionThrown'),'No browser exceptions');
};
