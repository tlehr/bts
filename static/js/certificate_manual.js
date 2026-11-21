'use strict';

var btsCertificateManual = (() => {
 function validate(value) {
  if (!Array.isArray(value) || value.length > 10000) return 'Ungültige manuelle Urkundeneinträge.';
  const keys = new Set();
  for (const entry of value) {
   if (!entry || typeof entry.key !== 'string' || !entry.key.startsWith('manual:') || entry.key.length > 2000 || keys.has(entry.key)
    || typeof entry.ak !== 'string' || entry.ak.length > 40
    || (entry.place != null && (typeof entry.place !== 'string' || entry.place.length > 16))) return 'Ungültige manuelle Urkundeneinträge.';
   keys.add(entry.key);
  }
  return '';
 }
 function create({owner, initial, getEntries, getMarkers, onSave, onChange}) {
  const doc = owner.ownerDocument, edits = new Map((validate(initial) ? [] : initial).map(({key, ak}) => [key, {key, ak}]));
  const customValue = '__certificate_custom_age__';
  let entries = new Map();
  function el(parent, tag, className = '', text) {const node = doc.createElement(tag);node.className = className;if (text != null) node.textContent = text;parent.append(node);return node;}
  el(owner, 'h2', '', 'Manuelle Urkunden');
  el(owner, 'p', 'certificate-selection-note', 'Altersklasse je Spieler oder Paarung auswählen. Die Vorschläge berücksichtigen die BTP-Altersgrenzen und separat gespielte Klassen. Der Altersklassenplatz folgt den sportlichen Ergebnissen aller Teilnehmer, unabhängig von der Exportauswahl. Zuordnungen werden automatisch gespeichert.');
  const filters = el(owner, 'div', 'certificate-filters');
  const searchLabel = el(filters, 'label', '', 'Spieler / Paarung suchen'), search = el(searchLabel, 'input');search.type = 'search';search.name = 'certificate_manual_search';
  const eventLabel = el(filters, 'label', '', 'Disziplin'), eventFilter = el(eventLabel, 'select');eventFilter.name = 'certificate_manual_event';
  const summaryNode = el(owner, 'p', 'certificate-selection-summary');summaryNode.setAttribute('aria-live', 'polite');
  const table = el(owner, 'table', 'certificate-manual-table');table.setAttribute('aria-label', 'Sportliche Platzierungen und Altersklassen je Spieler oder Paarung');
  const head = el(el(table, 'thead'), 'tr');
  for (const label of ['Auswahl', 'Disziplin', 'Gesamtplatz', 'Spieler / Paarung', 'Altersklasse', 'Platz in Altersklasse', 'Letzter Export']) el(head, 'th', '', label).scope = 'col';
  const body = el(table, 'tbody');
  const empty = el(owner, 'p', 'certificate-manual-empty');
  const selectedKeys = () => new Set([...entries.values()].filter(entry => entry.selected.checked).map(entry => entry.key));
  const summary = () => selectedKeys().size + ' von ' + entries.size + ' Spielern / Paarungen für manuelle Urkunden ausgewählt';
  function applyFilters() {
   const query = search.value.trim().toLocaleLowerCase('de');let visible = 0;
   for (const entry of entries.values()) {
    entry.row.hidden = !!((eventFilter.value && entry.option.source_event_name !== eventFilter.value) || (query && ![entry.option.name, entry.option.label].join(' ').toLocaleLowerCase('de').includes(query)));
    if (!entry.row.hidden) visible++;
   }
   summaryNode.textContent = visible + ' sichtbar · ' + summary();empty.hidden = visible > 0;
   empty.textContent = entries.size ? 'Keine Teilnehmer passen zum Filter.' : 'Noch keine Teilnehmer in den importierten Spielen vorhanden.';
  }
  function build(option) {
   const row = el(body, 'tr');row.dataset.manualKey = option.key;
   function cell(label) {const node = el(row, 'td');node.dataset.label = label;return node;}
   const selected = el(cell('Auswahl'), 'input');selected.type = 'checkbox';selected.dataset.manualSelect = option.key;
   const discipline = cell('Disziplin'), overall = cell('Gesamtplatz'), name = cell('Spieler / Paarung');
   overall.className = 'certificate-manual-overall';name.className = 'certificate-manual-name';
   const ageControls = el(cell('Altersklasse'), 'div', 'certificate-manual-age');
   const age = el(ageControls, 'select');age.dataset.manualField = 'ak';
   const customAge = el(ageControls, 'input');customAge.type = 'text';customAge.maxLength = 40;customAge.dataset.manualField = 'custom-ak';customAge.placeholder = 'z. B. O45';customAge.hidden = customAge.disabled = true;
   const place = cell('Platz in Altersklasse');place.className = 'certificate-manual-place';
   const exported = cell('Letzter Export');
   const entry = {row, selected, discipline, overall, name, age, customAge, custom: false, place, exported, key: option.key, option};
   selected.addEventListener('change', () => {age.required = customAge.required = selected.checked;applyFilters();onChange();});
   function edit(value) {
    edits.set(entry.key, {key: entry.key, ak: value});
    refresh();
    // Older running servers still require a place string. Keep that wire field
    // empty: sporting results alone determine every exported placement.
    onSave([...edits.values()].map(value => ({...value, place: ''})));onChange();
   }
   age.addEventListener('change', () => {
    entry.custom = age.value === customValue;customAge.hidden = customAge.disabled = !entry.custom;
    if (entry.custom) {customAge.value = entry.option.ak;customAge.focus();}
    else edit(age.value);
   });
   customAge.addEventListener('input', () => edit(customAge.value));
   return entry;
  }
  function refresh() {
   const next = new Map(), options = getEntries([...edits.values()]), markers = getMarkers();
   for (const option of options) {
    const entry = entries.get(option.key) || build(option);entry.option = option;next.set(option.key, entry);
    entry.discipline.textContent = option.label;entry.name.textContent = option.name;
    entry.selected.setAttribute('aria-label', option.name + ' – ' + option.label + ' für manuelle Urkunden auswählen');
    entry.age.setAttribute('aria-label', 'Altersklasse für ' + option.name + ' – ' + option.label);
    entry.customAge.setAttribute('aria-label', 'Eigene Altersklasse für ' + option.name + ' – ' + option.label);
    const ages = option.age_options || [], ageSignature = JSON.stringify([ages, option.source_ak, option.ak]);
    if (entry.age.dataset.options !== ageSignature) {
     entry.age.replaceChildren();el(entry.age, 'option', '', 'Bitte wählen').value = '';
     for (const age of ages) if (age) el(entry.age, 'option', '', age).value = age;
     if (option.source_ak && !ages.includes(option.source_ak)) {
      const original = el(entry.age, 'optgroup');original.label = 'Gesamtwertung';
      el(original, 'option', '', option.source_ak).value = option.source_ak;
     }
     if (option.ak && option.ak !== option.source_ak && !ages.includes(option.ak)) el(entry.age, 'option', '', option.ak + ' (eigene Zuordnung)').value = option.ak;
     el(entry.age, 'option', '', 'Weitere Altersklasse …').value = customValue;entry.age.dataset.options = ageSignature;
    }
    entry.age.title = 'Vorschläge innerhalb des Altersbereichs dieser Disziplin. Bereits anderweitig abgedeckte Klassen sind ausgenommen.';
    entry.age.value = entry.custom ? customValue : option.ak;
    if (doc.activeElement !== entry.customAge) entry.customAge.value = option.ak;
    entry.overall.textContent = option.overall_label;
    entry.place.textContent = option.place ? option.place + '. Platz' : 'Noch offen';entry.place.title = option.place_reason || '';
    entry.exported.textContent = markers[option.key] ? new Date(markers[option.key]).toLocaleString('de-DE') : '—';
   }
   for (const [key, entry] of entries) if (!next.has(key)) entry.row.remove();
   [...next.values()].forEach((entry, index) => {if (body.children[index] !== entry.row) body.insertBefore(entry.row, body.children[index] || null);});entries = next;
   const events = [...new Map(options.map(option => [option.source_event_name, option.label])).entries()];
   const signature = JSON.stringify(events);
   if (eventFilter.dataset.options !== signature) {
    const previous = eventFilter.value;eventFilter.replaceChildren();el(eventFilter, 'option', '', 'Alle Disziplinen').value = '';
    for (const [value, label] of events) el(eventFilter, 'option', '', label).value = value;
    eventFilter.value = events.some(([value]) => value === previous) ? previous : '';eventFilter.dataset.options = signature;
   }
   applyFilters();
  }
  search.addEventListener('input', applyFilters);eventFilter.addEventListener('change', applyFilters);
  return {refresh, selectedKeys, summary, hasEvents: () => entries.size > 0, drafts: () => [...edits.values()],
   validate() {
    for (const entry of entries.values()) if (entry.selected.checked) {
     if (!entry.option.ak.trim()) return 'Bitte eine Altersklasse für ' + entry.option.name + ' auswählen.';
     if (!entry.option.place) return 'Für ' + entry.option.name + ' steht der Platz in der Altersklasse noch nicht fest. ' + (entry.option.place_reason || '');
    }
    return '';
   },
  };
 }
 return {validate, create};
})();

if (typeof module !== 'undefined') module.exports = btsCertificateManual;
