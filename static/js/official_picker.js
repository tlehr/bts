'use strict';
/* global btsTimerUpdates */

// The native select remains the form value and keeps the existing role swaps.
// eslint-disable-next-line no-unused-vars -- Shared by the classic browser scripts.
var btsOfficialPicker = (() => {
 const instances = new Set();
 let sequence = 0;
 const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
 const setAttribute = (node, name, value) => { if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value)); };
 function effectiveNow(tournament, wall = Date.now()) {
  const clock = tournament?.test_clock;
  if (clock?.mode === 'fixed' && Number.isFinite(Number(clock.fixed_ts))) return Number(clock.fixed_ts);
  return wall + (clock?.mode === 'offset' && Number.isFinite(Number(clock.offset_ms)) ? Number(clock.offset_ms) : 0);
 }
 function statuses(tournament) {
  const result = new Map(), byId = new Map(), courts = new Map((tournament.courts || []).map(court => [String(court._id), court]));
  const locations = new Map((tournament.locations || []).map(location => [String(location._id), location]));
  const courtId = values => values.find(value => value != null && value !== false && value !== '');
  for (const official of tournament.umpires || []) {
   const pauseUntil = Math.max(0, ...[official.umpire_pause, official.service_judge_pause].map(Number).filter(Number.isFinite));
   const status = { courtId: courtId([official.umpire_on_court, official.service_judge_on_court]), pauseUntil };
   result.set(official.name, status);if (official._id) byId.set(official._id, status);
  }
  for (const match of tournament.matches || []) {
   const setup = match.setup || {};
   if (!setup.now_on_court || !setup.court_id || setup.state === 'finished' || match.end_ts || setup.end_ts || typeof match.team1_won === 'boolean' || match.btp_winner || /^(walkover|retired|disqualified|no_match)/.test(match.score_status || match.btp_score_status || '')) continue;
   for (const official of [setup.umpire, setup.service_judge].filter(Boolean)) {
    const status = byId.get(official._id) || result.get(official.name) || { pauseUntil: 0 };
    status.courtId ||= setup.court_id;if (official.name) result.set(official.name, status);
   }
  }
  for (const status of result.values()) {
   const court = courts.get(String(status.courtId));
   status.courtNumber = status.courtId == null ? null : String(court?.num ?? String(status.courtId).split('_').at(-1));
   status.location = locations.get(String(court?.location_id))?.name || '';
  }
  return result;
 }
 function create(select, { icon, role, beforeOpen, emptyText, toggleLabel, searchPlaceholder, getTournament, courtTitle, pauseTitle }) {
  const controller = new AbortController(), signal = controller.signal, id = 'official-picker-' + (++sequence);
  const rows = new Map(), headers = new Map(), label = select.closest('label'), oldFor = label?.htmlFor || '';
  const wrapper = document.createElement('span');wrapper.className = 'ls-official-picker';
  select.before(wrapper);wrapper.append(select);select.hidden = true;
  const selectedIcon = document.createElement('span');selectedIcon.className = 'ls-official-icon';selectedIcon.innerHTML = icon(role);wrapper.append(selectedIcon);
  const input = document.createElement('input');input.id = id;input.type = 'text';input.autocomplete = 'off';input.className = 'ls-official-input';
  input.setAttribute('role', 'combobox');input.setAttribute('aria-autocomplete', 'list');input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-expanded', 'false');input.setAttribute('aria-controls', id + '-list');input.setAttribute('aria-owns', id + '-list');
  if (label) label.htmlFor = id;
  const caption = label?.querySelector('.match_edit_field_label');
  if (caption) input.setAttribute('aria-label', caption.textContent);
  wrapper.append(input);
  const toggle = document.createElement('button');toggle.type = 'button';toggle.className = 'ls-official-toggle';toggle.innerHTML = icon('down');
  toggle.setAttribute('aria-label', toggleLabel);toggle.setAttribute('aria-controls', id + '-list');toggle.setAttribute('aria-expanded', 'false');wrapper.append(toggle);
  const popup = document.createElement('div');popup.id = id + '-list';popup.className = 'ls-official-options';popup.hidden = true;
  popup.setAttribute('role', 'listbox');popup.setAttribute('aria-label', caption?.textContent || toggleLabel);document.body.append(popup);
  const empty = document.createElement('div');empty.className = 'ls-official-empty';empty.textContent = emptyText;empty.setAttribute('role', 'status');
  let items = [], visible = [], query = '', active = null, blurTimer, disposed = false, restoringFocus = false, rowSequence = 0, cancelTick;
  const stopTick = () => {cancelTick?.();cancelTick = null;};
  function tick() {
   stopTick();if (popup.hidden || disposed) return;
   const now = effectiveNow(getTournament());let next = Infinity;
   for (const row of visible) {
    const remaining = row.pauseUntil - now, seconds = Math.max(0, Math.ceil(remaining / 1000));
    const show = row.courtNumber == null && seconds > 0;
    if (row.pause.hidden === show) row.pause.hidden = !show;
    if (!show) continue;
    const text = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    if (row.pauseText.nodeValue !== text) row.pauseText.nodeValue = text;
    const title = pauseTitle(text);setAttribute(row.pause, 'aria-label', title);setAttribute(row.pause, 'title', title);
    next = Math.min(next, remaining % 1000 || 1000);
   }
   if (next !== Infinity) cancelTick = typeof btsTimerUpdates !== 'undefined' ? btsTimerUpdates.schedule(tick, next) : (() => {const timer = setTimeout(tick, next);return () => clearTimeout(timer);})();
  }
  function refreshDetails() {
   if (disposed) return;
   const tournament = getTournament(), details = statuses(tournament), now = effectiveNow(tournament);
   for (const row of items) {
    const status = row.value ? details.get(row.value) : null;
    row.courtNumber = status?.courtNumber;row.pauseUntil = status?.pauseUntil || 0;
    const hidden = row.courtNumber == null;if (row.court.hidden !== hidden) row.court.hidden = hidden;
    if (row.courtNumber != null) {
     if (row.court.textContent !== row.courtNumber) row.court.textContent = row.courtNumber;
     const title = courtTitle(row.courtNumber) + (status.location ? ' · ' + status.location : '');
     setAttribute(row.court, 'title', title);setAttribute(row.court, 'aria-label', title);
    }
    if ((row.courtNumber != null || row.pauseUntil <= now) && !row.pause.hidden) row.pause.hidden = true;
   }
   tick();
  }
  function activate(row, scroll = false) {
   if (active !== row) {
    active?.node.classList.remove('is-active');active = row;
    active?.node.classList.add('is-active');
   }
   if (active) {setAttribute(input, 'aria-activedescendant', active.node.id);if (scroll) active.node.scrollIntoView({ block: 'nearest' });}
   else input.removeAttribute('aria-activedescendant');
  }
  function close() {
   stopTick();
   popup.hidden = true;input.value = select.value;
   input.placeholder = items.find(row => !row.value)?.text || '';
   setAttribute(input, 'aria-expanded', false);setAttribute(toggle, 'aria-expanded', false);activate(null);
  }
  function position() {
   if (popup.hidden) return;
   const box = wrapper.getBoundingClientRect(), panel = select.closest('.edit_match_container')?.getBoundingClientRect();
   if (!input.getClientRects().length || box.bottom < Math.max(0, panel?.top || 0) || box.top > Math.min(innerHeight, panel?.bottom ?? innerHeight)) {close();return;}
   const above = box.top - 8, below = innerHeight - box.bottom - 8, upwards = below < 160 && above > below;
   popup.style.width = Math.min(box.width, innerWidth - 16) + 'px';
   popup.style.left = Math.max(8, Math.min(box.left, innerWidth - Math.min(box.width, innerWidth - 16) - 8)) + 'px';
   popup.style.maxHeight = Math.min(300, Math.max(0, upwards ? above : below)) + 'px';
   popup.style.top = upwards ? 'auto' : box.bottom + 4 + 'px';
   popup.style.bottom = upwards ? innerHeight - box.top + 4 + 'px' : 'auto';
  }
  function render() {
   const needle = normalize(query), groups = new Set();
   visible = [];
   for (const row of items) {
    const matches = !row.value || !needle || normalize(row.text).includes(needle);
    if (row.node.hidden === matches) row.node.hidden = !matches;
    setAttribute(row.node, 'aria-selected', row.value === select.value);
    if (matches && row.value) groups.add(row.group);
    if (matches && !row.disabled) visible.push(row);
   }
   for (const [group, node] of headers) node.hidden = !groups.has(group);
   empty.hidden = visible.some(row => row.value);
   const previous = active && visible.includes(active) ? active : null;
   activate(previous || visible.find(row => row.value && row.value === select.value) || visible.find(row => row.value) || null);
   tick();
  }
  function refresh() {
   if (disposed) return;
   let group = '';
   const next = [], seen = new Set();
   for (const option of select.options) {
    if (option.disabled && !option.value) {group = option.textContent.replace(/^-+\s*|\s*-+$/g, '');continue;}
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    let row = rows.get(option.value);
    if (!row) {
     const node = document.createElement('div');node.className = 'ls-official-option';node.id = id + '-option-' + (++rowSequence);node.setAttribute('role', 'option');
     const symbol = document.createElement('span');symbol.className = 'ls-official-icon';symbol.innerHTML = icon(option.value ? role : 'close');node.append(symbol);
     const text = document.createElement('span');text.className = 'ls-official-option-label';node.append(text);
     const court = document.createElement('span');court.className = 'ls-resource-court';court.hidden = true;court.setAttribute('role', 'img');node.append(court);
     const pause = document.createElement('span');pause.className = 'ls-official-pause';pause.hidden = true;pause.setAttribute('role', 'img');pause.innerHTML = icon('clock');node.append(pause);
     const pauseValue = document.createElement('span'), pauseText = document.createTextNode('');pauseValue.append(pauseText);pause.append(pauseValue);
     row = { node, symbol, court, pause, pauseText, label: text, value: option.value };rows.set(row.value, row);
     node.addEventListener('mousedown', event => event.preventDefault(), { signal });
     node.addEventListener('click', () => choose(row), { signal });
     node.addEventListener('mousemove', () => {if (!row.disabled) activate(row);}, { signal });
    }
    row.text = option.textContent;row.group = option.value ? group : '';row.disabled = option.disabled;
    const symbol = !row.value ? 'close' : option.dataset.officialRole === 'service_judge' ? 'serviceJudge' : option.dataset.officialRole === 'umpire' ? 'umpire' : role;
    if (row.symbolName !== symbol) {row.symbol.innerHTML = icon(symbol);row.symbolName = symbol;}
    if (row.label.textContent !== row.text) row.label.textContent = row.text;
    setAttribute(row.node, 'aria-disabled', row.disabled);next.push(row);
   }
   items = [...next.filter(row => row.value), ...next.filter(row => !row.value)];
   const wanted = new Set(), nodes = [];
   for (const row of items) {
    if (row.group && !wanted.has(row.group)) {
     wanted.add(row.group);
     let header = headers.get(row.group);
     if (!header) {header = document.createElement('div');header.className = 'ls-official-group';header.textContent = row.group;header.setAttribute('role', 'presentation');headers.set(row.group, header);}
     nodes.push(header);
    }
    if (!row.value) nodes.push(empty);
    nodes.push(row.node);
   }
   for (const [value, row] of rows) if (!seen.has(value)) {row.node.remove();rows.delete(value);}
   for (const [name, node] of headers) if (!wanted.has(name)) {node.remove();headers.delete(name);}
   nodes.forEach((node, index) => {if (popup.children[index] !== node) popup.insertBefore(node, popup.children[index] || null);});
   input.placeholder = popup.hidden ? next.find(row => !row.value)?.text || '' : searchPlaceholder;
   input.disabled = select.disabled;toggle.disabled = select.disabled;
   if (popup.hidden) input.value = select.value;
   refreshDetails();
   if (select.disabled) close();else {render();if (popup.hidden) activate(null);else position();}
  }
  function open(text = '') {
   if (select.disabled || disposed) return;
   const draft = input.value;
   clearTimeout(blurTimer);
   if (popup.hidden) {closeAll();beforeOpen?.();}
   query = text;refresh();input.value = draft;input.placeholder = searchPlaceholder;popup.hidden = false;render();position();
   if (!popup.hidden) {setAttribute(input, 'aria-expanded', true);setAttribute(toggle, 'aria-expanded', true);}
  }
  function choose(row) {
   if (!row || row.disabled || select.disabled) return;
   select.value = row.value;close();select.dispatchEvent(new Event('change', { bubbles: true }));
   restoringFocus = true;input.focus({ preventScroll: true });restoringFocus = false;
  }
  input.addEventListener('focus', () => {if (!restoringFocus) open();input.select();}, { signal });
  input.addEventListener('click', () => {if (popup.hidden) open();}, { signal });
  input.addEventListener('input', () => {query = input.value;open(query);}, { signal });
  input.addEventListener('blur', () => {blurTimer = setTimeout(close, 150);}, { signal });
  input.addEventListener('keydown', event => {
   if (event.key === 'Escape' && !popup.hidden) {event.preventDefault();event.stopPropagation();close();return;}
   if (event.key === 'Enter') {event.preventDefault();event.stopPropagation();if (popup.hidden) open(input.value);else choose(active);return;}
   if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || popup.hidden && !event.key.startsWith('Arrow')) return;
   event.preventDefault();event.stopPropagation();
   const wasClosed = popup.hidden;if (wasClosed) open();
   const index = visible.indexOf(active), last = visible.length - 1;
   const target = event.key === 'Home' ? 0 : event.key === 'End' ? last : wasClosed ? (event.key === 'ArrowUp' ? last : 0) : (index + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length;
   activate(visible[target] || null, true);
  }, { signal });
  toggle.addEventListener('mousedown', event => event.preventDefault(), { signal });
  toggle.addEventListener('click', () => {if (popup.hidden) {input.focus();open();} else close();}, { signal });
  select.addEventListener('change', refresh, { signal });
  document.addEventListener('pointerdown', event => {if (!wrapper.contains(event.target) && !popup.contains(event.target)) close();}, { signal });
  document.addEventListener('scroll', event => {if (!popup.contains(event.target)) position();}, { capture: true, signal });
  window.addEventListener('resize', position, { signal });
  const api = { refresh, close, refreshDetails: () => {if (!popup.hidden) refreshDetails();}, refreshSource: () => {if (!popup.hidden) {beforeOpen?.();refresh();}}, destroy() {
   disposed = true;stopTick();clearTimeout(blurTimer);controller.abort();popup.remove();instances.delete(api);
   select.hidden = false;wrapper.replaceWith(select);if (label) label.htmlFor = oldFor;
  } };
  instances.add(api);refresh();return api;
 }
 function closeAll() {for (const picker of instances) picker.close();}
 function destroyAll() {for (const picker of instances) picker.destroy();}
 function refreshDetails() {for (const picker of instances) picker.refreshDetails();}
 function refreshOpen() {for (const picker of instances) picker.refreshSource();}
 return { create, closeAll, destroyAll, refreshDetails, refreshOpen, statuses, effectiveNow };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = btsOfficialPicker;
