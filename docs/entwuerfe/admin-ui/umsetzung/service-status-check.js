'use strict';

const assert = require('assert');

module.exports = async function({c, open, check}) {
 await open(1920, 1080);
 const waitFor = async expression => {
  for (let attempt = 0; attempt < 100; attempt++) {
   if (await c.evaluate(expression)) return;
   await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Status did not update: ' + expression);
 };
 await waitFor('__serviceStatusRequests.length > 0');
 await c.evaluate(`
  window.__serviceStatusSnapshot = {btp:{status:'connected',fetch_in_progress:false},ticker:{status:'connected'},speech:{enabled:true},speech_health:{state:'ok',issues:[]}};
  window.__statusCount = __serviceStatusRequests.length;
 `);
 await waitFor('__serviceStatusRequests.length > __statusCount && document.querySelector(".ticker_status_badge").classList.contains("status_connected")');
 await check('Five-second refresh updates BTS, BTP, Ticker and speech without a BTP sync', `
  ['status_badge','btp_status_badge','ticker_status_badge','speech_output_status_badge'].every(name => document.querySelector('.'+name).classList.contains('status_connected'))
 `);
 await c.evaluate(`
  curt.btp_enabled = true;cleitstand.btpSync();
  __serviceStatusSnapshot.ticker = {status:'error',message:'Ticker nicht erreichbar'};
  __statusCount = __serviceStatusRequests.length;
  document.querySelector('.toprow_btp_sync_button').click();
 `);
 await waitFor('__serviceStatusRequests.length > __statusCount && document.querySelector(".ticker_status_badge").classList.contains("status_error")');
 await check('Manual sync immediately refreshes the other connections', `document.querySelector('.ticker_status_badge').title === 'Ticker nicht erreichbar'`);
 await c.evaluate(`
  __serviceStatusSnapshot.ticker = {status:'connected'};
  __serviceStatusSnapshot.speech_health = {state:'error',issues:[{source:'upstream_health',code:'ECONNREFUSED',message:'Sprachserver nicht erreichbar',retrying:true}]};
  __statusCount = __serviceStatusRequests.length;
  crouting.on_change({ctype:'btp_status',tournament_key:curt.key,val:{status:'connected',fetch_in_progress:true}});
  crouting.on_change({ctype:'btp_status',tournament_key:curt.key,val:{status:'connected',fetch_in_progress:false}});
 `);
 await waitFor('__serviceStatusRequests.length > __statusCount && document.querySelector(".speech_output_status_badge").classList.contains("status_error")');
 await check('Automatic sync refreshes all connections and replaces an old successful speech test', `
  document.querySelector('.ticker_status_badge').classList.contains('status_connected') && document.querySelector('.speech_output_status_badge').title.includes('Sprachserver nicht erreichbar')
 `);
 await c.evaluate(`
  __serviceStatusSnapshot.speech_health = {state:'ok',issues:[]};
  btsSpeechHealth.update(__serviceStatusSnapshot.speech_health);
 `);
 await check('Speech health recovery updates the badge immediately', `document.querySelector('.speech_output_status_badge').classList.contains('status_connected')`);
 await c.evaluate(`__speechFixture.settings.audio_error='audio_blocked';window.dispatchEvent(new Event('bts-speech-output-changed'))`);
 await check('Blocked local audio immediately replaces the stored active status', `document.querySelector('.speech_output_status_badge').classList.contains('status_error') && document.querySelector('.speech_output_status_badge').title.includes('Browser hat Audio gesperrt')`);
 await c.evaluate(`delete __speechFixture.settings.audio_error;window.dispatchEvent(new Event('bts-speech-output-changed'))`);
 const before = await c.evaluate('__localAnnouncements.length');
 for (const route of ['edit/btp', 'certificates', 'speech-planning/']) {
  await c.evaluate(`crouting.navigate_to('t/preview/${route}')`);
  await c.evaluate(`__serviceStatusSnapshot.ticker={status:'error',message:'Unterseite ${route}'};document.dispatchEvent(new Event('visibilitychange'))`);
  await waitFor(`document.querySelector('.ticker_status_badge').title === 'Unterseite ${route}'`);
 }
 await check('The shared status header keeps refreshing on settings, certificates and speech pages', `document.querySelector('.ticker_status_badge').classList.contains('status_error')`);
 assert.strictEqual(await c.evaluate('__localAnnouncements.length'), before, 'Status checks must not play test announcements');
 console.log('OK Status refresh never plays a test announcement');
};
