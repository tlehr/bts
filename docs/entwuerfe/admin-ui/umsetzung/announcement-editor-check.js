'use strict';
/* eslint no-console: off */
const fs = require('fs'), path = require('path');

module.exports = async function({ c, check, click, open, metrics, previews, key }) {
 const checks = [], verify = async(name, expression) => {
  try { await check(name, expression);checks.push(name); }
  catch (error) {
   console.error(JSON.stringify(await c.evaluate('({value:document.querySelector("#custom_announcement")?.value,focus:document.activeElement?.outerHTML,popup:document.querySelector(".announcement-completions")?.outerHTML,history:JSON.parse(localStorage.getItem("bts-free-announcement-history-v1:preview")||"[]"),plays:__localAnnouncements,writes:__writes})')));
   throw error;
  }
 };
 const eventually = expression => c.evaluate('(async()=>{for(let i=0;i<160;i++){if('+expression+')return;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error("Editor did not settle");})()');
 const set = (text, caret = text.length) => c.evaluate('__editorSet('+JSON.stringify(text)+','+caret+')');
 const up = () => key('ArrowUp', 'ArrowUp', 38), down = () => key('ArrowDown', 'ArrowDown', 40), escape = () => key('Escape', 'Escape', 27);
 const mouseClick = async selector => {
  const point = await c.evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
  await c.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
  await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});
  await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});
 };
 await open(1920, 1080);
 await click('.board-toolbar-actions [data-action="layout-edit"]');
 for (const id of ['rotation', 'device', 'automation', 'tablets', 'logs']) await click('[data-board-card="' + id + '"] [data-action="layout-card-hide"]');
 await click('[data-layout-editor] [data-action="layout-edit"]');
 await c.evaluate(String.raw`(()=>{
  const mia={name:'Mia Göker',club:'PSV Musterstadt',state:'Nordrhein-Westfalen'},finn={name:'Finn Beispiel',club:'BC Teststadt',state:'Niedersachsen'};
  curt.events.events.push({id:'completion-fixture',stages:[{entries:[{team:{players:[mia,finn]}},{team:{players:[{name:'<b>Testname</b>'}]}}]}]});
  window.__editorField=()=>document.querySelector('#custom_announcement');
  window.__editorPopup=()=>document.querySelector('.announcement-completions');
  window.__editorHistory=()=>JSON.parse(localStorage.getItem('bts-free-announcement-history-v1:preview')||'[]');
  window.__editorSet=async(text,caret=text.length)=>{const field=__editorField();field.focus({preventScroll:true});field.value=text;field.setSelectionRange(caret,caret);field.dispatchEvent(new Event('input',{bubbles:true}));await btsSpeechReadiness.refresh(true);};
  window.__editorGeometry=()=>['[data-board-card="announcement"]','[data-board-card="operators"]','.board-controls','.board-games'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return selector==='.board-games'?[r.top+scrollY]:[r.top+scrollY,r.height,r.width];});
 })()`);
 await verify('The text field explains slash completion and history without adding a row to the card',String.raw`__editorField().offsetHeight===72&&__editorField().placeholder.includes('/')&&__editorField().title.includes('↑/↓')&&__editorHistory().length===0`);
 await c.evaluate(String.raw`window.__editorLayoutBefore=__editorGeometry()`);
 await set('/');
 await verify('A slash lists players, pairs, clubs and state federations including people without games',String.raw`!!__editorPopup()&&__editorField().getAttribute('aria-expanded')==='true'&&['player','pair','club','state'].every(kind=>__editorPopup().querySelector('[data-kind="'+kind+'"]'))&&__editorPopup().textContent.includes('Nordrhein-Westfalen')`);
 await verify('Results put state federations first, then clubs, players and pairs',String.raw`[...new Set([...__editorPopup().querySelectorAll('[role=option]')].map(row=>row.dataset.kind))].join('|')==='state|club|player|pair'`);
 await verify('Opening suggestions does not enlarge either top card or move the games',String.raw`__editorGeometry().every((values,i)=>values.every((value,j)=>Math.abs(value-__editorLayoutBefore[i][j])<.5))`);
 await c.evaluate(String.raw`window.__editorFirst=__editorField().getAttribute('aria-activedescendant')`);await down();
 await verify('Arrow keys navigate suggestions before history and keep text focus',String.raw`__editorField().getAttribute('aria-activedescendant')!==__editorFirst&&document.activeElement===__editorField()&&__editorField().value==='/'`);
 await up();await verify('Up returns to the previous suggestion',String.raw`__editorField().getAttribute('aria-activedescendant')===__editorFirst`);
 await escape();await verify('Escape dismisses suggestions without changing the draft',String.raw`!__editorPopup()&&__editorField().value==='/'&&__editorField().getAttribute('aria-expanded')==='false'`);

 await set('Bitte /Göker, zur Turnierleitung.', 'Bitte /Gök'.length);
 await verify('Name matching ignores accents and preserves tournament metadata',String.raw`__editorPopup().querySelector('[data-kind="player"]').textContent.includes('Mia Göker')&&__editorPopup().querySelector('[data-kind="player"]').textContent.includes('PSV Musterstadt')`);
 await key('Enter', 'Enter', 13, '\r');
 await verify('Enter inserts a full name at the cursor and preserves the rest of the sentence without sending',String.raw`__editorField().value==='Bitte Mia Göker, zur Turnierleitung.'&&__editorField().selectionStart==='Bitte Mia Göker'.length&&!__editorPopup()&&__localAnnouncements.length===0&&__writes.length===0`);
 await set('/Beispiel Gok');await key('Tab', 'Tab', 9);
 await verify('Tab inserts a pair as spoken names joined with und and retains text focus',String.raw`__editorField().value==='Mia Göker und Finn Beispiel '&&!__editorPopup()&&document.activeElement===__editorField()`);
 await set('Ein Vertreter von /PSV');await click('.announcement-completions [data-kind="club"]');
 await verify('A club suggestion replaces only the slash expression',String.raw`__editorField().value==='Ein Vertreter von PSV Musterstadt '&&!__editorPopup()`);
 await set('/Nordrhein');
 await verify('A state search also lists its clubs and players in the requested order',String.raw`[...new Set([...__editorPopup().querySelectorAll('[role=option]')].map(row=>row.dataset.kind))].join('|')==='state|club|player|pair'&&__editorPopup().querySelector('[data-kind="club"]').textContent.includes('PSV Musterstadt')&&!__editorPopup().querySelector('[data-kind="club"]').textContent.includes('BC Teststadt')&&__editorPopup().querySelector('[data-kind="player"]').textContent.includes('Mia Göker')`);
 await click('.announcement-completions [data-kind="state"]');
 await verify('State federation suggestions insert the actual state value',String.raw`__editorField().value==='Nordrhein-Westfalen '`);
 await set('Ein Vertreter vom Landesverband /Nie');
 await mouseClick('.announcement-completions [data-kind="state"]');
 await verify('A real mouse selection removes the slash and closes completion',String.raw`__editorField().value==='Ein Vertreter vom Landesverband Niedersachsen '&&!__editorPopup()&&document.activeElement===__editorField()`);
 await c.call('Input.insertText',{text:'bitte zur Turnierleitung!'});
 await verify('Normal typing after a selected state stays plain text without reopening suggestions',String.raw`__editorField().value==='Ein Vertreter vom Landesverband Niedersachsen bitte zur Turnierleitung!'&&!__editorPopup()`);
 await set('Ein Vertreter vom Landesverband /Niedersachsen');
 await c.call('Input.insertText',{text:' bitte zur Turnierleitung!'});
 await verify('Continuing after a fully typed state removes the slash and preserves the sentence and caret',String.raw`__editorField().value==='Ein Vertreter vom Landesverband Niedersachsen bitte zur Turnierleitung!'&&!__editorPopup()&&__editorField().selectionStart===__editorField().value.length`);
 await set('Ein Vertreter vom Landesverband /Niedersachsen bitte zur Turnierleitung!');
 await verify('The reported sentence also normalizes correctly when pasted as a whole',String.raw`__editorField().value==='Ein Vertreter vom Landesverband Niedersachsen bitte zur Turnierleitung!'&&!__editorPopup()`);
 await c.call('Input.insertText',{text:' /Göker'});
 await verify('A new slash can independently start another replacement in the same sentence',String.raw`!!__editorPopup()?.querySelector('[data-kind="player"]')`);
 await key('Enter','Enter',13,'\r');
 await verify('Repeated replacements leave neither old nor new command slashes in the text',String.raw`__editorField().value==='Ein Vertreter vom Landesverband Niedersachsen bitte zur Turnierleitung! Mia Göker '&&!__editorPopup()`);
 for(const query of ['/Gok und Beispiel','/Göker / Beispiel']) {
  await set(query);
  await verify('Doubles remain visible when searching both partners with '+query,String.raw`__editorPopup().textContent.includes('Doppelpaarungen')&&__editorPopup().querySelector('[data-kind="pair"]').textContent.includes('Mia Göker / Finn Beispiel')`);
  await key('Tab','Tab',9);
  await verify('Both partner names are inserted without a leftover slash for '+query,String.raw`__editorField().value==='Mia Göker und Finn Beispiel '&&!__editorPopup()`);
 }
 await set('/Mia Göker ');
 await verify('A complete first player does not prematurely discard their possible doubles partner',String.raw`__editorField().value==='/Mia Göker '&&!!__editorPopup().querySelector('[data-kind="pair"]')`);
 await c.call('Input.insertText',{text:'und Finn Beispiel bitte kommen!'});
 await verify('A fully typed doubles pair finishes before the following normal sentence text',String.raw`__editorField().value==='Mia Göker und Finn Beispiel bitte kommen!'&&!__editorPopup()`);
 await set('/Testname');
 await verify('Suggestion labels render imported names as text without interpreting HTML',String.raw`__editorPopup().textContent.includes('<b>Testname</b>')&&!__editorPopup().querySelector('b')`);
 await escape();
 await set('/KeinPassenderTreffer');await verify('No results remain explicit and do not replace the draft',String.raw`__editorPopup().textContent.includes('Keine passenden Vorschläge')&&!__editorPopup().querySelector('[role=option]')`);await escape();
 await set('x'.repeat(165) + ' /Gök');
 await verify('Overlong names are disabled instead of truncated',String.raw`__editorPopup().querySelector('[data-kind="player"]').getAttribute('aria-disabled')==='true'&&__editorPopup().querySelector('[data-kind="player"]').title.includes('175')&&!__editorField().hasAttribute('aria-activedescendant')`);
 await click('.announcement-completions [data-kind="player"]');
 await verify('An overlong completion leaves the original text intact',String.raw`__editorField().value==='x'.repeat(165)+' /Gök'`);await escape();
 await set('https://example.com und/oder');await verify('Ordinary slashes and URLs do not open completion',String.raw`!__editorPopup()`);

 for (const [width, height] of [[1920,1080],[390,844],[320,568]]) {
  await metrics(width,height);await set('');
  await c.evaluate(String.raw`__editorField().scrollIntoView({block:'center'});window.__editorLayoutBefore=__editorGeometry()`);
  await set('/');
  await verify('Suggestions fit the viewport without growing the card at '+width,String.raw`(()=>{const p=__editorPopup(),r=p.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&p.scrollWidth<=p.clientWidth&&__editorGeometry().every((values,i)=>values.every((value,j)=>Math.abs(value-__editorLayoutBefore[i][j])<.5));})()`);
  await escape();
 }
 await metrics(1920,1080);

 await c.evaluate(String.raw`__speechFixture.status='completed'`);await set('Erster gesendeter Aufruf.');await click('#local_announce_btn');
 await eventually('__localAnnouncements.length===1');
 await set('Zweiter gesendeter Aufruf.');await click('#remote_announce_btn');
 await eventually('__editorHistory().length===2');
 await verify('Only dispatched local and successful remote announcements enter the persistent history',String.raw`__editorHistory().join('|')==='Erster gesendeter Aufruf.|Zweiter gesendeter Aufruf.'`);
 await set('  Neuer\nEntwurf  ');await c.evaluate(String.raw`__editorField().setSelectionRange(3,7)`);
 await up();await verify('Up recalls the newest sent announcement first',String.raw`__editorField().value==='Zweiter gesendeter Aufruf.'`);
 await up();await verify('Repeated Up recalls older announcements',String.raw`__editorField().value==='Erster gesendeter Aufruf.'`);
 await up();await verify('History stays at the oldest entry without changing stored texts',String.raw`__editorField().value==='Erster gesendeter Aufruf.'&&__editorHistory().length===2`);
 await down();await down();
 await verify('Down past the newest entry restores the exact unfinished draft and its selection',String.raw`__editorField().value==='  Neuer\nEntwurf  '&&__editorField().selectionStart===3&&__editorField().selectionEnd===7`);
 await up();await set('Bearbeiteter Aufruf als Entwurf.');await up();await down();
 await verify('Editing a recalled entry creates a new draft without modifying sent history',String.raw`__editorField().value==='Bearbeiteter Aufruf als Entwurf.'&&__editorHistory()[1]==='Zweiter gesendeter Aufruf.'`);
 await verify('Modified arrows and composing key events remain available to text editing',String.raw`(()=>{const f=__editorField(),before=f.value;return f.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',shiftKey:true,cancelable:true,bubbles:true}))&&f.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',isComposing:true,cancelable:true,bubbles:true}))&&f.value===before;})()`);
 await set('Mehrzeilig');await key('Enter','Enter',13,'\r');
 await verify('Enter outside suggestions keeps normal multiline editing and does not send',String.raw`__editorField().value==='Mehrzeilig\n'&&__editorHistory().length===2`);

 await c.evaluate(String.raw`__speechFixture.status='queued'`);await set('Abgebrochene Auswahl.');await click('#local_announce_btn');await click('.announcement-cancel-button');
 await set('Abgebrochener Hintergrundauftrag.');await click('#local_announce_btn');await click('.announcement-background-button');await click('.announcement-pending-cancel');
 await verify('Cancelled choices and background waits do not enter sent history',String.raw`__editorHistory().length===2&&__localAnnouncements.length===1`);
 await set('Bestätigter Hintergrundtext.');await click('#local_announce_btn');await click('.announcement-background-button');await set('Neuer Entwurf bleibt erhalten.');
 await verify('A background wait is not stored before playback dispatch',String.raw`__editorHistory().length===2`);
 await c.evaluate(String.raw`__speechFixture.status='completed'`);await eventually('__editorHistory().length===3&&__localAnnouncements.length===2');
 await verify('Background completion records the confirmed text while preserving the new draft',String.raw`__editorHistory().at(-1)==='Bestätigter Hintergrundtext.'&&__editorField().value==='Neuer Entwurf bleibt erhalten.'&&__localAnnouncements.length===2`);

 await c.evaluate(String.raw`window.__editorSend=send;send=(message,callback)=>{if(message.type==='free_announce'){window.__editorRemoteReply=callback;return;}__editorSend(message,callback);}`);
 await set('Fehlgeschlagener Remote-Aufruf.');await click('#remote_announce_btn');
 await verify('Remote history waits for server confirmation',String.raw`__editorHistory().length===3`);
 await c.evaluate(String.raw`__editorRemoteReply(new Error('Isolated expected send failure'));send=__editorSend`);
 await verify('A rejected remote announcement is not stored as sent',String.raw`__editorHistory().length===3`);

 await c.evaluate(String.raw`ctournament.ui_show()`);await eventually('!!document.querySelector(\'#custom_announcement\')');await set('Entwurf nach Neuaufbau');await up();
 await verify('History survives rebuilding the tournament form',String.raw`__editorField().value==='Bestätigter Hintergrundtext.'`);
 await open(1920,1080);
 await c.evaluate(String.raw`(()=>{const f=document.querySelector('#custom_announcement');f.focus();f.value='Entwurf nach Neuladen';f.dispatchEvent(new Event('input'));})()`);await up();
 await verify('History survives page reload in the same browser',String.raw`document.querySelector('#custom_announcement').value==='Bestätigter Hintergrundtext.'`);
 await c.evaluate(String.raw`(()=>{__speechFixture.settings.key='other-tournament';const f=document.querySelector('#custom_announcement');f.value='Entwurf für anderes Turnier';f.dispatchEvent(new Event('input'));})()`);await up();
 await verify('A different tournament does not expose the previous tournament history',String.raw`document.querySelector('#custom_announcement').value==='Entwurf für anderes Turnier'`);
 await c.evaluate(String.raw`(()=>{__speechFixture.settings.key='preview';const f=document.querySelector('#custom_announcement');f.value='/Mia';f.setSelectionRange(f.value.length,f.value.length);f.dispatchEvent(new Event('input'));})()`);
 await verify('Fresh completion sources remain available after reload',String.raw`!!document.querySelector('.announcement-completions [data-kind=player]')`);
 await c.evaluate(String.raw`document.querySelector('#custom_announcement').closest('form').remove()`);
 await verify('Removing an open editor also removes its floating suggestions',String.raw`!document.querySelector('.announcement-completions')`);
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 await verify('Completion and history cause no browser exceptions',String(!exceptions.length));
 fs.writeFileSync(path.join(previews,'announcement-editor-verification.json'),JSON.stringify({date:'2026-11-01',scope:'Isolated real frontend with synthetic tournament and audio; no live announcements.',checks,exceptions:exceptions.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
