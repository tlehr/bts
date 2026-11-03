/* global btsSettingsWorkspace, btsSpeechInfrastructure */
/* exported btsSpeechWorkspace */
'use strict';

// eslint-disable-next-line no-unused-vars -- Used by the classic tournament script.
var btsSpeechWorkspace = (() => {
 const sections = [['preparation','Vorbereitung'], ['playback','Aufnahmen & Wiedergabe'], ['pronunciation','Aussprache']];
 function create({owner, tournamentKey, service, request, section, onSelect, onDispose}) {
  const doc = owner.ownerDocument, lifetime = new AbortController(), {signal} = lifetime, cleanup = [];
  const el = (parent, tag, className, text) => {
   const node = doc.createElement(tag);node.className = className || '';
   if (text != null) node.textContent = text;parent.append(node);return node;
  };
  const page = el(owner,'section','leitstand page-speech settings-speech');
  page.setAttribute('aria-labelledby','leitstand-page-title');
  const info = el(page,'div','speech-system-settings');
  const summary = el(info,'p');summary.setAttribute('role','status');
  function link(parent, path, text) {
   const node = el(parent,'a','',text);node.href = '/admin/t/' + encodeURIComponent(tournamentKey) + path;
   node.addEventListener('click',event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();window.crouting.navigate_to('t/' + encodeURIComponent(tournamentKey) + path);
   },{signal});return node;
  }
  link(info,'/edit/speech','Spracheinstellungen bearbeiten →');
  const technical=el(page,'div','speech-system-infrastructure');technical.setAttribute('role','status');
  const serverStatus=el(technical,'span','', 'Sprachserver: Status wird geladen …');
  link(technical,'/edit/speech','Server & Sprachhelfer verwalten →');
  const monitoring=btsSpeechInfrastructure.monitor(technical,{request,onStatus:value=>{if(!disposed){const text=btsSpeechInfrastructure.statusText(value);if(serverStatus.textContent!==text)serverStatus.textContent=text;}}});
  cleanup.push(()=>monitoring.dispose());
  const tabs = el(page,'div','speech-system-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Sprachsystem');
  const panels = new Map(), buttons = new Map();
  for (const [id,label] of sections) {
   const button = el(tabs,'button','btn',label);button.type = 'button';button.id = 'speech-tab-' + id;button.setAttribute('role','tab');
   const panel = el(page,'section','speech-system-panel');panel.id = 'speech-panel-' + id;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);
   button.setAttribute('aria-controls',panel.id);button.addEventListener('click',() => onSelect(id),{signal});
   panels.set(id,panel);buttons.set(id,button);
  }
  const preparation = panels.get('preparation');
  const frameStatus = el(preparation,'p','settings-speech-help','Vorbereitungsplan wird geladen …');frameStatus.setAttribute('role','status');
  const frameRetry = el(preparation,'button','btn','Erneut laden');frameRetry.type = 'button';frameRetry.hidden = true;
  const frame = el(preparation,'iframe','speech-system-plan');frame.title = 'Sprachvorbereitung: Übersicht, Zustandsdiagramm und Spiele';
  let disposed = false, selected, loaded = false, frameResize, frameTimer;
  function loadPlan() {
   loaded = true;frameStatus.hidden = false;frameRetry.hidden = true;
   frame.src = '/admin/t/' + encodeURIComponent(tournamentKey) + '/speech-planning/plan/?embedded=1';
   clearTimeout(frameTimer);frameTimer = setTimeout(() => {
    frameStatus.textContent = 'Der Vorbereitungsplan konnte noch nicht geladen werden.';frameRetry.hidden = false;
   },15000);
  }
  frameRetry.addEventListener('click',loadPlan,{signal});
  frame.addEventListener('load',() => {
   if (disposed || !loaded) return;
   clearTimeout(frameTimer);frameResize?.disconnect();
   const content = frame.contentDocument?.querySelector('main.app');
   if (!content) {frameStatus.textContent = 'Der Vorbereitungsplan konnte nicht geladen werden.';frameRetry.hidden = false;return;}
   frameStatus.hidden = true;frameRetry.hidden = true;
   const resize = () => {
    if (disposed || preparation.hidden) return;
    const height = Math.ceil(content.getBoundingClientRect().height + 4);
    if (height > 0 && frame.style.height !== height + 'px') frame.style.height = height + 'px';
   };
   frameResize = new ResizeObserver(resize);frameResize.observe(content);resize();
  },{signal});
  const playback = btsSettingsWorkspace.card(panels.get('playback'),{title:'Aufnahmen und Wiedergabe',description:'Gespeicherte Aufnahmen, Vorbereitungsstatus und Audio auf diesem Gerät'});
  const pronunciation = btsSettingsWorkspace.card(panels.get('pronunciation'),{title:'Aussprache und Textersetzungen',description:'Originaltexte vor der Sprachausgabe durch die gewünschte Aussprache ersetzen'});
  const status = el(panels.get('pronunciation'),'div','live_settings_status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  function refreshSettings() {
   const value = service.settings();
   const text = ({browser:'Browser-TTS',auto:'Server-Audio mit Browser-Fallback',server:'Nur Server-Audio'})[value.mode] + ' · ' + (value.voice === 'hallensprecher' ? 'Hallensprecher' : 'Hallensprecherin');
   if (summary.textContent !== text) summary.textContent = text;
  }
  function show(value) {
   selected = sections.some(([id]) => id === value) ? value : 'preparation';
   for (const [id,panel] of panels) {
    panel.hidden = id !== selected;buttons.get(id).setAttribute('aria-selected',String(id === selected));buttons.get(id).tabIndex = id === selected ? 0 : -1;
   }
   page.dataset.speechSection = selected;
   if (selected === 'preparation' && !loaded) loadPlan();
   refreshSettings();
  }
  tabs.addEventListener('keydown',event => {
   if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
   event.preventDefault();const ids = sections.map(([id]) => id), index = ids.indexOf(selected);
   const next = event.key === 'Home' ? ids[0] : event.key === 'End' ? ids.at(-1) : ids[(index + (event.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
   onSelect(next);buttons.get(next).focus();
  },{signal});
  function dispose() {
   if (disposed) return;disposed = true;lifetime.abort();observer.disconnect();frameResize?.disconnect();clearTimeout(frameTimer);
   for (const callback of cleanup) callback();page.remove();onDispose();
  }
  const observer = new MutationObserver(() => {if (!page.isConnected) dispose();});observer.observe(owner,{childList:true});
  if (owner.parentNode) observer.observe(owner.parentNode,{childList:true});
  show(section);doc.getElementById('leitstand-page-title')?.focus({preventScroll:true});
  return {page,tournamentKey,playback,pronunciation,status,show,refreshSettings,link,dispose,onDispose:callback => cleanup.push(callback)};
 }
 return {create};
})();
