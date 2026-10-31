/* global btsDialogActions, btsScoresheetRemarks, crouting, utils */
'use strict';

// eslint-disable-next-line no-unused-vars -- Used by the classic browser scripts.
var btsRemarksDialog = (() => {
 let active;
 function el(parent,tag,cls,text) {
  const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;
  parent.append(node);return node;
 }
 function stamp(version) {
  const time=Number(version.timestamp);
  return Number.isFinite(time)&&time>0&&time<=8.64e15?new Date(time).toLocaleString('de-DE'):'Uhrzeit nicht überliefert';
 }
 function metadata(version) {
  return stamp(version)+' · Spielstand: '+btsScoresheetRemarks.scoreText(version.score);
 }
 function wording(node,note) {
  node.replaceChildren();
  el(node,'strong','ls-remark-role',btsScoresheetRemarks.roleLabel(note.role)+': ');
  el(node,'span','ls-remark-value',note.val);
 }
 function dispose() {
  const view=active;if(!view)return;active=null;
  view.observer.disconnect();view.controller.destroy();view.dialog.close();view.dialog.remove();
  if(view.opener?.isConnected)view.opener.focus({preventScroll:true});
 }
 function update(match) {
  const view=active;if(!view||String(match._id)!==String(view.match._id))return;
  view.match=match;
  const current='Aktueller Spielstand: '+btsScoresheetRemarks.scoreText(match.network_score||[]);
  if(view.current.textContent!==current)view.current.textContent=current;
  const signature=btsScoresheetRemarks.signature(match);
  if(signature!==view.signature) {
   view.signature=signature;view.notes=btsScoresheetRemarks.entries(match,{includeDeleted:true});
   const deleted=view.notes.filter(note=>note.deleted).length;
   view.audit.hidden=!deleted;view.auditText.textContent='Gelöschte Einträge anzeigen ('+deleted+')';
   view.empty.hidden=view.notes.some(note=>!note.deleted||view.showDeleted.checked);
   const wanted=new Set(view.notes.map(note=>note.key));
   for(const [key,row]of view.rows)if(!wanted.has(key)){row.remove();view.rows.delete(key);}
   view.notes.forEach((note,index)=>{
    let row=view.rows.get(note.key);
    if(!row) {
     row=el(view.list,'li','ls-remark-entry');row.dataset.noteKey=note.key;
     el(row,'p','ls-remark-meta');el(row,'p','ls-remark-text');el(row,'p','ls-remark-meta ls-remark-edited');
     const select=el(row,'button','ls-remark-select','Auswählen');select.type='button';
     select.onclick=()=>view.select(note.key);
     const history=el(row,'details','ls-remark-history');el(history,'summary');el(history,'div','ls-remark-versions');
     view.rows.set(note.key,row);
    }
    if(view.list.children[index]!==row)view.list.insertBefore(row,view.list.children[index]||null);
    row.hidden=note.deleted&&!view.showDeleted.checked;
    const revision=JSON.stringify(note.versions);
    if(row.dataset.revision!==revision) {
     row.dataset.revision=revision;
     row.classList.toggle('is-deleted',note.deleted);wording(row.querySelector('.ls-remark-text'),note);
     row.querySelector('.ls-remark-meta').textContent='Erfasst: '+metadata(note.versions[0]);
     const edited=row.querySelector('.ls-remark-edited');edited.hidden=note.versions.length<2;
     edited.textContent=note.versions.length>1?(note.deleted?'Gelöscht: ':'Zuletzt geändert: ')+metadata(note.versions.at(-1)):'';
     const history=row.querySelector('details');history.hidden=note.versions.length<2;
     history.querySelector('summary').textContent='Änderungshistorie ('+note.versions.length+' Versionen)';
     const versions=history.querySelector('.ls-remark-versions');versions.replaceChildren();
     note.versions.forEach((version,index)=>{
      const item=el(versions,'div','ls-remark-version');
      el(item,'p','ls-remark-meta','Version '+(index+1)+(version.deleted?' · Gelöscht':'')+' · '+metadata(version));
      wording(el(item,'p','ls-remark-text'),version);
     });
    }
   });
  }
  view.render(view.controller.state());
 }
 function open({owner,match,tournamentKey,opener}) {
  if(active||!owner.isConnected)return;
  const dialog=el(document.body,'dialog','bts-confirm-dialog ls-remarks-dialog');dialog.setAttribute('aria-modal','true');
  const heading=el(dialog,'h2','bts-confirm-heading');heading.id='ls-remarks-title';dialog.setAttribute('aria-labelledby',heading.id);
  const icon=el(heading,'span','ls-remarks-icon','✎');icon.setAttribute('aria-hidden','true');
  el(heading,'span','bts-confirm-title','Bemerkungen · Spiel '+match.setup.match_num);
  const close=el(heading,'button','ls-remarks-close','×');close.type='button';close.setAttribute('aria-label','Bemerkungen schließen');
  const form=el(dialog,'form','ls-remarks-form'),body=el(form,'div','bts-confirm-content ls-remarks-body');
  const current=el(body,'p','ls-remarks-current'),empty=el(body,'p','ls-remarks-empty','Noch keine Bemerkungen eingetragen.');
  const audit=el(body,'label','ls-remarks-audit'),showDeleted=el(audit,'input');showDeleted.type='checkbox';
  const auditText=el(audit,'span');
  const list=el(body,'ol','ls-remarks-list');
  const roleLabel=el(body,'label','ls-remarks-role-label','Rolle');roleLabel.htmlFor='ls-remarks-role';
  const role=el(body,'select','ls-remarks-role');role.id='ls-remarks-role';role.name='remark_role';
  for(const [value,caption]of Object.entries(btsScoresheetRemarks.ROLES))el(role,'option',null,caption).value=value;
  const label=el(body,'label','ls-remarks-label','Neue Bemerkung');label.htmlFor='ls-remarks-input';
  const input=el(body,'textarea','ls-remarks-input');input.id='ls-remarks-input';input.name='remark';input.rows=5;input.maxLength=btsScoresheetRemarks.MAX_LENGTH;input.required=true;
  const help=el(body,'p','ls-remarks-help','Beim Speichern werden Uhrzeit und aktueller Spielstand festgehalten. Korrekturen erhalten alle früheren Versionen. Maximal 4000 Zeichen.');help.id='ls-remarks-help';input.setAttribute('aria-describedby',help.id);
  const error=el(body,'p','ls-remarks-error');error.setAttribute('role','alert');error.hidden=true;
  const footer=el(form,'div','bts-confirm-actions');
  const fresh=el(footer,'button','ls-remarks-new','Neue Bemerkung');fresh.type='button';
  const edit=el(footer,'button','ls-remarks-edit','Bearbeiten');edit.type='button';
  const remove=el(footer,'button','ls-remarks-delete is-danger','Löschen');remove.type='button';
  const cancel=el(footer,'button','ls-remarks-cancel','Schließen');cancel.type='button';
  const save=el(footer,'button','bts-confirm-accept ls-remarks-save','Übernehmen');save.type='submit';
  const hint=el(form,'p','ls-remarks-hint');hint.setAttribute('role','status');hint.id='ls-remarks-hint';save.setAttribute('aria-describedby',hint.id);
  const view={dialog,owner,opener,match,current,empty,list,audit,auditText,showDeleted,notes:[],rows:new Map(),target:null,selected:null,signature:null,controller:null};active=view;
  let requestId,submittedText,submittedRole,deleteRequest;
  const confirmDiscard=()=>btsDialogActions.confirm({owner:form,title:'Bemerkungsentwurf verwerfen?',message:'Der noch nicht übernommene Bemerkungstext geht verloren. Andere Eingaben im Spieldialog bleiben erhalten.',
   confirmLabel:'Entwurf verwerfen',cancelLabel:'Weiter bearbeiten',warning:true,returnFocus:input});
  view.render=({dirty,busy})=>{
   const note=view.target&&view.notes.find(note=>note.key===view.target.key);
   const selected=view.notes.find(note=>note.key===view.selected);
   const ownReceipt=requestId&&input.value===submittedText&&role.value===submittedRole&&note?.versions.some(version=>version.key==='id:'+requestId&&version.val===submittedText.trim()&&version.role===submittedRole);
   const reason=dirty&&view.target&&note?.latest_key!==view.target.latest_key&&!ownReceipt?'Die Bemerkung wurde inzwischen geändert. Bitte die aktuelle Version auswählen.':
    dirty?(!input.value.trim()?'Bitte eine Bemerkung eingeben.':input.validationMessage||''):'';
   btsDialogActions.control(save,{disabled:!!busy||!dirty||!!reason,label:busy?'Wird gespeichert…':'Übernehmen',reason:busy?'Speichern läuft.':reason||(!dirty?'Keine Änderungen zum Übernehmen.':'')});
   btsDialogActions.control(cancel,{disabled:!!busy,label:dirty?'Abbrechen':'Schließen'});
   btsDialogActions.control(fresh,{disabled:!!busy});
   const selectionReason=!selected?'Zuerst eine Bemerkung auswählen.':selected.deleted?'Diese Bemerkung ist gelöscht.':'';
   btsDialogActions.control(edit,{disabled:!!busy||!!selectionReason,reason:selectionReason});
   const deleteReason=selectionReason||(dirty?'Änderungen zuerst übernehmen oder verwerfen.':'');
   btsDialogActions.control(remove,{disabled:!!busy||!!deleteReason,reason:deleteReason});
   close.disabled=!!busy;body.inert=!!busy;
   for(const [key,row]of view.rows) {
    const selected=key===view.selected,button=row.querySelector('button');
    if(row.classList.contains('is-selected')!==selected)row.classList.toggle('is-selected',selected);
    if(button.getAttribute('aria-pressed')!==String(selected))button.setAttribute('aria-pressed',String(selected));
   }
   const message=busy?(busy==='delete'?'Bemerkung wird gelöscht…':'Bemerkung wird gespeichert…'):reason;
   if(hint.textContent!==message)hint.textContent=message;
  };
  view.controller=btsDialogActions.create(form,{onUpdate:view.render,confirmDiscard});
  const choose=async key=>{
   if(view.controller.state().busy)return;
   if(view.controller.state().dirty&&!await confirmDiscard())return;
   if(active!==view)return;
   const note=key?view.notes.find(note=>note.key===key):null;if(key&&(!note||note.deleted))return;
   view.target=note;view.selected=note?.key||null;
   input.value=note?.val||'';role.value=note?.role||'umpire';requestId=null;submittedText=null;submittedRole=null;deleteRequest=null;error.hidden=true;
   label.textContent=note?'Bemerkung bearbeiten':'Neue Bemerkung';
   view.controller.accept();input.focus();
  };
  view.select=key=>{view.selected=key;view.render(view.controller.state());};
  showDeleted.onchange=()=>{view.signature=null;update(view.match);};
  fresh.onclick=()=>choose(null);edit.onclick=()=>choose(view.selected);
  remove.onclick=async()=>{
   if(remove.disabled)return;
   const note=view.notes.find(note=>note.key===view.selected);if(!note||note.deleted)return;
   const approved=await btsDialogActions.confirm({owner:form,title:'Bemerkung löschen?',
    message:btsScoresheetRemarks.roleLabel(note.role)+': '+note.val+'\n\nDer Eintrag wird aus dem Spielbericht entfernt. Frühere Fassungen und die Löschung bleiben mit Uhrzeit und Spielstand in der Änderungshistorie erhalten.',
    confirmLabel:'Bemerkung löschen',cancelLabel:'Abbrechen',danger:true,returnFocus:remove});
   if(!approved||active!==view)return;
   const latest=view.notes.find(entry=>entry.key===note.key);
   if(view.controller.state().busy||view.controller.state().dirty||latest?.deleted||latest?.latest_key!==note.latest_key) {
    error.textContent='Die Bemerkung wurde inzwischen geändert. Bitte die aktuelle Version erneut auswählen.';error.hidden=false;return;
   }
   if(!view.controller.begin('delete'))return;
   if(deleteRequest?.remark_target!==note.key||deleteRequest?.remark_previous!==note.latest_key)deleteRequest={remark_id:utils.uuid(),remark_target:note.key,remark_previous:note.latest_key};
   error.hidden=true;
   send({type:'match_remarks_save',tournament_key:tournamentKey,match_id:match._id,remark_delete:true,...deleteRequest},(failure,response)=>{
    if(active!==view)return;
    // A broadcast can acknowledge our deletion before a lost request reply.
    const receipt=view.match.presses?.some(press=>press.note_id===deleteRequest.remark_id&&press.note_deleted);
    if((failure||!Array.isArray(response?.presses))&&!receipt) {
     error.textContent=failure?.message||'Die Bemerkung konnte nicht gelöscht werden. Bitte erneut versuchen.';error.hidden=false;view.controller.end();return;
    }
    if(Array.isArray(response?.presses))crouting.on_change({ctype:'match_remarks',tournament_key:tournamentKey,val:response});
    if(view.target?.key===note.key){view.target=null;input.value='';role.value='umpire';label.textContent='Neue Bemerkung';}
    view.selected=null;deleteRequest=null;requestId=null;view.controller.accept();hint.textContent='Bemerkung gelöscht.';fresh.focus();
   });
  };
  const requestClose=async()=>{if(await view.controller.canClose()&&active===view)dispose();};
  close.onclick=cancel.onclick=requestClose;
  dialog.addEventListener('cancel',event=>{event.preventDefault();requestClose();});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();requestClose();}});
  dialog.addEventListener('click',event=>{if(event.target===dialog)requestClose();});
  const resetRequest=()=>{error.hidden=true;if(input.value!==submittedText||role.value!==submittedRole)requestId=null;};
  input.addEventListener('input',resetRequest);role.addEventListener('change',resetRequest);
  form.addEventListener('submit',event=>{
   event.preventDefault();if(save.disabled||!form.reportValidity()||!input.value.trim()||!view.controller.begin('save'))return;
   error.hidden=true;
   if(!requestId){requestId=utils.uuid();submittedText=input.value;submittedRole=role.value;}
   send({type:'match_remarks_save',tournament_key:tournamentKey,match_id:match._id,remark:input.value,remark_role:role.value,remark_id:requestId,
    ...(view.target?{remark_target:view.target.key,remark_previous:view.target.latest_key}:{})},(failure,response)=>{
    if(active!==view)return;
    if(failure||!Array.isArray(response?.presses)) {
     error.textContent=failure?.message||'Die Bemerkung konnte nicht gespeichert werden. Bitte erneut versuchen.';error.hidden=false;view.controller.end();return;
    }
    crouting.on_change({ctype:'match_remarks',tournament_key:tournamentKey,val:response});
    const edited=view.target&&view.notes.find(note=>note.key===view.target.key);
    view.target=edited||null;view.selected=edited?.key||null;input.value=edited?.val||'';role.value=edited?.role||'umpire';requestId=null;submittedText=null;submittedRole=null;view.controller.accept();
    hint.textContent='Bemerkung gespeichert.';input.focus();
   });
  });
  view.observer=new MutationObserver(()=>{if(!owner.isConnected||!dialog.isConnected)dispose();});
  view.observer.observe(document.body,{childList:true,subtree:true});
  dialog.showModal();update(match);input.focus();
 }
 return {open,update,dispose};
})();
