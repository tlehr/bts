'use strict';
const assert=require('assert'),crypto=require('crypto'),{SpeechBroker,configuration}=require('../bts/speech/broker');
describe('speech content addresses',function(){
 it('preserves the public SHA-256 content address through voice/configuration changes and eviction',function(){
  const broker=new SpeechBroker(configuration({},{})),hash=(...values)=>crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
  for(const voice of ['hallensprecher','hallensprecherin'])for(const text of ['Hallo','Umlaute: ÄÖÜ 😃','~bts-context-v2~'+JSON.stringify({before:'',text:'Name',after:'!',kind:'team'})])
   for(let n=0;n<3;n++)assert.strictEqual(broker.key(text,voice,'de-DE'),hash(text,voice,'de-DE'));
  for(let n=0;n<9000;n++)broker.key('Name '+n,'hallensprecher','de-DE');
  assert(broker.part_keys.size<=8192);assert(broker.part_key_bytes<=8*1024*1024);
  for(let n=0;n<4;n++)assert.strictEqual(broker.key('Name '+n,'hallensprecher','de-DE'),hash('Name '+n,'hallensprecher','de-DE'));
  const huge='x'.repeat(5*1024*1024);assert.strictEqual(broker.key(huge,'hallensprecher','de-DE'),hash(huge,'hallensprecher','de-DE'));
  assert(broker.part_key_bytes<=8*1024*1024);
 });
});
