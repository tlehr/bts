/* exported btsCertificateDesign */
'use strict';
var btsCertificateDesign = (() => {
 const TOKENS = ['name', 'partner', 'paarung', 'veranstaltung_1', 'veranstaltung_2', 'disziplin', 'ak', 'platz', 'ort', 'datum_heute', 'datum_letztes_spiel'];
 const FONTS = {
  sans: {label: 'Sans Serif', family: 'BTS Certificate Sans', regular: 'DejaVuSans.ttf', bold: 'DejaVuSans-Bold.ttf'},
  serif: {label: 'Serif', family: 'BTS Certificate Serif', regular: 'DejaVuSerif.ttf', bold: 'DejaVuSerif-Bold.ttf'},
  'liberation-sans': {label: 'Liberation Sans', family: 'BTS Certificate Liberation Sans', regular: 'LiberationSans-Regular.ttf', bold: 'LiberationSans-Bold.ttf'},
  'liberation-serif': {label: 'Liberation Serif', family: 'BTS Certificate Liberation Serif', regular: 'LiberationSerif-Regular.ttf', bold: 'LiberationSerif-Bold.ttf'},
  'noto-sans': {label: 'Noto Sans', family: 'BTS Certificate Noto Sans', regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf'},
  'noto-serif': {label: 'Noto Serif', family: 'BTS Certificate Noto Serif', regular: 'NotoSerif-Regular.ttf', bold: 'NotoSerif-Bold.ttf'},
  mono: {label: 'DejaVu Sans Mono', family: 'BTS Certificate Mono', regular: 'DejaVuSansMono.ttf', bold: 'DejaVuSansMono-Bold.ttf'},
  yrsa: {label: 'Yrsa', family: 'BTS Certificate Yrsa', regular: 'Yrsa-Regular.ttf', bold: 'Yrsa-Bold.ttf'},
 };
 const MM = 72 / 25.4, MAX_FIELDS = 32;
 function defaultTemplate(kind = 'single') {
  const fields = [
   ['heading', 'URKUNDE', 45, 23, 48, true, 'serif'],
   ['name', '{name}', 96, 22, 30, true, 'sans'],
   ...(kind === 'double' ? [['partner', 'mit {partner}', 122, 11, 15, false, 'sans']] : []),
   ['intro', 'erreicht den', 138, 10, 15, false, 'sans'],
   ['place', '{platz}', 154, 23, 36, true, 'serif'],
   ['event', '{disziplin} {ak}', 187, 16, 21, false, 'sans'],
   ['tournament', '{veranstaltung_1}\n{veranstaltung_2}', 220, 23, 16, false, 'sans'],
   ['date', '{ort} · {datum_letztes_spiel}', 263, 10, 12, false, 'sans'],
  ].map(([id, text, y, height, size, bold, font]) => ({id, text, x: 20, y, width: 170, height, size, bold, font, align: 'center', color: '#213235'}));
  return {width: 210, height: 297, printArea: {x: 0, y: 0, width: 210, height: 297}, background: null, backgroundPreviewOnly: false, fields};
 }
 function defaults() {return {version: 1, single: defaultTemplate(), double: defaultTemplate('double')};}
 function clone(value) {return JSON.parse(JSON.stringify(value));}
 function tokens(text) {return [...String(text).matchAll(/\{([^{}]+)\}/g)].map(match => match[1]);}
 function dateTokens(text) {return String(text).replace(/\{(?:datum|datum_finale)\}/g, '{datum_letztes_spiel}');}
 function textError(text) {const unknown = tokens(dateTokens(text)).filter(token => !TOKENS.includes(token));return unknown.length ? 'Unbekannter Platzhalter: {' + unknown[0] + '}.' : '';}
 function printArea(template) {return template.printArea === undefined ? {x: 0, y: 0, width: template.width, height: template.height} : template.printArea;}
 function printAreaError(template, area = printArea(template)) {
  return !area || ![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.x < 0 || area.y < 0 || area.width < 10 || area.height < 10 || area.x + area.width > template.width + .000001 || area.y + area.height > template.height + .000001
   ? 'Der Druckbereich muss vollständig auf der Seite liegen und mindestens 1 × 1 cm groß sein.' : '';
 }
 function constrainField(field, area) {
  field.width = Math.min(area.width, Math.max(4, field.width));field.height = Math.min(area.height, Math.max(3, field.height));
  field.x = Math.max(0, Math.min(area.width - field.width, field.x));field.y = Math.max(0, Math.min(area.height - field.height, field.y));
 }
 function setPrintArea(template, area) {
  const invalid = printAreaError(template, area);if (invalid) throw new Error(invalid);
  const next = clone(template), previous = printArea(template), sx = area.width / previous.width, sy = area.height / previous.height;
  next.printArea = clone(area);
  for (const field of next.fields) {field.x *= sx;field.width *= sx;field.y *= sy;field.height *= sy;constrainField(field, area);}
  return next;
 }
 function absoluteField(template, field) {const area = printArea(template);return {...field, x: area.x + field.x, y: area.y + field.y};}
 function validate(value) {
  if (!value || value.version !== 1) return 'Ungültige Urkundenvorlage.';
  if (JSON.stringify(value).length > 160000) return 'Die Urkundenvorlage ist zu groß.';
  for (const kind of ['single', 'double']) {
   const template = value[kind];
   if (!template || ![template.width, template.height].every(number => Number.isFinite(number) && number >= 50 && number <= 1000)) return 'Ungültiges Seitenformat.';
   const areaError = printAreaError(template);if (areaError) return areaError;const area = printArea(template);
   if (template.backgroundPreviewOnly !== undefined && typeof template.backgroundPreviewOnly !== 'boolean') return 'Ungültige Einstellung für den Vorschauhintergrund.';
   if (!Array.isArray(template.fields) || template.fields.length > MAX_FIELDS) return 'Maximal ' + MAX_FIELDS + ' Textfelder je Vorlage sind möglich.';
   const ids = new Set();
   for (const field of template.fields) {
    if (!field || typeof field.id !== 'string' || !/^[\w-]{1,60}$/.test(field.id) || ids.has(field.id)) return 'Ungültige Textfeldkennung.';ids.add(field.id);
    if (typeof field.text !== 'string' || field.text.length > 2048) return 'Ein Textfeld darf höchstens 2048 Zeichen enthalten.';
    const invalidText = textError(field.text);if (invalidText) return invalidText;
    if (![field.x, field.y, field.width, field.height, field.size].every(Number.isFinite) || field.x < 0 || field.y < 0 || field.width < 4 || field.height < 3 || field.x + field.width > area.width + .02 || field.y + field.height > area.height + .02 || field.size < 6 || field.size > 120) return 'Ein Textfeld liegt außerhalb des Druckbereichs oder hat eine ungültige Größe.';
    if (typeof field.font !== 'string' || !Object.hasOwn(FONTS, field.font) || !['left', 'center', 'right'].includes(field.align) || typeof field.bold !== 'boolean' || !/^#[0-9a-f]{6}$/i.test(field.color)) return 'Ungültige Textformatierung.';
   }
   const bg = template.background;
   if (bg != null && (!bg || !/^[a-f0-9]{64}\.(pdf|png|jpg)$/.test(bg.id) || typeof bg.name !== 'string' || bg.name.length > 180 || !['application/pdf', 'image/png', 'image/jpeg'].includes(bg.mime))) return 'Ungültige Hintergrundvorlage.';
   if (bg != null && (bg.mime !== ({pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg'})[bg.id.split('.').pop()] || ['width', 'height'].some(key => bg[key] != null && (!Number.isFinite(bg[key]) || bg[key] < 50 || bg[key] > 1000)))) return 'Ungültiges Hintergrundformat.';
  }
  return '';
 }
 function read(value) {
  if (!value || validate(value)) return defaults();const result = clone(value);
  for (const kind of ['single', 'double']) {result[kind].printArea = clone(printArea(result[kind]));for (const field of result[kind].fields) field.text = dateTokens(field.text);}
  return result;
 }
 function resolve(text, record) {return dateTokens(text).replace(/\{([^{}]+)\}/g, (_, token) => record[token] == null ? '' : String(record[token]));}
 function records(rows) {
  return rows.flatMap(row => {
   const pair = [row.spieler_1, row.spieler_2].filter(Boolean), kind = pair.length > 1 ? 'double' : 'single';
   return pair.map((name, index) => ({...row, kind, name, partner: pair.length > 1 ? pair[1 - index] : '', paarung: pair.join(' / ')}));
  });
 }
 function sampleRecord(kind, source = {}) {
  const name = 'Max Mustermann', partner = kind === 'double' ? 'Hans Dampf' : '';
  return {...source, kind, name, partner, paarung: [name, partner].filter(Boolean).join(' / '), spieler_1: name, spieler_2: partner, preview_sample: true};
 }
 function resize(template, width, height) {
  const next = clone(template), sx = width / next.width, sy = height / next.height;
  next.width = width;next.height = height;
  const area = printArea(template), scaled = {x: area.x * sx, y: area.y * sy, width: Math.min(width, Math.max(10, area.width * sx)), height: Math.min(height, Math.max(10, area.height * sy))};
  scaled.x = Math.max(0, Math.min(width - scaled.width, scaled.x));scaled.y = Math.max(0, Math.min(height - scaled.height, scaled.y));next.printArea = clone(area);
  return setPrintArea(next, scaled);
 }
 return {TOKENS, FONTS, MM, MAX_FIELDS, defaults, defaultTemplate, clone, validate, textError, read, resolve, records, sampleRecord, resize, printArea, printAreaError, setPrintArea, absoluteField, constrainField};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = btsCertificateDesign;
