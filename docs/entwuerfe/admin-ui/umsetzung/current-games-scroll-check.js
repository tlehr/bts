'use strict';
/* eslint no-console: off */
const fs=require('fs'),path=require('path');

module.exports=async function({c,check,click,open,metrics,previews}) {
 const checks=[],samples=[],verify=async(name,expression)=>{await check(name,expression);checks.push(name);};
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const template=curt.matches.find(match=>match._id==='match-44');
  // All fifteen courts are occupied, including the final row in the second hall.
  for(let num=1;num<=15;num++) {
   let court=curt.courts.find(court=>Number(court.num)===num);
   if(!court){court={_id:'SN_'+num,num:String(num),location_id:'SN',is_active:true};curt.courts.push(court);}
   if(!court.match_id){const match=structuredClone(template);match._id='scroll-match-'+num;match.presses=[];curt.matches.push(match);court.match_id=match._id;}
   const match=curt.matches.find(match=>match._id===court.match_id);
   match.setup={...match.setup,is_doubles:false,court_id:court._id,location_id:court.location_id,warmup:undefined,
    teams:match.setup.teams.map(team=>({...team,players:team.players.slice(0,1)})),tabletoperators:match.setup.tabletoperators.slice(0,1)};
   match.network_score=num===15?[[20,18]]:[[21,19],[19,21],[9,11]];match.presses=[];
  }
  ctournament.ui_show();
  const lastCourt=curt.courts.find(court=>Number(court.num)===15);
  const qa=window.__currentScroll={last:structuredClone(curt.matches.find(match=>match._id===lastCourt.match_id))};
  qa.rows=[...document.querySelectorAll('.courts_container .court_row')];
  qa.same=()=>qa.rows.every(row=>row.isConnected);
  qa.lastState=kind=>{
   const match=structuredClone(qa.last);
   if(kind==='warmup'){match.network_score=[[0,0]];match.setup.warmup='call-up';}
   if(kind==='pause'){
    const now=Date.now(),presses=[];
    const add=(type,extra={})=>presses.push({type,timestamp:now-20000+presses.length,...extra});
    add('pick_side',{team1_left:true});add('love-all');
    for(let point=0;point<11;point++)add('score',{side:'left'});
    match.presses=presses;match.network_score=[[11,0]];
   }
   crouting.on_change({ctype:'match_edit',tournament_key:'preview',val:{match__id:match._id,match}});
  };
  qa.measure=()=>{
   const wrap=document.querySelector('.courts_container .table-wrap'),table=wrap.querySelector('table');
   const box=wrap.getBoundingClientRect(),border=getComputedStyle(wrap),bottom=box.top+wrap.clientTop+wrap.clientHeight;
   const rows=[...table.querySelectorAll('tbody>tr')].filter(row=>row.getBoundingClientRect().height);
   wrap.scrollTop=10000;const scrollTop=wrap.scrollTop;wrap.scrollTop=0;
   wrap.scrollLeft=100;const horizontalScroll=wrap.scrollLeft;wrap.scrollLeft=0;
   const visible=[...rows.at(-1).querySelectorAll('.court_num,.name,.player,.ls-set-score,.timer,.ls-icon-action')].filter(node=>node.getBoundingClientRect().height&&getComputedStyle(node).visibility!=='hidden');
   return {density:document.querySelector('.leitstand').dataset.density,clientHeight:wrap.clientHeight,scrollHeight:wrap.scrollHeight,
    scrollTop,horizontalScroll,overflowY:border.overflowY,clientWidth:wrap.clientWidth,scrollWidth:wrap.scrollWidth,
    tableHeight:table.getBoundingClientRect().height,tableFits:table.getBoundingClientRect().bottom<=bottom+.5,
    controlsFit:visible.every(node=>node.getBoundingClientRect().bottom<=bottom+.5),clockVisible:visible.some(node=>node.classList.contains('timer')),rows:qa.rows.length,
    lastCourt:rows.at(-1).querySelector('.court_num').textContent.trim()};
  };
 })()`);
 const densityButton='.board-toolbar-actions [data-action="density"]';
 for(const [width,height]of [[2560,1080],[1920,1080],[1536,864],[1000,720],[390,844]]) {
  await metrics(width,height);
  for(const density of ['normal','comfort','compact']) {
   for(let step=0;step<3&&await c.evaluate(`document.querySelector('.leitstand').dataset.density!==${JSON.stringify(density)}`);step++)await click(densityButton);
   for(const kind of ['score','warmup','pause']) {
    await c.evaluate(`__currentScroll.lastState(${JSON.stringify(kind)})`);
    await verify(density+' keeps all fifteen court rows when the last game shows '+kind+' at '+width,'__currentScroll.same()&&document.querySelectorAll(\'.courts_container .court_row\').length===15');
    const sample=await c.evaluate('__currentScroll.measure()');samples.push({width,height,kind,...sample});
    // A zero scroll range alone misses the regression on platforms whose font
    // metrics happen to fit. The frame must forbid vertical scrollbars too.
    await verify(density+' prevents an inner vertical scrollbar with '+kind+' at '+width,
     String(!['auto','scroll'].includes(sample.overflowY)));
    await verify(density+' has no vertical scrolling beside current games with '+kind+' at '+width,
     String(sample.scrollHeight===sample.clientHeight&&sample.scrollTop===0));
    await verify(density+' shows the complete final court and its controls with '+kind+' at '+width,
     String(sample.tableFits&&sample.controlsFit&&sample.lastCourt==='15'&&sample.clientHeight>=sample.tableHeight-.5));
    if(kind!=='score')await verify(density+' displays the '+kind+' clock in the final row at '+width,String(sample.clockVisible));
    if(width===390)await verify(density+' still allows horizontal table scrolling with '+kind,
     String(sample.scrollWidth>sample.clientWidth&&sample.horizontalScroll>0));
   }
  }
 }
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');
 await verify('Current game layouts produce no browser exceptions',String(!exceptions.length));
 fs.writeFileSync(path.join(previews,'current-games-scroll-verification.json'),JSON.stringify({date:'2026-10-31',
  scope:'Isolated frontend; fifteen occupied courts, two locations, all density modes, scores and clocks in the final row.',checks,exceptions:exceptions.length,samples},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
