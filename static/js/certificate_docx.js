/* global btsCertificateDesign, btsCertificateDocument, btsLibraries */
'use strict';

// The same records, physical coordinates, fonts and wrapping as the PDF export;
// every field remains an editable Word text box.
var btsCertificateDocx = (() => {
 const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 const schema = () => typeof btsCertificateDesign !== 'undefined' ? btsCertificateDesign : require('./certificate_design');
 const documents = () => typeof btsCertificateDocument !== 'undefined' ? btsCertificateDocument : require('./certificate_document');
 const twips = mm => Math.round(mm * 1440 / 25.4), pixels = mm => mm * 96 / 25.4, emu = mm => Math.round(mm * 36000);
 function check(signal) {if (signal?.aborted) throw new Error('Urkundenerzeugung abgebrochen.');}
 async function backgroundPng(template, tournamentKey) {
  const canvas = document.createElement('canvas');
  // 300 dpi for A4; bound memory for unusually large custom page formats.
  const pixelsPerMm = Math.min(300 / 25.4, Math.sqrt(16000000 / (template.width * template.height)), 16384 / Math.max(template.width, template.height));
  try {
   await documents().paintBackground(canvas, template, tournamentKey, {pixelsPerMm});
   const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
   if (!blob) throw new Error('Die Hintergrundvorlage konnte nicht für DOCX aufbereitet werden.');
   return new Uint8Array(await blob.arrayBuffer());
  } finally {canvas.width = canvas.height = 0;}
 }
 async function createDocx(designs, records, options = {}) {
  check(options.signal);
  const invalid = schema().validate(designs);if (invalid) throw new Error(invalid);
  if (!records.length) throw new Error('Für die Auswahl sind keine Urkunden verfügbar.');
  const {docx, shapes} = options.docx ? options : await btsLibraries.docx();
  const used = records.flatMap(record => designs[record.kind].fields);
  // DOCX identifies fonts by their real family name, not the browser CSS alias.
  // Include the regular face even if the design uses only its bold face.
  const fontSet = await documents().prepareFonts([...used, ...used.map(field => ({...field, bold: false}))], options), families = new Map();
  for (const field of used) {
   const regular = fontSet.get(field.font), bold = fontSet.get(field.font + '-bold');
   families.set(field.font, {name: regular.face.familyName, data: regular.data, ...(bold ? {bold: bold.data} : {})});
  }
  const backgrounds = new Map(), sections = [];
  const floating = (x, y, zIndex, behindDocument = false) => ({
   horizontalPosition: {relative: docx.HorizontalPositionRelativeFrom.PAGE, offset: emu(x)},
   verticalPosition: {relative: docx.VerticalPositionRelativeFrom.PAGE, offset: emu(y)},
   allowOverlap: true, layoutInCell: false, behindDocument, zIndex, wrap: {type: docx.TextWrappingType.NONE},
  });
  for (let index = 0; index < records.length; index++) {
   check(options.signal);
   const record = records[index], template = designs[record.kind], children = [];
   if (template.background && !template.backgroundPreviewOnly) {
    if (!backgrounds.has(record.kind)) backgrounds.set(record.kind, await (options.renderBackground || backgroundPng)(template, options.tournamentKey));
    check(options.signal);
    children.push(new docx.ImageRun({type: 'png', data: backgrounds.get(record.kind),
     transformation: {width: pixels(template.width), height: pixels(template.height)},
     floating: floating(0, 0, 0, true), altText: {name: 'Urkundenhintergrund', description: template.background.name},
    }));
   }
   for (const [fieldIndex, field] of template.fields.entries()) {
    const absolute = schema().absoluteField(template, field), font = fontSet.get(field.font + (field.bold ? '-bold' : ''));
    const lines = documents().layout(absolute, record, font, options), size = lines[0]?.size || field.size;
    const textStyle = {font: families.get(field.font).name, size: Math.round(size * 2), bold: field.bold, color: field.color.slice(1)};
    children.push(new shapes.ShapeRun({type: 'rectangle', line: 'none',
     transformation: {width: pixels(field.width), height: pixels(field.height)},
     floating: floating(absolute.x, absolute.y, fieldIndex + 1),
     altText: {name: field.id, description: 'Bearbeitbares Urkundenfeld'},
     // Word needs the shape's width as the paragraph boundary for alignment.
     textOptions: {verticalAlignment: 'center', margins: {top: 0, right: 0, bottom: 0, left: 0}, wrap: true, resizeShapeToFitText: false, shrinkTextOnOverflow: false},
     children: lines.map(line => new docx.Paragraph({alignment: field.align, run: textStyle,
      // Explicitly override the anchor paragraph's exact line rule. Match the
      // PDF's 1.2-em baseline distance, including blank and fitted lines.
      spacing: {before: 0, after: 0, line: Math.round(size * 1.2 * 20), lineRule: docx.LineRuleType.EXACT},
      children: [new docx.TextRun({...textStyle, text: line.text})],
     })),
    }));
   }
   sections.push({properties: {type: docx.SectionType.NEXT_PAGE, page: {
    // docx applies landscape by swapping the supplied portrait dimensions.
    size: {width: twips(Math.min(template.width, template.height)), height: twips(Math.max(template.width, template.height)), orientation: template.width > template.height ? docx.PageOrientation.LANDSCAPE : docx.PageOrientation.PORTRAIT},
    margin: {top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0},
   }}, children: [new docx.Paragraph({spacing: {before: 0, after: 0, line: 20, lineRule: docx.LineRuleType.EXACT}, children})]});
   options.onProgress?.(index + 1, records.length);await new Promise(resolve => setTimeout(resolve, 0));
  }
  check(options.signal);
  const doc = new docx.Document({creator: 'BTS – Turnierleitung', title: 'Urkunden', fonts: [...families.values()], sections});
  const bytes = new Uint8Array(await docx.Packer.toArrayBuffer(doc));check(options.signal);return bytes;
 }
 return {MIME, createDocx};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = btsCertificateDocx;
