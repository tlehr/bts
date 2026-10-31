'use strict';
const fs = require('fs'), path = require('path');

module.exports = async function({c, check, click, open, metrics, previews}) {
 const checks = [], verify = async (name, expression) => {await check(name, expression);checks.push(name);};
 const selector = '.unassigned_container tr[data-match_id="match-49"]';
 const row = `document.querySelector('${selector}')`;
 const visible = `(()=>{const row=${row},cell=row.querySelector('.court_number'),badge=cell.querySelector('.preparation_call_deferred_badge');if(!badge)return false;const box=badge.getBoundingClientRect(),area=cell.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(badge);const text=range.getBoundingClientRect(),control=row.querySelector('.call_td').getBoundingClientRect();return badge.textContent===ci18n('match:status:deferred')&&box.width>60&&box.left>=area.left&&box.right<=area.right&&box.top>=area.top&&box.bottom<=area.bottom&&text.left>=box.left&&text.right<=box.right&&box.right<control.left&&!row.querySelector('.call_td .preparation_call_deferred_badge');})()`;
 const change = async code => c.evaluate(`(()=>{const match=structuredClone(curt.matches.find(match=>match._id==='match-49'));${code};crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}});})()`);
 await open(1920,1080);
 await verify('Deferred status sits beside the game number in the location column, separate from call icons', visible);
 await verify('The existing location remains readable beside the deferred status', `${row}.querySelector('.court_number .location').textContent==='Sporthalle Nord'&&${row}.classList.contains('preparation_call_deferred')`);
 for (const [width,height] of [[1920,1080],[1280,900],[390,844]]) {
  await metrics(width,height);
  for (const comfort of [false,true]) {
   if (await c.evaluate(`document.querySelector('.leitstand').classList.contains('comfort')!==${comfort}`)) await click('[data-action="density"]');
   await c.evaluate(`${row}.scrollIntoView({block:'center',inline:'start'})`);
   await verify('Deferred status remains fully visible at '+width+' pixels in '+(comfort?'comfort':'compact')+' density', visible);
  }
 }
 await metrics(1920,1080);
 if (await c.evaluate("document.querySelector('.leitstand').classList.contains('comfort')")) await click('[data-action="density"]');
 await change("match.setup.state='scheduled';match.setup.highlight=0;delete match.setup.location_id;delete match.setup.court_id;delete match.setup.preparation_call_timestamp");
 await verify('A live deferred update without a location replaces the dash with one legible status', `${visible}&&${row}.querySelectorAll('.preparation_call_deferred_badge').length===1&&${row}.querySelector('.court_number').textContent===ci18n('match:status:deferred')`);
 await c.evaluate(`${row}.scrollIntoView({block:'center',inline:'start'})`);
 const geometry = await c.evaluate(`(()=>{const row=${row},r=row.getBoundingClientRect(),b=row.querySelector('.preparation_call_deferred_badge').getBoundingClientRect();return {clip:{x:r.left+scrollX,y:r.top+scrollY,width:Math.min(r.width,innerWidth-r.left),height:r.height,scale:1},point:{x:b.left+b.width/2,y:b.top+b.height/2}}})()`);
 await c.call('Input.dispatchMouseEvent', {type:'mouseMoved', ...geometry.point});
 await verify('The status is under the real pointer and is not covered by another control', `document.elementFromPoint(${geometry.point.x},${geometry.point.y}).closest('.preparation_call_deferred_badge')!==null`);
 const shot = await c.call('Page.captureScreenshot', {format:'png',captureBeyondViewport:false,clip:geometry.clip});
 fs.writeFileSync(path.join(previews,'zurueckgestellt-status.png'),Buffer.from(shot.data,'base64'));
 await c.evaluate(`window.__deferredBadge=${row}.querySelector('.preparation_call_deferred_badge');cmatch.refresh_unassigned_preparation_context()`);
 await verify('Repeated preparation diagnostics retain the same status node', `${row}.querySelector('.preparation_call_deferred_badge')===__deferredBadge`);
 await change('delete match.setup.preparation_call_deferred');
 await verify('Releasing a deferred game removes both status and gray row formatting', `!${row}.querySelector('.preparation_call_deferred_badge')&&!${row}.classList.contains('preparation_call_deferred')`);
 await change('match.setup.preparation_call_deferred=true');
 await verify('Deferring the same game again restores exactly one status without changing its players', `${visible}&&${row}.querySelectorAll('.preparation_call_deferred_badge').length===1&&${row}.querySelectorAll('.team-one .player').length===2&&${row}.querySelectorAll('.team-two .player').length===2`);
 await change('match.setup.teams[1].players=[]');
 await verify('The deferred status is also shown when a pairing is not yet complete', visible);
 const exceptions = c.events.filter(event => event.method==='Runtime.exceptionThrown');
 await verify('Deferred status changes produce no browser exceptions or server writes', `__writes.length===0&&${exceptions.length}===0`);
 fs.writeFileSync(path.join(previews,'deferred-match-verification.json'),JSON.stringify({date:'2026-10-31',scope:'Isolated real frontend with synthetic tournament data; no live services.',checks,exceptions:exceptions.length},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
