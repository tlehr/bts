'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const PDFLib = require('../static/vendor/pdf-lib.min.js');

function harness(load) {
 const context = {
  btsLibraries: {pdf: () => load(context.PDFLib)},console,
  curt: {key: 'test',name: 'Testturnier',matches: [],events: {events: []}},
  crouting: {register() {}},change: {default_handler() {}},
  window: {addEventListener() {}},document: {},
  setTimeout,clearTimeout,setInterval() {},clearInterval() {},requestAnimationFrame() {},
 };
 const source = fs.readFileSync(require.resolve('../static/js/ctournament'), 'utf8');
 const exposed = source.replace('\treturn {\n\t\tinit,', '\treturn {\n testDocument: make_accounting_document_pdf,\n testPositions: make_accounting_position_list_pdf,\n\t\tinit,');
 assert.notStrictEqual(exposed, source);
 vm.createContext(context);
 vm.runInContext(fs.readFileSync(require.resolve('../static/vendor/pdf-lib.min.js'), 'utf8'), context);
 vm.runInContext(exposed, context);
 return context;
}

describe('Accounting PDF dependencies', function() {
 for (const entry of ['testDocument', 'testPositions']) {
  it('waits for the PDF dependency before processing ' + entry, async function() {
   let reject, calls = 0;
   const h = harness(() => {calls++;return new Promise((_resolve, fail) => {reject = fail;});});
   const error = new Error('PDF dependency unavailable');
   const result = h.ctournament[entry](new Proxy({}, {get() {assert.fail('Do not process export data before loading PDF');}}));
   assert.strictEqual(calls, 1);
   const rejected = assert.rejects(result, failure => failure === error);reject(error);await rejected;
  });
 }
 for (const document_type of ['invoice', 'receipt']) {
  it('generates a readable ' + document_type + ' after loading the real library', async function() {
   const h = harness(async library => library);
   const bytes = await h.ctournament.testDocument({document_type, document_number: 'TEST-001', buyer_name: 'Testperson', issued_at: '2026-11-09', total: 0, lines: []});
   const pdf = await PDFLib.PDFDocument.load(Buffer.from(bytes));
   assert.strictEqual(pdf.getPageCount(), 1);assert(pdf.getTitle().includes('TEST-001'));
  });
 }
 it('still generates a readable positions PDF after loading the real library', async function() {
  let calls = 0;
  const h = harness(async library => {calls++;return library;});
  const bytes = await h.ctournament.testPositions([]);
  assert.strictEqual(calls, 1);
  const pdf = await PDFLib.PDFDocument.load(Buffer.from(bytes));
  assert.strictEqual(pdf.getPageCount(), 1);assert.strictEqual(pdf.getTitle(), 'Postenliste');
 });
});
