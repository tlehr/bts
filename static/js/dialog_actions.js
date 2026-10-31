'use strict';

// Shared lifecycle for editable dialogs. Match-specific actions stay with the caller.
// eslint-disable-next-line no-unused-vars -- Used by classic browser scripts.
var btsDialogActions = (() => {
 const instances = new WeakMap();
 let confirmation = null, confirmationSequence = 0;
 function dismissConfirmation(owner) {
  if (confirmation && (!owner || confirmation.owner === owner || owner.contains(confirmation.owner))) confirmation.finish(false);
 }
 function confirm({owner, title, message, confirmLabel, cancelLabel, danger = false, warning = false, returnFocus}) {
  if (!owner?.isConnected || confirmation?.owner === owner) return Promise.resolve(false);
  dismissConfirmation();
  const document = owner.ownerDocument, previousFocus = returnFocus || document.activeElement;
  const dialog = document.createElement('dialog');dialog.className = 'bts-confirm-dialog';dialog.setAttribute('role', 'alertdialog');
  dialog.setAttribute('aria-modal', 'true');
  const sequence = ++confirmationSequence;
  const heading = document.createElement('h2');heading.className = 'bts-confirm-heading';heading.id = 'bts-confirm-title-' + sequence;
  const caption = document.createElement('span');caption.className = 'bts-confirm-title';caption.textContent = title;heading.append(caption);
  const content = document.createElement('div');content.className = 'bts-confirm-content';content.id = 'bts-confirm-content-' + sequence;content.tabIndex = 0;
  dialog.setAttribute('aria-labelledby', heading.id);dialog.setAttribute('aria-describedby', content.id);
  // Render paragraphs and bullet lists as text, never as supplied HTML.
  for (const paragraph of message.split(/\n\n+/)) {
   const lines = paragraph.split('\n');
   if (lines.every(line => line.startsWith('• '))) {
    const list = document.createElement('ul');
    for (const line of lines) {const item = document.createElement('li');item.textContent = line.slice(2);list.append(item);}
    content.append(list);
   } else {const text = document.createElement('p');text.textContent = paragraph;content.append(text);}
  }
  const footer = document.createElement('div');footer.className = 'bts-confirm-actions';
  const cancel = document.createElement('button');cancel.type = 'button';cancel.className = 'bts-confirm-cancel';cancel.textContent = cancelLabel;cancel.autofocus = true;
  const accept = document.createElement('button');accept.type = 'button';accept.className = 'bts-confirm-accept';accept.textContent = confirmLabel;
  if (danger || warning) {
   const appearance = danger ? 'is-danger' : 'is-warning';
   dialog.classList.add(appearance);accept.classList.add(appearance);
   const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
   icon.setAttribute('class', 'bts-confirm-warning');icon.setAttribute('viewBox', '0 0 24 24');icon.setAttribute('aria-hidden', 'true');icon.setAttribute('focusable', 'false');
   const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
   path.setAttribute('d', 'm12 3 10 18H2Z M12 9v5M12 17v1');icon.append(path);heading.prepend(icon);
  }
  footer.append(cancel, accept);dialog.append(heading, content, footer);
  let resolve, completed = false;
  const promise = new Promise(done => {resolve = done;});
  const lifetime = new AbortController(), {signal} = lifetime;
  const observer = new MutationObserver(() => {if (!owner.isConnected || !dialog.isConnected) finish(false);});
  const finish = approved => {
   if (completed) return;completed = true;observer.disconnect();lifetime.abort();
   if (confirmation?.dialog === dialog) confirmation = null;
   if (dialog.open) dialog.close();dialog.remove();
   if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true});
   resolve(approved);
  };
  confirmation = {owner, dialog, finish};
  cancel.addEventListener('click', () => finish(false), {signal});accept.addEventListener('click', () => finish(true), {signal});
  dialog.addEventListener('cancel', event => {event.preventDefault();finish(false);}, {signal});
  dialog.addEventListener('close', () => finish(false), {signal});
  dialog.addEventListener('click', event => {if (event.target === dialog) finish(false);}, {signal});
  dialog.addEventListener('wheel', event => {if (!content.contains(event.target)) event.preventDefault();}, {signal, passive: false});
  dialog.addEventListener('keydown', event => {
   if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();finish(false);return;}
   if (event.key !== 'Tab') return;
   event.preventDefault();event.stopPropagation();
   const fields = [content, cancel, accept], current = fields.indexOf(document.activeElement);
   fields[(current + (event.shiftKey ? -1 : 1) + fields.length) % fields.length].focus();
  }, {signal});
  document.body.append(dialog);observer.observe(document.body, {childList: true, subtree: true});
  try {dialog.showModal();cancel.focus({preventScroll: true});}
  catch (error) {finish(false);throw error;}
  return promise;
 }
 function snapshot(form, ignore = []) {
  return JSON.stringify([...new FormData(form)].filter(([name]) => !ignore.includes(name)).sort(([a], [b]) => a.localeCompare(b)));
 }
 function attribute(node, name, value) {
  if (value == null) { if (node.hasAttribute(name)) node.removeAttribute(name); }
  else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
 }
 function control(node, { hidden = false, disabled = false, label, reason = '' } = {}) {
  if (node.hidden !== hidden) node.hidden = hidden;
  if ('disabled' in node) { if (node.disabled !== disabled) node.disabled = disabled; }
  else if (node.matches('a[href]')) { attribute(node, 'aria-disabled', disabled ? 'true' : null);if (node.tabIndex !== (disabled ? -1 : 0)) node.tabIndex = disabled ? -1 : 0; }
  if (label != null && node.textContent !== label) node.textContent = label;
  attribute(node, 'title', reason || null);
 }
 function create(form, { onUpdate, confirmDiscard, ignore = [], read = () => snapshot(form, ignore) }) {
  let baseline = read(), currentSnapshot = baseline, dirty = false, busy = null, destroyed = false;
  const state = () => ({ dirty, busy });
  const notify = () => { onUpdate(state());return state(); };
  const refresh = () => { currentSnapshot = read();dirty = currentSnapshot !== baseline;return notify(); };
  const input = () => refresh();
  // Capture prevents duplicate submits before the existing form handler runs.
  const submit = event => { refresh();if (busy || !dirty) { event.preventDefault();event.stopImmediatePropagation(); } };
  form.addEventListener('input', input);form.addEventListener('change', input);form.addEventListener('submit', submit, true);
  const controller = {
   state, refresh,
   changedFields() {
    const before = new Map(JSON.parse(baseline)), after = new Map(JSON.parse(currentSnapshot));
    return [...new Set([...before.keys(), ...after.keys()])].filter(name => before.get(name) !== after.get(name));
   },
   begin(operation) { refresh();if (busy || (operation === 'save' && !dirty)) return false;busy = operation;notify();return true; },
   end() { busy = null;refresh(); },
   accept() { baseline = currentSnapshot = read();dirty = false;busy = null;notify(); },
   ignoreFields(names) {
    const excluded = new Set(names);
    for (const name of names) if (!ignore.includes(name)) ignore.push(name);
    baseline = JSON.stringify(JSON.parse(baseline).filter(([name]) => !excluded.has(name)));
    return refresh();
   },
   canClose() {
    if (destroyed) return false;
    refresh();if (busy) return false;if (!dirty) return true;
    const answer = confirmDiscard();
    return answer && typeof answer.then === 'function' ? answer.then(approved => !!approved && !destroyed && !busy) : !!answer;
   },
   destroy() { destroyed = true;dismissConfirmation(form);form.removeEventListener('input', input);form.removeEventListener('change', input);form.removeEventListener('submit', submit, true);instances.delete(form); },
  };
  instances.set(form, controller);notify();return controller;
 }
 return { create, get: form => instances.get(form), control, snapshot, confirm, dismissConfirmation };
})();

/*@DEV*/
if (typeof module !== 'undefined') module.exports = btsDialogActions;
/*/@DEV*/
