'use strict';
const assert=require('assert');
const {helperEndpoint}=require('../static/js/speech_infrastructure');

describe('Automatic speech-helper download address',function(){
 for(const host of ['127.0.0.1','127.0.0.2','localhost','[::1]']) {
  it('uses the browser BTS host for a local upstream at '+host+' while retaining the speech port',function(){
   assert.strictEqual(helperEndpoint('http://'+host+':8077','https://192.0.2.10:4433/admin/t/default/edit/speech'),'http://192.0.2.10:8077');
  });
 }
 it('preserves an independently hosted or public speech-server address',function(){
  for(const address of ['https://speech.example:8443','http://192.0.2.20:8077','https://[2001:db8::20]:8077']) {
   assert.strictEqual(helperEndpoint(address,'https://bts.example:4433/admin/'),address);
  }
 });
 it('supports an IPv6 browser host and never replaces a speech port with the BTS port',function(){
  assert.strictEqual(helperEndpoint('http://127.0.0.1:8077','https://[2001:db8::10]:4433/admin/'),'http://[2001:db8::10]:8077');
 });
 it('does not invent a remote address when the browser also uses localhost',function(){
  assert.strictEqual(helperEndpoint('http://127.0.0.1:8077','http://localhost:4000/admin/'),'http://127.0.0.1:8077');
 });
 it('does not enable a download with a missing or malformed address',function(){
  for(const value of [undefined,null,'','bad-url','file:///tmp/helpers','javascript:void(0)'])assert.strictEqual(helperEndpoint(value,'http://bts.example/admin/'),'');
 });
});
