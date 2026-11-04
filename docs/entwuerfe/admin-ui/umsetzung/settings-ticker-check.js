'use strict';
/* eslint no-undef: off */

module.exports = async function({c,open,metrics,key,capture,check}) {
 const run = fn => c.evaluate('(' + fn.toString() + ')()');
 const wait = fn => c.evaluate('(async()=>{for(let i=0;i<200;i++){if((' + fn.toString() + ')())return;await new Promise(resolve=>setTimeout(resolve,30));}throw new Error("Ticker settings did not settle");})()');
 const verify = (name,fn) => check(name,'(' + fn.toString() + ')()');
 await open(1440,1000);
 await c.call('Emulation.setFocusEmulationEnabled',{enabled:true});
 await run(() => {
  window.__tickerDocument = document;window.__tickerSpeech = btsSpeechService;window.__tickerRequests = [];window.__tickerExceptions = [];
  window.addEventListener('error',event => __tickerExceptions.push(event.message));
  const original = send;window.send = (message,callback) => {
   if (message.type === 'service_status') return setTimeout(() => callback(null,{services:{btp:structuredClone(curt.btp_status),ticker:structuredClone(curt.ticker_status),speech:{enabled:true},speech_health:{state:'ok',issues:[]}}}),0);
   if (message.type === 'tournament_get') return setTimeout(() => callback(null,{tournament:structuredClone(curt)}),0);
   if (['tournament_edit_prop','ticker_pushall','ticker_reset'].includes(message.type)) {__tickerRequests.push({message:structuredClone(message),callback});return;}
   return original(message,callback);
  };
  window.__tickerField = name => document.querySelector('.settings-ticker [name="' + name + '"]');
  window.__tickerReply = error => __tickerRequests.shift().callback(error || null,{});
  window.__tickerStatus = (status,message = '') => ctournament.ticker_status_changed({val:{status,message}});
  document.querySelector('.leitstand-nav a[href$="/edit"]').click();
 });
 await wait(() => !!document.querySelector('.settings-area-link[href$="/edit/ticker"]'));
 await run(() => document.querySelector('.settings-area-link[href$="/edit/ticker"]').click());
 await verify('Ticker uses two shared cards with accessible fields and a masked password',() =>
  [...document.querySelectorAll('.settings-ticker .settings-card-heading h2')].map(node => node.textContent).join('|') === 'Ticker-Verbindung|Übertragung' &&
  ['ticker_enabled','ticker_url','ticker_password'].every(name => __tickerField(name).labels.length === 1 && __tickerField(name).getAttribute('aria-describedby')) &&
  __tickerField('ticker_enabled').getAttribute('role') === 'switch' && __tickerField('ticker_password').type === 'password');
 await verify('Disabled ticker settings stay editable in grey while transmission actions are unavailable',() =>
  !__tickerField('ticker_enabled').checked && !__tickerField('ticker_url').disabled && !__tickerField('ticker_password').disabled &&
  getComputedStyle(__tickerField('ticker_url')).backgroundColor === 'rgb(246, 248, 246)' &&
  __tickerField('ticker_url').closest('.settings-row').dataset.settingState === 'inactive' &&
  !document.querySelector('.settings-ticker-note').hidden && __tickerField('ticker_pushall').disabled && __tickerField('ticker_reset').disabled);
 await run(() => {__tickerField('ticker_url').focus();__tickerField('ticker_url').value='wss://ticker.example.de/update';__tickerField('ticker_password').focus();});
 await verify('The address saves on blur even when the ticker is disabled',() =>
  __tickerRequests.length === 1 && __tickerRequests[0].message.field === 'ticker_url' &&
  __tickerRequests[0].message.value === 'wss://ticker.example.de/update' && __tickerRequests[0].message.key === 'preview');
 await run(() => {__tickerReply();__tickerField('ticker_password').value='test-ticker-password';__tickerField('ticker_password').blur();__tickerReply();});
 await verify('Saving the masked password preserves the existing autosave and shared saved indicator',() =>
  curt.ticker_password === 'test-ticker-password' && curt.ticker_url === 'wss://ticker.example.de/update' &&
  document.querySelector('.live_settings_status_saved') && __tickerRequests.length === 0);
 await run(() => {__tickerField('ticker_url').focus();__tickerField('ticker_url').value='wss://wrong.example.de/update';__tickerField('ticker_url').blur();__tickerReply({message:'Synthetic ticker save failure'});});
 await verify('A failed address change restores the saved value and shows the existing save error',() =>
  __tickerField('ticker_url').value === curt.ticker_url && document.querySelector('.live_settings_status_error'));
 await run(() => {__tickerField('ticker_enabled').labels[0].click();__tickerReply();__tickerStatus('connecting');});
 await verify('Enabling the ticker activates its settings and shows a connecting badge and rotating icon',() =>
  curt.ticker_enabled === true && __tickerField('ticker_url').closest('.settings-row').dataset.settingState === 'active' &&
  document.querySelector('.settings-ticker-status').dataset.state === 'connecting' && document.querySelector('.settings-ticker-note').hidden &&
  getComputedStyle(__tickerField('ticker_reset').querySelector('.ico')).animationName !== 'none' && __tickerField('ticker_pushall').disabled);
 await run(() => {
  window.__tickerBadge = document.querySelector('.settings-ticker-status');window.__tickerBadgeWidth = __tickerBadge.getBoundingClientRect().width;
  window.__tickerAddress = __tickerField('ticker_url');window.__tickerPassword = __tickerField('ticker_password');
  __tickerAddress.focus();__tickerAddress.value='wss://draft.example.de/update';__tickerStatus('connected');
 });
 await verify('Live connection status updates retain focused fields, unsaved drafts and a stable badge width',() =>
  __tickerBadge === document.querySelector('.settings-ticker-status') && __tickerBadge.dataset.state === 'connected' &&
  __tickerBadge.getBoundingClientRect().width === __tickerBadgeWidth && __tickerField('ticker_url') === __tickerAddress &&
  __tickerField('ticker_password') === __tickerPassword && document.activeElement === __tickerAddress &&
  __tickerAddress.value === 'wss://draft.example.de/update' && !__tickerField('ticker_pushall').disabled);
 await run(() => {__tickerAddress.blur();__tickerField('ticker_pushall').click();__tickerField('ticker_reset').click();});
 await verify('Manual ticker actions wait for pending connection settings to be saved',() =>
  __tickerRequests.length === 1 && __tickerRequests[0].message.field === 'ticker_url' &&
  __tickerField('ticker_pushall').disabled && __tickerField('ticker_reset').disabled);
 await run(() => {__tickerReply();__tickerField('ticker_pushall').click();__tickerField('ticker_pushall').click();});
 await verify('Sending scores uses the existing ticker command once and blocks duplicate actions',() =>
  __tickerRequests.length === 1 && __tickerRequests[0].message.type === 'ticker_pushall' && __tickerRequests[0].message.tournament_key === 'preview' &&
  __tickerField('ticker_pushall').disabled && __tickerField('ticker_reset').disabled && __tickerField('ticker_pushall').getAttribute('aria-busy') === 'true');
 await run(() => __tickerReply());
 await verify('Accepted transmission requests show honest feedback and release the controls',() =>
  document.querySelector('.settings-ticker-result').textContent.includes('angefordert') && !__tickerField('ticker_pushall').disabled && document.querySelector('.live_settings_status_saved'));
 await run(() => {__tickerStatus('error','Ticker lehnt die Verbindung ab: Passwort prüfen.');});
 await verify('Connection failures are red, show the server reason and allow reconnecting',() =>
  __tickerBadge.dataset.state === 'error' && __tickerBadge.getBoundingClientRect().width === __tickerBadgeWidth &&
  getComputedStyle(__tickerBadge).backgroundColor === 'rgb(253, 236, 232)' &&
  document.querySelector('.settings-ticker-message').textContent.includes('Passwort prüfen') &&
  !document.querySelector('.settings-ticker-message').hidden && __tickerField('ticker_pushall').disabled && !__tickerField('ticker_reset').disabled);
 await run(() => {__tickerField('ticker_reset').click();__tickerField('ticker_reset').click();});
 await verify('Reconnect uses the existing reset command and guards concurrent requests',() =>
  __tickerRequests.length === 1 && __tickerRequests[0].message.type === 'ticker_reset' && __tickerField('ticker_reset').disabled);
 await run(() => __tickerReply({message:'Die Ticker-Verbindung konnte nicht neu aufgebaut werden.'}));
 await verify('Failed reconnects show a local error and retain settings for retry',() =>
  document.querySelector('.settings-ticker-result').dataset.state === 'error' && document.querySelector('.settings-ticker-result').textContent.includes('nicht neu aufgebaut') &&
  !__tickerField('ticker_reset').disabled && __tickerField('ticker_password').value === 'test-ticker-password');
 await run(() => {__tickerField('ticker_reset').click();__tickerStatus('connecting');__tickerReply();__tickerStatus('connected');});
 await verify('Reconnect success follows live status and clears the connection error',() =>
  __tickerBadge.dataset.state === 'connected' && document.querySelector('.settings-ticker-message').hidden && !__tickerField('ticker_pushall').disabled &&
  __tickerField('ticker_reset').getAttribute('aria-busy') === 'false');
 await run(() => {
  window.__tickerMutations = 0;window.__tickerObserver = new MutationObserver(records => __tickerMutations += records.length);
  __tickerObserver.observe(document.querySelector('.settings-ticker'),{subtree:true,childList:true,characterData:true,attributes:true});
  __tickerStatus('connected');__tickerStatus('connected');
 });
 await verify('Identical status updates do not rebuild fields or mutate the ticker page',() => __tickerMutations === 0);
 await run(() => {__tickerObserver.disconnect();document.querySelector('.settings-area-link[href$="/edit/btp"]').click();document.querySelector('.settings-area-link[href$="/edit/ticker"]').click();});
 await verify('Switching sections retains fields, document and the shared speech service',() =>
  __tickerAddress === __tickerField('ticker_url') && __tickerPassword === __tickerField('ticker_password') && document === __tickerDocument && btsSpeechService === __tickerSpeech);
 await capture('einstellungen-ticker',true);
 for (const width of [1920,950,390,320]) {
  await metrics(width,1000);
  await verify('Ticker cards, status and actions fit at ' + width + ' px',() =>
   document.documentElement.scrollWidth <= innerWidth+1 && [...document.querySelectorAll('.settings-ticker .settings-card,.settings-ticker input,.settings-ticker button,.settings-ticker-status')]
    .every(node => {const box=node.getBoundingClientRect();return box.left>=0 && box.right<=innerWidth+1;}));
  if (width === 390) await capture('einstellungen-ticker-mobil',true);
 }
 await metrics(1440,1000);
 await run(() => __tickerField('ticker_enabled').focus());
 await key(' ','Space',32,' ');
 await run(() => __tickerReply());
 await verify('Keyboard deactivation pauses transmission while keeping saved configuration editable',() =>
  !curt.ticker_enabled && __tickerBadge.dataset.state === 'deactivated' && !__tickerField('ticker_url').disabled &&
  __tickerField('ticker_password').value === 'test-ticker-password' && __tickerField('ticker_pushall').disabled && __tickerField('ticker_reset').disabled);
 await run(() => change.default_handler(() => {})({ctype:'props',val:{ticker_enabled:true}}));
 await verify('Remote enable changes refresh the switch and its dependency styling',() =>
  curt.ticker_enabled && __tickerField('ticker_enabled').checked && __tickerField('ticker_url').closest('.settings-row').dataset.settingState === 'active');
 await run(() => {__tickerStatus('connected');__tickerField('ticker_pushall').click();document.querySelector('.leitstand-nav a[href$="/devices"]').click();});
 await wait(() => !document.querySelector('.page-settings'));
 await run(() => __tickerReply());
 await verify('Late action replies after navigation do not recreate settings or disturb shared services',() =>
  !document.querySelector('.settings-ticker') && document === __tickerDocument && btsSpeechService === __tickerSpeech && __tickerExceptions.length === 0);
};
