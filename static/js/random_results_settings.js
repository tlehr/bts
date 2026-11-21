/* global btsSettingsWorkspace, btsDialogActions */
'use strict';
// eslint-disable-next-line no-unused-vars -- Loaded by the tournament settings page.
var btsRandomResultsSettings = (() => {
 function mount(parent,{tournament,send}) {
  let disposed = false, pending = false, confirming = false, plan = null, revision = 0;
  const card = btsSettingsWorkspace.card(parent,{title:'Zufällige Testergebnisse',badge:'BTS und BTP',
   description:'Offene Spiele bis zu einer Grenze mit gültigen Zufallsergebnissen abschließen, um zum Beispiel Urkunden zu testen.'});
  card.parentElement.classList.add('settings-random-results');
  function el(owner,tag,className,text) {
   const node = parent.ownerDocument.createElement(tag);node.className = className || '';
   if (text != null) node.textContent = text;owner.append(node);return node;
  }
  const mode = btsSettingsWorkspace.field(card,{label:'Grenze wählen',tag:'select',attributes:{name:'random_results_mode'}});
  for (const [value,label] of [['number','Bis einschließlich Spielnummer'],['time','Bis einschließlich geplanter Startzeit']]) {
   el(mode,'option','',label).value = value;
  }
  const number = btsSettingsWorkspace.field(card,{label:'Letzte Spielnummer',attributes:{type:'number',min:1,step:1,name:'random_results_number'}});
  const time = btsSettingsWorkspace.field(card,{label:'Datum und Uhrzeit',description:'Es gilt die geplante Startzeit im BTP-Spielplan, einschließlich der angegebenen Minute.',
   attributes:{type:'datetime-local',name:'random_results_time'}});
  const note = el(card,'p','settings-random-note','Vorhandene Ergebnisse, begonnene Spiele und Freilose werden übersprungen. BTP löst Folgerunden auf; noch fehlende Teilnehmer werden nach jedem Abgleich erneut geprüft.');
  note.id = mode.id + '-note';
  const connection = el(card,'p','settings-random-connection');connection.setAttribute('role','status');
  const actions = el(card,'div','settings-card-actions');
  const preview = el(actions,'button','btn','Vorschau anzeigen');preview.type = 'button';preview.name = 'random_results_preview';
  preview.setAttribute('aria-describedby',note.id);
  const selection = el(card,'div','settings-random-selection');selection.hidden = true;
  const summary = el(selection,'p','settings-random-summary');
  const list = el(selection,'ul','settings-random-list');
  const apply = el(selection,'button','btn','Zufallsergebnisse in BTS und BTP eintragen');apply.type = 'button';apply.name = 'random_results_apply';
  const status = el(card,'p','settings-random-status');status.setAttribute('role','status');status.hidden = true;
  function feedback(message,state) {status.textContent = message;status.dataset.state = state;status.hidden = !message;}
  function reason() {
   const current = tournament();
   return !current.btp_enabled ? 'Die BTP-Anbindung ist ausgeschaltet.' : current.btp_readonly ? 'BTP ist im Nur-Lesen-Modus.' :
    current.btp_status?.status !== 'connected' ? 'BTP ist derzeit nicht verbunden.' : '';
  }
  function update() {
   if (disposed) return;
   const blocked = reason();
   const message = blocked ? blocked + ' Für Testergebnisse wird eine schreibende BTP-Verbindung benötigt.' : 'Dieser Testlauf trägt echte Ergebnisse in BTS und BTP ein.';
   if (connection.textContent !== message) connection.textContent = message;
   preview.disabled = pending || confirming || !!blocked;
   apply.disabled = pending || confirming || !!blocked || !plan?.count;
   for (const control of [mode,number,time]) control.disabled = pending || confirming;
   number.closest('.settings-row').hidden = mode.value !== 'number';time.closest('.settings-row').hidden = mode.value !== 'time';
   card.setAttribute('aria-busy',String(pending));
  }
  function invalidate() {revision++;plan = null;selection.hidden = true;feedback('','');update();}
  for (const input of [mode,number,time]) input.addEventListener('input',invalidate);
  mode.addEventListener('change',invalidate);
  preview.addEventListener('click',() => {
   if (disposed || preview.disabled) return;
   const limit = mode.value === 'number' ? {mode:'number',number:Number(number.value)} : {mode:'time',time:time.value};
   if (mode.value === 'number' ? !Number.isSafeInteger(limit.number) || limit.number < 1 : !time.value || !time.validity.valid) {
    feedback('Bitte eine positive Spielnummer oder ein gültiges Datum mit Uhrzeit angeben.','error');return;
   }
   invalidate();pending = true;update();feedback('Vorschau wird geladen …','pending');
   const key = tournament().key, requestRevision = revision;
   send({type:'debug_random_results',action:'preview',tournament_key:key,limit},(error,response) => {
    if (disposed || tournament().key !== key || requestRevision !== revision) return;
    pending = false;
    if (error) {feedback(error.message || 'Die Vorschau konnte nicht geladen werden.','error');update();return;}
    plan = response;selection.hidden = false;list.replaceChildren();
    summary.textContent = plan.count + ' Spiele ausgewählt; ' + plan.skipped + ' Spiele bereits begonnen, mit Ergebnis oder nicht geeignet. ' +
     plan.waiting + ' Spiele warten noch auf Teilnehmer aus vorherigen Runden.';
    for (const match of plan.matches) el(list,'li','','#' + match.number + ' · ' + match.event + ' · ' + (match.waiting ? 'Teilnehmer noch offen' : match.teams));
    if (plan.count > plan.matches.length) el(list,'li','','Weitere ' + (plan.count - plan.matches.length) + ' Spiele innerhalb der Grenze.');
    feedback(plan.count ? 'Die Vorschau ist zehn Minuten gültig. Der Spielstand wird vor dem Eintragen erneut geprüft.' : 'Keine offenen Spiele innerhalb dieser Grenze.','success');update();
   });
  });
  apply.addEventListener('click',async () => {
   if (disposed || apply.disabled || !plan) return;
   const chosen = plan, key = tournament().key;confirming = true;update();
   let approved;
   try {approved = await btsDialogActions.confirm({owner:parent,title:'Zufällige Testergebnisse eintragen',
    message:'Bis zu ' + chosen.count + ' Spiele erhalten zufällige Ergebnisse in BTS und BTP. Dadurch ändern sich Sieger, Folgerunden und Platzierungen.\n\nVorhandene Ergebnisse und inzwischen begonnene Spiele werden übersprungen.',
    confirmLabel:'In BTS und BTP eintragen',cancelLabel:'Abbrechen',danger:true,returnFocus:apply});}
   finally {confirming = false;update();}
   if (!approved || disposed || parent.hidden || tournament().key !== key || plan !== chosen) return;
   if (reason()) {feedback(reason() + ' Der Zufallslauf wurde nicht gestartet.','error');return;}
   pending = true;plan = null;update();feedback('Zufallsergebnisse werden eingetragen und mit BTP abgeglichen. Bei mehreren Runden kann das etwas dauern …','pending');
   send({type:'debug_random_results',action:'execute',tournament_key:key,token:chosen.token},(error,response) => {
    if (disposed || tournament().key !== key) return;
    pending = false;selection.hidden = true;
    feedback(error ? error.message || 'Der Zufallslauf ist fehlgeschlagen.' : response.changed + ' Zufallsergebnisse in BTS und BTP eingetragen. ' +
     response.skipped + ' ausgewählte Spiele übersprungen (inzwischen begonnen, mit Ergebnis oder Teilnehmer noch offen).',error ? 'error' : 'success');update();
   });
  });
  const observer = new MutationObserver(() => {if (parent.hidden) btsDialogActions.dismissConfirmation(parent);});
  observer.observe(parent,{attributes:true,attributeFilter:['hidden']});
  update();return {update,destroy:() => {disposed = true;observer.disconnect();btsDialogActions.dismissConfirmation(parent);}};
 }
 return {mount};
})();
