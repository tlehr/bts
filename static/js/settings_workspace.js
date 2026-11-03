/* global cleitstand */
'use strict';

// Keep the existing settings controls mounted while switching their surrounding pages.
// eslint-disable-next-line no-unused-vars -- Used by the classic tournament script.
var btsSettingsWorkspace = (() => {
 let fieldSequence = 0;
 function element(parent, tag, className, text) {
  const node = parent.ownerDocument.createElement(tag);node.className = className || '';
  if (text != null) node.textContent = text;parent.append(node);return node;
 }
 function card(parent, {title, description, badge}) {
  const section = element(parent, 'section', 'settings-card');
  const header = element(section, 'header', 'settings-card-heading'), heading = element(header, 'div');
  element(heading, 'h2', '', title);
  if (description) element(heading, 'p', '', description);
  if (badge) element(header, 'span', 'settings-card-badge', badge);
  return element(section, 'div', 'settings-card-body');
 }
 function field(parent, {label, description, unit, tag = 'input', attributes = {}}) {
  const row = element(parent, 'div', 'settings-row'), info = element(row, 'div', 'settings-row-info');
  const title = element(info, tag === 'button' ? 'span' : 'label', 'settings-field-label', label), controls = element(row, 'div', 'settings-row-control');
  const control = element(controls, tag), id = 'settings-field-' + (++fieldSequence);
  for (const [name, value] of Object.entries(attributes)) control.setAttribute(name, value);
  control.id = id;if (tag !== 'button') title.htmlFor = id;
  const describedBy = [];
  if (description) {
   const hint = element(info, 'p', 'settings-field-description', description);hint.id = id + '-description';
   describedBy.push(hint.id);
  }
  if (unit) {
   controls.classList.add('has-unit');
   const suffix = element(controls, 'span', 'settings-field-unit', unit);suffix.id = id + '-unit';describedBy.push(suffix.id);
  }
  if (describedBy.length) control.setAttribute('aria-describedby', describedBy.join(' '));
  return control;
 }
 const sections = [
  ['general', 'Allgemein', 'settings'],
  ['btp', 'BTP-Verbindung', 'refresh'],
  ['flow', 'Ablauf', 'play'],
  ['calls', 'Aufrufe', 'speaker'],
  ['officials', 'Tabletbedienung & Offizielle', 'umpire'],
  ['scoring', 'Punktsysteme', 'sheet'],
  ['locations', 'Spielorte & Felder', 'court'],
  ['speech', 'Sprache & Durchsagen', 'mic'],
  ['upcoming', 'Spielübersichten', 'calendar'],
  ['devices', 'Geräte & Anzeigen', 'monitor'],
  ['advertisements', 'Werbung', 'flag'],
  ['ticker', 'Ticker', 'server'],
  ['maintenance', 'Wartung', 'folder'],
  ['debug', 'Debug-Einstellungen', 'code'],
 ];
 const resolve = id => id === 'tabletoperators' ? 'officials' : ['preparation', 'court-call'].includes(id) ? 'calls' : sections.some(section => section[0] === id) ? id : 'general';
 function create({owner, content, tournamentKey, section, status, back, onSelect, onDispose}) {
  const doc = owner.ownerDocument, lifetime = new AbortController(), {signal} = lifetime;
  function el(parent, tag, className, text) {
   const node = doc.createElement(tag);node.className = className || '';
   if (text != null) node.textContent = text;parent.append(node);return node;
  }
  const page = el(owner, 'section', 'leitstand page-settings');page.setAttribute('aria-labelledby', 'leitstand-page-title');
  const saveStatus = el(page, 'div', 'settings-save-status');
  status.setAttribute('role', 'status');status.setAttribute('aria-live', 'polite');saveStatus.append(status);
  const workspace = el(page, 'div', 'settings-workspace');
  const sidebar = el(workspace, 'nav', 'settings-navigation');sidebar.setAttribute('aria-label', 'Einstellungsbereiche');
  el(sidebar, 'div', 'settings-navigation-group', 'Turnier');
  const mobile = el(workspace, 'label', 'settings-mobile-navigation');el(mobile, 'span', '', 'Einstellungsbereich');
  const select = el(mobile, 'select');select.name = 'settings_section';
  content.classList.add('settings-content');workspace.append(content);
  const panels = new Map([...content.children].filter(node => node.dataset.settingsSection).map(node => [node.dataset.settingsSection, node]));
  const links = new Map();
  for (const [id, label, symbol] of sections) {
   const panel = panels.get(id);if (!panel) continue;
   if (id === 'debug') el(sidebar, 'div', 'settings-navigation-group', 'Weitere Werkzeuge');
   const link = el(sidebar, 'a', 'settings-area-link');link.href = '/admin/t/' + encodeURIComponent(tournamentKey) + '/edit' + (id === 'general' ? '' : '/' + id);
   link.innerHTML = cleitstand.icon(symbol);el(link, 'span', '', label);links.set(id, link);
   panel.classList.add('settings-panel');panel.id = 'settings-panel-' + id;panel.setAttribute('role', 'region');panel.setAttribute('aria-label', label);
   link.setAttribute('aria-controls', panel.id);
   const option = el(select, 'option', '', label);option.value = id;
   link.addEventListener('click', event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();onSelect(id);
   }, {signal});
  }
  content.addEventListener('click', event => {
   const link = event.target.closest('a[data-settings-target]');
   if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
   event.preventDefault();onSelect(link.dataset.settingsTarget);
  }, {signal});
  const footer = el(page, 'footer', 'settings-footer');
  back.classList.add('btn');back.type = 'button';back.textContent = 'Zur Turnierleitung';footer.append(back);
  let selected, disposed = false, frame = null;
  function show(id, focus = false) {
   if (disposed) return;const next = resolve(id), changed = selected !== next;
   const previous = panels.get(selected);
   if (previous?.contains(doc.activeElement)) doc.activeElement.blur();
   selected = next;select.value = next;
   for (const [key, panel] of panels) panel.hidden = key !== next;
   for (const [key, link] of links) {
    if (key === next) link.setAttribute('aria-current', 'page');else link.removeAttribute('aria-current');
   }
   page.dataset.settingsSection = next;
   if (changed) {
    window.scrollTo({top: 0, behavior: 'instant'});
    if (focus) {const heading = panels.get(next).querySelector('h2');if (heading) {heading.tabIndex = -1;heading.focus({preventScroll: true});}}
   }
  }
  select.addEventListener('change', () => onSelect(select.value), {signal});
  const top = doc.querySelector('.toprow');
  function sizeBars() {
   if (disposed) return;
   const sizes = [['--settings-header-height', top.offsetHeight + 'px'], ['--settings-footer-height', footer.offsetHeight + 'px'], ['--settings-status-height', saveStatus.offsetHeight + 'px']];
   for (const [name, value] of sizes) if (page.style.getPropertyValue(name) !== value) page.style.setProperty(name, value);
  }
  const resize = new ResizeObserver(() => {
   if (!disposed && frame === null) frame = requestAnimationFrame(() => {frame = null;sizeBars();});
  });resize.observe(top);resize.observe(footer);resize.observe(saveStatus);
  function dispose() {
   if (disposed) return;disposed = true;lifetime.abort();resize.disconnect();observer.disconnect();
   if (frame !== null) cancelAnimationFrame(frame);page.remove();onDispose();
  }
  const observer = new MutationObserver(() => {if (!page.isConnected) dispose();});observer.observe(owner, {childList: true});
  if (owner.parentNode) observer.observe(owner.parentNode, {childList: true});
  show(section);sizeBars();doc.getElementById('leitstand-page-title')?.focus({preventScroll: true});
  return {page, tournamentKey, show, selected: () => selected, dispose};
 }
 return {create, resolve, card, field};
})();
