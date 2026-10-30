/* global cerror, cmatch, ctournament, btp_entry_status, calc, btsAdminUpdates */
'use strict';

// The live tournament board. Existing controls and incremental match updates retain their handlers.
// eslint-disable-next-line no-unused-vars -- Exposed to the other classic browser scripts.
var cleitstand = (function() {
  const paths = {
    court: '<g stroke-width="1"><path d="M6 1h12v22H6ZM7.5 1v22M16.5 1v22M6 3h12M6 8.5h12M6 15.5h12M6 21h12M12 1v7.5M12 15.5V23"/><path d="M3.5 12h17" stroke-width="1.5"/></g>',
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    people: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 4 5v2"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    settings: '<path d="m10 3 4 0 1 3 3 1 3-1 2 4-2 2v3l1 2-3 3-3-1-2 1-1 3H9l-1-3-3-1-2 1-2-4 2-2v-3l-1-2 3-3 3 1 2-1Z"/><circle cx="12" cy="12" r="3"/>',
    monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/>',
    tablet: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M10 18h4"/>',
    battery: '<rect x="2" y="6" width="18" height="12" rx="2"/><path d="M22 10v4"/>',
    bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-7Z"/>',
    umpire: '<circle cx="9" cy="4" r="2"/><path d="M7 8h6v5h5v8M7 8v7h8M7 15v6M7 18h8M4 21h6"/>',
    serviceJudge: '<path d="M4 4h13v7H4ZM7 2h13v7M4 7h13M17 7h3M12 11v8M6 22l6-3 6 3M12 19v3"/>',
    logs: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3" cy="6" r=".7"/><circle cx="3" cy="12" r=".7"/><circle cx="3" cy="18" r=".7"/>',
    sheet: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M4 8h16M4 13h16M4 18h16M10 8v13"/>',
    flask: '<path d="M9 2h6M10 2v7l-7 11a1 1 0 0 0 1 2h16a1 1 0 0 0 1-2L14 9V2M7 15h10"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m5 12 4 4L20 5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
    edit: '<path d="m15 3 6 6M4 20l4-1L21 6l-4-4L4 15Z"/>',
    history: '<path d="M3 10a9 9 0 1 1 2 9M3 3v7h7M12 7v6l4 2"/>',
    code: '<path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 2l-4 20"/>',
    play: '<path d="m8 4 12 8-12 8Z"/>',
    pause: '<path d="M8 4v16M16 4v16"/>',
    speaker: '<path d="m11 3-6 5H2v8h3l6 5ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16"/>',
    refresh: '<path d="M20 9a8 8 0 0 0-14-5L3 7M3 2v5h5M4 15a8 8 0 0 0 14 5l3-3M21 22v-5h-5"/>',
    download: '<path d="M12 2v14m-5-5 5 5 5-5M3 16v5h18v-5"/>',
    upload: '<path d="M12 16V2m-5 5 5-5 5 5M3 16v5h18v-5"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    arrow: '<path d="M3 12h18m-6-6 6 6-6 6"/>',
    alert: '<path d="m12 3 10 18H2Z"/><path d="M12 9v5M12 17v1"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',
    bell: '<path d="M4 17h16l-2-3V9a6 6 0 0 0-12 0v5ZM10 21h4"/>',
    shield: '<path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5Z"/><path d="m8 11 3 3 5-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v7l4 2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/>',
    folder: '<path d="M3 5h7l2 3h9v13H3Z"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="1"/><rect x="3" y="14" width="18" height="7" rx="1"/><path d="M7 6h1M7 17h1M12 6h6M12 17h6"/>',
    arrowUp: '<path d="M12 21V3m-6 6 6-6 6 6"/>',
    arrowDown: '<path d="M12 3v18m-6-6 6 6 6-6"/>',
    arrowLeft: '<path d="M21 12H3m6-6-6 6 6 6"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M16 9v12"/>',
    grip: '<circle cx="8" cy="5" r="1"/><circle cx="16" cy="5" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/>',
    collapse: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m7-12-3 3 3 3"/>',
    export: '<path d="M12 3H3v18h18v-9M14 2h8v8m0-8L11 13"/>',
    save: '<path d="M3 3h15l3 3v15H3ZM7 3v6h10V3M7 21v-7h10v7"/>',
    flag: '<path d="M5 22V3c5-5 9 5 15 0v12c-6 5-10-5-15 0"/>',
    sort: '<path d="M4 5h16M4 12h11M4 19h6"/>',
    chart: '<path d="M3 3v18h19M6 16l4-6 5 3 6-8"/>',
    eyeOff: '<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A12 12 0 0 1 21 12a15 15 0 0 1-3.2 4.1M6.3 6.3A15 15 0 0 0 3 12s3 7 9 7a11 11 0 0 0 5.7-1.7"/>',
  };
  const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  const button = (label, action = 'demo', symbol, kind = '', extra = '') => `<button type="button" class="btn ${kind}" data-action="${action}" ${extra}>${symbol ? icon(symbol) : ''}${label}</button>`;
  const tiny = (name, action, label, extra = '') => button('', action, name, 'icon-only', `title="${label}" aria-label="${label}" ${extra}`);
  const boardCards = [
    {id:'operators',label:'Nächste Tabletbediener',width:1.1}, {id:'rotation',label:'Rotation',width:1.5}, {id:'announcement',label:'Freie Durchsage',width:1.45},
    {id:'device',label:'Auf diesem Gerät',width:1.35}, {id:'automation',label:'Automatik',width:1.15},
    {id:'tablets',label:'Tablets',width:1.15},
    {id:'logs',label:'Logdaten',width:1.35},
  ];
  const boardLayoutKey='bts-admin-card-layout-v1';
  const boardZones=['top','sidebar','hidden'];
  const cardMinHeight=140,cardMaxHeight=2400;
  const defaultBoardLayout=()=>({top:boardCards.map(card=>card.id),sidebar:[],hidden:[],heights:{}});
  function readBoardLayout() {
    try {
      const saved=JSON.parse(localStorage.getItem(boardLayoutKey)||localStorage.getItem('bts-admin-mockup-card-layout-v1'));
      if(!Array.isArray(saved?.top)||!Array.isArray(saved?.sidebar)) return defaultBoardLayout();
      const seen=new Set(),layout={top:[],sidebar:[],hidden:[],heights:{}};
      for(const zone of boardZones) for(const id of Array.isArray(saved[zone])?saved[zone]:[]) {
        if(boardCards.some(card=>card.id===id)&&!seen.has(id)) {layout[zone].push(id);seen.add(id);}
      }
      layout.top.push(...boardCards.filter(card=>!seen.has(card.id)).map(card=>card.id));
      for(const {id} of boardCards) {
        const height=saved.heights?.[id];
        if(Number.isFinite(height)&&height>=cardMinHeight&&height<=cardMaxHeight)layout.heights[id]=Math.round(height);
      }
      return layout;
    } catch { return defaultBoardLayout(); }
  }
  const tabletSortKey='bts-admin-tablet-sort-v1';
  const logSortKey='bts-admin-log-sort-v1';
  function readTabletSort() {
    try {const saved=JSON.parse(readStorage(tabletSortKey));if(['court','battery'].includes(saved?.key)&&[1,-1].includes(saved.direction))return saved;}catch { /* Use the default if browser storage is unavailable or invalid. */ }
    return {key:'court',direction:1};
  }
  const state={boardLayout:readBoardLayout(),layoutEditing:false,density:readStorage('bts-admin-density')||'compact',finishedSort:{key:'end',direction:-1},tabletSort:readTabletSort(),logFilter:'',logSort:readStorage(logSortKey)==='ascending'?1:-1};
  let root=null, model=null, actions={}, listeners=null, viewObserver=null, draggedCard=null, cardDragBlocked=false, layoutBeforeEdit=null, draggedMatch=null, dialogOpener=null, countsPending=false;
  let cardResize=null;
  let logView=null,unsubscribeLogs=null;
  let nameObserver=null, nameFrame=null, nameLayoutDirty=false;
  let nameComplete=null,timerComplete=null,countsComplete=null,finishedComplete=null;
  let headerObserver=null,headerHeight=null,sidebarHeight=null,btpFontVersion=0;
  let preparationLayoutDirty=false;
  let finishedSortPending=false;
  const nameGroups=new Map(),nameTooltips=new WeakMap(),dirtyNameGroups=new Set(),officialMeasurements=new WeakMap(),officialCellMeasurements=new WeakMap();
  let nameFontVersion=0;
  let timerObserver=null,timerFrame=null,timerMeasure=null;
  const timerValues=new Set(),dirtyTimers=new Set(),timerMeasurements=new WeakMap(),timerBoxes=new WeakMap(),timerForms=new WeakMap(),timerFittings=new Map();
  const preparationWidths=new Map();
  const probeRoots=new WeakMap();
  const pendingUpdates=new Map();
  const untrackedUpdate=Object.assign(()=>{},{claim:()=>{},run:callback=>callback()});
  function trackUpdate(name) {
    if(typeof btsAdminUpdates==='undefined'||!btsAdminUpdates.hasSubscribers())return untrackedUpdate;
    const job=btsAdminUpdates.createJob(name);
    const complete=()=>{pendingUpdates.delete(job.promise);job.complete();};
    complete.claim=job.claim;complete.run=job.run;pendingUpdates.set(job.promise,complete);return complete;
  }
  function queueNames() {
    if(!root?.isConnected)return;
    if(nameFrame!==null){nameComplete?.claim();return;}
    const done=nameComplete=trackUpdate('names.layout');
    nameFrame=requestAnimationFrame(()=>{nameComplete=null;try {done.run(refreshNames);} finally {done();}});
  }
  const tabletSignatures=new WeakMap();
  const scoreViews=new WeakMap(),rowViews=new WeakMap();
  let searchControl=null;
  function readStorage(key) {try{return localStorage.getItem(key);}catch{return null;}}
  function writeStorage(key,value) {try{localStorage.setItem(key,value);return true;}catch{return false;}}
  function el(parent,tag,className,text) {const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;if(parent)parent.append(node);return node;}
  function toast(text) {if(!root)return;let node=root.querySelector('.board-toast');if(!node){node=el(root,'div','board-toast');node.setAttribute('role','status');}node.textContent=text;node.hidden=false;clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>{node.hidden=true;},3200);}
  function active(node) {return !!node?.closest?.('.leitstand');}
  function nameParts(person={}) {
    const clean=value=>String(value||'').trim().replace(/\s+/g,' ');
    const first=clean(person.firstname),middle=clean(person.middlename);
    let surname=clean(person.lastname||person.surname);
    const given=[first,middle&&(first===middle||first.endsWith(' '+middle))?'':middle].filter(Boolean).join(' ');
    const full=clean(person.name)||[given,surname].filter(Boolean).join(' ');
    if(!surname&&given&&full.startsWith(given+' '))surname=full.slice(given.length+1);
    // Use the supplied surname boundary; spaces alone cannot distinguish middle names from surnames.
    const prefix=surname&&full.endsWith(' '+surname)?full.slice(0,-surname.length-1):given;
    return {full,surname,first:prefix.split(' ')[0]||'',hasMiddle:prefix.includes(' ')};
  }
  function nameStages(people) {
    const parts=people.map(nameParts),labels=parts.map(person=>person.full),stages=[labels.slice()];
    const letters=name=>(name.normalize('NFC').match(/\p{L}/gu)||[]).length;
    const byLength=()=>labels.map((name,index)=>({index,length:letters(name)})).sort((a,b)=>b.length-a.length||a.index-b.index).map(value=>value.index);
    const push=()=>{if(labels.some((name,index)=>name!==stages[stages.length-1][index]))stages.push(labels.slice());};
    for(const index of byLength()) {
      const person=parts[index];
      if(person.hasMiddle&&person.surname) {labels[index]=person.first+' '+person.surname;push();}
    }
    // Recompare after removing middle names before choosing whose first name to abbreviate.
    for(const index of byLength()) {
      const person=parts[index];
      if(!person.first||!person.surname)continue;
      const initials=person.first.split(/([-‐‑])/u).map(part=>!part||/^[-‐‑]$/u.test(part)?part:(part.normalize('NFC').match(/\p{L}/u)?.[0]||part[0])+'.').join('');
      labels[index]=initials+' '+person.surname;push();
    }
    return stages;
  }
  function setNameLabel(member,label) {
    const {target,text,full,suffix}=member;
    const value=label.replace(' ','\xa0')+suffix;if(text.nodeValue!==value)text.nodeValue=value;
    const current=target.getAttribute('title')||'';
    let tooltip=nameTooltips.get(target);
    if(!tooltip||current!==tooltip.last)tooltip={detail:current};
    const title=label===full?tooltip.detail:[full,tooltip.detail].filter(Boolean).join(' · ');
    if(title) {if(current!==title)target.title=title;}else if(current)target.removeAttribute('title');
    tooltip.last=title;nameTooltips.set(target,tooltip);
  }
  function nameContentKey(group) {
    // Status colors do not change the name width. Resource badges and the
    // visibility of a fixed-width clock can change the space it needs.
    return JSON.stringify(group.members.map(({target})=>[...target.children].map(child=>child.classList.contains('timer')?['timer',child.hidden,child.style.display]:[child.className.baseVal??child.className,child.textContent])));
  }
  function layoutProbe(source,className) {
    const probe=source.cloneNode(true);probe.classList.add('ls-layout-probe',className);probe.setAttribute('aria-hidden','true');probe.inert=true;
    probe.dataset.lsProbeMatch=source.closest('tr')?.dataset.match_id||'';
    for(const node of [probe,...probe.querySelectorAll('[id],[data-match_id],[data-court_id]')])for(const name of ['id','data-match_id','data-court_id'])node.removeAttribute(name);
    // Preserve the CSS ancestry without adding trial cells or grid items to
    // the live table. A fixed, contained copy of that ancestry has no effect
    // on its rows, columns, ResizeObservers or current score layout.
    const table=source.closest('.match_table'),host=table?.parentElement||source.parentElement;let branch=probe;
    for(let parent=source.parentElement;parent&&parent!==host;parent=parent.parentElement) {
      const context=parent.cloneNode(false);context.classList.add('ls-probe-context');
      for(const name of ['id','data-match_id','data-court_id'])context.removeAttribute(name);
      context.append(branch);branch=context;
    }
    branch.classList.add('ls-probe-root');branch.setAttribute('aria-hidden','true');branch.inert=true;
    (host||root).append(branch);probeRoots.set(probe,branch);return probe;
  }
  function removeLayoutProbe(probe) {probeRoots.get(probe)?.remove();probeRoots.delete(probe);}
  function probeMember(source,probe,member) {
    const path=[];let node=member.target,target=probe;
    while(node!==source) {path.push([...node.parentNode.childNodes].indexOf(node));node=node.parentNode;}
    for(const index of path.reverse())target=target.childNodes[index];
    return {...member,target,text:target.childNodes[[...member.target.childNodes].indexOf(member.text)]};
  }
  function refreshNames() {
    nameFrame=null;pruneTimers();
    const layoutChanged=nameLayoutDirty;
    if(nameLayoutDirty) {nameLayoutDirty=false;preparationLayoutDirty=false;positionBoardSidebar();root?.querySelectorAll('.ls-planned-table').forEach(preparationLayout);refreshOfficialsLayout();refreshBoundaryLayout();}
    else if(preparationLayoutDirty) {preparationLayoutDirty=false;root?.querySelectorAll('.ls-planned-table').forEach(preparationLayout);refreshBoundaryLayout();}
    const jobs=[],labels=[];
    for(const [container,group] of nameGroups) {
      if(!active(container)||!container.isConnected||group.members.some(member=>member.text.parentNode!==member.target)) {
        nameObserver?.unobserve(container);nameGroups.delete(container);dirtyNameGroups.delete(container);continue;
      }
      if(!dirtyNameGroups.delete(container))continue;
      if(group.fontVersion!==nameFontVersion) {
        const style=getComputedStyle(container);
        group.insets=['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum,key)=>sum+(parseFloat(style[key])||0),0);
        group.fontVersion=nameFontVersion;group.fits.clear();group.stageWidths.clear();group.readWidth=true;
      }
      const content=nameContentKey(group);
      if(content!==group.content) {group.content=content;group.fits.clear();group.stageWidths.clear();group.readWidth=true;}
      if(layoutChanged||group.readWidth||group.width==null) {group.width=container.getBoundingClientRect().width-group.insets;group.readWidth=false;}
      const available=group.width;if(available<=0)continue;
      const cached=group.fits.get(available);
      if(cached!=null) {labels.push([group,cached]);continue;}
      let stage=0;
      while(group.stageWidths.has(stage)&&group.stageWidths.get(stage)>available+.25&&stage+1<group.stages.length)stage++;
      if(group.stageWidths.has(stage)) {
        if(group.fits.size>=8)group.fits.delete(group.fits.keys().next().value);group.fits.set(available,stage);
        labels.push([group,stage]);continue;
      }
      group.range??=document.createRange();group.range.selectNodeContents(container);
      jobs.push({container,group,available,range:group.range,stage});
    }
    // Trial abbreviations live in out-of-flow, layout-contained copies. Their
    // intrinsic widths do not reflow the real table at every candidate stage.
    // Only the chosen labels are written to the existing visible text nodes.
    for(const job of jobs) {
      job.probe=layoutProbe(job.container,'ls-name-measuring');
      job.members=job.group.members.map(member=>probeMember(job.container,job.probe,member));
      job.range.selectNodeContents(job.probe);
    }
    let remaining=jobs;
    try {
      while(remaining.length) {
        for(const {group,members,stage} of remaining)members.forEach((member,index)=>setNameLabel(member,group.stages[stage][index]));
        const next=[];
        for(const job of remaining) {
          let width=job.group.stageWidths.get(job.stage);
          if(width==null) {width=job.range.getBoundingClientRect().width;job.group.stageWidths.set(job.stage,width);}
          if(width>job.available+.25&&job.stage+1<job.group.stages.length) {job.stage++;next.push(job);}
          else {if(job.group.fits.size>=8)job.group.fits.delete(job.group.fits.keys().next().value);job.group.fits.set(job.available,job.stage);}
        }
        remaining=next;
      }
    } finally {for(const job of jobs) {removeLayoutProbe(job.probe);job.range.selectNodeContents(job.container);}}
    for(const {group,stage} of jobs)labels.push([group,stage]);
    // Cache hits can choose different labels at a new width, too. Keep those
    // writes after every geometry read, just like freshly measured results.
    for(const [group,stage] of labels)group.members.forEach((member,index)=>setNameLabel(member,group.stages[stage][index]));
  }
  function scheduleNames(changed) {
    // Status updates touch a handful of players. Re-measuring every name here
    // delays the next paint, even though the score handler itself was quick.
    if(!changed)for(const [container,group] of nameGroups) {dirtyNameGroups.add(container);group.readWidth=true;}
    else for(let container=changed;container;container=container.parentElement)if(nameGroups.has(container))dirtyNameGroups.add(container);
    if(!changed||changed.closest('.umpire_and_tablet'))nameLayoutDirty=true;
    queueNames();
  }
  function refreshOfficialsLayout() {
    if(!root?.isConnected)return;
    const horizontalInsets=node=>{const style=getComputedStyle(node);return ['paddingLeft','paddingRight','borderLeftWidth','borderRightWidth'].reduce((sum,key)=>sum+(parseFloat(style[key])||0),0);};
    const tables=[...root.querySelectorAll('.match_table:has(.ls-officials-column)')];
    const jobs=[],changedCells=new Set();
    for(const table of tables) {
      const cells=[...table.querySelectorAll('tbody>tr:not([hidden]):not(.do_not_show):not(.ls-date-collapsed)>td.umpire_and_tablet')];
      const signature=JSON.stringify([nameFontVersion,state.density,table.tHead?.querySelector('.ls-officials-heading')?.textContent]);
      const entries=cells.map(cell=>{
        const signature=JSON.stringify([nameFontVersion,state.density,
        [...cell.querySelectorAll('[data-ls-full-name]')].map(node=>node.dataset.lsFullName),
        [...cell.querySelectorAll('.umpire,.service_judge,.tablet,.no_umpire')].map(node=>[node.classList.contains('service_judge')?'serviceJudge':node.classList.contains('umpire')?'umpire':node.classList.contains('tablet')?'tablet':'none',node.classList.contains('no_umpire')?node.textContent:'']),
        [...cell.querySelectorAll('.ls-icon-action,.timer')].map(node=>[node.classList.contains('timer')?'timer':'action',node.hidden,node.style.display,node.style.visibility]),
        ]);
        const previous=officialCellMeasurements.get(cell),cached=previous?.signature===signature?previous:null;
        if(!cached)changedCells.add(cell);
        return {cell,signature,cached};
      });
      const cached=officialMeasurements.get(table);
      jobs.push({table,entries,signature,cached:cached?.signature===signature?cached:null});
    }
    const probes=new Map([...changedCells].map(cell=>[cell,layoutProbe(cell,'ls-officials-measuring')]));
    // Full labels are needed only in measurement copies. The live official
    // retains its abbreviation, nodes and controls throughout measurement.
    for(const [container,group] of nameGroups) {
      const probe=probes.get(group.officialCell);if(!probe)continue;
      if(group.members.some(member=>member.text.parentNode!==member.target))continue;
      group.members.forEach((member,index)=>setNameLabel(probeMember(group.officialCell,probe,member),group.stages[0][index]));dirtyNameGroups.add(container);
    }
    const widths=[];
    try {
      for(const job of jobs) {
        const {table,entries}=job;
        if(!table.getClientRects().length||!table.clientWidth)continue;
        const column=table.querySelector('.ls-officials-column'),heading=table.tHead?.querySelector('.ls-officials-heading');if(!heading)continue;
        let measurement=job.cached;
        if(!measurement) {
          const range=document.createRange();range.selectNodeContents(heading);
          const header=range.getBoundingClientRect().width+horizontalInsets(heading);
          measurement={signature:job.signature,header};officialMeasurements.set(table,measurement);
        }
        const reserved=parseFloat(getComputedStyle(table).getPropertyValue('--score-leading-timer-width'))||0;
        let needed=measurement.header;
        // Leading clocks change the cell padding without changing a name's
        // intrinsic width. Reuse the latter, but read the current reservation.
        for(const entry of entries) {
          const {cell}=entry;
          let content=entry.cached;
          if(!content) {
            const width=Math.max(0,...[...probes.get(cell).children].map(node=>{const style=getComputedStyle(node);return node.getBoundingClientRect().width+(parseFloat(style.marginLeft)||0)+(parseFloat(style.marginRight)||0);}));
            content={signature:entry.signature,width};officialCellMeasurements.set(cell,content);
          }
          needed=Math.max(needed,content.width+horizontalInsets(cell)-reserved);
        }
        widths.push([table,Math.min(Math.ceil(needed),parseFloat(getComputedStyle(column).maxWidth)||280)+'px']);
      }
    } finally {for(const probe of probes.values())removeLayoutProbe(probe);}
    for(const [table,width] of widths)if(table.style.getPropertyValue('--officials-width')!==width)table.style.setProperty('--officials-width',width);
  }
  function bindNameGroup(container,people,targets,suffixes=[]) {
    if(!container||!people.length||targets.length!==people.length)return;
    const stages=nameStages(people),members=targets.map((target,index)=>({target,full:stages[0][index],suffix:suffixes[index]||'',text:[...target.childNodes].find(node=>node.nodeType===3&&node.nodeValue.trim())}));
    if(members.some(member=>!member.text))return;
    for(const member of members) {member.target.dataset.lsFullName=member.full;member.target.setAttribute('aria-label',member.full);}
    nameGroups.set(container,{members,stages,width:null,fits:new Map(),stageWidths:new Map(),readWidth:true,officialCell:container.closest('.umpire_and_tablet')});nameObserver?.observe(container);scheduleNames(container);
  }
  function bindMatchNames(row,match) {
    for(const [index,selector] of ['.team-one','.team-two'].entries()) {
      const team=row.querySelector(selector);if(team)bindNameGroup(team,match.setup.teams[index].players,[...team.querySelectorAll('.player')]);
    }
    const pair=row.querySelector('.operator-pair .name');
    if(pair)bindNameGroup(pair,match.setup.tabletoperators,[...pair.querySelectorAll('.pair-member')],match.setup.tabletoperators.map((_,index)=>index<match.setup.tabletoperators.length-1?' /':''));
    let operatorIndex=0;
    for(const participant of row.querySelectorAll('.umpire_and_tablet .person:not(.operator-pair)')) {
      const person=participant.querySelector('.service_judge')?match.setup.service_judge:participant.querySelector('.umpire')?match.setup.umpire:participant.querySelector('.tablet')?match.setup.tabletoperators?.[operatorIndex++]:null;
      const name=participant.querySelector('.name');if(person&&name)bindNameGroup(participant,[person],[name]);
    }
  }
  function positionBoardSidebar() {
    const sidebar=root?.querySelector('.board-sidebar');if(!sidebar)return;
    headerHeight??=document.querySelector('.toprow')?.offsetHeight||0;
    const top=headerHeight+8,value=top+'px';if(sidebar.style.getPropertyValue('--card-sidebar-top')!==value)sidebar.style.setProperty('--card-sidebar-top',value);
    sidebar.classList.toggle('is-tall',sidebarHeight!==null&&sidebarHeight>window.innerHeight-top-12);
  }
  function cardContent(card) {return card.querySelector(':scope > .card-content')||card;}
  function applyCardHeight(card,zone) {
    const height=state.boardLayout.heights[card.dataset.boardCard],fixed=zone==='sidebar'&&height!=null;
    let content=card.querySelector(':scope > .card-content');
    if(fixed&&!content) {
      content=el(null,'div','card-content');
      for(const child of [...card.children])if(!child.matches('h2,.card-layout-controls,.card-size-controls'))content.append(child);
      card.insertBefore(content,card.querySelector('.card-size-controls'));
    } else if(!fixed&&content)content.replaceWith(...content.childNodes);
    card.classList.toggle('has-fixed-height',fixed);
    if(fixed)card.style.setProperty('--card-height',height+'px');else card.style.removeProperty('--card-height');
    const handle=card.querySelector('.card-resize-handle');
    if(handle) {
      handle.querySelector('span').textContent=height==null?'Höhe ziehen':height+' px';
      handle.setAttribute('aria-valuenow',String(height??Math.max(cardMinHeight,Math.min(cardMaxHeight,Math.round(card.offsetHeight)))));
      handle.setAttribute('aria-valuetext',height==null?'Automatische Höhe':height+' Pixel');
      card.querySelector('[data-action="layout-card-height-auto"]').disabled=height==null;
    }
  }
  function setCardHeight(card,height) {
    const id=card.dataset.boardCard,next=height==null?undefined:Math.max(cardMinHeight,Math.min(cardMaxHeight,Math.round(height)));
    if(state.boardLayout.heights[id]===next)return;
    if(height==null)delete state.boardLayout.heights[id];
    else state.boardLayout.heights[id]=next;
    applyCardHeight(card,'sidebar');
  }
  function finishCardResize(cancel=false) {
    if(!cardResize)return;
    const resize=cardResize;cardResize=null;
    if(cancel)setCardHeight(resize.card,resize.previous);
    resize.card.draggable=state.layoutEditing;
    if(resize.handle.hasPointerCapture(resize.pointerId))resize.handle.releasePointerCapture(resize.pointerId);
    root?.classList.remove('resizing-board-card');
  }
  function applyBoardLayout() {
    const workspace=root?.querySelector('.board-workspace');
    if(!workspace) return;
    const cards=new Map([...workspace.querySelectorAll('[data-board-card]')].map(card=>[card.dataset.boardCard,card]));
    workspace.querySelectorAll('.card-empty-placeholder').forEach(node=>node.remove());
    for(const zone of boardZones) {
      const container=workspace.querySelector(`[data-card-zone="${zone}"]`),ids=state.boardLayout[zone];
      ids.forEach((id,index)=>{
        const card=cards.get(id),definition=boardCards.find(item=>item.id===id);
        if(!card) return;
        card.draggable=state.layoutEditing;
        container.append(card);
        let controls=card.querySelector('.card-layout-controls');
        if(!controls) {controls=document.createElement('div');controls.className='card-layout-controls';card.prepend(controls);}
        controls.hidden=!state.layoutEditing;
        const attrs=`data-card-id="${id}"`;
        const reorder=zone==='hidden'?'':tiny(zone==='top'?'arrowLeft':'arrowUp','layout-card-earlier',definition.label+' vorher platzieren',`${attrs} ${index===0?'disabled':''}`)+tiny(zone==='top'?'arrow':'arrowDown','layout-card-later',definition.label+' danach platzieren',`${attrs} ${index===ids.length-1?'disabled':''}`);
        const zoneButton=button(zone==='top'?'Sidebar':'Oben','layout-card-zone',zone==='top'?'layout':'arrowUp','sm',`${attrs} title="${definition.label} ${zone==='top'?'in die rechte Sidebar':'über die Spiele'} verschieben"`);
        const visibility=zone==='hidden'?button('Sidebar','layout-card-sidebar','layout','sm',`${attrs} title="${definition.label} in die rechte Sidebar verschieben"`):tiny('eyeOff','layout-card-hide',definition.label+' ausblenden',attrs);
        controls.innerHTML=`<span class="card-drag-handle" data-card-drag="${id}" draggable="${state.layoutEditing}" title="${definition.label} ziehen">${icon('grip')}<span>Verschieben</span></span><div class="row">${reorder}${zoneButton}${visibility}</div>`;
        let size=card.querySelector('.card-size-controls');
        if(zone==='sidebar'&&!size) {
          size=el(card,'div','card-size-controls');
          size.innerHTML=`<button type="button" class="card-resize-handle" role="separator" aria-orientation="horizontal" aria-label="Höhe von ${definition.label}" aria-valuemin="${cardMinHeight}" aria-valuemax="${cardMaxHeight}" title="Höhe ziehen oder mit den Pfeiltasten ändern">${icon('grip')}<span>Höhe ziehen</span></button>`+button('Auto','layout-card-height-auto','refresh','sm',`${attrs} title="Automatische Höhe wiederherstellen"`);
        }
        if(size)size.hidden=!state.layoutEditing||zone!=='sidebar';
        applyCardHeight(card,zone);
      });
      container.dataset.cardCount=String(ids.length);
      if(zone==='top')container.style.setProperty('--board-card-columns',ids.map(id=>boardCards.find(card=>card.id===id).width+'fr').join(' '));
      if(!ids.length&&state.layoutEditing) {
        const placeholder=document.createElement('div');placeholder.className='card-empty-placeholder';
        placeholder.innerHTML=zone==='hidden'?`${icon('eyeOff')}<strong>Hier Kacheln zum Ausblenden ablegen</strong><span>Beim nächsten Anpassen lassen sie sich wieder zurückziehen.</span>`:`${icon('plus')}<strong>Kacheln ${zone==='top'?'über den Spielen':'rechts neben den Spielen'}</strong><span>Hier ablegen oder den Bereichsknopf an einer Kachel nutzen.</span>`;
        container.append(placeholder);
      }
    }
    workspace.classList.toggle('layout-editing',state.layoutEditing);
    workspace.classList.toggle('has-card-sidebar',state.layoutEditing||state.boardLayout.sidebar.length>0);
    workspace.querySelector('.board-controls').hidden=!state.layoutEditing&&!state.boardLayout.top.length;
    workspace.querySelector('.board-sidebar').hidden=!state.layoutEditing&&!state.boardLayout.sidebar.length;
    workspace.querySelector('.board-hidden-cards').hidden=!state.layoutEditing;
    workspace.querySelector('.board-sidebar .card-zone-heading').hidden=!state.layoutEditing;
    root.querySelector('[data-layout-editor]').hidden=!state.layoutEditing;
    document.querySelector('.board-toolbar-actions [data-action="layout-edit"]').setAttribute('aria-expanded',String(state.layoutEditing));
    nameLayoutDirty=true;queueNames();
    scheduleNames();
  }
  function moveBoardCard(id,zone,before=null) {
    if(!state.layoutEditing||!boardCards.some(card=>card.id===id)||!boardZones.includes(zone)) return;
    for(const area of boardZones) state.boardLayout[area]=state.boardLayout[area].filter(card=>card!==id);
    const index=before?state.boardLayout[zone].indexOf(before):-1;
    state.boardLayout[zone].splice(index<0?state.boardLayout[zone].length:index,0,id);
    applyBoardLayout();
    document.querySelector(`[data-board-card="${id}"] [data-action="layout-card-zone"]`)?.focus({preventScroll:true});
    toast(`${boardCards.find(card=>card.id===id).label} ${zone==='hidden'?'ausgeblendet.':zone==='top'?'über den Spielen platziert.':'in der rechten Sidebar platziert.'}`);
  }
  function swapBoardCards(source,target) {
    if(!state.layoutEditing||source===target) return;
    const sourceZone=boardZones.find(zone=>state.boardLayout[zone].includes(source));
    const targetZone=boardZones.find(zone=>state.boardLayout[zone].includes(target));
    if(!sourceZone||!targetZone) return;
    const sourceIndex=state.boardLayout[sourceZone].indexOf(source),targetIndex=state.boardLayout[targetZone].indexOf(target);
    state.boardLayout[sourceZone][sourceIndex]=target;
    state.boardLayout[targetZone][targetIndex]=source;
    applyBoardLayout();
    document.querySelector(`[data-board-card="${source}"] [data-action="layout-card-zone"]`)?.focus({preventScroll:true});
    toast(`${boardCards.find(card=>card.id===source).label} und ${boardCards.find(card=>card.id===target).label}: Positionen getauscht.`);
  }
  function clearCardDragState() {
    draggedCard=null;cardDragBlocked=false;
    document.body.classList.remove('dragging-board-card');
    document.querySelectorAll('.card-drag-source,.card-drop-before,.card-drop-after,.card-drop-swap,.card-zone-hover').forEach(node=>node.classList.remove('card-drag-source','card-drop-before','card-drop-after','card-drop-swap','card-zone-hover'));
  }
  function boardCardDrop(event) {
    const container=event.target.closest('[data-card-zone]')||event.target.closest('.board-sidebar,.board-hidden-cards')?.querySelector('[data-card-zone]');
    if(!container) return null;
    const zone=container.dataset.cardZone,card=event.target.closest('[data-board-card]');
    // Dropping in the hidden area always hides the source; it never reveals another card by swapping.
    if(zone==='hidden')return {zone,container,before:null};
    if(card?.dataset.boardCard===draggedCard) return null;
    let before=null,after=false;
    if(card) {
      const rect=card.getBoundingClientRect();
      const horizontal=zone==='top'&&getComputedStyle(container).gridTemplateColumns.split(' ').length>1;
      const position=horizontal?(event.clientX-rect.x)/rect.width:(event.clientY-rect.y)/rect.height;
      if(position>=.25&&position<=.75) return {zone,container,card,swap:card.dataset.boardCard};
      after=position>.5;
      const ids=state.boardLayout[zone].filter(id=>id!==draggedCard),index=ids.indexOf(card.dataset.boardCard);
      before=after?ids[index+1]||null:card.dataset.boardCard;
    }
    return {zone,before,container,card,after};
  }
  function modal(title,build) {
    const opener=document.activeElement,dialog=el(document.body,'dialog','leitstand-dialog');
    const heading=el(dialog,'div','dialog-heading');el(heading,'h2','',title);
    const close=el(heading,'button','btn icon-only','×');close.type='button';close.setAttribute('aria-label','Schließen');
    close.onclick=()=>dialog.close();
    dialog.addEventListener('close',()=>{dialog.remove();if(opener?.isConnected)opener.focus({preventScroll:true});},{once:true});
    const body=el(dialog,'div','dialog-content');build(body,dialog);dialog.showModal();return dialog;
  }
  function sendMessage(message,done) {
    send({...message,tournament_key:model.key},error=>{if(error)return cerror.net(error);if(done)done();});
  }
  function complete(match) {return match?.setup?.teams?.length===2&&match.setup.teams.every(team=>team.players?.length>0);}
  function callCourt(courtId,matchId,done) {
    const court=model.courts.find(item=>String(item._id)===String(courtId)),match=model.matches.find(item=>String(item._id)===String(matchId));
    if(!court?.is_active||!complete(match)||!match.setup.is_match||cmatch.calc_section(match)!=='unassigned'||model.matches.some(item=>cmatch.calc_section(item)==='court_'+court._id)||btp_entry_status.blocked_players(match).length) {
      toast('Feld oder Spiel ist inzwischen nicht mehr verfügbar.');return;
    }
    sendMessage({type:'match_call_on_court',court_id:court._id,match_id:match._id},done);
  }
  function assignCourt(court) {
    modal('Spiel auf Feld '+court.num+' zuweisen',(body,dialog)=>{
      const form=el(body,'form'),label=el(form,'label','','Spiel auswählen'),select=el(label,'select');select.required=true;
      const matches=model.matches.filter(match=>complete(match)&&match.setup.is_match&&cmatch.calc_section(match)==='unassigned'&&!btp_entry_status.blocked_players(match).length);
      for(const match of matches) {const option=el(select,'option','',match.setup.match_num+' · '+match.setup.teams.map(team=>team.players.map(player=>player.name).join(' / ')).join(' v '));option.value=match._id;}
      const submit=el(form,'button','btn attention','Zuweisen');submit.type='submit';submit.disabled=!matches.length;
      if(!matches.length)el(form,'p','','Keine zuweisbaren Spiele vorhanden.');
      form.onsubmit=event=>{event.preventDefault();callCourt(court._id,select.value,()=>dialog.close());};
    });
  }
  function setAttribute(node,name,value) {if(node.getAttribute(name)!==String(value))node.setAttribute(name,String(value));}
  function actionIcon(node,name,label) {
    if(!node)return;if(node.dataset.lsActionIcon!==name) {node.innerHTML=icon(name);node.dataset.lsActionIcon=name;}setAttribute(node,'aria-label',label||node.title||name);
    if(!node.classList.contains('ls-icon-action'))node.classList.add('ls-icon-action');
    if(node.tagName!=='BUTTON'&&node.tagName!=='A') {setAttribute(node,'role','button');setAttribute(node,'tabindex',0);}
  }
  function maxSetCount(tournament=model) {
    const formats=Array.isArray(tournament?.scoring_formats?.formats)?tournament.scoring_formats.formats:[];
    const defaultFormat=formats.find(format=>String(format.id)===String(tournament.scoring_formats.default_id))||formats[0];
    let maximum=0;
    const include=setup=>{
      let count;
      try {count=calc.max_game_count(setup);} catch {count=3;}
      maximum=Math.max(maximum,Number.isInteger(count)&&count>0?count:3);
    };
    for(const event of tournament?.events?.events||[])for(const stage of event.stages||[]) {
      const format=stage.scoring_format==null?defaultFormat:formats.find(item=>String(item.id)===String(stage.scoring_format))||defaultFormat;
      include({scoring_format:format});
    }
    for(const match of tournament?.matches||[]) {
      const setup=match.setup||{};
      include(setup.scoring_format||setup.counting?setup:{scoring_format:defaultFormat});
      if(Array.isArray(match.network_score))maximum=Math.max(maximum,match.network_score.length);
    }
    if(!maximum)include({scoring_format:defaultFormat});
    return maximum;
  }
  function refreshScoreLayout() {
    if(!root?.isConnected)return;
    const count=String(maxSetCount());
    if(root.style.getPropertyValue('--score-set-count')!==count)root.style.setProperty('--score-set-count',count);
    root.dataset.scoreSetCount=count;
  }
  function ensureHead(table,planned=false) {
    if(!table||table.dataset.leitstandHead)return;
    if(!table.parentElement.classList.contains('table-wrap')) {const wrap=el(null,'div','table-wrap');table.replaceWith(wrap);wrap.append(table);}
    const finished=!!table.closest('.finished_container');
    table.classList.toggle('ls-planned-table',planned);
    table.classList.toggle('ls-finished-table',finished);
    table.dataset.leitstandHead='true';let head=table.tHead;if(!head)head=table.createTHead();
    const columns=el(null,'colgroup');
    for(const [index,width] of ['24px',planned?'135px':'49px','28px','36px','50px','42px',null,null,null,null].entries()) {
      if(finished&&index===9)continue;
      const column=el(columns,'col');if(width)column.style.width=width;if(index===7)column.className='ls-officials-column';if(index===8)column.className=planned?'ls-preparation-column':'ls-score-column';if(index===9)column.className='ls-call-column';
      if(finished&&index===3)for(const width of ['50px','42px'])el(columns,'col','ls-play-time-column').style.width=width;
    }
    table.prepend(columns);
    head.innerHTML='<tr><th aria-label="Spiel öffnen"></th><th>'+(planned?'Feld / Ort':'Feld')+'</th><th class="match_num">#</th><th class="match_properties">Plan</th>'+(finished?'<th class="ls-play-time">Beginn</th><th class="ls-play-time">Ende</th>':'')+'<th class="match_discipline">Disziplin</th><th class="match_round">Runde</th><th class="ls-teams">Begegnung</th><th class="ls-officials-heading">Tabletbedienung / Schiedsrichter</th>'+(planned?'<th colspan="2" class="ls-preparation-heading">Vorbereitung</th>':'<th>Ergebnis</th>'+(finished?'':'<th class="right">Aktionen</th>'))+'</tr>';
    if(finished)for(const [index,key] of ['number','plan','start','end'].entries()) {
      const heading=head.rows[0].cells[index+2],label=heading.textContent;
      heading.textContent='';heading.scope='col';heading.setAttribute('aria-sort','none');
      const control=el(heading,'button','ls-time-sort',label);control.type='button';control.dataset.action='finished-sort';control.dataset.sortKey=key;
    }
  }
  const clockCells=new WeakMap();
  function setCellText(node,text) {
    text=String(text??'');if(node.textContent===text)return;
    if(node.childNodes.length===1&&node.firstChild.nodeType===3)node.firstChild.nodeValue=text;
    else node.textContent=text;
  }
  function clockCell(cell,text,title=text,timestamp=null) {
    const tag=timestamp==null?'SPAN':'TIME';
    let view=clockCells.get(cell);
    if(!view||view.clock.parentElement!==cell||view.clock.tagName!==tag) {
      cell.textContent='';view={clock:el(cell,tag.toLowerCase(),'ls-scheduled-time')};clockCells.set(cell,view);
    }
    if(cell.title!==title)cell.title=title;
    const {clock}=view;
    if(timestamp!=null) {const value=new Date(timestamp).toISOString();if(clock.dateTime!==value)clock.dateTime=value;}
    const parts=/^(\d{1,2}):(\d{2})$/.exec(text);
    if(view.format!==!!parts) {
      clock.textContent='';clock.classList.toggle('is-clock',!!parts);view.format=!!parts;
      if(parts) {view.hours=el(clock,'span','ls-time-hours');el(clock,'span','ls-time-colon',':');view.minutes=el(clock,'span','ls-time-minutes');}
    }
    if(parts) {
      setCellText(view.hours,parts[1]);setCellText(view.minutes,parts[2]);
    } else setCellText(clock,text);
  }
  function matchTimes(match) {
    const timestamp=value=>{const number=Number(value);return Number.isFinite(number)&&number>0&&number<=8.64e15?number:null;};
    const end=timestamp(match.end_ts)??timestamp(match.setup?.end_ts);
    let start=null,hasHistory=false;
    if(!match.presses_deferred&&Array.isArray(match.presses)&&match.presses.length) {
      try {
        const history={presses:match.presses};calc.undo(history);
        hasHistory=true;
        start=timestamp(history.flattened_presses.find(press=>press.type==='love-all'&&timestamp(press.timestamp)!=null)?.timestamp);
      } catch { /* Older or partial histories can still have a saved duration. */ }
    }
    const duration=Number(match.duration_ms);
    if(!hasHistory&&start==null&&end!=null&&Number.isFinite(duration)&&duration>0)start=timestamp(end-duration);
    if(start!=null&&end!=null&&start>end)start=null;
    return {start,end};
  }
  const calendarDays=new Map(),calendarZones=new Map(),dateHeaders=new WeakMap(),dateViews=new WeakMap(),finishedRowTimes=new WeakMap();
  const calendarLabel=new Intl.DateTimeFormat('de-DE',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'});
  function calendarDay(value) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
    if(calendarDays.has(value))return calendarDays.get(value);
    const date=new Date(value+'T12:00:00Z');
    const result=Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?{key:value,label:calendarLabel.format(date)}:null;
    if(calendarDays.size>=512)calendarDays.delete(calendarDays.keys().next().value);
    calendarDays.set(value,result);return result;
  }
  function timestampDay(timestamp,timeZone) {
    if(timestamp==null)return null;
    let format=calendarZones.get(timeZone);
    if(!format) {
      try {format=new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});}
      catch {format=new Intl.DateTimeFormat('en',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});}
      calendarZones.set(timeZone,format);
    }
    const parts=Object.fromEntries(format.formatToParts(timestamp).map(part=>[part.type,part.value]));
    return calendarDay(parts.year+'-'+parts.month+'-'+parts.day);
  }
  function matchDay(match,{finished=false,key='end',timeZone='Europe/Berlin',times}={}) {
    const planned=calendarDay(match.setup?.scheduled_date);
    if(!finished)return planned;
    if(key==='plan'&&planned)return planned;
    times??=matchTimes(match);
    const timestamp=(key==='start'?times.start:times.end)??times.end??times.start;
    return timestampDay(timestamp,timeZone)??planned;
  }
  function dateView(container) {
    let view=dateViews.get(container);
    if(!view){view={expanded:new Map(),searchExpanded:new Map()};dateViews.set(container,view);}
    const query=searchControl?.value.trim()||'';
    if(view.query!==query){view.query=query;view.searchExpanded.clear();}
    return view;
  }
  function refreshDateGroups(container,byId) {
    if(!active(container))return;
    byId??=new Map(model.matches.map(match=>[String(match._id),match]));
    const finished=container.classList.contains('finished_container'),view=dateView(container),tables=[];
    let defaultDay;
    // Include filtered-out games when choosing the default day. A search opens
    // its matching days temporarily without changing the user's own choices.
    for(const table of container.querySelectorAll('.match_table'))for(const body of table.tBodies) {
      const entries=[];
      for(const row of body.children) {
        if(row.dataset.match_id==null)continue;
        const match=byId.get(row.dataset.match_id);if(!match)continue;
        const day=matchDay(match,{finished,key:state.finishedSort.key,timeZone:model.system_timezone||'Europe/Berlin',times:finished?finishedRowTimes.get(row):undefined});
        const key=day?.key||'';entries.push({row,day,key});
        if(key&&!row.classList.contains('do_not_show')&&(defaultDay==null||(finished?key>defaultDay:key<defaultDay)))defaultDay=key;
      }
      tables.push({table,body,entries});
    }
    for(const {table,body,entries} of tables) {
      let headers=dateHeaders.get(body);if(!headers){headers=new Map();dateHeaders.set(body,headers);}
      const groups=[],members=new Map(),byRowId=new Map(),choices=view.query?view.searchExpanded:view.expanded;let previous;
      for(const entry of entries) {
        const {row,day,key}=entry,expanded=choices.get(key)??(!!view.query||!key||key===defaultDay);
        row.classList.toggle('ls-date-collapsed',!expanded);byRowId.set(row.dataset.match_id,row);
        if(row.hidden||row.classList.contains('do_not_show'))continue;
        if(!row.id)row.id='ls-'+(finished?'finished-':'planned-')+encodeURIComponent(row.dataset.match_id);
        if(!members.has(key))members.set(key,[]);members.get(key).push(row.id);
        if(key!==previous)groups.push({row,day,key});previous=key;
      }
      const used=new Set(),span=table.tHead?[...table.tHead.rows[0].cells].reduce((sum,cell)=>sum+cell.colSpan,0):0;
      for(const {row,day,key} of groups) {
        // A known date stays visible even when sorting/filtering leaves just
        // one day. Lists with no recorded dates retain their ordinary rows.
        if(!day&&members.size===1&&!choices.has(key))continue;
        const id=row.dataset.match_id;used.add(id);
        let header=headers.get(id);
        if(!header) {header=el(null,'tr','ls-date-row');headers.set(id,header);}
        if(!header.firstChild||header.dataset.date!==key) {
          header.replaceChildren();header.dataset.date=key;
          const cell=el(header,'th'),toggle=el(cell,'button','ls-date-toggle');toggle.type='button';toggle.dataset.action='date-toggle';
          const label=el(toggle,'span','ls-date-label');label.innerHTML=icon('chevron')+icon('calendar');label.firstChild.classList.add('ls-date-chevron');
          const text=el(label,day?'time':'span','',day?.label||'Datum nicht erfasst');if(day)text.dateTime=key;
        }
        const toggle=header.querySelector('button'),expanded=!row.classList.contains('ls-date-collapsed');
        setAttribute(toggle,'aria-expanded',expanded);setAttribute(toggle,'aria-controls',members.get(key).join(' '));
        setAttribute(toggle,'aria-label',(day?.label||'Datum nicht erfasst')+' · Spiele '+(expanded?'einklappen':'ausklappen'));
        if(header.firstChild.colSpan!==span)header.firstChild.colSpan=span;
        if(row.previousElementSibling!==header)row.before(header);
      }
      for(const [id,header] of headers)if(!used.has(id)){header.remove();headers.delete(id);}
      for(const boundary of body.querySelectorAll('.ls-call-boundary')) {
        const row=byRowId.get(boundary.dataset.matchId);
        boundary.hidden=!row||row.hidden||row.classList.contains('do_not_show');
        boundary.classList.toggle('ls-date-collapsed',!!row?.classList.contains('ls-date-collapsed'));
        if(row&&row.nextElementSibling!==boundary)row.after(boundary);
      }
    }
  }
  function sortFinishedMatches(matches,key,direction) {
    // Compute effective start times once per match, including any undo/redo history.
    const entries=matches.map(match=>{
      let value;
      if(key==='number')value=String(match.setup?.match_num??'').trim()||null;
      else if(key==='plan') {
        const time=/^(\d{1,2}):(\d{2})$/.exec(match.setup?.scheduled_time_str||'');
        const date=/^\d{4}-\d{2}-\d{2}$/.test(match.setup?.scheduled_date||'')?match.setup.scheduled_date:'';
        value=time&&Number(time[1])<24&&Number(time[2])<60?date+'T'+time[1].padStart(2,'0')+':'+time[2]:null;
      } else value=matchTimes(match)[key];
      return {match,value};
    });
    entries.sort((a,b)=>{
      if(a.value==null&&b.value!=null)return 1;
      if(b.value==null&&a.value!=null)return -1;
      const order=a.value===b.value?0:key==='number'?a.value.localeCompare(b.value,'de',{numeric:true}):a.value<b.value?-1:1;
      return order*direction||String(a.match.setup?.match_num??'').localeCompare(String(b.match.setup?.match_num??''),'de',{numeric:true})||String(a.match._id).localeCompare(String(b.match._id),'de',{numeric:true});
    });
    return entries.map(entry=>entry.match);
  }
  function sortFinishedTables() {
    if(!root?.isConnected)return;
    root.querySelectorAll('.finished_container .match_table').forEach(table=>ensureHead(table));
    const {key,direction}=state.finishedSort,byId=new Map(model.matches.map(match=>[String(match._id),match]));
    for(const table of root.querySelectorAll('.ls-finished-table')) {
      finishedShuttles(table,byId);
      for(const control of table.querySelectorAll('.ls-time-sort')) {
        const selected=control.dataset.sortKey===key,heading=control.closest('th');
        heading.setAttribute('aria-sort',selected?(direction===1?'ascending':'descending'):'none');
        control.title='Nach '+({number:'Spielnummer',plan:'geplanter Zeit',start:'Spielbeginn',end:'Spielende'}[control.dataset.sortKey])+' '+(selected&&direction===1?'absteigend':'aufsteigend')+' sortieren';
        control.setAttribute('aria-label',control.title);
      }
      for(const body of table.tBodies) {
        const rows=new Map([...body.rows].filter(row=>row.dataset.match_id!=null).map(row=>[row.dataset.match_id,row]));
        const matches=[...rows.keys()].map(id=>byId.get(id)).filter(Boolean);
        const nextMatch=node=>{while(node&&node.dataset.match_id==null)node=node.nextElementSibling;return node;};
        let before=nextMatch(body.firstElementChild);
        for(const match of sortFinishedMatches(matches,key,direction)) {
          const row=rows.get(String(match._id));if(row!==before)body.insertBefore(row,before);before=nextMatch(row.nextElementSibling);
        }
      }
    }
    root.querySelectorAll('.finished_container').forEach(matchListCount);
  }
  function finishedShuttles(table,byId) {
    const rows=[...table.querySelectorAll('tbody>tr[data-match_id]')];
    const count=row=>{const value=Number(byId.get(row.dataset.match_id)?.shuttle_count);return Number.isFinite(value)&&value>0?value:null;};
    const shown=rows.some(row=>count(row)!=null);
    if(!shown) {
      table.querySelectorAll('.ls-shuttle-column,th.ls-shuttle-count,td.match_shuttle_count').forEach(node=>node.remove());
      return;
    }
    if(!table.querySelector('.ls-shuttle-column'))el(table.querySelector('colgroup'),'col','ls-shuttle-column').style.width='36px';
    if(!table.tHead.querySelector('.ls-shuttle-count'))el(table.tHead.rows[0],'th','ls-shuttle-count','Bälle').scope='col';
    for(const row of rows) {
      const cell=row.querySelector('td.match_shuttle_count')||el(row,'td','match_shuttle_count');
      cell.classList.add('ls-shuttle-count');cell.dataset.match_id=row.dataset.match_id;
      const number=cell.querySelector('.match_shuttle_count_number')||el(cell,'span','match_shuttle_count_number');number.dataset.match_id=row.dataset.match_id;
      const value=count(row);number.textContent=value==null?'—':String(value);cell.title=value==null?'Nicht gezählt':'Gezählte Bälle: '+value;
      cell.classList.toggle('match_shuttle_count_display_active',value!=null);
      if(cell!==row.lastElementChild)row.append(cell);
    }
  }
  function refreshFinished() {
    if(!root?.isConnected)return;
    if(finishedSortPending){finishedComplete?.claim();return;}
    finishedSortPending=true;const mountedRoot=root,done=finishedComplete=trackUpdate('finished.sort');
    queueMicrotask(()=>{finishedComplete=null;try {done.run(()=>{finishedSortPending=false;if(root===mountedRoot)sortFinishedTables();});} finally {done();}});
  }
  const finishedTimeFormats=new Map();
  function updateFinishedTimes(row,match) {
    if(!row.closest('.finished_container'))return;
    const zone=model.system_timezone||'Europe/Berlin';
    let formats=finishedTimeFormats.get(zone);
    if(!formats) {
      let timeZone=zone;
      try {new Intl.DateTimeFormat('de-DE',{timeZone});}catch {timeZone='Europe/Berlin';}
      formats={time:new Intl.DateTimeFormat('de-DE',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),
        date:new Intl.DateTimeFormat('de-DE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'short'})};
      finishedTimeFormats.set(zone,formats);
    }
    const times=matchTimes(match);
    finishedRowTimes.set(row,times);
    for(const [key,label] of [['start','Spielbeginn'],['end','Spielende']]) {
      const cell=row.querySelector('.ls-play-'+key);if(!cell)continue;
      const value=times[key];clockCell(cell,value==null?'—':formats.time.format(value),label+': '+(value==null?'nicht erfasst':formats.date.format(value)),value);
    }
  }
  function replaceCell(cell,className) {
    if(!cell)return null;const span=el(null,'span',className||cell.className);
    for(const attr of cell.attributes)if(!['colspan','rowspan','class'].includes(attr.name))span.setAttribute(attr.name,attr.value);
    span.append(...cell.childNodes);cell.replaceWith(span);return span;
  }
  function score(node,text=node.textContent) {
    if(!active(node))return false;
    text=String(text||'');
    let view=scoreViews.get(node);
    if(view?.text===text&&view.first===node.firstChild)return true;
    const sets=text.trim().split(/\s+[·]?\s*|\s*·\s*/).filter(Boolean);
    if(!sets.length||!sets.every(value=>/^\d+:\d+$/.test(value))) {
      if(node.textContent!==text)node.textContent=text;
      if(node.getAttribute('aria-label')!==text)node.setAttribute('aria-label',text);
      scoreViews.set(node,{text,first:node.firstChild});return true;
    }
    if(!view?.sets||view.first!==node.firstChild) {node.replaceChildren();view={sets:[]};}
    if(!node.classList.contains('ls-scoreline'))node.classList.add('ls-scoreline');
    for(const [index,value] of sets.entries()) {
      let set=view.sets[index];
      if(!set) {
        const frame=el(node,'span','ls-set-score'),home=el(frame,'span','score-home',''),colon=el(frame,'span','score-colon',':'),away=el(frame,'span','score-away','');
        home.append(document.createTextNode(''));away.append(document.createTextNode(''));
        set={frame,home:home.firstChild,away:away.firstChild,colon};view.sets.push(set);
      }
      const points=value.split(':');
      if(set.home.nodeValue!==points[0])set.home.nodeValue=points[0];
      if(set.away.nodeValue!==points[1])set.away.nodeValue=points[1];
    }
    while(view.sets.length>sets.length)view.sets.pop().frame.remove();
    if(node.getAttribute('aria-label')!==text)node.setAttribute('aria-label',text);
    view.text=text;view.first=node.firstChild;scoreViews.set(node,view);return true;
  }
  function timerDisplay(node,value) {
    if(!active(node))return false;
    const previous=node.querySelector('.timer-value')?.textContent;
    let text=String(value);if(/^\d+$/.test(text)){const seconds=Number(text);text=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');}
    let sign=node.querySelector('.timer-sign'),digits=node.querySelector('.timer-digits');
    if(sign&&digits&&previous===text)return true;
    if(!sign||!digits) {node.innerHTML=icon('clock');const time=el(node,'span','timer-value');sign=el(time,'span','timer-sign');digits=el(time,'span','timer-digits');}
    const negative=text.startsWith('-'),signText=negative?'-':'';if(sign.textContent!==signText)sign.textContent=signText;
    const parts=(negative?text.slice(1):text).split(/(\d+)/).filter(Boolean);
    const existing=[...digits.childNodes];
    if(existing.length===parts.length&&parts.every((part,index)=>/^\d+$/.test(part)?existing[index].nodeType===1:existing[index].nodeType===3)) {
      // Preserve text nodes too, avoiding child-list notifications and
      // unnecessary style work for every running clock.
      parts.forEach((part,index)=>{const text=existing[index].nodeType===3?existing[index]:existing[index].firstChild;if(text.nodeValue!==part)text.nodeValue=part;});
    } else digits.replaceChildren(...parts.map(part=>/^\d+$/.test(part)?el(null,'span','timer-number',part):document.createTextNode(part)));
    if(node.getAttribute('role')!=='timer')node.setAttribute('role','timer');node.setAttribute('aria-label',text);
    const time=digits.parentElement;
    const positiveLong=!negative&&text.length>4;if(time.classList.contains('timer-positive-long')!==positiveLong)time.classList.toggle('timer-positive-long',positiveLong);
    if(!timerValues.has(time)) {timerValues.add(time);timerObserver?.observe(time);}
    // Segment digits have equal advance widths. Only the form changes the
    // fitting; retain the deliberately narrower gap before a leading one.
    const form=(negative?'-':'')+(digits.textContent.startsWith('1')?'1:':'0:')+digits.textContent.replace(/\d/g,'0');
    if(timerForms.get(time)!==form) {timerForms.set(time,form);scheduleTimers(time);}
    return true;
  }
  function measureTimer(time) {
    if(!time.isConnected||!active(time)) {timerObserver?.unobserve(time);timerValues.delete(time);return null;}
    const cached=timerMeasurements.get(time);if(cached)return cached;
    // ResizeObserver has already read the layout. A new clock waits for its
    // first observation instead of forcing the entire table to reflow here.
    const box=timerBoxes.get(time)||(timerObserver?null:time.getBoundingClientRect());if(!box)return null;
    const available=box.width;if(!available)return null;
    const computed=getComputedStyle(time),style={};
    for(const key of ['fontSize','letterSpacing','fontStyle','fontWeight','fontFamily'])style[key]=computed[key];
    const measurement={time,available,height:box.height,style};timerMeasurements.set(time,measurement);return measurement;
  }
  function pruneTimers() {
    for(const time of timerValues)if(!time.isConnected) {timerObserver?.unobserve(time);timerValues.delete(time);dirtyTimers.delete(time);}
  }
  function fitTimer({time,available,style}) {
    // Keep the compact frame; long positive values can use the empty sign slot.
    // Measure the unscaled font on canvas, avoiding repeated DOM reflows for
    // every running clock. Read layout once, then write the fitted properties.
    const digits=time.querySelector('.timer-digits'),sign=time.querySelector('.timer-sign');
    const key=JSON.stringify([available,style,timerForms.get(time)]);
    const cached=timerFittings.get(key);
    if(cached) {applyTimerFit(time,cached);return;}
    const size=parseFloat(style.fontSize),spacing=parseFloat(style.letterSpacing)||0;
    timerMeasure??=document.createElement('canvas').getContext('2d');
    timerMeasure.font=[style.fontStyle,style.fontWeight,style.fontSize,style.fontFamily].join(' ');
    const width=text=>timerMeasure.measureText(text).width+spacing*text.length;
    let inset=0;
    if(digits.textContent.startsWith('1')) {
      const one=timerMeasure.measureText('1');
      // Reclaim only empty space before the first stroke, leaving a small gap.
      inset=Math.max(0,Math.min(one.width/2,-one.actualBoundingBoxLeft-size*.05));
    }
    let scale=1,signWidth=0;
    const natural=width(digits.textContent)-inset;
    if(sign.textContent&&digits.textContent.length>4) {
      // Scale the minus slot with long values instead of keeping a full-size gap.
      signWidth=width(sign.textContent);
      scale=Math.min(1,available/(signWidth+natural));
    } else {
      if(sign.textContent)scale=Math.min(scale,available/5/width(sign.textContent));
      if(natural>0)scale=Math.min(scale,available*(time.classList.contains('timer-positive-long')?1:.8)/natural);
    }
    const fitted=Math.max(.001,Math.floor(scale*1000)/1000);
    const fit=[['--timer-scale',fitted<1?fitted+'em':''],['--timer-leading-inset',inset?inset/size+'em':''],['--timer-sign-width',signWidth?signWidth*fitted+'px':'']];
    if(timerFittings.size>=512)timerFittings.delete(timerFittings.keys().next().value);
    timerFittings.set(key,fit);applyTimerFit(time,fit);
  }
  function applyTimerFit(time,fit) {
    for(const [property,value] of fit) {
      if(time.style.getPropertyValue(property)===value)continue;
      if(value)time.style.setProperty(property,value);else time.style.removeProperty(property);
    }
  }
  function scheduleTimers(changed) {
    if(changed)dirtyTimers.add(changed);else {timerFittings.clear();for(const time of timerValues) {timerMeasurements.delete(time);dirtyTimers.add(time);}}
    if(!root?.isConnected)return;
    timerComplete?.claim();if(timerFrame!==null)return;
    const done=timerComplete ||= trackUpdate('timers.fit');timerFrame=requestAnimationFrame(()=>{
      timerFrame=null;try {done.run(()=>{
      pruneTimers();
      // Read all clock sizes before writing fitted styles. Native timer ticks
      // otherwise force a new page layout once per clock before a point paints.
      const measurements=[];
      for(const time of dirtyTimers) {
        const measurement=measureTimer(time);
        if(measurement)measurements.push(measurement);
        if(measurement||!timerValues.has(time)||timerBoxes.has(time)||!timerObserver)dirtyTimers.delete(time);
      }
      for(const measurement of measurements)fitTimer(measurement);
      });} catch(error) {timerComplete=null;done();throw error;}
      // Keep the same owned job pending for first observations. Its next run
      // is scheduled by ResizeObserver; the receipt still waits for fitting.
      if(!dirtyTimers.size) {timerComplete=null;done();}
    });
  }
  function timerVisibilityChanged(node) {
    if(active(node)&&node.closest('.player'))scheduleNames(node);
  }
  function fontsChanged() {nameFontVersion++;scheduleNames();scheduleTimers();}
  function groupTabletOperators(row,match) {
    const people=match.setup.tabletoperators||[],container=row.querySelector('.tablet_operator .operators');
    if(!container||people.length<2||model.tabletoperator_split_doubles||container.querySelector('.operator-pair'))return;
    const show=row.dataset.style==='unasigned';
    container.textContent='';const checked=people.every(person=>person.checked_in),person=el(container,'span','person operator-pair '+(show?(checked?'checked_in':'not_checked_in'):'no_status'));
    el(person,'span','tablet').innerHTML=icon('tablet');const name=el(person,'span','name');
    people.forEach((value,index)=>{el(name,'span','pair-member',(value.name||[value.firstname,value.lastname||value.surname].filter(Boolean).join(' '))+(index<people.length-1?' /':''));if(index<people.length-1)name.append(document.createTextNode(' '));});
    name.title='Tabletbedienung als Paarung · '+(checked?'Gemeinsam auschecken':'Gemeinsam einchecken');
    if(row.dataset.style==='unasigned'&&people.every(value=>value.btp_id!=null&&Number(value.btp_id)>=0)) {
      name.classList.add('person_status_target');name.setAttribute('role','button');name.tabIndex=0;name.setAttribute('aria-pressed',String(checked));
      name.onclick=event=>{event.stopPropagation();sendMessage({type:'match_participant_check_in',match_id:match._id,role:'tabletoperator',participant_ids:people.map(value=>value.btp_id),checked_in:!checked});};
    }
  }
  function decorateControls(row) {
    row.querySelectorAll('.timer').forEach(node=>{if(!node.querySelector('.timer-value'))timerDisplay(node,node.textContent);});
    const selectors=[['.match_second_call_button,.match_second_preparation_call_button','bell'],['.match_preparation_call_button','mic'],['.match_manual_call_button','speaker'],['.match_begin_to_play_button','play']];
    for(const [selector,name] of selectors)row.querySelectorAll(selector).forEach(node=>actionIcon(node,name));
    row.querySelectorAll('.match_preparation_call_button[data-location_id]').forEach(node=>{const place=model.locations.find(location=>String(location._id)===String(node.dataset.location_id));if(place){const short=place.short_name||place.name?.slice(0,3)||'';if(node.dataset.locationShortName!==short)node.dataset.locationShortName=short;const caption=node.querySelector('.ls-call-location')||el(node,'span','ls-call-location');if(caption.textContent!==short)caption.textContent=short;if(caption.dataset.location_id!==node.dataset.location_id)caption.dataset.location_id=node.dataset.location_id;if(place.name&&!node.title.includes(place.name))node.title+=' · '+place.name;setAttribute(node,'aria-label',node.title);}});
    row.querySelectorAll('.umpire_and_tablet .umpire,.umpire_and_tablet .service_judge,.umpire_and_tablet .tablet,.no_umpire').forEach(node=>{
      const name=node.classList.contains('service_judge')?'serviceJudge':node.classList.contains('umpire')?'umpire':node.classList.contains('tablet')?'tablet':'people';
      if(!node.classList.contains('ls-role-icon')){node.innerHTML=icon(name);node.classList.add('ls-role-icon');}setAttribute(node,'aria-label',name==='umpire'?'Schiedsrichter':name==='serviceJudge'?'Aufschlagrichter':name==='tablet'?'Tabletbedienung':'Offizielle zuweisen');
    });
    row.querySelectorAll('.person_status_target,.player.can_check_in,.player.can_check_out').forEach(node=>{setAttribute(node,'tabindex',0);setAttribute(node,'role','button');});
    row.querySelectorAll('.match_confirm_button').forEach(node=>{for(const name of ['btn','success'])if(!node.classList.contains(name))node.classList.add(name);if(node.textContent!=='✓ Bestätigen')node.textContent='✓ Bestätigen';setAttribute(node,'role','button');setAttribute(node,'tabindex',0);});
    row.querySelectorAll('.preparation_debug_icon').forEach(node=>{if(!node.dataset.lsInfo)node.innerHTML=icon('info');setAttribute(node,'role','button');setAttribute(node,'tabindex',0);setAttribute(node,'aria-label','Aufrufstatus anzeigen');if(!node.dataset.lsInfo){node.dataset.lsInfo='true';node.onclick=()=>modal('Aufrufstatus',body=>el(body,'pre','call-status-details',node.title));}});
    if(row.closest('.ls-planned-table')) {
      const calls=row.querySelector('td.call_td'),buttons=[...calls.querySelectorAll('.match_preparation_call_button')];
      let group=calls.querySelector('.ls-preparation-calls');
      if(buttons.length&&!group) {group=el(null,'span','ls-preparation-calls');calls.insertBefore(group,buttons[0]);}
      if(group)for(const node of buttons)if(node.parentElement!==group)group.append(node);
    }
  }
  function preparationLayout(table) {
    let width=92;
    for(const calls of table.querySelectorAll('.ls-preparation-calls')) {
      const row=calls.closest('tr');if(row?.hidden||row?.classList.contains('do_not_show')||row?.classList.contains('ls-date-collapsed'))continue;
      const key=JSON.stringify([nameFontVersion,state.density,[...calls.children].map(node=>[node.className,node.textContent,node.hidden,node.style.display])]);
      let content=preparationWidths.get(key);
      if(content==null) {
        content=calls.getBoundingClientRect().width;
        if(content) {if(preparationWidths.size>=512)preparationWidths.delete(preparationWidths.keys().next().value);preparationWidths.set(key,content);}
      }
      width=Math.max(width,Math.ceil(content+38-80));
    }
    if(table.style.getPropertyValue('--preparation-width')!==width+'px')table.style.setProperty('--preparation-width',width+'px');
  }
  function matchListCount(container) {
    refreshDateGroups(container);
    const heading=container.querySelector(':scope>h3,:scope>.ls-unassigned-heading>h3');if(!heading)return;
    const finished=container.classList.contains('finished_container');
    if(finished&&heading.firstChild?.nodeType===3&&heading.firstChild.data!=='Beendete Spiele')heading.firstChild.data='Beendete Spiele';
    const rows=[...container.querySelectorAll('.match_table>tbody>tr[data-match_id]')],visible=rows.filter(row=>!row.hidden&&!row.classList.contains('do_not_show')).length;
    const attribute=finished?'data-finished-count':'data-unassigned-count';
    const count=heading.querySelector('['+attribute+']')||el(heading,'span','title-count');setAttribute(count,attribute,'');
    const text=' '+(visible===rows.length?rows.length:visible+' von '+rows.length);
    if(count.textContent!==text)count.textContent=text;
  }
  function preparationBoundaryReasons(selection) {
    const cutoff=model.matches.find(match=>String(match._id)===String(selection.display_cutoff_match_id));
    if(!cutoff)return [];
    const diagnostics=selection.diagnostics_by_match_id||{};
    const next=model.matches.filter(match=>diagnostics[String(match._id)]&&cmatch.cmp_match_order(match,cutoff)>0).sort(cmatch.cmp_match_order)[0];
    if(!next)return [];
    const labels={
      frontier_block_limit:['Blockregel','Block','Blöcke'],
      frontier_time_limit:['Zeitregel','Minute','Minuten'],
      frontier_match_limit:['Spielanzahlregel','Spiel','Spiele'],
      time_before_scheduled:['Startzeitregel','Minute','Minuten'],
    };
    // The first game beyond this cutoff identifies the limiting rules.
    // Read limits from the server snapshot rather than newer local settings.
    const rules=diagnostics[String(next._id)].rules;
    return (Array.isArray(rules)?rules:[])
      .filter(rule=>rule&&rule.enabled!==false&&rule.passed===false&&labels[rule.key])
      .map(rule=>{
        const [label,singular,plural]=labels[rule.key],detail=String(rule.detail||'');
        const limit=/\b(?:von|Limit) (\d+(?:\.\d+)?)/.exec(detail)?.[1];
        const reference=/nach Frontier-Spiel #(.+)$/.exec(detail)?.[1];
        if(limit!=null) {
          const amount=Number(limit),quantity=amount.toLocaleString('de-DE')+' '+(amount===1?singular:plural);
          if(rule.key==='time_before_scheduled')return label+': frühestens '+quantity+' vor Spielbeginn';
          if(reference!=null)return label+': '+quantity+' nach Spiel '+reference;
        }
        return label+(detail?': '+detail.replace(/Frontier-Spiel #/g,'Spiel '):'');
      });
  }
  function relativeLuminance(color) {
    const rgb=String(color).match(/[\d.]+/g)?.slice(0,3);if(rgb?.length!==3)return null;
    const linear=rgb.map(value=>{const channel=Number(value)/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;});
    return linear[0]*.2126+linear[1]*.7152+linear[2]*.0722;
  }
  function refreshBoundaryLayout() {
    if(!root?.isConnected)return;
    const ink=relativeLuminance(getComputedStyle(root).color);
    for(const table of root.querySelectorAll('.ls-planned-table:has(.ls-call-boundary)')) {
      const heading=table.tHead?.querySelector('.ls-teams');if(!heading||!table.clientWidth)continue;
      const teams=heading.getBoundingClientRect(),box=table.getBoundingClientRect();
      for(const [property,value] of [['--boundary-left',teams.left-box.left],['--boundary-width',teams.width]]) {
        const width=value+'px';if(table.style.getPropertyValue(property)!==width)table.style.setProperty(property,width);
      }
      for(const cell of table.querySelectorAll('.ls-call-boundary>td')) {
        const background=relativeLuminance(getComputedStyle(cell).backgroundColor);
        const darkContrast=background!=null&&ink!=null?(Math.max(background,ink)+.05)/(Math.min(background,ink)+.05):0;
        const whiteContrast=background!=null?1.05/(background+.05):1;
        const color=darkContrast>whiteContrast?'var(--ink)':'#fff';
        if(cell.style.getPropertyValue('--boundary-ink')!==color)cell.style.setProperty('--boundary-ink',color);
      }
    }
  }
  function refreshUnassigned(container,{controlsChanged=true}={}) {
    if(!active(container))return;
    let changed=controlsChanged;
    const boundaries=new Map([...container.querySelectorAll('.ls-call-boundary')].map(node=>[node.dataset.matchId,node]));
    const selections=Object.entries(model.location_preparation_selection_by_location_id||{})
      .filter(([,selection])=>selection?.display_cutoff_match_id!=null)
      .map(([id,selection])=>({id,selection,location:model.locations.find(place=>String(place._id)===id)}));
    const differentCutoffs=new Set(selections.map(({selection})=>String(selection.display_cutoff_match_id))).size>1;
    for(const row of container.querySelectorAll('tr.preparation_call_cutoff[data-match_id]')) {
      const entries=selections.filter(({selection})=>String(selection.display_cutoff_match_id)===row.dataset.match_id);
      const reasons=entries.map(({id,selection,location})=>{
          const text=preparationBoundaryReasons(selection).join('; ');
          return text&&model.locations.length>1?(location?.short_name||location?.name||id)+': '+text:text;
        }).filter(Boolean);
      const label='Aufrufgrenze · Spiel '+row.querySelector('.match_num').textContent+(reasons.length?' · '+reasons.join(' | '):'');
      let boundary=boundaries.get(row.dataset.match_id);boundaries.delete(row.dataset.match_id);
      if(!boundary) {
        boundary=el(null,'tr','ls-call-boundary');boundary.dataset.matchId=row.dataset.match_id;const cell=el(boundary,'td');cell.colSpan=10;
        const explanation=el(cell,'span','ls-call-boundary-label');explanation.innerHTML=icon('info');el(explanation,'span');changed=true;
      }
      const cell=boundary.firstElementChild,highlight=Number(entries[0]?.location?.highlight);
      const color=differentCutoffs&&entries.length===1&&Number.isInteger(highlight)&&highlight>=1&&highlight<=6?'highlight_'+highlight:'';
      if(cell.className!==color){cell.className=color;changed=true;}
      const text=cell.querySelector('.ls-call-boundary-label>span');if(text.textContent!==label){text.textContent=label;changed=true;}
      if(row.nextElementSibling!==boundary){row.after(boundary);changed=true;}
    }
    for(const boundary of boundaries.values()){boundary.remove();changed=true;}
    matchListCount(container);
    let heading=container.querySelector(':scope>.ls-unassigned-heading');
    const title=container.querySelector(':scope>h3');
    if(!heading&&title) {heading=el(null,'div','ls-unassigned-heading');title.replaceWith(heading);heading.append(title);changed=true;}
    const debug=container.querySelector('.preparation_frontier_debug');
    if(debug) {
      let details=debug.closest('details');
      if(!details) {details=el(null,'details','board-hints');el(details,'summary','','Vorbereitungsdetails');debug.replaceWith(details);details.append(debug);changed=true;}
      if(heading&&details.parentElement!==heading){heading.append(details);changed=true;}
    }
    // Preparation controls need their own geometry, without restoring and
    // re-measuring every official's name after each point/selection response.
    if(changed){preparationLayoutDirty=true;queueNames();}
  }
  function player(node) {
    if(!active(node))return;
    const badge=node.previousElementSibling;if(badge?.classList.contains('btp_entry_status_badge'))node.append(badge);
    for(const hint of node.querySelectorAll('.court,.tablet_inline,.tabletoperator_waiting_inline')) {
      if(hint.classList.contains('ls-resource-hint'))continue;
      const waiting=hint.classList.contains('tabletoperator_waiting_inline'),playing=hint.classList.contains('court'),court=hint.textContent.trim();
      hint.innerHTML=playing?'':icon('tablet')+(waiting?icon('clock'):'');
      if(!waiting)el(hint,'span','ls-resource-court',court);
      hint.classList.add('ls-resource-hint');hint.setAttribute('role','img');
      hint.title=waiting?'Wartet auf Tabletbedienung':(playing?'Spielt auf Feld ':'Tabletbedienung auf Feld ')+court;
      hint.setAttribute('aria-label',hint.title);
    }
    if(node.classList.contains('can_check_in')||node.classList.contains('can_check_out')) {node.tabIndex=0;node.setAttribute('role','button');}
    else {node.removeAttribute('tabindex');node.removeAttribute('role');}
    scheduleNames(node);
  }
  function filterRow(row) {
    if(row.classList.contains('ls-location-row')||row.classList.contains('ls-date-row')||row.classList.contains('ls-call-boundary'))return;
    const query=searchControl?.value.toLocaleLowerCase('de').trim()||'';
    const names=[...row.querySelectorAll('[data-ls-full-name]')].map(node=>node.dataset.lsFullName).join(' ');
    row.hidden=!!query&&!(row.textContent+' '+names).toLocaleLowerCase('de').includes(query);
  }
  function matchRowView(row) {
    let view=rowViews.get(row);
    if(!view) {
      const scoreNode=row.querySelector('.match_score');
      view={scoreNode,calls:row.querySelector('td.call_td'),timer:row.querySelector('.match_timer'),scoreCell:scoreNode?.closest('td.score'),finished:!!row.closest('.finished_container'),current:!!row.closest('.courts_container'),
        number:row.querySelector('td.match_num'),plan:row.querySelector('td.match_properties'),discipline:row.querySelector('td.match_discipline'),round:row.querySelector('td.match_round'),open:row.querySelector('.ls-match-open')};
      rowViews.set(row,view);
    }
    return view;
  }
  function updateScore(match,targets,changes={}) {
    if(!root?.isConnected)return;
    if((match.network_score?.length||0)>Number(root.style.getPropertyValue('--score-set-count')))refreshScoreLayout();
    const rows=targets?targets.filter(node=>node.tagName==='TR'&&active(node)):root.querySelectorAll('tr[data-match_id="'+CSS.escape(String(match._id))+'"]');
    for(const row of rows) {
      const view=matchRowView(row),{scoreNode,calls,timer,scoreCell}=view;
      if(scoreNode&&!changes.score)score(scoreNode,cmatch.calc_score_str(match));
      if(view.finished) {
        const times=matchTimes(match),signature=JSON.stringify([times.start,times.end,match.shuttle_count]);
        if(view.times!==signature) {view.times=signature;updateFinishedTimes(row,match);refreshFinished();}
        if(changes.confirmation)row.querySelectorAll('.match_confirm_button').forEach(button=>button.remove());
      }
      if(calls) {
        if(changes.confirmation||!view.initialized) {
          const confirmation=timer?.querySelector('.match_confirm_button')||calls.querySelector('.match_confirm_button');
          if(confirmation&&match.btp_winner===undefined) {
            if(confirmation.parentElement!==calls)calls.append(confirmation);
            confirmation.classList.add('btn','success');confirmation.textContent='✓ Bestätigen';confirmation.setAttribute('role','button');confirmation.tabIndex=0;
          } else confirmation?.remove();
          const pending=!!(confirmation&&match.btp_winner===undefined);
          if(row.classList.contains('ls-result-pending')!==pending)row.classList.toggle('ls-result-pending',pending);
        }
        if(changes.timer||!view.initialized)view.clock=timer?.querySelector('.timer');
        const sets=match.network_score||[],clock=view.clock;
        const finalSet=!!(clock&&view.current&&clock.style.display!=='none'&&sets.some(points=>points.some(point=>point>0))&&sets.length===maxSetCount({scoring_formats:model.scoring_formats,matches:[match]}));
        if(row.classList.contains('ls-timer-in-actions')!==finalSet)row.classList.toggle('ls-timer-in-actions',finalSet);
        const target=finalSet?calls:scoreCell;
        if(timer&&target&&timer.parentElement!==target)target.append(timer);
      }
      view.initialized=true;
      if(searchControl?.value.trim()) {const hidden=row.hidden;filterRow(row);if(hidden!==row.hidden)scheduleCounts();}
    }
  }
  function updateMatchMetadata(row,match,fields) {
    if(!active(row))return false;
    const view=matchRowView(row),setup=match.setup;
    if(fields.includes('match_num')) {
      if(view.number)setCellText(view.number,setup.match_num);
      if(view.open) {view.open.title='Spiel '+setup.match_num+' öffnen';view.open.setAttribute('aria-label',view.open.title);}
    }
    if(fields.includes('scheduled_time_str')&&view.plan)clockCell(view.plan,String(setup.scheduled_time_str||''));
    for(const [field,cell] of [['event_name',view.discipline],['match_name',view.round]])if(fields.includes(field)&&cell) {
      setCellText(cell,setup[field]);if(cell.title!==cell.textContent)cell.title=cell.textContent;
    }
    if(fields.includes('scheduled_date'))scheduleCounts();
    const hidden=row.hidden;filterRow(row);if(row.hidden!==hidden)scheduleCounts();
    return true;
  }
  function row(tr,match,style) {
    if(!active(tr)||!['plain','default','unasigned'].includes(style))return;
    const planned=style==='unasigned',finished=!!tr.closest('.finished_container');ensureHead(tr.closest('table'),planned);tr.classList.add('ls-match');
    if(!planned&&!finished)tr.classList.remove('ls-date-collapsed');
    tr.dataset.state=match.setup.state||'';tr.classList.toggle('ls-preparation',match.setup.state==='preparation');
    tr.classList.remove('ls-empty');
    const tools=tr.querySelector('td.actions');
    if(tools&&!tools.querySelector('.ls-match-open')) {
      const old=el(null,'span','ls-native-tools');old.hidden=true;old.append(...tools.childNodes);tools.append(old);
      const open=el(tools,'button','btn icon-only ls-match-open');open.type='button';open.innerHTML=icon('more');open.title='Spiel '+match.setup.match_num+' öffnen';open.setAttribute('aria-label',open.title);
      open.onclick=()=>{dialogOpener=open;old.querySelector('.match_edit_button')?.click();};
    }
    const property=tr.querySelector('.match_properties');
    if(property) {
      clockCell(property,String(match.setup.scheduled_time_str||''));
      let previous=property;
      for(const [className,value] of [['match_discipline',match.setup.event_name],['match_round',match.setup.match_name]]) {
        const cell=tr.querySelector('td.'+className)||el(null,'td',className);
        cell.textContent=value||'';cell.title=cell.textContent;cell.classList.toggle('incomplete',property.classList.contains('incomplete'));
        previous.after(cell);previous=cell;
      }
      if(finished) {
        const cells=['start','end'].map(key=>tr.querySelector('.ls-play-'+key)||el(null,'td','ls-play-time ls-play-'+key));
        property.after(...cells);
      }
    }
    const first=tr.querySelector('td.match_team1,td.match_team_won'),versus=tr.querySelector('td.match_vs'),second=tr.querySelector('td.match_team2');
    if(first&&versus&&second) {
      const cell=el(null,'td','ls-teams');tr.insertBefore(cell,first);const line=el(cell,'div','versus-line');
      line.append(replaceCell(first,first.className+' team-one'),replaceCell(versus,'vs'),replaceCell(second,second.className+' team-two'));
    }
    const scoreCell=tr.querySelector('td.score'),timerCell=tr.querySelector('td.match_timer'),shuttles=tr.querySelector('td.match_shuttle_count');
    if(shuttles&&finished)tr.append(shuttles);
    else if(shuttles&&property) {const count=replaceCell(shuttles);property.append(count);}
    if(timerCell&&scoreCell) {const timer=replaceCell(timerCell);scoreCell.append(timer);}
    const location=model.locations.find(place=>String(place._id)===String(match.setup.location_id));
    if(planned) {
      const cell=tr.querySelector('td.court_number'),place=cell?.querySelector('.location');
      if(place) {
        const name=location?.name||location?.short_name||place.title,highlight=Number(location?.highlight);
        place.textContent='';place.title=name;
        const swatch=el(place,'span','ls-location-swatch'+(highlight>=1&&highlight<=6?' highlight_'+highlight:''));
        swatch.setAttribute('aria-hidden','true');
        if(!(highlight>=1&&highlight<=6))swatch.style.setProperty('--hall','#dce5e3');
        place.append(document.createTextNode(name));
      } else if(cell&&!cell.hasChildNodes())cell.textContent='—';
    }
    if(finished)tr.querySelector('td.call_td')?.remove();
    rowViews.delete(tr);
    groupTabletOperators(tr,match);bindMatchNames(tr,match);tr.querySelectorAll('.player').forEach(player);decorateControls(tr);updateScore(match,[tr],{timer:true,confirmation:true});filterRow(tr);scheduleCounts();
  }
  function emptyRow(tr,court,style) {
    if(!active(tr)||style==='public')return;
    rowViews.delete(tr);
    tr.classList.remove('ls-match','ls-preparation','ls-result-pending','ls-timer-in-actions','ls-date-collapsed');tr.classList.add('ls-empty');tr.classList.toggle('ls-inactive',!court.is_active);tr.dataset.state=court.is_active?'vacant':'inactive';
    ensureHead(tr.closest('table'));const target=tr.querySelector('td.empty_element');
    const marker=tr.querySelector('td.actions');if(marker)marker.innerHTML=court.is_active?icon('plus'):'';
    if(target) {target.colSpan=7;target.textContent='';el(target,'strong','',court.is_active?'Feld frei · Spiel zuweisen':'Feld gesperrt');el(target,'span','drop-instruction',court.is_active?'Spiel hierher ziehen oder „Zuweisen“ wählen.':'Für den Spielbetrieb deaktiviert.');}
    const calls=el(tr,'td','call_td'),assign=el(calls,'button','btn attention','＋ Zuweisen');assign.type='button';assign.disabled=!court.is_active;assign.onclick=()=>assignCourt(court);
    filterRow(tr);scheduleCounts();
  }
  function scheduleCounts() {
    if(countsPending){countsComplete?.claim();return;}
    countsPending=true;const done=countsComplete=trackUpdate('lists.counts');
    queueMicrotask(()=>{countsComplete=null;try {done.run(()=>{countsPending=false;refreshCounts();});} finally {done();}});
  }
  function courtGroups() {
    const table=root?.querySelector('.courts_container .match_table');if(!table)return;
    const rows=[...table.querySelectorAll('.court_row')],groups=new Map(),headings=new Map([...table.querySelectorAll('.ls-location-row')].map(row=>[row.dataset.courtGroup,row]));
    for(const location of model.locations)groups.set(String(location._id),[]);
    for(const row of rows) {
      const id=String(row.dataset.location_id??'undefined');
      if(!groups.has(id))groups.set(id,[]);groups.get(id).push(row);
    }
    const body=table.tBodies[0];if(!body)return;
    let previous=null;
    const place=node=>{const next=previous?previous.nextElementSibling:body.firstElementChild;if(node!==next)body.insertBefore(node,next);previous=node;};
    for(const [id,courts] of groups) {
      if(!courts.length)continue;
      const location=model.locations.find(item=>String(item._id)===id),name=location?.name||location?.short_name||'Felder ohne Halle';
      let heading=headings.get(id);
      if(!heading) {
        heading=el(null,'tr','ls-location-row');heading.dataset.courtGroup=id;
        const cell=el(heading,'th');cell.colSpan=10;
        const toggle=el(cell,'button','ls-location-toggle');toggle.type='button';
        const label=el(toggle,'span','ls-location-label');label.innerHTML=icon('chevron');el(label,'span','ls-location-name');
        toggle.onclick=()=>{
          const input=document.getElementById('show_location_courts_'+id);
          if(input)input.click();
          else {const shown=toggle.getAttribute('aria-expanded')!=='true';writeStorage('show_location_courts_'+id,String(shown));for(const row of courts)row.classList.toggle('do_not_show',!shown);refreshCounts();scheduleNames();}
        };
      }
      headings.delete(id);
      const singleLocation=model.locations.length<=1,input=document.getElementById('show_location_courts_'+id);
      if(singleLocation&&input&&!input.checked) {
        input.checked=true;writeStorage('show_location_courts_'+id,'true');cmatch.update_tables(id,true);
        queueMicrotask(()=>{if(root?.isConnected)cmatch.refresh_unassigned_preparation_context();});
      }
      const highlight=Number(location?.highlight),shown=input?.checked??readStorage('show_location_courts_'+id)!=='false';
      heading.className='ls-location-row'+(highlight>=1&&highlight<=6?' highlight_'+highlight:'');heading.hidden=singleLocation;
      const toggle=heading.querySelector('button'),label=heading.querySelector('.ls-location-name');
      if(label.textContent!==name)label.textContent=name;
      toggle.setAttribute('aria-expanded',String(shown));toggle.setAttribute('aria-label',name+' · Felder '+(shown?'ausblenden':'anzeigen'));toggle.title=shown?'Felder einklappen':'Felder ausklappen';
      for(const row of courts) {if(!row.id)row.id='ls-court-'+row.dataset.court_id;row.classList.toggle('do_not_show',!shown);}
      toggle.setAttribute('aria-controls',courts.map(row=>row.id).join(' '));
      place(heading);for(const row of courts)place(row);
    }
    for(const heading of headings.values())heading.remove();
  }
  function refreshCounts() {
    if(!root)return;const counts=root.querySelector('[data-field-counts]');if(!counts)return;
    sortFinishedTables();
    refreshTablets();
    courtGroups();refreshScoreLayout();nameLayoutDirty=true;queueNames();root.querySelectorAll('.unassigned_container').forEach(matchListCount);
    const courts=model.courts.filter(court=>readStorage('show_location_courts_'+court.location_id)!=='false');
    const occupied=new Set(model.matches.filter(match=>match.setup?.now_on_court&&match.setup?.court_id).map(match=>String(match.setup.court_id)));
    const busy=courts.filter(court=>occupied.has(String(court._id))).length;
    const free=courts.filter(court=>court.is_active&&!occupied.has(String(court._id))).length;
    counts.innerHTML='';for(const [text,kind]of [[courts.length+' Felder',''],[busy+' belegt',''],[free+' freie Felder','attention']])el(counts,'span','badge '+kind,text);
  }
  function refreshOperators() {
    if(!root)return;const card=root.querySelector('[data-board-card="operators"]'),operators=root.querySelector('.unassigned_tableoperators_container');
    const content=card&&cardContent(card);if(content&&operators&&operators.parentElement!==content)content.append(operators);
    const empty=card?.querySelector('.card-empty-message');if(empty)empty.hidden=!!operators;
    operatorQueue(operators);
  }
  function logMatches(entry) {
    return (entry.time+' - '+entry.message).toLocaleLowerCase('de').includes(state.logFilter.trim().toLocaleLowerCase('de'));
  }
  function compareLogs(a,b) {return (a.timestamp-b.timestamp||a.id-b.id)*state.logSort;}
  function logRow(entry) {
    let node=logView.rows.get(entry.id);
    if(!node) {
      node=el(null,'div','ls-log-entry');node.dataset.logId=entry.id;
      const time=el(node,'time','ls-log-time',entry.time);time.dateTime=new Date(entry.timestamp).toISOString();time.title=new Date(entry.timestamp).toLocaleString('de');
      node.append(' - ');el(node,'span','ls-log-message',entry.message);logView.rows.set(entry.id,node);
    }
    return node;
  }
  function logStatus() {
    const view=logView;if(!view)return;
    view.count.textContent=state.logFilter.trim()?view.visible.length+'/'+view.total:String(view.total);
    view.count.title=view.visible.length+' von '+view.total+' Meldungen';
    view.empty.hidden=view.visible.length>0;view.empty.textContent=view.total?'Keine passenden Meldungen.':'Noch keine Meldungen.';
    view.clear.disabled=view.total===0;
    const ascending=state.logSort===1;
    if(view.sort.dataset.direction!==String(state.logSort)) {
      view.sort.dataset.direction=state.logSort;view.sort.innerHTML=icon(ascending?'arrowUp':'arrowDown')+'Uhrzeit';
      view.sort.title=ascending?'Älteste zuerst · zu neuesten zuerst wechseln':'Neueste zuerst · zu ältesten zuerst wechseln';
      view.sort.setAttribute('aria-label','Nach Uhrzeit '+(ascending?'absteigend':'aufsteigend')+' sortieren');
    }
  }
  function refreshLogs(change) {
    const view=logView;if(!view||!root?.isConnected)return;
    if(change?.type==='add') {
      view.total++;
      if(logMatches(change.entry)) {
        let low=0,high=view.visible.length;
        while(low<high) {const middle=(low+high)>>>1;if(compareLogs(view.visible[middle],change.entry)<0)low=middle+1;else high=middle;}
        const next=view.visible[low];view.list.insertBefore(logRow(change.entry),next?view.rows.get(next.id):null);view.visible.splice(low,0,change.entry);
      }
    } else {
      const entries=cerror.entries();view.total=entries.length;
      if(change?.type==='clear')view.rows.clear();
      view.visible=entries.filter(logMatches).sort(compareLogs);
      const visibleIds=new Set(view.visible.map(entry=>entry.id));
      for(const node of [...view.list.children])if(!visibleIds.has(Number(node.dataset.logId)))node.remove();
      let before=view.list.firstChild;
      for(const entry of view.visible) {const node=logRow(entry);if(node!==before)view.list.insertBefore(node,before);before=node.nextSibling;}
    }
    logStatus();
  }
  function mountLogs(card,errors) {
    if(errors)card.append(errors);
    const toolbar=el(null,'div','ls-log-controls');card.insertBefore(toolbar,errors||null);
    const filter=el(toolbar,'input','ls-log-filter');filter.type='search';filter.placeholder='Meldungen filtern …';filter.setAttribute('aria-label','Logdaten filtern');filter.value=state.logFilter;
    const controls=el(toolbar,'div','ls-log-actions');controls.innerHTML=button('Uhrzeit','logs-sort','arrowDown','sm')+button('Leeren','logs-clear','close','sm','title="Alle Meldungen in dieser Browseransicht leeren"');
    const list=errors?.querySelector('.errors')||el(el(card,'div','errors_scroll_left'),'div','errors');list.replaceChildren();
    const count=el(card.querySelector('h2'),'span','operator-count');count.dataset.logCount='';
    logView={list,count,filter,sort:controls.querySelector('[data-action="logs-sort"]'),clear:controls.querySelector('[data-action="logs-clear"]'),empty:el(card,'p','card-empty-message','Noch keine Meldungen.'),rows:new Map(),visible:[],total:0};
    filter.oninput=()=>{state.logFilter=filter.value;refreshLogs();};
    unsubscribeLogs=cerror.subscribe(refreshLogs);refreshLogs();
  }
  function tabletDevices(tournament,sort={key:'court',direction:1}) {
    const profiles=new Map((tournament.displaysettings||[]).map(profile=>[String(profile.id),profile]));
    const courts=new Map((tournament.courts||[]).map(court=>[String(court._id),court]));
    const locations=new Map((tournament.locations||[]).map(location=>[String(location._id),location]));
    const ipAddress=value=>{
      const address=typeof value==='string'?value.trim().replace(/^::ffff:/i,''):'';
      if(/^(\d{1,3}\.){3}\d{1,3}$/.test(address)&&address.split('.').every(part=>Number(part)<=255))return address;
      return address.includes(':')&&/^[\da-f:.]+$/i.test(address)?address:'';
    };
    const seen=new Set(),devices=[];
    for(const display of tournament.displays||[]) {
      if(!display?.online||display.client_id==null)continue;
      const id=String(display.client_id),profile=profiles.get(String(display.displaysetting_id));
      if(id==='deleted'||seen.has(id)||(profile?.devicemode||display.panel_devicemode)!=='umpire')continue;
      seen.add(id);
      const court=display.court_id!=null&&display.court_id!==''?courts.get(String(display.court_id)):null;
      const location=court?locations.get(String(court.location_id)):null;
      const host=String(display.hostname||'').trim(),ip=ipAddress(display.client_ip)||ipAddress(display.ip)||ipAddress(host);
      const level=display.battery?.level;
      const known=typeof level==='number'&&Number.isFinite(level)&&level>=0&&level<=1;
      const percent=known?Math.round(level*100):null;
      devices.push({id,hostname:host&&host!=='N/N'&&!ipAddress(host)?host:'Tablet '+id,ip,
        courtNumber:court?.num!=null&&String(court.num)!==''?String(court.num):null,
        location:location?.name||'',locationShort:location?.short_name||location?.name||'',
        level:known?level:null,percent,charging:display.battery?.charging===true,
        status:percent==null?'unknown':percent<=10?'critical':percent<=25?'low':'normal'});
    }
    const compare=(a,b)=>String(a).localeCompare(String(b),'de',{numeric:true});
    const courtOrder=(a,b)=>a.courtNumber==null&&b.courtNumber!=null?1:b.courtNumber==null&&a.courtNumber!=null?-1:compare(a.courtNumber??'',b.courtNumber??'')||compare(a.location,b.location);
    const key=sort.key==='battery'?'battery':'court',direction=sort.direction===-1?-1:1;
    return devices.sort((a,b)=>{
      const left=key==='battery'?a.level:a.courtNumber,right=key==='battery'?b.level:b.courtNumber;
      if(left==null&&right!=null)return 1;if(right==null&&left!=null)return -1;
      const order=left===right?0:key==='battery'?left-right:compare(left,right);
      return order*direction||courtOrder(a,b)||compare(a.hostname,b.hostname)||compare(a.id,b.id);
    });
  }
  function refreshTablets() {
    if(!root?.isConnected)return;
    const card=root.querySelector('[data-board-card="tablets"]');if(!card)return;
    let list=card.querySelector('.ls-tablet-list');
    if(!list) {
      list=el(cardContent(card),'div','ls-tablet-list');
      list.innerHTML='<table class="ls-tablet-table"><colgroup><col class="ls-tablet-field-column"><col><col class="ls-tablet-battery-column"></colgroup><thead><tr><th scope="col" aria-sort="none"><button type="button" class="ls-tablet-sort" data-action="tablets-sort" data-sort-key="court">Feld</button></th><th scope="col">Gerät</th><th scope="col" aria-sort="none"><button type="button" class="ls-tablet-sort" data-action="tablets-sort" data-sort-key="battery">Akku</button></th></tr></thead><tbody></tbody></table>';
    }
    const devices=tabletDevices(model,state.tabletSort),heading=card.querySelector('h2');
    const count=heading.querySelector('[data-tablet-count]')||el(heading,'span','operator-count');count.dataset.tabletCount='';count.textContent=devices.length;count.title=devices.length+' verbundene Tablets';
    for(const control of list.querySelectorAll('.ls-tablet-sort')) {
      const selected=control.dataset.sortKey===state.tabletSort.key,direction=selected&&state.tabletSort.direction===1?'absteigend':'aufsteigend';
      control.closest('th').setAttribute('aria-sort',selected?(state.tabletSort.direction===1?'ascending':'descending'):'none');
      control.title='Nach '+(control.dataset.sortKey==='battery'?'Akkustand':'Feld')+' '+direction+' sortieren';control.setAttribute('aria-label',control.title);
    }
    const body=list.querySelector('tbody'),rows=new Map([...body.querySelectorAll('tr[data-tablet-client-id]')].map(row=>[row.dataset.tabletClientId,row]));
    if(devices.length)body.querySelector('.ls-tablet-empty')?.remove();
    let before=body.firstElementChild;
    for(const device of devices) {
      const row=rows.get(device.id)||el(null,'tr');rows.delete(device.id);row.dataset.tabletClientId=device.id;
      const multipleLocations=(model.locations?.length||0)>1,signature=JSON.stringify([device,multipleLocations]);
      if(tabletSignatures.get(row)!==signature) {
        row.replaceChildren();
        const field=el(row,'td','ls-tablet-court');field.title=device.courtNumber==null?'Keinem Feld zugeordnet':[device.location,'Feld '+device.courtNumber].filter(Boolean).join(' · ');
        if(device.courtNumber==null)el(field,'span','','—');
        else {
          const graphic=el(field,'span','ls-tablet-field',device.courtNumber);graphic.setAttribute('role','img');graphic.setAttribute('aria-label',field.title);
          if(multipleLocations&&device.locationShort)el(field,'small','ls-tablet-location',device.locationShort);
        }
        const name=el(row,'td','ls-tablet-device');el(name,'span','ls-tablet-host',device.hostname).title=device.hostname;
        if(device.ip)el(name,'small','ls-tablet-ip',device.ip).title=device.ip;
        const cell=el(row,'td','ls-tablet-charge'),battery=el(cell,'span','ls-tablet-battery is-'+device.status);
        const label=(device.percent==null?'Akkustand nicht verfügbar':'Akku: '+device.percent+' Prozent')+(device.charging?' · wird geladen':'');
        battery.setAttribute('role','img');battery.setAttribute('aria-label',label);battery.title=label;battery.innerHTML=icon('battery');
        if(device.percent!=null) {
          const fill=document.createElementNS('http://www.w3.org/2000/svg','rect');
          for(const [key,value] of Object.entries({x:4,y:8,width:14*device.percent/100,height:8,rx:1,fill:'currentColor',stroke:'none'}))fill.setAttribute(key,String(value));
          battery.querySelector('svg').prepend(fill);
        }
        el(battery,'span','ls-tablet-percent',device.percent==null?'—':device.percent+'%');
        if(device.charging) {const bolt=el(battery,'span','ls-tablet-charging');bolt.innerHTML=icon('bolt');bolt.setAttribute('aria-hidden','true');}
        tabletSignatures.set(row,signature);
      }
      if(row!==before)body.insertBefore(row,before);before=row.nextElementSibling;
    }
    for(const row of rows.values())row.remove();
    if(!devices.length&&!body.querySelector('.ls-tablet-empty'))el(el(body,'tr','ls-tablet-empty'),'td','card-empty-message','Keine Tablets verbunden.').colSpan=3;
  }
  function operatorQueue(container) {
    if(!active(container))return;
    const rows=[...container.querySelectorAll('.tabletoperators_table tbody>tr')];
    for(const row of rows) {
      row.cells[2]?.classList.add('operator-up');row.cells[3]?.classList.add('operator-down');row.cells[4]?.classList.add('operator-remove');
      const names=row.querySelector('.operators');if(names)names.title=names.textContent.replace(/\u200B/g,'').replace(/\s*\/\s*/g,' / ').trim();
    }
    const heading=container.closest('[data-board-card="operators"]')?.querySelector('h2');
    if(heading) {const count=heading.querySelector('.operator-count')||el(heading,'span','operator-count');count.textContent=rows.length;count.title=rows.length+' Einträge in der Warteliste';}
    container.querySelector('.tabletoperator_add_custom_input')?.style.removeProperty('width');
    for(const [selector,name,label]of [['.tabletoperator_move_up_button','arrowUp'],['.tabletoperator_move_down_button','arrowDown'],['.tabletoperator_remove_button','close'],['.tabletoperator_add_custom_button','plus','Tabletbediener hinzufügen']])container.querySelectorAll(selector).forEach(node=>{actionIcon(node,name,label);if(label)node.title=label;node.classList.add('btn','icon-only');});
    container.querySelectorAll('.tablet').forEach(node=>{node.style.backgroundImage='none';node.innerHTML=icon('tablet');});
  }
  function rotationIcons(container) {
    if(!container)return;
    for(const node of container.querySelectorAll('.official_card_icon,.official_card_trail_icon,.official_queue_role_icon')) {
      const service=node.classList.contains('service_judge');
      node.style.backgroundImage='none';node.innerHTML=icon(service?'serviceJudge':'umpire');
      node.setAttribute('role','img');node.setAttribute('aria-label',service?'Aufschlagrichter':'Schiedsrichter');
    }
    for(const timer of container.querySelectorAll('.timer'))timerDisplay(timer,timer.getAttribute('aria-label')||timer.textContent);
  }
  function serviceStatuses() {
    for(const badge of document.querySelectorAll('.toprow_right .toprow_service_badge')){
      if(badge.parentElement.classList.contains('board-service-status'))continue;
      const label=badge.previousElementSibling;if(!label?.matches('.status_label,.btp_status_label,.ticker_status_label,.speech_output_status_label'))continue;
      const control=badge.nextElementSibling?.matches('.toprow_btp_sync_button')?badge.nextElementSibling:null;
      const group=el(null,'span','board-service-status');group.dataset.service=badge.classList.contains('btp_status_badge')?'btp':badge.classList.contains('ticker_status_badge')?'ticker':badge.classList.contains('speech_output_status_badge')?'speech':'bts';
      label.before(group);group.append(label,badge);if(control)group.append(control);
    }
  }
  function sizeBtpStatus(badge) {
    const configured=Number(model.btp_autofetch_timeout_intervall);
    const seconds=Number.isFinite(configured)&&configured>0?Math.ceil(configured):30;
    const minutes=seconds>99,digits=minutes?String(Math.floor(seconds/60)).length+2:String(seconds).length;
    const key=[nameFontVersion,btpFontVersion,minutes,digits].join('|');
    if(badge.dataset.btpSizeKey===key)return;
    const style=getComputedStyle(badge),font=`${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const context=document.createElement('canvas').getContext('2d');
    if(!context)return;
    context.font=font;
    const digitWidth=Math.max(...Array.from('0123456789',digit=>context.measureText(digit).width));
    const clockWidth=Math.ceil(digits*digitWidth+context.measureText(minutes?':':' s').width);
    const statusWidth=Math.ceil(Math.max(context.measureText('in').width+2+clockWidth,...['wartet','Fehler','läuft','aktiv'].map(value=>context.measureText(value).width)));
    badge.style.setProperty('--btp-clock-width',clockWidth+'px');
    badge.style.setProperty('--btp-status-width',statusWidth+'px');
    badge.dataset.btpSizeKey=key;
  }
  function btpSync() {
    if(!root?.isConnected||!actions.syncBtp)return;
    serviceStatuses();
    const badge=document.querySelector('.toprow_right .btp_status_badge');if(!badge)return;
    let control=document.querySelector('.toprow_btp_sync_button');
    if(!model.btp_enabled){
      control?.remove();badge.style.removeProperty('--btp-clock-width');badge.style.removeProperty('--btp-status-width');delete badge.dataset.btpSizeKey;return;
    }
    sizeBtpStatus(badge);
    if(!control){
      control=el(null,'button','toprow_btp_sync_button');control.type='button';control.innerHTML=icon('refresh');badge.before(control);
      control.setAttribute('aria-label','BTP jetzt synchronisieren');control.onclick=()=>actions.syncBtp();
    }
    if(control.nextElementSibling!==badge)badge.before(control);
    control.disabled=!!model.btp_status?.fetch_in_progress;
    control.title=control.disabled?'BTP-Synchronisierung läuft':'BTP jetzt synchronisieren';
  }
  function deviceLocations() {
    if(!root)return;const announcements=root.querySelector('.location_announcements_controls'),courts=root.querySelector('.location_courts_controls');
    if(!announcements||!courts)return;
    announcements.querySelector('h3')?.remove();courts.querySelector('h3')?.remove();
    const old=announcements.querySelector('.device-location-table');if(old)return;
    const table=el(null,'table','device-location-table');table.setAttribute('aria-label','Spielorte und Ansagen auf diesem Gerät');
    table.innerHTML='<thead><tr><th>Spielort</th><th>Spielaufrufe</th><th>Vorbereitung</th></tr></thead>';const body=el(table,'tbody');
    for(const location of model.locations) {
      const line=el(body,'tr'),name=el(line,'th','',location.name||location.short_name||location._id);name.scope='row';name.dataset.locationNeedLabel=location._id;
      for(const [prefix,label]of [['enable_announcement_calls_','Spielaufrufe abspielen'],['enable_announcement_preparations_','Vorbereitungsaufrufe abspielen']]) {
        const input=document.getElementById(prefix+location._id),cell=el(line,'td'),wrapper=el(cell,'label','device-location-option');
        if(input) {input.setAttribute('aria-label',(location.name||location._id)+' · '+label);wrapper.title=input.getAttribute('aria-label');const oldForm=input.closest('form');wrapper.append(input);oldForm?.remove();}
      }
    }
    announcements.prepend(table);courts.hidden=true;
    const footer=el(announcements,'div','device-audio-footer'),summary=el(footer,'div','device-audio-summary');
    const free=announcements.querySelector('form:not(.announcement_speech_check_form)'),output=announcements.querySelector('.local_speech_playback_status'),check=announcements.querySelector('.announcement_speech_check_form');
    if(free)summary.append(free);if(output)summary.append(output);if(check)footer.append(check);
    announcements.querySelector('.local_speech_playback_status')?.setAttribute('title',announcements.querySelector('.local_speech_playback_status').textContent);
  }
  function automation(container) {
    if(!active(container))return;
    const orbit=container.querySelector('.automation_orbit'),center=orbit?.querySelector('.automation_center_toggle');if(!orbit||!center)return;
    center.classList.add('btn');center.innerHTML=icon(model.automation_enabled!==false?'play':'pause')+'<span>'+(model.automation_enabled!==false?'Automatik aktiv':'Automatik pausiert')+'</span>'+icon(model.automation_enabled!==false?'pause':'play');
    orbit.prepend(center);const parts=el(orbit,'div','automation-parts');
    for(const [selector,name,label]of [['.automation_outer_top','people','Rotation'],['.automation_outer_right','mic','Vorbereitung'],['.automation_outer_bottom','court','Feldaufruf'],['.automation_outer_left','tablet','Tablet']]) {
      const control=orbit.querySelector(selector);if(!control)continue;parts.append(control);control.innerHTML=icon(name)+'<span>'+label+'</span>';control.setAttribute('aria-pressed',String(control.classList.contains('is-active')));
    }
  }
  function restoreDialogFocus() {if(dialogOpener?.isConnected)dialogOpener.focus({preventScroll:true});}
  function matchDialog(dialog,match,renderSheet) {
    if(!root?.isConnected||dialog.querySelector('.ls-dialog-tabs'))return;
    const title=dialog.querySelector('h3'),form=dialog.querySelector('form');if(!form)return;
    dialog.classList.add('ls-match-dialog');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
    if(title){
      title.textContent='Spiel '+match.setup.match_num;title.id='ls-match-dialog-title';dialog.setAttribute('aria-labelledby',title.id);
      const heading=el(null,'div','ls-dialog-heading');title.replaceWith(heading);heading.append(title);
      const close=el(heading,'button','ls-dialog-close','×');close.type='button';close.setAttribute('aria-label','Spiel schließen');
      close.onclick=()=>form.querySelector('.match_edit_actions button:last-child')?.click();
    }
    const tabs=el(null,'div','ls-dialog-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Spielbereiche');dialog.insertBefore(tabs,form);
    const edit=el(null,'section','ls-edit-panel');form.replaceWith(edit);edit.append(form);
    const sheet=el(dialog,'section','ls-sheet-panel'),raw=el(dialog,'section','ls-raw-panel');
    const panels=[edit,sheet,raw],labels=['Bearbeiten','Schiedsrichterzettel','Rohdaten'];
    const select=index=>{
      panels.forEach((panel,i)=>{panel.hidden=i!==index;const tab=tabs.children[i];tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;});
      if(index===1&&!sheet.dataset.loaded){sheet.dataset.loaded='true';renderSheet(sheet);}
      if(index===2&&!raw.dataset.loaded){raw.dataset.loaded='true';el(raw,'pre','',JSON.stringify(match,null,2));const link=el(raw,'a','','Rohdaten separat öffnen');link.href='/h/'+encodeURIComponent(model.key)+'/m/'+encodeURIComponent(match._id)+'/info';link.target='_blank';link.rel='noopener';}
    };
    labels.forEach((label,index)=>{
      const tab=el(tabs,'button','',label);tab.type='button';tab.setAttribute('role','tab');tab.id='ls-match-tab-'+index;tab.setAttribute('aria-controls','ls-match-panel-'+index);
      panels[index].id='ls-match-panel-'+index;panels[index].setAttribute('role','tabpanel');panels[index].setAttribute('aria-labelledby',tab.id);
      if(index===1&&!complete(match)){tab.disabled=true;tab.title='Beide Teams müssen feststehen.';}
      tab.onclick=()=>select(index);
    });
    tabs.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const enabled=[...tabs.children].filter(tab=>!tab.disabled),current=enabled.indexOf(document.activeElement);const next=event.key==='Home'?0:event.key==='End'?enabled.length-1:(current+(event.key==='ArrowRight'?1:-1)+enabled.length)%enabled.length;enabled[next].click();enabled[next].focus();};
    dialog.addEventListener('keydown',event=>{if(event.key!=='Tab')return;const focusable=[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length);const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
    select(0);tabs.children[0].focus();
  }
  function layoutAction(action,node) {
    if(action.startsWith('layout-'))finishCardResize();
    if(action==='layout-edit') {
      clearCardDragState();clearMatchDrag();
      if(!state.layoutEditing) {
        layoutBeforeEdit=structuredClone(state.boardLayout);state.layoutEditing=true;applyBoardLayout();
        root.querySelector('[data-layout-editor] [data-action="layout-edit"]').focus({preventScroll:true});
      } else {
        state.layoutEditing=false;layoutBeforeEdit=null;
        const saved=writeStorage(boardLayoutKey,JSON.stringify(state.boardLayout));applyBoardLayout();
        root.querySelector('.board-toolbar-actions [data-action="layout-edit"]').focus({preventScroll:true});
        toast(saved?'Anordnung auf diesem Gerät gespeichert.':'Anordnung für diese Sitzung übernommen; der Browserspeicher ist nicht verfügbar.');
      }
    } else if(action==='layout-cancel') {
      clearCardDragState();state.boardLayout=layoutBeforeEdit||defaultBoardLayout();state.layoutEditing=false;layoutBeforeEdit=null;applyBoardLayout();
      root.querySelector('.board-toolbar-actions [data-action="layout-edit"]').focus({preventScroll:true});
    } else if(action==='layout-reset'&&state.layoutEditing) {clearCardDragState();state.boardLayout=defaultBoardLayout();applyBoardLayout();}
    else if(action.startsWith('layout-card-')&&state.layoutEditing) {
      const id=node.dataset.cardId,zone=boardZones.find(area=>state.boardLayout[area].includes(id));if(!zone)return;
      const ids=state.boardLayout[zone],index=ids.indexOf(id);
      if(index<0)return;
      if(action==='layout-card-zone')moveBoardCard(id,zone==='top'?'sidebar':'top');
      if(action==='layout-card-hide')moveBoardCard(id,'hidden');
      if(action==='layout-card-sidebar')moveBoardCard(id,'sidebar');
      if(action==='layout-card-earlier'&&index>0)moveBoardCard(id,zone,ids[index-1]);
      if(action==='layout-card-later'&&index<ids.length-1)moveBoardCard(id,zone,ids[index+2]||null);
      if(action==='layout-card-height-auto'&&zone==='sidebar')setCardHeight(node.closest('[data-board-card]'),null);
    } else if(action==='date-toggle') {
      const container=node.closest('.unassigned_container,.finished_container');if(!container)return;
      const view=dateView(container),choices=view.query?view.searchExpanded:view.expanded;
      choices.set(node.closest('.ls-date-row').dataset.date,node.getAttribute('aria-expanded')!=='true');
      refreshDateGroups(container);scheduleNames();
    } else if(action==='finished-sort') {
      const key=node.dataset.sortKey;if(!['number','plan','start','end'].includes(key))return;
      state.finishedSort={key,direction:state.finishedSort.key===key?-state.finishedSort.direction:1};sortFinishedTables();scheduleNames();
    } else if(action==='tablets-sort') {
      const key=node.dataset.sortKey;if(!['court','battery'].includes(key))return;
      state.tabletSort={key,direction:state.tabletSort.key===key?-state.tabletSort.direction:1};writeStorage(tabletSortKey,JSON.stringify(state.tabletSort));refreshTablets();
    } else if(action==='logs-sort') {
      state.logSort*=-1;writeStorage(logSortKey,state.logSort===1?'ascending':'descending');refreshLogs();
    } else if(action==='logs-clear') {cerror.clear();}
    else if(action==='density') {state.density=state.density==='compact'?'comfort':'compact';writeStorage('bts-admin-density',state.density);root.classList.toggle('comfort',state.density==='comfort');node.innerHTML=icon('logs')+(state.density==='comfort'?'Komfort':'Kompakt');fontsChanged();}
  }
  function bindLayout() {
    const signal=listeners.signal;
    root.addEventListener('click',event=>{const node=event.target.closest('[data-action]');if(!node)return;event.preventDefault();layoutAction(node.dataset.action,node);},{signal});
    root.addEventListener('keydown',event=>{
      const handle=event.target.closest('.card-resize-handle');
      if(handle&&state.layoutEditing&&handle.closest('[data-card-zone="sidebar"]')&&['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
        event.preventDefault();const card=handle.closest('[data-board-card]'),height=state.boardLayout.heights[card.dataset.boardCard]??card.offsetHeight;
        setCardHeight(card,event.key==='Home'?cardMinHeight:event.key==='End'?cardMaxHeight:height+(event.key==='ArrowUp'?-1:1)*(event.shiftKey?50:10));return;
      }
      const target=event.target.closest('[role="button"]');
      if(target&&['Enter',' '].includes(event.key)&&!['BUTTON','A'].includes(target.tagName)){event.preventDefault();target.click();}
    },{signal});
    root.addEventListener('pointerdown',event=>{
      cardDragBlocked=!!(state.layoutEditing&&event.target.closest('[data-board-card]')&&event.target.closest('button,a,input,textarea,select,summary,[contenteditable],[role="button"],.official_card_frame'));
      const handle=event.target.closest('.card-resize-handle');
      if(!state.layoutEditing||!handle?.closest('[data-card-zone="sidebar"]')||event.button!==0)return;
      event.preventDefault();finishCardResize();clearMatchDrag();
      const card=handle.closest('[data-board-card]');
      cardResize={card,handle,pointerId:event.pointerId,y:event.clientY,scrollY:window.scrollY,height:card.offsetHeight,previous:state.boardLayout.heights[card.dataset.boardCard]};
      card.draggable=false;handle.focus({preventScroll:true});handle.setPointerCapture(event.pointerId);root.classList.add('resizing-board-card');
    },{signal});
    root.addEventListener('pointermove',event=>{
      if(!cardResize||event.pointerId!==cardResize.pointerId)return;
      const delta=event.clientY-cardResize.y+window.scrollY-cardResize.scrollY;
      if(Math.abs(delta)>=2)setCardHeight(cardResize.card,cardResize.height+delta);
    },{signal});
    root.addEventListener('pointerup',event=>{if(event.pointerId===cardResize?.pointerId)finishCardResize();},{signal});
    root.addEventListener('pointercancel',event=>{if(event.pointerId===cardResize?.pointerId)finishCardResize(true);},{signal});
    root.addEventListener('lostpointercapture',event=>{if(event.pointerId===cardResize?.pointerId)finishCardResize(true);},{signal});
    root.addEventListener('dragstart',event=>{
      if(!state.layoutEditing)return;
      const card=event.target.closest('[data-board-card]');
      if(!card||cardDragBlocked||!event.dataTransfer){event.preventDefault();event.stopPropagation();return;}
      clearCardDragState();clearMatchDrag();draggedCard=card.dataset.boardCard;
      event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-bts-card',draggedCard);
      event.dataTransfer.setData('text/plain',boardCards.find(value=>value.id===draggedCard).label);
      card.classList.add('card-drag-source');event.dataTransfer.setDragImage(card,Math.min(100,card.offsetWidth/2),20);document.body.classList.add('dragging-board-card');
    },{signal,capture:true});
    document.addEventListener('dragover',event=>{
      if(draggedMatch)positionDock();
      if(!draggedCard)return;
      const placement=boardCardDrop(event);
      root.querySelectorAll('.card-drop-before,.card-drop-after,.card-drop-swap,.card-zone-hover').forEach(node=>node.classList.remove('card-drop-before','card-drop-after','card-drop-swap','card-zone-hover'));
      if(!placement)return;
      event.preventDefault();event.dataTransfer.dropEffect='move';placement.container.classList.add('card-zone-hover');
      placement.card?.classList.add(placement.swap?'card-drop-swap':placement.after?'card-drop-after':'card-drop-before');
    },{signal});
    document.addEventListener('dragleave',event=>{if(!draggedCard)return;const container=event.target.closest('[data-card-zone]');if(container&&(!event.relatedTarget||!container.contains(event.relatedTarget)))container.querySelectorAll('.card-drop-before,.card-drop-after,.card-drop-swap').forEach(node=>node.classList.remove('card-drop-before','card-drop-after','card-drop-swap'));},{signal});
    document.addEventListener('drop',event=>{if(!draggedCard)return;const placement=boardCardDrop(event),id=draggedCard;clearCardDragState();if(!placement)return;event.preventDefault();if(placement.swap)swapBoardCards(id,placement.swap);else moveBoardCard(id,placement.zone,placement.before);},{signal});
    document.addEventListener('dragend',()=>{clearCardDragState();clearMatchDrag();},{signal});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){finishCardResize(true);clearCardDragState();clearMatchDrag();}},{signal});
    window.addEventListener('resize',()=>{btpFontVersion++;positionBoardSidebar();positionDock();scheduleNames();},{signal});
    window.addEventListener('scroll',positionDock,{signal,passive:true,capture:true});
    root.addEventListener('change',event=>{if(event.target.id?.startsWith('show_location_courts_')){cmatch.refresh_unassigned_preparation_context();refreshCounts();positionDock();scheduleNames();}},{signal});
  }
  function positionDock() {
    const dock=document.getElementById('drag-field-dock');if(!dock)return;
    const top=Math.max(0,document.querySelector('.toprow')?.getBoundingClientRect().bottom||0);
    const courts=[...root.querySelectorAll('.courts_container .court_row:not(.do_not_show):not([hidden])')].map(row=>row.querySelector('.court_number')).filter(cell=>cell?.getBoundingClientRect().height);
    dock.hidden=courts.every(cell=>{
      // The field column must be visible, even when the rest of the table scrolls horizontally.
      const field=cell.getBoundingClientRect(),wrap=cell.closest('.table-wrap'),clip=wrap.getBoundingClientRect();
      return field.top>=top&&field.bottom<=document.documentElement.clientHeight&&field.left>=Math.max(0,clip.left+wrap.clientLeft)&&field.right<=Math.min(document.documentElement.clientWidth,clip.left+wrap.clientLeft+wrap.clientWidth);
    });
    dock.style.top=top+'px';
  }
  function clearMatchDrag() {
    draggedMatch=null;document.getElementById('drag-field-dock')?.remove();
    document.querySelectorAll('.droppable_active,.droppable_hover').forEach(node=>node.classList.remove('droppable_active','droppable_hover'));
  }
  function matchDrag(matchId) {
    if(!root?.isConnected||state.layoutEditing)return;
    clearMatchDrag();const match=model.matches.find(item=>String(item._id)===String(matchId));
    if(!complete(match)||btp_entry_status.blocked_players(match).length)return;
    draggedMatch=match._id;
    const dock=el(document.body,'aside','drag-field-dock');dock.id='drag-field-dock';dock.setAttribute('aria-label','Freie Felder für Spiel '+match.setup.match_num);
    el(dock,'strong','','Spiel '+match.setup.match_num+' zuweisen');
    for(const row of root.querySelectorAll('.court_row:not(.do_not_show)')) {
      if(row.dataset.match_id||!row.querySelector('.droppable'))continue;
      const court=model.courts.find(item=>String(item._id)===String(row.dataset.court_id));if(!court?.is_active)continue;
      const target=el(dock,'button','btn attention','Feld '+court.num);target.type='button';target.dataset.court_id=court._id;target.title=model.locations.find(place=>place._id===court.location_id)?.name||'';
      target.ondragover=event=>{event.preventDefault();target.classList.add('droppable_hover');};target.ondragleave=()=>target.classList.remove('droppable_hover');
      target.ondrop=event=>{event.preventDefault();event.stopPropagation();const id=draggedMatch||event.dataTransfer.getData('text');clearMatchDrag();callCourt(court._id,id);};
    }
    if(!dock.querySelector('button'))el(dock,'span','','Keine freien Felder in dieser Ansicht.');positionDock();
  }
  function card(grid,id,label,symbol) {
    const node=el(grid,'section','control-card');node.dataset.boardCard=id;const title=el(node,'h2');title.innerHTML=icon(symbol);el(title,'span','',label);return node;
  }
  function navLink(parent,label,href,symbol) {
    const link=el(parent,'a','',null);link.href=href;link.innerHTML=icon(symbol);el(link,'span','',label);return link;
  }
  function menu(parent,label,symbol) {
    const details=el(parent,'details','board-menu'),summary=el(details,'summary','btn sm');summary.innerHTML=icon(symbol);el(summary,'span','',label);return el(details,'div','board-menu-content');
  }
  function mount(main,tournament,callbacks) {
    unmount();model=tournament;actions=callbacks||{};state.layoutEditing=false;state.boardLayout=readBoardLayout();state.tabletSort=readTabletSort();
    const original=[...main.children],metadata=main.querySelector('.metadata_container');if(!metadata)return;
    root=el(main,'section','leitstand page-leitstand'+(state.density==='comfort'?' comfort':''));el(root,'h1','visually-hidden','Turnierleitung');
    document.body.classList.add('leitstand-view');
    const editor=el(root,'div','board-layout-editor');editor.dataset.layoutEditor='';editor.hidden=true;
    editor.innerHTML='<div><strong>'+icon('layout')+' Layout anpassen</strong><span>Kacheln ziehen: auf die Mitte zum Tauschen, an den Rand zum Einsortieren. Rechts: Höhe am unteren Griff ändern.</span></div><div class="row">'+button('Standard','layout-reset','refresh','sm')+button('Abbrechen','layout-cancel','','sm')+button('Fertig','layout-edit','check','primary sm')+'</div>';
    root.append(metadata);metadata.classList.add('board-workspace');
    const hiddenCards=el(metadata,'section','board-hidden-cards');hiddenCards.hidden=true;
    const hiddenTitle=el(hiddenCards,'h2','card-zone-heading','Ausgeblendete Kacheln');hiddenTitle.id='ls-hidden-cards-title';
    const hiddenStack=el(hiddenCards,'div','hidden-card-stack');hiddenStack.dataset.cardZone='hidden';hiddenStack.setAttribute('aria-labelledby',hiddenTitle.id);
    const controls=el(metadata,'div','board-controls'),grid=el(controls,'div','control-grid');grid.dataset.cardZone='top';grid.setAttribute('aria-label','Kacheln über den Spielen');
    const operators=card(grid,'operators','Nächste Tabletbediener','tablet');
    const nativeOperators=metadata.querySelector('.unassigned_tableoperators_container');if(nativeOperators)operators.append(nativeOperators);
    el(operators,'p','card-empty-message','Tabletbedienung deaktiviert.').hidden=!!nativeOperators;
    const rotation=card(grid,'rotation','Rotation','refresh'),officials=metadata.querySelector('.umpire_container');if(officials)rotation.append(officials);
    const announcement=card(grid,'announcement','Freie Durchsage','mic'),nativeAnnouncement=metadata.querySelector('.announcements_container');if(nativeAnnouncement)announcement.append(nativeAnnouncement);
    const device=card(grid,'device','Auf diesem Gerät','speaker');
    for(const selector of ['.location_announcements_controls','.location_courts_controls']){const node=metadata.querySelector(selector);if(node)device.append(node);}
    const automatic=card(grid,'automation','Automatik','court'),nativeAutomation=metadata.querySelector('.automation_controls_panel');if(nativeAutomation)automatic.append(nativeAutomation);
    card(grid,'tablets','Tablets','tablet');
    const logs=card(grid,'logs','Logdaten','logs');mountLogs(logs,metadata.querySelector('.errors_scroll_left'));
    const games=el(metadata,'div','board-games');
    const toolbar=el(games,'div','toolbar'),searchGroup=el(toolbar,'div','row');
    const search=el(searchGroup,'input');search.type='search';search.placeholder='Spiel, Name oder Disziplin suchen …';search.setAttribute('aria-label','Spiele durchsuchen');search.dataset.boardSearch='';
    searchControl=search;
    const counts=el(searchGroup,'div','row');counts.dataset.fieldCounts='';search.oninput=()=>{root.querySelectorAll('.match_table tbody > tr').forEach(filterRow);root.querySelectorAll('.unassigned_container,.finished_container').forEach(matchListCount);scheduleNames();};
    const buttons=el(toolbar,'div','row board-toolbar-actions'),base='/admin/t/'+encodeURIComponent(model.key);
    const views=menu(buttons,'Ansichten','monitor');
    for(const [label,path]of [['Spielübersicht','upcoming'],['Aktuelle Spiele','current_matches'],['Nächste Spiele','next_matches'],['Selbstanmeldung','self_check_in'],['Anmeldung','registration_check'],['Meldungskontrolle','registration_control']]) {
      const link=el(views,'a','',label);link.href=base+'/'+path;
      if(model.locations.length>1)for(const location of model.locations){const sub=el(views,'a','location-view',label+' · '+location.name);sub.href=link.href+'?'+new URLSearchParams({location:location.name});}
    }
    const tools=menu(buttons,'Werkzeuge','more'),oldMenu=document.querySelector('.toprow .toprow_menu_dropdown');if(oldMenu){tools.append(...oldMenu.childNodes);oldMenu.parentElement.remove();}
    buttons.insertAdjacentHTML('beforeend',button(state.density==='comfort'?'Komfort':'Kompakt','density','logs','sm')+button('Layout anpassen','layout-edit','layout','sm','aria-expanded="false"'));
    for(const node of original)if(node!==metadata)games.append(node);
    const side=el(metadata,'aside','board-sidebar');side.setAttribute('aria-label','Kacheln rechts neben den Spielen');side.hidden=true;
    const sideTitle=el(side,'h2','card-zone-heading','Rechte Sidebar');el(sideTitle,'span','','Auf schmalen Fenstern über den Spielen');const stack=el(side,'div','sidebar-card-stack');stack.dataset.cardZone='sidebar';
    metadata.querySelector('.metadata_right_container')?.remove();
    const top=document.querySelector('.toprow');top.classList.add('leitstand-header');
    headerObserver=new ResizeObserver(entries=>{
      let changed=false;
      for(const entry of entries) {
        const box=Array.isArray(entry.borderBoxSize)?entry.borderBoxSize[0]:entry.borderBoxSize;
        const height=box?box.blockSize:entry.target.offsetHeight;
        if(entry.target===top) {
          const rounded=Math.round(height);if(headerHeight===rounded)continue;headerHeight=rounded;
        } else {if(sidebarHeight===height)continue;sidebarHeight=height;}
        changed=true;
      }
      if(changed)positionBoardSidebar();
    });headerObserver.observe(top,{box:'border-box'});headerObserver.observe(side,{box:'border-box'});
    const first=top.querySelector('.toprow_link');if(first){
      first.replaceChildren();
      const mark=el(first,'span','board-brand-mark');mark.setAttribute('aria-hidden','true');mark.innerHTML=icon('court');
      el(first,'span','','BTS – Turnierleitung');
    }
    const nav=el(top,'nav','leitstand-nav');nav.setAttribute('aria-label','Hauptnavigation');
    for(const [label,path,symbol]of [['Turnierleitung','/','court'],['Anmeldung','/registration_control','people'],['Sprachsystem','/speech-planning/','mic'],['Geräte & Logs',null,'monitor'],['Einstellungen','/edit','settings']])navLink(nav,label,path?base+path:'/admin/diagnostics/',symbol);
    if(actions.testlab) {const link=navLink(nav,'Testlabor','#','flask');link.onclick=event=>{event.preventDefault();actions.testlab();};}
    listeners=new AbortController();bindLayout();deviceLocations();automation(nativeAutomation);operatorQueue(nativeOperators);btpSync();applyBoardLayout();
    nameObserver=new ResizeObserver(entries=>{
      for(const {target,contentRect} of entries) {
        const group=nameGroups.get(target);if(!group||Math.abs((group.width??-1)-contentRect.width)<.25)continue;
        group.width=contentRect.width;dirtyNameGroups.add(target);queueNames();
      }
    });
    timerObserver=new ResizeObserver(entries=>{for(const {target,contentRect} of entries) {
      timerBoxes.set(target,{width:contentRect.width,height:contentRect.height});
      const cached=timerMeasurements.get(target);
      if(cached&&Math.abs(cached.available-contentRect.width)<.25&&Math.abs(cached.height-contentRect.height)<.25)continue;
      timerMeasurements.delete(target);scheduleTimers(target);
    }});
    for(const timer of root.querySelectorAll('.timer'))timerDisplay(timer,timer.getAttribute('aria-label')||timer.textContent);
    for(const time of timerValues)timerObserver.observe(time);
    const mountedRoot=root;
    document.fonts?.ready.then(()=>{if(root===mountedRoot)fontsChanged();});
    document.fonts?.addEventListener('loadingdone',fontsChanged,{signal:listeners.signal});
    const byId=new Map(model.matches.map(match=>[String(match._id),match]));
    for(const tr of root.querySelectorAll('.match_table tbody > tr')) {
      const match=byId.get(String(tr.dataset.match_id));if(match)row(tr,match,tr.dataset.style);
      else {const court=model.courts.find(item=>String(item._id)===String(tr.dataset.court_id));if(court)emptyRow(tr,court,tr.dataset.style);}
    }
    cmatch.refresh_unassigned_preparation_context();refreshCounts();
    viewObserver=new MutationObserver(()=>{if(root&&!root.isConnected)unmount();});viewObserver.observe(main,{childList:true});
  }
  function unmount() {
    finishCardResize(true);
    unsubscribeLogs?.();unsubscribeLogs=null;logView=null;
    if(root&&typeof ctournament!=='undefined')ctournament.clear_official_dragdrop?.();
    for(const complete of pendingUpdates.values())complete();
    listeners?.abort();listeners=null;viewObserver?.disconnect();viewObserver=null;clearCardDragState();clearMatchDrag();
    headerObserver?.disconnect();headerObserver=null;headerHeight=null;sidebarHeight=null;document.body.classList.remove('leitstand-view');
    nameObserver?.disconnect();nameObserver=null;nameGroups.clear();dirtyNameGroups.clear();nameLayoutDirty=false;preparationLayoutDirty=false;if(nameFrame!==null)cancelAnimationFrame(nameFrame);nameFrame=null;
    timerObserver?.disconnect();timerObserver=null;timerValues.clear();dirtyTimers.clear();timerFittings.clear();preparationWidths.clear();if(timerFrame!==null)cancelAnimationFrame(timerFrame);timerFrame=null;timerComplete=null;
    document.querySelector('.leitstand-header')?.classList.remove('leitstand-header');root=null;searchControl=null;
  }
  return {mount,unmount,active,row,emptyRow,updateScore,updateMatchMetadata,score,timerDisplay,timerVisibilityChanged,deviceLocations,automation,refreshOperators,refreshCounts,refreshFinished,refreshTablets,tabletDevices,refreshScoreLayout,maxSetCount,matchTimes,matchDay,sortFinishedMatches,nameStages,matchDrag,clearMatchDrag,decorateControls,matchDialog,restoreDialogFocus,operatorQueue,rotationIcons,player,refreshUnassigned,refreshDates:refreshDateGroups,btpSync,
    pendingUpdates:()=>[...pendingUpdates.keys()],
    isUpdating:()=>nameFrame!==null||timerFrame!==null||dirtyTimers.size>0||countsPending||finishedSortPending};
})();
