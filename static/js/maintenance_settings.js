/* global btsSettingsWorkspace, btsDialogActions, btsResetSelection, cleitstand, ci18n */
'use strict';

// Use the existing maintenance commands and retain their live update paths.
// eslint-disable-next-line no-unused-vars -- Used by tournament settings.
var btsMaintenanceSettings = (() => {
 function mount(parent, {tournament, send}) {
  const doc = parent.ownerDocument, entries = new Map();
  let disposed = false, confirming = null, pending = null;
  function el(owner, tag, className, value) {
   const node = doc.createElement(tag);node.className = className || '';
   if (value != null) node.textContent = value;owner.append(node);return node;
  }
  const text = (node,value) => {if (node.textContent !== value) node.textContent = value;};
  const show = (node,visible) => {if (node.hidden === visible) node.hidden = !visible;};
  const t = (key,parameters) => ci18n('tournament:edit:' + key,parameters);
  const maintenance = btsSettingsWorkspace.card(parent, {title:'Wartungsaktionen',description:'Feldzuweisungen und Spielerpausen dieses Turniers zurücksetzen.',badge:'Mit Bestätigung'});
  maintenance.parentElement.querySelector('.settings-card-badge').classList.add('settings-maintenance-confirmation-badge');
  const actions = el(maintenance,'div','settings-maintenance-actions');
  const connection = el(maintenance,'p','settings-maintenance-connection');
  const connectionText = el(connection,'span');
  const connectionLink = el(connection,'a','','BTP-Verbindung einstellen →');
  connectionLink.href = '/admin/t/' + encodeURIComponent(tournament().key) + '/edit/btp';connectionLink.dataset.settingsTarget = 'btp';
  const reset = btsSettingsWorkspace.card(parent, {title:'Turnier zurücksetzen',description:'Auswählen, welche Bereiche in BTS oder in BTS und BTP zurückgesetzt werden.',badge:'BTS / BTP'});
  reset.parentElement.classList.add('settings-maintenance-reset');
  function reason() {
   const current = tournament();
   return !current.btp_enabled ? 'Die BTP-Anbindung ist ausgeschaltet.' : current.btp_readonly ? 'BTP ist im Nur-Lesen-Modus.' :
    current.btp_status?.status !== 'connected' ? 'BTP ist derzeit nicht verbunden.' : '';
  }
  function feedback(entry, message, state) {
   text(entry.result,message);if (entry.result.dataset.state !== state) entry.result.dataset.state = state;show(entry.result,!!message);
  }
  function add(owner, {name,label,description,buttonLabel,icon,success}) {
   const button = btsSettingsWorkspace.field(owner,{label,description,tag:'button',attributes:{type:'button',name,class:'btn settings-maintenance-action ' + name + '_button'}});
   button.innerHTML = cleitstand.icon(icon);el(button,'span','',buttonLabel);
   const row = button.closest('.settings-row'), result = el(row.querySelector('.settings-row-info'),'p','settings-maintenance-result');
   result.hidden = true;result.setAttribute('role','status');result.id = button.id + '-result';
   button.setAttribute('aria-describedby',button.getAttribute('aria-describedby') + ' ' + result.id);
   const entry = {name,button,result,success};entries.set(name,entry);
   button.addEventListener('click',async () => {
    if (disposed || button.disabled || pending || confirming) return;
    const current = tournament(), key = current.key;
    const selectable = name === 'tournament_reset';confirming = name;
    let approved, plan, fullReset = false;
    try {
     if (selectable) {
      plan = await btsResetSelection.open({owner:parent,tournament,returnFocus:button});
      if (!plan || disposed || parent.hidden || tournament().key !== key) return;
      fullReset = plan.actions.includes('tournament');
     }
     const choiceLabels = {match_results:'Ergebnisse und Sieger von ' + (plan?.match_ids?.length || 0) + ' ausgewählten Spielen zurücksetzen',
      court_assignments:'Feldzuweisungen noch nicht gestarteter Spiele entfernen',player_pauses:'Spielerpausen zurücksetzen'};
     const message = fullReset ? t('reset:confirm') + '\n\n' + t('reset:hint') : plan ?
      'Ziel: ' + (plan.target === 'both' ? 'BTS und BTP' : 'Nur BTS') + '\n\n' + plan.actions.map(action => '• ' + choiceLabels[action]).join('\n') +
       (plan.match_ids?.length ? '\n\nAusgewählte Spiele:\n' + plan.match_ids.map(id => {
        const match = tournament().matches.find(item => item._id === id);
        return '#' + (match?.setup.match_num ?? id) + ' · ' + (match?.setup.event_name || '') + ' · ' +
         (match?.setup.teams || []).map(team => team.players.map(player => player.name).join(' / ')).join(' – ');
       }).join('\n') : '') +
       (plan.actions.includes('match_results') ? '\n\nSpiele und Auslosungen bleiben erhalten. Ein geänderter Sieger kann die Besetzung nachfolgender Spiele verändern.' : '') +
       (plan.target === 'bts' ? '\n\nBTP bleibt unverändert. Ein späterer Abgleich kann BTP-Werte wieder übernehmen.' : '') : t(name + ':confirm');
     approved = await btsDialogActions.confirm({owner:parent,title:fullReset ? 'Turnier zurücksetzen' : selectable ? 'Auswahl zurücksetzen' : label,
      message,confirmLabel:selectable ? 'Auswahl zurücksetzen' : buttonLabel,cancelLabel:'Abbrechen',danger:true,returnFocus:button,
      verification:fullReset ? {label:t('reset:prompt').replace('{key}',key),value:key} : undefined});
    } finally {confirming = null;}
    if (!approved || disposed || parent.hidden || tournament().key !== key) return;
    const blocked = !fullReset && (!plan || plan.target === 'both') && reason();
    if (blocked) {entry.availabilityError = blocked;feedback(entry,blocked + ' Die Aktion wurde nicht ausgeführt.','error');update();return;}
    delete entry.availabilityError;pending = name;feedback(entry,'Wird ausgeführt …','pending');update();
    const command = plan ? fullReset ? {type:'tournament_reset',target:'bts'} : {type:'maintenance_reset',...plan} : {type:name};
    send({...command,tournament_key:key},(failure,response) => {
     if (disposed || tournament().key !== key) return;
     pending = null;
     if (failure) feedback(entry,failure.message || 'Die Wartungsaktion ist fehlgeschlagen. Bitte erneut versuchen.','error');
     else feedback(entry,plan && !fullReset ? 'Zurückgesetzt: ' + plan.actions.map(action => ({court_assignments:'Feldzuweisungen',player_pauses:'Spielerpausen',match_results:'Ergebnisse und Sieger'})[action]).join(', ') +
      (plan.target === 'both' ? '. Änderungen an BTP übergeben.' : '. Nur BTS wurde geändert.') : success(response || {}),'success');
     update();
    });
   });
  }
  add(actions,{name:'court_assignments_reset',label:'Feldzuweisungen entfernen',description:t('court_assignments_reset:hint'),
   buttonLabel:'Feldzuweisungen entfernen',icon:'court',success:response => t('court_assignments_reset:done',{
    count:response.changed_matches ?? 0,btp_count:response.btp_changed_matches ?? 0,skipped:response.skipped_matches ?? 0,
   })});
  add(actions,{name:'player_pause_reset',label:'Spielerpausen zurücksetzen',description:t('player_pause_reset:hint'),
   buttonLabel:'Pausen zurücksetzen',icon:'refresh',success:response => 'Spielerpausen zurückgesetzt – ' + (response.player_count ?? 0) + ' Spieler in ' + (response.changed_matches ?? 0) + ' Spielen.'});
  add(reset,{name:'tournament_reset',label:'Bereiche und Ziel festlegen',description:'Ergebnisse und Sieger, Feldzuweisungen oder Spielerpausen auswählen. Alternativ den lokalen Turnierbestand vollständig leeren.',
   buttonLabel:'Zurücksetzen auswählen',icon:'refresh',success:() => 'Der lokale Turnierbestand wurde zurückgesetzt.'});
  function update() {
   if (disposed) return;
   btsResetSelection.refresh(parent);
   const blocked = reason();
   const state = blocked ? 'blocked' : 'ready';
   if (connection.dataset.state !== state) connection.dataset.state = state;
   text(connectionText,blocked ? blocked + ' Feldzuweisungen und Spielerpausen benötigen eine schreibende BTP-Verbindung.' : 'BTP ist schreibend verbunden. Beide Aktionen ändern auch die Daten in BTP.');
   for (const entry of entries.values()) {
    if (entry.availabilityError && entry.availabilityError !== blocked) {feedback(entry,'','success');delete entry.availabilityError;}
    const disabled = !!pending || entry.name !== 'tournament_reset' && !!blocked;
    if (entry.button.disabled !== disabled) entry.button.disabled = disabled;
    const busy = pending === entry.name;
    if (entry.button.getAttribute('aria-busy') !== String(busy)) entry.button.setAttribute('aria-busy',String(busy));
    if (busy) entry.button.dataset.pending = 'true';else if (entry.button.dataset.pending) delete entry.button.dataset.pending;
    const title = entry.name === 'tournament_reset' ? '' : blocked;
    if (entry.button.title !== title) entry.button.title = title;
   }
  }
  const observer = new MutationObserver(() => {if (parent.hidden) {btsDialogActions.dismissConfirmation(parent);btsResetSelection.close(parent);}});
  observer.observe(parent,{attributes:true,attributeFilter:['hidden']});
  function destroy() {disposed = true;observer.disconnect();btsDialogActions.dismissConfirmation(parent);btsResetSelection.close(parent);}
  update();return {update,destroy};
 }
 return {mount};
})();
