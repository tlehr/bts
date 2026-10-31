'use strict';

// Select-only companion to the searchable official picker. Native form values
// and validation stay on the select; the button never opens a text keyboard.
// eslint-disable-next-line no-unused-vars -- Used by the classic browser scripts.
var btsChoicePicker = (() => {
 const instances = new Set();
 let sequence = 0;
 const attr = (node, name, value) => {if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));};
 function create(select, {icon, beforeOpen}) {
  const lifetime = new AbortController(), {signal} = lifetime, id = 'choice-picker-' + (++sequence);
  const label = select.closest('label'), caption = label?.querySelector('.match_edit_field_label'), oldFor = label?.htmlFor || '';
  const wrapper = document.createElement('span');wrapper.className = 'ls-choice-picker';wrapper.dataset.field = select.name;
  select.before(wrapper);wrapper.append(select);select.hidden = true;
  const trigger = document.createElement('button');trigger.type = 'button';trigger.id = id;trigger.className = 'ls-choice-trigger';
  trigger.setAttribute('role', 'combobox');trigger.setAttribute('aria-haspopup', 'listbox');trigger.setAttribute('aria-autocomplete', 'none');
  trigger.setAttribute('aria-controls', id + '-list');trigger.setAttribute('aria-expanded', 'false');wrapper.append(trigger);
  if (label) label.htmlFor = id;
  const symbol = document.createElement('span');symbol.className = 'ls-choice-symbol';trigger.append(symbol);
  const value = document.createElement('span');value.className = 'ls-choice-value';trigger.append(value);
  const text = document.createElement('span');text.className = 'ls-choice-label';value.append(text);
  const context = document.createElement('small');context.className = 'ls-choice-context';value.append(context);
  const arrow = document.createElement('span');arrow.className = 'ls-choice-arrow';arrow.innerHTML = icon('down');trigger.append(arrow);
  const error = document.createElement('span');error.className = 'ls-choice-error';error.id = id + '-error';error.hidden = true;
  const errorIcon = document.createElement('span');errorIcon.innerHTML = icon('alert');error.append(errorIcon);
  const errorText = document.createElement('span');error.append(errorText);
  error.setAttribute('role', 'alert');wrapper.append(error);
  const popup = document.createElement('div');popup.id = id + '-list';popup.className = 'ls-choice-options';popup.hidden = true;
  popup.dataset.field = select.name;popup.setAttribute('role', 'listbox');popup.setAttribute('aria-label', caption?.textContent || select.name);document.body.append(popup);
  const rows = new Map();let items = [], active = null, disposed = false, rowSequence = 0;
  function drawSymbol(node, option) {
   const court = option?.dataset.courtNumber, symbolName = option?.dataset.icon || 'info';
   const key = court != null ? 'court:' + court : symbolName;
   if (node.dataset.symbol === key) return;
   node.dataset.symbol = key;node.textContent = '';
   if (court != null) {const number = document.createElement('span');number.className = 'ls-resource-court';number.textContent = court;node.append(number);}
   else node.innerHTML = icon(symbolName);
  }
  function activate(row, scroll = false) {
   if (active !== row) {active?.node.classList.remove('is-active');active = row;active?.node.classList.add('is-active');}
   if (active) {attr(trigger, 'aria-activedescendant', active.node.id);if (scroll) active.node.scrollIntoView({block: 'nearest'});}
   else trigger.removeAttribute('aria-activedescendant');
  }
  function close() {
   popup.hidden = true;attr(trigger, 'aria-expanded', false);activate(null);
  }
  function refreshValidity() {
   const message = select.validationMessage;
   attr(trigger, 'aria-invalid', !!message);
   if (select.hasAttribute('aria-required')) attr(trigger, 'aria-required', select.getAttribute('aria-required'));
   error.hidden = !message;
   if (errorText.textContent !== message) errorText.textContent = message;
   if (message) attr(trigger, 'aria-describedby', error.id);else trigger.removeAttribute('aria-describedby');
  }
  function position() {
   if (popup.hidden) return;
   const box = trigger.getBoundingClientRect(), panel = select.closest('.edit_match_container')?.getBoundingClientRect();
   if (!trigger.getClientRects().length || trigger.closest('[hidden],[inert]') || box.bottom < Math.max(0, panel?.top || 0) || box.top > Math.min(innerHeight, panel?.bottom ?? innerHeight)) {close();return;}
   const above = box.top - 8, below = innerHeight - box.bottom - 8, upwards = below < 160 && above > below;
   const width = Math.min(box.width, innerWidth - 16);
   popup.style.width = width + 'px';popup.style.left = Math.max(8, Math.min(box.left, innerWidth - width - 8)) + 'px';
   popup.style.maxHeight = Math.min(300, Math.max(0, upwards ? above : below)) + 'px';
   popup.style.top = upwards ? 'auto' : box.bottom + 4 + 'px';
   popup.style.bottom = upwards ? innerHeight - box.top + 4 + 'px' : 'auto';
  }
  function refresh() {
   if (disposed) return;
   const seen = new Set();items = [];
   for (const option of select.options) {
    if (option.hidden || seen.has(option.value)) continue;
    seen.add(option.value);
    let row = rows.get(option.value);
    if (!row) {
     const node = document.createElement('div');node.className = 'ls-choice-option';node.id = id + '-option-' + (++rowSequence);node.setAttribute('role', 'option');
     const rowSymbol = document.createElement('span');rowSymbol.className = 'ls-choice-symbol';node.append(rowSymbol);
     const rowText = document.createElement('span');rowText.className = 'ls-choice-label';node.append(rowText);
     const check = document.createElement('span');check.className = 'ls-choice-check';check.innerHTML = icon('check');node.append(check);
     row = {node, symbol: rowSymbol, text: rowText};rows.set(option.value, row);
     node.addEventListener('mousedown', event => event.preventDefault(), {signal});
     node.addEventListener('click', () => choose(row), {signal});
     node.addEventListener('mousemove', () => {if (!row.disabled) activate(row);}, {signal});
    }
    row.option = option;row.disabled = option.disabled || option.parentElement.disabled;
    row.node.dataset.value = option.value;row.node.dataset.level = option.dataset.level || '0';row.node.dataset.kind = option.dataset.kind || '';
    attr(row.node, 'aria-selected', option.selected);attr(row.node, 'aria-disabled', row.disabled);
    if (row.text.textContent !== option.textContent) row.text.textContent = option.textContent;
    drawSymbol(row.symbol, option);items.push(row);
   }
   for (const [key, row] of rows) if (!seen.has(key)) {row.node.remove();rows.delete(key);}
   items.forEach((row, index) => {if (popup.children[index] !== row.node) popup.insertBefore(row.node, popup.children[index] || null);});
   const selected = select.selectedOptions[0];
   if (text.textContent !== (selected?.textContent || '')) text.textContent = selected?.textContent || '';
   if (context.textContent !== (selected?.dataset.context || '')) context.textContent = selected?.dataset.context || '';
   context.hidden = !context.textContent;drawSymbol(symbol, selected);
   attr(trigger, 'aria-label', [caption?.textContent, text.textContent, context.textContent].filter(Boolean).join(' '));
   trigger.disabled = select.disabled;refreshValidity();
   if (select.disabled) close();
   else if (!popup.hidden) {if (!items.includes(active)) activate(items.find(row => row.option.selected) || items.find(row => !row.disabled));position();}
  }
  function open() {
   if (disposed || select.disabled) return;
   trigger.focus({preventScroll: true});
   closeAll();beforeOpen?.();refresh();popup.hidden = false;position();
   if (popup.hidden) return;
   attr(trigger, 'aria-expanded', true);activate(items.find(row => row.option.selected) || items.find(row => !row.disabled), true);
  }
  function choose(row) {
   if (!row || row.disabled || select.disabled) return;
   const changed = select.value !== row.option.value;
   select.value = row.option.value;close();refresh();
   if (changed) select.dispatchEvent(new Event('change', {bubbles: true}));
   trigger.focus({preventScroll: true});
  }
  trigger.addEventListener('click', () => {if (popup.hidden) open();else close();}, {signal});
  trigger.addEventListener('keydown', event => {
   const key = event.key;
   if (key === 'Escape' && !popup.hidden) {event.preventDefault();event.stopPropagation();close();return;}
   if (key === 'Tab') {close();return;}
   if (!['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
   event.preventDefault();event.stopPropagation();
   if (key === 'Enter' || key === ' ') {if (popup.hidden) open();else choose(active);return;}
   if (popup.hidden) {open();if (key.startsWith('Arrow')) return;}
   const enabled = items.filter(row => !row.disabled);if (!enabled.length) return;
   const index = enabled.indexOf(active), last = enabled.length - 1;
   const next = key === 'Home' ? 0 : key === 'End' ? last : index < 0 ? (key === 'ArrowUp' ? last : 0) : (index + (key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
   activate(enabled[next], true);
  }, {signal});
  trigger.addEventListener('blur', close, {signal});
  select.addEventListener('change', refresh, {signal});
  select.addEventListener('focus', () => trigger.focus({preventScroll: true}), {signal});
  select.addEventListener('invalid', event => {event.preventDefault();refreshValidity();trigger.focus({preventScroll: true});}, {signal});
  document.addEventListener('pointerdown', event => {if (!wrapper.contains(event.target) && !popup.contains(event.target)) close();}, {signal});
  document.addEventListener('scroll', event => {if (!popup.contains(event.target)) position();}, {capture: true, signal});
  window.addEventListener('resize', position, {signal});
  const api = {refresh, close, destroy() {
   disposed = true;lifetime.abort();popup.remove();instances.delete(api);
   select.hidden = false;wrapper.replaceWith(select);if (label) label.htmlFor = oldFor;
  }};
  instances.add(api);refresh();return api;
 }
 function closeAll() {for (const picker of instances) picker.close();}
 function destroyAll() {for (const picker of instances) picker.destroy();}
 return {create, closeAll, destroyAll};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = btsChoicePicker;
