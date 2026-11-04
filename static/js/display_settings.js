/* global btsSettingsWorkspace, btsDialogActions, btsProfilePreview, cleitstand */
'use strict';

// Profiles are shared configuration. Device assignments live in the device workspace.
// eslint-disable-next-line no-unused-vars -- Used by the classic tournament script.
var btsDisplaySettings = (() => {
 function mount(parent, {tournament, bindDefault, onCreate, onEdit, onCopy, onDelete, formatMode, navigate, renderPreview, renderLogo}) {
  const doc = parent.ownerDocument, groups = new Map(), entries = new Map(), deleting = new Set();
  const previews = btsProfilePreview.mount(parent, renderPreview);
  function el(owner, tag, className, value) {
   const node = doc.createElement(tag);node.className = className || '';
   if (value != null) node.textContent = value;owner.append(node);return node;
  }
  const text = (node, value) => {if (node.textContent !== value) node.textContent = value;};
  const show = (node, visible) => {if (node.hidden === visible) node.hidden = !visible;};
  const disabled = (node, value) => {if (node.disabled !== value) node.disabled = value;};
  function button(owner, label, symbol, action) {
   const node = el(owner, 'button', 'btn');node.type = 'button';
   node.innerHTML = cleitstand.icon(symbol);el(node, 'span', '', label);node.addEventListener('click', action);return node;
  }
  function link(owner, path, label) {
   const node = el(owner, 'a', '', label);node.href = path;
   node.addEventListener('click', event => {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();navigate(path);
   });return node;
  }
  const tabs = el(parent, 'div', 'settings-display-tabs');tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', 'Anzeigen und Bedienoberflächen');
  let selected = 'display';
  for (const [mode, label, field] of [['display', 'Anzeigen', 'displaysettings_general'], ['umpire', 'Bedienoberflächen', 'displaysettings_general_tablet']]) {
   const tab = button(tabs, label, mode === 'display' ? 'monitor' : 'edit', () => select(mode));
   tab.id = 'settings-display-tab-' + mode;tab.setAttribute('role', 'tab');tab.setAttribute('aria-controls', 'settings-display-panel-' + mode);
   const panel = el(parent, 'div', 'settings-display-panel');panel.id = 'settings-display-panel-' + mode;
   panel.setAttribute('role', 'tabpanel');panel.setAttribute('aria-labelledby', tab.id);
   if (mode === 'display') renderLogo(btsSettingsWorkspace.card(panel, {title:'Turnierlogo', description:'Gemeinsames Logo für die Anzeigen.'}));
   const standard = btsSettingsWorkspace.card(panel, {
    title: mode === 'display' ? 'Standard-Anzeige' : 'Standard-Bedienoberfläche',
    description: 'Wird verwendet, wenn einem Gerät noch kein eigenes Profil zugewiesen wurde.',
   });
   const selectBox = btsSettingsWorkspace.field(standard, {label:'Standardprofil', tag:'select', attributes:{name:field}});
   bindDefault(selectBox, field);
   const available = btsSettingsWorkspace.card(panel, {
    title:mode === 'display' ? 'Anzeigeprofile' : 'Bedienprofile',
    description:mode === 'display' ? 'Aussehen und Inhalte der Hallenanzeigen. Ein Profil kann mehreren Geräten zugewiesen werden.' :
     'Spielzählung, Anmeldung und Selbst-Check-in – auf PCs, Tablets und anderen Eingabegeräten.', badge:'0 Profile',
   });
   const heading = available.parentElement.querySelector('.settings-card-heading');
   const actions = el(available, 'div', 'settings-display-toolbar');
   button(actions, 'Profil anlegen', 'plus', () => onCreate(mode));
   const empty = el(available, 'p', 'settings-display-empty', 'Noch keine Profile vorhanden.');
   const list = el(available, 'div', 'settings-display-list');
   const status = el(available, 'p', 'settings-display-error');status.setAttribute('role', 'status');status.hidden = true;
   groups.set(mode, {tab, panel, select:selectBox, options:new Map(), field, list, empty, count:heading.querySelector('.settings-card-badge'), status});
  }
  const help = el(parent, 'div', 'settings-display-help');
  el(help, 'span', '', 'Halle, Felder und Profil eines konkreten Geräts weist du unter „Geräte & Logs“ zu. ');
  link(help, '/admin/t/' + encodeURIComponent(tournament().key) + '/devices', 'Gerätezuordnung öffnen →');
  const legacy = el(groups.get('display').panel, 'p', 'settings-display-legacy');
  link(legacy, '/admin/t/' + encodeURIComponent(tournament().key) + '/edit/upcoming', 'Einstellungen der bisherigen Web-Spielübersichten →');
  function select(mode, focus = false) {
   selected = mode;
   for (const [key, group] of groups) {
    const active = key === mode;show(group.panel, active);
    if (group.tab.getAttribute('aria-selected') !== String(active)) group.tab.setAttribute('aria-selected', String(active));
    group.tab.tabIndex = active ? 0 : -1;
   }
   if (focus) groups.get(mode).tab.focus();
  }
  tabs.addEventListener('keydown', event => {
   if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
   event.preventDefault();select(event.key === 'Home' ? 'display' : event.key === 'End' ? 'umpire' : selected === 'display' ? 'umpire' : 'display', true);
  });
  function usage(id) {
   const data = tournament(), devices = new Set((data.displays || []).filter(device => device.displaysetting_id === id).map(device => device.client_id));
   return {count:devices.size, standard:id === data.displaysettings_general || id === data.displaysettings_general_tablet};
  }
  async function remove(id, opener) {
   if (deleting.has(id)) return;
   const profile = (tournament().displaysettings || []).find(item => item.id === id), used = usage(id);
   if (!profile || used.count || used.standard) return;
   const approved = await btsDialogActions.confirm({owner:parent, title:'Profil löschen',
    message:'Soll das Profil „' + (profile.description || id) + '“ gelöscht werden?', confirmLabel:'Profil löschen', cancelLabel:'Abbrechen', danger:true, returnFocus:opener});
   const current = usage(id);if (!approved || !parent.isConnected || current.count || current.standard || deleting.has(id)) return;
   deleting.add(id);update();
   onDelete(id, error => {
    deleting.delete(id);if (!parent.isConnected) return;
    const group = groups.get(profile.devicemode);
    text(group.status, error ? 'Das Profil konnte nicht gelöscht werden. Bitte erneut versuchen.' : '');show(group.status, !!error);update();
   });
  }
  function createEntry(id) {
   const root = doc.createElement('article');root.className = 'settings-display-profile';root.dataset.displaysettingId = id;
   const mark = el(root, 'div', 'settings-display-mark');mark.setAttribute('aria-hidden', 'true');mark.inert = true;mark.dataset.previewState = 'loading';
   const info = el(root, 'div', 'settings-display-profile-info'), name = el(info, 'h3'), mode = el(info, 'p');
   const meta = el(info, 'div', 'settings-display-meta'), standard = el(meta, 'span', 'settings-display-default', 'Standardprofil'), used = el(meta, 'span');
   const actions = el(root, 'div', 'settings-display-actions');
   const edit = button(actions, 'Bearbeiten', 'edit', () => onEdit(id));
   const copy = button(actions, 'Kopieren', 'copy', () => onCopy(id));
   const removeButton = button(actions, 'Löschen', 'trash', () => {void remove(id, removeButton);});
   return {root, mark, name, mode, standard, used, edit, copy, remove:removeButton};
  }
  function update() {
   const data = tournament(), source = data.displaysettings || [], alive = new Set();
   for (const [mode, group] of groups) {
    const profiles = source.filter(profile => profile.devicemode === mode);
    const ids = new Set(profiles.map(profile => profile.id));
    show(group.empty, !profiles.length);show(group.list, !!profiles.length);disabled(group.select, !profiles.length || group.select.dataset.pending === 'true');
    text(group.count, profiles.length + (profiles.length === 1 ? ' Profil' : ' Profile'));
    profiles.forEach((profile, index) => {
     const id = profile.id, name = profile.description || id;alive.add(id);
     let option = group.options.get(id);
     if (!option) {option = el(group.select, 'option');option.value = id;group.options.set(id, option);}
     text(option, name);if (group.select.children[index] !== option) group.select.insertBefore(option, group.select.children[index] || null);
     let entry = entries.get(id);if (!entry) {entry = createEntry(id);entries.set(id, entry);}
     const used = usage(id), symbol = mode === 'display' ? 'monitor' : ['registration_check', 'self_check_in'].includes(profile.tablet_mode) ? 'people' : profile.tablet_mode === 'scorecard' ? 'sheet' : 'umpire';
     if (entry.symbol !== symbol) {entry.symbol = symbol;entry.mark.innerHTML = cleitstand.icon(symbol);}
     previews.update(entry.mark, profile, {name:data.name || data.key});
     text(entry.name, name);text(entry.mode, formatMode(profile));show(entry.standard, used.standard);
     text(entry.used, used.count ? used.count + (used.count === 1 ? ' Gerät zugeordnet' : ' Geräte zugeordnet') : 'Keinem Gerät zugeordnet');
     disabled(entry.remove, !!used.count || used.standard || deleting.has(id));
     const reason = used.standard ? 'Das Standardprofil kann nicht gelöscht werden.' : used.count ? 'Das Profil ist noch Geräten zugewiesen.' : '';
     if (entry.remove.title !== reason) entry.remove.title = reason;
     for (const [button, action] of [[entry.edit, 'Profil bearbeiten: '], [entry.copy, 'Profil kopieren: '], [entry.remove, 'Profil löschen: ']]) {
      const label = action + name;if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
     }
     if (group.list.children[index] !== entry.root) group.list.insertBefore(entry.root, group.list.children[index] || null);
    });
    for (const [id, option] of group.options) if (!ids.has(id)) {option.remove();group.options.delete(id);}
    const value = ids.has(data[group.field]) ? data[group.field] : '';
    if (group.select.dataset.pending !== 'true' && group.select.value !== value) group.select.value = value;
   }
   for (const [id, entry] of entries) if (!alive.has(id)) {previews.remove(entry.mark);entry.root.remove();entries.delete(id);}
  }
  select(selected);update();return {update, select, selected:() => selected, destroy:previews.destroy};
 }
 return {mount};
})();
