'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const source=fs.readFileSync(require.resolve('../static/js/cleitstand'),'utf8');
const code=source.slice(source.indexOf('  const metricsStorageKey='),source.indexOf('  function teamMetricsKey'));
const widths={plainWidths:[120,90,60],plainStackedWidths:[60,45,30]};
function load(storage=new Map(),{version='release-a',family='Arial',ratio=1,status='loaded',userAgent='test-browser'}={}) {
 const fonts=Object.assign([{family,style:'normal',weight:'400',stretch:'normal',status:'loaded',unicodeRange:'U+0-FFFF'}],{status});
 let hide;
 const context={document:{querySelector:()=>version?{content:version}:null,fonts},navigator:{userAgent},devicePixelRatio:ratio,window:{addEventListener:(type,fn)=>{assert.equal(type,'pagehide');hide=fn;}},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},plainTeamWidths:new Map()};
 vm.runInNewContext(code+';this.sync=syncNameMetrics;',context);
 return{sync:context.sync,hide:()=>hide(),map:context.plainTeamWidths,fonts,storage};
}
function primed() {const h=load();h.sync();h.map.set('team',widths);h.hide();return h;}
describe('native name metrics across reloads of the same tab',()=>{
 it('restores only numeric widths and writes once when leaving, never during live updates',()=>{
  const first=load();first.sync();first.map.set('team',widths);assert.equal(first.storage.size,0);first.hide();assert.equal(first.storage.size,1);
  const next=load(first.storage);next.sync();assert.equal(next.map.get('team').plainWidths[0],120);
 });
 it('rejects different assets, fonts, pixel ratios or browser versions',()=>{
  const h=primed();for(const changed of [{version:'release-b'},{family:'Different font'},{ratio:2},{userAgent:'other-browser'},{version:null}]) {const next=load(h.storage,changed);next.sync();assert.equal(next.map.size,0);}
 });
 it('waits for fonts before restoring measurements or saving fallback metrics',()=>{
  const h=primed(),next=load(h.storage,{status:'loading'});next.sync();assert.equal(next.map.size,0);next.hide();next.fonts.status='loaded';next.sync();assert.equal(next.map.get('team').plainWidths[0],120);
 });
 it('ignores expired, corrupt, invalid or oversized stored data',()=>{
  const h=primed(),key=[...h.storage.keys()][0],saved=JSON.parse(h.storage.get(key));
  for(const raw of ['{','x'.repeat(1024*1024+1),JSON.stringify({...saved,created:Date.now()-7*60*60*1000}),JSON.stringify({...saved,created:Date.now()+60000}),JSON.stringify({...saved,entries:[['bad',{plainWidths:[-1],plainStackedWidths:[10]}]]})]) {const next=load(new Map([[key,raw]]));assert.doesNotThrow(()=>next.sync());assert.equal(next.map.size,0);}
 });
 it('falls back without errors when session storage is denied or full',()=>{
  const storage={get(){throw new Error('denied');},set(){throw new Error('full');}},h=load(storage);assert.doesNotThrow(()=>h.sync());h.map.set('team',widths);assert.doesNotThrow(()=>h.hide());
 });
 it('bounds the stored payload and the number of restored entries',()=>{
  const h=load();h.sync();for(let i=0;i<1000;i++)h.map.set(i+'x'.repeat(2000),widths);h.hide();assert([...h.storage.values()][0].length<=1024*1024);
  const next=load(h.storage);next.sync();assert(next.map.size<=512&&next.map.size>0);
 });
});
