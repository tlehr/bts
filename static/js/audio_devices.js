/* global btsSettingsWorkspace, ci18n */
'use strict';

(function(root) {
 function create(env) {
  const listeners = new Set();let storage;
  try {storage = env.localStorage;} catch (_) { /* Private browser policies may block storage. */ }
  const local = key => {try {return storage?.getItem(key);} catch (_) {return null;}};
  const put = (key, value) => {try {storage?.setItem(key, value);} catch (_) { /* The live server configuration remains usable. */ }};
  const id = local('bts-audio-device-id-v1') || env.crypto?.randomUUID?.() || 'audio_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  put('bts-audio-device-id-v1', id);
  let tournament = null, devices = [], revision = -1, registered = false, registration = null, epoch = 0;
  const request = message => new Promise((resolve, reject) => {
   try {env.send(message, (error, value) => error ? reject(error) : resolve(value));} catch (error) {reject(error);}
  });
  const own = () => devices.find(device => device.id === id);
  function preference(device, name) {
   if (name === 'enable_free_announcements') return device.settings.free;
   const match = /^enable_announcement_(calls|preparations)_(.+)$/.exec(name);
   return match ? device.settings.locations.find(location => location.id === match[2])?.[match[1]] === true : null;
  }
  function read(name) {
   const device = own(), value = device && preference(device, name);
   return value == null ? local(name) : String(value);
  }
  function publish() {
   const device = own();
   if (device) {
    const names = ['enable_free_announcements', ...(tournament.locations || []).flatMap(location =>
     ['calls', 'preparations'].map(kind => 'enable_announcement_' + kind + '_' + location._id))];
    const values = new Map();let changed = false;
    for (const name of names) {
     const value = read(name);values.set(name, value === 'true');
     if (local(name) !== value) {put(name, value);changed = true;}
    }
    for (const node of env.document?.querySelectorAll('input[name]') || []) if (values.has(node.name) && node.checked !== values.get(node.name)) node.checked = values.get(node.name);
    if (changed) env.btsSpeechReadiness?.changed?.();
   }
   for (const listener of listeners) listener();
  }
  function receive(message) {
   if (message.tournament_key !== tournament?.key || !Array.isArray(message.devices) || !Number.isSafeInteger(message.revision) || message.revision <= revision) return;
   revision = message.revision;devices = message.devices;registered = true;publish();
  }
  function connect(value) {
   if (tournament?.key === value.key && registered) {tournament = value;return Promise.resolve();}
   if (tournament?.key === value.key && registration) return registration;
   if (tournament?.key !== value.key) {devices = [];revision = -1;}
   tournament = value;registered = false;const current = ++epoch;
   const agent = env.navigator?.userAgent || '';
   const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'BTS-Browser';
   const platform = /Android/.test(agent) ? 'Android' : /Windows/.test(agent) ? 'Windows' : /iPhone|iPad/.test(agent) ? 'iOS' : /Macintosh/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : '';
   const settings = {free: local('enable_free_announcements') === 'true', locations: (value.locations || []).map(location => ({id: location._id,
    calls: local('enable_announcement_calls_' + location._id) === 'true', preparations: local('enable_announcement_preparations_' + location._id) === 'true'}))};
   registration = request({type: 'audio_device_register', tournament_key: value.key, device_id: id, label: [browser, platform].filter(Boolean).join(' · '), settings})
    .then(response => {if (current === epoch) {registered = true;receive(response);}})
    .finally(() => {if (current === epoch) registration = null;});
   return registration;
  }
  function disconnected() {epoch++;registered = false;registration = null;revision = -1;publish();}
  function reconnect() {if (tournament) void connect(tournament).catch(() => {});}
  function set(deviceId, change, callback) {
   const key = tournament?.key;
   request({type: 'audio_device_edit', tournament_key: key, device_id: deviceId, change}).then(value => {receive(value);callback?.(null);}, error => callback?.(error));
  }
  function setOwn(name, value, callback) {
   const match = /^enable_announcement_(calls|preparations)_(.+)$/.exec(name);
   const change = name === 'enable_free_announcements' ? {kind: 'free', value} : match && {kind: match[1], location_id: match[2], value};
   if (!change || !tournament) return callback?.({message: 'Audio device not registered'});
   connect(tournament).then(() => set(id, change, callback), error => callback?.(error));
  }
  function bind(control, onError) {
   control.checked = read(control.name) === 'true';
   control.addEventListener('change', () => setOwn(control.name, control.checked, error => {
    if (error) {control.checked = read(control.name) === 'true';onError?.(error);}
   }));
  }
  function mount(parent, {tournament: model, onPending, onResult}) {
   const doc = parent.ownerDocument, text = key => ci18n('settings:audio:' + key), controls = [];
   let disposed = false, selected = id;
   const selector = btsSettingsWorkspace.field(parent, {label: text('device'), tag: 'select', attributes: {name: 'audio_output_device'}});
   const status = doc.createElement('p');status.className = 'settings-audio-device-status';status.setAttribute('role', 'status');parent.append(status);
   function checkbox(kind, location) {
    const control = btsSettingsWorkspace.field(parent, {label: location ? location.name || location._id : text('free'),
     attributes: {type: 'checkbox', role: 'switch', name: 'audio_output_' + kind + (location ? '_' + location._id : '')}});
    controls.push({control, kind, location});
    control.addEventListener('change', () => {
     if (control.disabled) return;
     const target = selected, change = {kind, value: control.checked, ...(location ? {location_id: location._id} : {})};
     control.dataset.pending = 'true';control.disabled = true;onPending?.();
     set(target, change, error => {delete control.dataset.pending;onResult?.(error);if (!disposed) refresh();});
    });
   }
   checkbox('free');
   for (const kind of ['preparations', 'calls']) {
    const heading = doc.createElement('h3');heading.className = 'settings-flow-subheading';heading.textContent = ci18n('settings:flow:' + (kind === 'calls' ? 'court_announcements' : 'preparation_announcements'));parent.append(heading);
    for (const location of model.locations || []) checkbox(kind, location);
   }
   function refresh() {
    if (disposed) return;
    if (!devices.some(device => device.id === selected)) selected = devices.some(device => device.id === id) ? id : devices[0]?.id || '';
    const existing = new Map([...selector.options].map(option => [option.value, option]));
    for (const device of devices) {
     const option = existing.get(device.id) || doc.createElement('option');option.value = device.id;
     const label = [device.label, device.address, device.id === id ? text('this_device') : '', device.online ? '' : text('offline')].filter(Boolean).join(' · ');
     if (option.textContent !== label) option.textContent = label;
     if (!option.isConnected) selector.append(option);existing.delete(device.id);
    }
    for (const option of existing.values()) option.remove();
    selector.value = selected;selector.disabled = devices.length === 0;
    const device = devices.find(value => value.id === selected);
    const message = !registered ? text('connecting') : !device ? text('empty') : device.online ? text('online') + ' · ' + ci18n('settings:audio:pages', {count: device.pages}) : text('offline');
    if (status.textContent !== message) status.textContent = message;
    for (const {control, kind, location} of controls) {
     const pending = control.dataset.pending === 'true';control.disabled = pending || !device;
     if (!pending) control.checked = !!device && (kind === 'free' ? device.settings.free : device.settings.locations.find(value => value.id === location._id)?.[kind] === true);
    }
   }
   selector.addEventListener('change', () => {selected = selector.value;refresh();});
   listeners.add(refresh);refresh();
   return () => {disposed = true;listeners.delete(refresh);};
  }
  return {id, connect, receive, disconnected, reconnect, read, set, setOwn, bind, mount};
 }
 if (typeof module !== 'undefined' && module.exports) module.exports = {create};else root.btsAudioDevices = create(root);
})(typeof window === 'undefined' ? globalThis : window);
