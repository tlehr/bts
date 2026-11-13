'use strict';
/* eslint-disable no-console -- Isolated library and export regression checks. */
const assert=require('assert'),fs=require('fs'),path=require('path');
module.exports=async function({c,open,previews}) {
 const checks=[],check=(name,ok)=>{assert(ok,name);checks.push(name);console.log('OK '+name);};
 await open();
 check('Opening the board requests neither the Excel nor PDF export library',await c.evaluate('typeof XLSX==="undefined"&&typeof PDFLib==="undefined"&&!performance.getEntriesByType("resource").some(entry=>/vendor\\/(xlsx.full|pdf-lib).min.js/.test(entry.name))'));
 const files=await c.evaluate(`(async()=>{
  const first=btsLibraries.pdf(),same=btsLibraries.pdf(),excel=btsLibraries.xlsx();
  const [pdf,xlsx]=await Promise.all([first,excel]);
  const doc=await pdf.PDFDocument.create();doc.addPage([300,400]);const bytes=await doc.save();
  const data=ccsvexport.make_xlsx([['Name','Punkte'],['Testperson',21]]),book=xlsx.read(data,{type:'array'});
  return{shared:first===same,pages:(await pdf.PDFDocument.load(bytes)).getPageCount(),rows:xlsx.utils.sheet_to_json(book.Sheets.Urkunden,{header:1}),pdfScripts:document.querySelectorAll('script[src="/static/vendor/pdf-lib.min.js"]').length,excelScripts:document.querySelectorAll('script[src="/static/vendor/xlsx.full.min.js"]').length};
 })()`);
 check('Concurrent callers share one PDF request and create a valid PDF',files.shared&&files.pages===1&&files.pdfScripts===1);
 check('The lazy Excel library writes and reads a genuine workbook',files.excelScripts===1&&JSON.stringify(files.rows)===JSON.stringify([['Name','Punkte'],['Testperson',21]]));
 await open();await c.call('Network.setBlockedURLs',{urls:['*/static/vendor/pdf-lib.min.js']});
 const failure=await c.evaluate('btsLibraries.pdf().then(()=>null,error=>error.message)');
 check('A blocked PDF dependency returns an actionable error and removes its script',typeof failure==='string'&&failure.includes('PDF')&&await c.evaluate('!document.querySelector(\'script[src="/static/vendor/pdf-lib.min.js"]\')'));
 await c.call('Network.setBlockedURLs',{urls:[]});
 check('The next PDF request can recover immediately',await c.evaluate('btsLibraries.pdf().then(lib=>!!lib.PDFDocument)'));
 await open();
 await c.evaluate(`(()=>{
  const qa=window.__libraryUi={files:[],marks:[],originalXlsx:btsLibraries.xlsx};
  qa.create=()=>{
   const owner=document.createElement('div');document.body.append(owner);
   const view=btsCertificates.create({owner,tournament:curt,getTournament:()=>curt,onDispose(){},
    request(message,callback){qa.marks.push(message);callback(null,{certificate_exports:{}});},
    exportFile(format){qa.files.push({format,data:format==='xlsx'?ccsvexport.make_xlsx([['Name'],['Testperson']]):null});},
   });
   view.open({hasEvents:()=>true,hasRows:()=>true,readOptions:()=>({selected_certificate_keys:new Set(['TEST'])})});
   qa.view=view;qa.owner=owner;qa.button=owner.querySelector('.certificate-export-xlsx');
  };
  qa.create();qa.owner.querySelector('.certificate-export-csv').click();
 })()`);
 await c.evaluate('new Promise(resolve=>setTimeout(resolve,0))');
 check('CSV export remains available without loading Excel and marks only after file creation',await c.evaluate('__libraryUi.files.length===1&&__libraryUi.marks.length===1&&typeof XLSX==="undefined"'));
 await c.evaluate(`(()=>{
  const qa=__libraryUi;qa.files=[];qa.marks=[];
  btsLibraries.xlsx=()=>new Promise(resolve=>qa.release=resolve);qa.button.click();qa.button.click();
 })()`);
 check('Waiting for Excel keeps duplicate exports disabled and sends no premature mark',await c.evaluate('__libraryUi.button.disabled&&__libraryUi.files.length===0&&__libraryUi.marks.length===0&&__libraryUi.owner.querySelector("form").getAttribute("aria-busy")==="true"'));
 await c.evaluate('__libraryUi.view.dispose();__libraryUi.owner.remove();__libraryUi.release();new Promise(resolve=>setTimeout(resolve,0))');
 check('Disposing the workspace while its dependency is pending prevents a late download or mark',await c.evaluate('__libraryUi.files.length===0&&__libraryUi.marks.length===0'));
 await c.evaluate('(()=>{const qa=__libraryUi;qa.create();btsLibraries.xlsx=()=>Promise.reject(new Error(\'Test load failure\'));qa.button.click();})()');
 await c.evaluate('new Promise(resolve=>setTimeout(resolve,0))');
 check('A dependency failure releases the export controls without marking or creating a file',await c.evaluate('!__libraryUi.button.disabled&&__libraryUi.files.length===0&&__libraryUi.marks.length===0&&__libraryUi.owner.querySelector("[role=status]").textContent.includes("nicht erstellt")'));
 await c.evaluate(`(async()=>{
  const qa=__libraryUi;btsLibraries.xlsx=qa.originalXlsx;qa.button.click();
  for(let i=0;i<500&&qa.files.length===0;i++)await new Promise(resolve=>setTimeout(resolve,20));
 })()`);
 check('Retry loads Excel and creates exactly one workbook and one export mark',await c.evaluate('__libraryUi.files.length===1&&__libraryUi.marks.length===1&&__libraryUi.files[0].format==="xlsx"&&new Uint8Array(__libraryUi.files[0].data)[0]===80&&new Uint8Array(__libraryUi.files[0].data)[1]===75&&!__libraryUi.button.disabled'));
 await c.evaluate('__libraryUi.view.dispose();__libraryUi.owner.remove()');
 check('Library and workspace checks produce no uncaught browser errors',!c.events.some(event=>event.method==='Runtime.exceptionThrown'));
 fs.writeFileSync(path.join(previews,'libraries-verification.json'),JSON.stringify({scope:'Isolated browser; real local PDF/XLSX libraries, generated files kept in memory and simulated export markers. No live services.',checks},null,2)+'\n');
};
