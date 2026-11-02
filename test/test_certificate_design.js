'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const {promisify} = require('util');
const schema = require('../static/js/certificate_design');
const documents = require('../static/js/certificate_document');
const PDFLib = require('../static/vendor/pdf-lib.min'), fontkit = require('../static/vendor/fontkit.min');
const assets = require('../bts/certificate_assets'), admin = require('../bts/admin'), database = require('../bts/database');
const font = field => fs.promises.readFile(path.join(__dirname, '..', documents.fontUrl(field)));
const rows = [{event_name: 'JE U17', spieler_1: 'Anna Müller', platz: '1. Platz', disziplin: 'Jungeneinzel', ak: 'U17'}, {event_name: 'JD U17', spieler_1: 'Zoë García', spieler_2: 'Łukasz Nowak', platz: '2. Platz', disziplin: 'Jungendoppel', ak: 'U17'}];
describe('Certificate design and PDF generation', function() {
 this.timeout(20000);
 it('provides independent valid templates for singles and doubles', () => {
  const value = schema.defaults();assert.strictEqual(schema.validate(value), '');value.single.fields[0].text = 'Einzel';assert.notStrictEqual(value.double.fields[0].text, 'Einzel');
  assert(value.double.fields.some(field => field.text.includes('{partner}')));
  assert.strictEqual(value.single.backgroundPreviewOnly, false);assert.strictEqual(value.double.backgroundPreviewOnly, false);
 });
 it('rejects invalid fields, unknown placeholders and nonlocal background identifiers', () => {
  for (const mutate of [value => {value.single.fields[0].x = -1;}, value => {value.single.fields[0].text = '{unknown}';}, value => {value.single.background = {id: '../file.pdf', name: 'x', mime: 'application/pdf'};}, value => {value.double.fields.push(value.double.fields[0]);}, value => {value.single.backgroundPreviewOnly = 'true';}]) {
   const value = schema.defaults();mutate(value);assert(schema.validate(value));
  }
  for (const background of [{id: 'a'.repeat(64) + '.pdf', name: 'x', mime: 'image/png'}, {id: 'a'.repeat(64) + '.pdf', name: 'x', mime: 'application/pdf', width: 'invalid'}]) {const value = schema.defaults();value.single.background = background;assert(schema.validate(value));}
  for (const family of ['Arial', '__proto__', '../private', 'missing', ['sans'], null, {}]) {const value = schema.defaults();value.single.fields[0].font = family;assert(schema.validate(value));}
 });
 it('ships real regular and bold files, CSS font faces and licenses for every selectable font family', async () => {
  const css = await fs.promises.readFile(path.join(__dirname, '../static/css/leitstand.css'), 'utf8');
  assert.strictEqual(Object.keys(schema.FONTS).length, 8);
  for (const [key, family] of Object.entries(schema.FONTS)) for (const bold of [false, true]) {
   const field = {font: key, bold}, filename = family[bold ? 'bold' : 'regular'];assert.strictEqual(documents.fontUrl(field), '/static/fonts/certificates/' + filename);
   const face = fontkit.create(await font(field));assert(face.familyName);assert.strictEqual(/bold/i.test(face.subfamilyName), bold);
   assert(!face['OS/2'].fsType.noEmbedding && !face['OS/2'].fsType.noSubsetting && !face['OS/2'].fsType.bitmapOnly);
   for (const letter of 'ÄÖÜäöüßŁukasz Zoë García Őğșț – ·') assert(face.hasGlyphForCodePoint(letter.codePointAt(0)), key + ': ' + letter);
   assert(css.includes(`font-family:'${family.family}'; src:url('../fonts/certificates/${filename}') format('truetype'); font-weight:${bold ? '700' : '400'}`));
   const design = schema.defaults();design.single.fields[0].font = key;design.single.fields[0].bold = bold;assert.strictEqual(schema.validate(design), '');assert.deepStrictEqual(schema.read(design), design);
  }
  for (const [file, license] of [['LICENSE', 'bitstream-vera'], ['DEJAVU-UPSTREAM-LICENSE', 'Arev Fonts Copyright'], ['LIBERATION-LICENSE', 'SIL OPEN FONT LICENSE'], ['NOTO-LICENSE', 'License: OFL-1.1'], ['YRSA-LICENSE', 'SIL OPEN FONT LICENSE']]) assert((await fs.promises.readFile(path.join(__dirname, '../static/fonts/certificates', file), 'utf8')).includes(license));
 });
 it('embeds all sixteen real font faces in the PDF and loads each face only once regardless of repeated fields', async () => {
  const value = schema.defaults(), styles = Object.keys(schema.FONTS).flatMap(family => [false, true].map(bold => ({font: family, bold})));
  value.single.fields = styles.map((style, index) => ({...value.single.fields[1], ...style, id: 'font-' + index, text: 'Änne Müller · Łukasz Nowak · Zoë García', y: 10 + index * 16, height: 12, size: 14}));
  const loaded = [], data = await documents.createPdf(value, [{kind: 'single'}, {kind: 'single'}], {PDFLib, fontkit, loadFont(field) {loaded.push(documents.fontUrl(field));return font(field);}});
  const pdf = await PDFLib.PDFDocument.load(data);assert.strictEqual(pdf.getPageCount(), 2);assert.strictEqual(loaded.length, 16);assert.strictEqual(new Set(loaded).size, 16);
  for (const page of pdf.getPages()) {
   const fonts = page.node.Resources().lookup(PDFLib.PDFName.of('Font'));assert.strictEqual(fonts.keys().length, 16);
   for (const key of fonts.keys()) {
    const embedded = fonts.lookup(key), descendant = embedded.lookup(PDFLib.PDFName.of('DescendantFonts')).lookup(0), descriptor = descendant.lookup(PDFLib.PDFName.of('FontDescriptor'));
    assert(descriptor.has(PDFLib.PDFName.of('FontFile2')));
   }
  }
 });
 it('creates one record per person with the correct doubles partner', () => {
  const result = schema.records(rows);assert.strictEqual(result.length, 3);assert.strictEqual(result[1].name, 'Zoë García');assert.strictEqual(result[1].partner, 'Łukasz Nowak');assert.strictEqual(result[2].name, 'Łukasz Nowak');assert.strictEqual(result[2].partner, 'Zoë García');
 });
 it('resolves placeholders literally and preserves international names', () => {
  assert.strictEqual(schema.resolve('{name} / {partner} – {platz}', schema.records(rows)[1]), 'Zoë García / Łukasz Nowak – 2. Platz');
 });
 it('validates and resolves the independent date placeholders for real recipients and specimen records', () => {
  const value = schema.defaults(), text = '{datum_heute} / {datum_letztes_spiel}';value.single.fields[0].text = text;value.double.fields[0].text = text;assert.strictEqual(schema.validate(value), '');
  const source = schema.records([{...rows[1], datum: '26.09.2026', datum_heute: '02.11.2026', datum_letztes_spiel: '25.09.2026'}])[0];
  for (const record of [source, schema.sampleRecord('double', source)]) assert.strictEqual(schema.resolve(text, record), '02.11.2026 / 25.09.2026');
  assert.strictEqual(schema.resolve('Letztes Spiel: {datum_letztes_spiel}', {...source, datum_letztes_spiel: ''}), 'Letztes Spiel: ');
 });
 it('migrates older date tokens without resetting custom templates or changing their formatting', () => {
  const value = schema.defaults();value.single.fields[1].x = 25;value.single.fields[1].color = '#aa1122';value.single.fields[1].text = '{datum} / {datum_finale}';
  const before = schema.clone(value), restored = schema.read(value);assert.strictEqual(schema.validate(value), '');assert.strictEqual(schema.validate(restored), '');
  const expected = schema.clone(value);expected.single.fields[1].text = '{datum_letztes_spiel} / {datum_letztes_spiel}';assert.deepStrictEqual(restored, expected);assert.deepStrictEqual(value, before);
  assert.strictEqual(schema.resolve('{datum} / {datum_finale}', {datum: '26.09.2026', datum_letztes_spiel: '28.09.2026'}), '28.09.2026 / 28.09.2026');
  assert(!schema.TOKENS.includes('datum'));assert(!schema.TOKENS.includes('datum_finale'));assert(schema.TOKENS.includes('datum_letztes_spiel'));
 });
 it('uses fixed sample names while retaining tournament, discipline and placement data without changing the source', () => {
  const source = {...schema.records(rows)[1], veranstaltung_1: 'Nord-Cup', veranstaltung_2: 'Bremen', ort: 'Bremen', datum: '26.09.2026'}, before = schema.clone(source);
  const sample = schema.sampleRecord('double', source);assert.strictEqual(sample.name, 'Max Mustermann');assert.strictEqual(sample.partner, 'Hans Dampf');assert.strictEqual(sample.paarung, 'Max Mustermann / Hans Dampf');assert.strictEqual(sample.spieler_1, sample.name);assert.strictEqual(sample.spieler_2, sample.partner);
  for (const key of ['veranstaltung_1', 'veranstaltung_2', 'ort', 'datum', 'disziplin', 'ak', 'platz']) assert.strictEqual(sample[key], source[key]);assert.deepStrictEqual(source, before);
  const single = schema.sampleRecord('single', schema.records(rows)[0]);assert.strictEqual(single.name, 'Max Mustermann');assert.strictEqual(single.partner, '');assert.strictEqual(single.paarung, 'Max Mustermann');
 });
 it('scales field positions with the page while preserving valid dimensions', () => {
  const value = schema.defaults();value.single = schema.resize(value.single, 297, 210);assert.strictEqual(schema.validate(value), '');assert.strictEqual(value.single.width, 297);
  for (const width of [50.07, 123.45, 297.000083333, 777.777, 999.9]) {const resized = schema.resize(schema.resize(value.single, width, 842.1234), 210.12345, 297);assert.strictEqual(schema.validate({...value, single: resized}), '');}
 });
 it('opens older layouts with a full-page print area and unchanged absolute field positions', () => {
  const value = schema.defaults();delete value.single.printArea;delete value.double.printArea;assert.strictEqual(schema.validate(value), '');
  const restored = schema.read(value);assert.deepStrictEqual(restored.single.printArea, {x: 0, y: 0, width: 210, height: 297});assert.deepStrictEqual(restored.single.fields, value.single.fields);
  assert.deepStrictEqual(schema.absoluteField(restored.single, restored.single.fields[1]), value.single.fields[1]);
 });
 it('moves and scales all fields relative to the print area without changing font sizes or the other template', () => {
  const value = schema.defaults(), before = schema.clone(value), area = {x: 30, y: 40, width: 150, height: 220};value.single = schema.setPrintArea(value.single, area);
  assert.strictEqual(schema.validate(value), '');assert.deepStrictEqual(value.double, before.double);const field = value.single.fields[1], absolute = schema.absoluteField(value.single, field);
  assert(Math.abs(field.x - 20 * 150 / 210) < .00001);assert(Math.abs(field.y - 96 * 220 / 297) < .00001);assert.strictEqual(absolute.x, 30 + field.x);assert.strictEqual(absolute.y, 40 + field.y);assert.strictEqual(field.size, before.single.fields[1].size);
  const moved = schema.setPrintArea(value.single, {...area, x: 40});assert.deepStrictEqual(moved.fields, value.single.fields);
  const resized = schema.resize(value.single, 297, 210);assert(Math.abs(resized.printArea.x - area.x * 297 / 210) < .00001);assert.strictEqual(schema.validate({...value, single: resized}), '');
 });
 it('rejects invalid print areas and fields beyond their bounds and keeps small resized layouts valid', () => {
  for (const area of [null, {x: -1, y: 0, width: 100, height: 100}, {x: 0, y: 0, width: 211, height: 100}, {x: 0, y: 0, width: 9, height: 100}, {x: 0, y: NaN, width: 100, height: 100}]) {const value = schema.defaults();value.single.printArea = area;assert(schema.validate(value).includes('Druckbereich'));}
  const value = schema.defaults();value.single = schema.setPrintArea(value.single, {x: 20, y: 30, width: 150, height: 200});value.single.fields[0].x = 100;assert(schema.validate(value).includes('Druckbereich'));
  const small = schema.setPrintArea(schema.defaults().single, {x: 200, y: 287, width: 10, height: 10});assert.strictEqual(schema.validate({...schema.defaults(), single: schema.resize(small, 50, 50)}), '');
 });
 it('writes centered text at the print-area offset in the actual PDF without printing its guide', async () => {
  const value = schema.defaults();value.single.printArea = {x: 30, y: 40, width: 150, height: 200};value.single.fields = [{...value.single.fields[1], x: 15, y: 25, width: 120, height: 20}];
  const records = schema.records(rows.slice(0, 1)), bytes = await documents.createPdf(value, records, {PDFLib, fontkit, loadFont: font}), pdf = await PDFLib.PDFDocument.load(bytes), page = pdf.getPage(0);
  const streams = page.node.Contents().asArray().map(ref => Buffer.from(PDFLib.decodePDFRawStream(pdf.context.lookup(ref)).decode()).toString('utf8')).join('\n');
  const matrix = /1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/.exec(streams);assert(matrix);
  const metrics = await PDFLib.PDFDocument.create();metrics.registerFontkit(fontkit);const embedded = await metrics.embedFont(await font(value.single.fields[0])), field = value.single.fields[0], textWidth = embedded.widthOfTextAtSize(records[0].name, field.size);
  assert(Math.abs(Number(matrix[1]) + textWidth / 2 - (30 + 150 / 2) * schema.MM) < .00001);
  const face = fontkit.create(await font(field)), ink = face.layout(records[0].name).bbox, scale = field.size / face.unitsPerEm;
  const top = page.getHeight() - Number(matrix[2]) - ink.maxY * scale, bottom = page.getHeight() - Number(matrix[2]) - ink.minY * scale;
  assert(Math.abs((top + bottom) / 2 - (40 + 25 + field.height / 2) * schema.MM) < .00001);
  assert(!/\bre\b/.test(streams));
 });
 it('generates a real three-page PDF using separate single and double formats', async () => {
  const value = schema.defaults();value.double = schema.resize(value.double, 297, 210);
  const bytes = await documents.createPdf(value, schema.records(rows), {PDFLib, fontkit, loadFont: font});
  const pdf = await PDFLib.PDFDocument.load(bytes);assert.strictEqual(pdf.getPageCount(), 3);assert(Math.abs(pdf.getPage(0).getWidth() - 210 * schema.MM) < .01);assert(Math.abs(pdf.getPage(1).getWidth() - 297 * schema.MM) < .01);assert(bytes.length > 10000);
 });
 it('preserves a rotated PDF background and the configured physical page size', async () => {
  const source = await PDFLib.PDFDocument.create(), background = source.addPage([500, 300]);background.drawRectangle({x: 10, y: 10, width: 100, height: 80, color: PDFLib.rgb(1, 0, 0)});background.setRotation(PDFLib.degrees(90));
  const value = schema.defaults();delete value.single.backgroundPreviewOnly;value.single.background = {id: 'a'.repeat(64) + '.pdf', name: 'Vorlage.pdf', mime: 'application/pdf'};
  const data = await documents.createPdf(value, schema.records(rows.slice(0, 1)), {PDFLib, fontkit, loadFont: font, loadBackground: () => source.save()});
  const pdf = await PDFLib.PDFDocument.load(data), page = pdf.getPage(0);assert(page.node.Resources().lookup(PDFLib.PDFName.of('XObject')).keys().length > 0);assert.strictEqual(pdf.getPageCount(), 1);
 });
 it('omits preview-only PDF and image backgrounds independently without loading them or changing the page size', async () => {
  const value = schema.defaults();value.single = schema.resize(value.single, 297, 210);value.single.backgroundPreviewOnly = true;
  value.single.background = {id: 'a'.repeat(64) + '.pdf', name: 'Briefpapier.pdf', mime: 'application/pdf'};
  value.double.background = {id: 'b'.repeat(64) + '.png', name: 'Doppel.png', mime: 'image/png'};
  const loaded = [], image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  const mixed = await PDFLib.PDFDocument.load(await documents.createPdf(value, schema.records(rows), {PDFLib, fontkit, loadFont: font, loadBackground: background => {loaded.push(background.id);return image;}}));
  const images = page => page.node.Resources().lookup(PDFLib.PDFName.of('XObject'))?.keys().length || 0;
  assert.deepStrictEqual(loaded, [value.double.background.id]);assert.strictEqual(images(mixed.getPage(0)), 0);assert(images(mixed.getPage(1)) > 0);
  value.double.backgroundPreviewOnly = true;const before = schema.clone(value);
  const plain = await PDFLib.PDFDocument.load(await documents.createPdf(value, schema.records(rows), {PDFLib, fontkit, loadFont: font, loadBackground() {throw new Error('Preview backgrounds must not be loaded for output');}}));
  assert.strictEqual(plain.getPageCount(), 3);assert(plain.getPages().every(page => images(page) === 0));
  assert(Math.abs(plain.getPage(0).getWidth() - 297 * schema.MM) < .01);assert(Math.abs(plain.getPage(1).getWidth() - 210 * schema.MM) < .01);
  assert(plain.getPages().every(page => page.node.Resources().lookup(PDFLib.PDFName.of('Font')).keys().length > 0));assert.deepStrictEqual(value, before);
 });
 it('wraps long names within the field without silently truncating them', async () => {
  const pdf = await PDFLib.PDFDocument.create();pdf.registerFontkit(fontkit);const data = await font({font: 'sans', bold: false}), embedded = await pdf.embedFont(data), face = fontkit.create(data);
  const field = {text: '{name}', x: 10, y: 10, width: 80, height: 30, size: 30, align: 'center'};
  const name = 'Anna Maria Müller García Mit Einem Sehr Langen Namen';const lines = documents.layout(field, {name}, {pdf: embedded, face});
  assert.strictEqual(lines.map(line => line.text).join(' '), name);assert(lines.length > 1);assert(lines.every(line => embedded.widthOfTextAtSize(line.text, line.size) <= field.width * schema.MM + .01));
 });
 it('can lay out literal placeholders without replacing or altering the saved field text', async () => {
  const pdf = await PDFLib.PDFDocument.create();pdf.registerFontkit(fontkit);const data = await font({font: 'sans', bold: false}), metrics = {pdf: await pdf.embedFont(data), face: fontkit.create(data)};
  const field = {text: '{name} / {partner} – {platz}', x: 10, y: 10, width: 170, height: 30, size: 18, align: 'center'}, before = schema.clone(field), record = schema.records(rows)[1];
  assert.strictEqual(documents.layout(field, record, metrics, {replacePlaceholders: false}).map(line => line.text).join(' '), field.text);
  assert.strictEqual(documents.layout(field, record, metrics).map(line => line.text).join(' '), 'Zoë García / Łukasz Nowak – 2. Platz');assert.deepStrictEqual(field, before);
 });
 it('centers single-line, multiline and reduced text blocks vertically for each supported font', async () => {
  const pdf = await PDFLib.PDFDocument.create();pdf.registerFontkit(fontkit);
  for (const family of Object.keys(schema.FONTS)) for (const bold of [false, true]) {
   const data = await font({font: family, bold}), embedded = await pdf.embedFont(data), face = fontkit.create(data);
   for (const [name, width, height] of [['1. Platz', 150, 30], ['Änne Günther\nJörg Müller', 150, 40], ['Anna Maria Müller García Mit Einem Sehr Langen Namen', 40, 20]]) {
    const field = {text: '{name}', x: 15, y: 35, width, height, size: 30, align: 'center'}, lines = documents.layout(field, {name}, {pdf: embedded, face}), size = lines[0].size;
    const bounds = lines.map(line => ({line, ink: face.layout(line.text).bbox})), scale = size / face.unitsPerEm / schema.MM;
    const top = Math.min(...bounds.map(({line, ink}) => line.y - ink.maxY * scale)), bottom = Math.max(...bounds.map(({line, ink}) => line.y - ink.minY * scale));
    assert(Math.abs((top + bottom) / 2 - (field.y + field.height / 2)) < .00001);assert(top >= field.y - .01);assert(bottom <= field.y + field.height + .01);
    const taller = documents.layout({...field, height: height + 10, size}, {name}, {pdf: embedded, face});
    assert.deepStrictEqual(taller.map(line => line.text), lines.map(line => line.text));assert(taller.every((line, index) => Math.abs(line.y - lines[index].y - 5) < .00001 && line.x === lines[index].x));
    if (width === 40) {assert(lines.length > 1);assert(size < field.size);}
   }
  }
 });
 it('rejects unsupported characters and cancelled generations instead of producing broken documents', async () => {
  const value = schema.defaults();await assert.rejects(documents.createPdf(value, [{kind: 'single', name: 'Test 🦄'}], {PDFLib, fontkit, loadFont: font}), /nicht unterstützt/);
  const controller = new AbortController();controller.abort();await assert.rejects(documents.createPdf(value, schema.records(rows), {signal: controller.signal, PDFLib, fontkit, loadFont: font}), /abgebrochen/);
 });
 it('rejects malformed designs before the administrative database is touched', () => {
  const value = schema.defaults();value.single.fields[0].x = -1;let error;
  admin.handle_tournament_edit_props({db: {tournaments: {findOne() {throw new Error('Database must not be touched');}}}}, {respond(_message, err) {error = err;}}, {key: 'design-test', props: {certificate_design: value}});
  assert(error.message.includes('Textfeld'));
 });
 it('persists both templates and their background references through the administrative save API', async () => {
  const db = await database.init_test();await promisify(db.tournaments.insert.bind(db.tournaments))({key: 'design-save', displaysettings_general: 'display', displaysettings_general_tablet: 'tablet'});
  const value = schema.defaults();value.single = schema.setPrintArea(value.single, {x: 20, y: 30, width: 150, height: 200});value.single.fields[0].text = 'Einzelauszeichnung';value.single.fields[0].font = 'yrsa';value.single.backgroundPreviewOnly = true;value.double.fields[0].text = 'Doppelauszeichnung';value.double.fields[0].font = 'noto-serif';value.double.background = {id: 'a'.repeat(64) + '.png', name: 'Doppel.png', mime: 'image/png', width: 210, height: 297};
  await new Promise((resolve, reject) => admin.handle_tournament_edit_props({db}, {respond(_message, err) {if (err) reject(err);else resolve();}}, {key: 'design-save', props: {certificate_design: value}}));
  assert.deepStrictEqual((await promisify(db.tournaments.findOne.bind(db.tournaments))({key: 'design-save'})).certificate_design, value);
 });
});
describe('Certificate background storage', function() {
 let directory, app;
 beforeEach(async () => {
  directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bts-certificate-assets-'));const db = await database.init_test();await promisify(db.tournaments.insert.bind(db.tournaments))({key: 'design-test'});app = {db, certificate_assets_directory: directory};
 });
 afterEach(async () => {await fs.promises.rm(directory, {recursive: true, force: true});});
 function upload(bytes, key = 'design-test') {
  return new Promise(resolve => assets.upload({app, params: {tournament_key: key}, body: bytes, get: () => encodeURIComponent('Urkunden.pdf')}, {statusCode: 200, status(code) {this.statusCode = code;return this;}, json(body) {resolve({status: this.statusCode, body});}}));
 }
 it('stores identical uploads once and returns only small metadata', async () => {
  const data = Buffer.from('%PDF-1.7\nfixture');const first = await upload(data), second = await upload(data);
  assert.strictEqual(first.status, 200);assert.strictEqual(first.body.background.id, second.body.background.id);assert.strictEqual(first.body.background.name, 'Urkunden.pdf');assert(!JSON.stringify(first.body).includes('base64'));
  const folders = await fs.promises.readdir(directory);assert.strictEqual((await fs.promises.readdir(path.join(directory, folders[0]))).length, 1);
 });
 it('serves the exact stored background only within its tournament namespace', async () => {
  const data = Buffer.from('%PDF-1.7\nstored background'), {body} = await upload(data);
  function get(key) {return new Promise(resolve => {
   const result = {headers: {}, status: 200};
   assets.get({app, params: {tournament_key: key, asset_id: body.background.id}}, {headersSent: false, set(name, value) {result.headers[name] = value;}, type(mime) {result.mime = mime;}, status(code) {result.status = code;return this;}, end() {resolve(result);}, async sendFile(filename, done) {try {result.data = await fs.promises.readFile(filename);resolve(result);} catch (_) {done({statusCode: 404});}}});
  });}
  const saved = await get('design-test');assert(saved.data.equals(data));assert.strictEqual(saved.mime, 'application/pdf');assert.strictEqual(saved.headers['X-Content-Type-Options'], 'nosniff');assert.strictEqual((await get('other-tournament')).status, 404);
 });
 it('rejects unknown tournaments, unsupported files and oversized uploads', async () => {
  assert.strictEqual((await upload(Buffer.from('%PDF-1.7'), 'missing')).status, 404);assert.strictEqual((await upload(Buffer.from('<svg/>'))).status, 400);assert.strictEqual((await upload(Buffer.alloc(assets.MAX_BYTES + 1))).status, 400);
 });
 it('rejects path traversal when fetching a background', () => {
  let status;assets.get({app, params: {tournament_key: 'design-test', asset_id: '../../private'}}, {status(code) {status = code;return this;}, end() {}});assert.strictEqual(status, 404);
 });
});
