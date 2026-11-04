'use strict';

// Render visible profiles one at a time. Only the frozen, script-free document
// stays in the list; no live scoreboards or device connections run in thumbnails.
// eslint-disable-next-line no-unused-vars -- Used by the profile workspace.
var btsProfilePreview = (() => {
 const width = 960;
 function bootstrap() {
  function memoryStorage() {
   const values = new Map();
   return {getItem:key => values.get(String(key)) ?? null, setItem:(key, value) => values.set(String(key), String(value)),
    removeItem:key => values.delete(String(key)), clear:() => values.clear(), key:index => [...values.keys()][index] ?? null,
    get length() {return values.size;}};
  }
  // BUP's settings and history must not overwrite those of a real device tab.
  for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, {value:memoryStorage()});
  window.setInterval = () => 0;
  window.WebSocket = class {constructor() {throw new Error('No device connections in profile previews');}};
  window.register_sworker = () => {};
  window.location.hash = 'tdemo&m=tdemo_match_42&lang=de';
 }
 function snapshot(frame) {
  const source = frame.contentDocument, html = source.documentElement.cloneNode(true);
  html.querySelectorAll('script,noscript,iframe,object,embed,audio,video,meta[http-equiv]').forEach(node => node.remove());
  html.querySelectorAll('*').forEach(node => {
   for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
  });
  // Input properties are not included in cloneNode/outerHTML.
  const fields = html.querySelectorAll('input,textarea,select');
  source.querySelectorAll('input,textarea,select').forEach((input, index) => {
   const copy = fields[index];
   if (input.tagName === 'SELECT') [...copy.options].forEach((option, i) => option.toggleAttribute('selected', input.options[i].selected));
   else if (input.tagName === 'TEXTAREA') copy.textContent = input.value;
   else {copy.setAttribute('value', input.value);copy.toggleAttribute('checked', input.checked);}
  });
  const style = source.createElement('style');
  style.textContent = 'html,body{overflow:hidden!important;pointer-events:none!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
  html.querySelector('head').append(style);
  return '<!doctype html>' + html.outerHTML;
 }
 function mount(owner, render) {
  const doc = owner.ownerDocument, records = new Map(), cache = new Map(), abort = new AbortController();
  let disposed = false, running = false, worker = null, sourcePromise;
  const visible = new IntersectionObserver(items => {
   for (const item of items) {const record = records.get(item.target);if (record) record.visible = item.isIntersecting;}
   void process();
  }, {rootMargin:'100px'});
  const resize = new ResizeObserver(items => {
   for (const {target, contentRect} of items) target.style.setProperty('--profile-preview-scale', String(contentRect.width / width));
  });
  const pause = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  async function source() {
   if (!sourcePromise) sourcePromise = fetch('/bup/', {signal:abort.signal}).then(async response => {
    if (!response.ok) throw new Error('Preview renderer unavailable');
    const html = new DOMParser().parseFromString(await response.text(), 'text/html');
    if (!html.querySelector('script[src]')) throw new Error('Preview renderer unavailable');
    html.querySelectorAll('base,script[src*="diagnostic"],script[src*="register_sworker"]').forEach(node => node.remove());
    const base = doc.createElement('base');base.href = new URL('/bup/', window.location.href).href;html.head.prepend(base);
    const script = doc.createElement('script');script.textContent = '(' + bootstrap.toString() + ')();';base.after(script);
    return '<!doctype html>' + html.documentElement.outerHTML;
   }).catch(error => {sourcePromise = null;throw error;});
   return sourcePromise;
  }
  function install(record, html) {
   const frame = doc.createElement('iframe');frame.className = 'settings-profile-snapshot';frame.title = 'Statische Profilvorschau';
   frame.tabIndex = -1;frame.setAttribute('sandbox', 'allow-same-origin');frame.setAttribute('aria-hidden', 'true');frame.srcdoc = html;
   record.target.replaceChildren(frame);record.target.dataset.previewState = 'ready';record.rendered = record.key;
  }
  async function process() {
   if (disposed || running) return;
   running = true;
   try {
    let record;
    while (!disposed && (record = [...records.values()].find(item => item.visible && item.rendered !== item.key))) {
     const key = record.key, profile = record.profile, context = record.context;
     try {
      let html = cache.get(key);
      if (!html) {
       const entry = await source();if (disposed) break;
       worker = doc.createElement('iframe');worker.className = 'settings-profile-renderer';worker.tabIndex = -1;
       worker.setAttribute('aria-hidden', 'true');worker.setAttribute('sandbox', 'allow-scripts allow-same-origin');
       worker.srcdoc = entry;owner.append(worker);
       let ready = false;
       for (let attempt = 0; attempt < 80 && !disposed; attempt++) {
        if (worker.contentDocument?.readyState === 'complete' && worker.contentWindow.state?.event?.matches?.length) {ready = true;break;}
        await pause(75);
       }
       if (disposed) break;
       if (!ready || !await render(worker, profile, context)) throw new Error('Preview renderer not ready');
       await worker.contentDocument.fonts.ready;await pause(100);
       if (disposed) break;
       // Apply once more after fonts/layout have settled, without advancing scores.
       if (!await render(worker, profile, context) || disposed) break;
       html = snapshot(worker);cache.set(key, html);
       if (cache.size > 40) cache.delete(cache.keys().next().value);
      }
      if (!disposed && records.get(record.target) === record && record.key === key) install(record, html);
     } catch (error) {
      if (!disposed && records.get(record.target) === record && record.key === key) {
       record.target.dataset.previewState = 'unavailable';record.target.title = 'Vorschau derzeit nicht verfügbar';record.rendered = key;
      }
     } finally {worker?.remove();worker = null;}
    }
   } finally {running = false;}
  }
  function update(target, profile, context) {
   const settings = Object.fromEntries(Object.keys(profile).sort().filter(key => !['id', '_id', 'description'].includes(key)).map(key => [key, profile[key]]));
   const key = JSON.stringify([settings, context]);
   let record = records.get(target);
   if (!record) {
    record = {target, visible:false};records.set(target, record);visible.observe(target);resize.observe(target);
   }
   if (record.key === key) return;
   Object.assign(record, {key, profile:structuredClone(profile), context:structuredClone(context)});void process();
  }
  function remove(target) {visible.unobserve(target);resize.unobserve(target);records.delete(target);}
  function destroy() {disposed = true;abort.abort();visible.disconnect();resize.disconnect();worker?.remove();records.clear();cache.clear();}
  return {update, remove, destroy};
 }
 return {mount};
})();
