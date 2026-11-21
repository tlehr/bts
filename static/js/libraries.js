'use strict';

// Heavy export libraries are shared by all workspaces and loaded on first use.
var btsLibraries = (() => {
 const pending = new Map();
 const definitions = {
  pdf: {global: 'PDFLib', url: '/static/vendor/pdf-lib.min.js', label: 'PDF'},
  xlsx: {global: 'XLSX', url: '/static/vendor/xlsx.full.min.js', label: 'Excel'},
  docx: {global: 'docx', url: '/static/vendor/docx/index.umd.js', label: 'DOCX'},
  docxShapes: {global: 'docxShapes', url: '/static/vendor/docx/shapes.umd.js', label: 'DOCX'},
 };
 function load(key) {
  const definition = definitions[key];
  if (globalThis[definition.global]) return Promise.resolve(globalThis[definition.global]);
  if (pending.has(key)) return pending.get(key);
  let resolve, reject;
  const promise = new Promise((done, fail) => {resolve = done;reject = fail;});
  pending.set(key, promise);
  const node = document.createElement('script');
  let settled = false;
  const finish = error => {
   if (settled) return;
   settled = true;clearTimeout(timeout);pending.delete(key);node.onload = node.onerror = null;
   if (error) {node.remove();reject(error);} else resolve(globalThis[definition.global]);
  };
  const fail = () => finish(new Error('Die ' + definition.label + '-Bibliothek konnte nicht geladen werden. Bitte erneut versuchen.'));
  const timeout = setTimeout(fail, 20000);
  node.src = definition.url;
  node.onload = () => {if (globalThis[definition.global]) finish();else fail();};
  node.onerror = fail;
  try {document.head.append(node);} catch (_) {fail();}
  return promise;
 }
 return {pdf: () => load('pdf'), xlsx: () => load('xlsx'), docx: async () => {
  const docx = await load('docx'), shapes = await load('docxShapes');return {docx, shapes};
 }};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = btsLibraries;
