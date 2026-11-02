/* global ccsvexport */
'use strict';

// Presentation and local selection state; export data and settings stay with the workspace.
// eslint-disable-next-line no-unused-vars -- Called by the classic tournament script.
var btsCertificateSelection = (() => {
 let sequence = 0;
 function create({owner, getOptions, getRows, getMaxPlace, getMarkers, getSplits, onSplit, onReset, onChange, defaultDate}) {
  const doc = owner.ownerDocument, prefix = 'certificate-selection-' + (++sequence);
  let entries = new Map(), initialized = false, resetReason = '';
  function el(parent, tag, className = '', value) {
   const node = doc.createElement(tag);node.className = className;
   if (value != null) node.textContent = value;parent.append(node);return node;
  }
  function text(node, value) {if (node.textContent !== value) node.textContent = value;}
  function button(parent, label, className = '') {const node = el(parent, 'button', className, label);node.type = 'button';return node;}
  function icon(parent, path) {
   const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');svg.setAttribute('class', 'ico');svg.setAttribute('viewBox', '0 0 24 24');svg.setAttribute('aria-hidden', 'true');
   const shape = doc.createElementNS('http://www.w3.org/2000/svg', 'path');shape.setAttribute('d', path);svg.append(shape);parent.append(svg);
  }
  function menu(parent, label) {
   const node = el(parent, 'details', 'certificate-actions-menu'), trigger = el(node, 'summary');trigger.setAttribute('aria-label', label);trigger.title = label;
   icon(trigger, 'M5 12h.01M12 12h.01M19 12h.01');
   const content = el(node, 'div', 'certificate-menu-content');
   node.addEventListener('keydown', event => {if (event.key === 'Escape' && node.open) {event.preventDefault();event.stopPropagation();node.open = false;trigger.focus({preventScroll: true});}});
   node.addEventListener('toggle', () => {if (node.open) for (const other of owner.querySelectorAll('.certificate-actions-menu[open]')) if (other !== node) other.open = false;});
   return {node, trigger, content};
  }
  function resetButton(actions, key, label) {
   const control = button(actions.content, key ? 'Exportstatus zurücksetzen' : 'Exportstatus aller Disziplinen zurücksetzen', 'certificate-export-reset');
   control.setAttribute('aria-label', key ? 'Exportstatus für ' + label + ' zurücksetzen' : 'Exportstatus aller Disziplinen zurücksetzen');
   icon(control, 'M20 9a8 8 0 0 0-14-5L3 7M3 2v5h5M4 15a8 8 0 0 0 14 5l3-3M21 22v-5h-5');
   control.addEventListener('click', () => {actions.node.open = false;actions.trigger.focus({preventScroll: true});onReset(key, label);});
   return control;
  }
  function formatDate(value, withTime = false) {
   if (!value) return '—';const date = new Date(value);
   if (Number.isNaN(date.getTime())) return String(value);
   return date.toLocaleString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? {hour: '2-digit', minute: '2-digit'} : {})});
  }
  function placeRanges(places) {
   const ranges = [];
   for (const place of places) {
    const last = ranges.at(-1);if (last && last[1] + 1 === place) last[1] = place;else ranges.push([place, place]);
   }
   return ranges.map(([first, last]) => first === last ? String(first) : first + '–' + last).join(', ');
  }
  const heading = el(owner, 'div', 'certificate-selection-heading');el(heading, 'h2', '', 'Disziplinen');
  const allMenu = menu(heading, 'Weitere Aktionen für alle Disziplinen'), resetAll = resetButton(allMenu);
  const note = el(owner, 'p', 'certificate-selection-note', '„Bereit“ bezieht sich auf die gewünschten Urkundenplätze, nicht auf den Abschluss aller Spiele.');
  note.id = prefix + '-note';
  const filters = el(owner, 'div', 'certificate-filters');filters.setAttribute('role', 'group');filters.setAttribute('aria-label', 'Disziplinen filtern');
  function select(label, name, choices, initial) {
   const wrapper = el(filters, 'label');el(wrapper, 'span', '', label);const control = el(wrapper, 'select');control.name = name;
   for (const [value, caption] of choices) {const option = el(control, 'option', '', caption);option.value = value;}
   control.value = initial;control.addEventListener('change', applyFilters);return control;
  }
  const kind = select('Typ', 'certificate_kind_filter', [['all', 'Einzel und Doppel'], ['single', 'Einzel'], ['double', 'Doppel']], 'all');
  const ready = select('Platzierungen', 'certificate_ready_filter', [['all', 'Alle'], ['ready', 'Bereit'], ['open', 'Noch offen']], 'ready');
  const exported = select('Exportstatus', 'certificate_export_filter', [['all', 'Alle'], ['new', 'Noch nicht exportiert'], ['exported', 'Bereits exportiert']], 'new');
  const dateFilter = el(filters, 'div', 'certificate-date-filter');
  const dateLabel = el(dateFilter, 'label', 'certificate-date-filter-toggle');
  const dateEnabled = el(dateLabel, 'input');dateEnabled.type = 'checkbox';dateEnabled.name = 'certificate_date_filter_enabled';
  el(dateLabel, 'span', '', 'Nach Datum filtern');dateEnabled.addEventListener('change', applyFilters);
  const date = el(dateFilter, 'input');date.type = 'date';date.name = 'certificate_date_filter';date.value = defaultDate;date.disabled = true;
  date.setAttribute('aria-label', 'Letztes geplantes Spiel am');date.addEventListener('change', applyFilters);
  const clearFilters = button(filters, 'Filter zurücksetzen', 'certificate-clear-filters');
  clearFilters.addEventListener('click', () => {kind.value = ready.value = exported.value = 'all';dateEnabled.checked = false;date.value = defaultDate;applyFilters();});
  const toolbar = el(owner, 'div', 'certificate-selection-toolbar');
  const counts = el(toolbar, 'p', 'certificate-selection-summary');
  const selectionActions = el(toolbar, 'div', 'certificate-selection-actions');
  const selectVisible = button(selectionActions, 'Sichtbare auswählen'), clearSelection = button(selectionActions, 'Auswahl aufheben');
  selectVisible.addEventListener('click', () => {for (const entry of entries.values()) if (!entry.row.hidden) entry.checkbox.checked = true;changed();});
  clearSelection.addEventListener('click', () => {for (const entry of entries.values()) entry.checkbox.checked = false;changed();});
  clearSelection.title = 'Die Auswahl aller Disziplinen aufheben, einschließlich ausgeblendeter Disziplinen.';
  const empty = el(owner, 'p', 'certificate-empty');
  const table = el(owner, 'table', 'certificate-event-table');table.setAttribute('aria-label', 'Disziplinen für Urkunden auswählen');table.setAttribute('aria-describedby', note.id);
  // Explicit roles preserve table semantics when mobile rows use a grid layout.
  table.setAttribute('role', 'table');
  const head = el(table, 'thead'), headRow = el(head, 'tr');headRow.setAttribute('role', 'row');
  for (const label of ['Auswahl', 'Disziplin', 'Platzierungen', 'Starter', 'Letztes geplantes Spiel', 'Export', 'Aktionen']) {
   const cell = el(headRow, 'th', '', label);cell.scope = 'col';cell.setAttribute('role', 'columnheader');
  }
  const body = el(table, 'tbody');
  function selectedKeys() {return new Set([...entries.values()].filter(entry => entry.checkbox.checked).map(entry => entry.key));}
  function summary() {
   const selected = [...entries.values()].filter(entry => entry.checkbox.checked), hidden = selected.filter(entry => entry.row.hidden).length;
   return selected.length + ' von ' + entries.size + ' Disziplinen ausgewählt' + (hidden ? ' · davon ' + hidden + ' ausgeblendet' : '');
  }
  function changed() {
   const visible = [...entries.values()].filter(entry => !entry.row.hidden);
   text(counts, visible.length + ' sichtbar · ' + summary());
   selectVisible.disabled = !visible.some(entry => !entry.checkbox.checked);selectVisible.title = selectVisible.disabled ? 'Alle sichtbaren Disziplinen sind bereits ausgewählt oder es gibt keine Treffer.' : '';
   clearSelection.disabled = !selectedKeys().size;clearSelection.title = clearSelection.disabled ? 'Es ist keine Disziplin ausgewählt.' : 'Die Auswahl aller Disziplinen aufheben, einschließlich ausgeblendeter Disziplinen.';
   onChange();
  }
  function matches(entry) {
   return (kind.value === 'all' || entry.option.kind === kind.value) &&
    (ready.value === 'all' || (ready.value === 'ready') === entry.complete) &&
    (exported.value === 'all' || (exported.value === 'exported') === !!entry.exportedAt) &&
    (!dateEnabled.checked || !date.value || entry.option.latest_scheduled_date === date.value);
  }
  function applyFilters() {
   date.disabled = !dateEnabled.checked;date.title = dateEnabled.checked ? 'Letztes geplantes Spiel am gewählten Datum.' : 'Zum Filtern „Nach Datum filtern“ aktivieren.';
   let visible = 0;
   for (const entry of entries.values()) {
    entry.row.hidden = !matches(entry);entry.detailRow.hidden = entry.row.hidden || !entry.expanded;if (!entry.row.hidden) visible++;
    if (entry.row.hidden) entry.menu.node.open = false;
   }
   empty.hidden = visible > 0;table.hidden = visible === 0;
   text(empty, entries.size ? 'Keine Disziplinen passen zu den gewählten Filtern. Die bestehende Auswahl bleibt erhalten.' : 'Keine Disziplinen mit Platzierungsspielen gefunden.');
   filters.hidden = toolbar.hidden = note.hidden = allMenu.node.hidden = !entries.size;
   changed();
  }
  function build(option, key) {
   const row = doc.createElement('tr');row.className = 'certificate-event-row';row.setAttribute('role', 'row');row.dataset.eventKey = key;
   function cell(label, className) {const node = el(row, 'td', className);node.dataset.label = label;node.setAttribute('role', 'cell');return node;}
   const choice = cell('Auswahl', 'certificate-choice'), checkbox = el(choice, 'input');checkbox.type = 'checkbox';checkbox.dataset.certificateKey = key;
   checkbox.setAttribute('aria-label', option.label + ' für den Export auswählen');checkbox.addEventListener('change', changed);
   const discipline = cell('Disziplin', 'certificate-discipline'), toggle = button(discipline, '', 'certificate-event-name');
   const arrow = el(toggle, 'span', 'certificate-disclosure', '›');arrow.setAttribute('aria-hidden', 'true');
   const name = el(toggle, 'span', '', option.label);toggle.setAttribute('aria-expanded', 'false');toggle.title = 'Platzierungen und weitere Details anzeigen';
   const source = el(discipline, 'small', 'certificate-event-source');
   const status = el(cell('Platzierungen', 'certificate-places'), 'span');
   const starters = cell('Starter', 'certificate-starters'), scheduled = cell('Letztes geplantes Spiel', 'certificate-scheduled');
   const scheduledDate = el(scheduled, 'span'), scheduledTime = el(scheduled, 'small');
   const exportCell = cell('Export', 'certificate-export-state'), actions = cell('Aktionen', 'certificate-event-actions');
   const rowMenu = menu(actions, 'Aktionen für ' + option.label), reset = resetButton(rowMenu, key, option.label);
   const detailRow = doc.createElement('tr');detailRow.className = 'certificate-detail-row';detailRow.hidden = true;detailRow.setAttribute('role', 'row');
   const detailCell = el(detailRow, 'td');detailCell.colSpan = 7;detailCell.setAttribute('role', 'cell');
   const panel = el(detailCell, 'div', 'certificate-event-details');panel.id = prefix + '-details-' + entries.size + '-' + (++sequence);
   panel.setAttribute('role', 'region');panel.setAttribute('aria-label', 'Details zu ' + option.label);toggle.setAttribute('aria-controls', panel.id);
   const entry = {key, row, checkbox, toggle, name, source, status, starters, scheduledDate, scheduledTime, exportCell, menu: rowMenu, reset, detailRow, panel, option, expanded: false};
   toggle.addEventListener('click', () => {entry.expanded = !entry.expanded;toggle.setAttribute('aria-expanded', String(entry.expanded));detailRow.hidden = !entry.expanded;if (entry.expanded) renderDetails(entry);});
   return entry;
  }
  function renderDetails(entry) {
   const {option, panel} = entry;
   const rows = getRows(entry.key), splits = getSplits()[option.event_name] || [];
   const signature = JSON.stringify([option, rows, entry.exportedAt, splits, getMaxPlace()]);if (entry.detailSignature === signature) return;entry.detailSignature = signature;
   // Keep split controls and keyboard focus when only a result changes.
   let details = entry.details;
   if (!details) {
    const columns = el(panel, 'div', 'certificate-detail-columns');
    const placements = el(columns, 'section');el(placements, 'h3', '', 'Platzierungen');
    const list = el(placements, 'ul', 'certificate-placement-list');
    const metadata = el(columns, 'section');el(metadata, 'h3', '', 'Weitere Angaben');
    const missing = el(metadata, 'p'), pendingInfo = el(metadata, 'p'), exportInfo = el(metadata, 'p'), lastGame = el(metadata, 'p');
    const splitControls = el(panel, 'div', 'certificate-split-controls');
    details = entry.details = {list, missing, pendingInfo, exportInfo, lastGame, splitControls};
   }
   const lines = [], seen = new Set();
   for (const row of [...rows].sort((a, b) => Number(a.place) - Number(b.place))) {
    const names = [row.spieler_1, row.spieler_2].filter(Boolean), id = JSON.stringify([row.place, [...names].sort()]);if (seen.has(id)) continue;seen.add(id);
    lines.push(row.platz + ': ' + (names.join(' / ') || '—'));
   }
   const placementsSignature = JSON.stringify(lines);
   if (details.placementsSignature !== placementsSignature) {
    details.placementsSignature = placementsSignature;details.list.replaceChildren();
    for (const line of lines.length ? lines : ['Noch keine eindeutigen Platzierungen verfügbar.']) el(details.list, 'li', '', line);
   }
   text(details.missing, entry.complete ? 'Alle gewünschten Urkundenplätze sind verfügbar.' : 'Ausstehende Plätze: ' + (entry.missing || 'Platzierungen noch nicht endgültig.'));
   text(details.pendingInfo, 'Offene Platzierungsspiele: ' + (entry.pending || '—'));details.pendingInfo.hidden = !entry.pending;
   text(details.exportInfo, entry.exportedAt ? 'Zuletzt exportiert: ' + formatDate(entry.exportedAt, true) : 'Noch nicht exportiert.');
   text(details.lastGame, 'Letztes geplantes Spiel: ' + (option.latest_scheduled_date ? formatDate(option.latest_scheduled_date + 'T00:00:00') + (option.latest_scheduled_time ? ' · ' + option.latest_scheduled_time : '') : '—'));
   const splitSignature = JSON.stringify([option.age_class_candidates, option.is_age_class_split]);
   if (details.splitSignature !== splitSignature) {
    details.splitSignature = splitSignature;details.splitControls.replaceChildren();
    const candidates = option.is_age_class_split ? [] : option.age_class_candidates || [];
    details.splitControls.hidden = !candidates.length;
    if (candidates.length) {
     el(details.splitControls, 'h3', '', 'Separate Wertungen');
     for (const age of candidates) {
      const label = el(details.splitControls, 'label'), control = el(label, 'input');control.type = 'checkbox';control.checked = splits.includes(age);
      control.dataset.ageGroup = age;control.setAttribute('aria-label', age + '-Wertung aus ' + option.label);el(label, 'span', '', age);
      control.addEventListener('change', () => onSplit(option.event_name, age, control.checked));
     }
    }
   }
   for (const control of details.splitControls.querySelectorAll('input[data-age-group]')) control.checked = splits.includes(control.dataset.ageGroup);
  }
  function updateEntry(entry, option, markers) {
   entry.option = option;entry.exportedAt = markers[entry.key];entry.complete = ccsvexport.event_is_complete_for_max_place(option, getMaxPlace());
   const available = ccsvexport.get_relevant_certificate_available_places(option, getMaxPlace());
   const expected = Math.max(0, Math.min(getMaxPlace(), Number(option.starter_count) || getMaxPlace()));
   const missing = [], ranges = [...available, expected + 1];let next = 1;
   for (const place of ranges) {if (place > next) missing.push(next === place - 1 ? String(next) : next + '–' + (place - 1));next = place + 1;}
   entry.missing = missing.join(', ');
   const pending = ccsvexport.get_relevant_certificate_pending_ranges(option, getMaxPlace());
   entry.pending = pending.map(range => range.label || range.place_from + '/' + range.place_to).join(', ');
   text(entry.name, option.label);entry.row.classList.toggle('is-split', !!option.is_age_class_split);
   text(entry.source, option.is_age_class_split ? 'Separate Wertung aus ' + (option.source_event_name || option.event_name) : '');entry.source.hidden = !option.is_age_class_split;
   text(entry.status, entry.complete ? '✓ Plätze ' + placeRanges(available) + ' bereit' : '⚠ ' + (entry.missing ? 'Plätze ' + entry.missing + ' offen' : 'Platzierungen offen'));
   entry.status.className = entry.complete ? 'certificate-status-ready' : 'certificate-status-open';
   text(entry.starters, option.starter_count ? option.starter_count + (option.kind === 'double' ? ' Paare' : '') : '—');
   text(entry.scheduledDate, option.latest_scheduled_date ? formatDate(option.latest_scheduled_date + 'T00:00:00') : '—');text(entry.scheduledTime, option.latest_scheduled_time || '');
   text(entry.exportCell, entry.exportedAt ? 'Exportiert' : 'Noch nicht exportiert');entry.exportCell.title = entry.exportedAt ? formatDate(entry.exportedAt, true) : '';
   entry.checkbox.dataset.complete = String(entry.complete);entry.checkbox.dataset.exported = String(!!entry.exportedAt);
   const previews = getRows(entry.key).map(row => row.platz + ': ' + [row.spieler_1, row.spieler_2].filter(Boolean).join(' / '));entry.checkbox.title = previews.join('\n');
   if (entry.expanded) renderDetails(entry);
  }
  function refresh() {
   const next = new Map(), markers = getMarkers();
   for (const option of getOptions()) {
    const key = option.key || option.event_name, entry = entries.get(key) || build(option, key);next.set(key, entry);updateEntry(entry, option, markers);
    if (!initialized) entry.checkbox.checked = matches(entry);
   }
   const nodes = [...next.values()].flatMap(entry => [entry.row, entry.detailRow]);
   nodes.forEach((node, index) => {if (body.children[index] !== node) body.insertBefore(node, body.children[index] || null);});
   for (const [key, entry] of entries) if (!next.has(key)) {entry.row.remove();entry.detailRow.remove();}
   entries = next;initialized = true;
   updateResetControls();
   applyFilters();
  }
  function updateResetControls() {
   const markers = getMarkers();
   function update(control, reason, enabledTitle) {
    if (control.disabled !== !!reason) control.disabled = !!reason;
    const title = reason || enabledTitle;if (control.title !== title) control.title = title;
   }
   update(resetAll, resetReason || (!Object.keys(markers).length ? 'Es ist noch kein Exportstatus gespeichert.' : ''), 'Exportmarkierungen aller Disziplinen zurücksetzen.');
   for (const entry of entries.values()) update(entry.reset, resetReason || (!markers[entry.key] ? 'Für diese Disziplin ist kein Exportstatus gespeichert.' : ''), 'Nur die Exportmarkierung dieser Disziplin zurücksetzen.');
  }
  return {refresh, selectedKeys, summary, hasEvents: () => entries.size > 0,
   setResetReason(reason) {resetReason = reason;updateResetControls();},
  };
 }
 return {create};
})();
