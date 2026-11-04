'use strict';
const assert = require('assert');

module.exports = async function({c, open, check, key, metrics}) {
 await open(1920, 1080);await c.evaluate("document.querySelector('.leitstand-nav a[href$=\"/edit\"]').click()");
 await c.evaluate(`(async()=>{for(let i=0;i<100;i++){if(document.querySelector('.page-settings'))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error('Settings did not open');})()`);
 await check('Every integer and decimal setting uses the common numeric control', `
  [...document.querySelectorAll('.page-settings input[type="number"]')].length>0 && [...document.querySelectorAll('.page-settings input[type="number"]')].every(input=>input.btsNumber&&input.nextElementSibling.classList.contains('number-input-stepper'))
 `);
 await c.evaluate(`
  window.__numberField = name => document.querySelector('.page-settings [name="'+name+'"]');
  document.querySelector('.settings-area-link[href$="/edit/speech"]').click();
  window.__numberSpeed = __numberField('announcement_speed');
  __numberSpeed.nextElementSibling.querySelector('[data-step="up"]').click();
 `);
 await check('The decimal mouse arrow adds precisely one hundredth and saves the numeric value', `curt.announcement_speed===1.06 && __numberSpeed.valueAsNumber===1.06`);
 await key('ArrowDown', 'ArrowDown', 40);
 await check('Keyboard and mouse arrows share decimal steps', `curt.announcement_speed===1.05 && __numberSpeed.valueAsNumber===1.05`);
 for (const type of ['keyDown','keyUp']) await c.call('Input.dispatchKeyEvent',{type,key:'ArrowUp',code:'ArrowUp',windowsVirtualKeyCode:38,modifiers:8});
 await check('Shift changes decimal settings in tenfold steps', `curt.announcement_speed===1.15 && __numberSpeed.valueAsNumber===1.15`);
 await c.evaluate(`__numberSpeed.nextElementSibling.firstElementChild.dispatchEvent(new MouseEvent('click',{shiftKey:true,bubbles:true}));__numberSpeed.nextElementSibling.firstElementChild.dispatchEvent(new MouseEvent('click',{shiftKey:true,bubbles:true}))`);
 await check('The existing maximum bounds coarse and fine steps without floating point artifacts', `curt.announcement_speed===1.3 && __numberSpeed.value==='1.3' && __numberSpeed.validity.valid`);
 await c.evaluate('__numberSpeed.focus();__numberSpeed.select()');await c.call('Input.insertText',{text:'1,08'});
 const comma = await c.evaluate('__numberSpeed.value');
 assert.strictEqual(comma, '1.08', 'A decimal comma must remain a decimal instead of becoming an integer');
 await c.evaluate('__numberSpeed.blur()');
 await check('Typing a decimal comma saves a normal numeric value', `curt.announcement_speed===1.08`);
 await c.evaluate(`
  document.querySelector('.settings-area-link[href$="/edit/calls"]').click();
  window.__numberInteger = __numberField('preparation_successor_rally_count');
  __numberInteger.nextElementSibling.firstElementChild.click();
 `);
 await check('Integer settings use whole-number steps and remain normal native number inputs', `curt.preparation_successor_rally_count===12 && __numberInteger.valueAsNumber===12 && __numberInteger.type==='number'`);
 await c.evaluate(`__numberInteger.readOnly=true;window.__numberBefore=__numberInteger.value`);
 await check('Read-only numeric controls disable both arrows', `[...__numberInteger.nextElementSibling.children].every(button=>button.disabled)`);
 await c.evaluate(`__numberInteger.nextElementSibling.firstElementChild.click()`);
 await check('Read-only arrows cannot change a value', `__numberInteger.value===__numberBefore`);
 await c.evaluate('__numberInteger.readOnly=false');
 await check('Re-enabling the numeric input restores both arrows', `[...__numberInteger.nextElementSibling.children].every(button=>!button.disabled)`);
 await check('Numeric and duration arrows use the same petrol appearance', `(()=>{const duration=__numberField('preparation_call_min_gap_seconds').nextElementSibling.firstElementChild;return getComputedStyle(duration).backgroundColor===getComputedStyle(__numberInteger.nextElementSibling.firstElementChild).backgroundColor;})()`);
 for (const width of [1920, 950, 390, 320]) {
  await metrics(width,1080);
  await check('All visible numeric arrows fit inside their inputs at '+width, `
   [...document.querySelectorAll('.page-settings input.number-input')].filter(input=>input.getClientRects().length).every(input=>{const r=input.getBoundingClientRect(),a=input.nextElementSibling.getBoundingClientRect();return a.left>r.left&&a.right<=r.right+.5&&a.top>=r.top&&a.bottom<=r.bottom+.5&&parseFloat(getComputedStyle(input).paddingRight)>=a.width+4;}) && document.documentElement.scrollWidth<=innerWidth+1
  `);
 }
 await c.evaluate(`
  window.__numberTestForm=document.createElement('form');__numberTestForm.innerHTML='<fieldset><label>Testzahl<input name="test_number" type="number" required min="1" max="5" step="1" value="2"></label></fieldset>';
  document.body.append(__numberTestForm);window.__numberSubmits=0;
  __numberTestForm.addEventListener('submit',event=>{event.preventDefault();__numberSubmits++;});
 `);
 await check('Dynamically opened forms also receive the shared numeric controls', `__numberTestForm.elements.test_number.btsNumber && __numberTestForm.elements.test_number.nextElementSibling.children.length===2`);
 await c.evaluate(`__numberTestForm.elements.test_number.nextElementSibling.firstElementChild.click()`);
 await check('Numeric arrows in a form edit the value without submitting the dialog', `__numberTestForm.elements.test_number.value==='3' && __numberSubmits===0`);
 await c.evaluate(`__numberTestForm.querySelector('fieldset').disabled=true`);
 await check('A disabled fieldset also disables the embedded numeric arrows', `[...__numberTestForm.elements.test_number.nextElementSibling.children].every(button=>button.disabled)`);
 await c.evaluate(`__numberTestForm.querySelector('fieldset').disabled=false;__numberTestForm.elements.test_number.value='2.5'`);
 await check('Integer step constraints keep rejecting fractional values', `!__numberTestForm.elements.test_number.checkValidity()`);
 await c.evaluate(`__numberTestForm.elements.test_number.value=''`);
 await check('Required numeric fields retain native empty-value validation', `!__numberTestForm.checkValidity()`);
 await c.evaluate('__numberTestForm.remove()');
};
