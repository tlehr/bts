/* global btsSettingsWorkspace, cleitstand */
'use strict';

// Keep connection updates separate from editable fields and their drafts.
// eslint-disable-next-line no-unused-vars -- Used by tournament settings.
var btsTickerSettings = (() => {
 function mount(parent, {tournament, bind, send, refreshStatus}) {
  const doc = parent.ownerDocument;
  let disposed = false, pending = null, pendingSaves = 0;
  function el(owner, tag, className, value) {
   const node = doc.createElement(tag);node.className = className || '';
   if (value != null) node.textContent = value;owner.append(node);return node;
  }
  const text = (node, value) => {if (node.textContent !== value) node.textContent = value;};
  const show = (node, visible) => {if (node.hidden === visible) node.hidden = !visible;};
  function bindSetting(control, name, options = {}) {
   bind(control,name,{...options,
    on_before_send:() => {pendingSaves++;update();},
    on_success:() => {pendingSaves = Math.max(0,pendingSaves-1);update();},
    on_error:(input, oldValue) => {
     if (input.type === 'checkbox') input.checked = !!oldValue;else input.value = oldValue ?? '';
     pendingSaves = Math.max(0,pendingSaves-1);update();
    },
   });
  }
  const connection = btsSettingsWorkspace.card(parent, {title:'Ticker-Verbindung',
   description:'Aktuelle Spielstände an einen Ticker übertragen.',badge:'Deaktiviert'});
  const badge = connection.parentElement.querySelector('.settings-card-badge');
  badge.classList.add('settings-ticker-status');badge.setAttribute('role','status');
  const enabled = btsSettingsWorkspace.field(connection, {label:'Ticker aktivieren',
   description:'Verbindet dieses Turnier mit dem eingestellten Ticker.',attributes:{type:'checkbox',role:'switch',name:'ticker_enabled'}});
  enabled.checked = !!tournament().ticker_enabled;bindSetting(enabled,'ticker_enabled');
  const address = btsSettingsWorkspace.field(connection, {label:'Ticker-Adresse',
   description:'WebSocket-Adresse des Tickers, zum Beispiel wss://ticker.example.de/update.',
   attributes:{type:'text',name:'ticker_url',value:tournament().ticker_url || '',placeholder:'wss://ticker.example.de/update',spellcheck:'false',inputmode:'url',autocomplete:'off'}});
  bindSetting(address,'ticker_url',{event_name:'blur'});
  const password = btsSettingsWorkspace.field(connection, {label:'Ticker-Passwort',
   description:'Das am Ticker eingerichtete Passwort für die Übertragung.',
   attributes:{type:'password',name:'ticker_password',value:tournament().ticker_password || '',autocomplete:'off'}});
  bindSetting(password,'ticker_password',{event_name:'blur'});
  const connectionError = el(connection.parentElement, 'p', 'settings-ticker-message');
  connectionError.setAttribute('role','alert');connectionError.hidden = true;
  const transmission = btsSettingsWorkspace.card(parent, {title:'Übertragung',
   description:'Bei bestehender Verbindung werden Spielstände automatisch aktualisiert.'});
  const paused = el(transmission, 'p', 'settings-ticker-note', 'Der Ticker ist ausgeschaltet. Adresse und Passwort bleiben bearbeitbar.');
  const actions = el(transmission, 'div', 'settings-ticker-actions');
  function action(name, label, description, buttonLabel) {
   const button = btsSettingsWorkspace.field(actions, {label,description,tag:'button',attributes:{type:'button',class:'btn settings-ticker-action',name}});
   button.innerHTML = cleitstand.icon('refresh');el(button, 'span', '', buttonLabel);
   button.addEventListener('click', () => {
    if (disposed || button.disabled || pending) return;
    pending = name;text(result,'');show(result,false);update();
    const key = tournament().key;
    send({type:name,tournament_key:key}, failure => {
     if (disposed || tournament().key !== key) return;
     pending = null;
     result.dataset.state = failure ? 'error' : 'success';
     text(result,failure ? (failure.message || 'Die Anfrage an den Ticker ist fehlgeschlagen. Bitte erneut versuchen.') :
      name === 'ticker_reset' ? 'Neuaufbau der Verbindung angefordert.' : 'Übertragung der aktuellen Spielstände angefordert.');
     show(result,true);update();refreshStatus();
    });
   });
   return button;
  }
  const push = action('ticker_pushall','Aktuelle Spielstände senden','Überträgt die aktuellen Spiele erneut an den verbundenen Ticker.','Jetzt übertragen');
  const reconnect = action('ticker_reset','Verbindung neu aufbauen','Verbindet sich erneut mit der gespeicherten Adresse. Nach dem Verbinden werden die aktuellen Spiele übertragen.','Neu verbinden');
  const result = el(transmission, 'p', 'settings-ticker-result');result.setAttribute('role','status');result.hidden = true;
  function update() {
   if (disposed) return;
   const current = tournament(), active = !!current.ticker_enabled, status = current.ticker_status || {};
   const state = !active ? 'deactivated' : ['connected','connecting','error'].includes(status.status) ? status.status : 'disconnected';
   const labels = {deactivated:'Deaktiviert',connected:'Verbunden',connecting:'Verbindet …',error:'Verbindungsfehler',disconnected:'Nicht verbunden'};
   text(badge,labels[state]);if (badge.dataset.state !== state) badge.dataset.state = state;
   const detail = state === 'error' ? status.message || 'Die Verbindung zum Ticker konnte nicht hergestellt werden.' : '';
   text(connectionError,detail);show(connectionError,!!detail);show(paused,!active);
   for (const control of [address,password]) {
    const row = control.closest('.settings-row'), value = active ? 'active' : 'inactive';
    if (row.dataset.settingState !== value) row.dataset.settingState = value;
   }
   for (const button of [push,reconnect]) {
    const busy = pending === button.name || button === reconnect && state === 'connecting';
    const disabled = !active || !!pending || pendingSaves > 0 || button === push && state !== 'connected';
    if (button.disabled !== disabled) button.disabled = disabled;
    if (button.getAttribute('aria-busy') !== String(busy)) button.setAttribute('aria-busy',String(busy));
    const title = !active ? 'Bitte zuerst den Ticker aktivieren.' : pendingSaves ? 'Die Verbindungseinstellungen werden noch gespeichert.' : button === push && state !== 'connected' ? 'Warte auf eine Verbindung zum Ticker.' : '';
    if (button.title !== title) button.title = title;
   }
  }
  update();return {update,destroy:() => {disposed = true;}};
 }
 return {mount};
})();
