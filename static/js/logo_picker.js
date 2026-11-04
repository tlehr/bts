/* global cleitstand, cbts_utils */
'use strict';

// eslint-disable-next-line no-unused-vars -- Used by the tournament settings.
var btsLogoPicker = (() => {
 function open({owner, tournament, load, select}) {
  const doc = owner.ownerDocument;if (doc.querySelector('.settings-logo-dialog')) return;
  const key = tournament().key, opener = doc.activeElement;
  function el(parent, tag, className, text) {
   const node = doc.createElement(tag);node.className = className || '';
   if (text != null) node.textContent = text;parent.append(node);return node;
  }
  const dialog = el(doc.body, 'dialog', 'leitstand-dialog settings-logo-dialog');dialog.setAttribute('aria-labelledby', 'settings-logo-dialog-title');
  const header = el(dialog, 'header', 'dialog-heading'), heading = el(header, 'h2', '', 'Vorhandenes Logo auswählen');heading.id = 'settings-logo-dialog-title';
  const close = el(header, 'button', 'ls-dialog-close');close.type = 'button';close.setAttribute('aria-label', 'Schließen');close.innerHTML = cleitstand.icon('close');
  const form = el(dialog, 'form'), content = el(form, 'div', 'settings-logo-dialog-content');
  el(content, 'p', 'settings-logo-dialog-hint', 'Wähle ein bereits hochgeladenes Logo aus. Hintergrund- und Textfarbe dieses Turniers bleiben erhalten.');
  const status = el(content, 'p', 'settings-logo-dialog-status');status.setAttribute('role', 'status');
  const retry = el(content, 'button', 'btn', 'Erneut laden');retry.type = 'button';retry.hidden = true;
  const grid = el(content, 'div', 'settings-logo-gallery');grid.setAttribute('role', 'radiogroup');grid.setAttribute('aria-label', 'Gespeicherte Logos');
  const footer = el(form, 'footer', 'ls-dialog-footer'), cancel = el(footer, 'button', 'btn', 'Abbrechen'), save = el(footer, 'button', 'btn primary', 'Logo übernehmen');
  cancel.type = 'button';save.type = 'submit';save.disabled = true;
  let disposed = false, busy = false, loading = false, selected = '', items = [];
  function refresh() {
   save.disabled = busy || loading || !selected || selected === tournament().logo_id;
   close.disabled = cancel.disabled = busy;grid.inert = busy;retry.disabled = loading;
   save.textContent = busy ? 'Wird übernommen …' : 'Logo übernehmen';form.setAttribute('aria-busy', String(busy || loading));
  }
  function finish(force = false) {
   if (disposed || busy && !force) return;
   disposed = true;observer.disconnect();cbts_utils.esc_stack_pop();
   if (dialog.open) dialog.close();dialog.remove();if (opener?.isConnected) opener.focus({preventScroll:true});
  }
  const observer = new MutationObserver(() => {if (!owner.isConnected || !dialog.isConnected) finish(true);});
  function request() {
   if (loading || busy || disposed) return;
   loading = true;status.textContent = 'Logos werden geladen …';status.classList.remove('is-error');retry.hidden = true;grid.replaceChildren();refresh();
   load(key, (error, response) => {
    if (disposed) return;loading = false;
    if (error) {status.textContent = 'Die Logos konnten nicht geladen werden. Bitte erneut versuchen.';status.classList.add('is-error');retry.hidden = false;refresh();return;}
    const current = tournament().logo_id;
    items = [...(response.logos || [])].sort((a, b) => Number(b.id === current) - Number(a.id === current));
    selected = items.some(item => item.id === current) ? current : '';
    status.textContent = items.length ? '' : 'Noch keine gespeicherten Logos vorhanden. Du kannst ein neues Logo hochladen.';
    for (const item of items) {
     const date = new Date(item.uploaded_at), dateText = Number.isFinite(date.getTime()) ? date.toLocaleString('de-DE', {dateStyle:'short', timeStyle:'short'}) : '';
     const name = item.name || (dateText ? 'Logo vom ' + dateText : 'Gespeichertes Logo');
     const card = el(grid, 'label', 'settings-logo-choice');
     const input = el(card, 'input');input.type = 'radio';input.name = 'saved_logo';input.value = item.id;input.checked = item.id === selected;
     const preview = el(card, 'span', 'settings-logo-choice-preview'), image = el(preview, 'img');
     image.src = '/h/' + encodeURIComponent(key) + '/logo/' + encodeURIComponent(item.id);image.alt = '';image.loading = 'lazy';
     el(card, 'span', 'settings-logo-choice-name', name);
     if (item.name && dateText) el(card, 'span', 'settings-logo-choice-date', dateText);
     if (item.id === current) el(card, 'span', 'settings-logo-choice-current', 'Aktuelles Logo');
     input.addEventListener('change', () => {selected = input.value;status.textContent = '';status.classList.remove('is-error');refresh();});
    }
    refresh();(grid.querySelector('input:checked') || grid.querySelector('input') || cancel).focus({preventScroll:true});
   });
  }
  form.addEventListener('submit', event => {
   event.preventDefault();if (busy || loading || save.disabled || !items.some(item => item.id === selected)) return;
   busy = true;status.textContent = '';refresh();
   select(key, selected, error => {
    if (disposed) return;busy = false;
    if (error) {status.textContent = error.message || 'Das Logo konnte nicht übernommen werden. Bitte erneut versuchen.';status.classList.add('is-error');refresh();return;}
    finish();
   });
  });
  for (const button of [close, cancel]) button.addEventListener('click', () => finish());
  retry.addEventListener('click', request);
  dialog.addEventListener('cancel', event => {event.preventDefault();finish();});
  dialog.addEventListener('close', () => finish(true));
  dialog.addEventListener('keydown', event => {if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();finish();}});
  dialog.addEventListener('click', event => {if (event.target === dialog) finish();});
  observer.observe(doc.body, {childList:true, subtree:true});cbts_utils.esc_stack_push(() => finish());
  dialog.showModal();cancel.focus({preventScroll:true});request();
 }
 return {open};
})();
