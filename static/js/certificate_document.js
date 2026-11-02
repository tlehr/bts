/* global btsCertificateDesign */
'use strict';
// PDF generation and preview share typography and physical coordinates.
// eslint-disable-next-line no-unused-vars -- Used by the certificate workspace.
var btsCertificateDocument = (() => {
 const scripts = new Map(), bytes = new Map(), typographyFonts = new Map();let pdfjsPromise, typographyPromise;
 const schema = () => typeof btsCertificateDesign !== 'undefined' ? btsCertificateDesign : require('./certificate_design');
 function check(signal) {if (signal?.aborted) throw new Error('Urkundenerzeugung abgebrochen.');}
 function script(url, name) {
  if (globalThis[name]) return Promise.resolve(globalThis[name]);
  if (!scripts.has(url)) scripts.set(url, new Promise((resolve, reject) => {
   const node = document.createElement('script');node.src = url;node.onload = () => resolve(globalThis[name]);node.onerror = () => {scripts.delete(url);node.remove();reject(new Error('Die PDF-Bibliothek konnte nicht geladen werden.'));};document.head.append(node);
  }));
  return scripts.get(url);
 }
 async function libraries() {
  const [PDFLib, fontkit] = await Promise.all([script('/static/vendor/pdf-lib.min.js', 'PDFLib'), script('/static/vendor/fontkit.min.js', 'fontkit')]);
  return {PDFLib, fontkit};
 }
 async function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('/static/vendor/pdfjs/pdf.min.mjs').then(lib => {lib.GlobalWorkerOptions.workerSrc = '/static/vendor/pdfjs/pdf.worker.min.mjs';return lib;}).catch(error => {pdfjsPromise = null;throw error;});
  return pdfjsPromise;
 }
 async function fetchBytes(url) {
  if (!bytes.has(url)) bytes.set(url, fetch(url).then(response => {if (!response.ok) throw new Error('Eine Vorlagendatei konnte nicht geladen werden.');return response.arrayBuffer();}).then(buffer => new Uint8Array(buffer)).catch(error => {bytes.delete(url);throw error;}));
  if (bytes.size > 12) bytes.delete(bytes.keys().next().value);
  return bytes.get(url);
 }
 function assetUrl(key, background) {return '/h/' + encodeURIComponent(key) + '/certificates/background/' + background.id;}
 function fontUrl(field) {return '/static/fonts/certificates/' + schema().FONTS[field.font][field.bold ? 'bold' : 'regular'];}
 function fontKey(field) {return field.font + (field.bold ? '-bold' : '');}
 async function fonts(document, fields, fontkit, loadFont = field => fetchBytes(fontUrl(field))) {
  const result = new Map();
  for (const field of fields) {
   const key = fontKey(field);
   if (!result.has(key)) {const data = await loadFont(field);result.set(key, {pdf: await document.embedFont(data, {subset: true}), face: fontkit.create(data)});}
  }
  return result;
 }
 function wrap(text, font, size, maxWidth) {
  const lines = [];
  for (const paragraph of text.replace(/\r/g, '').split('\n')) {
   if (!paragraph) {lines.push('');continue;}
   let line = '';
   for (const word of paragraph.split(/\s+/).filter(Boolean)) {
    const joined = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(joined, size) <= maxWidth) {line = joined;continue;}
    if (line) {lines.push(line);line = '';}
    for (const letter of word) {
     if (line && font.widthOfTextAtSize(line + letter, size) > maxWidth) {lines.push(line);line = '';}
     line += letter;
    }
   }
   lines.push(line);
  }
  return lines;
 }
 function inkBounds(lines, size, face) {
  const scale = size / face.unitsPerEm;let top = Infinity, bottom = -Infinity;
  lines.forEach((line, index) => {
   const bounds = face.layout(line).bbox;
   if (!Number.isFinite(bounds.minY) || !Number.isFinite(bounds.maxY)) return;
   top = Math.min(top, index * size * 1.2 - bounds.maxY * scale);bottom = Math.max(bottom, index * size * 1.2 - bounds.minY * scale);
  });
  return Number.isFinite(top) ? {top, height: bottom - top} : {top: 0, height: 0};
 }
 function layout(field, record, font, {replacePlaceholders = true} = {}) {
  const {MM, resolve} = schema(), text = replacePlaceholders ? resolve(field.text, record) : field.text, characters = new Set(font.pdf.getCharacterSet());
  for (const letter of text) if (!['\n', '\r', '\t'].includes(letter) && !characters.has(letter.codePointAt(0))) throw new Error('Das Zeichen „' + letter + '“ im Textfeld „' + field.text.slice(0, 35) + '“ wird von der Schrift nicht unterstützt.');
  let size = field.size, lines, ink;
  for (;;) {
   lines = wrap(text, font.pdf, size, field.width * MM);ink = inkBounds(lines, size, font.face);
   if (ink.height <= field.height * MM + .01) break;
   if (size <= 6) throw new Error('Der Text für „' + record.name + '“ passt nicht in das Textfeld „' + field.text.slice(0, 35) + '“. Bitte das Feld vergrößern.');
   size = Math.max(6, size - .5);
  }
  const baseline = (field.height * MM - ink.height) / 2 - ink.top;
  return lines.map((value, index) => {
   const width = font.pdf.widthOfTextAtSize(value, size) / MM;
   const offset = field.align === 'center' ? (field.width - width) / 2 : field.align === 'right' ? field.width - width : 0;
   return {text: value, size, x: field.x + offset, y: field.y + (baseline + index * size * 1.2) / MM};
  });
 }
 async function typography(fields) {
  if (!typographyPromise) typographyPromise = (async () => {
   const {PDFLib, fontkit} = await libraries(), doc = await PDFLib.PDFDocument.create();doc.registerFontkit(fontkit);
   return {doc, fontkit};
  })().catch(error => {typographyPromise = null;throw error;});
  const {doc, fontkit} = await typographyPromise, required = new Map(fields.map(field => [fontKey(field), field])), result = new Map();
  await Promise.all([...required].map(async ([key, field]) => {
   try {
    if (!typographyFonts.has(key)) typographyFonts.set(key, fonts(doc, [field], fontkit).then(set => set.get(key)).catch(error => {typographyFonts.delete(key);throw error;}));
    result.set(key, await typographyFonts.get(key));
    if (typeof document !== 'undefined' && document.fonts) {
     const loaded = await document.fonts.load((field.bold ? '700' : '400') + ' 16px "' + schema().FONTS[field.font].family + '"');
     if (!loaded.length) throw new Error('Font face unavailable');
    }
   } catch (_) {throw new Error('Die Schrift „' + schema().FONTS[field.font].label + '“ konnte nicht geladen werden. Bitte erneut versuchen.');}
  }));
  return result;
 }
 async function previewLines(template, record, options = {}) {
  const set = await typography(template.fields);
  return template.fields.map(field => ({field, lines: layout(schema().absoluteField(template, field), record, set.get(fontKey(field)), options)}));
 }
 function pdfOptions(data) {return {data: data.slice(), isEvalSupported: false, cMapUrl: '/static/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/static/vendor/pdfjs/standard_fonts/', wasmUrl: '/static/vendor/pdfjs/wasm/'};}
 async function inspect(file) {
  if (!file || !file.size || file.size > 8 * 1024 * 1024) throw new Error('Bitte eine Vorlage mit maximal 8 MB auswählen.');
  const source = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(source.subarray(0, 5)) === '%PDF-') {
   const {PDFLib} = await libraries();let doc;
   try {doc = await PDFLib.PDFDocument.load(source, {updateMetadata: false});} catch (_) {throw new Error('Die PDF-Vorlage ist beschädigt oder geschützt und kann nicht gelesen werden.');}
   const page = doc.getPages()[0];if (!page) throw new Error('Die PDF-Vorlage enthält keine Seite.');
   const crop = page.getCropBox(), rotation = ((page.getRotation().angle % 360) + 360) % 360;
   return {blob: new Blob([source], {type: 'application/pdf'}), width: (rotation % 180 ? crop.height : crop.width) / schema().MM, height: (rotation % 180 ? crop.width : crop.height) / schema().MM, pages: doc.getPageCount()};
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Bitte eine PDF-, PNG-, JPEG- oder WebP-Vorlage auswählen.');
  let bitmap;try {bitmap = await createImageBitmap(file);} catch (_) {throw new Error('Die Bildvorlage konnte nicht gelesen werden.');}
  try {
   if (bitmap.width * bitmap.height > 24000000) throw new Error('Die Bildvorlage ist zu groß. Bitte auf höchstens 24 Megapixel verkleinern.');
   const canvas = document.createElement('canvas');canvas.width = bitmap.width;canvas.height = bitmap.height;canvas.getContext('2d').drawImage(bitmap, 0, 0);
   let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
   if (!blob || blob.size > 8 * 1024 * 1024) blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .94));
   if (!blob || blob.size > 8 * 1024 * 1024) throw new Error('Die aufbereitete Bildvorlage überschreitet 8 MB. Bitte das Bild verkleinern.');
   const width = bitmap.width > bitmap.height ? 297 : 210;
   return {blob, width, height: width * bitmap.height / bitmap.width, pages: 1};
  } finally {bitmap.close();}
 }
 async function paintBackground(canvas, template, key) {
  canvas.width = Math.round(template.width * 4);canvas.height = Math.round(template.height * 4);
  const context = canvas.getContext('2d');context.fillStyle = '#ffffff';context.fillRect(0, 0, canvas.width, canvas.height);
  const bg = template.background;if (!bg) return;
  const data = await fetchBytes(assetUrl(key, bg));let image, pdf, task, bitmap, objectUrl;
  try {
   if (bg.mime === 'application/pdf') {
    const lib = await pdfjs();task = lib.getDocument(pdfOptions(data));pdf = await task.promise;
    const page = await pdf.getPage(1), viewport = page.getViewport({scale: 1});
    const scale = Math.min(canvas.width / viewport.width, canvas.height / viewport.height);
    image = document.createElement('canvas');const view = page.getViewport({scale});image.width = Math.ceil(view.width);image.height = Math.ceil(view.height);
    await page.render({canvasContext: image.getContext('2d'), viewport: view}).promise;
   } else {
    objectUrl = URL.createObjectURL(new Blob([data], {type: bg.mime}));image = new Image();image.src = objectUrl;await image.decode();bitmap = image;
   }
   const width = image.width, height = image.height, scale = Math.min(canvas.width / width, canvas.height / height);
   context.drawImage(image, (canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2, width * scale, height * scale);
  } finally {await task?.destroy();bitmap?.close?.();if (objectUrl) URL.revokeObjectURL(objectUrl);}
 }
 async function createPdf(designs, records, options = {}) {
  check(options.signal);
  const invalid = schema().validate(designs);if (invalid) throw new Error(invalid);
  if (!records.length) throw new Error('Für die Auswahl sind keine Urkunden verfügbar.');
  const libs = options.PDFLib ? options : await libraries(), {PDFLib, fontkit} = libs;
  const doc = await PDFLib.PDFDocument.create();doc.registerFontkit(fontkit);doc.setTitle('Urkunden');doc.setCreator('BTS – Turnierleitung');
  const used = records.flatMap(record => designs[record.kind].fields), fontSet = await fonts(doc, used, fontkit, options.loadFont);
  const backgrounds = new Map(), loadBackground = options.loadBackground || (background => fetchBytes(assetUrl(options.tournamentKey, background)));
  async function background(page, template) {
   const bg = template.background;if (!bg || template.backgroundPreviewOnly) return;
   if (!backgrounds.has(bg.id)) {
    const data = await loadBackground(bg);
    if (bg.mime === 'application/pdf') {
     const source = await PDFLib.PDFDocument.load(data, {updateMetadata: false}), sourcePage = source.getPages()[0], crop = sourcePage.getCropBox();
     const embedded = await doc.embedPage(sourcePage, {left: crop.x, bottom: crop.y, right: crop.x + crop.width, top: crop.y + crop.height});
     backgrounds.set(bg.id, {embedded, width: crop.width, height: crop.height, rotation: ((sourcePage.getRotation().angle % 360) + 360) % 360});
    } else {const embedded = bg.mime === 'image/png' ? await doc.embedPng(data) : await doc.embedJpg(data);backgrounds.set(bg.id, {embedded, width: embedded.width, height: embedded.height, rotation: 0, image: true});}
   }
   const item = backgrounds.get(bg.id), rotated = item.rotation % 180, width = rotated ? item.height : item.width, height = rotated ? item.width : item.height;
   const scale = Math.min(page.getWidth() / width, page.getHeight() / height);
   let x = (page.getWidth() - width * scale) / 2, y = (page.getHeight() - height * scale) / 2;
   if (item.rotation === 90) y += item.width * scale;
   if (item.rotation === 180) {x += item.width * scale;y += item.height * scale;}
   if (item.rotation === 270) x += item.height * scale;
   const draw = {x, y, width: item.width * scale, height: item.height * scale, rotate: PDFLib.degrees(item.rotation === 270 ? 90 : -item.rotation)};
   if (item.image) page.drawImage(item.embedded, draw);else page.drawPage(item.embedded, draw);
  }
  for (let index = 0; index < records.length; index++) {
   check(options.signal);const record = records[index], template = designs[record.kind], page = doc.addPage([template.width * schema().MM, template.height * schema().MM]);
   await background(page, template);
   for (const field of template.fields) {
    const font = fontSet.get(fontKey(field)), color = PDFLib.rgb(...[1, 3, 5].map(start => parseInt(field.color.slice(start, start + 2), 16) / 255));
    for (const line of layout(schema().absoluteField(template, field), record, font, options)) if (line.text) page.drawText(line.text, {x: line.x * schema().MM, y: page.getHeight() - line.y * schema().MM, size: line.size, font: font.pdf, color});
   }
   options.onProgress?.(index + 1, records.length);await new Promise(resolve => setTimeout(resolve, 0));
  }
  check(options.signal);return doc.save({objectsPerTick: 20});
 }
 function printPdf(data) {
  return new Promise((resolve, reject) => {
   const url = URL.createObjectURL(new Blob([data], {type: 'application/pdf'})), frame = document.createElement('iframe');
   frame.className = 'certificate-print-frame';frame.title = 'Urkunden drucken';frame.setAttribute('aria-hidden', 'true');
   let timer, loaded = false;
   const cleanup = () => {clearTimeout(timer);frame.remove();URL.revokeObjectURL(url);};
   frame.onload = () => {
    loaded = true;clearTimeout(timer);
    try {frame.contentWindow.addEventListener('afterprint', cleanup, {once: true});frame.contentWindow.focus();frame.contentWindow.print();resolve();timer = setTimeout(cleanup, 120000);}
    catch (_) {cleanup();reject(new Error('Der Druckdialog konnte nicht geöffnet werden. Bitte die PDF herunterladen und von dort drucken.'));}
   };
   frame.onerror = () => {cleanup();reject(new Error('Die Druckansicht konnte nicht geladen werden.'));};
   frame.src = url;document.body.append(frame);timer = setTimeout(() => {if (!loaded) {cleanup();reject(new Error('Die Druckansicht konnte nicht geladen werden. Bitte die PDF herunterladen und von dort drucken.'));}}, 20000);
  });
 }

 return {libraries, previewLines, inspect, paintBackground, createPdf, printPdf, layout, fontUrl, assetUrl};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = btsCertificateDocument;
