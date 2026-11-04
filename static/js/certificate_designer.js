/* global btsCertificateDesign, btsCertificateDocument, btsNumberInput */
'use strict';
// eslint-disable-next-line no-unused-vars -- Used by the certificate workspace.
var btsCertificateDesigner = (() => {
 const labels = {name: 'Spielername', partner: 'Doppelpartner', paarung: 'Doppelpaar', veranstaltung_1: 'Veranstaltung – Zeile 1', veranstaltung_2: 'Veranstaltung – Zeile 2', disziplin: 'Disziplin', ak: 'Altersklasse', platz: 'Platzierung', ort: 'Ort', datum_heute: 'Datum – Heute', datum_letztes_spiel: 'Datum – des letzten Spiels'};
 function create({owner, tournamentKey, initial, getRecords, onChange, onStateChange}) {
  const doc = owner.ownerDocument, lifetime = new AbortController(), signal = lifetime.signal;
  let model = btsCertificateDesign.read(initial), kind = 'single', selected, disposed = false, loading = false, revision = 0, previewError = '', uploadError = '', inspectorError = '', areaError = '', backgroundSignature = '', drag = null, samplesSignature = '';
  const undoStack = [];let lastEdit = '', lastEditAt = 0;
  function el(parent, tag, className = '', text) {const node = doc.createElement(tag);node.className = className;if (text != null) node.textContent = text;parent.append(node);return node;}
  function button(parent, text, className = '') {const node = el(parent, 'button', className, text);node.type = 'button';return node;}
  function fieldAction(parent, caption, label) {const node = button(parent, caption);node.setAttribute('aria-label', label);node.title = label;return node;}
  function choice(parent, caption, values) {
   const label = el(parent, 'label');el(label, 'span', '', caption);const node = el(label, 'select');node.setAttribute('aria-label', caption);
   for (const [value, text] of values) {const option = el(node, 'option', '', text);option.value = value;}
   return node;
  }
  function numberInput(parent, caption, name, min, max, {unit = 'cm', increment = .1, precision = .01} = {}) {
   const cell = el(parent, 'div', 'certificate-number-field'), label = el(cell, 'label');el(label, 'span', '', caption);const stepper = el(cell, 'span', 'certificate-number-stepper'), input = el(stepper, 'input');
   input.type = 'number';input.min = min;input.max = max;input.step = precision;input.name = name;input.id = name + '-' + tournamentKey;label.htmlFor = input.id;input.setAttribute('aria-label', caption);
   const small = String(increment).replace('.', ',') + ' ' + unit, large = String(increment * 10).replace('.', ',') + ' ' + unit, exact = String(precision).replace('.', ',') + ' ' + unit;
   input.title = 'Pfeiltasten: ' + small + '; mit Umschalt: ' + large + '. Direkte Eingabe: ' + exact + '.';
   btsNumberInput.attach(input, {increment, container:stepper, allowed:() => active() && !loading});
   return input;
  }
  const heading = el(owner, 'div', 'certificate-designer-heading');el(heading, 'h2', '', 'Urkunde gestalten');
  el(owner, 'p', 'certificate-designer-intro', 'Hintergrund wählen und Textfelder darauf platzieren. Einzel und Doppel haben eigene Vorlagen. Pro Spieler wird eine Urkunde erzeugt.');
  const toolbar = el(owner, 'div', 'certificate-design-toolbar');
  const kindControl = choice(toolbar, 'Vorlage', [['single', 'Einzel'], ['double', 'Doppel']]);kindControl.name = 'certificate_design_kind';
  const format = choice(toolbar, 'Seitenformat', [['portrait', 'A4 Hochformat'], ['landscape', 'A4 Querformat'], ['source', 'Format der Hintergrundvorlage']]);
  const copy = button(toolbar, 'Von Doppel übernehmen'), undo = button(toolbar, 'Rückgängig');undo.disabled = true;
  const workspace = el(owner, 'div', 'certificate-design-workspace'), preview = el(workspace, 'section', 'certificate-design-preview');
  const sample = choice(preview, 'Vorschau mit', []);sample.name = 'certificate_design_sample';
  const stage = el(preview, 'div', 'certificate-design-stage'), paper = el(stage, 'div', 'certificate-design-paper');paper.setAttribute('aria-label', 'Urkundenvorschau – Textfelder zum Verschieben auswählen');
  const view = doc.defaultView, header = doc.querySelector('.leitstand-header'), footer = owner.closest('.page-certificates')?.querySelector('.certificate-export-footer');
  let previewFrame = null;
  function sizePreview() {
   previewFrame = null;if (!active() || !owner.getClientRects().length) return;
   const viewport = view.visualViewport, headerHeight = header?.getBoundingClientRect().height || 0;
   const top = (viewport?.offsetTop || 0) + headerHeight + 12;
   const limit = Math.max(0, (viewport?.height || view.innerHeight) - headerHeight - (footer?.getBoundingClientRect().height || 0) - 24);
   const height = Math.floor(Math.min(inspector.getBoundingClientRect().height, limit));
   for (const [key, value] of [['--certificate-preview-top', top + 'px'], ['--certificate-preview-height', height + 'px']]) if (preview.style.getPropertyValue(key) !== value) preview.style.setProperty(key, value);
  }
  function schedulePreview() {if (!disposed && previewFrame === null) previewFrame = view.requestAnimationFrame(sizePreview);}
  const previewObserver = new ResizeObserver(schedulePreview);
  for (const node of [header, footer, owner]) if (node) previewObserver.observe(node);
  view.addEventListener('resize', schedulePreview, {signal});
  view.visualViewport?.addEventListener('resize', schedulePreview, {signal});view.visualViewport?.addEventListener('scroll', schedulePreview, {passive:true, signal});
  const canvas = el(paper, 'canvas');canvas.setAttribute('aria-hidden', 'true');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');svg.setAttribute('class', 'certificate-design-overlay');paper.append(svg);
  const inspector = el(workspace, 'aside', 'certificate-design-inspector');
  previewObserver.observe(inspector);
  const bgHeading = el(inspector, 'h3', '', 'Hintergrund');bgHeading.id = 'certificate-background-' + tournamentKey;
  const uploadLabel = el(inspector, 'label', 'certificate-background-upload', 'PDF oder Bild auswählen');
  const upload = el(uploadLabel, 'input');upload.type = 'file';upload.accept = 'application/pdf,image/png,image/jpeg,image/webp';upload.setAttribute('aria-label', 'Hintergrundvorlage hochladen');
  const backgroundName = el(inspector, 'p', 'certificate-background-name'), removeBackground = button(inspector, 'Hintergrund entfernen');
  el(inspector, 'p', 'certificate-design-help', 'Maximal 8 MB. Bei PDFs wird die erste Seite verwendet.');
  const previewOnlyLabel = el(inspector, 'label', 'certificate-background-preview-only'), previewOnly = el(previewOnlyLabel, 'input');previewOnly.type = 'checkbox';previewOnly.name = 'certificate_background_preview_only';
  el(previewOnlyLabel, 'span', '', 'Hintergrund nur in der Vorschau anzeigen');
  const previewOnlyHelp = el(inspector, 'p', 'certificate-design-help', 'Für vorgedrucktes Briefpapier: PDF, Probe-PDF und Druck enthalten nur die Textfelder. Beim Drucken die tatsächliche Größe (100 %) wählen.');previewOnlyHelp.id = 'certificate-background-preview-only-' + tournamentKey;previewOnly.setAttribute('aria-describedby', previewOnlyHelp.id);
  el(inspector, 'h3', '', 'Druckbereich');
  const areaMode = choice(inspector, 'Druckbereich festlegen über', [['margins', 'Seitenabstände'], ['position', 'Position und Größe']]);areaMode.name = 'certificate_print_area_mode';
  const areaControls = {};
  for (const [mode, fields] of [['margins', [['left', 'Links (cm)'], ['top', 'Oben (cm)'], ['right', 'Rechts (cm)'], ['bottom', 'Unten (cm)']]], ['position', [['x', 'Position X (cm)'], ['y', 'Position Y (cm)'], ['width', 'Breite (cm)'], ['height', 'Höhe (cm)']]]]) {
   const group = el(inspector, 'div', 'certificate-print-area-inputs');areaControls[mode] = {group, inputs: {}};
   for (const [key, caption] of fields) {
    const input = numberInput(group, caption, 'certificate_print_' + mode + '_' + key, ['width', 'height'].includes(key) ? 1 : 0, 100);areaControls[mode].inputs[key] = input;
    input.addEventListener('input', () => {areaError = proposedArea().error;state();}, {signal});
    input.addEventListener('change', () => {const proposed = proposedArea();areaError = proposed.error;if (areaError) {state();return;}mutate('print-area-' + kind, () => {model[kind] = btsCertificateDesign.setPrintArea(template(), proposed.area);});}, {signal});
   }
  }
  el(inspector, 'p', 'certificate-design-help', 'Die Pfeile im Feld und die Pfeiltasten ändern um 0,1 cm, mit Umschalt um 1 cm. Genaue Werte bis 0,01 cm können direkt eingegeben werden.');
  el(inspector, 'p', 'certificate-design-help', 'Alle Textpositionen beziehen sich auf die linke obere Ecke des Druckbereichs. Beim Vergrößern oder Verkleinern passen sich Feldpositionen und Feldgrößen proportional an. Der gestrichelte Rahmen wird nicht gedruckt.');
  el(inspector, 'h3', '', 'Textfelder');
  const fieldSelect = choice(inspector, 'Textfeld auswählen', []);fieldSelect.name = 'certificate_design_field';
  const fieldActions = el(inspector, 'div', 'certificate-field-actions'), add = fieldAction(fieldActions, 'Hinzufügen', 'Textfeld hinzufügen'), duplicate = fieldAction(fieldActions, 'Kopieren', 'Textfeld kopieren'), remove = fieldAction(fieldActions, 'Entfernen', 'Textfeld entfernen');
  fieldActions.setAttribute('role', 'group');fieldActions.setAttribute('aria-label', 'Textfeldaktionen');
  const properties = el(inspector, 'div', 'certificate-field-properties');
  const textLabel = el(properties, 'label');el(textLabel, 'span', '', 'Text');const text = el(textLabel, 'textarea');text.rows = 3;text.maxLength = 2048;text.setAttribute('aria-label', 'Text des Urkundenfelds');
  const token = choice(properties, 'Platzhalter einfügen', [['', 'Platzhalter wählen …'], ...Object.entries(labels)]);
  token.querySelector('[value="datum_heute"]').title = 'Aktuelles Datum in der Zeitzone des Turniers';
  token.querySelector('[value="datum_letztes_spiel"]').title = 'Datum des letzten geplanten Spiels dieser Disziplin, wie auf der Auswahlseite; ohne Spieltermin bleibt der Wert leer';
  const typography = el(properties, 'div', 'certificate-field-typography');
  const font = choice(typography, 'Schrift', Object.entries(btsCertificateDesign.FONTS).map(([key, value]) => [key, value.label]));
  const align = choice(typography, 'Textausrichtung im Feld', [['left', 'Links'], ['center', 'Zentriert'], ['right', 'Rechts']]);
  el(properties, 'p', 'certificate-design-help', 'Alle Schriften stehen auf jedem Gerät zur Verfügung und werden in der PDF mitgespeichert.');
  const numbers = {};
  const positions = el(properties, 'div', 'certificate-field-numbers');
  for (const [key, caption, min, max] of [['size', 'Schriftgröße (pt)', 6, 120], ['x', 'Links im Druckbereich (cm)', 0, 100], ['y', 'Oben im Druckbereich (cm)', 0, 100], ['width', 'Breite (cm)', .4, 100], ['height', 'Höhe (cm)', .3, 100]]) {
   const factor = key === 'size' ? 1 : 10, input = numberInput(positions, caption, 'certificate_field_' + key, min, max, key === 'size' ? {unit: 'pt', increment: 1, precision: .1} : undefined);
   numbers[key] = input;
   input.addEventListener('change', () => {
    const number = Number(input.value);if (!Number.isFinite(number) || !input.value) {inspectorError = 'Bitte eine gültige Feldgröße oder Position eingeben.';state();return;}
    const precise = factor === 10 && number === Number(input.dataset.displayValue) ? Number(input.dataset.preciseValue) : number * factor;
    mutate('number-' + key, () => {const field = currentField();if (!field) return;field[key] = Math.min(max * factor, Math.max(min * factor, precise));constrain(field);});
   }, {signal});
   input.addEventListener('input', () => {inspectorError = input.validity.valid && input.value ? '' : 'Bitte eine gültige Feldgröße oder Position eingeben.';state();}, {signal});
  }
  const centerActions = el(properties, 'div', 'certificate-field-actions certificate-field-centering'), fullWidth = fieldAction(centerActions, 'Volle Breite', 'Breite des Druckbereichs'), centerX = fieldAction(centerActions, 'Horizontal zentrieren', 'Horizontal zentrieren'), centerY = fieldAction(centerActions, 'Vertikal zentrieren', 'Vertikal zentrieren');
  centerActions.setAttribute('role', 'group');centerActions.setAttribute('aria-label', 'Textfeld im Druckbereich ausrichten');
  fullWidth.title = 'Linken Abstand auf 0 und Breite auf die gesamte Breite des Druckbereichs setzen';
  centerX.title = 'Textfeld horizontal im Druckbereich zentrieren';centerY.title = 'Textfeld vertikal im Druckbereich zentrieren';
  const styling = el(properties, 'div', 'certificate-field-styling');
  const boldLabel = el(styling, 'label'), bold = el(boldLabel, 'input');bold.type = 'checkbox';el(boldLabel, 'span', '', 'Fett');
  const colorLabel = el(styling, 'label');el(colorLabel, 'span', '', 'Textfarbe');const color = el(colorLabel, 'input');color.type = 'color';color.setAttribute('aria-label', 'Textfarbe');
  const status = el(owner, 'p', 'certificate-design-status');status.setAttribute('aria-atomic', 'true');status.setAttribute('aria-live', 'polite');
  function template() {return model[kind];}
  function orderedFields() {return [...template().fields].sort((left, right) => left.y - right.y || left.x - right.x);}
  function currentField() {return template().fields.find(field => field.id === selected);}
  function duplicateReason() {
   const field = currentField();if (!field) return 'Bitte zuerst ein Textfeld auswählen.';
   if (template().fields.length >= btsCertificateDesign.MAX_FIELDS) return 'Maximal ' + btsCertificateDesign.MAX_FIELDS + ' Textfelder je Vorlage.';
   return field.y + 20 + field.height > btsCertificateDesign.printArea(template()).height + .000001 ? 'Für eine Kopie 2 cm tiefer ist im Druckbereich nicht genug Platz.' : '';
  }
  function active() {return !disposed && owner.isConnected;}
  function error() {return areaError || inspectorError || btsCertificateDesign.validate(model) || previewError;}
  function state() {
   const message = loading ? 'Hintergrundvorlage wird aufbereitet und gespeichert …' : error() || uploadError || 'Textfelder ziehen oder Position und Größe rechts eingeben. Lange Namen werden passend umgebrochen und bei Bedarf verkleinert.';
   if (status.textContent !== message) status.textContent = message;status.classList.toggle('is-error', !!(error() || uploadError));
   onStateChange();
  }
  function constrain(field) {
   btsCertificateDesign.constrainField(field, btsCertificateDesign.printArea(template()));
  }
  function proposedArea() {
   const inputs = areaControls[areaMode.value].inputs;
   if (Object.values(inputs).some(input => !input.value || !input.validity.valid)) return {error: 'Bitte gültige Seitenabstände beziehungsweise Position und Größe in cm eingeben.'};
   const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, Number(input.value) === Number(input.dataset.displayValue) ? Number(input.dataset.preciseValue) : Number(input.value) * 10]));
   const area = areaMode.value === 'margins' ? {x: values.left, y: values.top, width: template().width - values.left - values.right, height: template().height - values.top - values.bottom} : values;
   return {area, error: btsCertificateDesign.printAreaError(template(), area)};
  }
  function renderAreaControls() {
   const page = template(), area = btsCertificateDesign.printArea(page), values = {margins: {left: area.x, top: area.y, right: page.width - area.x - area.width, bottom: page.height - area.y - area.height}, position: area};
   for (const [mode, controls] of Object.entries(areaControls)) {
    controls.group.hidden = mode !== areaMode.value;
    for (const [key, input] of Object.entries(controls.inputs)) {input.disabled = controls.group.hidden;const value = String(Math.round(values[mode][key] * 10) / 100);input.dataset.preciseValue = values[mode][key];input.dataset.displayValue = value;if (input.value !== value) input.value = value;}
   }
  }
  function mutate(group, callback) {
   if (disposed || loading) return;
   if (group !== lastEdit || Date.now() - lastEditAt > 600) {undoStack.push(btsCertificateDesign.clone(model));if (undoStack.length > 25) undoStack.shift();}
   lastEdit = group;lastEditAt = Date.now();callback();inspectorError = '';areaError = '';previewError = '';uploadError = '';undo.disabled = !undoStack.length;
   onChange(btsCertificateDesign.clone(model));render();
  }
  function refreshSamples() {
   const rows = getRecords(kind).filter(record => record.kind === kind), signature = JSON.stringify(rows);
   const specimen = btsCertificateDesign.sampleRecord(kind, rows.find(record => record.place === 1) || rows[0]), records = rows.filter(record => !record.preview_sample);
   const recordKey = record => 'record:' + JSON.stringify([record.kind, record.event_name, record.name, record.partner]);
   if (signature !== samplesSignature) {
    samplesSignature = signature;const previous = sample.value;sample.replaceChildren();
    const example = el(sample, 'option', '', 'Musterurkunde – ' + specimen.paarung);example.value = 'sample';
    const placeholders = el(sample, 'option', '', 'Platzhalter anzeigen (ohne Ersetzung)');placeholders.value = 'placeholders';
    for (const record of records) {const option = el(sample, 'option', '', [record.name, record.platz + (record.preview_placement ? ' (Beispiel)' : ''), record.disziplin, record.ak].filter(Boolean).join(' · '));option.value = recordKey(record);}
    if ([...sample.options].some(option => option.value === previous)) sample.value = previous;
   }
   return records.find(record => recordKey(record) === sample.value) || specimen;
  }
  function renderInspector() {
   const page = template();kindControl.value = kind;copy.textContent = kind === 'single' ? 'Von Doppel übernehmen' : 'Von Einzel übernehmen';
   renderAreaControls();
   const fields = orderedFields(), signature = JSON.stringify(fields.map(field => [field.id, field.text]));
   if (fieldSelect.dataset.signature !== signature) {fieldSelect.dataset.signature = signature;fieldSelect.replaceChildren();for (const field of fields) {const option = el(fieldSelect, 'option', '', field.text.replace(/\n/g, ' ').slice(0, 65) || 'Leeres Textfeld');option.value = field.id;}}
   if (!currentField()) selected = fields[0]?.id;fieldSelect.value = selected || '';
   const field = currentField();properties.hidden = !field;remove.disabled = !field;add.disabled = page.fields.length >= btsCertificateDesign.MAX_FIELDS;
   add.title = add.disabled ? 'Maximal ' + btsCertificateDesign.MAX_FIELDS + ' Textfelder je Vorlage.' : 'Textfeld hinzufügen';
   const duplicateError = duplicateReason();duplicate.disabled = !!duplicateError;duplicate.title = duplicateError || 'Textfeld mit allen Einstellungen 2 cm tiefer kopieren';
   backgroundName.textContent = page.background?.name || 'Kein Hintergrund – weißes Papier';removeBackground.disabled = !page.background;
   previewOnly.checked = !!page.backgroundPreviewOnly;previewOnly.disabled = !page.background;previewOnlyLabel.title = page.background ? '' : 'Bitte zuerst eine Hintergrundvorlage auswählen.';previewOnlyHelp.hidden = !previewOnly.checked;
   format.value = Math.abs(page.width - 210) < .1 && Math.abs(page.height - 297) < .1 ? 'portrait' : Math.abs(page.width - 297) < .1 && Math.abs(page.height - 210) < .1 ? 'landscape' : 'source';
   format.querySelector('[value="source"]').disabled = !page.background;
   if (!field) return;
   for (const [control, value] of [[text, field.text], [font, field.font], [align, field.align], [color, field.color]]) if (control.value !== value) control.value = value;
   bold.checked = field.bold;for (const [key, input] of Object.entries(numbers)) {const value = String(Math.round(field[key] * 10) / (key === 'size' ? 10 : 100));input.dataset.preciseValue = field[key];input.dataset.displayValue = value;if (input.value !== value) input.value = value;}
  }
  async function render() {
   if (!active()) return;const generation = ++revision, page = btsCertificateDesign.clone(template()), record = refreshSamples(), replacePlaceholders = sample.value !== 'placeholders';
   renderInspector();paper.style.aspectRatio = page.width + '/' + page.height;paper.style.setProperty('--certificate-page-ratio', page.width / page.height);svg.setAttribute('viewBox', '0 0 ' + page.width + ' ' + page.height);state();schedulePreview();
   try {
    const backgroundKey = JSON.stringify([page.width, page.height, page.background]);
    if (backgroundKey !== backgroundSignature) {
     const buffer = doc.createElement('canvas');await btsCertificateDocument.paintBackground(buffer, page, tournamentKey);
     if (!active() || generation !== revision) return;canvas.width = buffer.width;canvas.height = buffer.height;canvas.getContext('2d').drawImage(buffer, 0, 0);backgroundSignature = backgroundKey;
    }
    const layout = await btsCertificateDocument.previewLines(page, record, {replacePlaceholders});if (!active() || generation !== revision) return;
    svg.replaceChildren();
    const area = btsCertificateDesign.printArea(page), guide = doc.createElementNS(svg.namespaceURI, 'rect');guide.setAttribute('class', 'certificate-print-area-guide');guide.setAttribute('aria-hidden', 'true');
    for (const [key, value] of Object.entries(area)) guide.setAttribute(key, value);svg.append(guide);
    for (const {field, lines} of layout) {
     const group = doc.createElementNS(svg.namespaceURI, 'g');group.dataset.fieldId = field.id;group.setAttribute('class', 'certificate-preview-field' + (selected === field.id ? ' is-selected' : ''));
     const absolute = btsCertificateDesign.absoluteField(page, field), rect = doc.createElementNS(svg.namespaceURI, 'rect');for (const [key, value] of Object.entries({x: absolute.x, y: absolute.y, width: field.width, height: field.height})) rect.setAttribute(key, value);group.append(rect);
     for (const line of lines) {
      const node = doc.createElementNS(svg.namespaceURI, 'text');node.textContent = line.text;node.setAttribute('x', line.x);node.setAttribute('y', line.y);node.setAttribute('font-size', line.size / btsCertificateDesign.MM);
      node.setAttribute('font-family', btsCertificateDesign.FONTS[field.font].family);node.setAttribute('font-weight', field.bold ? '700' : '400');node.setAttribute('fill', field.color);group.append(node);
     }
     svg.append(group);
    }
    previewError = '';state();
   } catch (err) {if (active() && generation === revision) {previewError = err.message || 'Die Vorschau konnte nicht erstellt werden.';state();}}
  }
  kindControl.addEventListener('change', () => {kind = kindControl.value;selected = orderedFields()[0]?.id;samplesSignature = '';inspectorError = '';areaError = '';previewError = '';uploadError = '';render();}, {signal});
  sample.addEventListener('change', render, {signal});
  fieldSelect.addEventListener('change', () => {selected = fieldSelect.value;inspectorError = '';render();}, {signal});
  copy.addEventListener('click', () => mutate('copy-' + Date.now(), () => {model[kind] = btsCertificateDesign.clone(model[kind === 'single' ? 'double' : 'single']);selected = orderedFields()[0]?.id;}), {signal});
  undo.addEventListener('click', () => {const previous = undoStack.pop();if (!previous) return;model = previous;lastEdit = '';inspectorError = '';areaError = '';previewError = '';undo.disabled = !undoStack.length;onChange(btsCertificateDesign.clone(model));render();}, {signal});
  areaMode.addEventListener('change', () => {areaError = '';renderAreaControls();state();}, {signal});
  format.addEventListener('change', () => mutate('format', () => {
   const source = template().background, width = format.value === 'source' ? source?.width || 210 : format.value === 'portrait' ? 210 : 297;
   const height = format.value === 'source' ? source?.height || 297 : format.value === 'portrait' ? 297 : 210;
   model[kind] = btsCertificateDesign.resize(template(), width, height);
  }), {signal});
  removeBackground.addEventListener('click', () => mutate('background-remove', () => {template().background = null;}), {signal});
  previewOnly.addEventListener('change', () => mutate('background-preview-only-' + kind, () => {template().backgroundPreviewOnly = previewOnly.checked;}), {signal});
  add.addEventListener('click', () => mutate('add-' + Date.now(), () => {
   const id = 'field-' + crypto.randomUUID(), area = btsCertificateDesign.printArea(template()), field = {id, text: '{name}', x: Math.min(15, area.width / 10), y: Math.min(20, area.height / 10), width: Math.max(4, area.width - Math.min(30, area.width / 5)), height: 16, size: 22, bold: false, font: 'sans', align: 'center', color: '#213235'};constrain(field);template().fields.push(field);selected = id;
  }), {signal});
  duplicate.addEventListener('click', () => {
   if (duplicateReason()) return;const id = 'field-' + crypto.randomUUID();
   mutate('duplicate-' + id, () => {const field = btsCertificateDesign.clone(currentField());field.id = id;field.y += 20;template().fields.push(field);selected = id;});
  }, {signal});
  fullWidth.addEventListener('click', () => mutate('full-width-' + selected, () => {const field = currentField();if (field) {field.x = 0;field.width = btsCertificateDesign.printArea(template()).width;}}), {signal});
  centerX.addEventListener('click', () => mutate('center-x-' + selected, () => {const field = currentField();if (field) field.x = (btsCertificateDesign.printArea(template()).width - field.width) / 2;}), {signal});
  centerY.addEventListener('click', () => mutate('center-y-' + selected, () => {const field = currentField();if (field) field.y = (btsCertificateDesign.printArea(template()).height - field.height) / 2;}), {signal});
  remove.addEventListener('click', () => mutate('remove-' + Date.now(), () => {template().fields = template().fields.filter(field => field.id !== selected);selected = orderedFields()[0]?.id;}), {signal});
  text.addEventListener('input', () => mutate('text-' + selected, () => {currentField().text = text.value;}), {signal});
  token.addEventListener('change', () => {if (!token.value || !currentField()) return;text.setRangeText('{' + token.value + '}', text.selectionStart, text.selectionEnd, 'end');token.value = '';mutate('token-' + selected, () => {currentField().text = text.value;});text.focus();}, {signal});
  for (const [control, key] of [[font, 'font'], [align, 'align'], [color, 'color'], [bold, 'bold']]) control.addEventListener('change', () => mutate(key + '-' + selected, () => {if (currentField()) currentField()[key] = key === 'bold' ? bold.checked : control.value;}), {signal});
  upload.addEventListener('change', async () => {
   const file = upload.files[0];if (!file || loading) return;
   const targetKind = kind;loading = true;uploadError = '';state();
   try {
    const info = await btsCertificateDocument.inspect(file);if (!active()) return;
    if (info.width < 50 || info.height < 50 || info.width > 1000 || info.height > 1000) throw new Error('Die Vorlage benötigt ein Seitenformat zwischen 50 und 1000 mm.');
    const response = await fetch('/h/' + encodeURIComponent(tournamentKey) + '/certificates/background', {method: 'POST', headers: {'Content-Type': info.blob.type, 'X-File-Name': encodeURIComponent(file.name)}, body: info.blob, signal});
    if (!response.ok) {let message;try {message = (await response.json()).message;} catch (_) {message = response.status === 413 ? 'Die Vorlage überschreitet 8 MB.' : '';}throw new Error(message || 'Die Vorlage konnte nicht gespeichert werden.');}
    const result = await response.json();if (!active()) return;
    loading = false;kind = targetKind;mutate('background-' + Date.now(), () => {
     model[kind] = btsCertificateDesign.resize(template(), info.width, info.height);template().background = {...result.background, width: info.width, height: info.height};
    });
   } catch (err) {if (active()) {uploadError = (err.name === 'AbortError' ? 'Upload abgebrochen.' : err.message) + ' Die bestehende Vorlage bleibt erhalten.';}}
   finally {if (active()) {loading = false;upload.value = '';state();}}
  }, {signal});
  function point(event) {const box = svg.getBoundingClientRect();return {x: (event.clientX - box.left) * template().width / box.width, y: (event.clientY - box.top) * template().height / box.height};}
  svg.addEventListener('pointerdown', event => {
   const group = event.target.closest('[data-field-id]');if (!group || event.button !== 0 || loading) return;
   selected = group.dataset.fieldId;const field = currentField();drag = {pointer: event.pointerId, start: point(event), x: field.x, y: field.y, before: btsCertificateDesign.clone(model), moved: false};
   svg.setPointerCapture(event.pointerId);event.preventDefault();renderInspector();
   for (const node of svg.children) node.classList.toggle('is-selected', node === group);
  }, {signal});
  svg.addEventListener('pointermove', event => {
   if (!drag || drag.pointer !== event.pointerId) return;
   const position = point(event), field = currentField();field.x = drag.x + position.x - drag.start.x;field.y = drag.y + position.y - drag.start.y;constrain(field);
   drag.moved ||= Math.abs(field.x - drag.x) + Math.abs(field.y - drag.y) > .2;render();
  }, {signal});
  function finishDrag(event) {
   if (!drag || drag.pointer !== event.pointerId) return;
   const previous = drag;drag = null;
   if (event.type === 'pointercancel') {model = previous.before;render();return;}
   if (previous.moved) {undoStack.push(previous.before);undo.disabled = false;lastEdit = '';onChange(btsCertificateDesign.clone(model));}render();
  }
  svg.addEventListener('pointerup', finishDrag, {signal});svg.addEventListener('pointercancel', finishDrag, {signal});
  return {refresh: render, getDesign: () => btsCertificateDesign.clone(model), getPreview: () => ({record: btsCertificateDesign.clone(refreshSamples()), replacePlaceholders: sample.value !== 'placeholders'}), error, busy: () => loading,
   dispose() {disposed = true;revision++;lifetime.abort();previewObserver.disconnect();if (previewFrame !== null) view.cancelAnimationFrame(previewFrame);previewFrame = null;},
  };
 }
 return {create};
})();
