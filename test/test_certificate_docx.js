'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path');
const yauzl = require('yauzl'), {DOMParser} = require('xmldom');
const schema = require('../static/js/certificate_design'), documents = require('../static/js/certificate_document'), exporter = require('../static/js/certificate_docx');
const options = {
 docx: require('../static/vendor/docx'), shapes: require('../static/vendor/docx/shapes.umd.js'),
 PDFLib: require('../static/vendor/pdf-lib.min'), fontkit: require('../static/vendor/fontkit.min'),
 loadFont: field => fs.promises.readFile(path.join(__dirname, '..', documents.fontUrl(field))),
};
const rows = [
 {event_name: 'JE U17', spieler_1: 'Anna Müller & Co.', platz: '1. Platz', disziplin: 'Jungeneinzel', ak: 'U17', veranstaltung_1: 'Jugend-Rangliste 2026', ort: 'Bremen', datum_letztes_spiel: '21.11.2026'},
 {event_name: 'JD U17', spieler_1: 'Zoë García', spieler_2: 'Łukasz Nowak', platz: '2. Platz', disziplin: 'Jungendoppel', ak: 'U17', veranstaltung_1: 'Jugend-Rangliste 2026', ort: 'Bremen', datum_letztes_spiel: '21.11.2026'},
];
const records = schema.records(rows);
function unzip(bytes) {
 return new Promise((resolve, reject) => yauzl.fromBuffer(Buffer.from(bytes), {lazyEntries: true}, (error, zip) => {
  if (error) return reject(error);const files = new Map();zip.on('error', reject);zip.on('end', () => resolve(files));
  zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => {
   if (error) return reject(error);const chunks = [];stream.on('error', reject);stream.on('data', chunk => chunks.push(chunk));
   stream.on('end', () => {files.set(entry.fileName, Buffer.concat(chunks));zip.readEntry();});
  }));zip.readEntry();
 }));
}
function xml(files, name = 'word/document.xml') {
 return new DOMParser({errorHandler: {warning: message => {throw new Error(message);}, error: message => {throw new Error(message);}, fatalError: message => {throw new Error(message);}}}).parseFromString(files.get(name).toString(), 'application/xml');
}
const elements = (root, name) => Array.from(root.getElementsByTagName(name));
async function artifact(name, bytes) {
 if (!process.env.BTS_DOCX_ARTIFACT_DIR) return;
 await fs.promises.mkdir(process.env.BTS_DOCX_ARTIFACT_DIR, {recursive: true});await fs.promises.writeFile(path.join(process.env.BTS_DOCX_ARTIFACT_DIR, name), bytes);
}
describe('Editable certificate DOCX export', function() {
 this.timeout(30000);
 it('writes one correctly sized section per recipient with editable, escaped text and the right doubles partners', async () => {
  const design = schema.defaults();design.double = schema.resize(design.double, 297, 210);const before = schema.clone(design), progress = [];
  const bytes = await exporter.createDocx(design, records, {...options, onProgress: (done, total) => progress.push([done, total])});
  const files = await unzip(bytes), root = xml(files), sections = elements(root, 'w:sectPr'), boxes = elements(root, 'w:txbxContent');
  assert.strictEqual(sections.length, 3);assert.strictEqual(boxes.length, 23);
  const text = elements(root, 'w:t').map(node => node.textContent).join('|');
  for (const value of ['Anna Müller & Co.', 'Zoë García', 'Łukasz Nowak', 'mit Łukasz Nowak', 'mit Zoë García', 'Jugend-Rangliste 2026', 'Bremen · 21.11.2026']) assert(text.includes(value));
  assert(!text.includes('{name}'));assert(!text.includes('Max Mustermann'));
  const sizes = elements(root, 'w:pgSz').map(node => [node.getAttribute('w:w'), node.getAttribute('w:h'), node.getAttribute('w:orient')]);
  assert.deepStrictEqual(sizes, [['11906', '16838', 'portrait'], ['16838', '11906', 'landscape'], ['16838', '11906', 'landscape']]);
  assert.deepStrictEqual(progress, [[1, 3], [2, 3], [3, 3]]);assert.deepStrictEqual(design, before);
  assert(![...files.keys()].some(name => name.startsWith('word/media/')));
  for (const [name] of files) if (name.endsWith('.xml') || name.endsWith('.rels')) xml(files, name);
  await artifact('mixed.docx', bytes);await artifact('mixed-reference.pdf', await documents.createPdf(design, records, options));
 });
 it('preserves physical print-area offsets, formatting and fitted multiline text', async () => {
  const design = schema.defaults();design.single.printArea = {x: 30, y: 40, width: 150, height: 200};
  design.single.fields = [{...design.single.fields[1], x: 15, y: 25, width: 100, height: 25, color: '#ab1234', align: 'right', text: 'Name: {name}\n{platz}'}];
  const root = xml(await unzip(await exporter.createDocx(design, records.slice(0, 1), options)));
  const anchor = elements(root, 'wp:anchor')[0];
  assert.strictEqual(elements(anchor, 'wp:positionH')[0].getAttribute('relativeFrom'), 'page');
  assert.strictEqual(elements(anchor, 'wp:positionV')[0].getAttribute('relativeFrom'), 'page');
  assert.strictEqual(elements(anchor, 'wp:posOffset')[0].textContent, String(45 * 36000));
  assert.strictEqual(elements(anchor, 'wp:posOffset')[1].textContent, String(65 * 36000));
  assert(elements(root, 'w:color').some(node => node.getAttribute('w:val') === 'ab1234'));
  assert.deepStrictEqual(elements(root, 'w:jc').map(node => node.getAttribute('w:val')), ['right', 'right', 'right']);
  const fittedSize = Number(elements(root, 'w:sz')[0].getAttribute('w:val')) / 2;assert(fittedSize < 30);
  for (const paragraph of elements(elements(root, 'w:txbxContent')[0], 'w:p')) {
   const spacing = elements(paragraph, 'w:spacing')[0];assert.strictEqual(spacing.getAttribute('w:lineRule'), 'exact');
   assert.strictEqual(Number(spacing.getAttribute('w:line')), Math.round(fittedSize * 1.2 * 20));
  }
  assert.strictEqual(elements(root, 'w:txbxContent').length, 1);assert(elements(root, 'w:t').length >= 2);
 });
 it('keeps left, center and right text aligned within fixed fields, with centered multiline blocks and explicit line heights', async () => {
  const design = schema.defaults();
  for (const kind of ['single', 'double']) {
   design[kind].fields = ['left', 'center', 'right'].flatMap((align, index) => [false, true].map((multiline, second) => ({
    ...design[kind].fields[1], id: align + '-' + second, align, text: multiline ? '{name}\n\n{platz}' : '{name}',
    x: 30, y: 20 + (index * 2 + second) * 40, width: 150, height: 35, size: 20,
   })));
  }
  const bytes = await exporter.createDocx(design, records, options), root = xml(await unzip(bytes));
  const boxes = elements(root, 'wps:wsp'), fields = records.flatMap(record => design[record.kind].fields);
  assert.strictEqual(boxes.length, fields.length);
  for (const [index, box] of boxes.entries()) {
   const field = fields[index], body = elements(box, 'wps:bodyPr')[0], extent = elements(box, 'a:ext')[0];
   assert.strictEqual(body.getAttribute('wrap'), 'square');assert.strictEqual(body.getAttribute('anchor'), 'ctr');
   for (const side of ['lIns', 'rIns', 'tIns', 'bIns']) assert.strictEqual(body.getAttribute(side), '0');
   assert.strictEqual(extent.getAttribute('cx'), String(field.width * 36000));
   assert.strictEqual(extent.getAttribute('cy'), String(field.height * 36000));
   assert.strictEqual(elements(body, 'a:noAutofit').length, 1);
   assert.strictEqual(elements(body, 'a:spAutoFit').length, 0);assert.strictEqual(elements(body, 'a:normAutofit').length, 0);
   const paragraphs = elements(box, 'w:p');assert.strictEqual(paragraphs.length, field.text.split('\n').length);
   for (const paragraph of paragraphs) {
    assert.strictEqual(elements(paragraph, 'w:jc')[0].getAttribute('w:val'), field.align);
    const spacing = elements(paragraph, 'w:spacing')[0];
    assert.strictEqual(spacing.getAttribute('w:lineRule'), 'exact');assert.strictEqual(spacing.getAttribute('w:line'), '480');
    assert.strictEqual(spacing.getAttribute('w:before'), '0');assert.strictEqual(spacing.getAttribute('w:after'), '0');
    assert.strictEqual(elements(elements(paragraph, 'w:pPr')[0], 'w:sz')[0].getAttribute('w:val'), '40');
   }
  }
  await artifact('alignment.docx', bytes);await artifact('alignment-reference.pdf', await documents.createPdf(design, records, options));
 });
 it('embeds all regular and bold fonts as recoverable font files with real family names', async () => {
  const design = schema.defaults(), styles = Object.keys(schema.FONTS).flatMap(font => [false, true].map(bold => ({font, bold})));
  design.single.fields = styles.map((style, index) => ({...design.single.fields[1], ...style, id: 'font-' + index, text: 'Änne Müller · Łukasz Nowak · Zoë García', y: 5 + index * 17, height: 14, size: 13}));
  const bytes = await exporter.createDocx(design, [{kind: 'single'}], options), files = await unzip(bytes);
  const table = xml(files, 'word/fontTable.xml'), rels = xml(files, 'word/_rels/fontTable.xml.rels'), fonts = elements(table, 'w:font');
  const relations = new Map(elements(rels, 'Relationship').map(node => [node.getAttribute('Id'), node.getAttribute('Target')]));
  assert.strictEqual(fonts.length, 8);assert.strictEqual([...files.keys()].filter(name => name.endsWith('.odttf')).length, 16);
  for (const [index, key] of Object.keys(schema.FONTS).entries()) for (const bold of [false, true]) {
   const entry = elements(fonts[index], bold ? 'w:embedBold' : 'w:embedRegular')[0];assert(entry);
   const target = 'word/' + relations.get(entry.getAttribute('r:id')), decoded = Buffer.from(files.get(target));
   const guid = entry.getAttribute('w:fontKey').replace(/[^a-f\d]/gi, ''), mask = Buffer.from(guid, 'hex').reverse();
   for (let i = 0; i < 32; i++) decoded[i] ^= mask[i % 16];
   const original = await options.loadFont({font: key, bold});assert.deepStrictEqual(decoded, original);
   assert(!fonts[index].getAttribute('w:name').includes('BTS Certificate'));
  }
  await artifact('fonts.docx', bytes);
 });
 it('includes a reusable image background only for templates that print it', async () => {
  const design = schema.defaults(), image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1cAAAAASUVORK5CYII=', 'base64');
  for (const kind of ['single', 'double']) design[kind].background = {id: 'a'.repeat(64) + '.pdf', name: 'Briefpapier.pdf', mime: 'application/pdf'};
  design.single.backgroundPreviewOnly = true;const rendered = [];
  const bytes = await exporter.createDocx(design, records, {...options, renderBackground: async template => {rendered.push(template);return image;}});
  const files = await unzip(bytes), root = xml(files);assert.strictEqual(rendered.length, 1);assert.strictEqual(rendered[0], design.double);
  assert.strictEqual(elements(root, 'pic:pic').length, 2);assert.strictEqual([...files.keys()].filter(name => name.startsWith('word/media/')).length, 1);
  design.double.backgroundPreviewOnly = true;
  const without = await unzip(await exporter.createDocx(design, records, {...options, renderBackground: () => {throw new Error('Preview-only background must not be fetched');}}));
  assert(![...without.keys()].some(name => name.startsWith('word/media/')));
 });
 it('rejects invalid designs, empty selections, missing fonts and overflowing text without creating a partial file', async () => {
  await assert.rejects(exporter.createDocx(schema.defaults(), [], options), /keine Urkunden/);
  const design = schema.defaults();design.single.fields[0].text = '{unknown}';await assert.rejects(exporter.createDocx(design, records, options), /Unbekannter Platzhalter/);
  await assert.rejects(exporter.createDocx(schema.defaults(), records, {...options, loadFont: async () => {throw new Error('font unavailable');}}), /font unavailable/);
  design.single.fields = [{...schema.defaults().single.fields[1], width: 4, height: 3, text: 'Langer Text '.repeat(50)}];
  await assert.rejects(exporter.createDocx(design, records, options), /passt nicht/);
 });
 it('honors cancellation before work, while rendering backgrounds and between recipients', async () => {
  const early = new AbortController();early.abort();await assert.rejects(exporter.createDocx(schema.defaults(), records, {...options, signal: early.signal}), /abgebrochen/);
  const during = new AbortController(), progress = [];
  await assert.rejects(exporter.createDocx(schema.defaults(), records, {...options, signal: during.signal, onProgress: done => {progress.push(done);during.abort();}}), /abgebrochen/);
  assert.deepStrictEqual(progress, [1]);
  const design = schema.defaults(), background = new AbortController();design.single.background = {id: 'b'.repeat(64) + '.png', name: 'Bild', mime: 'image/png'};
  await assert.rejects(exporter.createDocx(design, records, {...options, signal: background.signal, renderBackground: async () => {background.abort();return new Uint8Array();}}), /abgebrochen/);
 });
});
