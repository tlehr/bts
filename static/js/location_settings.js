/* global btsSettingsWorkspace, ci18n, cleitstand, btsChoicePicker */
'use strict';

// Keep each hall, field and draft mounted across live snapshots and navigation.
// eslint-disable-next-line no-unused-vars -- Used by the classic tournament script.
var btsLocationSettings = (() => {
 function mount(parent, {tournament, send}) {
  const doc = parent.ownerDocument, locations = new Map(), courts = new Map(), groups = new Map();
  const fields = ['highlight', 'preparation_addition', 'meetingpoint_announcement'];
  const valueOf = (location, field) => field === 'highlight' ? Number(location[field]) || 0 : location[field] || '';
  function el(owner, tag, className, value) {
   const node = doc.createElement(tag);node.className = className || '';
   if (value != null) node.textContent = value;owner.append(node);return node;
  }
  const text = (node, value) => {if (node.textContent !== String(value)) node.textContent = value;};
  const show = (node, visible) => {if (node.hidden === visible) node.hidden = !visible;};
  const attr = (node, name, value) => {if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value);};
  function order(owner, nodes) {
   nodes.forEach((node, index) => {if (owner.children[index] !== node) owner.insertBefore(node, owner.children[index] || null);});
  }
  function link(owner, target, label) {
   const node = el(owner, 'a', 'settings-location-link', label);node.dataset.settingsTarget = target;
   node.href = '/admin/t/' + encodeURIComponent(tournament().key) + '/edit/' + target;return node;
  }
  function status(owner, retryLabel, onRetry) {
   const root = el(owner, 'div', 'settings-location-status');root.setAttribute('role', 'status');
   const message = el(root, 'span'), retry = el(root, 'button', 'btn', retryLabel);retry.type = 'button';
   retry.addEventListener('click', onRetry);show(root, false);
   return (error) => {text(message, error || '');show(root, !!error);};
  }
  const halls = el(parent, 'div', 'locations_div');
  const empty = btsSettingsWorkspace.card(halls, {title:'Spielorte', description:'Darstellung und Durchsagentexte je Spielort.'});
  el(empty, 'p', 'settings-location-hint', 'Noch keine Spielorte vorhanden. Spielorte und Felder werden aus den Turnierdaten übernommen.');
  const emptyCard = empty.parentElement;
  const courtBody = btsSettingsWorkspace.card(parent, {title:'Felder', description:'Verfügbarkeit und Plätze für technische Offizielle je Feld.', badge:'0'});
  courtBody.parentElement.classList.add('settings-courts-card');
  const courtCount = courtBody.parentElement.querySelector('.settings-card-badge');
  const hint = el(courtBody, 'p', 'settings-location-hint');
  link(courtBody, 'officials', 'Tabletbedienung & Offizielle einstellen →');
  const noCourts = el(courtBody, 'p', 'settings-location-empty', 'Noch keine Felder vorhanden.');
  const table = el(courtBody, 'table', 'courts_table settings-courts-table');
  const header = el(el(table, 'thead'), 'tr');
  for (const label of ['Feld', 'Aktiv', 'Schiedsrichter', 'Aufschlagrichter']) el(header, 'th', '', label).scope = 'col';

  function read(entry) {return Object.fromEntries(fields.map(field => [field, field === 'highlight' ? Number(entry.inputs[field].value) : entry.inputs[field].value]));}
  function saveLocation(entry) {
   if (!parent.isConnected || !entry.root.isConnected) return;
   if (entry.pending) {entry.queued = true;return;}
   const values = read(entry), before = {...entry.confirmed};
   if (fields.every(field => values[field] === before[field])) return;
   entry.pending = values;entry.queued = false;entry.error('');
   send({type:'location_changed', tournament_key:tournament().key, location_id:entry.id, ...values}, error => {
    entry.pending = null;
    if (!entry.root.isConnected) return;
    if (error) {entry.queued = false;entry.error('Änderungen konnten nicht gespeichert werden. Dein Entwurf bleibt erhalten.');return;}
    const current = tournament().locations.find(location => String(location._id) === entry.id);
    if (current) for (const field of fields) {
     // A later external change must not be overwritten by an older reply.
     if (valueOf(current, field) === before[field] || valueOf(current, field) === values[field]) current[field] = values[field];
    }
    update();
    if (entry.queued) saveLocation(entry);
   });
  }
  function upload(entry) {
   const file = entry.file.files[0];if (!file || entry.uploading || !entry.root.isConnected) return;
   entry.uploading = true;entry.file.disabled = true;entry.uploadError('');
   const finish = error => {
    entry.uploading = false;if (!entry.root.isConnected) return;
    entry.file.disabled = false;
    entry.uploadError(error ? 'Das Icon konnte nicht hochgeladen werden. Bitte erneut versuchen.' : '');
    if (!error) entry.file.value = '';
   };
   const reader = new FileReader();
   reader.onerror = () => finish(true);
   reader.onload = () => {
    if (!entry.root.isConnected) return;
    send({type:'tournament_upload_location_logo', tournament_key:tournament().key, location_id:entry.id, name:file.name, data_url:reader.result}, finish);
   };
   reader.readAsDataURL(file);
  }
  function createLocation(id) {
   const body = btsSettingsWorkspace.card(halls, {title:'', description:'Darstellung und Durchsagentexte für diesen Spielort.', badge:'0'});
   const root = body.parentElement;root.classList.add('settings-location-card');root.dataset.locationId = id;
   const heading = root.querySelector('h2'), mark = el(root.querySelector('.settings-card-heading'), 'span', 'settings-location-mark');mark.setAttribute('aria-hidden', 'true');
   root.querySelector('.settings-card-heading').prepend(mark);
   const entry = {id, root, heading, mark, count:root.querySelector('.settings-card-badge'), inputs:{}, confirmed:{}};
   const color = btsSettingsWorkspace.field(body, {label:'Kennfarbe', description:'Kennzeichnet den Spielort in den Spielübersichten.', tag:'select', attributes:{name:'highlight'}});
   for (const [index, name] of ['Nicht festgelegt', 'Gelb', 'Rosa', 'Orange', 'Blau', 'Grün', 'Violett'].entries()) el(color, 'option', '', name).value = index;
   entry.inputs.highlight = color;color.dataset.locationId = id;
   entry.colorPicker = btsChoicePicker.create(color, {icon:cleitstand.icon, renderSymbol:(node, option) => {
    const value = String(Number(option?.value) || 0);if (node.dataset.color === value) return;
    node.dataset.color = value;node.replaceChildren();
    el(node, 'span', 'settings-color-swatch highlight_' + value).setAttribute('aria-hidden', 'true');
   }});
   color.parentElement.classList.add('settings-location-color');
   doc.getElementById(color.parentElement.querySelector('.ls-choice-trigger').getAttribute('aria-controls')).classList.add('settings-color-options');
   const file = btsSettingsWorkspace.field(body, {label:'Symbol für Vorbereitungsaufrufe', description:'Aufrufknopf in der Turnierleitung. Ohne eigenes Bild: Mikrofon mit Halleninitialen.', attributes:{type:'file', accept:'image/png,image/jpeg,image/gif,image/webp'}});
   const controls = file.parentElement;controls.classList.add('settings-location-icon');
   const symbol = el(controls, 'span', 'settings-location-symbol');symbol.setAttribute('role', 'img');controls.prepend(symbol);
   const fileWrap = el(controls, 'div');fileWrap.append(file);entry.filename = el(fileWrap, 'span', 'upload_filename_location');
   entry.file = file;entry.symbol = symbol;file.addEventListener('change', () => upload(entry));
   entry.uploadError = status(fileWrap, 'Erneut hochladen', () => upload(entry));
   for (const [field, label, description] of [
    ['preparation_addition', 'Ergänzung zum Vorbereitungsaufruf', 'Wird an „In Vorbereitung“ angehängt. Leer lassen für die Standarddurchsage.'],
    ['meetingpoint_announcement', 'Meetingpoint-Durchsage', 'Treffpunkt für Spieler, Tabletbediener und Offizielle. Leer lassen für den Standardtext.'],
   ]) {
    const input = btsSettingsWorkspace.field(body, {label, description, tag:'textarea', attributes:{name:field, maxlength:175, rows:2, placeholder:'Optional: {Einzahl/Mehrzahl}'}});
    input.dataset.locationId = id;entry.inputs[field] = input;
    input.addEventListener('input', () => preview(entry));input.addEventListener('blur', () => saveLocation(entry));
   }
   color.addEventListener('change', () => {paint(entry, Number(color.value));update();saveLocation(entry);});
   entry.meetingRow = entry.inputs.meetingpoint_announcement.closest('.settings-row');
   entry.meetingHint = el(entry.meetingRow.querySelector('.settings-row-info'), 'p', 'settings-field-description');
   link(entry.meetingHint, 'calls', 'Meetingpoint unter Aufrufe aktivieren →');
   el(body, 'p', 'settings-location-hint', 'Mit {Einzahl/Mehrzahl} passt sich die Ansage an einzelne Personen und Doppelpaare an.');
   entry.error = status(body, 'Erneut speichern', () => saveLocation(entry));
   const details = el(body, 'details', 'settings-location-preview');
   el(details, 'summary', '', 'Durchsagenvorschau');
   entry.preview = el(details, 'div', 'settings-location-preview-messages');
   locations.set(id, entry);return entry;
  }
  function paint(entry, value) {attr(entry.mark, 'class', 'settings-location-mark highlight_' + value);}
  function preview(entry) {
   const current = tournament(), values = read(entry), enabled = !!current.preparation_meetingpoint_enabled;
   const key = JSON.stringify([values.preparation_addition, values.meetingpoint_announcement, enabled, current.language]);
   if (entry.previewKey === key) return;entry.previewKey = key;
   const resolve = (value, plural) => value.replace(/\{([^{}/]*)\/([^{}]*)\}/g, (_, one, many) => plural ? many : one).trim();
   const preparation = plural => [ci18n('announcements:preparation'), resolve(values.preparation_addition, plural)].filter(Boolean).join(' ');
   const meeting = plural => resolve(values.meetingpoint_announcement, plural) || ci18n('announcements:meetingpoint');
   // Match the existing announcement wording, including singular/plural variants.
   const secondPlayer = (name, plural) => ci18n('announcements:second_call') + ' ' + ci18n('announcements:preparation') + ' ' + ci18n('announcements:second_call_for') + ':' + name + (resolve(values.preparation_addition, plural) ? ' ' + resolve(values.preparation_addition, plural) : '') + '!';
   const rows = [['Erster Vorbereitungsaufruf', [preparation(true) + ' [für Feld 1!] Max Mustermann gegen Erika Beispiel! ' + (enabled ? meeting(true) : preparation(true))]],
    ['Zweiter Aufruf Spieler', [['Max Mustermann', false], ['Max Mustermann / Erika Beispiel', true]].map(([name, plural]) => secondPlayer(name, plural) + (enabled ? ' ' + name + ' ' + meeting(plural) : ''))]];
   if (enabled) {
    rows.push(['Zweiter Aufruf Schiedsrichter / Service Judge', [ci18n('announcements:second_call') + ' ' + ci18n('announcements:preparation') + ' ' + ci18n('announcements:second_call_for') + ':Schiedsrichter Max! Schiedsrichter Max ' + meeting(false)]]);
    rows.push(['Zweiter Aufruf Tabletbediener', [['Tabletbediener Max', false], ['Tabletbediener Max / Tabletbediener Erika', true]].map(([name, plural]) => {
     const destination = meeting(plural).replace('bitte meldet euch ', '').replace('Bitte meldet euch ', '').replace('!', '');
     return ci18n('announcements:second_call') + ' ' + ci18n('announcements:preparation') + ' ' + ci18n('announcements:second_call_for') + ':' + name + '! ' + name + ', ' + ci18n('announcements:please_as_tablet_service') + ' ' + destination + 'melden!';
    })]);
   }
   entry.preview.replaceChildren();
   for (const [label, messages] of rows) {
    const item = el(entry.preview, 'div');el(item, 'h3', '', label);
    for (const message of messages) el(item, 'p', '', message);
   }
  }
  function createGroup(id) {
   const body = el(table, 'tbody');body.dataset.courtLocation = id;
   const heading = el(body, 'tr', 'settings-court-location'), cell = el(heading, 'th');cell.colSpan = 4;cell.scope = 'rowgroup';
   const mark = el(cell, 'span', 'settings-location-mark');mark.setAttribute('aria-hidden', 'true');
   const name = el(cell, 'span'), count = el(cell, 'span', 'settings-court-location-count');
   const group = {body, heading, mark, name, count};groups.set(id, group);return group;
  }
  function saveCourt(entry, field, value) {
   const court = tournament().courts.find(item => String(item._id) === entry.id);if (!court || entry.pending) return;
   const before = court[field];entry.pending = true;court[field] = value;entry.error('');update();
   send({type:'court_edit', tournament_key:tournament().key, court_id:entry.id, [field]:value}, error => {
    entry.pending = false;if (!entry.row.isConnected) return;
    const current = tournament().courts.find(item => String(item._id) === entry.id);
    if (error && current?.[field] === value) current[field] = before;
    update();
    if (error) entry.error('Änderung nicht gespeichert. Bitte erneut schalten.');
   });
  }
  function createCourt(id, group) {
   const row = el(group.body, 'tr');row.dataset.courtId = id;
   const title = el(row, 'th');title.scope = 'row';const name = el(title, 'span');
   const error = el(title, 'span', 'settings-court-error');error.setAttribute('role', 'status');
   const entry = {id, row, name, controls:{}, error:message => text(error, message)};
   for (const [field, inputName, label] of [['is_active', 'active_cb', 'Aktiv'], ['has_umpire', 'umpire_cb', 'Schiedsrichter'], ['has_service_judge', 'service_judge_cb', 'Aufschlagrichter']]) {
    const cell = el(row, 'td');el(cell, 'span', 'settings-court-mobile-label', label).setAttribute('aria-hidden', 'true');
    const input = el(el(cell, 'div', 'settings-row-control'), 'input');input.type = 'checkbox';input.name = inputName;input.dataset.courtId = id;input.setAttribute('role', 'switch');
    input.addEventListener('change', () => saveCourt(entry, field, input.checked));entry.controls[field] = input;
   }
   courts.set(id, entry);return entry;
  }
  function update() {
   const current = tournament(), source = current.locations || [], fieldSource = current.courts || [];
   const locationKeys = new Set(), locationNodes = [];show(emptyCard, !source.length);
   for (const location of source) {
    const id = String(location._id);locationKeys.add(id);const entry = locations.get(id) || createLocation(id);
    text(entry.heading, location.name || id);
    const count = fieldSource.filter(court => String(court.location_id) === id).length;text(entry.count, count + (count === 1 ? ' Feld' : ' Felder'));
    for (const field of fields) {
     const next = valueOf(location, field), input = entry.inputs[field];
     if (entry.confirmed[field] == null || String(input.value) === String(entry.confirmed[field])) {
      if (String(input.value) !== String(next)) input.value = next;
     }
     entry.confirmed[field] = next;
    }
    paint(entry, Number(entry.inputs.highlight.value));
    cleitstand.preparationIcon(entry.symbol, location, current.key);
    attr(entry.symbol, 'aria-label', 'Vorbereitungsaufruf für ' + (location.name || id));
    text(entry.filename, location.logo_id ? location.logo_name || 'Eigenes Icon' : 'Mikrofon mit Halleninitialen');
    attr(entry.meetingRow, 'data-setting-state', current.preparation_meetingpoint_enabled ? 'active' : 'inactive');
    show(entry.meetingHint, !current.preparation_meetingpoint_enabled);preview(entry);locationNodes.push(entry.root);
   }
   for (const [id, entry] of locations) if (!locationKeys.has(id)) {entry.colorPicker.destroy();entry.root.remove();locations.delete(id);}
   locationNodes.push(emptyCard);order(halls, locationNodes);
   for (const entry of locations.values()) {
    for (const option of entry.inputs.highlight.options) {
     const used = Number(option.value) !== 0 && source.some(location => String(location._id) !== entry.id && Number(locations.get(String(location._id))?.inputs.highlight.value ?? location.highlight) === Number(option.value));
     const disabled = option.value === '0' || (used && option.value !== entry.inputs.highlight.value);if (option.disabled !== disabled) option.disabled = disabled;
    }
    entry.colorPicker.refresh();
   }
   const active = fieldSource.filter(court => court.is_active !== false).length;
   text(courtCount, active + ' von ' + fieldSource.length + ' aktiv');show(noCourts, !fieldSource.length);show(table, !!fieldSource.length);
   const mode = current.official_rotation_mode || 'umpire_and_service_judge';
   text(hint, (mode === 'disabled' ? 'Die Rotation der technischen Offiziellen ist ausgeschaltet. ' : mode === 'umpire_only' ? 'Aktuell werden nur Schiedsrichter rotiert. ' : '') + 'Grau dargestellte Plätze werden aktuell nicht genutzt. Ihre Einstellungen bleiben gespeichert und bearbeitbar.');
   const grouped = new Map(source.map(location => [String(location._id), []]));
   for (const court of fieldSource) {const id = String(court.location_id || '');if (!grouped.has(id)) grouped.set(id, []);grouped.get(id).push(court);}
   const courtKeys = new Set(), groupKeys = new Set(), groupNodes = [table.tHead];
   for (const [id, items] of grouped) {
    if (!items.length) continue;groupKeys.add(id);
    const group = groups.get(id) || createGroup(id), location = source.find(item => String(item._id) === id);
    text(group.name, location?.name || 'Spielort nicht verfügbar');text(group.count, items.length + (items.length === 1 ? ' Feld' : ' Felder'));
    attr(group.mark, 'class', 'settings-location-mark highlight_' + (Number(location?.highlight) || 0));
    const rows = [group.heading];
    for (const court of items) {
     const courtId = String(court._id);courtKeys.add(courtId);const entry = courts.get(courtId) || createCourt(courtId, group);
     text(entry.name, 'Feld ' + court.num);
     for (const [field, input] of Object.entries(entry.controls)) {
      const checked = court[field] !== false;if (input.checked !== checked) input.checked = checked;
      if (input.disabled !== !!entry.pending) input.disabled = !!entry.pending;
      const inactive = field !== 'is_active' && (court.is_active === false || mode === 'disabled' || (field === 'has_service_judge' && (mode === 'umpire_only' || court.has_umpire === false)));
      attr(input.parentElement, 'data-setting-state', inactive ? 'inactive' : 'active');
      attr(input, 'aria-label', input.parentElement.parentElement.querySelector('.settings-court-mobile-label').textContent + ' · Feld ' + court.num + ' · ' + (location?.name || 'Spielort nicht verfügbar'));
     }
     rows.push(entry.row);
    }
    order(group.body, rows);groupNodes.push(group.body);
   }
   for (const [id, entry] of courts) if (!courtKeys.has(id)) {entry.row.remove();courts.delete(id);}
   for (const [id, group] of groups) if (!groupKeys.has(id)) {group.body.remove();groups.delete(id);}
   order(table, groupNodes);
  }
  return {update, destroy:() => {for (const entry of locations.values()) entry.colorPicker.destroy();}};
 }
 return {mount};
})();
