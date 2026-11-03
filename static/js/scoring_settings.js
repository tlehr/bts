/* global btsSettingsWorkspace, ci18n, cleitstand */
'use strict';

// The settings page keeps these nodes mounted during navigation and live updates.
// eslint-disable-next-line no-unused-vars -- Used by the classic tournament script.
var btsScoringSettings = (() => {
 function mount(parent, {onEdit, formatDuration, formatRules, intervalEnabled}) {
  const doc = parent.ownerDocument, formats = new Map(), assignments = new Map();
  const text = (key, data) => ci18n('settings:scoring:' + key, data);
  const ruleText = key => ci18n('tournament:edit:scoring_formats:' + key);
  function el(owner, tag, className, value) {
   const node = doc.createElement(tag);node.className = className || '';
   if (value != null) node.textContent = value;owner.append(node);return node;
  }
  const setText = (node, value) => {const next = String(value ?? '—');if (node.textContent !== next) node.textContent = next;};
  const show = (node, visible) => {if (node.hidden === visible) node.hidden = !visible;};
  function order(owner, nodes) {
   nodes.forEach((node, index) => {if (owner.children[index] !== node) owner.insertBefore(node, owner.children[index] || null);});
  }
  const formatName = format => format?.name || text('unnamed');
  const duration = value => value == null ? '—' : formatDuration(value);

  const available = btsSettingsWorkspace.card(parent, {title:text('available'), description:text('available:hint'), badge:'0'});
  available.parentElement.classList.add('settings-scoring-formats');
  const availableCount = available.parentElement.querySelector('.settings-card-badge');
  const noFormats = el(available, 'p', 'settings-scoring-empty', text('empty'));
  const list = el(available, 'div', 'settings-scoring-format-list');
  const usage = btsSettingsWorkspace.card(parent, {title:text('assignments'), description:text('assignments:hint'), badge:'0'});
  usage.parentElement.classList.add('settings-scoring-assignments');
  const exceptionCount = usage.parentElement.querySelector('.settings-card-badge');
  const standard = el(usage, 'div', 'settings-scoring-standard');
  el(standard, 'span', '', text('default'));const standardName = el(standard, 'strong');
  const noAssignments = el(usage, 'p', 'settings-scoring-empty');
  const table = el(usage, 'table', 'settings-scoring-assignments-table');
  const heading = el(el(table, 'thead'), 'tr');
  const labels = [text('event'), text('stage'), text('format')];
  for (const label of labels) {const cell = el(heading, 'th', '', label);cell.scope = 'col';}
  const body = el(table, 'tbody');

  function ruleSection(owner, title) {
   const section = el(owner, 'section', 'settings-scoring-rules');el(section, 'h4', '', title);
   const values = el(section, 'dl');
   return [text('points'), ruleText('interval_duration'), ruleText('break_before_set')].map(label => {
    const row = el(values, 'div');el(row, 'dt', '', label);return el(row, 'dd');
   });
  }
  function setRules(nodes, rules) {
   setText(nodes[0], formatRules(rules));
   setText(nodes[1], !rules ? '—' : intervalEnabled(rules) ?
    text('interval', {points:rules.interval_at ?? '—', duration:duration(rules.interval_duration_ms)}) : text('no_interval'));
   setText(nodes[2], duration(rules?.break_before_set_duration_ms));
  }
  function createFormat(id) {
   const root = el(list, 'section', 'settings-scoring-format');root.dataset.scoringFormat = id;
   const header = el(root, 'header', 'settings-scoring-format-heading');
   const info = el(header, 'div', 'settings-scoring-format-info');
   const name = el(info, 'h3');name.id = 'settings-scoring-name-' + id;root.setAttribute('aria-labelledby', name.id);
   const meta = el(info, 'div', 'settings-scoring-meta'), sets = el(meta, 'span');
   const badge = el(meta, 'span', 'settings-scoring-default', text('default'));
   const edit = el(header, 'button', 'btn settings-scoring-edit');edit.type = 'button';edit.dataset.scoringFormatId = id;
   edit.innerHTML = cleitstand.icon('edit');el(edit, 'span', '', ruleText('edit'));
   edit.addEventListener('click', () => onEdit(id));
   const rules = el(root, 'div', 'settings-scoring-rule-columns');
   return {root, name, sets, badge, edit, regular:ruleSection(rules, ruleText('regular_sets')), last:ruleSection(rules, ruleText('last_set'))};
  }
  function updateFormats(tournament) {
   const data = tournament.scoring_formats || {}, source = Array.isArray(data.formats) ? data.formats : [];
   const defaultId = data.default_id == null ? null : String(data.default_id), keys = new Set(), nodes = [];
   setText(availableCount, text('count', {count:source.length}));show(noFormats, !source.length);show(list, !!source.length);
   for (const format of source) {
    const id = String(format.id);keys.add(id);
    let entry = formats.get(id);if (!entry) {entry = createFormat(id);formats.set(id, entry);}
    setText(entry.name, formatName(format));
    setText(entry.sets, Number(format.numSets) === 1 ? text('one_set') : text('sets', {count:format.numSets ?? '—'}));
    show(entry.badge, id === defaultId);
    const label = text('edit', {name:formatName(format)});
    if (entry.edit.getAttribute('aria-label') !== label) entry.edit.setAttribute('aria-label', label);
    setRules(entry.regular, format.set_points);setRules(entry.last, format.last_set_points);nodes.push(entry.root);
   }
   for (const [id, entry] of formats) if (!keys.has(id)) {entry.root.remove();formats.delete(id);}
   order(list, nodes);
  }
  function createAssignment(key) {
   const row = el(body, 'tr');row.dataset.scoringAssignment = key;
   const cells = labels.map(label => {
    const cell = el(row, 'td');el(cell, 'span', 'settings-scoring-mobile-label', label).setAttribute('aria-hidden', 'true');
    return el(cell, 'span', 'settings-scoring-assignment-value');
   });
   return {row, cells};
  }
  function updateAssignments(tournament) {
   const data = tournament.scoring_formats || {}, source = Array.isArray(data.formats) ? data.formats : [];
   const byId = new Map(source.map(format => [String(format.id), format]));
   const defaultId = data.default_id == null ? null : String(data.default_id), defaultFormat = byId.get(defaultId);
   setText(standardName, defaultFormat ? formatName(defaultFormat) : text(defaultId == null ? 'no_default' : 'unavailable'));
   const deviations = [];
   const events = Array.isArray(tournament.events?.events) ? tournament.events.events : [];
   events.forEach((event, eventIndex) => {
    const stages = Array.isArray(event.stages) ? event.stages : [];
    stages.forEach((stage, stageIndex) => {
     if (stage.scoring_format == null || String(stage.scoring_format) === defaultId) return;
     const key = JSON.stringify([event.id ?? event._id ?? eventIndex, stage.id ?? stage._id ?? stageIndex]);
     deviations.push({key, event:event.name || '—', stage:stage.name || '—', format:byId.get(String(stage.scoring_format))});
    });
   });
   deviations.sort((a, b) => a.event.localeCompare(b.event) || a.stage.localeCompare(b.stage));
   setText(exceptionCount, text('exceptions', {count:deviations.length}));
   setText(noAssignments, text(defaultId == null ? 'no_default:hint' : 'no_exceptions'));
   show(noAssignments, !deviations.length);show(table, !!deviations.length);
   const keys = new Set(), nodes = [];
   for (const item of deviations) {
    keys.add(item.key);let entry = assignments.get(item.key);
    if (!entry) {entry = createAssignment(item.key);assignments.set(item.key, entry);}
    [item.event, item.stage, item.format ? formatName(item.format) : text('unavailable')].forEach((value, index) => setText(entry.cells[index], value));
    nodes.push(entry.row);
   }
   for (const [key, entry] of assignments) if (!keys.has(key)) {entry.row.remove();assignments.delete(key);}
   order(body, nodes);
  }
  return {updateFormats, updateAssignments};
 }
 return {mount};
})();
