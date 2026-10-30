'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const context={localStorage:{getItem:()=>null},calc:require('../static/bup/dev/js/calc')};
vm.runInNewContext(fs.readFileSync(require.resolve('../static/js/cleitstand'),'utf8'),context);
const day=(match,options)=>JSON.parse(JSON.stringify(context.cleitstand.matchDay(match,options)));

describe('Tournament list dates',function(){
 it('uses only the saved planned date for unassigned games',function(){
  const result=day({setup:{scheduled_date:'2026-10-30',scheduled_time_str:'09:00'},end_ts:Date.parse('2026-11-01T10:00Z')});
  assert.strictEqual(result.key,'2026-10-30');assert(result.label.includes('Freitag')&&result.label.includes('30.')&&result.label.includes('Oktober')&&result.label.includes('2026'));
 });
 it('does not infer a planned date from a clock time or the current day',function(){
  for(const scheduled_date of [undefined,null,'','30.10.2026','2026-10-30T09:00:00'])assert.strictEqual(day({setup:{scheduled_date,scheduled_time_str:'09:00'}}),null);
 });
 it('rejects impossible calendar dates instead of silently rolling into the next month',function(){
  for(const scheduled_date of ['2026-02-29','2026-04-31','2026-13-01'])assert.strictEqual(day({setup:{scheduled_date}}),null);
  assert.strictEqual(day({setup:{scheduled_date:'2028-02-29'}}).key,'2028-02-29');
 });
 it('uses the end day in the tournament time zone',function(){
  const match={end_ts:Date.parse('2026-10-30T23:15:00Z')};
  assert.strictEqual(day(match,{finished:true,timeZone:'Europe/Berlin'}).key,'2026-10-31');
  assert.strictEqual(day(match,{finished:true,timeZone:'America/New_York'}).key,'2026-10-30');
 });
 it('follows the selected start or end field for a game crossing midnight',function(){
  const match={end_ts:Date.parse('2026-10-30T23:10:00Z'),duration_ms:30*60*1000};
  assert.strictEqual(day(match,{finished:true,key:'start'}).key,'2026-10-30');
  assert.strictEqual(day(match,{finished:true,key:'end'}).key,'2026-10-31');
 });
 it('keeps Plan separate from actual completion dates',function(){
  assert.strictEqual(day({setup:{scheduled_date:'2026-10-29'},end_ts:Date.parse('2026-10-30T23:15:00Z')},{finished:true,key:'plan'}).key,'2026-10-29');
 });
 it('keeps the recorded day when the selected sort field has no date',function(){
  for(const key of ['start','end','number'])assert.strictEqual(day({setup:{scheduled_date:'2026-10-30'}},{finished:true,key}).key,'2026-10-30');
  for(const key of ['plan','start','end','number'])assert.strictEqual(day({end_ts:Date.parse('2026-10-30T12:00Z')},{finished:true,key}).key,'2026-10-30');
 });
 it('uses the other actual timestamp if the chosen one was not recorded',function(){
  assert.strictEqual(day({end_ts:Date.parse('2026-10-30T12:00Z')},{finished:true,key:'start'}).key,'2026-10-30');
  assert.strictEqual(day({presses:[{type:'love-all',timestamp:Date.parse('2026-10-29T10:00Z')}]},{finished:true,key:'end'}).key,'2026-10-29');
 });
 it('leaves dates unknown when no actual or valid planned date exists',function(){
  for(const key of ['start','end','plan','number'])assert.strictEqual(day({setup:{scheduled_date:'2026-02-30'}},{finished:true,key}),null);
 });
 it('uses the game day when sorting by number with a saved-plan fallback',function(){
  assert.strictEqual(day({setup:{scheduled_date:'2026-10-29'},end_ts:Date.parse('2026-10-30T12:00Z')},{finished:true,key:'number'}).key,'2026-10-30');
  assert.strictEqual(day({setup:{scheduled_date:'2026-10-29'}},{finished:true,key:'number'}).key,'2026-10-29');
 });
 it('can reuse already rendered timestamps without recalculating the match history',function(){
  const match={presses:[{type:'love-all',timestamp:Date.parse('2026-10-29T10:00Z')}]};
  const original=JSON.stringify(match),times={start:Date.parse('2026-10-30T10:00Z'),end:null};
  assert.strictEqual(day(match,{finished:true,key:'start',times}).key,'2026-10-30');assert.strictEqual(JSON.stringify(match),original);
 });
 it('falls back to the tournament default for an invalid time zone',function(){
  assert.strictEqual(day({end_ts:Date.parse('2026-10-30T23:15:00Z')},{finished:true,timeZone:'invalid-zone'}).key,'2026-10-31');
 });
});
