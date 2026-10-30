'use strict';
const fs=require('fs');
const path=require('path');

module.exports=async function({c,check,click,open,metrics,key,nativeDrag,delay,previews}) {
  await c.evaluate(`localStorage.removeItem('bts-admin-card-layout-v1');localStorage.removeItem('bts-admin-tablet-sort-v1')`);
  await open(1920,940);
  await c.evaluate(`window.__tabletOrder=()=>[...document.querySelectorAll('[data-board-card="tablets"] tr[data-tablet-client-id]')].map(row=>row.dataset.tabletClientId).join(',')`);
  await check('Tabletkachel zeigt vier verbundene Tablets mit Feldgrafik, Hostname und verfügbarer IP',`document.querySelector('[data-tablet-count]').textContent==='4'&&__tabletOrder()==='21,22,23,24'&&document.querySelector('[data-tablet-client-id="21"] .ls-tablet-host').textContent==='Tablet Feld 1'&&document.querySelector('[data-tablet-client-id="21"] .ls-tablet-ip').textContent==='192.168.10.21'&&getComputedStyle(document.querySelector('[data-tablet-client-id="21"] .ls-tablet-field')).backgroundImage.includes('/icons/court.svg')`);
  await check('Offline-Geräte und reine Anzeigen zählen nicht als Tablets',`!document.querySelector('[data-tablet-client-id="25"],[data-tablet-client-id="30"]')`);
  await check('Akku zeigt Prozent, Blitz beim Laden und Warnfarben bis 25 und 10 Prozent',`document.querySelector('[data-tablet-client-id="21"] .ls-tablet-percent').textContent==='76%'&&document.querySelector('[data-tablet-client-id="22"] .ls-tablet-battery').classList.contains('is-low')&&!!document.querySelector('[data-tablet-client-id="22"] .ls-tablet-charging')&&document.querySelector('[data-tablet-client-id="23"] .ls-tablet-battery').classList.contains('is-critical')`);
  await check('Fehlende Akku- und Felddaten bleiben als Gedankenstrich sichtbar ohne erfundene IP',`document.querySelector('[data-tablet-client-id="24"] .ls-tablet-percent').textContent==='—'&&document.querySelector('[data-tablet-client-id="24"] .ls-tablet-court').textContent==='—'&&!document.querySelector('[data-tablet-client-id="24"] .ls-tablet-ip')`);
  await c.evaluate(`window.__tabletGameRows=[...document.querySelectorAll('.court_row')];window.__tabletRows=[...document.querySelectorAll('[data-tablet-client-id]')];window.__tabletWrites=__writes.length`);
  await click('.ls-tablet-sort[data-sort-key="battery"]');
  await check('Akku sortiert zuerst niedrige Werte und fehlende Angaben zuletzt',`__tabletOrder()==='23,22,21,24'&&document.querySelector('.ls-tablet-sort[data-sort-key="battery"]').closest('th').getAttribute('aria-sort')==='ascending'`);
  await click('.ls-tablet-sort[data-sort-key="battery"]');
  await check('Akku lässt sich absteigend sortieren ohne Zeilen oder Spiele neu aufzubauen',`__tabletOrder()==='21,22,23,24'&&__tabletGameRows.every(row=>row.isConnected)&&__tabletRows.every(row=>row.isConnected)&&__writes.length===__tabletWrites`);
  await c.evaluate(`document.querySelector('.ls-tablet-sort[data-sort-key="battery"]').focus()`);await key('Enter','Enter',13,'\r');
  await check('Sortierknöpfe funktionieren per Tastatur mit erhaltenem Fokus und lokal gespeicherter Wahl',`__tabletOrder()==='23,22,21,24'&&document.activeElement?.dataset.sortKey==='battery'&&JSON.parse(localStorage.getItem('bts-admin-tablet-sort-v1')).key==='battery'&&JSON.parse(localStorage.getItem('bts-admin-tablet-sort-v1')).direction===1`);
  // The native handler logs ordinary connection transitions through cerror.silent.
  // Assert those exact notices separately; unexpected diagnostics still reach the console audit.
  await c.evaluate(`window.__tabletConnectionNotices=[];window.__deviceStatus=value=>{const silent=cerror.silent,notice='Display '+value.client_id+' is '+(value.online?'online':'offline');cerror.silent=message=>{if(Object.prototype.hasOwnProperty.call(value,'online')&&message===notice)__tabletConnectionNotices.push(message);else silent(message)};try{crouting.on_change({ctype:'display_status_changed',tournament_key:'preview',val:{display_court_displaysetting:value}})}finally{cerror.silent=silent}};__deviceStatus({client_id:'25',online:true})`);
  await check('Wieder verbundenes Tablet erscheint live mit seinen vorhandenen Metadaten',`document.querySelector('[data-tablet-count]').textContent==='5'&&document.querySelector('[data-tablet-client-id="25"] .ls-tablet-percent').textContent==='55%'&&__tabletConnectionNotices.join(',')==='Display 25 is online'`);
  await c.evaluate(`__deviceStatus({client_id:'26',online:true,panel_devicemode:'umpire',displaysetting_id:'tablet-profile',court_id:'CH_3',hostname:'Neues Tablet',client_ip:'192.168.10.26',battery:{level:.05,charging:false}})`);
  await check('Erstmalig verbundenes Tablet erscheint ohne Seitenneuladen',`document.querySelector('[data-tablet-count]').textContent==='6'&&__tabletOrder().startsWith('26,')&&document.querySelector('[data-tablet-client-id="26"] .ls-tablet-host').textContent==='Neues Tablet'`);
  await c.evaluate(`__deviceStatus({client_id:'26',battery:null})`);
  await check('Explizit gelöschte Akkudaten werden nicht als alter Wert weiter angezeigt',`document.querySelector('[data-tablet-client-id="26"] .ls-tablet-percent').textContent==='—'&&document.querySelector('[data-tablet-client-id="26"] .ls-tablet-host').textContent==='Neues Tablet'`);
  await c.evaluate(`__deviceStatus({client_id:'26',battery:{level:0,charging:true}})`);
  await check('Null Prozent wird korrekt mit roter Batterie und Ladeblitz angezeigt',`document.querySelector('[data-tablet-client-id="26"] .ls-tablet-percent').textContent==='0%'&&!!document.querySelector('[data-tablet-client-id="26"] .is-critical .ls-tablet-charging')`);
  for(const [level,status] of [[.25,'low'],[.26,'normal'],[.10,'critical'],[.11,'low']]) {
    await c.evaluate(`__deviceStatus({client_id:'26',battery:{level:${level},charging:false}})`);
    await check('Live-Akku '+Math.round(level*100)+' Prozent verwendet den richtigen Warnzustand',`!!document.querySelector('[data-tablet-client-id="26"] .is-${status}')&&!document.querySelector('[data-tablet-client-id="26"] .ls-tablet-charging')`);
  }
  await c.evaluate(`__deviceStatus({client_id:'26',court_id:'CH_10',hostname:'Langes Tablet <img src=x onerror=alert(1)>',client_ip:'::ffff:192.168.10.126'})`);
  await check('Feld, Hostname und IP ändern sich live und Gerätenamen bleiben sicherer Text',`document.querySelector('[data-tablet-client-id="26"] .ls-tablet-field').textContent==='10'&&document.querySelector('[data-tablet-client-id="26"] .ls-tablet-ip').textContent==='192.168.10.126'&&document.querySelector('[data-tablet-client-id="26"] .ls-tablet-host').title.includes('<img')&&!document.querySelector('[data-tablet-client-id="26"] img')`);
  await c.evaluate(`__deviceStatus({client_id:'26',displaysetting_id:'display-profile'})`);
  await check('Ein Wechsel zur Anzeige entfernt das Gerät aus der Tabletkachel',`!document.querySelector('[data-tablet-client-id="26"]')&&document.querySelector('[data-tablet-count]').textContent==='5'`);
  await c.evaluate(`__deviceStatus({client_id:'26',displaysetting_id:'tablet-profile'});__deviceStatus({client_id:'26',online:false})`);
  await check('Verbindungsabbruch entfernt das Tablet live',`!document.querySelector('[data-tablet-client-id="26"]')&&document.querySelector('[data-tablet-count]').textContent==='5'&&__tabletConnectionNotices.join(',')==='Display 25 is online,Display 26 is offline'`);
  await c.evaluate(`crouting.on_change({ctype:'delete_display',tournament_key:'preview',val:{client_id:'25'}})`);
  await check('Geräte-Löschung aktualisiert Anzahl und Liste',`!document.querySelector('[data-tablet-client-id="25"]')&&document.querySelector('[data-tablet-count]').textContent==='4'`);
  await c.evaluate(`crouting.on_change({ctype:'update_display_setting',tournament_key:'preview',val:{setting:{id:'tablet-profile',devicemode:'display'}}})`);
  await check('Ein Profilwechsel aktualisiert die Geräteauswahl und den leeren Zustand',`document.querySelector('[data-tablet-count]').textContent==='0'&&document.querySelector('.ls-tablet-empty').textContent==='Keine Tablets verbunden.'`);
  await c.evaluate(`crouting.on_change({ctype:'update_display_setting',tournament_key:'preview',val:{setting:{id:'tablet-profile',devicemode:'umpire'}}})`);
  await check('Rückkehr zum Tabletprofil stellt die verbundene Liste wieder her',`document.querySelector('[data-tablet-count]').textContent==='4'&&!document.querySelector('.ls-tablet-empty')`);
  await click('.ls-tablet-sort[data-sort-key="court"]');
  await check('Feld sortiert nach tatsächlicher Nummer mit unzugewiesenen Tablets am Ende',`__tabletOrder()==='21,22,23,24'`);
  await click('.ls-tablet-sort[data-sort-key="court"]');
  await check('Feld kann auch absteigend sortiert werden',`__tabletOrder()==='23,22,21,24'`);
  await click('.ls-tablet-sort[data-sort-key="battery"]');
  await click('.board-toolbar-actions [data-action="layout-edit"]');
  await c.evaluate(`window.__tabletCardNode=document.querySelector('[data-board-card="tablets"]')`);
  await nativeDrag('[data-board-card="tablets"] h2','[data-card-zone="sidebar"]');
  await check('Die Tabletkachel lässt sich mit erhaltenem Inhalt in die Sidebar ziehen',`document.querySelector('[data-card-zone="sidebar"] [data-board-card="tablets"]')===__tabletCardNode&&document.querySelector('[data-tablet-count]').textContent==='4'`);
  await c.evaluate(`for(let index=0;index<18;index++)__deviceStatus({client_id:'extra-'+index,online:true,panel_devicemode:'umpire',court_id:'CH_'+(index%13+1),hostname:'Zusätzliches Tablet '+index,battery:{level:.3+index/100,charging:false}})`);
  await check('Rechte Tabletliste und Sidebar wachsen ohne eigene Scrollbalken mit allen Geräten',`(()=>{const list=document.querySelector('.ls-tablet-list'),side=list.closest('.board-sidebar');return document.querySelector('[data-tablet-count]').textContent==='22'&&getComputedStyle(list).maxHeight==='none'&&getComputedStyle(list).overflowY==='visible'&&list.scrollHeight<=list.clientHeight+1&&getComputedStyle(side).maxHeight==='none'&&getComputedStyle(side).overflowY==='visible'})()`);
  await click('[data-board-card="tablets"] [data-action="layout-card-zone"]');
  await check('Oberhalb der Spiele bleibt eine lange Tabletliste kompakt',`(()=>{const list=document.querySelector('.ls-tablet-list');return !!list.closest('[data-card-zone="top"]')&&list.clientHeight<=132&&list.scrollHeight>list.clientHeight})()`);
  await click('[data-board-card="tablets"] [data-action="layout-card-zone"]');await click('[data-layout-editor] [data-action="layout-edit"]');
  await open(1920,940);
  await check('Neuladen erhält die persönliche Kachelanordnung und Akkusortierung',`!!document.querySelector('[data-card-zone="sidebar"] [data-board-card="tablets"]')&&document.querySelector('[data-tablet-count]').textContent==='4'&&document.querySelector('.ls-tablet-sort[data-sort-key="battery"]').closest('th').getAttribute('aria-sort')==='ascending'`);
  for(const width of [1920,1536,390]) {
    await metrics(width,width===390?844:940);await delay(100);
    await check('Tabletkachel passt bei '+width+' Pixeln ohne Seitenüberlauf oder überdeckte Akkudaten',`document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.ls-tablet-battery')].every(node=>{const r=node.getBoundingClientRect(),cell=node.closest('td').getBoundingClientRect();return r.left>=cell.left&&r.right<=cell.right})`);
  }
  await metrics(1920,940);await c.evaluate(`document.body.style.paddingBottom='100vh';window.scrollTo(0,document.querySelector('[data-board-card="tablets"]').getBoundingClientRect().top+scrollY-80)`);await delay(100);
  const clip=await c.evaluate(`(()=>{const r=document.querySelector('[data-board-card="tablets"]').getBoundingClientRect();return{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height,scale:1}})()`);
  const shot=await c.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip});fs.writeFileSync(path.join(previews,'tablets.png'),Buffer.from(shot.data,'base64'));
  await c.evaluate(`localStorage.setItem('bts-admin-tablet-sort-v1','{"key":"invalid","direction":0}')`);await open(1920,940);
  await check('Ungültige gespeicherte Sortierung fällt auf Feld aufsteigend zurück',`document.querySelector('.ls-tablet-sort[data-sort-key="court"]').closest('th').getAttribute('aria-sort')==='ascending'`);
  await c.evaluate(`window.__tabletStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('storage blocked')}`);
  await click('.ls-tablet-sort[data-sort-key="battery"]');
  await check('Ohne beschreibbaren Browserspeicher bleibt die Sortierung für die Sitzung bedienbar',`document.querySelector('.ls-tablet-sort[data-sort-key="battery"]').closest('th').getAttribute('aria-sort')==='ascending'`);
  await c.evaluate(`Storage.prototype.setItem=window.__tabletStorageSet`);
};
