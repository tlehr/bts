/* global cleitstand, btsDialogActions, displaymode */
'use strict';

// Keep assignment inputs, open details and filters mounted during live updates.
// eslint-disable-next-line no-unused-vars -- Mounted by the tournament router.
var btsDevicesWorkspace = (() => {
 const roles = {admin:'Verwaltung', display:'Anzeige', umpire:'Bedienoberfläche', client:'Browserseite', 'speech-planning':'Sprachsystem', diagnostics:'Diagnose'};
 const levels = {error:'Fehler', warn:'Warnung', info:'Info', debug:'Detail'};
 const sources = {server:'BTS-Server', speech:'Sprachprozess', control:'Fernsteuerung', ...roles};
 const states = {scheduled:'Vorgemerkt', waiting:'Wartet', reloading:'Wird neu geladen', reconnected:'Wieder verbunden', unreachable:'Nicht erreichbar', disconnected:'Noch nicht wieder verbunden', cancelled:'Abgebrochen', expired:'Abgelaufen'};
 const text = (node, value) => {value = String(value ?? '');if (node.textContent !== value) node.textContent = value;};
 const time = value => Number.isFinite(value) && value > 0 ? new Date(value).toLocaleString('de-DE') : 'Noch nicht erfasst';
 const purpose = profile => profile?.devicemode === 'display' ? 'Anzeige' : ({registration_check:'Anmeldung', self_check_in:'Selbst-Check-in', scorecard:'Spielbericht', umpire:'Spielzählung'}[profile?.tablet_mode] || 'Bedienoberfläche');
 function batteryEstimate(data, online) {
  if (!online) return {label:'Gerät getrennt',value:'',title:'Für getrennte Geräte wird keine aktuelle Restzeit geschätzt.'};
  const level = data?.level;
  if (!Number.isFinite(level) || level < 0 || level > 1) return {label:'Restzeit',value:'nicht verfügbar',title:'Das Gerät meldet keinen gültigen Akkustand.'};
  const percent = Math.round(level * 100), charging = data.charging === true;
  if (charging && percent === 100) return {label:'Voll geladen',value:'',title:'Der Akku ist vollständig geladen.'};
  if (!charging && percent < 10) return {label:'Reserve erreicht',value:'',title:'Der Akkustand liegt unter 10 %.'};
  const label = charging ? 'Bis voll' : percent < 25 ? 'Bis Reserve' : 'Bis Warnung';
  const reported = charging ? data.chargingTime : data.dischargingTime;
  if (!Number.isFinite(reported) || reported <= 0) return {label,value:'nicht verfügbar',title:'Das Gerät meldet keine nutzbare Restzeit.'};
  const threshold = percent < 25 ? .10 : .25;
  const seconds = charging ? reported : reported * Math.max(0, level - threshold) / level;
  const minutes = Math.round(seconds / 60), hours = Math.floor(minutes / 60);
  const duration = seconds < 60 ? '< 1 Min.' : hours ? hours + ' Std.' + (minutes % 60 ? ' ' + (minutes % 60) + ' Min.' : '') : minutes + ' Min.';
  return {label,value:(seconds < 60 ? '' : 'ca. ') + duration,title:charging ? 'Schätzung des Geräts bis zur vollständigen Ladung.' : 'Aus der gemeldeten Restlaufzeit bei gleichbleibendem Verbrauch bis unter ' + Math.round(threshold * 100) + ' % geschätzt.'};
 }
 function create({owner, tournament, send, navigate, section, onSelect, onDispose}) {
  const doc = owner.ownerDocument, lifetime = new AbortController(), {signal} = lifetime;
  const panelRows = new Map(), browserGroups = new Map(), logRows = new Map(), commandRows = new Map(), requests = new Set(), pendingPanels = new Set(), busyControls = new Set();
  let disposed = false, snapshot = null, selected = '', polling = false, refreshed = false, freshness = false, refreshAgain = false;
  let logGeneration = 0, cursor = 0, paused = false, exporting = false, logChain = Promise.resolve(), nextLogAt = 0, searchTimer;
  let logLimit = 50, moreLogs = false, loadingOlder = false;
  let logTarget = null;
  function el(parent, tag, className, value) {
   const node = doc.createElement(tag);node.className = className || '';if (value != null) node.textContent = value;parent.append(node);return node;
  }
  function button(parent, label, symbol, action) {
   const node = el(parent, 'button', 'btn');node.type = 'button';
   if (symbol) node.innerHTML = cleitstand.icon(symbol);el(node, 'span', '', label);node.addEventListener('click', action, {signal});return node;
  }
  function link(parent, label, path) {
   const node = el(parent, 'a', 'devices-related-link', label);node.href = path;
   node.addEventListener('click', event => {if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;event.preventDefault();navigate(path);}, {signal});return node;
  }
  function field(parent, label, name, type = 'select', choices) {
   const wrapper = el(parent, 'label', 'devices-field');el(wrapper, 'span', '', label);
   const control = el(wrapper, type === 'select' ? 'select' : 'input');control.name = name;
   if (type !== 'select') control.type = type;
   if (choices) for (const [value, caption] of choices) {const option = el(control, 'option', '', caption);option.value = value;}
   return control;
  }
  function card(parent, title, description, badge) {
   const node = el(parent, 'section', 'devices-card'), heading = el(node, 'header', 'devices-card-heading'), info = el(heading, 'div');
   el(info, 'h2', '', title);if (description) el(info, 'p', 'devices-hint', description);
   const mark = el(heading, 'span', 'devices-count', badge || '');mark.hidden = !badge;
   return {node, heading, mark, body:el(node, 'div', 'devices-card-body')};
  }
  function table(parent, headings, label) {
   const wrap = el(parent, 'div', 'devices-table-wrap');wrap.tabIndex = 0;wrap.setAttribute('role', 'region');wrap.setAttribute('aria-label', label);
   const node = el(wrap, 'table', 'devices-table'), header = el(el(node, 'thead'), 'tr');
   for (const heading of headings) {const cell = el(header, 'th', '', heading);cell.scope = 'col';}
   return el(node, 'tbody');
  }
  function status(node, value, appearance) {
   text(node, value);
   const className = 'devices-status ' + appearance;if (node.className !== className) node.className = className;
   const row = node.closest('tr');if (row && row.dataset.connection !== appearance) row.dataset.connection = appearance;
  }
  function options(select, entries, value) {
   const signature = JSON.stringify(entries);
   if (select._options !== signature) {
    const draft = doc.activeElement === select ? select.value : null;
    select.replaceChildren();for (const [id, label] of entries) {const option = el(select, 'option', '', label);option.value = id;}
    select._options = signature;select.value = draft != null && entries.some(([id]) => String(id) === draft) ? draft : String(value ?? '');
   }
   if (doc.activeElement !== select && select.value !== String(value ?? '')) select.value = String(value ?? '');
  }
  const page = el(owner, 'section', 'leitstand page-devices');page.setAttribute('aria-labelledby', 'leitstand-page-title');
  const workspace = el(page, 'div', 'devices-workspace'), top = el(workspace, 'div', 'devices-topline');
  const tabs = el(top, 'div', 'devices-tabs');tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', 'Geräte und Protokolle');
  const tabNodes = new Map(), panels = new Map();
  const live = el(top, 'span', 'devices-status is-loading', 'Status wird geladen …');live.setAttribute('role', 'status');
  const issue = el(workspace, 'p', 'devices-error');issue.setAttribute('role', 'alert');issue.hidden = true;
  const actionMessage = el(workspace, 'p', 'devices-feedback');actionMessage.setAttribute('role', 'status');actionMessage.hidden = true;
  for (const [id, title, symbol] of [['devices','Geräte','monitor'], ['logs','Logs','logs']]) {
   const tab = button(tabs, title, symbol, () => onSelect(id));tab.id = 'devices-tab-' + id;tab.setAttribute('role', 'tab');
   const panel = el(workspace, 'div', 'devices-panel');panel.id = 'devices-panel-' + id;panel.setAttribute('role', 'tabpanel');panel.setAttribute('aria-labelledby', tab.id);
   tab.setAttribute('aria-controls', panel.id);tabNodes.set(id, tab);panels.set(id, panel);
  }
  tabs.addEventListener('keydown', event => {
   if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;event.preventDefault();
   const ids = [...tabNodes.keys()], index = ids.indexOf(selected), next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
   onSelect(ids[next]);tabNodes.get(ids[next]).focus();
  }, {signal});
  const devicePanel = panels.get('devices'), toolbar = el(devicePanel, 'div', 'devices-toolbar');
  const search = field(toolbar, 'Gerät oder Seite suchen', 'device_search', 'search');search.placeholder = 'Name, Kennung, Halle oder Feld';
  const onlineFilter = field(toolbar, 'Verbindung', 'device_connection', 'select', [['all','Alle Verbindungen'], ['online','Verbunden'], ['offline','Getrennt']]);
  const refreshButton = button(toolbar, 'Aktualisieren', 'refresh', () => {void refresh();});
  const assignments = card(devicePanel, 'Anzeigen & Bedienoberflächen', 'Weise Geräten ein Profil und ihre Felder zu. Änderungen werden direkt gespeichert.');
  link(assignments.heading, 'Profile bearbeiten →', '/admin/t/' + encodeURIComponent(tournament().key) + '/edit/devices');
  const panelBody = table(assignments.body, ['Gerät', 'Verbindung', 'Akku', 'Oberfläche', 'Profil', 'Halle & Felder', 'Aktionen'], 'Anzeigen und Bedienoberflächen');
  panelBody.className = 'devices-assignments';
  const emptyPanels = el(assignments.body, 'p', 'devices-empty');
  const purge = button(assignments.body, 'Getrennte Geräte entfernen', 'trash', () => void removePanels());purge.classList.add('devices-cleanup');
  const browsers = card(devicePanel, 'Geräte & Browserseiten', 'Alle beim BTS-Server erfassten Browserseiten. Eine Gerätekennung fasst Seiten desselben Browserprofils zusammen.', 'Serverweit');
  const browserList = el(browsers.body, 'div', 'devices-browser-list'), emptyBrowsers = el(browsers.body, 'p', 'devices-empty', 'Browserseiten werden geladen …');
  const commands = card(devicePanel, 'Neuladeaufträge', 'Laufende Spiele, ungespeicherte Eingaben und laufende Durchsagen verzögern das Neuladen automatisch.');
  const reloadToolbar = el(commands.body, 'div', 'devices-toolbar');
  const reloadScope = field(reloadToolbar, 'Ziel', 'reload_scope', 'select', [['tournament','Alle Seiten dieses Turniers'], ['role','Alle Seiten einer Oberfläche'], ['all','Alle Seiten des Servers']]);
  const reloadRole = field(reloadToolbar, 'Oberfläche', 'reload_role', 'select', Object.entries(roles));reloadRole.parentElement.hidden = true;
  reloadScope.addEventListener('change', () => {reloadRole.parentElement.hidden = reloadScope.value !== 'role';}, {signal});
  const reloadGroup = button(reloadToolbar, 'Neuladen vormerken', 'refresh', () => void bulkReload());
  const commandList = el(commands.body, 'div', 'devices-command-list'), emptyCommands = el(commands.body, 'p', 'devices-empty', 'Noch keine Neuladeaufträge.');
  const logPanel = panels.get('logs'), logCard = card(logPanel, 'Zentrale Logs', 'Meldungen vom BTS-Server und seinen Browserseiten. Neue Meldungen erscheinen oben.', 'Serverweit');
  const filters = el(logCard.body, 'div', 'devices-log-filters');
  const logSearch = field(filters, 'Meldungen durchsuchen', 'log_search', 'search');logSearch.maxLength = 200;
  const logSource = field(filters, 'Quelle', 'log_source', 'select', [['','Alle Quellen'], ...Object.entries(sources)]);
  const logLevel = field(filters, 'Schweregrad', 'log_level', 'select', [['','Alle Meldungen'], ...Object.entries(levels)]);
  const logTournament = field(filters, 'Turnier', 'log_tournament', 'select', [['','Alle Turniere'], [tournament().key, tournament().name || tournament().key]]);
  const since = field(filters, 'Von', 'log_since', 'datetime-local'), until = field(filters, 'Bis', 'log_until', 'datetime-local');
  const targetBar = el(logCard.body, 'div', 'devices-log-target');targetBar.hidden = true;
  const targetLabel = el(targetBar, 'span');button(targetBar, 'Filter entfernen', 'close', () => {logTarget = null;targetBar.hidden = true;resetLogs();});
  const logActions = el(logCard.body, 'div', 'devices-toolbar');
  const pause = button(logActions, 'Live-Ansicht pausieren', 'pause', () => {
   paused = !paused;pause.setAttribute('aria-pressed', String(paused));text(pause.querySelector('span'), paused ? 'Live-Ansicht fortsetzen' : 'Live-Ansicht pausieren');if (!paused) void refresh();
  });pause.setAttribute('aria-pressed', 'false');
  const exportButton = button(logActions, 'Logs exportieren', 'download', () => void exportLogs());
  const verboseLabel = el(logActions, 'label', 'devices-verbose'), verbose = el(verboseLabel, 'input');verbose.type = 'checkbox';verbose.name = 'diagnostics_verbose';
  el(verboseLabel, 'span', '', 'Detailprotokoll für 10 Minuten');
  verbose.addEventListener('change', async () => {
   if (busyControls.has(verbose)) return;busyControls.add(verbose);verbose.disabled = true;
   try {await rpc('diagnostics_verbose', {enabled:verbose.checked});await refresh();} catch (error) {if (!disposed) {verbose.checked = !verbose.checked;message(error.message, true);}}
   finally {busyControls.delete(verbose);if (!disposed) verbose.disabled = !freshness;}
  }, {signal});
  const logSummary = el(logCard.body, 'p', 'devices-hint', 'Logs werden geladen …');logSummary.setAttribute('role', 'status');
  const logError = el(logCard.body, 'p', 'devices-error');logError.setAttribute('role', 'alert');logError.hidden = true;
  const logList = el(logCard.body, 'ol', 'devices-log-list'), emptyLogs = el(logCard.body, 'p', 'devices-empty', 'Noch keine Meldungen geladen.');
  const logPages = el(logCard.body, 'div', 'devices-log-pages'), loadOlder = button(logPages, 'Weitere 50 laden', null, () => void loadOlderLogs());logPages.hidden = true;
  for (const node of [logSource, logLevel, logTournament, since, until]) node.addEventListener('change', resetLogs, {signal});
  logSearch.addEventListener('input', () => {clearTimeout(searchTimer);searchTimer = setTimeout(resetLogs, 280);}, {signal});
  search.addEventListener('input', update, {signal});onlineFilter.addEventListener('change', update, {signal});
  function message(value, error = false) {text(actionMessage, value);actionMessage.classList.toggle('is-error', error);actionMessage.hidden = !value;}
  function rpc(type, values = {}) {
   if (disposed) return Promise.reject(new Error('Ansicht wurde geschlossen'));
   return new Promise((resolve, reject) => {
    const entry = {reject, timer:null};requests.add(entry);
    const finish = (error, response) => {
     if (!requests.delete(entry)) return;clearTimeout(entry.timer);
     if (error || response?.diagnostics_error) reject(new Error(error?.message || response.diagnostics_error));else resolve(response || {});
    };
    entry.timer = setTimeout(() => finish(new Error('Zeitüberschreitung – bitte die Verbindung prüfen.')), 8000);
    try {send({type, tournament_key:tournament().key, ...values}, finish);} catch (error) {finish(error);}
   });
  }
  function logQuery(filter) {
   const run = async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, nextLogAt - Date.now())));
    if (disposed) throw new Error('Ansicht wurde geschlossen');nextLogAt = Date.now() + 240;
    const response = await rpc('diagnostics_logs', {filter});if (!response.logs) throw new Error('Keine Logdaten erhalten.');return response.logs;
   };
   const result = logChain.then(run, run);logChain = result.catch(() => {});return result;
  }
  function pageMatches(panel) {
   return (snapshot?.pages || []).filter(item => String(item.panel_client_id || '') === String(panel.client_id) && item.tournament_key === tournament().key)
    .sort((a,b) => Number(b.online) - Number(a.online) || b.last_seen - a.last_seen);
  }
  function profileFor(panel) {return (tournament().displaysettings || []).find(item => item.id === panel.displaysetting_id);}
  function courtName(court) {
   const location = (tournament().locations || []).find(item => item._id === court.location_id);
   return (location?.name ? location.name + ' · ' : '') + 'Feld ' + court.num;
  }
  function courtOptions(panel) {
   const profile = profileFor(panel), courts = tournament().courts || [], list = [['--','Kein Feld zugewiesen']];
   if (profile?.devicemode === 'display' && displaymode.FIELDLESS_MULTI_COURT_STYLES.includes(profile.displaymode_style)) list.push(['__multi__','Mehrere Felder · Auswahl im Profil']);
   else if (profile?.devicemode === 'display' && ['2court','castall','stream'].includes(profile.displaymode_style)) {
    for (let i = 0; i + 1 < courts.length; i++) list.push([courts[i]._id, courtName(courts[i]) + ' & ' + courtName(courts[i + 1])]);
   } else for (const court of courts) list.push([court._id, courtName(court)]);
   if (panel.court_id && !list.some(([id]) => id === panel.court_id)) list.push([panel.court_id, panel.court_id === '__multi__' ? 'Mehrere Felder' : 'Bisherige Zuordnung: ' + panel.court_id]);
   return list;
  }
  function matches(value, online) {
   const term = search.value.trim().toLocaleLowerCase('de');
   return (!term || value.toLocaleLowerCase('de').includes(term)) && (onlineFilter.value === 'all' || (onlineFilter.value === 'online') === !!online);
  }
  async function save(panel, fieldName, value, node) {
   const id = String(panel.client_id);if (pendingPanels.has(id)) return;pendingPanels.add(id);text(node.error, '');update();
   const before = panel[fieldName];
   try {
    await rpc(fieldName === 'court_id' ? 'relocate_display' : 'change_display_mode', {display_setting_id:panel.client_id, [fieldName === 'court_id' ? 'new_court_id' : 'new_displaysettings_id']:value});
    if (disposed) return;
    // A concurrent server notification is newer than the locally submitted value.
    if (panel[fieldName] === before) panel[fieldName] = value === '--' ? '' : value;
    message('Zuordnung gespeichert.');
   } catch (error) {if (!disposed) text(node.error, 'Speichern fehlgeschlagen: ' + error.message);}
   finally {
    pendingPanels.delete(id);
    if (!disposed) {node.profile.value = panel.displaysetting_id || '';node.court.value = panel.court_id || '--';update();}
   }
  }
  function createBatteryCaption(parent) {
   const caption = el(parent, 'span', 'devices-battery-caption');
   const value = el(caption, 'span', 'devices-battery-value'), charging = el(caption, 'span', 'devices-battery-charging');
   charging.innerHTML = cleitstand.icon('bolt');
   return {value,charging};
  }
  function createBattery(parent) {
   const node = el(parent, 'div', 'devices-battery');node.setAttribute('role', 'img');
   const gauge = el(node, 'span', 'devices-battery-gauge');gauge.setAttribute('aria-hidden', 'true');
   el(gauge, 'span', 'devices-battery-charge');
   const caption = createBatteryCaption(gauge), fill = el(gauge, 'span', 'devices-battery-fill');
   // The actual level stays above the lighter charging animation and clips its label.
   const filledCaption = createBatteryCaption(fill);
   const estimate = el(parent, 'small', 'devices-battery-estimate'), estimateLabel = el(estimate, 'span'), estimateValue = el(estimate, 'span');
   return {node,fill,captions:[caption,filledCaption],estimate,estimateLabel,estimateValue,signature:''};
  }
  function updateBattery(battery, data, online) {
   const estimate = batteryEstimate(data, online);
   text(battery.estimateLabel, estimate.label);text(battery.estimateValue, estimate.value);
   if (battery.estimate.title !== estimate.title) battery.estimate.title = estimate.title;
   const level = data?.level, known = typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1;
   const percent = known ? Math.round(level * 100) : null, charging = data?.charging === true;
   const signature = percent + ':' + charging;if (battery.signature === signature) return;battery.signature = signature;
   const label = (known ? 'Akku: ' + percent + ' Prozent' : 'Akkustand nicht verfügbar') + (charging ? ' · wird geladen' : '');
   battery.node.className = 'devices-battery is-' + (!known ? 'unknown' : percent < 10 ? 'critical' : percent < 25 ? 'low' : 'normal') + (known && charging && percent < 100 ? ' is-charging' : '');
   battery.node.setAttribute('aria-label', label);battery.node.title = label;
   battery.fill.style.width = (percent ?? 0) + 'px';battery.fill.hidden = !known;
   for (const caption of battery.captions) {text(caption.value, known ? percent + ' %' : 'Nicht verfügbar');caption.charging.hidden = !charging;}
  }
  function createPanel(panel) {
   const row = el(panelBody, 'tr');row.dataset.displayId = panel.client_id;
   const device = el(row, 'td'), name = el(device, 'strong'), id = el(device, 'small', '', 'Kennung ' + panel.client_id);
   id.className = 'devices-id';
   const connection = el(row, 'td'), badge = el(connection, 'span'), seen = el(connection, 'small'), ack = el(connection, 'small');
   const battery = createBattery(el(row, 'td', 'devices-battery-cell'));
   const surface = el(row, 'td'), mode = el(surface, 'span');
   const profileCell = el(row, 'td'), profile = el(profileCell, 'select');profile.name = 'displaysettings_' + panel.client_id;profile.setAttribute('aria-label', 'Profil für Gerät ' + panel.client_id);
   const courtCell = el(row, 'td'), court = el(courtCell, 'select');court.name = 'court_' + panel.client_id;court.setAttribute('aria-label', 'Halle und Felder für Gerät ' + panel.client_id);
   const actions = el(row, 'td'), actionButtons = el(actions, 'div', 'devices-row-actions');
   const reload = button(actionButtons, 'Neu laden', 'refresh', () => {
    const latest = (tournament().displays || []).find(item => String(item.client_id) === String(panel.client_id));if (!latest?.online) return;
    const target = pageMatches(latest).find(item => item.online);
    if (target) void action('diagnostics_reload', {scope:'page',value:target.id}, reload, 'Neuladen vorgemerkt.');
    else void action('display_reset', {display_client_id:panel.client_id}, reload, 'Geräteverbindung wird erneuert.');
   });
   const logs = button(actionButtons, 'Logs', 'logs', () => {
    const target = pageMatches(panel)[0];if (target) openLogs({page_id:target.id}, (panel.hostname || 'Gerät ' + panel.client_id) + ' · Browserseite');
   });
   const remove = button(actionButtons, 'Entfernen', 'trash', () => void removePanels([String(panel.client_id)]));
   const error = el(actions, 'small', 'devices-row-error');error.setAttribute('role', 'status');
   const node = {row,name,battery,badge,seen,ack,mode,profile,court,reload,logs,remove,error};
   profile.addEventListener('change', () => void save((tournament().displays || []).find(item => String(item.client_id) === String(panel.client_id)), 'displaysetting_id', profile.value, node), {signal});
   court.addEventListener('change', () => void save((tournament().displays || []).find(item => String(item.client_id) === String(panel.client_id)), 'court_id', court.value, node), {signal});
   return node;
  }
  function updatePanels() {
   const panelsById = new Map((tournament().displays || []).filter(item => item.client_id != null).map(item => [String(item.client_id), item]));let visible = 0, online = 0;
   const profiles = (tournament().displaysettings || []).map(item => [item.id, item.description || item.id]);
   const contactsById = new Map();
   for (const contact of snapshot?.panel_contacts || []) if (contact.tournament_key === tournament().key && Number.isFinite(contact.last_contact)) {
    const id = String(contact.client_id);contactsById.set(id, Math.max(contactsById.get(id) || 0, contact.last_contact));
   }
   for (const [id, panel] of panelsById) {
    let node = panelRows.get(id);if (!node) {node = createPanel(panel);panelRows.set(id, node);}
    const profile = profileFor(panel), pages = pageMatches(panel);
    const latest = Math.max(0, ...[panel.last_contact, panel.display_render_stats?.last_ack_ts, contactsById.get(id),
     ...pages.map(item => item.last_seen)].filter(value => Number.isFinite(value) && value > 0));
    const pending = pendingPanels.has(id);if (panel.online) online++;
    text(node.name, panel.hostname || 'Gerät ' + id);text(node.mode, profile ? purpose(profile) : roles[panel.panel_devicemode] || 'Bedienoberfläche');
    updateBattery(node.battery, panel.battery, panel.online);
    status(node.badge, panel.online ? panel.wait_for_done ? 'Übertragung läuft' : 'Verbunden' : 'Getrennt', !freshness ? 'is-stale' : panel.online ? panel.wait_for_done ? 'is-loading' : 'is-online' : 'is-offline');
    text(node.seen, 'Letzter Kontakt: ' + time(latest));text(node.ack, panel.display_render_stats?.ack_count && Number.isFinite(panel.display_render_stats.avg_roundtrip_ms) ? 'Antwortzeit Ø ' + panel.display_render_stats.avg_roundtrip_ms + ' ms' : '');
    if (!pending) {
     const entries = [...profiles];if (!entries.some(([key]) => key === panel.displaysetting_id)) entries.unshift([panel.displaysetting_id || '', panel.displaysetting_id ? 'Fehlendes Profil: ' + panel.displaysetting_id : 'Noch kein Profil zugewiesen']);
     options(node.profile, entries, panel.displaysetting_id);options(node.court, courtOptions(panel), panel.court_id || '--');
    }
    node.profile.disabled = pending;node.court.disabled = pending;
    node.reload.disabled = pending || !panel.online || !freshness;node.remove.disabled = pending || !!panel.online || !freshness;node.logs.disabled = !pages.length;
    const guarded = pages.some(item => item.online);text(node.reload.querySelector('span'), guarded ? 'Neu laden' : 'Verbindung erneuern');
    node.reload.title = guarded ? 'Diese Browserseite kontrolliert neu laden' : 'Die bestehende Verbindung neu initialisieren';
    node.logs.title = pages.length ? 'Logs der Browserseite öffnen' : 'Noch keine zugehörige Browserdiagnose erfasst';
    node.row.hidden = !matches([panel.hostname, id, purpose(profile), ...courtOptions(panel).filter(([key]) => key === panel.court_id).map(([,label]) => label)].join(' '), panel.online);
    if (!node.row.hidden) visible++;
   }
   for (const [id, node] of panelRows) if (!panelsById.has(id)) {node.row.remove();panelRows.delete(id);}
   text(assignments.mark, online + ' verbunden · ' + panelsById.size + ' Geräte');assignments.mark.hidden = false;
   emptyPanels.hidden = visible > 0;text(emptyPanels, panelsById.size ? 'Keine Geräte passen zum Filter.' : 'Noch keine Anzeigen oder Bedienoberflächen verbunden. Neue Geräte erscheinen hier automatisch.');
   purge.disabled = !freshness || pendingPanels.size > 0 || ![...panelsById.values()].some(item => !item.online);
  }
  function createBrowserGroup(id) {
   const details = el(browserList, 'details', 'devices-browser-group');details.dataset.deviceId = id;
   const summary = el(details, 'summary'), info = el(summary, 'span'), name = el(info, 'strong'), identity = el(info, 'small', 'devices-id', id), badge = el(summary, 'span');
   identity.title = 'Kennung dieses Browserprofils';
   const content = el(details, 'div', 'devices-browser-content'), actions = el(content, 'div', 'devices-row-actions');
   const reload = button(actions, 'Alle Seiten dieses Geräts neu laden', 'refresh', () => void action('diagnostics_reload', {scope:'device',value:id}, reload, 'Neuladen für dieses Gerät vorgemerkt.'));
   button(actions, 'Logs dieses Geräts', 'logs', () => openLogs({device_id:id}, name.textContent));
   const body = table(content, ['Browserseite', 'Kontext', 'Verbindung', 'Aktionen'], 'Browserseiten von Gerät ' + id);
   return {details,name,badge,body,reload,rows:new Map()};
  }
  function createBrowserPage(group, item) {
   const row = el(group.body, 'tr');row.dataset.pageId = item.id;
   const first = el(row, 'td'), name = el(first, 'strong'), path = el(first, 'small'), version = el(first, 'small');
   const context = el(row, 'td'), tournamentName = el(context, 'span'), location = el(context, 'small');
   const connection = el(row, 'td'), badge = el(connection, 'span'), seen = el(connection, 'small');
   const actions = el(el(row, 'td'), 'div', 'devices-row-actions');
   const reload = button(actions, 'Seite neu laden', 'refresh', () => void action('diagnostics_reload', {scope:'page',value:item.id}, reload, 'Neuladen für diese Seite vorgemerkt.'));
   button(actions, 'Logs', 'logs', () => openLogs({page_id:item.id}, (roles[item.role] || 'Browserseite') + ' · ' + item.path));
   return {row,name,path,version,tournamentName,location,badge,seen,reload};
  }
  function updateBrowsers() {
   const groups = new Map();for (const item of snapshot?.pages || []) {if (!groups.has(item.device_id)) groups.set(item.device_id, []);groups.get(item.device_id).push(item);}
   let visible = 0;
   for (const [id, items] of groups) {
    let group = browserGroups.get(id);if (!group) {group = createBrowserGroup(id);browserGroups.set(id, group);}
    const names = [...new Set(items.map(item => item.panel_client_id ? (tournament().displays || []).find(panel => String(panel.client_id) === item.panel_client_id)?.hostname || 'Gerät ' + item.panel_client_id : item.label || roles[item.role]))];
    text(group.name, names.join(' · '));const online = items.filter(item => item.online).length;
    status(group.badge, online + ' / ' + items.length + ' Seiten verbunden', !freshness ? 'is-stale' : online ? 'is-online' : 'is-offline');
    group.reload.disabled = !freshness || !online;
    const seen = new Set();let matching = 0;
    for (const item of items) {
     seen.add(item.id);let node = group.rows.get(item.id);if (!node) {node = createBrowserPage(group, item);group.rows.set(item.id, node);}
     text(node.name, (roles[item.role] || 'Browserseite') + (item.panel_client_id ? ' · Kennung ' + item.panel_client_id : ''));
     text(node.path, item.path);text(node.version, 'Version ' + (item.version || 'unbekannt') + ' · ' + (item.address || 'Adresse unbekannt'));
     text(node.tournamentName, item.tournament_key === tournament().key ? tournament().name || item.tournament_key : item.tournament_key || 'Serverweit');
     text(node.location, [item.court_id ? 'Feldzuordnung ' + item.court_id : '', item.match_id ? 'Spiel-ID ' + item.match_id : ''].filter(Boolean).join(' · '));
     status(node.badge, item.online ? 'Verbunden' : 'Getrennt', !freshness ? 'is-stale' : item.online ? 'is-online' : 'is-offline');text(node.seen, time(item.last_seen));
     node.reload.disabled = !freshness || !item.online;
     node.row.hidden = !matches([group.name.textContent,id,item.path,item.tournament_key,roles[item.role],item.panel_client_id,item.address].join(' '), item.online);if (!node.row.hidden) matching++;
    }
    for (const [id, node] of group.rows) if (!seen.has(id)) {node.row.remove();group.rows.delete(id);}
    group.details.hidden = !matching;if (matching) visible++;
   }
   for (const [id, group] of browserGroups) if (!groups.has(id)) {group.details.remove();browserGroups.delete(id);}
   emptyBrowsers.hidden = visible > 0;text(emptyBrowsers, !snapshot ? 'Browserseiten werden geladen …' : groups.size ? 'Keine Browserseiten passen zum Filter.' : 'Noch keine Browserdiagnose erfasst.');
  }
  async function action(type, fields, control, success) {
   if (control.disabled || busyControls.has(control)) return;busyControls.add(control);control.disabled = true;
   try {await rpc(type, fields);if (disposed) return;message(success);await refresh();}
   catch (error) {if (!disposed) message(error.message, true);}
   finally {busyControls.delete(control);if (!disposed) {control.disabled = !freshness;update();}}
  }
  async function bulkReload() {
   if (reloadGroup.disabled) return;
   const scope = reloadScope.value, value = scope === 'tournament' ? tournament().key : scope === 'role' ? reloadRole.value : '';
   const targets = (snapshot?.pages || []).filter(item => scope === 'all' || (scope === 'role' ? item.role : item.tournament_key) === value);
   if (!targets.length) {message('Für dieses Ziel sind keine Browserseiten erfasst.');return;}
   const approved = await btsDialogActions.confirm({owner:page,title:'Browserseiten neu laden',message:targets.length + ' Browserseiten werden zum Neuladen vorgemerkt. Laufende Spiele und ungespeicherte Eingaben verzögern das Neuladen automatisch.',confirmLabel:'Neuladen vormerken',cancelLabel:'Abbrechen'});
   if (approved && !disposed && freshness) await action('diagnostics_reload', {scope,value}, reloadGroup, 'Neuladeauftrag wurde vorgemerkt.');
  }
  async function removePanels(ids) {
   const eligible = () => (tournament().displays || []).filter(item => !item.online && (!ids || ids.includes(String(item.client_id))));
   const targets = [...new Set(eligible().map(item => String(item.client_id)))];if (!targets.length || pendingPanels.size || !freshness) return;
   const approved = await btsDialogActions.confirm({owner:page,title:'Getrennte Geräte entfernen',message:targets.length + ' getrennte Geräte werden aus der Liste und ihre Zuordnungen entfernt. Wenn sie sich erneut verbinden, erscheinen sie mit dem Standardprofil wieder.',confirmLabel:'Entfernen',cancelLabel:'Abbrechen',danger:true});
   if (!approved || disposed || !freshness) return;
   for (const id of targets) pendingPanels.add(id);update();let count = 0;
   try {
    for (const id of targets) {
     if (disposed) break;if (!eligible().some(item => String(item.client_id) === id)) continue;
     await rpc('display_delete', {display_client_id:id});if (disposed) break;
     tournament().displays = (tournament().displays || []).filter(item => String(item.client_id) !== id);count++;
    }
    if (!disposed) message(count + ' Geräte entfernt.');
   } catch (error) {if (!disposed) message(count + ' Geräte entfernt. Weitere Geräte konnten nicht entfernt werden: ' + error.message, true);}
   finally {for (const id of targets) pendingPanels.delete(id);if (!disposed) update();}
  }
  function updateCommands() {
   const seen = new Set();
   for (const command of snapshot?.commands || []) {
    seen.add(command.id);let node = commandRows.get(command.id);
    if (!node) {
     const details = el(commandList, 'details', 'devices-command'), summary = el(details, 'summary'), title = el(summary, 'strong'), state = el(summary, 'span'), content = el(details, 'div', 'devices-command-content');
     const cancel = button(content, 'Ausstehende abbrechen', 'close', () => void action('diagnostics_cancel', {id:command.id}, cancel, 'Ausstehendes Neuladen abgebrochen.'));
     node = {details,title,state,cancel,list:el(content, 'ul'),signature:''};commandRows.set(command.id, node);
    }
    const targets = command.targets || [], pending = targets.some(item => ['scheduled','waiting'].includes(item.state));
    text(node.title, time(command.at) + ' · ' + ({page:'Einzelne Seite',device:'Gerät',role:'Oberfläche',tournament:'Turnier',all:'Alle Seiten'}[command.scope] || command.scope));
    text(node.state, targets.length + ' Seiten · ' + targets.filter(item => item.state === 'reconnected').length + ' wieder verbunden');
    node.cancel.hidden = !pending;node.cancel.disabled = !freshness;
    const signature = JSON.stringify(targets);if (signature !== node.signature) {
     node.list.replaceChildren();for (const item of targets) el(node.list, 'li', '', [item.path, states[item.state] || item.state, item.reason, item.version ? 'Version ' + item.version : ''].filter(Boolean).join(' · '));node.signature = signature;
    }
   }
   for (const [id, node] of commandRows) if (!seen.has(id)) {node.details.remove();commandRows.delete(id);}
   emptyCommands.hidden = seen.size > 0;reloadGroup.disabled = !freshness;
  }
  function update() {if (disposed) return;updatePanels();updateBrowsers();updateCommands();for (const control of busyControls) control.disabled = true;}
  function logFilter() {
   return {source:logSource.value,level:logLevel.value,search:logSearch.value.slice(0,200),tournament_key:logTournament.value,...logTarget?.filter,
    since:since.value ? new Date(since.value).getTime() : null,until:until.value ? new Date(until.value).getTime() : null};
  }
  function resetLogs() {logGeneration++;cursor = 0;logLimit = 50;moreLogs = false;logRows.clear();logList.replaceChildren();updateLogPages();emptyLogs.hidden = false;text(emptyLogs, paused ? 'Live-Ansicht pausiert.' : 'Logs werden geladen …');text(logSummary, paused ? 'Live-Ansicht fortsetzen, um den Filter anzuwenden.' : 'Filter wird angewendet …');void refresh();}
  function openLogs(filter, title) {logTarget = {filter,title};text(targetLabel, 'Logs für ' + title);targetBar.hidden = false;logTournament.value = '';resetLogs();onSelect('logs');}
  function updateLogPages() {
   logPages.hidden = !moreLogs;loadOlder.disabled = loadingOlder || polling || exporting || !freshness;
   text(loadOlder.querySelector('span'), loadingOlder ? 'Ältere Meldungen werden geladen …' : 'Weitere 50 laden');
  }
  async function loadOlderLogs() {
   if (disposed || loadingOlder || polling || exporting || !freshness || !moreLogs || !logRows.size) return;
   const generation = logGeneration, before = Math.min(...[...logRows.values()].map(node => node.revision));
   loadingOlder = true;updateLogPages();
   try {
    const result = await logQuery({...logFilter(),before_revision:before,limit:50});
    if (!disposed && generation === logGeneration) {logLimit += 50;renderLogs(result, true);}
   } catch (error) {if (!disposed && generation === logGeneration) {text(logError, 'Ältere Meldungen konnten nicht geladen werden: ' + error.message);logError.hidden = false;}}
   finally {loadingOlder = false;if (!disposed) {updateLogPages();if (generation !== logGeneration && !paused) void refresh();}}
  }
  async function currentLogs(filter, generation) {
   const first = await logQuery({...filter,cursor,limit:Math.min(logLimit,200)}), items = [...first.items];let before = first.next_before;
   // A burst may contain more changes than fit in one bounded response. Fill
   // the chosen window before advancing its live cursor, including after the
   // user has loaded several history pages. Keep the first snapshot's cursor
   // so changes arriving during pagination are still fetched next time.
   while (before != null && items.length < logLimit && !disposed && generation === logGeneration && !paused && selected === 'logs') {
    const page = await logQuery({...filter,cursor,before_revision:before,limit:Math.min(logLimit - items.length,200)});
    items.push(...page.items);before = page.next_before;
   }
   return {...first,items,next_before:before,truncated:before != null};
  }
  function renderLogs(value, older = false) {
   if (!older) cursor = value.cursor;
   for (const item of value.items) {
    let node = logRows.get(item.id);
    if (node && node.revision > item.revision) continue;
    if (!node) {
     const row = el(logList, 'li'), details = el(row, 'details'), summary = el(details, 'summary'), severity = el(summary, 'span'), timestamp = el(summary, 'time'), source = el(summary, 'span', 'devices-log-source'), title = el(summary, 'strong');
     const body = el(details, 'div', 'devices-log-body'), context = el(body, 'p'), message = el(body, 'pre');
     node = {row,details,severity,timestamp,source,title,context,message};logRows.set(item.id, node);
    }
    node.revision = item.revision;
    text(node.severity, levels[item.level] || item.level);node.severity.className = 'devices-severity is-' + item.level;
    text(node.timestamp, time(item.updated_at));node.timestamp.dateTime = new Date(item.updated_at).toISOString();
    text(node.source, (sources[item.source] || item.source) + (item.count > 1 ? ' · ' + item.count + '×' : ''));
    text(node.title, item.message.split('\n')[0].slice(0,230));text(node.message, item.message);
    text(node.context, [item.path,item.device_id ? 'Gerät ' + item.device_id : '',item.tournament_key,item.match_id ? 'Spiel-ID ' + item.match_id : '',item.court_id ? 'Feld ' + item.court_id : '',item.trace_id ? 'Vorgang ' + item.trace_id : '',item.version ? 'Version ' + item.version : '',item.client_ts ? 'Clientzeit ' + time(item.client_ts) : ''].filter(Boolean).join(' · '));
   }
   const sorted = [...logRows.entries()].sort(([,a],[,b]) => b.revision - a.revision);let previous = null;
   for (const [,node] of sorted.slice(0,logLimit)) {const next = previous ? previous.nextSibling : logList.firstChild;if (next !== node.row) logList.insertBefore(node.row,next);previous = node.row;}
   for (const [id,node] of sorted.slice(logLimit)) {node.row.remove();logRows.delete(id);}
   const matching = value.matching_total ?? value.total;
   moreLogs = matching > logRows.size && (!older || value.items.length > 0);updateLogPages();
   text(logSummary, logRows.size + ' von ' + matching + ' passenden Meldungen angezeigt · ' + value.retained + ' gespeichert' + (value.dropped ? ' · ' + value.dropped + ' Meldungen verworfen' : ''));
   emptyLogs.hidden = logRows.size > 0;text(emptyLogs, 'Keine passenden Meldungen.');
   text(logError, value.write_error ? 'Logspeicherung: ' + value.write_error : '');logError.hidden = !value.write_error;
  }
  async function exportLogs() {
   if (exporting) return;exporting = true;exportButton.disabled = true;updateLogPages();const filter = logFilter();
   try {
    const first = await logQuery({...filter,export:true}), items = [...first.items];let result = first;
    while (!disposed && result.next_offset != null) {result = await logQuery({export_id:first.export_id,export_offset:result.next_offset});items.push(...result.items);}
    if (disposed) return;
    const blob = new Blob([JSON.stringify({exported_at:new Date().toISOString(),filters:filter,cursor:first.cursor,total:first.total,items},null,2)], {type:'application/json'});
    const href = URL.createObjectURL(blob), anchor = doc.createElement('a');anchor.href = href;anchor.download = 'bts-diagnose-' + new Date().toISOString().replace(/[:.]/g,'-') + '.json';anchor.click();setTimeout(() => URL.revokeObjectURL(href),1000);
    message(items.length + ' Meldungen exportiert.');
   } catch (error) {if (!disposed) message('Export fehlgeschlagen: ' + error.message,true);}
   finally {exporting = false;if (!disposed) {exportButton.disabled = !freshness;updateLogPages();}}
  }
  async function refresh() {
   if (disposed || doc.hidden) return;
   if (polling) {refreshAgain = true;return;}polling = true;refreshButton.disabled = true;updateLogPages();
   const generation = logGeneration, wantsLogs = selected === 'logs' && !paused && !exporting && !loadingOlder;
   try {
    const response = await rpc('diagnostics_snapshot');if (disposed) return;
    if (!response.diagnostics) throw new Error('Keine Verbindungsdaten erhalten.');snapshot = response.diagnostics;freshness = true;refreshed = true;
    status(live, 'Live · Stand ' + time(snapshot.now || Date.now()), 'is-online');issue.hidden = !snapshot.store?.error;text(issue, snapshot.store?.error ? 'Logspeicherung: ' + snapshot.store.error : '');
    if (!busyControls.has(verbose)) verbose.checked = snapshot.verbose_until > Date.now();
    verbose.disabled = busyControls.has(verbose);exportButton.disabled = exporting;
    update();
    if (wantsLogs && !paused && !exporting && !loadingOlder && selected === 'logs' && generation === logGeneration) try {
     const result = await currentLogs(logFilter(), generation);if (!disposed && !paused && selected === 'logs' && generation === logGeneration) renderLogs(result);
    } catch (error) {if (!disposed && generation === logGeneration) {text(logError,'Logs derzeit nicht verfügbar: ' + error.message);logError.hidden = false;}}
   } catch (error) {
    if (!disposed) {freshness = false;status(live, refreshed ? 'Verbindung unterbrochen · Stand veraltet' : 'Verbindung nicht verfügbar','is-offline');text(issue,error.message);issue.hidden = false;verbose.disabled = true;exportButton.disabled = true;update();}
   } finally {
    polling = false;if (!disposed) {refreshButton.disabled = false;updateLogPages();if (refreshAgain) {refreshAgain = false;void refresh();}}
   }
  }
  function show(id) {
   const next = id === 'logs' ? 'logs' : 'devices', changed = selected !== next;selected = next;
   for (const [id, tab] of tabNodes) {tab.setAttribute('aria-selected',String(id === next));tab.tabIndex = id === next ? 0 : -1;panels.get(id).hidden = id !== next;}
   if (changed) void refresh();
  }
  function dispose() {
   if (disposed) return;disposed = true;lifetime.abort();observer.disconnect();clearInterval(timer);clearTimeout(searchTimer);
   for (const entry of requests) {clearTimeout(entry.timer);entry.reject(new Error('Ansicht wurde geschlossen'));}requests.clear();
   page.remove();onDispose?.();
  }
  const observer = new MutationObserver(() => {if (!page.isConnected) dispose();});observer.observe(owner, {childList:true});if (owner.parentNode) observer.observe(owner.parentNode, {childList:true});
  const timer = setInterval(() => {void refresh();},2000);
  doc.addEventListener('visibilitychange', () => {if (!doc.hidden) void refresh();}, {signal});
  show(section);update();
  return {page,tournamentKey:tournament().key,show,selected:() => selected,update,refresh,dispose};
 }
 return {create};
})();
