'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');

function fixture() {
 let now=new Date('2026-10-30T23:59:59.000').getTime();
 const view={text:'',writes:0,console:[]};
 class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now]));}}
 const context={Date:ClockDate,window:{},document:{getElementById:()=>({getAttribute:()=> 'true'})},
  console:{error:message=>view.console.push(message)},uiu:{show_qs(){},text_qs(selector,text){assert.strictEqual(selector,'.errors');view.text=text;view.writes++;}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/cerror'),'utf8'),context);
 return {api:context.cerror,view,context,time(value){now=new Date(value).getTime();}};
}

describe('Local diagnostic history',function(){
 it('retains the legacy newest-first text display when no card is subscribed',function(){
  const {api,view}=fixture();api.on_error('First');api.on_error('Second');
  assert.strictEqual(view.text,'23:59:59 - Second\n23:59:59 - First');
 });
 it('keeps complete timestamps across midnight and unique IDs within the same millisecond',function(){
  const h=fixture();h.api.on_error('Before');h.time('2026-10-31T00:00:01.000');h.api.on_error('After');h.api.on_error('Same time');
  const entries=h.api.entries();assert.strictEqual(entries[0].time,'00:00:01');assert.strictEqual(entries[2].time,'23:59:59');
  assert(entries[0].timestamp===entries[1].timestamp&&entries[1].timestamp>entries[2].timestamp);
  assert(new Set(entries.map(entry=>entry.id)).size===3);
 });
 it('returns immutable entries in an independent snapshot',function(){
  const {api}=fixture();api.on_error('Preserved');const snapshot=api.entries();
  assert.throws(()=>{snapshot[0].message='Changed';},TypeError);snapshot.length=0;
  assert.strictEqual(api.entries()[0].message,'Preserved');
 });
 it('notifies the active view without overwriting its filtered DOM through the legacy path',function(){
  const {api,view}=fixture(),changes=[];const stop=api.subscribe(change=>changes.push(change));api.on_error('Live');
  assert.strictEqual(changes.length,1);assert.strictEqual(changes[0].type,'add');assert.strictEqual(changes[0].entry.message,'Live');assert.strictEqual(view.writes,0);
  stop();stop();api.on_error('Legacy again');assert.strictEqual(changes.length,1);assert(view.text.includes('Legacy again'));
 });
 it('clears the whole local history and starts new entries without restoring old messages',function(){
  const {api}=fixture(),changes=[];api.on_error('Old');const oldId=api.entries()[0].id;
  api.subscribe(change=>changes.push(change));api.clear();assert.strictEqual(api.entries().length,0);assert.strictEqual(changes[0].type,'clear');
  api.on_error('New');assert.strictEqual(api.entries().length,1);assert.strictEqual(api.entries()[0].message,'New');assert(api.entries()[0].id>oldId);
 });
 it('clears the legacy display too',function(){
  const {api,view}=fixture();api.on_error('Old');api.clear();assert.strictEqual(view.text,'');
 });
 it('continues notifying other views if one diagnostic listener fails',function(){
  const {api}=fixture(),seen=[];api.subscribe(()=>{throw new Error('Broken view');});api.subscribe(change=>seen.push(change));
  assert.doesNotThrow(()=>api.on_error('Recorded'));assert.strictEqual(seen[0].entry.message,'Recorded');assert.strictEqual(api.entries().length,1);
 });
 it('keeps console reporting and the native browser error handler connected',function(){
  const {api,context,view}=fixture();api.init();context.window.onerror('Browser error','script.js',1,2,new Error('Browser error'));api.silent('Console error');
  assert.strictEqual(api.entries()[1].message,'Browser error');assert.strictEqual(api.entries()[0].message,'Console error');assert.deepStrictEqual(view.console,['Console error']);
 });
});
