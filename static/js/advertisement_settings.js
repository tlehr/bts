/* global btsSettingsWorkspace, btsAdvertisementPicker, cleitstand */
'use strict';

// Keep the add form and unchanged media mounted when advertisements change live.
// eslint-disable-next-line no-unused-vars -- Used by the tournament settings.
var btsAdvertisementSettings = (() => {
 function mount(parent, {tournament, send, upload, loadLibrary, selectAsset, createId, onAdded, onRemoved}) {
  const doc = parent.ownerDocument, rows = new Map(), deleting = new Set();
  let adding = false, uploading = false, abortUpload = null, disposed = false;
  function el(owner, tag, className, value) {
   const node = doc.createElement(tag);node.className = className || '';
   if (value != null) node.textContent = value;owner.append(node);return node;
  }
  const text = (node, value) => {if (node.textContent !== String(value)) node.textContent = value;};
  const show = (node, value) => {if (node.hidden === value) node.hidden = !value;};
  const typeLabel = type => type === 'image' ? 'Bild' : type === 'video_file_url' ? 'Video' : 'Unbekannter Typ: ' + (type || 'nicht angegeben');
  const embedded = value => /^data:/i.test(value);
  const mediaURL = value => new URL(value, new URL('/bup/', doc.baseURI)).href;
  const sourceLabel = (value, type) => embedded(value) ? (type === 'image' ? 'Eingebettetes Bild' : 'Eingebettetes Video') : value;
  function supportedSource(value, type) {
   if (!value) return false;
   if (embedded(value)) return type === 'image' ? /^data:image\//i.test(value) : type === 'video_file_url' && /^data:video\//i.test(value);
   try {return ['http:', 'https:'].includes(new URL(mediaURL(value)).protocol);}
   catch (_) {return false;}
  }
  function stop(entry) {
   const video = entry.preview.querySelector('video');
   if (video) {video.pause();video.removeAttribute('src');video.load();}
  }
  function pause() {for (const entry of rows.values()) entry.preview.querySelector('video')?.pause();}
  const addBody = btsSettingsWorkspace.card(parent, {title:'Werbung hinzufügen', description:'Bilder und Videos für die Hallenanzeigen.', badge:'Serverweit'});
  const uploadFields = el(addBody, 'fieldset', 'settings-advertisement-form');
  const file = btsSettingsWorkspace.field(uploadFields, {label:'Datei auswählen', description:'PNG, JPG, GIF, WebP, MP4 oder WebM, bis 250 MB. Der Medientyp wird automatisch erkannt.',
   attributes:{type:'file', name:'advertisement_file', accept:'.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm'}});
  const uploadFooter = el(addBody, 'div', 'settings-advertisement-upload-footer');
  const progress = el(uploadFooter, 'progress', 'settings-advertisement-progress');progress.max = 1;progress.value = 0;progress.hidden = true;progress.setAttribute('aria-label','Datei hochladen');
  const uploadStatus = el(uploadFooter, 'span', 'settings-advertisement-hint');uploadStatus.setAttribute('role','status');
  const uploadActions = el(uploadFooter, 'div', 'settings-advertisement-upload-actions');
  const cancelUpload = el(uploadActions, 'button', 'btn', 'Abbrechen');cancelUpload.type = 'button';cancelUpload.hidden = true;
  const uploadButton = el(uploadActions, 'button', 'btn settings-advertisement-upload');uploadButton.type = 'button';
  uploadButton.innerHTML = cleitstand.icon('upload');const uploadLabel = el(uploadButton, 'span', '', 'Datei hochladen');
  const libraryButton = el(uploadActions, 'button', 'btn settings-advertisement-library-button', 'Vorhandene Datei auswählen');libraryButton.type = 'button';
  libraryButton.addEventListener('click', () => btsAdvertisementPicker.open({owner:parent,tournament,load:loadLibrary,
   select:(key,id,callback) => {
    adding = true;refreshAdd();
    selectAsset(key,id,(failure,response) => {
     if (!disposed) {adding = false;if (!failure) {onAdded(response.advertisement);update();}refreshAdd();}
     callback(failure,response);
    });
   },
  }));
  const uploadError = el(addBody, 'p', 'settings-advertisement-error');uploadError.setAttribute('role','status');uploadError.hidden = true;
  const uploadErrorDetails = el(addBody, 'details', 'settings-advertisement-error-details');uploadErrorDetails.hidden = true;
  el(uploadErrorDetails, 'summary', '', 'Fehlerdetails');
  const uploadErrorCause = el(uploadErrorDetails, 'pre');
  function setUploadError(failure) {
   text(uploadError,failure?.message || '');show(uploadError,!!failure);
   const details = failure ? [failure.status && 'HTTP ' + failure.status,failure.code && 'Fehlercode: ' + failure.code,
    failure.stage && 'Schritt: ' + failure.stage,failure.details].filter(Boolean).join('\n') : '';
   text(uploadErrorCause,details);show(uploadErrorDetails,!!details);uploadErrorDetails.open = false;
  }
  const addressDetails = el(addBody, 'details', 'settings-advertisement-url-options');
  el(addressDetails, 'summary', '', 'Stattdessen eine Medienadresse verwenden');
  // The settings workspace already owns a form. Use a fieldset to avoid nesting forms.
  const form = el(addressDetails, 'fieldset', 'settings-advertisement-form');
  const source = btsSettingsWorkspace.field(form, {label:'Medienadresse', description:'Die Adresse muss von den Anzeigegeräten erreichbar sein.',
   attributes:{type:'text', name:'advertisement_url', placeholder:'https://beispiel.de/sponsor.png', spellcheck:'false', inputmode:'url'}});
  const type = btsSettingsWorkspace.field(form, {label:'Medientyp', tag:'select', attributes:{name:'advertisement_type'}});
  for (const [value, label] of [['image','Bild'],['video_file_url','Video']]) el(type, 'option', '', label).value = value;
  const addFooter = el(addressDetails, 'div', 'settings-advertisement-add-footer');
  const hint = el(addBody, 'p', 'settings-advertisement-hint', 'Die Mediensammlung steht für alle Turniere auf diesem BTS-Server zur Verfügung.');
  hint.id = source.id + '-scope';
  const add = el(addFooter, 'button', 'btn settings-advertisement-add');add.type = 'button';
  add.innerHTML = cleitstand.icon('plus');const addLabel = el(add, 'span', '', 'Werbung hinzufügen');
  const error = el(addressDetails, 'p', 'settings-advertisement-error');error.setAttribute('role', 'status');error.hidden = true;
  const body = btsSettingsWorkspace.card(parent, {title:'Vorhandene Werbung', description:'Vorschau und gespeicherte Medien für die Anzeigen.', badge:'0 Medien'});
  const count = body.parentElement.querySelector('.settings-card-badge');
  const empty = el(body, 'p', 'settings-advertisement-empty', 'Noch keine Werbung vorhanden. Füge oben ein Bild oder ein Video hinzu.');
  const list = el(body, 'div', 'settings-advertisement-list');
  el(body, 'p', 'settings-advertisement-hint', 'Die Vorschauen zeigen die gespeicherten Dateien. Videos starten hier nur über die Wiedergabesteuerung.');
  function refreshAdd() {
   form.disabled = uploadFields.disabled = adding || uploading;add.disabled = adding || uploading || !source.value.trim();
   uploadButton.disabled = adding || uploading || !file.files.length;cancelUpload.hidden = !uploading;progress.hidden = !uploading;
   libraryButton.disabled = adding || uploading;
   text(uploadLabel, uploading ? 'Wird hochgeladen …' : 'Datei hochladen');
   text(addLabel, adding ? 'Wird hinzugefügt …' : 'Werbung hinzufügen');addBody.setAttribute('aria-busy', String(adding || uploading));
  }
  file.addEventListener('change', () => {setUploadError(null);text(uploadStatus,'');refreshAdd();});
  cancelUpload.addEventListener('click', () => abortUpload?.());
  uploadButton.addEventListener('click', () => {
   if (disposed || adding || uploading || !file.files.length) return;
   const selected = file.files[0];
   if (!selected.size || selected.size > 250*1024*1024 || !/\.(png|jpe?g|gif|webp|mp4|webm)$/i.test(selected.name)) {
    setUploadError({message:'Bitte ein Bild (PNG, JPG, GIF, WebP) oder ein Video (MP4, WebM) mit maximal 250 MB auswählen.'});return;
   }
   uploading = true;cancelUpload.disabled = false;progress.value = 0;setUploadError(null);text(uploadStatus,'Upload wird gestartet …');refreshAdd();
   abortUpload = upload(selected, value => {
    if (disposed || !uploading) return;
    progress.value = Math.max(0,Math.min(1,value));
    cancelUpload.disabled = value >= 1;
    text(uploadStatus,value >= 1 ? 'Datei übertragen, wird gespeichert …' : Math.round(value*100) + ' % hochgeladen');
   }, (failure, response) => {
    if (disposed) return;uploading = false;abortUpload = null;
    text(uploadStatus,failure?.cancelled ? 'Upload abgebrochen.' : '');
    if (failure && !failure.cancelled) setUploadError({...failure,message:failure.message || 'Die Datei konnte nicht hochgeladen werden. Bitte erneut versuchen.'});
    else if (!failure) {onAdded(response.advertisement);file.value = '';update();}
    refreshAdd();
   });
  });
  function addMedia() {
   if (disposed || adding || uploading) return;
   const url = source.value.trim();
   if (!supportedSource(url, type.value)) {source.setCustomValidity('Bitte eine gültige Bild- oder Videoadresse angeben.');source.reportValidity();return;}
   adding = true;show(error, false);refreshAdd();
   const advertisement = {id:createId(), url, type:type.value, disabled:false};
   send({type:'advertisement_add', tournament_key:tournament().key, advertisement}, (failure, response) => {
    if (disposed) return;adding = false;
    if (failure) {text(error, 'Die Werbung konnte nicht hinzugefügt werden. Deine Eingabe bleibt erhalten. Bitte erneut versuchen.');show(error, true);}
    else {onAdded(response?.advertisement);source.value = '';source.setCustomValidity('');update();}
    refreshAdd();if (!parent.hidden) source.focus({preventScroll:true});
   });
  }
  source.addEventListener('input', () => {source.setCustomValidity('');refreshAdd();});
  for (const input of [source, type]) input.addEventListener('keydown', event => {if (event.key === 'Enter') {event.preventDefault();addMedia();}});
  add.addEventListener('click', addMedia);
  function createRow(id) {
   const root = el(list, 'article', 'settings-advertisement');root.dataset.advertisementId = id;
   const preview = el(root, 'div', 'settings-advertisement-preview');
   const info = el(root, 'div', 'settings-advertisement-info'), heading = el(info, 'h3'), kind = el(info, 'p', 'settings-advertisement-kind'), state = el(info, 'span', 'settings-advertisement-state');
   const address = el(info, 'p', 'settings-advertisement-address');
   const actions = el(root, 'div', 'settings-advertisement-actions'), remove = el(actions, 'button', 'btn');remove.type = 'button';
   remove.innerHTML = cleitstand.icon('trash');const removeLabel = el(remove, 'span', '', 'Löschen');
   const status = el(info, 'p', 'settings-advertisement-error');status.setAttribute('role', 'status');status.hidden = true;
   const entry = {root, preview, heading, kind, state, address, remove, removeLabel, status};
   remove.addEventListener('click', () => {
    if (disposed || deleting.has(id)) return;
    const current = (tournament().advertisements || []).find(item => String(item._id || item.id) === id);if (!current?._id) return;
    deleting.add(id);show(status, false);update();
    send({type:'advertisement_remove', tournament_key:tournament().key, advertisement_id:current._id}, failure => {
     if (disposed) return;deleting.delete(id);
     if (failure) {text(status, 'Die Werbung konnte nicht gelöscht werden. Bitte erneut versuchen.');show(status, true);}
     else onRemoved(current._id);
     update();
    });
   });
   return entry;
  }
  function update() {
   if (disposed) return;
   const ads = tournament().advertisements || [], alive = new Set();
   text(count, ads.length + (ads.length === 1 ? ' Medium' : ' Medien'));show(empty, !ads.length);show(list, !!ads.length);
   for (const [index, ad] of ads.entries()) {
    const id = String(ad._id || ad.id);alive.add(id);
    const entry = rows.get(id) || createRow(id);rows.set(id, entry);
    text(entry.heading, ad.name || typeLabel(ad.type));text(entry.kind,typeLabel(ad.type));show(entry.kind,!!ad.name);
    text(entry.state, ad.disabled ? 'Inaktiv' : 'Aktiv');entry.state.dataset.state = ad.disabled ? 'inactive' : 'active';
    const url = String(ad.url || ''), mediaKey = JSON.stringify([ad.type,url,ad.bgcolor,ad.asset_id]);
    if (entry.mediaKey !== mediaKey) {
     entry.mediaKey = mediaKey;stop(entry);entry.preview.replaceChildren();
     entry.preview.style.backgroundColor = ad.bgcolor || '#000';
     if (['image','video_file_url'].includes(ad.type) && supportedSource(url, ad.type)) {
      const media = el(entry.preview, ad.type === 'image' ? 'img' : 'video');
      if (ad.type === 'image') {media.alt = 'Werbevorschau';media.loading = 'lazy';}
      else {media.controls = true;media.muted = true;media.preload = 'none';media.playsInline = true;media.setAttribute('aria-label', 'Werbevorschau – Video');}
      media.src = mediaURL(url);
      media.addEventListener('error', () => {if (entry.mediaKey === mediaKey) {media.hidden = true;text(entry.placeholder, 'Vorschau nicht verfügbar');show(entry.placeholder, true);}});
      entry.placeholder = el(entry.preview, 'span', 'settings-advertisement-placeholder');entry.placeholder.hidden = true;
     } else entry.placeholder = el(entry.preview, 'span', 'settings-advertisement-placeholder', 'Keine Vorschau verfügbar');
     entry.address.replaceChildren();
     if (supportedSource(url, ad.type) && !embedded(url)) {
      const link = el(entry.address, 'a', '', ad.asset_id ? 'Datei öffnen ↗' : url);link.href = mediaURL(url);link.target = '_blank';link.rel = 'noopener';
     } else text(entry.address, sourceLabel(url, ad.type) || 'Keine Adresse gespeichert');
    }
    entry.remove.disabled = deleting.has(id) || !ad._id;text(entry.removeLabel, deleting.has(id) ? 'Wird gelöscht …' : 'Löschen');
    entry.remove.setAttribute('aria-label', 'Werbung löschen: ' + (ad.name || sourceLabel(url, ad.type)));
    if (list.children[index] !== entry.root) list.insertBefore(entry.root, list.children[index] || null);
   }
   for (const [id, entry] of rows) if (!alive.has(id)) {stop(entry);entry.root.remove();rows.delete(id);}
  }
  const observer = new MutationObserver(() => {if (parent.hidden || !parent.isConnected) pause();});
  observer.observe(parent, {attributes:true, attributeFilter:['hidden']});
  function destroy() {disposed = true;abortUpload?.();observer.disconnect();pause();rows.clear();}
  update();refreshAdd();return {update, destroy};
 }
 return {mount};
})();
