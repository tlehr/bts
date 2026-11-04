/* global btsSettingsWorkspace */
'use strict';

// eslint-disable-next-line no-unused-vars -- Used by the classic admin scripts.
var btsSpeechInfrastructure = (() => {
 const errors = {
  speech_connection_invalid_url:'Bitte eine HTTP- oder HTTPS-Adresse mit Port eingeben, ohne Pfad oder Zugangsdaten.',
  speech_connection_conflict:'Die Verbindung wurde inzwischen in einem anderen Fenster geändert. Einstellungen neu laden; dein Entwurf bleibt erhalten.',
  speech_connection_environment_locked:'Diese Vorgabe ist über die Serverumgebung festgelegt.',
  speech_connection_save_failed:'Die Serverkonfiguration konnte nicht gespeichert werden. Bitte erneut versuchen.',
  speech_connection_unavailable:'Die Serverkonfiguration konnte nicht geladen werden.',
  speech_connection_read_only:'Diese BTS-Instanz bietet keine beschreibbare Konfigurationsdatei.',
  speech_connection_test_busy:'Eine Verbindungsprüfung läuft bereits.',
  helper_runtime_missing:'Das Laufzeitpaket ist auf dem Sprachserver noch nicht vorbereitet.',
  helper_runtime_invalid:'Das Laufzeitpaket ist unvollständig.',
  helper_process_required:'Der isolierte Sprachprozess ist noch nicht verfügbar.',
  helper_server_update_required:'Der Hauptsprachserver benötigt das Update für die zentrale Helferverwaltung.',
  helper_address_not_reachable:'Bitte oben eine vom Helfer-Rechner erreichbare Serveradresse verwenden oder am Sprachserver eine öffentliche Adresse hinterlegen. localhost bezeichnet auf dem Helfer dessen eigenen Rechner.',
  helper_platform_invalid:'Dieses Starterformat wird nicht unterstützt.',
  helper_launcher_invalid:'Der Windows-Starter ist auf BTS nicht vollständig vorbereitet.',
  helper_certificate_missing:'Für HTTPS bitte den Zertifikatsfingerabdruck am Sprachserver unter BTS_HELPER_CERTIFICATE_SHA256 hinterlegen.',
  helper_update_required:'Bitte den alten Helfer stoppen und einen neuen Starter herunterladen.',
  helper_plan_changed:'Der Vorbereitungsplan hat sich geändert.',
  helper_server_changed:'Wegen Serverwechsel neu eingeplant.',
  helper_assignment_lost:'Die Reservierung beim Sprachserver ist nicht mehr vorhanden.',
  helper_memory_limit:'Das freigegebene Modell-RAM hat nicht gereicht.',
  helper_pair_limit:'Zu viele noch gültige Starter. Bitte später erneut versuchen.',
  helper_lease_lost:'Der Auftrag wurde inzwischen neu vergeben.',
  speech_unavailable:'Das Sprachsystem ist derzeit nicht verfügbar.',
  speech_connection_changed:'Die neue Sprachserver-Verbindung wird aufgebaut.',
 };
 const explain = error => errors[error?.message || error] || 'Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.';
 const states = {ready:'Bereit',busy:'Beschäftigt',error:'Gestört',starting:'Modelle werden geladen',disabled:'Deaktiviert',missing_credentials:'Zugang fehlt',connecting:'Verbindung wird aufgebaut',apply_pending:'Übernahme ausstehend',unauthorized:'Zugang abgewiesen',unavailable:'Nicht erreichbar',timeout:'Zeitüberschreitung',invalid:'Antwort nicht unterstützt',unknown:'Status noch unbekannt'};
 const connectionState=view=>!view?'unknown':view.apply_pending?'apply_pending':!view.enabled?'disabled':view.status?.state||'unknown';
 const reachable=view=>!!view?.enabled&&!view.apply_pending&&['ready','busy','starting'].includes(connectionState(view));
 const tone=state=>state==='ready'?'connected':['error','missing_credentials','unauthorized','unavailable','timeout','invalid'].includes(state)?'error':state==='disabled'?'inactive':'waiting';
 function helperEndpoint(address,pageUrl) {
  try {
   const endpoint=new URL(address),page=new URL(pageUrl);
   if(!['http:','https:'].includes(endpoint.protocol))return '';
   const local=host=>host==='localhost'||host==='[::1]'||/^127\./.test(host);
   // A loopback upstream runs on the BTS machine. Keep the speech protocol and
   // port, using the hostname by which this browser already reaches that host.
   if(local(endpoint.hostname)&&!local(page.hostname))endpoint.hostname=page.hostname;
   return endpoint.origin;
  } catch(_){return '';}
 }
 function el(parent,tag,cls,text) {
  const node=parent.ownerDocument.createElement(tag);node.className=cls||'';if(text!=null)node.textContent=text;parent.append(node);return node;
 }
 const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
 const disabled=(node,value)=>{if(node.disabled!==value)node.disabled=value;};
 const hidden=(node,value)=>{if(node.hidden!==value)node.hidden=value;};
 function active(root) {return root.isConnected&&!root.closest('[hidden]')&&!document.hidden;}
 function monitor(root,{request,onStatus,withHelpers=true}) {
  let disposed=false,busy=false;
  async function refresh() {
   if(disposed||busy||!active(root))return;busy=true;
   try {
    const [connection,helpers]=await Promise.allSettled([request('speech_connection_get'),withHelpers?request('speech_helpers'):Promise.resolve({})]);
    if(disposed)return;
    onStatus({connection:connection.status==='fulfilled'?connection.value.connection:null,helpers:helpers.status==='fulfilled'?helpers.value.helpers:null});
   } finally {busy=false;}
  }
  const timer=setInterval(refresh,5000);void refresh();
  return {refresh,dispose(){disposed=true;clearInterval(timer);}};
 }
 function statusText({connection,helpers}) {
  const state=connectionState(connection);
  const workers=(helpers?.workers||[]).filter(worker=>worker.online&&!worker.revoked&&!worker.update_required);
  return 'Sprachserver: '+(states[state]||states.unknown)+' · '+(helpers?workers.length+' Helfer verbunden':'Helferstatus unbekannt');
 }
 function mount(root,{request,onPending=()=>{},onResult=()=>{},onDraft=()=>{}}) {
  root.classList.add('speech-infrastructure');
  el(root,'p','speech-infrastructure-scope','Serverweit – diese Einstellungen und die Sprachhelfer gelten für alle Turniere dieses BTS.');
  const connection=btsSettingsWorkspace.card(root,{title:'Hauptsprachserver',description:'Technische Verbindung zum Sprachserver',badge:'Serverweit'});
  const state=el(connection,'p','speech-connection-state');state.setAttribute('role','status');
  const form=el(connection,'form','speech-connection-form');
  const enabled=btsSettingsWorkspace.field(form,{label:'Sprachserver verwenden',description:'Aktiviert die serverseitige Spracherzeugung für diese BTS-Instanz.',attributes:{name:'speech_connection_enabled',type:'checkbox',role:'switch'}});
  const url=btsSettingsWorkspace.field(form,{label:'Serveradresse',description:'Adresse aus Sicht des BTS-Rechners, zum Beispiel http://127.0.0.1:8077.',attributes:{name:'speech_connection_url',type:'url',required:'required',spellcheck:'false'}});
  const hint=el(form,'p','speech-connection-hint','Die Konfiguration wird geladen …');
  const actions=el(form,'div','settings-card-actions');
  const save=el(actions,'button','btn primary','Verbindung speichern');save.type='submit';save.name='speech_connection_save';
  const test=el(actions,'button','btn','Verbindung prüfen');test.type='button';test.name='speech_connection_test';
  const reload=el(actions,'button','btn','Einstellungen neu laden');reload.type='button';reload.name='speech_connection_reload';
  const feedback=el(connection,'p','speech-connection-feedback');feedback.setAttribute('role','status');
  function message(value,status) {text(feedback,value);if(status)feedback.dataset.tone=tone(status);else feedback.removeAttribute('data-tone');}
  const helperBody=btsSettingsWorkspace.card(root,{title:'Sprachhelfer',description:'Weitere Rechner verbinden und gemeinsam mit dem Hauptsprachserver verwalten',badge:'Serverweit'});
  const helpers=mountHelpers(helperBody,{request});
  let snapshot=null,currentConnection=null,pending=false,testing=false,disposed=false;
  const values=()=>({url:url.value.trim(),enabled:enabled.checked});
  function dirty() {return snapshot&&(url.value.trim()!==snapshot.url||enabled.checked!==snapshot.enabled);}
  function updateButtons() {
   disabled(save,!snapshot?.writable||pending||(!dirty()&&!snapshot.apply_pending)||!form.checkValidity());
   text(save,snapshot?.apply_pending&&!dirty()?'Verbindung übernehmen':'Verbindung speichern');
   disabled(test,!snapshot||testing||!url.validity.valid);disabled(reload,pending);
   helpers.setConnection(currentConnection,enabled.checked);
  }
  function paint(view,{replace=false}={}) {
   currentConnection=view;
   const status=connectionState(view);state.dataset.state=status;state.dataset.tone=tone(status);
   text(state,'Sprachserver: '+(states[status]||states.unknown)+(view?.apply_pending&&view.active_url?' · aktuell verwendet: '+view.active_url:''));
   if(!view){updateButtons();return;}
   const wasDirty=dirty(),previous=snapshot;
   if(!previous||replace||!wasDirty) {
    if(url.value!==view.url)url.value=view.url;if(enabled.checked!==view.enabled)enabled.checked=view.enabled;snapshot=view;
   }
   for(const [field,input] of [['url',url],['enabled',enabled]])disabled(input,!!view.locked[field]);
   const env=['url','enabled'].some(field=>view.locked[field])?' Vorgaben aus der Serverumgebung sind hier schreibgeschützt.':'';
   const changed=previous&&view.revision!==previous.revision&&wasDirty&&!replace?' In einem anderen Fenster wurde gespeichert. Dein Entwurf bleibt erhalten.':'';
   text(hint,(view.apply_pending?'Gespeichert, aber noch nicht übernommen. Über „Verbindung übernehmen“ erneut versuchen.':'Änderungen werden zur Laufzeit übernommen. Ein BTS-Neustart ist nicht nötig.')+env+changed);
   updateButtons();
  }
  const poll=monitor(root,{request,withHelpers:false,onStatus:value=>{if(disposed)return;paint(value.connection);if(!snapshot)text(hint,'Die Serverkonfiguration ist derzeit nicht verfügbar. Über „Einstellungen neu laden“ erneut versuchen.');}});
  async function load() {
   try {const response=await request('speech_connection_get');if(disposed)return;paint(response.connection);message('');}
   catch(error){if(!disposed){paint(null);message(explain(error));}}
  }
  reload.addEventListener('click',async()=>{
   // Refresh the server baseline while preserving the operator's draft.
   try {const response=await request('speech_connection_get');if(disposed)return;const draft=values();paint(response.connection,{replace:true});url.value=draft.url;enabled.checked=draft.enabled;updateButtons();message('Aktueller Serverstand geladen. Dein Entwurf bleibt erhalten.');}
   catch(error){if(!disposed){paint(null);message(explain(error));}}
  });
  form.addEventListener('input',()=>{updateButtons();onDraft();});form.addEventListener('change',()=>{updateButtons();onDraft();});
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(pending||!snapshot?.writable||(!dirty()&&!snapshot.apply_pending)||!form.reportValidity())return;
   const submitted=values(),fields={...submitted};for(const name of Object.keys(snapshot.locked))if(snapshot.locked[name])delete fields[name];
   pending=true;updateButtons();onPending();message('Verbindung wird gespeichert …');
   try {
    const response=await request('speech_connection_save',{values:fields,revision:snapshot.revision});onResult(null);
    if(disposed)return;
    const newer=JSON.stringify(values())!==JSON.stringify(submitted),draft=values();paint(response.connection,{replace:true});
    if(newer){url.value=draft.url;enabled.checked=draft.enabled;}
    message(response.connection.apply_pending?'Verbindung gespeichert. Die Übernahme ist fehlgeschlagen; bitte erneut übernehmen.':'Verbindung gespeichert und zur Laufzeit übernommen.');onDraft();
   } catch(error){onResult(error);if(!disposed)message(explain(error));}
   finally {pending=false;if(!disposed)updateButtons();}
  });
  test.addEventListener('click',async()=>{
   if(testing||!snapshot||!url.reportValidity())return;testing=true;updateButtons();message('Verbindung wird geprüft …');
   const fields=values();for(const name of Object.keys(snapshot.locked))if(snapshot.locked[name])delete fields[name];
   try {const response=await request('speech_connection_test',{values:fields});if(!disposed){message(response.result.message,response.result.state);void poll.refresh();}}
   catch(error){if(!disposed)message(explain(error));}
   finally {testing=false;if(!disposed)updateButtons();}
  });
  updateButtons();void load();
  const api={dirty,refresh(){void load();void helpers.refresh();},dispose(){disposed=true;poll.dispose();helpers.dispose();}};root.btsSpeechInfrastructure=api;return api;
 }
 function mountHelpers(root,{request}) {
  root.classList.add('speech-helper-settings');root.id='speech-helpers';
  const card=root.closest('.settings-card');
  const availability=el(root,'p','speech-helper-availability');availability.id='speech-helper-availability';availability.setAttribute('role','status');
  const controls=el(root,'fieldset','speech-helper-controls');controls.disabled=true;controls.setAttribute('aria-describedby',availability.id);
  root=controls;
  el(root,'p','settings-speech-help','Sprachhelfer verbinden sich direkt mit dem Hauptsprachserver. Er verwaltet Aufträge, Vergabe und Wiederholungen sowie Qualitätsprüfung, Zuschnitt und Aufbereitung. Bestehende Helfer benötigen nach der Umstellung einen neuen Starter.');
  const instructions=el(root,'details','speech-helper-instructions');el(instructions,'summary','','Installation und Voraussetzungen');
  el(instructions,'p','','Windows 11: Die einzelne EXE herunterladen und öffnen. Das Helferfenster erklärt Änderungen, Speicherbedarf und Datenaustausch. CPU-Kerne und Modell-RAM-Abbruchgrenze werden dort gewählt; der Nutzer startet ausdrücklich. Downloadfortschritt, Status, Stoppen und Entfernen bleiben im Fenster erreichbar. Eine gesondert angebotene WSL-Einrichtung kann einen Windows-Neustart erfordern; BTP vorher speichern und beenden. Die EXE ist derzeit nicht digital signiert; Windows kann eine Herausgeberwarnung anzeigen.');
  el(instructions,'p','','Linux x86_64: Die SH-Datei herunterladen und mit bash BTS-Sprachhelfer-Linux.sh starten. Benötigt werden Python 3.8+ und Bubblewrap. Ein fehlendes Bubblewrap-Paket wird nach gesonderter Zustimmung über den Paketmanager installiert. Die Laufzeit verwendet mitgelieferte Bibliotheken; ARM wird noch nicht unterstützt. Das Menü bietet Ressourcenwahl, lokale Lastmessung, Starten und Entfernen. Strg+C stoppt die Arbeit.');
  el(root,'p','settings-speech-help','Die Serveradresse wird automatisch übernommen. Der persönliche Starter erhält einen vom Sprachserver ausgestellten Helferzugang.');
  const downloads=el(root,'div','settings-card-actions');
  const windows=el(downloads,'button','btn','Windows-EXE herunterladen'),linux=el(downloads,'button','btn','Linux-SH herunterladen');
  windows.type=linux.type='button';windows.name='speech_helper_windows';linux.name='speech_helper_linux';
  const runtime=el(root,'p','settings-speech-help'),connection=el(root,'p','speech-helper-state');connection.setAttribute('role','status');
  const tools=el(root,'div','speech-helper-tools');
  const voiceLabel=el(tools,'label','','Teststimme '),voice=el(voiceLabel,'select');voice.name='speech_helper_voice';
  for(const [value,label] of [['hallensprecherin','Hallensprecherin'],['hallensprecher','Hallensprecher']]){const option=el(voice,'option','',label);option.value=value;}
  const test=el(tools,'button','btn','Test an nächsten freien Helfer');test.type='button';test.name='speech_helper_test';
  el(root,'p','settings-speech-help','Das aktuelle Paket nutzt die CPU. Die lokale Lastmessung empfiehlt Ressourcen; der Nutzer übernimmt den Vorschlag ausdrücklich. „Pause“ beendet zuerst den laufenden Auftrag. „Trennen“ entzieht den Zugang und gibt einen offenen Auftrag wieder frei.');
  const table=el(root,'table','speech-helper-table'),header=el(el(table,'thead'),'tr');
  for(const label of ['Rechner','Status','Auftrag','Erledigt','Aktionen'])el(header,'th','',label).scope='col';
  const body=el(table,'tbody'),empty=el(root,'p','settings-speech-help','Noch kein Helfer angemeldet.');
  const details=el(root,'details','speech-helper-jobs');el(details,'summary','','Aufträge und Testaufnahmen');
  el(details,'p','settings-speech-help','Testaufnahmen können hier angehört werden und werden nicht als reguläre Durchsage verwendet. Kontextaufnahmen sind erst nach der zentralen Qualitätsprüfung bereit.');
  const jobRoot=el(details,'div'),feedback=el(root,'p','speech-helper-feedback');feedback.setAttribute('role','status');
  const rows=new Map(),jobs=new Map(),pendingWorkers=new Set();let snapshot=null,origin='',disposed=false,busy=false,downloading=false,actionPending=false,lastAction=0,stale=true,serverAvailable=false,serverIdentity='',accessRevision=0;
  const capable=worker=>worker.online&&!worker.paused&&!worker.revoked&&!worker.update_required;
  function buttons() {
   const unavailable=!serverAvailable||stale;
   card.classList.toggle('is-unavailable',unavailable);disabled(controls,unavailable);disabled(voice,unavailable);
   disabled(windows,unavailable||downloading||!snapshot?.runtime||!origin);disabled(linux,unavailable||downloading||!snapshot?.runtime||!origin);
   const reason=!serverAvailable?availability.textContent:stale?'Der Helferstatus ist noch nicht bestätigt.':!snapshot?.runtime?(errors[snapshot?.error]||'Das Laufzeitpaket fehlt auf dem Sprachserver.'):!origin?'Die Sprachserver-Adresse konnte nicht ermittelt werden.':downloading?'Der persönliche Starter wird heruntergeladen.':'';
   for(const button of [windows,linux])if(button.title!==reason)button.title=reason;
   disabled(test,unavailable||actionPending||!snapshot?.workers?.some(capable));
   for(const [id,row] of rows){disabled(row.test,unavailable||pendingWorkers.has(id)||!capable(row.worker));disabled(row.pause,unavailable||pendingWorkers.has(id));disabled(row.revoke,unavailable||pendingWorkers.has(id));}
  }
  async function call(type,fields={}) {
   const wait=Math.max(0,lastAction+300-Date.now());lastAction=Date.now()+wait;
   if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
   if(disposed||!serverAvailable)throw new Error('speech_unavailable');return request(type,fields);
  }
  function paint(response) {
   snapshot=response.helpers;if(!snapshot)throw new Error('speech_unavailable');stale=false;
   const address=snapshot.endpoint;
   origin=helperEndpoint(address,window.location.href);
   text(runtime,snapshot.runtime?'Laufzeit: '+(snapshot.runtime.size_bytes/1024**3).toFixed(1)+' GiB, einmaliger Download':errors[snapshot.error]||'Laufzeit derzeit nicht verfügbar.');
   runtime.dataset.state=snapshot.runtime?'ready':'missing';
   text(connection,snapshot.generation?.ready?'Verbunden · reguläre Aufträge werden automatisch verteilt':snapshot.generation?.reason==='helper_profile_mismatch'?'Helferpaket passt nicht zum Sprachserver. Paket auf dem Sprachserver neu erstellen und Starter erneut herunterladen.':'Wartet auf einen bereiten Hauptsprachserver für reguläre Aufträge.');
   hidden(empty,!!snapshot.workers.length);hidden(table,!snapshot.workers.length);
   const keep=new Set();
   for(const [index,worker] of snapshot.workers.entries()) {
    keep.add(worker.id);let row=rows.get(worker.id);
    if(!row){
     const node=el(body,'tr'),cells=['Rechner','Status','Auftrag','Erledigt','Aktionen'].map(label=>{const cell=el(node,'td');cell.dataset.label=label;return cell;});
     const name=el(cells[0],'strong'),meta=el(cells[0],'small'),state=el(cells[1],'span','speech-helper-badge');
     const controls=el(cells[4],'div','speech-helper-actions');
     const probe=el(controls,'button','btn','Testaufnahme'),pause=el(controls,'button','btn','Pause'),revoke=el(controls,'button','btn','Trennen');
     for(const button of [probe,pause,revoke])button.type='button';
     row={node,cells,name,meta,state,test:probe,pause,revoke};rows.set(worker.id,row);node.dataset.helperId=worker.id;
     probe.onclick=()=>act('speech_helper_test',{voice:voice.value,worker_id:worker.id},worker.id);
     pause.onclick=()=>act('speech_helper_control',{worker_id:worker.id,action:row.worker.paused?'resume':'pause'},worker.id);
     revoke.onclick=()=>act('speech_helper_control',{worker_id:worker.id,action:'revoke'},worker.id);
    }
    row.worker=worker;text(row.name,worker.name);text(row.meta,(worker.platform||'')+' · '+worker.threads+' CPU-Kerne · '+((worker.memory_limit_mib??3584)/1024).toLocaleString('de-DE')+' GiB Modell-RAM-Abbruchgrenze');
    text(row.state,worker.revoked?'Zugang entzogen':!worker.online?'Nicht verbunden':worker.update_required?'Neuen Starter herunterladen':worker.job_id?'Arbeitet':worker.paused?'Pausiert':'Bereit');
    text(row.cells[2],worker.job_id?worker.text||worker.job_id.slice(0,8):'–');text(row.cells[3],String(worker.completed??0));text(row.pause,worker.paused?'Fortsetzen':'Pause');
    for(const button of [row.test,row.pause,row.revoke])hidden(button,!!worker.revoked);
    if(body.children[index]!==row.node)body.insertBefore(row.node,body.children[index]||null);
   }
   for(const [id,row] of rows)if(!keep.has(id)){row.node.remove();rows.delete(id);}
   const live=new Set(),labels={queued:'Wartet auf Helfer',processing:'Wird erzeugt',completed:'Bereit',failed:'Fehlgeschlagen',validating:'Zentrale Prüfung'};
   for(const job of snapshot.jobs||[]) {
    live.add(job.id);let row=jobs.get(job.id);
    if(!row){const node=el(jobRoot,'article','speech-helper-job');row={node,title:el(node,'strong'),meta:el(node,'small'),text:el(node,'p'),error:el(node,'p'),audio:el(node,'audio')};row.audio.controls=true;row.audio.preload='none';jobs.set(job.id,row);}
    const worker=snapshot.workers.find(item=>item.id===job.worker_id);
    const label=job.kind==='source'&&job.state==='completed'?{ready:'Bereit',failed:'Nicht übernommen',checking:'Zentrale Prüfung eingeplant'}[job.publication]||'Wartet auf zentrale Prüfung':labels[job.state]||job.state;
    text(row.title,label+' · '+(job.kind==='source'?'Kontextaufnahme':'Testaufnahme')+' · '+job.voice+(worker?' · '+worker.name:''));
    text(row.meta,new Date(job.created_at).toLocaleString('de-DE')+' · Versuch '+(job.attempt||0)+(job.elapsed_ms?' · '+(job.elapsed_ms/1000).toFixed(1)+' Sekunden':''));text(row.text,job.text||'');text(row.error,job.error?errors[job.error]||'Der Auftrag ist fehlgeschlagen.':'');hidden(row.error,!job.error);
    hidden(row.audio,!job.audio_path);
    if(job.audio_path&&origin&&row.audio.paused&&(!row.audio.src||Number(row.audio.dataset.expires)<Date.now()/1000+30)){row.audio.src=origin+job.audio_path;row.audio.dataset.expires=new URL(row.audio.src).searchParams.get('expires');}
   }
   for(const [id,row] of jobs)if(!live.has(id)){row.audio.pause();row.node.remove();jobs.delete(id);}
   buttons();
  }
  async function refresh() {
   if(disposed||busy||!serverAvailable||!active(root))return;busy=true;const revision=accessRevision;
   try {const response=await call('speech_helpers');if(!disposed&&revision===accessRevision&&serverAvailable)paint(response);}
   catch(error){if(!disposed&&revision===accessRevision){stale=true;text(connection,explain(error));buttons();}}
   finally {busy=false;}
  }
  async function act(type,fields,id) {
   if(!serverAvailable||stale||id&&pendingWorkers.has(id)||!id&&actionPending)return;
   if(id)pendingWorkers.add(id);else actionPending=true;buttons();text(feedback,'');
   try {await call(type,fields);if(!disposed)await refresh();}
   catch(error){if(!disposed)text(feedback,explain(error));}
   finally {pendingWorkers.delete(id);if(!id)actionPending=false;if(!disposed)buttons();}
  }
  async function download(platform) {
   if(!serverAvailable||downloading||stale||!snapshot?.runtime||!origin)return;
   downloading=true;buttons();text(feedback,'');const revision=accessRevision;
   try {
    const response=await call('speech_helper_bundle',{endpoint:origin,platform});if(disposed||revision!==accessRevision||!serverAvailable)return;
    const bundle=response.bundle,bytes=Uint8Array.from(atob(bundle.content_base64),char=>char.charCodeAt(0));
    const url=URL.createObjectURL(new Blob([bytes],{type:bundle.mime_type})),anchor=el(root,'a');anchor.href=url;anchor.download=bundle.filename;anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
   } catch(error){if(!disposed)text(feedback,explain(error));}
   finally {downloading=false;if(!disposed)buttons();}
  }
  windows.onclick=()=>download('windows');linux.onclick=()=>download('linux');test.onclick=()=>act('speech_helper_test',{voice:voice.value});
  function setConnection(view,draftEnabled) {
   const available=reachable(view)&&draftEnabled,identity=view?[view.active_url||view.url,view.revision].join('|'):'';
   const changed=available!==serverAvailable||identity!==serverIdentity;
   if(changed){accessRevision++;stale=true;}serverAvailable=available;serverIdentity=identity;
   hidden(availability,available);
   text(availability,!view?'Der Verbindungsstatus des Hauptsprachservers ist noch nicht bestätigt.':!draftEnabled||connectionState(view)==='disabled'?'Sprachhelfer sind nur bei aktiviertem Sprachserver verfügbar.':'Sprachhelfer sind erst verfügbar, wenn der Hauptsprachserver erreichbar ist.');
   hidden(connection,!available);buttons();if(changed&&available)void refresh();
  }
  const timer=setInterval(refresh,3000);buttons();
  return {refresh,setConnection,dispose(){disposed=true;clearInterval(timer);for(const row of jobs.values())row.audio.pause();}};
 }
 return {mount,monitor,statusText,helperEndpoint};
})();

if(typeof module!=='undefined'&&module.exports)module.exports=btsSpeechInfrastructure;
