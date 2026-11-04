/* global cleitstand, cbts_utils */
'use strict';

// eslint-disable-next-line no-unused-vars -- Used by the advertisement settings.
var btsAdvertisementPicker = (() => {
 function open({owner, tournament, load, select}) {
  const doc = owner.ownerDocument;if (doc.querySelector('.settings-advertisement-dialog')) return;
  const key = tournament().key, opener = doc.activeElement;
  function el(parent, tag, className, text) {
   const node = doc.createElement(tag);node.className = className || '';
   if (text != null) node.textContent = text;parent.append(node);return node;
  }
  const dialog = el(doc.body, 'dialog', 'leitstand-dialog settings-advertisement-dialog');dialog.setAttribute('aria-labelledby','settings-advertisement-dialog-title');
  const header = el(dialog, 'header', 'dialog-heading'), heading = el(header, 'h2', '', 'Vorhandene Werbung auswählen');heading.id = 'settings-advertisement-dialog-title';
  const close = el(header, 'button', 'ls-dialog-close');close.type = 'button';close.setAttribute('aria-label','Schließen');close.innerHTML = cleitstand.icon('close');
  const form = el(dialog, 'form'), content = el(form, 'div', 'settings-advertisement-dialog-content');
  el(content, 'p', 'settings-advertisement-dialog-hint', 'Wähle eine bereits hochgeladene Datei aus. Dateien, die schon in der Werbeliste stehen, sind markiert.');
  const status = el(content, 'p', 'settings-advertisement-dialog-status');status.setAttribute('role','status');
  const retry = el(content, 'button', 'btn', 'Erneut laden');retry.type = 'button';retry.hidden = true;
  const grid = el(content, 'div', 'settings-advertisement-gallery');grid.setAttribute('role','radiogroup');grid.setAttribute('aria-label','Gespeicherte Werbedateien');
  const footer = el(form, 'footer', 'ls-dialog-footer'), cancel = el(footer, 'button', 'btn', 'Abbrechen'), save = el(footer, 'button', 'btn primary', 'Datei übernehmen');
  cancel.type = 'button';save.type = 'submit';save.disabled = true;
  let disposed = false, busy = false, loading = false, selected = '', items = [], abortLoad;
  const videos = new IntersectionObserver(entries => {
   for (const entry of entries) if (entry.isIntersecting) {entry.target.preload = 'metadata';videos.unobserve(entry.target);}
  }, {root:content, rootMargin:'100px'});
  function stop() {
   for (const video of grid.querySelectorAll('video')) {video.pause();video.removeAttribute('src');video.load();}
   for (const image of grid.querySelectorAll('img')) image.removeAttribute('src');
  }
  function refresh() {
   save.disabled = busy || loading || !selected;
   close.disabled = cancel.disabled = busy;grid.inert = busy;retry.disabled = loading;
   save.textContent = busy ? 'Wird übernommen …' : 'Datei übernehmen';form.setAttribute('aria-busy',String(busy || loading));
  }
  function finish(force = false) {
   if (disposed || busy && !force) return;
   disposed = true;abortLoad?.();observer.disconnect();videos.disconnect();stop();cbts_utils.esc_stack_pop();
   if (dialog.open) dialog.close();dialog.remove();if (opener?.isConnected) opener.focus({preventScroll:true});
  }
  const observer = new MutationObserver(() => {if (!owner.isConnected || owner.hidden || !dialog.isConnected) finish(true);});
  function request() {
   if (loading || busy || disposed) return;
   loading = true;selected = '';status.textContent = 'Werbedateien werden geladen …';status.classList.remove('is-error');retry.hidden = true;
   videos.disconnect();stop();grid.replaceChildren();refresh();
   abortLoad = load(key, (error, response) => {
    if (disposed) return;loading = false;
    if (error) {status.textContent = 'Die Werbedateien konnten nicht geladen werden. Bitte erneut versuchen.';status.classList.add('is-error');retry.hidden = false;refresh();return;}
    items = [...(response.assets || [])].sort((a,b) => Number(!!a.advertisement_id)-Number(!!b.advertisement_id));
    status.textContent = items.length ? '' : 'Noch keine gespeicherten Werbedateien vorhanden. Du kannst eine neue Datei hochladen.';
    for (const item of items) {
     const date = new Date(item.uploaded_at), dateText = Number.isFinite(date.getTime()) ? date.toLocaleString('de-DE',{dateStyle:'short',timeStyle:'short'}) : '';
     const name = item.name || (dateText ? 'Datei vom ' + dateText : 'Gespeicherte Werbedatei');
     const card = el(grid, 'label', 'settings-advertisement-choice');card.classList.toggle('is-assigned',!!item.advertisement_id);
     const input = el(card, 'input');input.type = 'radio';input.name = 'saved_advertisement';input.value = item.id;input.disabled = !!item.advertisement_id;
     const preview = el(card, 'span', 'settings-advertisement-choice-preview'), video = item.type === 'video_file_url';
     const media = el(preview,video ? 'video' : 'img');
     if (video) {media.controls = true;media.muted = true;media.playsInline = true;media.preload = 'none';media.setAttribute('aria-label','Videovorschau: ' + name);videos.observe(media);}
     else {media.alt = '';media.loading = 'lazy';}
     media.src = item.url;
     const missing = el(preview, 'span', '', 'Vorschau nicht verfügbar');missing.hidden = true;
     media.addEventListener('error', () => {media.hidden = true;missing.hidden = false;});
     el(card, 'span', 'settings-advertisement-choice-name',name);
     el(card, 'span', 'settings-advertisement-choice-info',(video ? 'Video' : 'Bild') + (dateText ? ' · ' + dateText : ''));
     if (item.advertisement_id) el(card, 'span', 'settings-advertisement-choice-assigned', 'Bereits in der Liste');
     input.addEventListener('change', () => {selected = input.value;status.textContent = '';status.classList.remove('is-error');refresh();});
    }
    refresh();(grid.querySelector('input:not(:disabled)') || cancel).focus({preventScroll:true});
   });
  }
  form.addEventListener('submit', event => {
   event.preventDefault();if (busy || loading || save.disabled || !items.some(item => item.id === selected && !item.advertisement_id)) return;
   busy = true;status.textContent = '';for (const video of grid.querySelectorAll('video')) video.pause();refresh();
   select(key,selected,error => {
    if (disposed) return;busy = false;
    if (error) {status.textContent = error.message || 'Die Werbedatei konnte nicht übernommen werden. Bitte erneut versuchen.';status.classList.add('is-error');refresh();return;}
    finish();
   });
  });
  for (const button of [close,cancel]) button.addEventListener('click', () => finish());
  retry.addEventListener('click',request);
  dialog.addEventListener('cancel',event => {event.preventDefault();finish();});
  dialog.addEventListener('close', () => finish(true));
  dialog.addEventListener('keydown',event => {if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();finish();}});
  dialog.addEventListener('click',event => {if (event.target === dialog) finish();});
  observer.observe(doc.body,{childList:true,subtree:true});cbts_utils.esc_stack_push(() => finish());
  observer.observe(owner,{attributes:true,attributeFilter:['hidden']});
  dialog.showModal();cancel.focus({preventScroll:true});request();
 }
 return {open};
})();
