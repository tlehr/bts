/* global cleitstand */
'use strict';

// The selector only prepares a plan. Destructive execution needs the separate
// confirmation owned by the maintenance page.
// eslint-disable-next-line no-unused-vars -- Used by maintenance settings.
var btsResetSelection = (() => {
 let current = null, sequence = 0;
 function close(owner) {if (current && (!owner || current.owner === owner)) current.finish(null);}
 function open({owner,tournament,returnFocus}) {
  if (!owner.isConnected || owner.hidden || current?.owner === owner) return Promise.resolve(null);
  close();const doc = owner.ownerDocument, id = 'reset-selection-' + (++sequence);
  function el(parent,tag,className,value) {
   const node = doc.createElement(tag);node.className = className || '';
   if (value != null) node.textContent = value;parent.append(node);return node;
  }
  const dialog = el(doc.body,'dialog','leitstand-dialog settings-reset-dialog');dialog.setAttribute('aria-labelledby',id);
  const heading = el(dialog,'div','dialog-heading'), title = el(heading,'h2');title.id = id;
  title.innerHTML = cleitstand.icon('refresh');el(title,'span','','Zurücksetzen auswählen');
  const dismiss = el(heading,'button','ls-dialog-close');dismiss.type = 'button';dismiss.setAttribute('aria-label','Schließen');dismiss.innerHTML = cleitstand.icon('close');
  const form = el(dialog,'form','settings-reset-form'), body = el(form,'div','settings-reset-body');
  el(body,'p','settings-reset-intro','Wähle das Ziel und die Daten aus. Im nächsten Schritt prüfst und bestätigst du die Auswahl.');
  const scope = el(body,'fieldset','settings-reset-scope');el(scope,'legend','','Wo zurücksetzen?');
  const target = el(scope,'select');target.name = 'reset_target';target.setAttribute('aria-label','Ziel des Zurücksetzens');
  el(target,'option','','Nur BTS').value = 'bts';el(target,'option','','BTS und BTP').value = 'both';
  const note = el(scope,'p','settings-reset-note');note.setAttribute('role','status');note.id = id + '-scope';target.setAttribute('aria-describedby',note.id);
  const areas = el(body,'fieldset','settings-reset-areas');el(areas,'legend','','Was zurücksetzen?');
  const inputs = new Map(), descriptions = {
   match_results:['Ergebnisse und Sieger zurücksetzen','Spiele und Auslosungen behalten. Laufende Spiele und Freilose werden nicht zurückgesetzt.'],
   court_assignments:['Feldzuweisungen entfernen','Auch für Spiele, deren Spieler noch nicht feststehen. Laufende und beendete Spiele behalten ihre Felder.'],
   player_pauses:['Spielerpausen zurücksetzen','Gespeicherte Spieler- und Tabletpausen zurücksetzen. Spiele und Ergebnisse bleiben erhalten.'],
   tournament:['Lokalen Turnierbestand vollständig leeren','Spiele, Tabletbediener, Logs, Felder, Spielorte und Offizielle löschen. BTP-Abgleich ausschalten; wiederverwendbare Einstellungen behalten.'],
  };
  for (const [name,[label,description]] of Object.entries(descriptions)) {
   const row = el(areas,'label','settings-reset-option'), input = el(row,'input');input.type = 'checkbox';input.name = 'reset_action';input.value = name;
   const info = el(row,'span');el(info,'strong','',label);const hint = el(info,'span','settings-reset-description',description);hint.id = id + '-' + name;
   input.setAttribute('aria-describedby',hint.id);inputs.set(name,input);
   input.addEventListener('change',() => {
    if (name === 'tournament' && input.checked) {for (const [key,node] of inputs) if (key !== 'tournament') node.checked = false;}
    else if (name !== 'tournament' && input.checked) inputs.get('tournament').checked = false;
    refresh();
   });
  }
  const games = el(body,'fieldset','settings-reset-games');el(games,'legend','','Welche Spielergebnisse?');
  const gameScope = el(games,'select');gameScope.name = 'reset_result_scope';gameScope.setAttribute('aria-label','Umfang der Spielergebnisse');
  el(gameScope,'option','','Alle verfügbaren Spielergebnisse').value = 'all';el(gameScope,'option','','Einzelne Spiele auswählen').value = 'selected';
  const gameList = el(games,'div','settings-reset-game-list'), gameInputs = new Map();
  const candidates = (tournament().matches || []).filter(match => match.setup && !match.setup.now_on_court && match.setup.state !== 'oncourt' &&
   match.setup.teams?.length === 2 && match.setup.teams.every(team => team.players?.length > 0) &&
   (typeof match.team1_won === 'boolean' || Number(match.btp_winner) > 0 || match.setup.state === 'finished' || match.end_ts != null ||
    match.presses?.length > 0 || match.network_score?.some(set => set.some(value => Number(value) > 0)) || match.score_status && match.score_status !== 'normal'));
  for (const match of candidates) {
   const row = el(gameList,'label','settings-reset-game'), input = el(row,'input');input.type = 'checkbox';input.value = match._id;input.name = 'reset_match_id';
   const names = match.setup.teams.map(team => team.players.map(player => player.name).join(' / ')).join(' – ');
   el(row,'span','','#' + (match.setup.match_num ?? '—') + ' · ' + (match.setup.event_name || '') + ' · ' + names);
   gameInputs.set(match._id,input);input.addEventListener('change',refresh);
  }
  const gamesNote = el(games,'p','settings-reset-note');gamesNote.setAttribute('role','status');
  el(games,'p','settings-reset-note','Ein geänderter Sieger kann die Besetzung nachfolgender Spiele verändern. Bei BTS und BTP wird die Auslosung anschließend neu aus BTP übernommen.');
  gameScope.addEventListener('change',refresh);
  const fullHint = el(body,'p','settings-reset-note','Das vollständige Leeren des Turnierbestands ist nur in BTS verfügbar.');
  const summary = el(body,'p','settings-reset-summary');summary.setAttribute('role','status');
  const footer = el(form,'div','settings-reset-footer'), cancel = el(footer,'button','btn','Abbrechen');cancel.type = 'button';
  const next = el(footer,'button','btn','Auswahl prüfen');next.type = 'submit';next.name = 'reset_review';next.disabled = true;
  let done = false, resolve;
  const promise = new Promise(callback => {resolve = callback;});
  function finish(value) {
   if (done) return;done = true;observer.disconnect();if (current?.dialog === dialog) current = null;
   if (dialog.open) dialog.close();dialog.remove();if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});resolve(value);
  }
  const selected = () => [...inputs].filter(([,input]) => input.checked && !input.disabled).map(([name]) => name);
  const selectedMatches = () => candidates.filter(match => gameScope.value === 'all' || gameInputs.get(match._id).checked).map(match => match._id);
  function refresh() {
   if (done) return;
   const currentTournament = tournament();
   const reason = !currentTournament.btp_enabled ? 'Die BTP-Anbindung ist ausgeschaltet.' : currentTournament.btp_readonly ? 'BTP ist im Nur-Lesen-Modus.' :
    currentTournament.btp_status?.status !== 'connected' ? 'BTP ist derzeit nicht verbunden.' : '';
   const both = target.value === 'both', full = inputs.get('tournament');
   full.disabled = both;if (both) full.checked = false;full.closest('label').dataset.available = String(!both);fullHint.hidden = !both;
   const noteText = both ? reason || 'Die ausgewählten Änderungen werden auch an BTP übertragen.' :
    'BTP bleibt unverändert. Bei einem späteren BTP-Abgleich können dort gespeicherte Werte wieder übernommen werden.';
   if (note.textContent !== noteText) note.textContent = noteText;
   const choices = selected(), summaryText = choices.length ? 'Auswahl: ' + choices.map(name => descriptions[name][0]).join(' · ') : 'Noch kein Bereich ausgewählt.';
   games.hidden = !choices.includes('match_results');gameList.hidden = gameScope.value !== 'selected';
   const selectedCount = selectedMatches().length, gamesText = selectedCount + ' von ' + candidates.length + ' verfügbaren Spielergebnissen ausgewählt.';
   if (gamesNote.textContent !== gamesText) gamesNote.textContent = gamesText;
   if (summary.textContent !== summaryText) summary.textContent = summaryText;
   next.disabled = !choices.length || both && !!reason || choices.includes('match_results') && !selectedCount;
  }
  target.addEventListener('change',refresh);
  form.addEventListener('submit',event => {event.preventDefault();refresh();if (!next.disabled) finish({target:target.value,actions:selected(),
   ...(selected().includes('match_results') ? {match_ids:selectedMatches()} : {})});});
  cancel.addEventListener('click',() => finish(null));dismiss.addEventListener('click',() => finish(null));
  dialog.addEventListener('cancel',event => {event.preventDefault();finish(null);});dialog.addEventListener('close',() => finish(null));
  dialog.addEventListener('click',event => {if (event.target === dialog) finish(null);});
  const observer = new MutationObserver(() => {if (!owner.isConnected || owner.hidden || !dialog.isConnected) finish(null);});
  observer.observe(doc.body,{childList:true,subtree:true});observer.observe(owner,{attributes:true,attributeFilter:['hidden']});
  current = {owner,dialog,finish,refresh};refresh();
  try {dialog.showModal();target.focus({preventScroll:true});} catch (error) {finish(null);throw error;}
  return promise;
 }
 return {open,close,refresh:owner => {if (current?.owner === owner) current.refresh();}};
})();
