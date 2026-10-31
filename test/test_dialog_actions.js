'use strict';
const assert = require('assert');
const actions = require('../static/js/dialog_actions');

describe('Shared dialog action lifecycle', function() {
 function setup(answer = false) {
  const form = new EventTarget(), calls = [], data = { value: 'original', confirmations: 0 };
  const controller = actions.create(form, { read: () => data.value, onUpdate: state => calls.push(state), confirmDiscard: () => { data.confirmations++;return answer; } });
  return { form, calls, data, controller };
 }
 it('enables saving only for changed values and recognises reverting to the original', function() {
  const { form, data, controller } = setup();
  assert.strictEqual(controller.begin('save'), false);
  data.value = 'draft';form.dispatchEvent(new Event('input'));assert.strictEqual(controller.state().dirty, true);
  data.value = 'original';form.dispatchEvent(new Event('change'));assert.strictEqual(controller.state().dirty, false);
 });
 it('asks only when discarding changed data and honours rejection', function() {
  const { data, controller } = setup();
  assert.strictEqual(controller.canClose(), true);assert.strictEqual(data.confirmations, 0);
  data.value = 'draft';assert.strictEqual(controller.canClose(), false);assert.strictEqual(data.confirmations, 1);
  assert.strictEqual(controller.state().dirty, true);
 });
 it('honours explicit discard approval', function() {
  const { data, controller } = setup(true);data.value = 'draft';assert.strictEqual(controller.canClose(), true);
 });
 it('blocks duplicate operations and closing until the response arrives', function() {
  const { data, controller } = setup(true);data.value = 'draft';assert.strictEqual(controller.begin('save'), true);
  assert.strictEqual(controller.begin('save'), false);assert.strictEqual(controller.begin('delete'), false);
  assert.strictEqual(controller.canClose(), false);assert.strictEqual(data.confirmations, 0);
 });
 it('retains changes after a failed operation and accepts a new baseline after success', function() {
  const { data, controller } = setup();data.value = 'draft';controller.begin('save');controller.end();
  assert.deepStrictEqual(controller.state(), { dirty: true, busy: null });assert.strictEqual(controller.begin('save'), true);
  controller.accept();assert.deepStrictEqual(controller.state(), { dirty: false, busy: null });assert.strictEqual(controller.canClose(), true);
 });
 it('cancels pristine and duplicate form submissions before their existing handler', function() {
  const { form, data, controller } = setup();
  const pristine = new Event('submit', { cancelable: true });form.dispatchEvent(pristine);assert.strictEqual(pristine.defaultPrevented, true);
  data.value = 'draft';controller.begin('save');const duplicate = new Event('submit', { cancelable: true });form.dispatchEvent(duplicate);assert.strictEqual(duplicate.defaultPrevented, true);
 });
 it('releases the form and listeners when a dialog closes', function() {
  const { form, calls, data, controller } = setup();assert.strictEqual(actions.get(form), controller);controller.destroy();
  const count = calls.length;data.value = 'draft';form.dispatchEvent(new Event('input'));
  assert.strictEqual(actions.get(form), undefined);assert.strictEqual(calls.length, count);
 });
 for (const approved of [false, true]) {
  it('waits for asynchronous discard ' + (approved ? 'approval' : 'rejection'), async function() {
   let decide;
   const answer = new Promise(resolve => {decide = resolve;});
   const { data, controller } = setup(answer);data.value = 'draft';
   const closing = controller.canClose();
   assert(closing instanceof Promise);assert.strictEqual(controller.state().dirty, true);
   decide(approved);assert.strictEqual(await closing, approved);
  });
 }
 it('rejects a delayed discard approval when a save has started in the meantime', async function() {
  let decide;
  const { data, controller } = setup(new Promise(resolve => {decide = resolve;}));data.value = 'draft';
  const closing = controller.canClose();controller.begin('save');decide(true);
  assert.strictEqual(await closing, false);assert.strictEqual(controller.state().busy, 'save');
 });
 it('rejects delayed discard approval after its form has been destroyed', async function() {
  let decide;
  const { data, controller } = setup(new Promise(resolve => {decide = resolve;}));data.value = 'draft';
  const closing = controller.canClose();controller.destroy();decide(true);
  assert.strictEqual(await closing, false);assert.strictEqual(controller.canClose(), false);
 });
 for (const draft of [false, true]) {
  it('locks canonical fields without losing '+(draft?'an unrelated draft':'a pristine state'), function() {
   const form = new EventTarget(), ignore = [], values = {court_id: '1', color: 'green'};
   const controller = actions.create(form, {ignore, read: () => JSON.stringify(Object.entries(values).filter(([name]) => !ignore.includes(name))), onUpdate() {}, confirmDiscard() {return false;}});
   if (draft) values.color = 'blue';
   values.court_id = '2';controller.ignoreFields(['court_id']);
   assert.strictEqual(controller.state().dirty, draft);
   values.color = 'green';controller.refresh();assert.strictEqual(controller.state().dirty, false);
  });
 }
 it('identifies changed controls without re-reading the form on each score update', function() {
  const form = new EventTarget(), values = {court_id:'1',umpire_note:''};let reads=0;
  const controller = actions.create(form,{read:()=>{reads++;return JSON.stringify(Object.entries(values));},onUpdate(){},confirmDiscard(){return false;}});
  values.umpire_note='New note';controller.refresh();
  assert.deepStrictEqual(controller.changedFields(),['umpire_note']);
  const count=reads;controller.changedFields();controller.changedFields();assert.strictEqual(reads,count);
  values.court_id='2';controller.refresh();assert.deepStrictEqual(controller.changedFields(),['court_id','umpire_note']);
 });

});
