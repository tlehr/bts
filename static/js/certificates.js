/* global btsDialogActions, crouting, btsCertificateDesign, btsCertificateDocument, btsCertificateDesigner, save_file */
'use strict';

// The certificates workspace shares export generation with the existing data builder.
// eslint-disable-next-line no-unused-vars -- Used by the classic tournament script.
var btsCertificates = (() => {
 let sequence = 0;
 function create({owner, tournament, getTournament, request, exportFile, onDispose}) {
  const tournamentKey = tournament.key;
  const doc = owner.ownerDocument, prefix = 'certificate-export-' + (++sequence);
  function el(parent, tag, className = '', text) {
   const node = doc.createElement(tag);node.className = className;
   if (text != null) node.textContent = text;parent.append(node);return node;
  }
  const page = el(owner, 'section', 'leitstand page-certificates'), title = doc.getElementById('leitstand-page-title');
  if (title) page.setAttribute('aria-labelledby', title.id);else page.setAttribute('aria-label', 'Urkunden');
  const tabs = el(page, 'div', 'certificate-workspace-tabs');tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', 'Urkundenbereich');
  function tab(label, id) {const node = el(tabs, 'button', 'btn', label);node.type = 'button';node.setAttribute('role', 'tab');node.id = prefix + '-' + id;return node;}
  const selectionTab = tab('Disziplinen', 'selection-tab'), designTab = tab('Urkunde gestalten', 'design-tab');
  let activeTab = 'selection';
  const form = el(page, 'form', 'certificate-export-form');
  const scroll = el(form, 'div', 'certificate-export-content');
  const content = el(scroll, 'fieldset', 'certificate-export-fields');content.setAttribute('aria-label', 'Exporteinstellungen');content.id = prefix + '-selection';content.setAttribute('role', 'tabpanel');content.setAttribute('aria-labelledby', selectionTab.id);selectionTab.setAttribute('aria-controls', content.id);
  const designOwner = el(scroll, 'fieldset', 'certificate-designer');designOwner.id = prefix + '-design';designOwner.hidden = true;designOwner.setAttribute('role', 'tabpanel');designOwner.setAttribute('aria-labelledby', designTab.id);designTab.setAttribute('aria-controls', designOwner.id);
  el(content, 'p', 'certificate-export-intro', 'Exporteinstellungen werden automatisch gespeichert. Wählen Sie die Disziplinen für die gewünschte Datei aus.');
  const footer = el(form, 'div', 'certificate-export-footer'), feedback = el(footer, 'div', 'certificate-export-feedback');
  const selectionInfo = el(feedback, 'p', 'certificate-export-selection');selectionInfo.setAttribute('aria-live', 'polite');
  const hint = el(feedback, 'p', 'certificate-export-hint');hint.id = prefix + '-status';hint.setAttribute('role', 'status');hint.setAttribute('aria-live', 'polite');
  hint.tabIndex = 0;
  const actions = el(footer, 'div', 'certificate-export-actions');
  function button(label, className) { const node = el(actions, 'button', 'btn ' + className, label);node.type = 'button';return node; }
  const retry = button('Erneut speichern', 'certificate-export-retry');retry.hidden = true;
  const pdf = button('PDF erzeugen', 'certificate-export-pdf'), print = button('Drucken', 'certificate-export-print');
  const probe = button('Probe-PDF', 'certificate-export-probe'), markPrint = button('Druck als ausgegeben markieren', 'certificate-export-mark-print');probe.hidden = markPrint.hidden = true;
  const csv = button('CSV exportieren', 'certificate-export-csv'), xlsx = button('XLSX exportieren', 'certificate-export-xlsx');
  for (const node of [csv, xlsx, retry, pdf, print, probe, markPrint]) node.setAttribute('aria-describedby', hint.id);
  let disposed = false, busy = null, timer = null, pending = {}, failed = {}, error = '', closing = false, confirming = false, notice = '', destination = null;
  let lastPrint = null, documentProgress = '';
  let config = {hasEvents: () => false, selectionSummary: () => '', onStateChange() {}, readOptions: () => ({selected_certificate_keys: new Set()}), readDocumentRows: () => [], readPreviewRows: () => [], documentError: () => '', validate: () => '', hasRows: () => false, onMarkers() {}};
  const designer = btsCertificateDesigner.create({owner: designOwner, tournamentKey, initial: tournament.certificate_design,
   getRecords: kind => {const records = btsCertificateDesign.records(config.readDocumentRows()).filter(record => record.kind === kind);return records.length ? records : btsCertificateDesign.records(config.readPreviewRows(kind));},
   onChange: design => saveSettings({certificate_design: design}, true), onStateChange: () => refresh(),
  });
  function setTab(value, focus = false) {
   activeTab = value;content.hidden = value !== 'selection';designOwner.hidden = value !== 'design';
   for (const [node, id] of [[selectionTab, 'selection'], [designTab, 'design']]) {node.setAttribute('aria-selected', String(value === id));node.tabIndex = value === id ? 0 : -1;}
   if (focus) (value === 'design' ? designTab : selectionTab).focus();
   if (value === 'design') designer.refresh();refresh();
  }
  const active = () => !disposed && page.isConnected && owner.isConnected && getTournament()?.key === tournamentKey;
  const hasChanges = () => Object.keys(pending).length || Object.keys(failed).length;
  function unavailable() {
   if (busy === 'mark-print') return 'Druckstatus wird gespeichert.';
   if (busy === 'pdf' || busy === 'print' || busy === 'probe') return documentProgress || 'Urkunden werden erstellt.';
   if (designer.busy()) return 'Die Hintergrundvorlage wird gespeichert.';
   if (busy) return busy === 'save' ? 'Exporteinstellungen werden gespeichert.' : busy === 'reset' ? 'Exportstatus wird zurückgesetzt.' : 'Die Exportdatei wird erstellt und der Exportstatus gespeichert.';
   if (error) return error;
   if (hasChanges()) return 'Exporteinstellungen werden noch gespeichert.';
   if (!config.hasEvents()) return 'Keine Disziplinen mit Platzierungsspielen vorhanden.';
   const invalid = config.validate();if (invalid) return invalid;
   if (!config.readOptions().selected_certificate_keys.size) return 'Bitte mindestens eine Disziplin auswählen.';
   if (!config.hasRows()) return 'Für die Auswahl sind noch keine eindeutigen Platzierungen verfügbar.';
   return '';
  }
  function documentReason(probeOnly = false) {
   if (busy || designer.busy() || error || hasChanges()) return unavailable();
   const designError = designer.error();if (designError) return designError;
   return probeOnly ? '' : unavailable() || config.documentError();
  }
  function refresh() {
   if (!active()) return;
   const reason = unavailable();
   const selectionText = config.selectionSummary();if (selectionInfo.textContent !== selectionText) selectionInfo.textContent = selectionText;selectionInfo.hidden = !config.hasEvents();
   const text = reason || notice || 'Exporteinstellungen werden automatisch gespeichert.';
   if (hint.textContent !== text) hint.textContent = text;
   hint.classList.toggle('is-error', !!error);
   content.disabled = designOwner.disabled = (!!busy && busy !== 'save') || designer.busy();
   if (busy || designer.busy()) form.setAttribute('aria-busy', 'true');else form.removeAttribute('aria-busy');
   btsDialogActions.control(csv, {hidden: !config.hasEvents(), disabled: !!reason || confirming, reason, label: busy === 'csv' ? 'CSV wird exportiert…' : 'CSV exportieren'});
   btsDialogActions.control(xlsx, {hidden: !config.hasEvents(), disabled: !!reason || confirming, reason, label: busy === 'xlsx' ? 'XLSX wird exportiert…' : 'XLSX exportieren'});
   btsDialogActions.control(retry, {hidden: !Object.keys(failed).length, disabled: !!busy || confirming, reason: busy ? reason : ''});
   const documentError = documentReason(), probeError = documentReason(true);
   btsDialogActions.control(pdf, {hidden: !config.hasEvents(), disabled: !!documentError || confirming, reason: documentError, label: busy === 'pdf' ? 'PDF wird erstellt…' : 'PDF erzeugen'});
   btsDialogActions.control(print, {hidden: !config.hasEvents(), disabled: !!documentError || confirming, reason: documentError, label: busy === 'print' ? 'Druck wird vorbereitet…' : 'Drucken'});
   btsDialogActions.control(probe, {hidden: activeTab !== 'design', disabled: !!probeError || confirming, reason: probeError});
   btsDialogActions.control(markPrint, {label: lastPrint ? lastPrint.count + ' gedruckte Urkunden markieren' : 'Druck als ausgegeben markieren', hidden: !lastPrint, disabled: !!busy || designer.busy() || !!hasChanges() || confirming, reason: busy ? reason : ''});
   config.onStateChange({resetReason: busy ? reason : hasChanges() ? 'Bitte zuerst die Exporteinstellungen speichern.' : confirming ? 'Bitte zuerst die geöffnete Bestätigung schließen.' : ''});
  }
  function dispose() {
   if (disposed) return;disposed = true;
   if (timer !== null) clearTimeout(timer);timer = null;pending = {};failed = {};
   observer.disconnect();lifetime.abort();designer.dispose();btsDialogActions.dismissConfirmation(form);
   page.remove();onDispose();
  }
  function send(message, done) {
   try { request(message, (err, response) => { if (active()) done(err, response); }); }
   catch (err) { if (active()) done(err); }
  }
  function settingsError(err, props) {
   const detail = typeof err?.message === 'string' ? err.message.trim() : typeof err === 'string' ? err.trim() : '';
   const outdated = (detail.startsWith('Unbekannter Platzhalter:') || detail === 'Ungültige Textformatierung.') && props.certificate_design && !btsCertificateDesign.validate(props.certificate_design);
   return ['Exporteinstellungen konnten nicht gespeichert werden.', detail,
    outdated ? 'Browser und BTS-Server verwenden unterschiedliche Vorlagenstände. Bitte BTS neu starten.' : '',
    'Bitte erneut speichern.'].filter(Boolean).join(' ');
  }
  function flush() {
   if (!active() || busy || !hasChanges()) return;
   if (timer !== null) clearTimeout(timer);timer = null;
   const props = {...failed, ...pending};failed = {};pending = {};busy = 'save';error = '';refresh();
   send({type: 'tournament_edit_props', key: tournamentKey, props}, err => {
    busy = null;
    if (err) { if (timer !== null) clearTimeout(timer);timer = null;failed = {...props, ...pending};pending = {};error = settingsError(err, props);closing = false; }
    else { Object.assign(tournament, props);Object.assign(getTournament(), props);if (hasChanges()) flush();else if (closing) { finishNavigation();return; } }
    refresh();
   });
  }
  function saveSettings(changes, deferred = false) {
   if (!active()) return;Object.assign(pending, changes);notice = '';
   if (timer !== null) clearTimeout(timer);timer = null;
   if (deferred) timer = setTimeout(() => { timer = null;flush(); }, 250);else flush();
   refresh();
  }
  function finishNavigation() {
   const next = destination;destination = null;dispose();next?.();
  }
  async function navigate(next, trigger = doc.activeElement) {
   if (!active() || confirming) return;
   if (designer.busy()) {hint.focus({preventScroll: true});return;}
   if (busy && busy !== 'save') {hint.focus({preventScroll: true});return;}
   destination = next;
   if (busy === 'save') {closing = true;return;}
   if (Object.keys(pending).length) {closing = true;flush();return;}
   if (Object.keys(failed).length) {
    confirming = true;refresh();
    const approved = await btsDialogActions.confirm({owner: form, returnFocus: trigger, warning: true,
     title: 'Nicht gespeicherte Exporteinstellungen', message: 'Die letzten Exporteinstellungen konnten nicht gespeichert werden. Beim Verlassen des Urkundenbereichs gehen diese Änderungen verloren. Bereits heruntergeladene Dateien bleiben erhalten.',
     confirmLabel: 'Änderungen verwerfen und wechseln', cancelLabel: 'Weiter bearbeiten'});
    confirming = false;if (!active()) return;if (!approved) {destination = null;refresh();return;}
   }
   finishNavigation();
  }

  function runExport(format) {
   if (!active() || unavailable() || confirming || !form.reportValidity()) return;
   const options = config.readOptions();busy = format;error = '';notice = '';refresh();
   try { exportFile(format, options); }
   catch (_) { busy = null;notice = 'Die Exportdatei konnte nicht erstellt werden. Bitte erneut versuchen.';refresh();return; }
   send({type: 'certificate_export_mark', tournament_key: tournamentKey, event_names: [...options.selected_certificate_keys]}, (err, response) => {
    busy = null;
    if (err) notice = 'Die Datei wurde erstellt, aber der Exportstatus konnte nicht gespeichert werden. Ein erneuter Export erstellt eine weitere Datei.';
    else { config.onMarkers(response?.certificate_exports || {});notice = (format === 'csv' ? 'CSV' : 'XLSX') + '-Datei wurde erstellt.'; }
    refresh();
   });
  }
  async function runDocument(mode) {
   if (!active() || documentReason(mode === 'probe') || confirming) return;
   const preview = mode === 'probe' ? designer.getPreview() : null, records = preview ? [preview.record] : btsCertificateDesign.records(config.readDocumentRows());
   const keys = [...new Set(records.map(record => record.event_name).filter(Boolean))], recordsSignature = JSON.stringify(records);
   busy = mode;notice = '';documentProgress = 'Urkunden werden erstellt…';refresh();
   try {
    const bytes = await btsCertificateDocument.createPdf(designer.getDesign(), records, {tournamentKey, signal: lifetime.signal, replacePlaceholders: preview?.replacePlaceholders ?? true,
     onProgress: (done, total) => {if (active()) {documentProgress = done + ' von ' + total + ' Urkunden erstellt.';refresh();}},
    });
    if (!active()) return;
    if (mode !== 'probe' && recordsSignature !== JSON.stringify(btsCertificateDesign.records(config.readDocumentRows()))) throw new Error('Die ausgewählten Platzierungen haben sich während der Erzeugung geändert. Bitte die Urkunden erneut erstellen.');
    if (mode === 'print') {
     await btsCertificateDocument.printPdf(bytes);if (!active()) return;
     lastPrint = {keys, count: records.length};busy = null;notice = 'Druckdialog geöffnet. Nach erfolgreichem Druck kann die Ausgabe markiert werden.';refresh();return;
    }
    save_file(new Blob([bytes], {type: 'application/pdf'}), mode === 'probe' ? 'urkunde-probe.pdf' : 'urkunden.pdf');
    if (mode === 'probe') {busy = null;notice = 'Probe-PDF erstellt. Es wurden keine Disziplinen als ausgegeben markiert.';refresh();return;}
    send({type: 'certificate_export_mark', tournament_key: tournamentKey, event_names: keys}, (err, response) => {
     busy = null;
     if (err) notice = 'Die PDF wurde erstellt, aber der Exportstatus konnte nicht gespeichert werden. Ein erneuter Export erstellt eine weitere Datei.';
     else {config.onMarkers(response?.certificate_exports || {});notice = records.length + ' Urkunden als PDF erstellt.';}
     refresh();
    });
   } catch (err) {if (active()) {busy = null;notice = err.message || 'Die Urkunden konnten nicht erstellt werden.';refresh();}}
  }
  function markPrinted() {
   if (!lastPrint || !active() || busy || hasChanges() || confirming || designer.busy()) return;
   const printed = lastPrint;busy = 'mark-print';refresh();
   send({type: 'certificate_export_mark', tournament_key: tournamentKey, event_names: printed.keys}, (err, response) => {
    busy = null;
    if (err) notice = 'Der Druckstatus konnte nicht gespeichert werden. Bitte die Ausgabe erneut markieren.';
    else {config.onMarkers(response?.certificate_exports || {});lastPrint = null;notice = printed.count + ' gedruckte Urkunden als ausgegeben markiert.';}
    refresh();
   });
  }
  async function reset(key, label) {
   if (!active() || busy || hasChanges() || confirming) return;
   confirming = true;refresh();
   const approved = await btsDialogActions.confirm({owner: form, returnFocus: doc.activeElement, warning: true,
    title: 'Exportstatus zurücksetzen?', message: (key ? 'Die Exportmarkierung für „' + label + '“ wird entfernt.' : 'Die Exportmarkierungen aller Disziplinen werden entfernt.') + '\n\nDie Disziplinen gelten danach wieder als noch nicht exportiert. Bereits heruntergeladene Dateien und Spielergebnisse bleiben erhalten.',
    confirmLabel: 'Exportstatus zurücksetzen', cancelLabel: 'Abbrechen'});
   confirming = false;if (!active()) return;if (!approved) { refresh();return; }
   busy = 'reset';notice = '';refresh();
   send({type: 'certificate_export_reset', tournament_key: tournamentKey, ...(key ? {event_name: key} : {all: true})}, (err, response) => {
    busy = null;
    if (err) notice = 'Der Exportstatus konnte nicht zurückgesetzt werden. Bitte erneut versuchen.';
    else { config.onMarkers(response?.certificate_exports || {});notice = 'Exportstatus wurde zurückgesetzt.'; }
    refresh();
   });
  }
  const lifetime = new AbortController(), {signal} = lifetime;
  const observer = new MutationObserver(() => { if (!active()) dispose(); });
  selectionTab.addEventListener('click', () => setTab('selection'), {signal});designTab.addEventListener('click', () => setTab('design'), {signal});
  tabs.addEventListener('keydown', event => {if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {event.preventDefault();setTab(event.key === 'Home' ? 'selection' : event.key === 'End' ? 'design' : activeTab === 'selection' ? 'design' : 'selection', true);}}, {signal});
  pdf.addEventListener('click', () => runDocument('pdf'), {signal});print.addEventListener('click', () => runDocument('print'), {signal});probe.addEventListener('click', () => runDocument('probe'), {signal});markPrint.addEventListener('click', markPrinted, {signal});
  retry.addEventListener('click', flush, {signal});
  csv.addEventListener('click', () => runExport('csv'), {signal});xlsx.addEventListener('click', () => runExport('xlsx'), {signal});
  form.addEventListener('submit', event => event.preventDefault(), {signal});
  form.addEventListener('input', () => {notice = '';refresh();}, {signal});form.addEventListener('change', refresh, {signal});
  // Only intercept ordinary navigation. Ctrl/Cmd-click still opens a new tab.
  doc.addEventListener('click', event => {
   const link = event.target.closest?.('a[href]');
   if (!active() || !link || !link.closest('.toprow') || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank') return;
   const url = new URL(link.href, doc.location.href);
   if (url.origin !== doc.location.origin || url.pathname === doc.location.pathname) return;
   event.preventDefault();event.stopImmediatePropagation();
   navigate(() => {
    if (url.pathname.startsWith('/admin/t/' + encodeURIComponent(tournamentKey) + '/') && !url.pathname.endsWith('/speech-planning/')) crouting.navigate_to(url.pathname.slice('/admin/'.length));
    else doc.location.href = url.href;
   }, link);
  }, {capture: true, signal});

  return {page, tournamentKey, content, refresh, saveSettings, reset, navigate, dispose,
   refreshPreview() {if (activeTab === 'design') designer.refresh();},
   open(options) { config = {...config, ...options};setTab('selection');observer.observe(doc.body, {childList: true, subtree: true});title?.focus({preventScroll: true}); },
  };
 }
 return {create};
})();
