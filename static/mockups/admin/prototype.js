'use strict';
(() => {
  const paths = {
    court: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4v16M3 12h18M3 7h18M3 17h18"/>',
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    people: '<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M17 13a5 5 0 0 1 4 5v2"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    settings: '<path d="m10 3 4 0 1 3 3 1 3-1 2 4-2 2v3l1 2-3 3-3-1-2 1-1 3H9l-1-3-3-1-2 1-2-4 2-2v-3l-1-2 3-3 3 1 2-1Z"/><circle cx="12" cy="12" r="3"/>',
    monitor: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8M12 16v5"/>',
    tablet: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M10 18h4"/>',
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
    chart: '<path d="M3 3v18h19M6 16l4-6 5 3 6-8"/>'
  };
  const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  const esc = text => String(text ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
  const button = (label, action = 'demo', symbol, kind = '', extra = '') => `<button type="button" class="btn ${kind}" data-action="${action}" ${extra}>${symbol ? icon(symbol) : ''}${label}</button>`;
  const tiny = (name, action, label, extra = '') => button('', action, name, 'icon-only', `title="${label}" aria-label="${label}" ${extra}`);
  const badge = (label, kind = 'neutral', dot = false) => `<span class="badge ${kind}">${dot ? '<i class="dot"></i>' : ''}${label}</span>`;
  const court = (num, mini = false) => `<span class="court-symbol ${mini ? 'mini' : ''}" role="img" aria-label="Feld ${num}"><em>${String(num).padStart(2, '0')}</em></span>`;
  const matchTeams = (a, b) => `<div class="versus-line"><span class="team-one">${esc(a)}</span><span class="vs">v</span><span class="team-two">${esc(b)}</span></div>`;
  const matchScore = game => {
    if (!game.score) return '—';
    const sets = game.score.split(' · ');
    return `<div class="scoreline" role="group" aria-label="${game.state==='live'?'Live-Spielstand':game.state==='called'?'Noch nicht begonnen':'Endergebnis'}: ${esc(game.score)}">${sets.map((score,index)=>{
      const current=game.state==='live' && index===sets.length-1;
      const points=score.match(/^(\d+):(\d+)$/);
      const content=points?`<span class="score-home" aria-hidden="true">${points[1]}</span><span class="score-colon" aria-hidden="true">:</span><span class="score-away" aria-hidden="true">${points[2]}</span>`:esc(score);
      return `<span class="set-score ${current?'current-set':game.state==='live'?'completed-set':'final-set'}" role="group" aria-label="${current?'Aktueller Satz':'Satz '+(index+1)}: ${esc(score)}">${content}</span>`;
    }).join('')}</div>`;
  };
  function timerText(value) {
    const parts=String(value).trim().split(':');
    if(parts.length===1 && /^\d+$/.test(parts[0])) {
      const seconds=Number(parts[0]);
      return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
    }
    return parts.map((part,index)=>/^\d+$/.test(part)?String(Number(part)).padStart(index?2:1,'0'):part).join(':');
  }
  function digitalTimer(value,label,kind='') {
    const text=timerText(value);
    return `<span class="digital-timer ${kind}" role="timer" title="${esc(label)}" aria-label="${esc(label+': '+text)}">${icon('clock')}<span class="timer-value" aria-hidden="true">${esc(text)}</span></span>`;
  }
  // These are the existing cmatch.css / BTP highlight classes, not status colors.
  const highlights = [
    [0, 'Keine Hervorhebung', '#ffffff'], [1, 'Gelb', '#ffd838'], [2, 'Rosa', '#ff79ab'],
    [3, 'Orange', '#fbad4b'], [4, 'Blau', '#1dace6'], [5, 'Türkis', '#5ce1b8'], [6, 'Lila', '#c56bff']
  ];
  const locations = [
    { id: 'CH', name: 'Campus Hellweg', highlight: 6 },
    { id: 'SN', name: 'Sporthalle Nord', highlight: 4 }
  ];
  const matchStatus = (label, symbol) => `<span class="badge match-status">${icon(symbol)}${label}</span>`;
  const locationTag = id => {
    const place = locations.find(location => location.id === id);
    return place ? `<span class="location-tag" title="Vorbereitungsort · BTP-Highlight ${place.highlight}"><i class="highlight-swatch highlight_${place.highlight}"></i>${esc(place.name)}</span>` : '';
  };
  const gameHighlight = game => ['preparation', 'prep'].includes(game.state) ?
    locations.find(location => location.id === game.location)?.highlight || 0 : game.highlight || 0;
  const highlightAttributes = game => `data-highlight="${gameHighlight(game)}" title="BTP-Highlight ${gameHighlight(game)} · ${highlights[gameHighlight(game)][1]}"`;
  const locationColors = () => `<div class="hall-color-settings">${locations.map(place => `<label><strong>${place.name}</strong><span class="row"><i class="highlight-swatch highlight_${place.highlight}"></i><select aria-label="BTP-Highlight ${place.name}" data-change="location-highlight" data-location="${place.id}">${highlights.slice(1).map(([id,name]) => `<option value="${id}" ${place.highlight===id?'selected':''} ${locations.some(other=>other.id!==place.id&&other.highlight===id)?'disabled':''}>${id} · ${name}</option>`).join('')}</select></span></label>`).join('')}</div>`;
  const progress = value => `<div class="progress" role="progressbar" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"><span style="width:${value}%"></span></div>`;
  const checkbox = (label, checked = true, action = '') => `<label class="check"><input type="checkbox" ${checked ? 'checked' : ''} ${action ? `data-change="${action}"` : ''}>${label}</label>`;
  const boardCards = [
    {id:'operators',label:'Nächste Tabletbediener'}, {id:'announcement',label:'Freie Durchsage'},
    {id:'device',label:'Auf diesem Gerät'}, {id:'automation',label:'Automatik'}
  ];
  const boardLayoutKey='bts-admin-mockup-card-layout-v1';
  const defaultBoardLayout=()=>({top:boardCards.map(card=>card.id),sidebar:[]});
  function readBoardLayout() {
    try {
      const saved=JSON.parse(localStorage.getItem(boardLayoutKey));
      if(!Array.isArray(saved?.top)||!Array.isArray(saved?.sidebar)) return defaultBoardLayout();
      const seen=new Set(),layout={top:[],sidebar:[]};
      for(const zone of ['top','sidebar']) for(const id of saved[zone]) {
        if(boardCards.some(card=>card.id===id)&&!seen.has(id)) {layout[zone].push(id);seen.add(id);}
      }
      layout.top.push(...boardCards.filter(card=>!seen.has(card.id)).map(card=>card.id));
      return layout;
    } catch { return defaultBoardLayout(); }
  }
  const state = { auto: true, density: 'compact', focus: false, helpersPaused: false, logsPaused: false, settingStatus: 'Alle Änderungen gespeichert', stage: 9, query: '', gameFilter: 'all', logFilter: 'all',
    deviceLocations: Object.fromEntries(locations.map(place=>[place.id,{fields:true,matchCalls:place.id==='CH',preparationCalls:place.id==='CH'}])), remoteAnnouncements: false,
    boardLayout:readBoardLayout(),layoutEditing:false };
  let variant = new URLSearchParams(location.search).get('konzept') === 'b' ? 'b' : 'a';
  let page = 'leitstand', section = '', toastTimer, draggedGame = null, draggedCard = null, cardDragBlocked = false, layoutBeforeEdit = null;
  const nav = [
    ['leitstand', 'Turnierleitung', 'court', ['leitstand']],
    ['anmeldung', 'Anmeldung', 'people', ['anmeldung']],
    ['sprache', 'Sprachsystem', 'mic', ['sprache', 'sprachspiele', 'sprachdiagramm', 'helfer', 'hoerlabor', 'kontexteditor']],
    ['geraete', 'Geräte & Logs', 'monitor', ['geraete', 'logs']],
    ['einstellungen', 'Einstellungen', 'settings', ['einstellungen']],
    ['testlabor', 'Testlabor', 'flask', ['testlabor']]
  ];
  const pages = {
    leitstand: 'Turnierleitung', anmeldung: 'Anmeldung & Meldungen', sprache: 'Sprachvorbereitung',
    sprachspiele: 'Sprachvorbereitung', sprachdiagramm: 'Sprachvorbereitung', helfer: 'Sprachhelfer',
    hoerlabor: 'Hörlabor', kontexteditor: 'Kontexteditor', geraete: 'Geräte & Seiten', logs: 'Zentrale Logs',
    einstellungen: 'Einstellungen', testlabor: 'Testlabor'
  };
  const pairs = [
    'Mia Becker / Finn Sommer', 'Lena Hoffmann / Noah Weber', 'Emil Wagner / Sophie Koch',
    'Paul Fischer / Emma Richter', 'Jonas Klein / Clara Wolf', 'Ben Neumann / Lea Braun',
    'Tom Keller / Anna Schäfer', 'Oskar Brandt / Julia Winter', 'Nina Berg / Lukas König',
    'Theo Lang / Marie Frank', 'Max Seidel / Sarah Krüger', 'Erik Roth / Amelie Schubert',
    'Leon Hartmann / Ida Schmitt', 'Anton Hahn / Luisa Scholz', 'Jan Lorenz / Maja Seifert',
    'David Peters / Frieda Vogt', 'Tim Krause / Greta Fuchs', 'Felix Baum / Hanna Stein'
  ];
  const fieldNumbers = [44, 37, 40, 0, 36, 32, 38, 30, 43, 39, 42, 41, 0];
  const fields = fieldNumbers.map((number, i) => ({ field: i + 1, number, time: number < 40 ? '10:30' : '11:00',
    event: number < 40 ? 'MX U19' : 'MX U15', round: number < 40 ? 'R16' : 'VF',
    state: !number ? 'vacant' : [2, 3, 6, 8].includes(i + 1) ? 'result-pending' : i===11 ? 'called' : 'live',
    highlight: 0,
    a: pairs[i % pairs.length], b: pairs[(i + 5) % pairs.length], operator: pairs[(i + 9) % pairs.length],
    score: ['5:5', '23:21 · 21:11', '15:21 · 21:18 · 21:17', '', '19:21 · 12:16', '21:14 · 17:21 · 21:14', '14:21 · 11:14', '21:19 · 16:21 · 21:14', '10:9', '10:9', '19:21 · 6:4', '0:0', ''][i],
    shuttles: i===4 ? 3 : 0, timer: i===11 ? '0' : i===6 ? '55' : ''
  }));
  const upcoming = [
    { number: 45, event: 'MX U15', round: '9/16', state: 'preparation', location: 'CH', age: '4:49', a: pairs[13], b: pairs[14] },
    { number: 46, event: 'MX U15', round: '9/16', state: 'preparation', location: 'SN', age: '3:36', a: pairs[15], b: pairs[16] },
    { number: 47, event: 'MX U15', round: '9/16', state: 'preparation', location: 'CH', age: '3:24', a: pairs[17], b: pairs[0] },
    { number: 48, event: 'MX U15', round: '9/16', state: 'candidate', a: pairs[1], b: pairs[2], busy: true },
    { number: 49, event: 'MX U17', round: 'VF', state: 'preparation', location: 'SN', age: '3:07', a: pairs[3], b: pairs[4], deferred: true },
    { number: 50, event: 'MX U17', round: 'VF', state: 'candidate', a: pairs[5], b: pairs[6] },
    { number: 51, event: 'MX U17', round: 'VF', state: 'open', a: pairs[7], b: 'Gewinner aus Spiel 24' },
    { number: 52, event: 'MX U17', round: 'VF', state: 'blocked', a: pairs[8], b: pairs[9], entryBlocked: true },
    { number: 53, event: 'MX U17', round: '9/16', state: 'planned', a: pairs[10], b: pairs[11], tabletBusy: true }
  ];
  // Snapshot produced by the existing match_automation calculations for these fixtures.
  // A live implementation consumes location_preparation_selection_by_location_id from BTS.
  const preparationSelection = {
    CH: {
      rally_count: 11,
      successor_court_ids: ['CH_5','CH_7'],
      free_court_ids: ['CH_4','CH_13'],
      demand_court_ids: ['CH_5','CH_7','CH_4','CH_13'],
      current_preparation_count: 2,
      required_preparation_count: 4,
      missing_preparation_count: 2
    }
  };
  function hasPreparationDemand(game) {
    return game.state!=='done' && Object.values(preparationSelection).some(selection=>selection.demand_court_ids.includes('CH_'+game.field));
  }
  function preparationDemandReason(game) {
    return !game.number ? 'Vorbereitungsbedarf: Dieses aktive Feld ist frei.' : `Nachfolgespiel vorbereiten: Die führende Seite kann dieses Spiel innerhalb von ${preparationSelection.CH.rally_count} weiteren Ballwechseln gewinnen.`;
  }
  // Review fixtures only: each person has their own match attendance and resource hints.
  upcoming.forEach(g => { g.people=Array.from({length:4},()=>({checked:g.state==='preparation'})); });
  upcoming[0].people[1].checked=false;
  upcoming[3].people[0].playing=6;
  upcoming[3].people[1].pause='2:12';
  upcoming[7].people[0].entry='WDN';
  upcoming[8].people[0].tablet=9;
  upcoming[8].people[1].waitingTablet=true;
  upcoming[0].roles=[{role:'Schiedsrichter',name:'Sven Weber',checked:true},{role:'Aufschlagrichter',name:'Kim Wolf',checked:false}];
  upcoming[1].roles=[{role:'Tabletbedienung',name:'Alex Berger',checked:false,pairId:'tablet-46'},{role:'Tabletbedienung',name:'Sam Neubert',checked:false,pairId:'tablet-46'}];
  upcoming[2].roles=[{role:'Schiedsrichter',name:'Toni Meier',checked:true}];
  upcoming[4].roles=[{role:'Tabletbedienung',name:'Robin Schulz',checked:false}];
  const finished = [21,22].map((number,i)=>({...fields[i+1],number,state:'done'}));
  const priorities = [
    ['Ausgelöste Durchsagen', '15 / 15 bereit'], ['Sprachtest und Proben', '1 / 1 bereit'], ['Spielorte und Felder', '41 / 41 bereit'],
    ['Technische Offizielle', 'Kein Bedarf'], ['Wartende Tabletbediener', '8 / 8 bereit'], ['Laufende Spiele', '75 / 75 bereit'],
    ['Spiele in Vorbereitung', '21 / 21 bereit'], ['Aufrufkandidaten', '37 / 37 bereit'], ['Weitere angesetzte Spiele', '92 / 92 bereit'],
    ['Angemeldete Disziplinen', '622 / 651 bereit'], ['Anmeldevorarbeit', '19 / 1.008 bereit'], ['Übrige Personen und Teams', '1 / 41 bereit'], ['Andere Stimme', 'Ausgeschaltet']
  ];
  function brand(header=false) { return `<a class="brand ${header?'header-brand':''}" href="#leitstand" aria-label="${header?'BTS – '+esc(pages[page]):'BTS Turnierleitung'}"><span class="brand-mark">${icon('court')}</span><span class="brand-text">BTS${header?`<span class="brand-page-name"> – ${esc(pages[page])}</span>`:'<span class="brand-tagline"> &nbsp; Turnierleitung</span>'}</span></a>`; }
  function activeGroup() { return nav.find(item => item[3].includes(page)) || nav[0]; }
  function navLinks(side = false) { return nav.map(([id, label, symbol, group]) => `<a href="#${id}" class="${group.includes(page) ? 'active' : ''}" ${group.includes(page) ? 'aria-current="page"' : ''} title="${label}">${icon(symbol)}<span class="nav-label">${label}</span>${!side && id === 'sprache' ? '<span class="nav-count">2</span>' : ''}</a>`).join(''); }
  function heading(title, description, actions = '') {
    return `<header class="page-heading"><div><div class="breadcrumb">Jugend-Rangliste 2026 ${icon('chevron')} ${activeGroup()[1]}${pages[page] !== activeGroup()[1] ? `${icon('chevron')}${pages[page]}` : ''}</div><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div><div class="row">${actions}</div></header>`;
  }
  function subnav(items) { return `<nav class="subnav" aria-label="Bereichsnavigation">${items.map(([id, label, symbol]) => `<a href="#${id}" class="${page === id || `${page}/${section}` === id ? 'active' : ''}" ${page === id || `${page}/${section}` === id ? 'aria-current="page"' : ''}>${symbol ? icon(symbol) : ''}${label}</a>`).join('')}</nav>`; }
  function speechNav() {
    const html = subnav([['sprache', 'Vorbereitung', 'mic'], ['helfer', 'Sprachhelfer', 'server'], ['hoerlabor', 'Hörlabor', 'speaker'], ['kontexteditor', 'Kontexteditor', 'edit']]);
    return ['sprachspiele', 'sprachdiagramm'].includes(page) ? html.replace('href="#sprache" class=""', 'href="#sprache" class="active" aria-current="page"') : html;
  }
  function prepTabs() { return subnav([['sprache', 'Übersicht'], ['sprachdiagramm', 'Zustandsdiagramm'], ['sprachspiele', 'Spiele']]); }
  function panel(title, content, actions = '', subtitle = '', foot = '') { return `<section class="panel"><div class="panel-head"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${actions}</div><div class="panel-body">${content}</div>${foot ? `<div class="panel-foot">${foot}</div>` : ''}</section>`; }
  function search(placeholder = 'Suchen …', target = 'rows') { return `<label class="search-field">${icon('search')}<input type="search" placeholder="${placeholder}" aria-label="${placeholder}" data-search-target="${target}"></label>`; }
  function footer() { return `<footer class="screen-footer"><span>Jugend-Rangliste 2026 · Campus Hellweg · Demo-Daten</span><span><a href="#" data-action="mapping">Funktionsabgleich</a> &nbsp;·&nbsp; <a href="index.html">Zu den Designvorschlägen</a></span></footer>`; }
  const completeGame = g => g.state!=='open';
  const preparationAllowed = g => completeGame(g) && !g.entryBlocked && !g.busy;
  // Review fixtures, not a second implementation of the server's selection rules.
  // A live view uses diagnostics_by_match_id / call_on_court_diagnostics_by_match_id.
  function callDiagnostics(g) {
    const onCourt=g.state==='preparation', people=g.people||[], roles=g.roles||[];
    const names=[...g.a.split(' / '),...g.b.split(' / ')];
    const rule=(label,passed,detail='')=>({label,passed,detail});
    const manual=[
      rule('Status erlaubt den Aufruf',true),
      rule('Alle Teilnehmer stehen fest',completeGame(g)),
      rule('Keine BTP-Sperrvermerke',!g.entryBlocked&&!people.some(p=>p.entry)),
      rule('Keine Sonderwertung und kein abgeschlossenes Spiel',true),
      rule('Spiel passt zum Standort und ist noch nicht auf dem Feld',true),
      rule('Kein Spieler spielt gerade',!g.busy&&!people.some(p=>p.playing),people.filter(p=>p.playing).map(p=>'Feld '+p.playing).join(', '))
    ];
    const availability=[
      rule('Spielerpausen sind abgelaufen',!people.some(p=>p.pause),people.flatMap((p,i)=>p.pause?[names[i]+' · '+timerText(p.pause)]:[]).join(', ')),
      rule('Kein Spieler wartet als Tabletbediener',!people.some(p=>p.waitingTablet)),
      rule('Kein Spieler bedient gerade ein Tablet',!people.some(p=>p.tablet)),
      rule('Offizielle sind verfügbar',!roles.some(p=>p.pause||p.playing||p.tablet||p.waitingTablet))
    ];
    const additional=onCourt?[
      ...availability,
      rule('Alle Spieler sind eingecheckt',people.every(p=>p.checked),people.flatMap((p,i)=>!p.checked?[names[i]]:[]).join(', ')),
      rule('Zugewiesene Offizielle und Tabletbediener sind eingecheckt',roles.every(p=>p.checked),roles.filter(p=>!p.checked).map(p=>p.name).join(', ')),
      rule('Mindestzeit in Vorbereitung erreicht',true,timerText(g.age)+' · mindestens 2:00'),
      rule('Ein passendes aktives Feld ist frei',true)
    ]:[
      ...availability,
      rule('Vorbereitung ist nicht zurückgestellt',!g.deferred),
      rule('Keine offenen Vorgängerspiele',completeGame(g))
    ];
    const windowRules=[rule('Innerhalb der Aufrufgrenze',g.number<=50,'bis einschließlich Spiel 50')];
    const passes=rules=>rules.every(r=>r.passed);
    const eligible=passes(manual)&&passes(additional)&&passes(windowRules);
    const tone=onCourt?(eligible?'ready':'blocked'):passes(windowRules)?(eligible?'preparable':'blocked'):'outside';
    const label=onCourt?(eligible?'Feldaufruf möglich':'Feldaufruf blockiert'):tone==='outside'?'Außerhalb der automatischen Aufrufgrenze':eligible?'Vorbereitungsaufruf möglich':'Automatische Vorbereitung blockiert';
    const sections=onCourt?[
      {label:'Kriterien',rules:[...manual,...additional]},
      {label:'Innerhalb Aufrufgrenze',rules:windowRules}
    ]:[
      {label:'Händisch aufrufbar',rules:manual},
      {label:'Weitere Automatik-Regeln',rules:additional},
      {label:'Innerhalb Automatik-Aufrufgrenze',rules:windowRules}
    ];
    const places=locations.filter(place=>!g.location||place.id===g.location).map(place=>place.name).join(' / ');
    const text=[`Spiel ${g.number} · ${onCourt?'Aufruf aufs Feld':'Vorbereitungsauswahl'}`,places,label,'',...sections.flatMap(section=>[section.label+': '+(passes(section.rules)?'ja':'nein'),...section.rules.map(r=>(r.passed?'✓ ':'✗ ')+r.label+(r.detail?' ('+r.detail+')':'')),''])].join('\n').trim();
    return {tone,label,text,iconOK:onCourt?eligible:passes(manual)};
  }
  function callStatusInfo(g,diagnostics) {
    return button('','call-status','info',`icon-only call-status-info ${diagnostics.iconOK?'criteria-ok':'criteria-blocked'}`,`data-number="${g.number}" title="${esc(diagnostics.text)}" aria-label="${esc(`Aufrufstatus für Spiel ${g.number}: ${diagnostics.label}. Details öffnen`)}" aria-haspopup="dialog"`);
  }
  const personLocked = p => !!(p.entry || p.tablet || p.waitingTablet || p.locked);
  function speechButton(symbol, action, label, game, extra='', audio='ready') {
    const status=audio==='ready'?'Audio bereit':'Audio fehlt · Browser-Fallback möglich';
    return tiny(symbol,action,`${label} · ${status}`,`data-speech-state="${audio}" data-number="${game.number}" ${extra}`);
  }
  function personName(name, p, game, index, role=false) {
    const reason=p.entry ? `${p.entry} in BTP für diese Disziplin` : p.tablet ? `Tabletbedienung auf Feld ${p.tablet}` : p.waitingTablet ? 'Wartet auf Tabletbedienung' : p.locked ? 'Einzel-Check-in für technische Offizielle in diesem Beispiel deaktiviert' : '';
    const status=p.entry?'entry-blocked':p.playing?'playing':p.checked?'checked-in':'not-checked-in';
    const hint=[reason || `${p.checked?'Anwesend':'Noch nicht anwesend'} · für dieses Spiel ${p.checked?'auschecken':'einchecken'}`,p.playing?`Spielt auf Feld ${p.playing}`:'',p.pause?`Verbleibende Spielerpause: ${timerText(p.pause)}`:''].filter(Boolean).join(' · ');
    const attributes=`class="person-name ${status}" title="${esc(hint)}"`;
    const resource=p.entry ? `<span class="entry-label" title="${esc(reason)}">${esc(p.entry)}</span>` : p.tablet ? `<span class="resource-hint" role="img" aria-label="${esc(reason)}" title="${esc(reason)}">${icon('tablet')}${court(p.tablet,true)}</span>` : p.waitingTablet ? `<span class="resource-hint" role="img" aria-label="${esc(reason)}" title="${esc(reason)}">${icon('tablet')}${icon('clock')}</span>` : p.playing ? `<span class="resource-hint" role="img" aria-label="Spielt auf Feld ${p.playing}" title="Spielt auf Feld ${p.playing}">${court(p.playing,true)}</span>` : '';
    const details=resource+(p.pause?digitalTimer(p.pause,'Verbleibende Spielerpause','pause-hint'):'');
    const content=`<span class="person-label">${esc(name)}</span>${details?`<span class="person-details">${details}</span>`:''}`;
    const nameEl=personLocked(p) ? `<span ${attributes} data-checkin-locked>${content}</span>` : `<button type="button" ${attributes} data-action="checkin" data-number="${game.number}" data-person="${index}" ${role?'data-role="true"':''} aria-pressed="${p.checked}" aria-label="${esc(name+': '+hint)}">${content}</button>`;
    return `<span class="person-token">${nameEl}</span>`;
  }
  function gameTeams(g, attendance=false) {
    const repeat=(g.state==='preparation'||g.state==='called') && !g.entryBlocked;
    const team=(text,which)=>{
      if(g.state==='open' && which===1) return `<span class="dependency">${esc(text)}</span>`;
      return text.split(' / ').map((name,index)=>attendance?personName(name,g.people[which*2+index],g,which*2+index):esc(name)).join('<span class="team-separator"> / </span>');
    };
    const recall=which=>repeat?speechButton('bell','recall',`${g.state==='preparation'?'Zweiter Vorbereitungsaufruf':'Zweiter Feldaufruf'} · Team ${which+1}`,g,`data-target="Team ${which+1}" data-phase="${g.state}"`,g.number===49&&which===1?'missing':'ready'):'';
    return `<div class="versus-line"><span class="team-one">${recall(0)}${team(g.a,0)}</span><span class="vs">v</span><span class="team-two">${team(g.b,1)}${recall(1)}</span></div>`;
  }
  function matchTools(g) { return tiny('more','match',`Spiel ${g.number} öffnen · Bearbeiten, Schiedsrichterzettel und Rohdaten`,`data-number="${g.number}" aria-haspopup="dialog"`); }
  function matchHead(planned=false) { return `<thead><tr><th aria-label="Spielwerkzeuge"></th><th>${planned?'Feld / Ort':'Feld'}</th><th>#</th><th>Zeit · Disziplin · Runde</th><th class="teams-heading">Begegnung</th><th>Tabletbedienung / Schiedsrichter</th><th class="${planned?'':'score-heading'}">${planned?'Vorbereitung':'Ergebnis'}</th><th class="right">Aktionen</th></tr></thead>`; }
  function officialRoleTool(person,game) {
    if(person.role==='Tabletbedienung') return `<span class="official-role-icon" role="img" aria-label="Tabletbedienung" title="Tabletbedienung">${icon('tablet')}</span>`;
    const service=person.role==='Aufschlagrichter',label=service?'Aufschlagrichter':'Schiedsrichter';
    return button('','officials',service?'serviceJudge':'umpire','icon-only official-role-tool',`data-number="${game.number}" data-official-role="${label}" title="${label}${service?' · Höhenmessgerät':''} zuweisen / ändern" aria-label="${label} für Spiel ${game.number} zuweisen oder ändern"`);
  }
  function tabletPairMembers(game,pairId) {
    return pairId?(game?.roles||[]).filter(person=>person.role==='Tabletbedienung'&&person.pairId===pairId):[];
  }
  function tabletPairName(game,members) {
    const checked=members.every(person=>person.checked),locked=members.some(personLocked);
    const names=members.map(person=>person.name).join(' / ');
    const hint=`Tabletbedienung als Paarung: ${names} · ${checked?'Anwesend':'Noch nicht anwesend'}${locked?' · Check-in gesperrt':` · beide gemeinsam ${checked?'auschecken':'einchecken'}`}`;
    const content=`<span class="operator-pair-names">${members.map((person,index)=>`<span class="operator-pair-member"><span class="person-label">${esc(person.name)}</span>${index<members.length-1?'<span class="operator-pair-separator" aria-hidden="true"> /</span>':''}</span>`).join(' ')}</span>`;
    const attributes=`class="person-name operator-pair ${checked?'checked-in':'not-checked-in'}" title="${esc(hint)}" aria-label="${esc(hint)}"`;
    return locked?`<span ${attributes} data-checkin-locked>${content}</span>`:`<button type="button" ${attributes} data-action="checkin-tablet-pair" data-number="${game.number}" data-pair-id="${esc(members[0].pairId)}" aria-pressed="${checked}">${content}</button>`;
  }
  function gameOfficials(g,attendance=false) {
    if(!attendance) return `<span class="official-person">${icon('tablet')}<span class="official-name">${esc(g.operator)}</span>${g.state==='called'?speechButton('bell','recall','Zweiter Feldaufruf · Tabletbedienung',g,'data-target="Tabletbedienung" data-phase="called"'):''}</span>`;
    const assign=tiny('people','officials','Offizielle zuweisen',`data-number="${g.number}"`);
    if(!g.roles?.length) return `<span class="official-person muted">${assign}<span class="official-name">Kein Schiedsrichter</span></span>`;
    return g.roles.map((p,i)=>{
      const members=tabletPairMembers(g,p.pairId),paired=members.length>1;
      if(paired&&members[0]!==p) return '';
      const label=paired?'Tabletbedienung als Paarung':p.role;
      return `<span class="official-person">${officialRoleTool(p,g)}${paired?tabletPairName(g,members):personName(p.name,p,g,i,true)}${g.state==='preparation'?speechButton('bell','recall',`Zweiter Vorbereitungsaufruf · ${label}`,g,`data-target="${label}" data-phase="preparation"`):''}</span>`;
    }).join('');
  }
  function fieldRow(g) {
    const locationAttributes=`data-court-location="${g.location||'CH'}"`;
    const demand=hasPreparationDemand(g), demandReason=demand?preparationDemandReason(g):'';
    const demandAttributes=demand?`data-preparation-demand-court="true"`:'';
    const demandLabel=demand?`<span class="visually-hidden">${esc(demandReason)}</span>`:'';
    const fieldLink=`<button class="court-toggle" type="button" data-action="court-state" data-field="${g.field}" title="Feld ${g.field} aktivieren / sperren">${court(g.field)}</button>`;
    if(!g.number) return `<tr class="vacant ${demand?'preparation_demand_court':''}" ${demandAttributes} ${locationAttributes} data-drop-field="${g.field}" data-location="CH" data-search-row data-search="feld ${g.field} frei"><td class="drop-marker">${icon('plus')}</td><td>${fieldLink}</td><td colspan="4"><span class="empty-court-label"><strong>Feld frei · Spiel zuweisen</strong><span class="drop-instruction">Spiel hierher ziehen oder „Zuweisen“ wählen.</span></span></td><td></td><td class="actions" ${demand?`title="${esc(demandReason)}"`:''}>${demandLabel}<span class="field-action-group">${button('Zuweisen','assign','plus','sm attention',`data-field="${g.field}"`)}</span></td></tr>`;
    const actions=g.state==='result-pending'?button('Bestätigen','confirm','check','sm success',`data-number="${g.number}" title="Ergebnis vollständig · Spielabschluss bestätigen"`):g.state==='called'?`${speechButton('speaker','recall','Gesamten Feldaufruf wiederholen',g,'data-target="Gesamtes Spiel" data-phase="called"')}${speechButton('play','begin-play','Mit dem Spielen beginnen – Durchsage',g)}`:g.state==='done'?matchStatus('Beendet','check'):'';
    return `<tr class="${g.state} ${demand?'preparation_demand_court':''} btp-highlight highlight_${gameHighlight(g)}" ${highlightAttributes(g)} ${demandAttributes} ${locationAttributes} data-game="${g.number}" data-search-row data-search="${esc(`${g.number} ${g.a} ${g.b} ${g.event} feld ${g.field}`.toLowerCase())}"><td class="tools">${matchTools(g)}</td><td class="field-cell">${g.state==='done'?`<button class="court-toggle" data-action="history" data-number="${g.number}" title="Spielprotokoll">${court(g.field)}</button>`:fieldLink}</td><td class="game-number">${g.number}</td><td class="match-time">${g.time} &nbsp;<strong>${g.event} ${g.round}</strong>${g.shuttles?`<small class="shuttle-count" title="Verbrauchte Bälle">${g.shuttles} Bälle</small>`:''}</td><td class="teams">${gameTeams(g)}</td><td class="officials">${gameOfficials(g)}</td><td class="score"><div class="score-with-timer">${matchScore(g)}${g.timer!==''&&g.timer!=null?digitalTimer(g.timer,g.state==='called'?'Zeit seit Feldaufruf':'Satzpause','field-timer'):''}</div></td><td class="actions" ${demand?`title="${esc(demandReason)}"`:''}>${demandLabel}${actions&&g.state!=='done'?`<span class="field-action-group" role="group" aria-label="Aktionen für Spiel ${g.number}">${actions}</span>`:actions}</td></tr>`;
  }
  function upcomingRow(g) {
    const placeCalls=preparationAllowed(g)?locations.filter(l=>!g.location||g.location===l.id).map(l=>speechButton('mic','preparation-call',`In Vorbereitung aufrufen · ${l.name}`,g,`data-location="${l.id}" data-target="${l.name}"`)).join(''):'';
    const status=g.state==='preparation'?'In Vorbereitung':g.state==='candidate'?'Aufrufkandidat':g.state==='open'?'Teilnehmer offen':g.entryBlocked?'BTP-Sperrvermerk':'Geplant';
    const diagnostics=callDiagnostics(g);
    return `<tr class="${g.state} ${diagnostics.tone==='outside'?'':'call-status-marked'} btp-highlight highlight_${gameHighlight(g)}" data-call-status="${diagnostics.tone}" ${highlightAttributes(g)} ${completeGame(g)?`draggable="true" data-drag-game="${g.number}"`:''} data-game="${g.number}" data-search-row data-search="${esc(`${g.number} ${g.a} ${g.b} ${g.event}`.toLowerCase())}"><td class="tools">${matchTools(g)}</td><td>${g.location?locationTag(g.location):'—'}</td><td class="game-number">${g.number}</td><td class="match-time">11:00 &nbsp;<strong>${g.event} ${g.round}</strong><span class="visually-hidden"> · ${status}</span></td><td class="teams">${gameTeams(g,true)}</td><td class="officials">${gameOfficials(g,true)}</td><td>${g.age?digitalTimer(g.age,'Zeit seit Vorbereitungsaufruf','timer'):'—'}</td><td class="actions call-status-cell">${g.deferred?'<span class="deferred" title="Automatische Vorbereitung zurückgestellt">Zurückgestellt</span>':''}<span class="call-actions"><span class="call-action-buttons">${placeCalls}</span>${callStatusInfo(g,diagnostics)}</span></td></tr>`;
  }
  function deviceLocationTable() {
    const options=[['fields','Felder anzeigen'],['matchCalls','Spielaufrufe auf diesem Gerät abspielen'],['preparationCalls','Vorbereitungsaufrufe auf diesem Gerät abspielen']];
    return `<table class="device-location-table" aria-label="Spielorte und Ansagen auf diesem Gerät"><thead><tr><th scope="col">Spielort</th><th scope="col" title="Felder anzeigen">Felder</th><th scope="col" title="Spielaufrufe auf diesem Gerät abspielen">Spielaufrufe</th><th scope="col" title="Vorbereitungsaufrufe auf diesem Gerät abspielen">Vorbereitung</th></tr></thead><tbody>${locations.map(place=>`<tr data-device-location="${place.id}"><th scope="row">${esc(place.name)}</th>${options.map(([option,label])=>`<td><label class="device-location-option" title="${esc(place.name+' · '+label)}"><input type="checkbox" data-change="device-location" data-location="${place.id}" data-option="${option}" aria-label="${esc(place.name+' · '+label)}" ${state.deviceLocations[place.id][option]?'checked':''}></label></td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  function fieldCounts() {
    const selected=fields.filter(game=>state.deviceLocations[game.location||'CH'].fields),free=selected.filter(game=>!game.number).length;
    return `${badge(selected.length+' Felder')}${badge((selected.length-free)+' belegt')}${badge(free+' freie Felder',free?'attention':'')}`;
  }
  function positionBoardSidebar() {
    document.querySelector('.board-sidebar')?.style.setProperty('--card-sidebar-top',((document.querySelector('.shell-header')?.offsetHeight||0)+8)+'px');
  }
  function applyBoardLayout() {
    const workspace=document.querySelector('.board-workspace');
    if(!workspace) return;
    const cards=new Map([...workspace.querySelectorAll('[data-board-card]')].map(card=>[card.dataset.boardCard,card]));
    workspace.querySelectorAll('.card-empty-placeholder').forEach(node=>node.remove());
    for(const zone of ['top','sidebar']) {
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
        controls.innerHTML=`<span class="card-drag-handle" data-card-drag="${id}" draggable="${state.layoutEditing}" title="${definition.label} ziehen">${icon('grip')}<span>Verschieben</span></span><div class="row">${tiny(zone==='top'?'arrowLeft':'arrowUp','layout-card-earlier',definition.label+' vorher platzieren',`${attrs} ${index===0?'disabled':''}`)}${tiny(zone==='top'?'arrow':'arrowDown','layout-card-later',definition.label+' danach platzieren',`${attrs} ${index===ids.length-1?'disabled':''}`)}${button(zone==='top'?'Sidebar':'Oben','layout-card-zone',zone==='top'?'layout':'arrowUp','sm',`${attrs} title="${definition.label} ${zone==='top'?'in die rechte Sidebar':'über die Spiele'} verschieben"`)}</div>`;
      });
      container.dataset.cardCount=String(ids.length);
      if(!ids.length&&state.layoutEditing) {
        const placeholder=document.createElement('div');placeholder.className='card-empty-placeholder';
        placeholder.innerHTML=`${icon('plus')}<strong>Kacheln ${zone==='top'?'über den Spielen':'rechts neben den Spielen'}</strong><span>Hier ablegen oder den Bereichsknopf an einer Kachel nutzen.</span>`;
        container.append(placeholder);
      }
    }
    workspace.classList.toggle('layout-editing',state.layoutEditing);
    workspace.classList.toggle('has-card-sidebar',state.layoutEditing||state.boardLayout.sidebar.length>0);
    workspace.querySelector('.board-controls').hidden=!state.layoutEditing&&!state.boardLayout.top.length;
    workspace.querySelector('.board-sidebar').hidden=!state.layoutEditing&&!state.boardLayout.sidebar.length;
    workspace.querySelector('.card-zone-heading').hidden=!state.layoutEditing;
    document.querySelector('[data-layout-editor]').hidden=!state.layoutEditing;
    document.querySelector('.board-toolbar-actions [data-action="layout-edit"]').setAttribute('aria-expanded',String(state.layoutEditing));
    positionBoardSidebar();
  }
  function moveBoardCard(id,zone,before=null) {
    if(!state.layoutEditing||!boardCards.some(card=>card.id===id)||!['top','sidebar'].includes(zone)) return;
    for(const area of ['top','sidebar']) state.boardLayout[area]=state.boardLayout[area].filter(card=>card!==id);
    const index=before?state.boardLayout[zone].indexOf(before):-1;
    state.boardLayout[zone].splice(index<0?state.boardLayout[zone].length:index,0,id);
    applyBoardLayout();
    document.querySelector(`[data-board-card="${id}"] [data-action="layout-card-zone"]`)?.focus({preventScroll:true});
    toast(`${boardCards.find(card=>card.id===id).label} ${zone==='top'?'über den Spielen':'in der rechten Sidebar'} platziert.`);
  }
  function swapBoardCards(source,target) {
    if(!state.layoutEditing||source===target) return;
    const sourceZone=['top','sidebar'].find(zone=>state.boardLayout[zone].includes(source));
    const targetZone=['top','sidebar'].find(zone=>state.boardLayout[zone].includes(target));
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
    const container=event.target.closest('[data-card-zone]')||event.target.closest('.board-sidebar')?.querySelector('[data-card-zone]');
    if(!container) return null;
    const zone=container.dataset.cardZone,card=event.target.closest('[data-board-card]');
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
  function mainPage() {
    return `<h1 class="visually-hidden">Turnierleitung</h1>
      <div class="board-layout-editor" data-layout-editor hidden><div><strong>${icon('layout')} Layout anpassen</strong><span>Kacheln ziehen: auf die Mitte zum Tauschen, an den Rand zum Einsortieren.</span></div><div class="row">${button('Standard','layout-reset','refresh','sm')}${button('Abbrechen','layout-cancel','','sm')}${button('Fertig','layout-edit','check','primary sm')}</div></div>
      <div class="board-workspace"><div class="board-controls"><div class="control-grid" data-card-zone="top" aria-label="Kacheln über den Spielen">
        <section class="control-card" data-board-card="operators"><h2>${icon('tablet')} Nächste Tabletbediener <span class="muted" style="margin-left:auto">2</span></h2>
          <div class="operator-list" aria-label="Warteliste der Tabletbediener"><div class="operator">${icon('tablet')}<strong>Tom Keller / Anna Schäfer</strong><span class="origin">${court(13, true)}</span>${tiny('arrowDown', 'reorder', 'In Warteliste nach unten')}${tiny('close', 'remove-operator', 'Aus Warteliste entfernen')}</div>
          <div class="operator">${icon('tablet')}<strong>Jan Lorenz / Maja Seifert</strong><span class="origin">${court(4, true)}</span>${tiny('arrowUp', 'reorder', 'In Warteliste nach oben')}${tiny('close', 'remove-operator', 'Aus Warteliste entfernen')}</div></div>
          <div class="row small-space"><input aria-label="Tabletbediener hinzufügen" placeholder="Spieler suchen oder Name …" style="width:100%;font-size:10px;padding:5px 8px">${tiny('plus', 'operator-add', 'Tabletbediener hinzufügen')}</div>
          <details class="staff-list"><summary>Offizielle · 2 verfügbar, 1 wartet</summary><p>S. Weber · K. Wolf · T. Meier</p><div class="row small-space">${button('Zuweisen', 'officials', 'people', 'sm')}${button('Rotation', 'officials', 'refresh', 'sm')}</div></details>
        </section>
        <section class="control-card manual-call" data-board-card="announcement"><h2>${icon('mic')} Freie Durchsage</h2><textarea aria-label="Freie Durchsage" placeholder="Nachricht für die Halle eingeben …"></textarea><div class="row" style="gap:5px">${button('Lokal', 'announce', 'speaker')}${button('Remote', 'announce', 'export')}${button('Evakuierung', 'evacuate', 'alert', 'emergency')}</div></section>
        <section class="control-card device-locations" data-board-card="device"><h2>${icon('speaker')} Auf diesem Gerät <a href="#sprache" class="device-speech-link">Vorbereitung ${icon('arrow')}</a></h2>${deviceLocationTable()}<div class="device-audio-footer"><div>${checkbox('Freie Remote-Durchsagen',state.remoteAnnouncements,'remote-announcements')}<span class="audio-state">${icon('check')} Serveraudio bereit · Queue leer</span></div>${button('Sprachtest','audio-test','','sm')}</div></section>
        <section class="control-card automation-card" data-board-card="automation"><div class="row between"><h2 style="margin:0">${icon('court')} Automatik</h2>${tiny('settings', 'auto-settings', 'Automatik-Einstellungen')}</div><button class="automation-button ${state.auto ? '' : 'paused'}" data-action="automation">${icon(state.auto ? 'play' : 'pause')} ${state.auto ? 'Automatik aktiv' : 'Automatik pausiert'} ${icon(state.auto ? 'pause' : 'play')}</button><div class="automation-parts">${[['people','Rotation'],['mic','Vorbereitung'],['court','Feldaufruf'],['tablet','Tablet']].map(([symbol,label]) => `<button class="automation-part on" data-action="auto-part" aria-pressed="true" title="${label} umschalten">${icon(symbol)}${label}</button>`).join('')}</div></section>
      </div></div><div class="board-games">
      ${!state.auto ? `<div class="notice warn small-space">${icon('pause')} Globale Automatik pausiert. Freie Felder werden nicht automatisch belegt. ${button('Automatik starten', 'automation', 'play', 'sm')}</div>` : ''}
      <div class="toolbar"><div class="row">${search('Spiel, Name oder Disziplin suchen …')}<span class="row" data-field-counts>${fieldCounts()}</span></div><div class="row board-toolbar-actions">${button('Ansichten', 'views', 'monitor', 'sm')}${button('Werkzeuge', 'tools', 'more', 'sm')}${button(state.density === 'compact' ? 'Kompakt' : 'Komfort', 'density', 'logs', 'sm')}${button('Layout anpassen','layout-edit','layout','sm','aria-expanded="false"')}</div></div>
      <section class="panel" aria-label="Felder und aktuelle Spiele"><div class="table-wrap"><table class="match-table">${matchHead()}<tbody>${fields.map(fieldRow).join('')}</tbody></table></div></section>
      <div class="todo">${icon('bell')}<strong>1 Aufgabe</strong><span>MD U17: Die Anmeldung ist abgeschlossen.</span><a href="#anmeldung">Meldungen prüfen ${icon('arrow')}</a></div>
      <div class="section-header"><h2>Nicht zugewiesene Spiele <span class="title-count">68</span></h2><div class="row">${button('Aufrufgrenze: Spiel 50', 'boundary', 'flag', 'sm')}${button('Spiel anlegen', 'create-match', 'plus', 'sm')}</div></div>
      <details class="board-hints"><summary>${icon('info')}Vorbereitung · Campus Hellweg: ${preparationSelection.CH.current_preparation_count} / ${preparationSelection.CH.required_preparation_count} · ${preparationSelection.CH.missing_preparation_count} fehlen · Hinweise & Farblegende</summary><div class="board-hints-body">      <div class="explanation-strip">${icon('info')}Campus Hellweg: ${preparationSelection.CH.current_preparation_count} von ${preparationSelection.CH.required_preparation_count} Vorbereitungsspielen · ${preparationSelection.CH.missing_preparation_count} fehlen · Nächste freie Felder: 4, 13 · Mindestvorbereitung: 2 Minuten <a href="#" data-action="preparation-details" style="margin-left:auto;white-space:nowrap">Begründung ansehen</a></div>
      <div class="highlight-guide"><div><strong>BTP-Highlights bleiben erhalten</strong><small>Vorbereitungsfarben folgen dem Spielort. Anwesenheit und Sperrgründe stehen an der einzelnen Person.</small></div><div class="row wrap">${locations.map(place=>locationTag(place.id)).join('')}${button('Farbzuordnung', 'highlight-colors', 'settings', 'sm')}</div></div><div class="checkin-legend"><span><i class="attendance-sample checked-in"></i>Anwesend</span><span><i class="attendance-sample not-checked-in"></i>Noch nicht anwesend</span><span><i class="attendance-sample playing"></i>Spielt auf anderem Feld</span><span>${icon("tablet")}Tabletbindung</span><span class="muted">Check-in je Person · Name anklicken</span></div></div></details><section class="panel"><div class="table-wrap"><table class="match-table">${matchHead(true)}<tbody>${upcoming.map((g,i) => upcomingRow(g) + (i === 5 ? '<tr class="call-boundary"><td colspan="8">Aufrufgrenze · Spiel 50</td></tr>' : '')).join('')}</tbody></table></div></section>
      <details class="panel space"><summary style="padding:14px 18px;font-weight:650;font-size:12px">34 beendete Spiele <span class="muted" style="font-weight:400;margin-left:10px">Bestätigte Ergebnisse, Protokolle und Export</span></summary><div class="table-wrap"><table class="match-table">${matchHead()}<tbody>${finished.map(fieldRow).join('')}</tbody></table></div></details></div><aside class="board-sidebar" aria-label="Kacheln rechts neben den Spielen" hidden><h2 class="card-zone-heading">Rechte Sidebar <span>Auf schmalen Fenstern über den Spielen</span></h2><div class="sidebar-card-stack" data-card-zone="sidebar" aria-label="Kacheln in der rechten Sidebar"></div></aside></div>${footer()}`;
  }
  const settingTabs = [['allgemein','Allgemein','settings'], ['btp','BTP-Verbindung','refresh'], ['ablauf','Ablauf & Automatik','play'], ['felder','Felder & Spielorte','court'], ['sprache','Sprache & Ausgabe','mic'], ['anzeigen','Geräte & Anzeigen','monitor'], ['wertung','Wertung & Regeln','flag'], ['wartung','Daten & Wartung','folder']];
  function settingRow(label, description, control) { return `<div class="form-row"><div><label class="form-label">${label}</label><p>${description}</p></div><div>${control}</div></div>`; }
  function switchInput(checked = true, label = 'Einstellung') { return `<input class="switch" type="checkbox" ${checked ? 'checked' : ''} aria-label="${label}" data-save>`; }
  function settingsPage() {
    const tab = section || 'allgemein';
    const side = `<nav class="settings-nav" aria-label="Einstellungsbereiche"><div class="group-label">Turnier</div>${settingTabs.map(([id,label,symbol]) => `<a href="#einstellungen/${id}" class="${tab === id ? 'active' : ''}">${icon(symbol)}${label}</a>`).join('')}<div class="group-label">Weitere Werkzeuge</div><a href="#testlabor">${icon('flask')}Testlabor</a><a href="#logs">${icon('logs')}Diagnose</a></nav>`;
    let content = '';
    if (tab === 'allgemein') content = panel('Turnier', [
      settingRow('Turniername', 'Wird in der Turnierleitung und auf den Anzeigen verwendet.', '<input value="Jugend-Rangliste 2026" aria-label="Turniername" data-save>'),
      settingRow('Turnierkennung', 'Eindeutige Kennung für verbundene Geräte und Anzeigen.', '<input value="default" readonly aria-label="Turnierkennung" style="background:#f6f8f6;color:#87958a">'),
      settingRow('Sprache', 'Gilt für Oberfläche und Standarddurchsagen.', '<select aria-label="Sprache" data-save><option>Deutsch</option><option>Englisch</option><option>Niederländisch</option></select>'),
      settingRow('Zeitzone', 'Einheitliche Zeitangaben auf allen Ansichten.', '<select aria-label="Zeitzone" data-save><option>Europe/Berlin</option></select>'),
      settingRow('Turnierlogo', 'Logo für Anzeigen, Urkunden und Export.', `<div class="row"><span class="device-icon">${icon('court')}</span>${button('Logo auswählen', 'demo', 'upload', 'sm')}</div>`)
    ].join(''), badge('Turnierbezogen', 'neutral'), 'Allgemeine Angaben und Darstellung')
      + `<div class="space">${panel('Schnell zu den verbundenen Bereichen', `<div class="two-columns"><a class="download-card" href="#einstellungen/btp"><h3>${icon('refresh')}BTP-Verbindung ${icon('arrow')}</h3><p style="margin:0">Verbunden · letzter Abgleich vor 8 Sekunden</p></a><a class="download-card" href="#einstellungen/felder"><h3>${icon('court')}Felder & Spielorte ${icon('arrow')}</h3><p style="margin:0">Campus Hellweg · 13 aktive Felder</p></a></div>`)}</div>`;
    else if (tab === 'ablauf') content = panel('Automatischer Spielbetrieb', [
      settingRow('Gesamte Automatik', 'Vorbereitung, Feldaufrufe und Zuweisungen gemeinsam steuern.', switchInput(true, 'Gesamte Automatik')),
      settingRow('Spiele in Vorbereitung aufrufen', 'Die nächsten geeigneten Spiele automatisch ankündigen.', switchInput()),
      settingRow('Spiele auf freie Felder aufrufen', 'Vorbereitete Begegnungen auf verfügbare Felder verteilen.', switchInput()),
      settingRow('Mindestzeit in Vorbereitung', 'Zeit zwischen Vorbereitungsaufruf und Feldaufruf.', '<div class="row"><input type="number" value="2" min="0" aria-label="Minuten in Vorbereitung" data-save style="width:90px"><span class="hint">Minuten</span></div>'),
      settingRow('Spielerbereitschaft', 'Für den Feldaufruf müssen alle Spieler angemeldet sein.', '<select aria-label="Spielerbereitschaft" data-save><option>Alle Spieler eingecheckt</option><option>Spielerpause abgelaufen</option><option>Ohne Prüfung</option></select>')
    ].join(''), badge('Aktiv', 'good'), 'Dieselben Einstellungen wie im Leitstand')
    + `<div class="space">${panel('Tabletbediener & Offizielle', settingRow('Tabletbediener einsetzen', 'Verlierer der vorherigen Begegnung für einen neuen Einsatz einreihen.', switchInput()) + settingRow('Zuweisung', 'Bediener bleiben möglichst im vertrauten Bereich.', '<select aria-label="Zuweisung" data-save><option>Vom selben Feld</option><option>Vom selben Spielort</option><option>Turnierweit</option></select>') + settingRow('Rotation technischer Offizieller', 'Schiedsrichter und Aufschlagrichter getrennt berücksichtigen.', '<select aria-label="Rotation" data-save><option>Schieds- und Aufschlagrichter</option><option>Nur Schiedsrichter</option><option>Deaktiviert</option></select>'))}</div>`;
    else if (tab === 'btp') content = panel('BTP-Verbindung', settingRow('Verbindungsstatus', 'Änderungen werden in beide Richtungen abgeglichen.', badge('Mit BTP verbunden', 'good', true)) + settingRow('BTP-Adresse', 'Adresse des Tournament-Planner-Rechners.', '<input value="192.168.178.20" aria-label="BTP-Adresse" data-save>') + settingRow('Automatisch abgleichen', 'Spielstände, Spieler und Reihenfolgen übernehmen.', switchInput()) + settingRow('Abgleichintervall', 'Geänderte Daten werden ohne vollständigen Seitenaufbau übernommen.', '<div class="row"><input type="number" value="30" data-save aria-label="Abgleichintervall" style="width:90px"><span class="hint">Sekunden</span></div>') + settingRow('Manuell synchronisieren', 'Letzter erfolgreicher Abgleich vor 8 Sekunden.', button('Jetzt abgleichen', 'sync', 'refresh', 'sm')), badge('Verbunden', 'good'));
    else if (tab === 'sprache') content = panel('Sprachausgabe', settingRow('Ausgabemodus', 'Lokales Serveraudio mit Browser-Fallback.', '<select aria-label="Ausgabemodus" data-save><option>Automatisch · Server bevorzugen</option><option>Nur Server</option><option>Browser</option></select>') + settingRow('Stimme', 'Einheitliche Standardstimme für dieses Turnier.', '<select aria-label="Stimme" data-save><option>Hallensprecher</option><option>Hallensprecherin</option></select>') + settingRow('Andere Stimme vorbereiten', 'Zusätzliche Vorbereitung erst nach dem Vorrat der gewählten Stimme.', switchInput(false)) + settingRow('Sprachvorbereitung', 'Fortschritt, einzelne Spiele und Helfer anzeigen.', `<div class="row">${button('Vorbereitung öffnen', 'speech-link', 'arrow', 'sm')}<a class="btn sm" href="#helfer">Sprachhelfer</a></div>`), badge('Serveraudio bereit', 'good')) + `<div class="space">${panel('Durchsagen', settingRow('Treffpunkt vor dem Spiel', 'Hinweis für die Vorbereitung und Tabletbediener.', '<input value="Bitte meldet euch bei der Turnierleitung!" data-save aria-label="Treffpunkthinweis">') + settingRow('Spielnummer & Disziplin nennen', 'Gemeinsame Einstellungen für alle Hallenansagen.', switchInput()) + settingRow('Sprachprobe', 'Die gewählte Stimme lokal prüfen.', button('Testdurchsage anhören', 'audio-test', 'speaker', 'sm')))}</div>`;
    else if (tab === 'felder') content = panel('Vorbereitungsfarben · wie in BTP', `<p class="hint">Jede Halle behält ihre vorhandene Highlight-Klasse. Die sechs Farben entsprechen unverändert den BTP-Farben. Die zweite Halle dient hier nur als Beispiel.</p>${locationColors()}<div class="row wrap space">${highlights.slice(1).map(([id,name])=>`<span class="location-tag"><i class="highlight-swatch highlight_${id}"></i>${id} · ${name}</span>`).join('')}</div>`) + `<div class="space">` + panel('Spielorte & Felder', `<div class="row between"><div><strong>Campus Hellweg</strong><p class="hint">CH · 13 Felder · Vorbereitung an der Turnierleitung</p></div>${button('Spielort bearbeiten', 'demo', 'edit', 'sm')}</div><div class="space table-wrap"><table><thead><tr><th>Feld</th><th>Bezeichnung</th><th>Aktiv</th><th>Anzeige</th><th></th></tr></thead><tbody>${fields.map(g => `<tr><td>${court(g.field)}</td><td>Feld ${String(g.field).padStart(2,'0')}</td><td>${switchInput()}</td><td><a href="#geraete">Anzeige ${String(g.field).padStart(2,'0')}</a></td><td>${tiny('edit','demo','Feld bearbeiten')}</td></tr>`).join('')}</tbody></table></div>`, button('Feld hinzufügen', 'demo', 'plus', 'sm')) + '</div>';
    else if (tab === 'anzeigen') content = panel('Geräte & Darstellung', settingRow('Standarddarstellung', 'Vorlage für Spielstandanzeigen.', '<select aria-label="Anzeigedarstellung" data-save><option>International</option><option>Standard</option></select>') + settingRow('Tablet-Darstellung', 'Darstellung auf den Zähltablets.', '<select aria-label="Tabletdarstellung" data-save><option>Turnierstandard</option></select>') + settingRow('Werbung & Logos', 'Anzeigetexte und Bildmaterial verwalten.', button('Inhalte verwalten', 'demo', 'edit', 'sm')) + settingRow('Ticker', 'Ergebnisse an den verbundenen Ticker übertragen.', switchInput()) + settingRow('Verbundene Seiten', 'Status, Versionen und zentrales Neuladen.', '<a class="btn sm" href="#geraete">Geräte öffnen</a>'), button('Vorschau', 'views', 'monitor', 'sm'));
    else if (tab === 'wertung') content = panel('Wertung & Spielformate', settingRow('Standard-Zählweise', 'Die Disziplin kann ein eigenes Format verwenden.', '<select aria-label="Zählweise" data-save><option>2 Gewinnsätze · 21 Punkte · bis 30</option><option>3 Gewinnsätze · 11 Punkte</option></select>') + settingRow('Zählweisen je Disziplin', 'Sätze, Seitenwechsel und Pausen beibehalten.', button('Formate bearbeiten', 'demo', 'edit', 'sm')) + settingRow('Ranglisten', 'Importzuordnung nach Disziplin und Altersklasse.', '<a class="btn sm" href="#anmeldung/ranglisten">Ranglisten öffnen</a>') + settingRow('Urkunden & Export', 'Sieger, Platzierungen und turnierspezifische Vorlagen.', button('Export öffnen', 'export', 'download', 'sm')));
    else content = panel('Sicherung & Übertragung', `<div class="notice">${icon('shield')} Datensicherung vor Änderungen am Turnierbestand erstellen.</div><div class="row wrap space">${button('Datenbank herunterladen', 'backup', 'download')}${button('Sicherung importieren', 'backup', 'upload')}${button('Turnier exportieren', 'export', 'export')}</div>`)
      + `<div class="space">${panel('Wartungsaktionen', settingRow('Feldzuweisungen entfernen', 'Nur noch nicht laufende Spiele. Die Änderung wird auch an BTP übertragen.', button('Feldzuweisungen entfernen', 'maintenance-fields', 'court', 'sm danger')) + settingRow('Spielerpausen zurücksetzen', 'Gespeicherte Pausen dieses Turniers zurücksetzen.', button('Pausen zurücksetzen', 'maintenance-pause', 'refresh', 'sm danger')) + settingRow('Sprachcache', 'Erzeugte Sprachaufnahmen verwalten. Modelle bleiben getrennt.', button('Sprachaufnahmen verwalten', 'maintenance-cache', 'mic', 'sm')) + settingRow('Datenbank löschen', 'Turnierdaten vollständig entfernen. Vorher eine Sicherung erstellen.', button('Datenbank löschen', 'maintenance-delete', 'alert', 'sm danger')), badge('Mit Bestätigung', 'warn'))}</div>`;
    return `${heading('Einstellungen', 'Alle Turniereinstellungen an einem Ort.', `<span class="setting-state">${icon('check')}<span id="save-status">${state.settingStatus}</span></span>`)}<div class="settings-layout">${side}<div>${content}</div></div>${footer()}`;
  }
  function stageNavigation() { return `<nav class="priority-nav" aria-label="Reihenfolge der Sprachvorbereitung">${priorities.map(([label,count],i) => `${[0,4,7,10,12].includes(i) ? `<div class="priority-label">${({0:'Turniervorarbeit',4:'Aktueller Spielbetrieb',7:'Vorbereitung',10:'Weiterer Vorrat',12:'Leerlauf'})[i]}</div>` : ''}<button class="${state.stage === i ? 'active' : ''}" data-action="stage" data-stage="${i}"><span class="index">${String(i+1).padStart(2,'0')}</span><span>${label}<small>${count}</small></span>${i<9 ? '<span class="done-mark">✓</span>' : ''}</button>`).join('')}</nav>`; }
  function queue() { return `<aside class="queue-card"><div class="row between"><h2>Konkrete Queue</h2>${badge('2 laufen', 'warn')}</div><small style="display:block;margin-top:5px">Sprachserver + 1 Helfer · 4 warten</small><div class="queue-items">
    <div class="queue-item active"><span class="eyebrow">Sprachhelfer · wird erzeugt</span><strong>Finn Sommer spielt jetzt gegen Finn Sommer!</strong><p>Hallensprecher · Kontextaufnahme</p><a href="#sprache">MX U19 → Spieler/Paarungen ${icon('arrow')}</a></div>
    <div class="queue-item active"><span class="eyebrow">Sprachserver · Ausschnitt</span><strong>Mia Becker und Finn Sommer</strong><p>Hallensprecher · Aufbereitung</p><a href="#sprache">MX U19 → Spieler/Paarungen ${icon('arrow')}</a></div>
    <div class="queue-item"><span class="eyebrow">Als Nächstes</span><strong>Lena Hoffmann</strong><p>Quellaufnahme bereit · Ausschnitt</p></div>
    <div class="queue-item"><span class="eyebrow">Danach</span><strong>Noah Weber</strong><p>Benötigte Kontextaufnahme</p></div></div><div class="notice small-space" style="font-size:9px;padding:8px">Fertige Aufnahmen werden wiederverwendet. Dringende Durchsagen haben Vorrang.</div></aside>`; }
  function workBanner() { return `<section class="current-work"><div class="grow"><div class="eyebrow">Wird gerade vorbereitet · 2 Generatoren aktiv</div><h2>Namen und Paarungen für Mixed U19</h2><p>Hallensprecher · nächste benötigte Bausteine in Disziplinreihenfolge</p><div class="row between small-space"><small style="color:#afc7b7">924 von 1.982 Bausteinen bereit</small><small style="color:#afc7b7">47 %</small></div>${progress(47)}</div><div class="reason"><strong>Warum dieser Bereich?</strong>Aktuelle Spielaufrufe sind vorbereitet. Es folgen die noch fehlenden Bausteine der angemeldeten Disziplinen.</div></section>`; }
  function speechOverview() {
    const selectedStage = priorities[state.stage];
    if (state.stage !== 9) {
      const examples = [
        ['Tatsächlich ausgelöste Durchsagen zuerst, in ihrer Auslösereihenfolge.', 'Spiel 43 · Aufruf auf Feld 09', 'Tabletbedienung für Feld 13'],
        ['Sprachtest immer vorbereiten, auch ohne ausdrückliche Anforderung.', 'Dies ist ein Sprachtest der Turnierleitung.'],
        ['Gemeinsame Feld-, Hallen- und Treffpunkttexte werden wiederverwendet.', 'Auf Spielfeld neun!', 'Für Spielfeld dreizehn!', 'Bitte meldet euch bei der Turnierleitung!'],
        ['Technische Offizielle nach dem bekannten Turnierbedarf vorbereiten.', 'Keine technischen Offiziellen im Beispielturnier'],
        ['Vorgemerkte Tabletbediener vor den laufenden Spielen vorbereiten.', 'Tom Keller und Anna Schäfer', 'Jan Lorenz und Maja Seifert'],
        ['Laufende Spiele in ihrer Aufrufreihenfolge berücksichtigen.', 'Spiel 43 · Feld 09', 'Spiel 44 · Feld 01'],
        ['Spiele in Vorbereitung und ihre nächsten Durchsagen bereithalten.', 'Spiel 45 · Mixed U15', 'Spiel 46 · Mixed U15'],
        ['Spiele bis zur Aufrufgrenze mit feststehenden Teilnehmern, die noch nicht in Vorbereitung sind.', 'Spiel 48 · Mixed U15', 'Spiel 50 · Mixed U17'],
        ['Weitere Spiele folgen der normalen Spielplanreihenfolge.', 'Spiel 51 · Mixed U17', 'Spiel 52 · Mixed U17'],
        [],
        ['Gemeldete Spieler und Paarungen in Disziplinreihenfolge vorbereiten.', 'MD U17 · bekannte Meldungen', 'Weitere bekannte Paarungen'],
        ['Verbleibende mögliche Tabletbediener und bekannte Namen ergänzen.', 'Weitere bekannte Einzelspieler', 'Bekannte Paarungen außerhalb des Hauptfelds'],
        ['Eine andere Stimme erst nach dem Vorrat der gewählten Stimme vorbereiten.', 'Option im Beispiel ausgeschaltet']
      ][state.stage];
      return `${heading('Sprachvorbereitung', 'Was als Nächstes vorbereitet wird – und warum.', badge('Live · automatisch aktualisiert','good',true))}${speechNav()}${workBanner()}${prepTabs()}<div class="speech-layout">${stageNavigation()}${panel(`${String(state.stage+1).padStart(2,'0')} · ${selectedStage[0]}`, `<div class="notice">${examples[0]}</div><div class="row space">${badge(selectedStage[1],state.stage<9?'good':'neutral')}</div><div class="mapping-list">${examples.slice(1).map(text=>`<div>${icon(state.stage<9?'check':'clock')}<span class="grow">${text}</span>${state.stage<9?badge('Bereit','good'):badge(state.stage===12?'Deaktiviert':'Später an der Reihe')}</div>`).join('')}</div>`, badge(state.stage<9?'Bereit':'Weiterer Vorrat',state.stage<9?'good':'neutral'), 'Ausgewählter Bereich · Beispieldaten')}${queue()}</div>${footer()}`;
    }
    const disciplines = [['MX U15','48 · 11:00',21,75,148,8],['MX U17','49 · 11:00',24,63,148,8],['MX U19','57 · 11:30',24,66,119,2],['MX U13','65 · 11:30',24,66,148,5]];
    return `${heading('Sprachvorbereitung', 'Was als Nächstes vorbereitet wird – und warum.', badge('Live · automatisch aktualisiert','good',true))}${speechNav()}${workBanner()}${prepTabs()}
      <div class="speech-layout">${stageNavigation()}<div class="stack">${panel(`<span class="muted" style="font-weight:450;margin-right:7px">${String(state.stage+1).padStart(2,'0')}</span>${selectedStage[0]}`, `<p class="hint">Jede Disziplin vollständig vorbereiten: Landesverbände → Vereine → Spieler/Paarungen → Spielnummern der ersten Runde.</p><div class="row small-space"><strong style="font-size:11px;color:var(--green)">622 bereit</strong><small>4 in der Queue · 651 gesamt</small></div>${progress(95)}<div class="table-wrap space"><table class="discipline-table"><thead><tr><th>Disziplin</th><th>1 · Verbände</th><th>2 · Vereine</th><th>3 · Spieler/Paarungen</th><th>4 · Nummern</th></tr></thead><tbody>${disciplines.map(([name,next,associations,clubs,people,numbers],i) => `<tr><td class="discipline"><strong>${i+1}. ${name}</strong><small>Nächstes Spiel ${next}</small><small>${i===2?'32 Spieler · 16 Paarungen':'32 Spieler · 16 Paarungen'}</small></td>${[associations,clubs,people,numbers].map((n,j) => `<td class="phase ${i===2&&j===2?'active':''}"><strong>${n} bereit</strong><span style="float:right;color:#6b967d">${i===2&&j===2?'•':'✓'}</span>${progress(i===2&&j===2?81:100)}<small>${i===2&&j===2?'2 Queue · 148 gesamt':`${n} / ${n} gesamt`}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div>`, badge('In Bearbeitung','warn'), 'Anwesende Spieler, bekannte Paarungen und Nummern der ersten Runde')}
      ${panel('Ausgewählte Phase · MX U19', `<div class="row between"><div><strong>Spieler und Paarungen</strong><p class="hint small-space">119 von 148 Bausteinen bereit. Gemeinsame Namen werden nur einmal erzeugt.</p></div>${badge('2 Generatoren aktiv','good')}</div><div class="mapping-list"><div>${icon('check')}Landesverbände und Vereine sind bereits vollständig.</div><div>${icon('mic')}Finn Sommer · Kontextquelle wird auf dem Helfer erzeugt.</div><div>${icon('play')}Mia Becker und Finn Sommer · Ausschnitt wird aufbereitet.</div></div>`, button('Details', 'speech-details', 'info', 'sm'))}</div>${queue()}</div>${footer()}`;
  }
  function speechGames() {
    const games = [
      [43,'field','Auf Feld 09','MX U15',pairs[1],pairs[6]], [44,'field','Auf Feld 01','MX U15',pairs[2],pairs[7]],
      [45,'prep','In Vorbereitung seit 4:49','MX U15',pairs[13],pairs[14],'CH'], [46,'prep','In Vorbereitung seit 3:36','MX U15',pairs[15],pairs[16],'SN'],
      [48,'candidate','Aufrufkandidat','MX U15',pairs[1],pairs[2]], [49,'done','Beendet auf Feld 06','MX U17',pairs[3],pairs[4]], [51,'planned','Teilnehmer offen','MX U17',pairs[7],'Gewinner aus Spiel 24']
    ];
    return `${heading('Sprachvorbereitung', 'Spiele in ihrer normalen Spielplanreihenfolge.', badge('Live · automatisch aktualisiert','good',true))}${speechNav()}${prepTabs()}<div class="toolbar"><div class="row">${search('Spiel, Spieler oder Disziplin …')}<label class="filter-label">Spielstatus<select data-change="game-filter" aria-label="Spielstatus"><option value="all">Alle Spiele</option><option value="unfinished">Nicht beendet</option><option value="prep">In Vorbereitung</option><option value="field">Auf dem Feld</option><option value="candidate">Aufrufkandidaten</option></select></label></div><div class="row">${badge('143 Spiele','neutral')}${badge('28 vollständig bereit','good')}</div></div>
      <section class="panel"><div class="table-wrap"><table class="games-table"><thead><tr><th>Spiel & Status</th><th>Begegnung</th><th>Gesamt</th><th>Spielaufruf</th><th>Vorbereitung</th><th>Spielbeginn</th><th>Weitere Aufrufe</th></tr></thead><tbody>${games.map(([n,s,label,event,a,b,location,highlight=0]) => `<tr class="${s} btp-highlight highlight_${gameHighlight({state:s,location,highlight})}" ${highlightAttributes({state:s,location,highlight})} data-search-row data-status="${s}" data-search="${esc(`${n} ${event} ${a} ${b}`.toLowerCase())}"><td style="min-width:210px"><button class="game-number-btn" data-action="speech-details" data-number="${n}">▸ ${n}</button><strong style="margin-left:10px;font-size:11px">11:00 · ${event} · VF</strong><div class="small-space">${matchStatus(label.replace(/(0[169])$/, value => court(Number(value),true)),s==='prep'?'clock':s==='field'?'play':s==='candidate'?'arrow':s==='done'?'check':'info')}</div></td><td style="min-width:240px">${a}<small>gegen</small>${b}${location?`<small>${locationTag(location)}</small>`:''}</td>${[19,9,10,2,15].map((count,i) => `<td>${badge(n===51&&i===0?'Vorrat vorhanden':'Bereit','good')}<small>${count}/${count} Bausteine bereit</small></td>`).join('')}</tr>`).join('')}</tbody></table></div></section><div class="notice space">${icon('info')} Auch vor der Feldwahl kann eine Durchsage bereit sein: Alle benötigten Feld- und Teilnehmerbausteine sind dann bereits vorhanden.</div>${footer()}`;
  }
  function speechDiagram() {
    return `${heading('Sprachvorbereitung', 'Derselbe Ablauf als Zustandsdiagramm.', badge('Live · automatisch aktualisiert','good',true))}${speechNav()}${prepTabs()}<div class="toolbar"><p class="hint">Fertige Bereiche werden übersprungen. Jeder Auftrag wird anschließend neu priorisiert.</p><div class="row">${button('Gesamtbreite','demo','monitor','sm')}${button('SVG / PDF','export','download','sm')}</div></div>
    <div class="speech-layout" style="grid-template-columns:minmax(0,1fr) 270px"><section class="panel"><div class="panel-body" style="padding:25px"><div class="diagram-decision">Planungsstand bekannt · lokale Generierung aktiv</div><div class="diagram-line"></div><h2>Turniervorarbeit</h2><div class="process-line">${[['01','Durchsagen','15 / 15 bereit'],['02','Sprachtest','1 / 1 bereit'],['03','Spielorte & Felder','41 / 41 bereit'],['04','Offizielle','Kein Bedarf']].map(([n,t,p])=>`<div class="process-step"><small>${n}</small><strong>${t}</strong><small>${p}</small>${progress(100)}</div>`).join('')}</div><div class="diagram-line"></div><h2>Spielbetrieb</h2><div class="process-line">${[['05','Tabletbediener','8 / 8 bereit'],['06','Laufende Spiele','75 / 75 bereit'],['07','Vorbereitung','21 / 21 bereit'],['08','Aufrufkandidaten','37 / 37 bereit']].map(([n,t,p])=>`<div class="process-step"><small>${n}</small><strong>${t}</strong><small>${p}</small>${progress(100)}</div>`).join('')}</div><div class="diagram-line"></div><div class="row between"><h2>10 · Angemeldete Disziplinen</h2>${badge('MX U19 wird vorbereitet','warn')}</div><p class="hint small-space">Innerhalb jeder Disziplin von links nach rechts, dann zur nächsten Zeile.</p>${['MX U15','MX U17','MX U19'].map((name,i)=>`<div class="row small-space"><strong style="width:62px;font-size:11px">${name}</strong><div class="process-line grow" style="padding:8px 0">${['Verbände','Vereine','Spieler/Paarungen','Nummern · 1. Runde'].map((t,j)=>`<div class="process-step ${i===2&&j===2?'current':''}"><strong>${t}</strong><small>${i===2&&j===2?'119 / 148 bereit · 2 laufen':'Vollständig bereit'}</small></div>`).join('')}</div></div>`).join('')}<div class="diagram-line"></div><div class="diagram-decision">Danach: Anmeldevorarbeit und weiterer Vorrat</div></div></section>${queue()}</div>${footer()}`;
  }
  function helperPage() {
    return `${heading('Sprachhelfer', 'Weitere Rechner unterstützen die Sprachvorbereitung.', `<a class="btn" href="#sprache">${icon('arrow')}Vorbereitung ansehen</a>`)}${speechNav()}
      <div class="metric-grid">${[['Aktive Generatoren','2','Sprachserver + 1 Helfer'],['Helfer erledigt','84','Heute erzeugte Kontextaufnahmen'],['In Bearbeitung','2','Beide Generatoren sind beschäftigt'],['Fertig vorbereitet','924','Bausteine der gewählten Stimme']].map(([l,n,s])=>`<div class="metric"><small>${l}</small><strong>${n}</strong><small class="trend">${s}</small></div>`).join('')}</div>
      ${panel('Verbundene Rechner', `<div class="table-wrap"><table><thead><tr><th>Rechner</th><th>Status & aktueller Auftrag</th><th>Freigegebene Ressourcen</th><th>Erledigt</th><th class="right">Aktionen</th></tr></thead><tbody><tr><td><div class="row"><span class="device-icon">${icon('monitor')}</span><div><strong>TIM-THINKPAD</strong><small style="display:block">Windows 11 · WSL 2 · verbunden</small></div></div></td><td>${badge(state.helpersPaused?'Pause nach Auftrag':'Erzeugt Audio',state.helpersPaused?'neutral':'prep',true)}<small style="display:block;margin-top:5px">Finn Sommer · Hallensprecher</small></td><td><span>4 CPU-Kerne · 3,5 GiB Modell-RAM</span><div class="resource-track"><span style="width:50%"></span></div></td><td class="num">84</td><td class="right">${button('Test','helper-test','play','sm')}${button(state.helpersPaused?'Fortsetzen':'Pause','helper-pause',state.helpersPaused?'play':'pause','sm')}${button('Trennen','helper-disconnect','','sm')}</td></tr></tbody></table></div>`, button('Rechner verbinden','connect-helper','plus','primary sm'), 'Ressourcen werden ausschließlich vom Nutzer am Helferrechner freigegeben.', 'Pause lässt den laufenden Auftrag fertig werden. Trennen entzieht den Zugang und gibt einen offenen Auftrag wieder frei.')}
      <div class="two-columns space">${panel('Weiteren Rechner verbinden', `<p class="hint">Der Starter erklärt Download, Ressourcen und Änderungen vor dem Start. Der Nutzer entscheidet selbst und kann jederzeit stoppen oder den Helfer entfernen.</p><label class="form-label space">Erreichbare BTS-Adresse<input style="width:100%;margin-top:7px" value="https://bts.turnier.lokal:4434" aria-label="BTS-Adresse"></label><div class="row wrap space">${button('Windows · EXE','helper-download','download','primary')}${button('Linux · SH','helper-download','download')}</div><p class="hint small-space">CPU-Version · Laufzeit einmalig ca. 2,0 GiB</p>`)}
      ${panel('Letzte Testaufnahme', `<div class="row between">${badge('Bereit','good')}<small>TIM-THINKPAD · Hallensprecher</small></div><p class="small-space" style="font-size:12px;line-height:1.8">„Dies ist eine Testaufnahme des BTS-Sprachhelfers. Bitte meldet euch bei der Turnierleitung!“</p>${audioPlayer('0:08')}<p class="hint small-space">Die Hörprobe bestätigt Stimme und Aussprache auf diesem Helfer.</p>`,button('Neue Testaufnahme','helper-test','mic','sm'))}</div>${footer()}`;
  }
  function audioPlayer(duration='0:06') { return `<div class="audio-player"><button class="play-button" data-action="audio-play" aria-label="Hörprobe in der Vorschau abspielen">${icon('play')}</button><small>0:00 / ${duration}</small><span class="track"><span></span></span>${icon('speaker')}<small>1×</small></div>`; }
  function waveform() { return `<div class="waveform" aria-label="Schematische Wellenform einer Sprachaufnahme">${Array.from({length:100},(_,i)=>`<span style="height:${8+Math.abs(Math.sin(i*1.7)*Math.cos(i*.36))*43}px"></span>`).join('')}</div>`; }
  function listeningPage(editor=false) {
    if (editor) return `${heading('Kontexteditor','Aufnahmen prüfen, Ausschnitte festlegen und Varianten vergleichen.',`${button('Rezept laden','demo','upload')}${button('Rezept exportieren','export','download','primary')}`)}${speechNav()}
      <div class="two-columns" style="grid-template-columns:minmax(0,1.5fr) minmax(270px,1fr)"><div class="stack">
      ${panel('1 · Kontextaufnahme', `<div class="form-grid"><label>Stimme<select><option>Hallensprecher</option><option>Hallensprecherin</option></select></label><label>Aufnahme<select><option>Spiel um Platz fünf und sechs</option><option>Freier Text</option></select></label><label class="wide">Vollständiger Kontextsatz<textarea rows="4">Auf Spielfeld vier! Spielnummer einhundertelf. Mixed U17. Spiel um Platz fünf und sechs! Mia Becker gegen Finn Sommer. Auf Spielfeld vier!</textarea></label></div><div class="row space">${button('Kontext erzeugen / aus Cache laden','context-generate','mic','primary')}${badge('Bereits vorhanden','good')}</div>`)}
      ${panel('2 · Ausschnitt festlegen', `${waveform()}${audioPlayer('0:09')}<div class="form-grid space"><label>Start (Sekunden)<input type="number" value="3.21" step=".01"></label><label>Ende (Sekunden)<input type="number" value="4.82" step=".01"></label><label class="wide">Gesprochener Ausschnitt<input value="Spiel um Platz fünf und sechs!"></label></div><div class="row space">${button('Bereich vorhören','audio-test','play')}${button('Ausschnitt speichern','demo','check','primary')}</div>`)}
      </div><div class="stack">${panel('3 · Durchsage zusammensetzen', `<p class="hint">Bausteine auswählen und ihre Reihenfolge vergleichen.</p><div class="mapping-list">${['Auf Spielfeld vier!','Spielnummer einhundertelf.','Mixed U17.','Spiel um Platz fünf und sechs!','Mia Becker gegen Finn Sommer.','Auf Spielfeld vier!'].map((t,i)=>`<div style="padding:9px 10px;background:${i===3?'#f2e9fd':'#f3f6f4'};border-radius:5px"><small style="margin-right:8px">${i+1}</small><span class="grow">${t}</span>${tiny('arrowUp','reorder','Baustein nach oben')}</div>`).join('')}</div><div class="space">${button('Variante zusammensetzen','context-assemble','play','primary')}</div>`)}${panel('Prüfung', `${badge('Ausschnitt bereit','good')}<div class="mapping-list"><div>${icon('clock')}1,61 Sekunden · Tempofaktor 1,0</div><div>${icon('check')}Mit vollständigem Kontext erzeugt</div><div>${icon('speaker')}Original und Variante getrennt anhören</div></div>`)}<div class="notice">Dieser Bereich ist für bewusste Sprachversuche gedacht. Turnierdurchsagen bleiben in der Vorbereitung sichtbar.</div></div></div>${footer()}`;
    return `${heading('Hörlabor', 'Stimmen, Kontext und Sprechtempo vor dem Einsatz vergleichen.', button('Vergleich exportieren','export','download'))}${speechNav()}
      ${panel('Vergleich vorbereiten', `<div class="form-grid"><label class="wide">Ansagetext<textarea rows="2">Spiel um Platz fünf und sechs!</textarea></label><label>Stimmen<select><option>Hallensprecher und Hallensprecherin</option><option>Nur Hallensprecher</option><option>Nur Hallensprecherin</option></select></label><label>Aufnahmeart<select><option>Mit längerem Kontextsatz</option><option>Vorhandenen Cache prüfen</option></select></label></div><div class="row between space"><div class="row">${button('Vergleich erzeugen','lab-generate','mic','primary')}${badge('2 vorhandene Aufnahmen','good')}</div><details><summary class="hint">Weitere Parameter</summary><p class="hint">Seed 42 · Tempofaktor 1,0 · identischer Kontext</p></details></div>`)}
      <div class="two-columns space">${['Hallensprecher','Hallensprecherin'].map((voice,i)=>panel(voice, `${waveform()}${audioPlayer(i?'0:02':'0:01')}<div class="row between space"><span class="hint">Dauer <strong style="color:var(--ink)">${i?'1,78':'1,61'} s</strong></span><span class="hint">Kontextquelle ${badge('Vorhanden','good')}</span></div><label class="filter-label space">Hörtempo <input type="range" min=".7" max="1.3" value="1" step=".05" data-change="tempo"><span class="tempo-value">1,0×</span></label><div class="row space">${button('Passt','lab-rating','check','sm')}${button('Aussprache prüfen','lab-rating','flag','sm')}</div>`,badge('Aus Cache','neutral'))).join('')}</div><div class="notice space">${icon('info')} Der Hörtempo-Regler verändert nur die Vorschau. Originalaufnahmen und Turnieransagen bleiben unverändert.</div>${footer()}`;
  }
  const registrationRows = pairs.slice(0,10).map((name,i)=>({name,points:i===9?0:1880-i*135,partner:i===9?0:1260-i*81,status:i<7?'Anwesend':i===9?'Nicht erschienen':'Angemeldet'}));
  function registrationPage() {
    const tab = section || 'anmeldung';
    return `${heading('Anmeldung & Meldungen','Spieler, Paarungen und Ranglisten gemeinsam verwalten.',`${button('Rangliste importieren','ranking-import','upload')}${button('Auslosung / BTP','draw-info','flag','primary')}`)}${subnav([['anmeldung/anmeldung','Anmeldung'],['anmeldung/kontrolle','Meldungskontrolle'],['anmeldung/ranglisten','Ranglisten & Punkte']])}
      <div class="metric-grid">${[['Disziplinen','16','8 ausgelost · 4 Anmeldung geschlossen'],['Gemeldete Spieler','248','235 anwesend'],['Paarungen','124','118 vollständig anwesend'],['Noch offen','13','Spielerstatus prüfen']].map(([l,n,s])=>`<div class="metric"><small>${l}</small><strong>${n}</strong><small class="trend">${s}</small></div>`).join('')}</div>
      <div class="toolbar"><div class="row"><label class="filter-label">Disziplin<select aria-label="Disziplin"><option>Mixed U17</option><option>Mixed U15</option><option>Mixed U19</option></select></label>${search('Name, Verein oder Spielernummer …')}</div><div class="row">${badge('Ausgelost','good')}${button('Anmeldung verwalten','registration-settings','settings','sm')}</div></div>
      ${tab==='ranglisten'?`<div class="notice space" style="margin-bottom:17px">${icon('info')} U9 bis U19: U19-Rangliste · U22 bis O90: O19-Rangliste. Nicht gefundene Spieler zählen mit 0 Punkten. ${button('Zuordnung bearbeiten','ranking-import','edit','sm')}</div>`:''}
      <section class="panel"><div class="table-wrap"><table><thead><tr><th style="width:35px"><input type="checkbox" aria-label="Alle Paarungen auswählen" data-change="select-all"></th><th>Paarung</th><th>Verein / Landesverband</th><th>Spieler 1</th><th>Spieler 2</th><th><button data-action="sort-points" class="btn ghost sm" style="padding:0;min-height:0">Σ Punkte ${icon('sort')}</button></th><th>Status</th><th>Anwesend</th><th></th></tr></thead><tbody id="registration-rows">${registrationRows.map((r,i)=>registrationRow(r,i)).join('')}</tbody></table></div><div class="panel-foot row between"><span>10 von 16 Paarungen · nach Gesamtpunkten absteigend</span><div class="row"><a href="#" data-action="demo">Zurück</a><span>1 / 2</span><a href="#" data-action="demo">Weiter ${icon('chevron')}</a></div></div></section>
      <div class="two-columns space">${panel('Disziplinstatus', `<div class="mapping-list"><div>${icon('check')}Anmeldung abgeschlossen</div><div>${icon('check')}16 Paarungen ausgelost</div><div>${icon('check')}Geloste Spieler gelten für die Sprachvorbereitung als anwesend</div></div>`)}${panel('Aktionen für ausgewählte Meldungen', `<div class="row wrap">${button('Anwesend setzen','registration-mark','check')}${button('Kommentar','demo','edit')}${button('Exportieren','export','download')}</div><p class="hint space">Rangliste: U19 · Zuordnung JE, ME, JD, MD, MX · Datenstand 19.09.2026</p>`)}</div>${footer()}`;
  }
  function registrationRow(r,i) { return `<tr data-search-row data-search="${esc(r.name.toLowerCase())}"><td><input class="row-select" type="checkbox" aria-label="${esc(r.name)} auswählen"></td><td><strong style="font-size:12px">${r.name}</strong><small style="display:block">Meldung ${i+1} · Startnummer ${120+i}</small></td><td>BC Weststadt / TV Nord<small style="display:block">Nordrhein-Westfalen</small></td><td class="num">${r.points.toLocaleString('de-DE')}</td><td class="num">${r.partner.toLocaleString('de-DE')}</td><td class="num" style="font-weight:700">${(r.points+r.partner).toLocaleString('de-DE')}</td><td>${badge(r.status,r.status==='Anwesend'?'good':r.status==='Nicht erschienen'?'error':'neutral')}</td><td>${switchInput(i<7,'Anwesend '+r.name)}</td><td>${tiny('edit','registration-edit','Meldung bearbeiten')}</td></tr>`; }
  const deviceRows = [
    ['Turnierleitung · Laptop','Adminansicht','Campus Hellweg','Leitstand','online','monitor'],
    ['Hallenanzeige 01','Spielstandanzeige','Feld 01','Spielt · #44','online','monitor'],
    ['Tablet 06','Zähltablet','Feld 06','Spielabschluss bestätigt','online','tablet'],
    ['Tablet 09','Zähltablet','Feld 09','Spielt · #43','online','tablet'],
    ['Sprachvorbereitung','Adminansicht','Sprachplanung','Übersicht','online','mic'],
    ['Hallenanzeige 13','Spielstandanzeige','Feld 13','Zuletzt vor 2 Min.','offline','monitor']
  ];
  function devicePage() {
    return `${heading('Geräte & Seiten', 'Verbindungen, Versionen und Neuladen zentral verwalten.',button('Gruppe neu laden','reload-group','refresh','primary'))}${subnav([['geraete','Geräte & Seiten','monitor'],['logs','Zentrale Logs','logs']])}
      <div class="metric-grid">${[['Verbundene Seiten','18','5 Adminseiten · 13 Geräte'],['Aktuell erreichbar','17','Alle laufenden Spiele verbunden'],['Wartende Aktualisierungen','1','Zähltablet wartet auf Spielende'],['Offline','1','Hallenanzeige 13']].map(([l,n,s])=>`<div class="metric"><small>${l}</small><strong>${n}</strong><small class="trend">${s}</small></div>`).join('')}</div>
      <div class="toolbar"><div class="row">${search('Gerät, Ansicht oder Feld suchen …')}<label class="filter-label">Ansicht<select><option>Alle Ansichten</option><option>Admin</option><option>Zähltablets</option><option>Anzeigen</option></select></label></div>${badge('Live · verbunden','good',true)}</div>
      <section class="panel"><div class="table-wrap"><table><thead><tr><th>Gerät / Seite</th><th>Ansicht</th><th>Turnier / Feld</th><th>Status</th><th>Version</th><th class="right">Aktionen</th></tr></thead><tbody>${deviceRows.map(([name,type,place,status,connection,symbol])=>`<tr data-search-row data-search="${esc(`${name} ${type} ${place}`.toLowerCase())}"><td><div class="row"><span class="device-icon">${icon(symbol)}</span><div><strong>${name}</strong><small style="display:block">${status}</small></div></div></td><td>${type}</td><td>${place}</td><td>${badge(connection==='online'?'Verbunden':'Offline',connection==='online'?'good':'neutral',true)}</td><td><code class="mono">78a8ef9</code></td><td class="right">${button('Logs','device-logs','logs','sm')}${button('Neu laden','reload-device','refresh','sm',`data-device="${esc(name)}"`)}</td></tr>`).join('')}</tbody></table></div></section>
      <div class="notice space">${icon('shield')} Zähltablets warten bis zum bestätigten Spielabschluss. Ungespeicherte Formulare und laufende Durchsagen verzögern ein Neuladen.</div>
      <div class="space">${panel('Neuladeaufträge', `<div class="row between"><div><strong>Tablet 09 · Spiel #43</strong><p class="hint small-space">Aktualisierung angefordert · wird nach Spielabschluss ausgeführt</p></div><div class="row">${badge('Wartet auf Spielende','warn')}${button('Abbrechen','reload-cancel','close','sm')}</div></div>`)}</div>${footer()}`;
  }
  const logRows = [
    ['11:12:44','info','Sprachsystem','Kontextaufnahme bereit','Helfer TIM-THINKPAD hat den Auftrag für Finn Sommer abgeschlossen.'],
    ['11:12:42','info','BTP-Abgleich','Synchronisierung abgeschlossen','6 Änderungen übernommen. Spiel- und Feldreihenfolge unverändert.'],
    ['11:12:39','warn','Anzeige','Hallenanzeige 13 ist offline','Die letzte Rückmeldung wurde vor zwei Minuten empfangen.'],
    ['11:12:35','info','Spielbetrieb','Spiel 43 auf Feld 09 aufgerufen','Tabletbedienung zugeordnet. Spielaufruf mit Serveraudio abgespielt.'],
    ['11:12:31','info','Zähltablet','Spiel 31 bestätigt beendet','Ergebnis gespeichert und an BTP übertragen. Feld freigegeben.'],
    ['11:12:28','warn','Sprachsystem','Aufnahme erneut prüfen','Qualitätsprüfung hat eine Variante verworfen. Ersatzauftrag wurde eingeplant.'],
    ['11:12:22','info','Geräte','Neuladen für Tablet 09 vorgemerkt','Der Auftrag wartet auf den bestätigten Spielabschluss.'],
    ['11:12:20','info','Anmeldung','Anmeldung MD U17 abgeschlossen','Eine Aufgabe für die Turnierleitung wurde angelegt.']
  ];
  function logsPage() {
    return `${heading('Zentrale Logs', 'Server, Adminseiten, Zähltablets und Anzeigen in einem Verlauf.', `${button(state.logsPaused?'Live fortsetzen':'Live pausieren','logs-pause',state.logsPaused?'play':'pause')}${button('Exportieren','export','download')}`)}${subnav([['geraete','Geräte & Seiten','monitor'],['logs','Zentrale Logs','logs']])}
      <div class="toolbar"><div class="row wrap">${search('Meldung, Spiel oder Gerät suchen …')}<label class="filter-label">Quelle<select><option>Alle Quellen</option>${['BTP-Abgleich','Sprachsystem','Adminseiten','Zähltablets','Anzeigen'].map(s=>`<option>${s}</option>`).join('')}</select></label><label class="filter-label">Stufe<select data-change="log-filter"><option value="all">Alle Stufen</option><option value="warn">Warnungen</option><option value="info">Informationen</option></select></label></div>${state.logsPaused?badge('Live pausiert','warn'):badge('Live · verbunden','good',true)}</div>
      <div class="row between" style="margin-bottom:15px"><div class="row"><label class="filter-label">Von<input type="time" value="11:00" aria-label="Logs von" style="padding:5px"></label><label class="filter-label">Bis<input type="time" value="11:15" aria-label="Logs bis" style="padding:5px"></label></div>${checkbox('Detailprotokoll für 10 Minuten',false)}</div>
      <section class="panel"><div class="panel-head"><h2>Ereignisse</h2><span class="hint">Neueste zuerst · 2 Warnungen · keine Fehler</span></div><ol class="log-list">${logRows.map(([time,level,source,title,description],i)=>`<li class="log-item ${level}" data-search-row data-level="${level}" data-search="${esc(`${source} ${title} ${description}`.toLowerCase())}"><time class="log-time">${time}</time><div>${badge(level==='warn'?'Warnung':'Info',level==='warn'?'warn':'neutral')}</div><span class="log-source">${source}</span><details class="log-message" ${i===2?'open':''}><summary><strong>${title}</strong><p class="hint">${description}</p></summary><div class="log-details mono">Quelle: ${source} · Turnier: default<br>Empfangen: 25.10.2026, ${time} · Wiederholungen: 1<br>Version: 78a8ef9 · Ansicht: ${i===2?'Anzeige für Feld 13':'Turnierleitung'}</div></details>${tiny('arrow','device-logs','Zugehörige Ansicht öffnen')}</li>`).join('')}</ol></section>${footer()}`;
  }
  function labPage() {
    return `${heading('Testlabor','Testlauf, Messwerte und Turnieruhr gemeinsam überblicken.', `${button('Bericht importieren','benchmark-import','upload')}${button('Bericht exportieren','export','download')}`)}
      <div class="notice warn row between" style="margin-bottom:18px"><span>${icon('flask')} <strong>Testmodus</strong> · Zeitversatz +60 Minuten · Turnieruhr 11:12</span><a href="#einstellungen/allgemein">System prüfen ${icon('arrow')}</a></div>
      <div class="metric-grid">${[['Antwortzeit p95','34 ms','95 % der Antworten schneller'],['Event Loop p95','12 ms','Hauptprozess'],['Browser-Fallbacks','0','Alle Durchsagen mit Serveraudio'],['Erfolgreiche Aktionen','486','Punkte, Aufrufe und BTP-Abgleich']].map(([l,n,s])=>`<div class="metric"><small>${l}</small><strong>${n}</strong><small class="trend">${s}</small></div>`).join('')}</div>
      <div class="two-columns" style="grid-template-columns:minmax(300px,.75fr) minmax(0,1.25fr)"><div class="stack">${panel('Testlauf', `<div class="form-grid"><label class="wide">Szenario<select><option>Turnierbetrieb mit Sprachausgabe</option><option>BTP-Abgleich und Reihenfolge</option><option>Lasttest</option></select></label><label>Dauer<input value="10 Minuten"></label><label>Seed<input value="519"></label></div><div class="space">${checkbox('Sprachvorbereitung berücksichtigen')}${checkbox('Sprachhelfer mitverwenden')}${checkbox('Metriken und Logs aufzeichnen')}</div><div class="row space">${button('Test starten','test-start','play','primary')}${button('Anhalten','test-pause','pause')}${button('Beenden','test-stop','close')}</div>`,badge('Bereit','good'))}
      ${panel('Turnieruhr', `<div class="form-grid"><label class="wide">Modus<select><option>Zeitversatz</option><option>Echtzeit</option><option>Feste Uhrzeit</option></select></label><label>Versatz<input type="number" value="60"></label><label>Einheit<select><option>Minuten</option></select></label></div><div class="row space">${button('Übernehmen','test-clock','clock','sm')}${button('Echtzeit','test-clock','refresh','sm')}</div>`)}</div>
      <div class="stack">${panel('Antwortzeiten im Testverlauf', `<div class="row between" style="margin-bottom:17px"><div class="legend"><span><i style="background:#548d6b"></i>p95 Antwortzeit</span><span><i style="background:#d3b56a"></i>Erste Durchsage</span></div><small>Letzte 10 Minuten</small></div><div class="benchmark-chart">${Array.from({length:40},(_,i)=>`<span style="height:${i===10?82:18+Math.abs(Math.sin(i*2.4))*32}%"></span>`).join('')}</div><div class="benchmark-axis"><span>11:02</span><span>11:04</span><span>11:06</span><span>11:08</span><span>11:12</span></div>`)}
      ${panel('Beteiligte Systeme', `<table><tbody><tr><td>BTS-Hauptprozess</td><td>${badge('Verbunden','good')}</td><td class="right">CPU 8 %</td></tr><tr><td>Sprachprozess</td><td>${badge('Arbeitet','prep')}</td><td class="right">Queue 2 + 4</td></tr><tr><td>Sprachserver</td><td>${badge('Bereit','good')}</td><td class="right">1 lokaler Auftrag</td></tr><tr><td>TIM-THINKPAD</td><td>${badge('Erzeugt Audio','prep')}</td><td class="right">4 CPU-Kerne</td></tr><tr><td>BTP</td><td>${badge('Verbunden','good')}</td><td class="right">Letzter Abgleich 8 s</td></tr></tbody></table>`, '<a class="btn sm" href="#logs">Logs ansehen</a>')}
      ${panel('Letzte Messungen', `<div class="row between"><div><strong>Test 31 · Turnierbetrieb mit Sprachausgabe</strong><p class="hint small-space">10 Minuten · 13 Felder · 486 Aktionen · keine Fallbacks</p></div>${button('Details','benchmark-details','arrow','sm')}</div>`)}</div></div>${footer()}`;
  }
  function shell(content) {
    const route = `${page}${section ? '/'+section : ''}`;
    return `<div class="prototype-bar"><div class="prototype-mark"><b>MOCKUP</b><span>Beispieldaten · Aktionen werden nur simuliert</span><a href="index.html">Alle Entwürfe ${icon('arrow')}</a></div><div class="prototype-switch"><a href="app.html?konzept=a#${route}" class="${variant==='a'?'active':''}">A · Volle Breite</a><a href="app.html?konzept=b#${route}" class="${variant==='b'?'active':''}">B · Seitennavigation</a></div></div>
      <aside class="sidebar">${brand()}<div class="sidebar-label">Arbeitsbereiche</div><nav aria-label="Hauptnavigation">${navLinks(true)}</nav><div class="sidebar-bottom"><a href="#" data-action="views">${icon('monitor')}<span class="side-label">Anzeigen & Ansichten</span></a><a href="#" data-action="mapping">${icon('shield')}<span class="side-label">Funktionsabgleich</span></a><button data-action="focus" title="Navigation ein- oder ausklappen">${icon('collapse')}<span class="side-label">Navigation einklappen</span></button></div></aside>
      <div class="shell-header"><header class="masthead">${brand(true)}<button class="btn ghost tournament-switch" data-action="tournament"><span style="text-align:left"><small style="display:block;font-size:9px;letter-spacing:.7px;text-transform:uppercase">Aktuelles Turnier</small><strong>Jugend-Rangliste 2026</strong></span>${icon('down')}</button><div class="service-strip"><span class="service-status"><i class="dot"></i>BTS verbunden</span><button class="service-status btn ghost optional" data-action="sync" style="font-size:10px;padding:0;min-height:0"><i class="dot"></i>BTP · vor 8 s ${icon('refresh')}</button><a class="service-status optional" href="#sprache"><i class="dot"></i>Sprache bereit</a>${tiny('search','global-search','Funktion oder Seite suchen')}<span class="user-avatar" title="Turnierleitung">TL</span></div></header><nav class="global-nav" aria-label="Hauptnavigation">${navLinks()}</nav></div>
      <div class="workarea"><main class="content ${page==='leitstand'?'leitstand':''}" id="content" tabindex="-1">${content}</main></div>`;
  }
  function render() {
    clearDragState();
    clearCardDragState();
    const route = decodeURIComponent(location.hash.slice(1)).split('/');
    page = pages[route[0]] ? route[0] : 'leitstand'; section = route[1] || '';
    document.body.className = `variant-${variant} page-${page} ${state.focus?'focus-mode':''} ${state.density==='comfort'?'comfort':''}`;
    document.title = `BTS · ${pages[page]} · Entwurf ${variant.toUpperCase()}`;
    const views = { leitstand: mainPage, anmeldung: registrationPage, sprache: speechOverview, sprachspiele: speechGames, sprachdiagramm: speechDiagram, helfer: helperPage, hoerlabor: () => listeningPage(false), kontexteditor: () => listeningPage(true), geraete: devicePage, logs: logsPage, einstellungen: settingsPage, testlabor: labPage };
    document.getElementById('app').innerHTML = shell(views[page]());
    if (page === 'leitstand') {applyDeviceLocations();applyBoardLayout();}
    if (page === 'anmeldung' && !section) {
      const first = document.querySelector('.subnav a'); first?.classList.add('active'); first?.setAttribute('aria-current','page');
    }
    if (['sprachspiele','sprachdiagramm'].includes(page)) document.querySelector('.global-nav a[href="#sprache"]')?.classList.add('active');
    window.scrollTo(0,0);
  }
  function toast(text) { const node=document.getElementById('toast');node.textContent=text;node.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('show'),3200); }
  function showModal(title, body, actions = '', kind = '') {
    const modal=document.getElementById('modal');modal.className=kind;modal.innerHTML=`<div class="dialog-header"><h2 id="dialog-title">${title}</h2>${tiny('close','close-modal','Dialog schließen')}</div><div class="dialog-body">${body}</div><div class="dialog-actions">${button('Schließen','close-modal')}${actions}</div>`;
    if(!modal.open) modal.showModal();
  }
  function selectMatchTab(name, focus=false) {
    const modal=document.getElementById('modal');
    const selected=modal.querySelector(`[data-match-tab="${name}"]`);
    if(!selected || selected.disabled) return;
    modal.querySelectorAll('[data-match-tab]').forEach(tab=>{
      const active=tab===selected;
      tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
    });
    modal.querySelectorAll('[data-match-panel]').forEach(panel=>{panel.hidden=panel.dataset.matchPanel!==name;});
    modal.querySelector('[data-match-save]').hidden=name!=='edit';
    if(focus) selected.focus({preventScroll:true});
  }
  function showMatchDialog(number, tab='edit') {
    const game=[...fields,...upcoming,...finished].find(game=>game.number===Number(number));
    if(!game) return;
    const labels={live:'Auf dem Feld',called:'Aufgerufen',preparation:'In Vorbereitung',candidate:'Aufrufkandidat',planned:'Geplant',open:'Teilnehmer offen',blocked:'BTP-Sperrvermerk','result-pending':'Ergebnis zu bestätigen',done:'Beendet'};
    const status=labels[game.state];
    const place=game.field?`Feld ${String(game.field).padStart(2,'0')}`:locations.find(place=>place.id===game.location)?.name||'Noch kein Feld zugewiesen';
    const edit=`<div class="form-grid"><label>Disziplin<select name="discipline">${[...new Set([game.event,'MX U15','MX U17','MX U19'])].map(event=>`<option>${esc(event)}</option>`).join('')}</select></label><label>Spielnummer<input name="number" value="${game.number}"></label><label class="wide">Paarung 1<input name="team-one" value="${esc(game.a)}"></label><label class="wide">Paarung 2<input name="team-two" value="${esc(game.b)}"></label><label>Feld<select name="court"><option value="" ${game.field?'':'selected'}>Nicht zugewiesen</option>${fields.map(field=>`<option value="${field.field}" ${field.field===game.field?'selected':''}>Feld ${field.field}</option>`).join('')}</select></label><label>Status<select name="state">${Object.entries(labels).map(([value,label])=>`<option value="${value}" ${game.state===value?'selected':''}>${label}</option>`).join('')}</select></label><label class="wide">Tabletbedienung<input name="operator" value="${esc(game.operator||game.roles?.filter(role=>role.role==='Tabletbedienung').map(role=>role.name).join(' / ')||'')}" placeholder="Nicht zugewiesen"></label><label>Schiedsrichter<input name="umpire" value="${esc(game.roles?.find(role=>role.role==='Schiedsrichter')?.name||'')}" placeholder="Nicht zugewiesen"></label><label>Aufschlagrichter<input name="service-judge" value="${esc(game.roles?.find(role=>role.role==='Aufschlagrichter')?.name||'')}" placeholder="Nicht zugewiesen"></label></div>${completeGame(game)?'':'<p class="hint space">Der Schiedsrichterzettel steht bereit, sobald beide Teams feststehen.</p>'}`;
    const sheet=completeGame(game)?`<section class="match-sheet"><div class="row between"><strong>Schiedsrichterzettel</strong><small>Spiel ${game.number} · ${esc(game.event)}</small></div><p class="space">${esc(game.a)}<br><span class="muted">gegen</span><br>${esc(game.b)}</p><table class="space"><thead><tr><th>Paarung</th><th>Satz 1</th><th>Satz 2</th><th>Satz 3</th></tr></thead><tbody><tr><td>1</td><td>—</td><td>—</td><td>—</td></tr><tr><td>2</td><td>—</td><td>—</td><td>—</td></tr></tbody></table><p class="hint space">Zählweise, Unterschriften und Druck/Export folgen dem bestehenden Zettel. Hier wird die Vorschau gezeigt.</p></section>`:'';
    const raw=`<pre class="code-box">${esc(JSON.stringify({spielnummer:game.number,disziplin:game.event,runde:game.round,status:game.state,paarungen:[game.a,game.b],feld:game.field||null,spielort:game.location||(game.field?'CH':null),ergebnis:game.score||null,demodaten:true},null,2))}</pre>`;
    const tabs=[['edit','Bearbeiten','edit'],['scoresheet','Schiedsrichterzettel','sheet'],['raw','Rohdaten','code']];
    const body=`<div class="match-dialog-context"><span>${esc(game.time||'11:00')} · ${esc(game.event)} ${esc(game.round)} · ${esc(place)}</span><strong>${esc(game.a)} <span class="muted">gegen</span> ${esc(game.b)}</strong>${matchStatus(status,game.state==='done'?'check':game.field?'play':'info')}</div><div class="match-dialog-tabs" role="tablist" aria-label="Spielbereiche">${tabs.map(([id,label,symbol])=>`<button type="button" role="tab" id="match-tab-${id}" aria-controls="match-panel-${id}" aria-selected="${id==='edit'}" tabindex="${id==='edit'?0:-1}" data-action="match-tab" data-match-tab="${id}" ${id==='scoresheet'&&!completeGame(game)?'disabled title="Beide Teams müssen feststehen"':''}>${icon(symbol)}<span>${id==='scoresheet'?'Schiedsrichter<wbr>zettel':label}</span></button>`).join('')}</div>${[['edit',edit],['scoresheet',sheet],['raw',raw]].map(([id,content])=>`<section role="tabpanel" id="match-panel-${id}" aria-labelledby="match-tab-${id}" data-match-panel="${id}" tabindex="0" ${id==='edit'?'':'hidden'}>${content}</section>`).join('')}`;
    showModal(`Spiel ${game.number}`,body,button('Spielprotokoll','history','history','',`data-number="${game.number}"`)+button('Änderungen übernehmen · Demo','demo','check','primary','data-match-save'),'match-dialog');
    selectMatchTab(tab,true);
  }
  const mapping = [
    ['Spieltabellen & Reihenfolge','Alle 13 Felder, freie Felder, laufende und beendete Spiele; normale Spielreihenfolge und Aufrufgrenze.'],
    ['Spielaktionen je Zustand','Bearbeiten und Rohdaten immer; Schiedsrichterzettel bei vollständigen Teams. Getrennte Aufrufe für Teams und Offizielle vor dem Spielstart. Abschluss erst bei vollständigem Ergebnis.'],
    ['Check-in je Person','Vor dem Feldaufruf: Anwesenheit, anderer Spieleinsatz, Tabletbindung, Pause und BTP-Sperrvermerk getrennt darstellen. Auf dem Feld und nach Abschluss keine Anwesenheitsfarben.'],
    ['Tabletbediener & Offizielle','Warteliste, Suche, Hinzufügen, Entfernen, Umsortieren, Rotation, Schieds- und Aufschlagrichter.'],
    ['Ansagen','Freitext, lokale und Remote-Ausgabe, Evakuierung, gerätebezogene Wiedergabe, Sprachtest und Wiedergabequeue.'],
    ['Automatik & Spielbereitschaft','Globale Automatik und ihre vier Teilbereiche bleiben separat bedienbar. Vorbereitungszeiten und Sperrgründe bleiben sichtbar.'],
    ['Navigation & Ansichten','Alle heutigen Ansichten, Anmeldekontrolle, Zähltablets, Spielstandanzeigen, Urkunden und CSV-Export behalten einen festen Ort.'],
    ['Einstellungen & Daten','Sämtliche Einstellungsgruppen, BTP-Abgleich, Felder, Wertung, Werbung, Ticker und Wartungsaktionen bleiben erhalten.'],
    ['Sprach- und Testwerkzeuge','Übersicht, Diagramm, Spiele, Helfer, Hörlabor, Kontexteditor, Logs, Geräte und Benchmarks verwenden denselben Rahmen.']
  ];
  function handleAction(action, node) {
    const number=node.dataset.number || 45;
    if(action==='layout-edit') {
      clearCardDragState();clearDragState();
      if(!state.layoutEditing) {
        layoutBeforeEdit=JSON.parse(JSON.stringify(state.boardLayout));state.layoutEditing=true;
        applyBoardLayout();document.querySelector('[data-layout-editor] [data-action="layout-edit"]').focus({preventScroll:true});
      } else {
        state.layoutEditing=false;layoutBeforeEdit=null;
        let saved=true;
        try {localStorage.setItem(boardLayoutKey,JSON.stringify(state.boardLayout));} catch {saved=false;}
        applyBoardLayout();document.querySelector('.board-toolbar-actions [data-action="layout-edit"]').focus({preventScroll:true});
        toast(saved?'Anordnung auf diesem Gerät gespeichert.':'Anordnung für diese Sitzung übernommen. Der Browserspeicher ist nicht verfügbar.');
      }
      return;
    }
    if(action==='layout-cancel') {
      clearCardDragState();state.boardLayout=layoutBeforeEdit||defaultBoardLayout();state.layoutEditing=false;layoutBeforeEdit=null;
      applyBoardLayout();document.querySelector('.board-toolbar-actions [data-action="layout-edit"]').focus({preventScroll:true});return;
    }
    if(action==='layout-reset'&&state.layoutEditing) {clearCardDragState();state.boardLayout=defaultBoardLayout();applyBoardLayout();toast('Standardanordnung wiederhergestellt. Mit „Fertig“ übernehmen.');return;}
    if(action.startsWith('layout-card-')&&state.layoutEditing) {
      const id=node.dataset.cardId,zone=state.boardLayout.top.includes(id)?'top':'sidebar',ids=state.boardLayout[zone],index=ids.indexOf(id);
      if(index<0) return;
      if(action==='layout-card-zone') moveBoardCard(id,zone==='top'?'sidebar':'top');
      else if(action==='layout-card-earlier'&&index>0) moveBoardCard(id,zone,ids[index-1]);
      else if(action==='layout-card-later'&&index<ids.length-1) moveBoardCard(id,zone,ids[index+2]||null);
      if(action!=='layout-card-zone') document.querySelector(`[data-board-card="${id}"] [data-action="${action}"]:not(:disabled)`)?.focus({preventScroll:true});
      return;
    }
    if (action==='close-modal') { document.getElementById('modal').close(); return; }
    if (action==='call-status') {
      const game=upcoming.find(g=>g.number===Number(number));
      if(game) showModal(`Aufrufstatus · Spiel ${number}`,`<pre class="call-status-details">${esc(callDiagnostics(game).text)}</pre>`);
      return;
    }
    if (action==='checkin-tablet-pair') {
      const game=upcoming.find(g=>g.number===Number(number)),members=tabletPairMembers(game,node.dataset.pairId);
      if(members.length<2||members.some(personLocked)) return;
      const checked=!members.every(person=>person.checked);
      members.forEach(person=>{person.checked=checked;});
      node.closest('tr').outerHTML=upcomingRow(game);
      document.querySelector(`tr[data-game="${number}"] [data-pair-id="${CSS.escape(node.dataset.pairId)}"]`)?.focus({preventScroll:true});
      toast(`Vorschau: Die Tablet-Paarung ist für Spiel ${number} gemeinsam ${checked?'anwesend':'nicht anwesend'}.`);return;
    }
    if (action==='checkin') {
      const game=upcoming.find(g=>g.number===Number(number)), index=Number(node.dataset.person);
      const person=node.dataset.role ? game?.roles?.[index] : game?.people?.[index];
      if(!person || personLocked(person) || (node.dataset.role&&person.pairId)) return;
      person.checked=!person.checked;
      const row=node.closest('tr');
      row.outerHTML=upcomingRow(game);
      document.querySelector(`tr[data-game="${number}"] [data-person="${index}"]${node.dataset.role?'[data-role]':':not([data-role])'}`)?.focus({preventScroll:true});
      toast(`Vorschau: Diese Person ist für Spiel ${number} ${person.checked?'anwesend':'nicht anwesend'}.`);return;
    }
    if (action==='match-tab') {selectMatchTab(node.dataset.matchTab);return;}
    if (['match','scoresheet','raw'].includes(action)) {showMatchDialog(number,action==='match'?'edit':action);return;}
    if (action==='officials') {showModal(`Offizielle zuweisen · Spiel ${number}`,`<div class="form-grid"><label>Schiedsrichter<input data-official-field="Schiedsrichter" placeholder="Person suchen"></label><label>Aufschlagrichter<input data-official-field="Aufschlagrichter" placeholder="Person suchen"></label><label class="wide">Tabletbedienung<input placeholder="Person oder Paarung suchen"></label></div><p class="hint space">Eine als Paarung aufgerufene Tabletbedienung wird gemeinsam eingecheckt. Schiedsrichter und Aufschlagrichter behalten ihren eigenen Check-in.</p>`,button('Übernehmen · Demo','demo','check','primary'));if(node.dataset.officialRole)document.querySelector(`[data-official-field="${CSS.escape(node.dataset.officialRole)}"]`)?.focus();return;}
    if (action==='court-state') {showModal(`Feld ${node.dataset.field} · Aktivierung`,`<p>Der bisherige Feldschalter bleibt am Feldsymbol erreichbar.</p><label class="check space"><input type="checkbox" checked>Für den Spielbetrieb aktiv</label><p class="hint space">Ein gesperrtes freies Feld ist kein Ablageziel. Hier wird keine Einstellung im BTS geändert.</p>`,button('Übernehmen · Demo','demo','check','primary'));return;}
    if (action==='recall'||action==='preparation-call'||action==='begin-play') {toast(`Demo: ${action==='begin-play'?'Mit dem Spielen beginnen':action==='preparation-call'?'Vorbereitungsaufruf':'Erneuter '+(node.dataset.phase==='preparation'?'Vorbereitungsaufruf':'Feldaufruf')} · Spiel ${number}${node.dataset.target?' · '+node.dataset.target:''}.`);return;}
    if (action==='confirm') {if(fields.some(g=>g.number===Number(number)&&g.state==='result-pending'))showModal(`Spiel ${number} abschließen`,`<p>Das Ergebnis ist vollständig. Der bisherige Abschluss übernimmt das Ergebnis und gibt das Feld frei.</p><p class="hint space">Diese Vorschau verändert keinen Spielstand.</p>`,button('Abschließen · Demo','demo','check','success'));return;}
    if (action==='density') { state.density=state.density==='compact'?'comfort':'compact';render();return; }
    if (action==='focus') { state.focus=!state.focus;render();return; }
    if (action==='automation') { state.auto=!state.auto;render();toast(`Demo: Automatik ${state.auto?'aktiviert':'pausiert'}.`);return; }
    if (action==='auto-part') { node.classList.toggle('on');node.setAttribute('aria-pressed',node.classList.contains('on'));toast('Demo: Teilautomatik umgeschaltet.');return; }
    if (action==='auto-settings') { location.hash='einstellungen/ablauf';return; }
    if (action==='highlight-colors') { location.hash='einstellungen/felder';return; }
    if (action==='speech-link') { location.hash='sprache';return; }
    if (action==='stage') { state.stage=Number(node.dataset.stage);render();return; }
    if (action==='helper-pause') {state.helpersPaused=!state.helpersPaused;render();toast('Demo: Helferstatus aktualisiert.');return;}
    if (action==='logs-pause') {state.logsPaused=!state.logsPaused;render();return;}
    if (action==='device-logs') {location.hash='logs';return;}
    if (action==='reorder') {const row=node.closest('.operator');if(row){const previous=row.previousElementSibling,next=row.nextElementSibling;if(node.title.includes('unten')&&next?.classList.contains('operator'))next.after(row);else if(previous?.classList.contains('operator'))previous.before(row);}toast('Demo: Reihenfolge verändert.');return;}
    if (action==='remove-operator') {node.closest('.operator')?.remove();toast('Demo: Wartelisteneintrag entfernt.');return;}
    if (action==='mapping') {showModal('Funktionsabgleich · Hauptseite',`<p class="hint">Der Entwurf ordnet bestehende Funktionen neu. Vor einer Umsetzung wird jede Funktion einzeln übernommen und geprüft.</p><div class="mapping-list">${mapping.map(([t,p])=>`<div>${icon('check')}<span><strong>${t}</strong><p class="hint">${p}</p></span></div>`).join('')}</div>`);return;}
    if (action==='global-search') {showModal('Seite oder Funktion finden',`${search('Zum Beispiel: Feldzuweisungen, Sprachhelfer …')}<div class="mapping-list">${[['leitstand','Turnierleitung','Alle Felder & Spiele'],['einstellungen/wartung','Feldzuweisungen entfernen','Einstellungen → Daten & Wartung'],['helfer','Sprachhelfer','Sprache → Verbundene Rechner'],['geraete','Seiten neu laden','Geräte & Logs → Geräte'],['testlabor','Turnieruhr & Benchmark','Testlabor'],['kontexteditor','Kontextaufnahmen bearbeiten','Sprache → Kontexteditor']].map(([r,t,p])=>`<div data-search-row data-search="${(t+' '+p).toLowerCase()}"><a href="#${r}" data-action="modal-navigate">${t}<p class="hint">${p}</p></a></div>`).join('')}</div>`);return;}
    if (action==='modal-navigate') {document.getElementById('modal').close();location.hash=node.getAttribute('href');return;}
    if (action==='views') {showModal('Anzeigen & weitere Ansichten',`<p class="hint">Diese Ansichten bleiben zusätzlich zur Turnierleitung erreichbar.</p><div class="mapping-list">${['Spielübersicht','Aktuelle Spiele','Nächste Spiele','Selbstanmeldung','Spielstandanzeige','Zähltablet / Schiedsrichterpanel','Anmeldung','Meldungskontrolle'].map(s=>`<div>${icon('monitor')}<span class="grow">${s}</span>${button('Öffnen','demo','export','sm')}</div>`).join('')}</div>`);return;}
    if (action==='tools') {showModal('Werkzeuge',`<div class="mapping-list">${['Spiel anlegen','BTP jetzt abgleichen','Ticker aktualisieren','Urkunden & Siegerlisten','CSV-Export','Turnier sichern','Feld- und Spielprotokolle'].map(s=>`<div>${icon('folder')}<span class="grow">${s}</span>${button('Öffnen','demo','arrow','sm')}</div>`).join('')}</div>`);return;}
    if (action==='ranking-import') {showModal('Rangliste importieren',`<div class="notice">Fehlende Spieler erhalten 0 Punkte. Die Zuordnung gilt je Disziplin und Altersklasse.</div><div class="form-grid space"><label class="wide">Datei<input type="file" accept=".xlsx,.csv" aria-label="Ranglistendatei auswählen"></label><label>Disziplinen<select><option>Alle Disziplinen</option><option>Einzel</option><option>Doppel</option><option>Mixed</option></select></label><label>Rangliste<select><option>U19</option><option>O19</option></select></label></div><table class="space"><thead><tr><th>Altersklassen</th><th>Verwendete Rangliste</th><th>Standard</th></tr></thead><tbody><tr><td>U9 bis U19</td><td>U19</td><td>✓</td></tr><tr><td>U22 bis O90</td><td>O19</td><td>✓</td></tr></tbody></table>`,button('Zuordnung übernehmen','demo','check','primary'));return;}
    if (action==='create-match') {showModal('Spiel anlegen',`<div class="form-grid"><label>Disziplin<select><option>Mixed U15</option><option>Mixed U17</option></select></label><label>Spielnummer<input value="${number}"></label><label class="wide">Paarung 1<input value="${pairs[13]}"></label><label class="wide">Paarung 2<input value="${pairs[14]}"></label><label>Feld<select><option>Nicht zugewiesen</option>${fields.map(g=>`<option>Feld ${g.field}</option>`).join('')}</select></label><label>Status<select><option>In Vorbereitung</option><option>Auf dem Feld</option><option>Beendet</option></select></label><label class="wide">Tabletbedienung<input value="${pairs[5]}"></label><label>Schiedsrichter<input placeholder="Nicht zugewiesen"></label><label>Aufschlagrichter<input placeholder="Nicht zugewiesen"></label></div>`,button('Änderungen übernehmen','demo','check','primary'));return;}
    if (action==='history') {showModal(`Protokoll · Spiel ${number}`,`<div class="mapping-list">${['11:04:15 · Spiel in Vorbereitung aufgerufen','11:06:17 · Paarungen vollständig anwesend','11:06:22 · Feld und Tabletbedienung zugewiesen','11:06:24 · Spielaufruf mit Serveraudio','11:07:11 · Spiel begonnen'].map(t=>`<div>${icon('clock')}${t}</div>`).join('')}</div>`);return;}
    if (action==='speech-details') {showModal(`Sprachbausteine · ${node.dataset.number?'Spiel '+number:'MX U19'}`,`<p class="hint">Alle Durchsagen und ihre wiederverwendbaren Teile lassen sich einzeln prüfen.</p><div class="mapping-list">${['Auf Spielfeld neun!','Spielnummer dreiundvierzig.','Mixed U15. Viertelfinale.','Mia Becker und Finn Sommer','gegen Lena Hoffmann und Noah Weber.','Auf Spielfeld neun!'].map(t=>`<div>${badge('Bereit','good')}<span class="grow">${t}</span>${tiny('play','audio-test','Baustein vorhören')}</div>`).join('')}</div><div class="notice space">Feldvarianten sind vollständig vorhanden. Die finale Feldzuweisung erzeugt keinen zusätzlichen Audiobedarf.</div>`);return;}
    if (action==='call'||action==='assign') {showModal(action==='assign'?`Spiel auf Feld ${node.dataset.field} zuweisen`:`Spiel ${number} aufrufen`,`<p class="hint">Freie Felder werden in ihrer bestehenden Reihenfolge angeboten. Im Mockup wird nur die Bedienung gezeigt.</p><div class="form-grid space"><label>Vollständiges Spiel<select>${upcoming.filter(g=>completeGame(g)&&!g.entryBlocked).map(g=>`<option ${g.number===Number(number)?'selected':''}>${g.number} · ${g.event}</option>`).join('')}</select></label><label>Feld<select><option>Feld ${node.dataset.field||4}</option><option>Feld 13</option></select></label><label class="wide">Tabletbediener<select><option>Automatisch aus Warteliste</option><option>Manuell auswählen</option></select></label></div>`,button('Spiel aufrufen · Demo','demo','play','primary'));return;}
    if (action==='preparation-details') {showModal('Warum diese Vorbereitung?',`<div class="mapping-list"><div>${icon('check')}Campus Hellweg: ${preparationSelection.CH.current_preparation_count} Spiele in Vorbereitung, benötigt werden ${preparationSelection.CH.required_preparation_count}.</div><div>${icon('clock')}Mindestzeit in Vorbereitung: 2 Minuten.</div><div>${icon('court')}Die freien Felder 4 und 13 sowie die Nachfolger für Feld 5 und 7 erzeugen den Bedarf.</div><div>${icon('flag')}Aufrufgrenze: Spiel 50, Reihenfolge nach Spielplan.</div></div>`);return;}
    if (action==='boundary') {showModal('Aufrufgrenze',`<p class="hint">Die Grenze bleibt in der Spieltabelle sichtbar und lässt sich wie bisher versetzen.</p><label class="form-label space">Bis einschließlich Spiel<input type="number" value="50" style="width:100%;margin-top:6px"></label>`,button('Übernehmen · Demo','demo','flag','primary'));return;}
    if (action.startsWith('reload-')) {showModal(action==='reload-group'?'Geräte zentral neu laden':'Seite neu laden',`<p>${action==='reload-group'?'Ausgewählte Gerätegruppe':esc(node.dataset.device||'Gerät')} aktualisieren?</p><div class="notice space">Zähltablets warten bis zum bestätigten Spielabschluss. Laufende Durchsagen und ungespeicherte Formulare verzögern das Neuladen.</div><div class="form-grid space"><label class="wide">Zielgruppe<select><option>${action==='reload-group'?'Alle bekannten Seiten':esc(node.dataset.device||'Diese Seite')}</option><option>Nur Anzeigen</option><option>Nur Adminseiten</option><option>Nur Zähltablets</option></select></label></div>`,button('Neuladen vormerken · Demo','demo','refresh','primary'));return;}
    if (action.startsWith('maintenance-')) {showModal('Wartungsaktion prüfen',`<div class="notice danger"><strong>Nur Vorschau.</strong> In diesem Entwurf werden keine Daten geändert.</div><p class="space">${action==='maintenance-fields'?'Feldzuweisungen aller noch nicht laufenden Spiele entfernen und an BTP übertragen. Laufende Spiele bleiben ausgenommen.':action==='maintenance-delete'?'Vor dem Löschen der Turnierdaten muss eine Sicherung vorliegen.':'Die gewählte Wartungsaktion würde den gespeicherten Bestand verändern.'}</p>${checkbox('Ich habe eine aktuelle Sicherung erstellt.',false)}`,button('Aktion bestätigen · Demo','demo','alert','danger'));return;}
    if (action==='connect-helper'||action==='helper-download') {showModal('Sprachhelfer verbinden',`<p class="hint">Der Nutzer am Helferrechner entscheidet vor dem Start über Ressourcen und Verbindung.</p><div class="mapping-list"><div>${icon('download')}Einmaliger Laufzeitdownload · ca. 2,0 GiB</div><div>${icon('server')}CPU und RAM werden auf dem Helfer gewählt</div><div>${icon('shield')}Starten, Stoppen und Entfernen bleiben jederzeit erreichbar</div><div>${icon('info')}Der personalisierte Starter enthält den Zugang zu diesem BTS</div></div><div class="row space">${button('Windows-EXE · Demo','demo','download','primary')}${button('Linux-SH · Demo','demo','download')}</div>`);return;}
    if (action==='helper-disconnect') {showModal('Helfer trennen',`<p>Der Zugang für TIM-THINKPAD wird entzogen. Offene Aufträge werden wieder freigegeben.</p><p class="hint space">Die lokale Installation entfernt der Nutzer direkt am Helferrechner.</p>`,button('Trennen · Demo','demo','close','danger'));return;}
    if (action==='audio-play') {const playing=node.dataset.playing==='true';node.dataset.playing=String(!playing);node.innerHTML=icon(playing?'play':'pause');toast('Demo: Wiedergabebedienung. Es wird kein Audio abgespielt.');return;}
    if (action==='sort-points') {registrationRows.reverse();document.getElementById('registration-rows').innerHTML=registrationRows.map(registrationRow).join('');toast('Demo: Sortierreihenfolge umgekehrt.');return;}
    if (action==='registration-mark') {document.querySelectorAll('.row-select:checked').forEach(input=>{const row=input.closest('tr');const status=row.querySelector('.badge');status.textContent='Anwesend';status.className='badge good';row.querySelector('.switch').checked=true;});toast('Demo: Ausgewählte Paarungen als anwesend markiert.');return;}
    if (action==='tournament') {showModal('Turnier wechseln',`<div class="mapping-list"><div>${icon('court')}<span class="grow"><strong>Jugend-Rangliste 2026</strong><p class="hint">Campus Hellweg · 13 Felder</p></span>${badge('Aktiv','good')}</div><div>${icon('folder')}<span>Alle Turniere verwalten</span>${button('Öffnen · Demo','demo','arrow','sm')}</div></div>`);return;}
    if (action==='export') {showModal('Export & Urkunden',`<div class="form-grid"><label>Export<select><option>Siegerliste / Urkunden</option><option>CSV</option><option>Diagnosebericht</option><option>Diagramm als SVG / PDF</option></select></label><label>Disziplinen<select><option>Alle Disziplinen</option><option>Mixed U17</option></select></label></div><div class="notice space">Vorlagen, Platzierungsfilter und Disziplinzuordnungen bleiben erhalten. Im Mockup wird keine Datei erzeugt.</div>`,button('Exportieren · Demo','demo','download','primary'));return;}
    const messages={sync:'Demo: BTP-Abgleich angefordert.',announce:'Demo: Durchsage würde auf dem gewählten Ausgabekanal abgespielt.',evacuate:'Demo: Evakuierungsdurchsage würde unmittelbar abgespielt.',recall:`Demo: Zweiter Aufruf für Spiel ${number}.`,confirm:`Demo: Spielabschluss ${number} bestätigen.`,backup:'Demo: Datensicherung auswählen.', 'audio-test':'Demo: Sprachprobe vorhören.', 'helper-test':'Demo: Testauftrag an den nächsten freien Helfer.', 'test-start':'Demo: Testlauf gestartet.', 'test-pause':'Demo: Testlauf angehalten.', 'test-stop':'Demo: Testlauf beendet.', 'test-clock':'Demo: Testuhr-Einstellung übernommen.', 'context-generate':'Demo: Kontextaufnahme erzeugen oder aus Cache laden.', 'context-assemble':'Demo: Durchsage aus gewählten Bausteinen zusammensetzen.', 'lab-generate':'Demo: Hörvergleich erzeugen.', 'lab-rating':'Demo: Bewertung für die Hörprobe gespeichert.'};
    toast(messages[action]||'Demo: Diese Funktion bleibt bei einer Umsetzung erhalten.');
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-action]');
    if(!target)return;
    if(target.tagName==='A'&&event.metaKey)return;
    event.preventDefault();handleAction(target.dataset.action,target);
  });
  function clearDragState() {
    draggedGame = null;
    document.body.classList.remove('dragging-match');
    document.querySelectorAll('.drop-ready, .drop-hover, .drag-source').forEach(row=>row.classList.remove('drop-ready','drop-hover','drag-source'));
    document.getElementById('drag-preview')?.remove();
    document.getElementById('drag-field-dock')?.remove();
  }
  function acceptsDraggedGame(row) {
    return !!(draggedGame && row?.matches('[data-drop-field]') && !row.hidden && !draggedGame.entryBlocked);
  }
  function positionDragDock() {
    const dock=document.getElementById('drag-field-dock');
    if(dock) dock.style.top=Math.max(0,document.querySelector('.shell-header')?.getBoundingClientRect().bottom || 0)+'px';
  }
  function showDragDock(game) {
    const targets=[...document.querySelectorAll('.match-table [data-drop-field]')].filter(acceptsDraggedGame);
    const dock=document.createElement('aside');
    dock.id='drag-field-dock';dock.className='drag-field-dock';dock.setAttribute('aria-label',`Freie Felder für Spiel ${game.number}`);
    dock.innerHTML=`<div class="drag-dock-label"><strong>Spiel ${game.number} zuweisen</strong><span>Auf ein freies Feld ablegen · Esc bricht ab</span></div><div class="drag-dock-targets">${targets.length?targets.map(target=>`<button type="button" class="drag-field-target drop-ready" data-drop-field="${target.dataset.dropField}" data-location="${target.dataset.location}" title="Spiel ${game.number} auf Feld ${target.dataset.dropField} zuweisen">${court(target.dataset.dropField)}<span>Feld ${target.dataset.dropField}<small>${esc(locations.find(place=>place.id===target.dataset.location)?.name || target.dataset.location)}</small></span></button>`).join(''):`<span class="drag-dock-unavailable">${game.entryBlocked?'BTP-Sperrvermerk: Dieses Spiel kann nicht aufgerufen werden.':'Keine freien Felder in der aktuellen Ansicht.'}</span>`}</div>`;
    document.body.append(dock);
    positionDragDock();
  }
  window.addEventListener('scroll',positionDragDock,{passive:true});
  window.addEventListener('resize',positionDragDock);
  window.addEventListener('resize',positionBoardSidebar);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape') {clearDragState();clearCardDragState();}
    const tab=event.target.closest?.('[data-match-tab]');
    if(!tab || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const tabs=[...tab.parentElement.querySelectorAll('[data-match-tab]:not(:disabled)')];
    const current=tabs.indexOf(tab);
    const index=event.key==='Home'?0:event.key==='End'?tabs.length-1:(current+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    selectMatchTab(tabs[index].dataset.matchTab,true);
  });
  document.addEventListener('pointerdown',event=>{
    cardDragBlocked=!!(state.layoutEditing&&event.target.closest('[data-board-card]')&&event.target.closest('button,a,input,textarea,select,summary,[contenteditable]'));
  });
  document.addEventListener('dragstart', event=>{
    const card=event.target.closest('[data-board-card]');
    if(card&&state.layoutEditing&&event.dataTransfer) {
      if(cardDragBlocked||event.target.closest('button,a,input,textarea,select,summary,[contenteditable]')) {event.preventDefault();return;}
      clearCardDragState();clearDragState();draggedCard=card.dataset.boardCard;
      event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-bts-demo-card',draggedCard);
      event.dataTransfer.setData('text/plain',boardCards.find(card=>card.id===draggedCard).label);
      card.classList.add('card-drag-source');
      event.dataTransfer.setDragImage(card,Math.min(100,card.offsetWidth/2),20);
      document.body.classList.add('dragging-board-card');return;
    }
    if(state.layoutEditing) {event.preventDefault();return;}
    if(event.target.closest('button, a, input')) {event.preventDefault();return;}
    const row = event.target.closest('[data-drag-game]');
    const game = row && upcoming.find(game=>game.number===Number(row.dataset.dragGame) && completeGame(game));
    if (!game || !event.dataTransfer) return;
    clearDragState();
    draggedGame = game;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-bts-demo-match', String(game.number));
    event.dataTransfer.setData('text/plain', 'Spiel '+game.number);
    row.classList.add('drag-source');
    document.body.classList.add('dragging-match');
    showDragDock(game);
    document.querySelectorAll('[data-drop-field]').forEach(target=>target.classList.toggle('drop-ready', acceptsDraggedGame(target)));
    const preview=document.createElement('div');
    preview.id='drag-preview';preview.className='drag-preview';preview.textContent=`Spiel ${game.number} · ${game.event}`;
    document.body.append(preview);
    event.dataTransfer.setDragImage(preview, 20, 15);
  });
  document.addEventListener('dragover', event=>{
    if(draggedCard) {
      const placement=boardCardDrop(event);
      document.querySelectorAll('.card-drop-before,.card-drop-after,.card-drop-swap,.card-zone-hover').forEach(node=>node.classList.remove('card-drop-before','card-drop-after','card-drop-swap','card-zone-hover'));
      if(placement) {
        event.preventDefault();if(event.dataTransfer) event.dataTransfer.dropEffect='move';
        placement.container.classList.add('card-zone-hover');
        placement.card?.classList.add(placement.swap?'card-drop-swap':placement.after?'card-drop-after':'card-drop-before');
      }
      return;
    }
    const target=event.target.closest('[data-drop-field]');
    document.querySelectorAll('.drop-hover').forEach(row=>{if(row!==target)row.classList.remove('drop-hover');});
    if (!acceptsDraggedGame(target)) return;
    event.preventDefault();
    if(event.dataTransfer)event.dataTransfer.dropEffect='move';
    target.classList.add('drop-hover');
  });
  document.addEventListener('dragleave', event=>{
    if(draggedCard) {
      const container=event.target.closest('[data-card-zone]');
      if(container&&(!event.relatedTarget||!container.contains(event.relatedTarget))) {
        container.classList.remove('card-zone-hover');
        container.querySelectorAll('.card-drop-before,.card-drop-after,.card-drop-swap').forEach(node=>node.classList.remove('card-drop-before','card-drop-after','card-drop-swap'));
      }
      return;
    }
    const target=event.target.closest('[data-drop-field]');
    if(target && (!event.relatedTarget || !target.contains(event.relatedTarget))) target.classList.remove('drop-hover');
  });
  document.addEventListener('drop', event=>{
    if(draggedCard) {
      const placement=boardCardDrop(event),id=draggedCard;
      clearCardDragState();
      if(placement) {
        event.preventDefault();
        if(placement.swap) swapBoardCards(id,placement.swap);
        else moveBoardCard(id,placement.zone,placement.before);
      }
      return;
    }
    const target=event.target.closest('[data-drop-field]');
    const allowed=acceptsDraggedGame(target), game=draggedGame;
    clearDragState();
    if(!allowed)return;
    event.preventDefault();
    handleAction('assign', {dataset:{field:target.dataset.dropField,number:String(game.number)}});
  });
  document.addEventListener('dragend',()=>{clearDragState();clearCardDragState();});
  function applyRowFilters(scope) {
    const query = scope.querySelector('[data-search-target]')?.value.toLowerCase().trim() || '';
    const status = scope.querySelector('[data-change="game-filter"]')?.value || 'all';
    const level = scope.querySelector('[data-change="log-filter"]')?.value || 'all';
    scope.querySelectorAll('[data-search-row]').forEach(row => {
      const matchingStatus = !row.dataset.status || status === 'all' || (status === 'unfinished' ? row.dataset.status !== 'done' : row.dataset.status === status);
      const matchingLevel = !row.dataset.level || level === 'all' || row.dataset.level === level;
      const matchingLocation = !row.dataset.courtLocation || state.deviceLocations[row.dataset.courtLocation]?.fields !== false;
      row.hidden = !row.dataset.search.includes(query) || !matchingStatus || !matchingLevel || !matchingLocation;
    });
  }
  function applyDeviceLocations() {
    const content=document.getElementById('content');
    applyRowFilters(content);
    content.querySelectorAll('[data-action="preparation-call"]').forEach(button=>{button.hidden=!state.deviceLocations[button.dataset.location]?.fields;});
    const counts=content.querySelector('[data-field-counts]');
    if(counts) counts.innerHTML=fieldCounts();
  }
  document.addEventListener('input',event=>{
    const input=event.target;
    if(input.matches('[data-search-target]')) {
      const scope=input.closest('dialog')||document.getElementById('content');
      applyRowFilters(scope);
    }
    if(input.matches('[data-save]')) {
      const node=document.getElementById('save-status');if(node){node.textContent='Wird gespeichert …';setTimeout(()=>{node.textContent='In der Vorschau übernommen';},500);}
    }
    if(input.dataset.change==='tempo') input.parentElement.querySelector('.tempo-value').textContent=Number(input.value).toFixed(2).replace('.',',')+'×';
  });
  document.addEventListener('change',event=>{
    const node=event.target;
    if (node.dataset.change==='location-highlight') {
      const place = locations.find(location => location.id === node.dataset.location);
      const highlight = Number(node.value);
      if (!place || !highlights[highlight] || locations.some(other=>other!==place && other.highlight===highlight)) return;
      place.highlight=highlight;
      render();
      toast('Vorschau: Vorbereitungsfarbe geändert. BTS und BTP werden nicht verändert.');
    }
    if(['game-filter','log-filter'].includes(node.dataset.change)) applyRowFilters(document.getElementById('content'));
    if(node.dataset.change==='select-all') document.querySelectorAll('.row-select').forEach(input=>{input.checked=node.checked;});
    if(node.dataset.change==='device-location') {
      const settings=state.deviceLocations[node.dataset.location];
      if(!settings || !Object.hasOwn(settings,node.dataset.option)) return;
      settings[node.dataset.option]=node.checked;
      if(node.dataset.option==='fields') applyDeviceLocations();
    }
    if(node.dataset.change==='remote-announcements') state.remoteAnnouncements=node.checked;
  });
  document.getElementById('modal').addEventListener('click',event=>{if(event.target===event.currentTarget)event.currentTarget.close();});
  window.addEventListener('hashchange',render);
  render();
  window.BTSDesignPreview={variant,pages:Object.keys(pages),mapping:mapping.map(([name])=>name),highlights,locations,preparationSelection};
})();
