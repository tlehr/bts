'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function harness(append) {
 const nodes = [], timeouts = new Map();let next = 0;
 const context = {
  document: {
   createElement() {return {remove() {this.removed = true;}};},
   head: {append(node) {nodes.push(node);append?.(node);}},
  },
  setTimeout(callback) {const id = ++next;timeouts.set(id, callback);return id;},
  clearTimeout(id) {timeouts.delete(id);},
 };
 vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/libraries'), 'utf8'), context);
 return {context, api: context.btsLibraries, nodes, timeouts};
}

describe('Browser export library loading', function() {
 it('does not load scripts or start timers during page startup', function() {
  const h = harness();assert.strictEqual(h.nodes.length, 0);assert.strictEqual(h.timeouts.size, 0);
 });
 it('shares concurrent requests, clears the timeout and reuses the loaded library', async function() {
  const h = harness(), first = h.api.pdf(), second = h.api.pdf();
  assert.strictEqual(first, second);assert.strictEqual(h.nodes.length, 1);
  assert.strictEqual(h.nodes[0].src, '/static/vendor/pdf-lib.min.js');
  const library = h.context.PDFLib = {PDFDocument: {}};h.nodes[0].onload();
  assert.strictEqual(await first, library);assert.strictEqual(await h.api.pdf(), library);
  assert.strictEqual(h.nodes.length, 1);assert.strictEqual(h.timeouts.size, 0);
 });
 it('loads independent export libraries concurrently', async function() {
  const h = harness(), pdf = h.api.pdf(), excel = h.api.xlsx();
  assert.strictEqual(h.nodes.length, 2);assert.strictEqual(h.nodes[1].src, '/static/vendor/xlsx.full.min.js');
  h.context.PDFLib = {};h.context.XLSX = {};
  h.nodes[1].onload();h.nodes[0].onload();
  assert.strictEqual(await pdf, h.context.PDFLib);assert.strictEqual(await excel, h.context.XLSX);
 });
 it('reports a load error and allows an immediate retry', async function() {
  const h = harness(), first = h.api.xlsx(), failed = assert.rejects(first, /Excel.*nicht geladen/);
  h.nodes[0].onerror();await failed;
  assert(h.nodes[0].removed);assert.strictEqual(h.timeouts.size, 0);
  const retry = h.api.xlsx();h.context.XLSX = {};h.nodes[1].onload();
  assert.strictEqual(await retry, h.context.XLSX);
 });
 it('rejects a response which did not provide the requested global and retries', async function() {
  const h = harness(), first = h.api.pdf(), failed = assert.rejects(first, /PDF.*nicht geladen/);
  h.nodes[0].onload();await failed;
  const retry = h.api.pdf();h.context.PDFLib = {};h.nodes[1].onload();await retry;
  assert.strictEqual(h.nodes.length, 2);
 });
 it('times out, then ignores a late event without cancelling a retry', async function() {
  const h = harness(), first = h.api.pdf(), failed = assert.rejects(first, /PDF.*nicht geladen/), late = h.nodes[0].onload;
  [...h.timeouts.values()][0]();await failed;
  const retry = h.api.pdf();late();assert.strictEqual(h.api.pdf(), retry);
  h.context.PDFLib = {};h.nodes[1].onload();await retry;assert.strictEqual(h.timeouts.size, 0);
 });
 it('reports synchronous script insertion failures and can retry', async function() {
  let fail = true;
  const h = harness(() => {if (fail) throw new Error('blocked');});
  await assert.rejects(h.api.xlsx(), /Excel.*nicht geladen/);assert.strictEqual(h.timeouts.size, 0);
  fail = false;const retry = h.api.xlsx();h.context.XLSX = {};h.nodes[1].onload();await retry;
 });
});
