'use strict';
const fs=require('fs'),path=require('path');

module.exports=async function({c,check,click,open,metrics,previews}) {
 const checks=[],verify=async(name,expression)=>{await check(name,expression);checks.push(name);};
 const button='.board-toolbar-actions [data-action="density"]';
 await open(1920,1080);
 await c.evaluate(`(()=>{
  const qa=window.__densityQA={rows:[...document.querySelectorAll('tr.ls-match')]};
  qa.members=qa.rows.flatMap(row=>[...row.querySelectorAll('.player,.umpire_and_tablet .name')]);
  qa.labels=qa.members.map(node=>node.firstChild);
  qa.same=()=>qa.rows.every(row=>row.isConnected)&&qa.members.every((node,index)=>node.isConnected&&node.firstChild===qa.labels[index]);
  qa.measure=()=>[...document.querySelectorAll('.match_table tbody>tr[data-match_id]')].map(row=>({height:row.getBoundingClientRect().height,cells:[...row.cells].map(cell=>{const style=getComputedStyle(cell);return [style.height,style.padding,style.fontSize,style.lineHeight];})}));
 })()`);
 await verify('Normal is the default and replaces the old compact label',`document.querySelector('.leitstand').dataset.density==='normal'&&document.querySelector('${button}').textContent.trim()==='Normal'&&!document.querySelector('.leitstand').classList.contains('comfort')`);
 await c.evaluate('__densityQA.normal=__densityQA.measure()');
 await click(button);
 await verify('The next stage is Komfort with the existing larger row sizes',`document.querySelector('.leitstand').dataset.density==='comfort'&&document.querySelector('${button}').textContent.trim()==='Komfort'&&document.querySelector('.leitstand').classList.contains('comfort')&&__densityQA.measure()[0].height>__densityQA.normal[0].height&&__densityQA.same()`);
 await click(button);
 await verify('The third stage Kompakt uses its own smaller row sizes',`document.querySelector('.leitstand').dataset.density==='compact'&&document.querySelector('${button}').textContent.trim()==='Kompakt'&&__densityQA.measure().every((row,index)=>row.height<=__densityQA.normal[index].height+.15)&&__densityQA.measure().some((row,index)=>row.height<__densityQA.normal[index].height-.15)&&__densityQA.same()`);
 await verify('The control identifies the current stage and the next choice',`document.querySelector('${button}').title==='Ansicht wechseln: Normal'&&document.querySelector('${button}').getAttribute('aria-label')==='Ansicht: Kompakt. Wechseln zu Normal.'`);
 await click(button);
 await verify('A full cycle returns to Normal without replacing games, players or name objects',`document.querySelector('.leitstand').dataset.density==='normal'&&__densityQA.same()`);
 await metrics(390,844);
 await verify('Normal remains available on a narrow screen',`document.querySelector('${button}').getBoundingClientRect().width>0&&document.documentElement.scrollWidth<=innerWidth`);
 await c.evaluate('__densityQA.mobileNormal=__densityQA.measure()');
 await click(button);await click(button);
 await verify('Kompakt also reduces row heights on mobile','__densityQA.measure().every((row,index)=>row.height<=__densityQA.mobileNormal[index].height+.15)&&__densityQA.measure().some((row,index)=>row.height<__densityQA.mobileNormal[index].height-.15)&&__densityQA.same()');
 await open(1920,1080);
 await verify('The new compact choice survives a page reload',`document.querySelector('.leitstand').dataset.density==='compact'&&document.querySelector('${button}').textContent.trim()==='Kompakt'&&localStorage.getItem('bts-admin-density-v2')==='compact'`);
 for(const [legacy,expected,label] of [['compact','normal','Normal'],['comfort','comfort','Komfort']]) {
  await c.evaluate(`localStorage.removeItem('bts-admin-density-v2');localStorage.setItem('bts-admin-density',${JSON.stringify(legacy)})`);
  await open(1920,1080);
  await verify('The legacy '+legacy+' preference becomes '+label,`document.querySelector('.leitstand').dataset.density===${JSON.stringify(expected)}&&document.querySelector('${button}').textContent.trim()===${JSON.stringify(label)}`);
 }
 await c.evaluate(`localStorage.setItem('bts-admin-density-v2','normal')`);await open(1920,1080);
 await verify('A new preference takes precedence over the old comfort preference',`document.querySelector('.leitstand').dataset.density==='normal'`);
 await c.evaluate(`localStorage.setItem('bts-admin-density-v2','invalid');localStorage.setItem('bts-admin-density','compact')`);await open(1920,1080);
 await verify('An invalid saved stage falls back to the migrated Normal preference',`document.querySelector('.leitstand').dataset.density==='normal'`);
 await c.evaluate(`(()=>{const native=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new Error('Storage blocked');};document.querySelector('${button}').click();Storage.prototype.setItem=native;ctournament.ui_show();})()`);
 await verify('A blocked storage write retains a usable stage throughout a view rebuild',`document.querySelector('.leitstand').dataset.density==='comfort'&&document.querySelector('${button}').textContent.trim()==='Komfort'`);
 const exceptions=c.events.filter(event=>event.method==='Runtime.exceptionThrown');await verify('Density switching and legacy migration produce no browser exceptions',String(exceptions.length===0));
 fs.writeFileSync(path.join(previews,'density-verification.json'),JSON.stringify({date:'2026-10-31',checks,exceptions:exceptions.length,scope:'Isolated frontend: three density levels, compact dimensions, DOM retention and browser preference migration.'},null,2)+'\n');
 console.log(JSON.stringify({checks:checks.length,exceptions:exceptions.length}));
};
