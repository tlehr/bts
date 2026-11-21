'use strict';
/* eslint no-console: off */
const fs = require('fs'), path = require('path'), assert = require('assert'), yauzl = require('yauzl');
const {DOMParser} = require('xmldom');
module.exports = async function({c, verify: check, eventually, click, metrics, previews}) {
 const checks = [];
 async function verify(name, expression) {await check(name, expression);checks.push(name);}
 function checked(name, condition) {assert(condition, name);checks.push(name);console.log('OK ' + name);}
 async function download(name) {
  const bytes = Buffer.from(await c.evaluate(String.raw`(async()=>{const data=new Uint8Array(await __designFiles.at(-1).blob.arrayBuffer());let text='';for(let i=0;i<data.length;i+=8192)text+=String.fromCharCode(...data.subarray(i,i+8192));return btoa(text);})()`), 'base64');
  fs.writeFileSync(path.join(previews, name + '.docx'), bytes);
  return new Promise((resolve, reject) => yauzl.fromBuffer(bytes, {lazyEntries: true}, (error, zip) => {
   if (error) return reject(error);const files = new Map();zip.on('error', reject);zip.on('end', () => resolve(files));
   zip.on('entry', entry => zip.openReadStream(entry, (error, stream) => {
    if (error) return reject(error);const chunks = [];stream.on('error', reject);stream.on('data', chunk => chunks.push(chunk));stream.on('end', () => {files.set(entry.fileName, Buffer.concat(chunks));zip.readEntry();});
   }));zip.readEntry();
  }));
 }
 const parse = files => new DOMParser().parseFromString(files.get('word/document.xml').toString(), 'application/xml');
 const elements = (root, name) => Array.from(root.getElementsByTagName(name));
 const generate = async () => {await click('.certificate-export-docx');await eventually('__designPending.some(item=>item.message.type==="certificate_export_mark")');};
 const acknowledge = () => c.evaluate(String.raw`__designReply('certificate_export_mark',null,{certificate_exports:{'JE U17':Date.now(),'JD U17':Date.now()}})`);
 const reopen = () => c.evaluate(String.raw`document.querySelector('.leitstand-nav a[href="/admin/t/preview/"]').click();document.querySelector('.leitstand-nav a[href="/admin/t/preview/certificates"]').click();__designButton('Filter zurücksetzen');__designButton('Sichtbare auswählen')`);
 await verify('DOCX is available without eagerly loading either Word library',String.raw`!__designPage().querySelector('.certificate-export-docx').disabled&&typeof docx==='undefined'&&typeof docxShapes==='undefined'`);
 await c.evaluate(String.raw`__designButton('Auswahl aufheben')`);
 await verify('An empty selection disables DOCX with the same explanation as PDF',String.raw`__designPage().querySelector('.certificate-export-docx').disabled&&__designPage().querySelector('.certificate-export-hint').textContent.includes('mindestens eine Disziplin')`);
 await c.evaluate(String.raw`__designButton('Sichtbare auswählen');__designSet('[name="veranstaltung_1"]','Jugend-Rangliste 2026','input')`);await eventually('__designPending.some(item=>item.message.type==="tournament_edit_props")');
 await verify('Pending settings disable Word output until their save succeeds',String.raw`__designPage().querySelector('.certificate-export-docx').disabled`);
 await c.evaluate(String.raw`__designReply('tournament_edit_props',{message:'Speichern fehlgeschlagen'})`);
 await verify('A failed settings save preserves the draft and blocks DOCX',String.raw`__designPage().querySelector('.certificate-export-docx').disabled&&!__designPage().querySelector('.certificate-export-retry').hidden&&__designFiles.length===0`);
 await click('.certificate-export-retry');await c.evaluate(String.raw`__designReply('tournament_edit_props')`);await generate();
 await verify('DOCX downloads with the correct MIME type and marks the selected disciplines only after generation',String.raw`__designFiles.length===1&&__designFiles[0].name==='urkunden.docx'&&__designFiles[0].blob.type===btsCertificateDocx.MIME&&__designPending.length===1&&__designPending[0].message.event_names.sort().join('|')==='JD U17|JE U17'&&Object.keys(curt.certificate_exports).length===0&&__designPage().querySelector('.certificate-export-docx').disabled`);
 const basic = await download('browser-basic'), basicRoot = parse(basic), text = elements(basicRoot, 'w:t').map(node => node.textContent).join('|');
 checked('A real browser-generated DOCX has six sections, editable names and both doubles partner directions', elements(basicRoot, 'w:sectPr').length === 6 && elements(basicRoot, 'w:txbxContent').length > 6 && ['Anna Müller','Zoë García','Łukasz Nowak','mit Łukasz Nowak','mit Zoë García'].every(value => text.includes(value)) && !text.includes('Max Mustermann'));
 checked('The browser-generated file includes embedded font files', [...basic.keys()].filter(name => name.endsWith('.odttf')).length >= 4);
 await acknowledge();
 await verify('Acknowledging DOCX updates the status and restores the export controls',String.raw`__designPage().querySelector('.certificate-export-hint').textContent.includes('6 Urkunden als DOCX erstellt')&&!__designPage().querySelector('.certificate-export-docx').disabled&&Object.keys(curt.certificate_exports).length===2`);
 // Exercise actual PDF rasterization and PNG painting through the browser,
 // with independently sized singles/doubles templates and no external uploads.
 await c.evaluate(String.raw`(async()=>{
  const design=btsCertificateDesign.defaults();design.single=btsCertificateDesign.resize(design.single,297,210);
  for(const kind of ['single','double'])design[kind].fields.forEach((field,index)=>{field.align=['left','center','right'][index%3];});
  const pdf=await PDFLib.PDFDocument.create(),page=pdf.addPage([297*btsCertificateDesign.MM,210*btsCertificateDesign.MM]);
  page.drawRectangle({x:0,y:0,width:page.getWidth(),height:page.getHeight(),color:PDFLib.rgb(1,.94,.65)});page.drawText('VORLAGE EINZEL',{x:20,y:20,size:14});
  const pdfId='a'.repeat(64)+'.pdf';__designAssets.set(pdfId,{data:await pdf.save(),mime:'application/pdf'});design.single.background={id:pdfId,name:'Einzel.pdf',mime:'application/pdf'};
  const canvas=document.createElement('canvas');canvas.width=210;canvas.height=297;const ctx=canvas.getContext('2d');ctx.fillStyle='#b0d8ff';ctx.fillRect(0,0,210,297);
  const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),pngId='b'.repeat(64)+'.png';__designAssets.set(pngId,{data:new Uint8Array(await png.arrayBuffer()),mime:'image/png'});design.double.background={id:pngId,name:'Doppel.png',mime:'image/png'};
  curt.certificate_design=design;
 })()`);await reopen();await click('.certificate-workspace-tabs [role="tab"]:last-child');
 await eventually('document.querySelectorAll(".certificate-design-overlay text").length>0');
 await c.evaluate(String.raw`__designSet('[name="certificate_design_sample"]','placeholders')`);await generate();
 const backgrounds = await download('browser-backgrounds'), bgRoot = parse(backgrounds), images = [...backgrounds].filter(([name]) => name.startsWith('word/media/'));
 checked('PDF and PNG backgrounds become two reused high-resolution images on all six pages', images.length === 2 && elements(bgRoot, 'pic:pic').length === 6 && images.every(([,bytes]) => bytes.readUInt32BE(16) > 2400 && bytes.readUInt32BE(20) > 2400));
 const pageSizes = elements(bgRoot, 'w:pgSz').map(node => [node.getAttribute('w:w'),node.getAttribute('w:h')].join('x'));
 checked('Singles retain landscape pages and doubles retain portrait pages in the same file', pageSizes.filter(size => size === '16838x11906').length === 2 && pageSizes.filter(size => size === '11906x16838').length === 4);
 checked('A literal placeholder preview still exports real recipient data', elements(bgRoot,'w:t').some(node => node.textContent === 'Anna Müller') && !elements(bgRoot,'w:t').some(node => node.textContent.includes('{name}')));
 const expectedFields = await c.evaluate(String.raw`btsCertificateDesign.records(ccsvexport.build_certificate_rows(curt.matches,curt,{certificate_export_double_swapped_entries_enabled:false})).flatMap(record=>curt.certificate_design[record.kind].fields)`);
 const shapes = elements(bgRoot, 'wps:wsp');
 checked('DOCX retains each field alignment and vertically centered text in fixed-width boxes', shapes.length === expectedFields.length && shapes.every((shape, index) => {
  const body = elements(shape, 'wps:bodyPr')[0], paragraphs = elements(shape, 'w:p');
  const extent = elements(shape, 'a:ext')[0], field = expectedFields[index];
  return Math.abs(Number(extent.getAttribute('cx')) - field.width * 36000) <= 1 && Math.abs(Number(extent.getAttribute('cy')) - field.height * 36000) <= 1 && elements(body, 'a:noAutofit').length === 1 && body.getAttribute('wrap') === 'square' && body.getAttribute('anchor') === 'ctr' && paragraphs.length > 0 && paragraphs.every(paragraph => {
   const spacing = elements(paragraph, 'w:spacing')[0], size = Number(elements(paragraph, 'w:sz')[0].getAttribute('w:val')) / 2;
   return elements(paragraph, 'w:jc')[0].getAttribute('w:val') === expectedFields[index].align && spacing.getAttribute('w:lineRule') === 'exact' && Number(spacing.getAttribute('w:line')) === Math.round(size * 1.2 * 20);
  });
 }));
 await acknowledge();
 await c.evaluate(String.raw`curt.certificate_design.single.backgroundPreviewOnly=true;curt.certificate_design.double.backgroundPreviewOnly=true`);await reopen();await generate();
 const stationery = await download('browser-stationery');checked('Preview-only backgrounds are absent from DOCX while all editable fields remain', ![...stationery.keys()].some(name => name.startsWith('word/media/')) && elements(parse(stationery),'w:txbxContent').length === elements(bgRoot,'w:txbxContent').length);
 await c.evaluate(String.raw`__designReply('certificate_export_mark',{message:'Status konnte nicht gespeichert werden'})`);
 await verify('A failed status update distinguishes the completed Word download and permits retry',String.raw`__designPage().querySelector('.certificate-export-hint').textContent.includes('DOCX-Datei wurde erstellt, aber')&&!__designPage().querySelector('.certificate-export-docx').disabled`);
 await c.evaluate(String.raw`window.__docxBeforeFiles=__designFiles.length;window.__docxBeforeCommands=__designCommands.length;window.__docxLoader=btsLibraries.docx;btsLibraries.docx=async()=>{throw new Error('DOCX-Bibliothek konnte nicht geladen werden.');}`);await click('.certificate-export-docx');
 await eventually('!document.querySelector(".certificate-export-docx").disabled');
 await verify('DOCX library failure creates neither a download nor a marker and reports a retryable error',String.raw`__designFiles.length===__docxBeforeFiles&&__designCommands.length===__docxBeforeCommands&&__designPage().querySelector('.certificate-export-hint').textContent.includes('DOCX-Bibliothek')`);
 await c.evaluate(String.raw`btsLibraries.docx=__docxLoader`);await generate();await acknowledge();
 for (const [width,height] of [[1920,1080],[1024,768],[390,844],[320,568],[844,390]]) {
  await metrics(width,height);
  for (const designer of [false,true]) {
   await c.evaluate(`__designPage().querySelectorAll('.certificate-workspace-tabs [role="tab"]')[${designer?1:0}].click();window.scrollTo(0,document.documentElement.scrollHeight)`);
   await verify('DOCX and all other output actions remain visible and reachable at '+width+'x'+height+(designer?' in the designer':' in selection'),String.raw`document.documentElement.scrollWidth<=innerWidth&&[...__designPage().querySelectorAll('.certificate-export-footer button:not([hidden])')].every(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight+1;})`);
  }
 }
 await metrics(1440,1000);await c.evaluate('window.scrollTo(0,0)');
 const shot=await c.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(previews,'docx-designer.png'),Buffer.from(shot.data,'base64'));
 await c.evaluate(String.raw`window.__docxOriginal=btsCertificateDocx.createDocx;btsCertificateDocx.createDocx=async(_design,_records,options)=>new Promise(resolve=>{window.__docxSignal=options.signal;window.__docxRelease=resolve;});window.__docxBeforeFiles=__designFiles.length;window.__docxBeforeCommands=__designCommands.length;`);
 await click('.certificate-export-docx');await click('.certificate-export-docx');
 await c.evaluate(String.raw`document.querySelector('.leitstand-nav a[href="/admin/t/preview/"]').click()`);
 await verify('An active DOCX generation blocks duplicate exports and ordinary navigation',String.raw`!!__designPage()&&__designPage().querySelector('.certificate-export-docx').disabled&&__designPage().querySelector('.certificate-export-pdf').disabled&&__designPage().querySelector('form').getAttribute('aria-busy')==='true'`);
 await c.evaluate(String.raw`window.__docxName=curt.matches[0].setup.teams[0].players[0].name;curt.matches[0].setup.teams[0].players[0].name='Korrigierter Name';__docxRelease(new Uint8Array([1,2,3]))`);await eventually('!document.querySelector(".certificate-export-docx").disabled');
 await verify('Placement changes during DOCX generation prevent a stale file and export marker',String.raw`__designFiles.length===__docxBeforeFiles&&__designCommands.length===__docxBeforeCommands&&__designPage().querySelector('.certificate-export-hint').textContent.includes('während der Erzeugung geändert')`);
 await c.evaluate(String.raw`curt.matches[0].setup.teams[0].players[0].name=__docxName`);await click('.certificate-export-docx');
 await c.evaluate(String.raw`__designPage().remove();__docxRelease(new Uint8Array([1,2,3]))`);
 await verify('Leaving the DOCX workspace aborts generation and ignores late results',String.raw`__docxSignal.aborted&&__designFiles.length===__docxBeforeFiles&&__designCommands.length===__docxBeforeCommands`);
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');await verify('DOCX workflow completes without browser exceptions',String(!exceptions.length));
 fs.writeFileSync(path.join(previews,'docx-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,exceptions:exceptions.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
