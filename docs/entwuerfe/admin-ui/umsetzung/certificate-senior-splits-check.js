'use strict';

module.exports = async function({c, verify, metrics}) {
 await c.evaluate(String.raw`(()=>{
  crouting.on_change({ctype:'match_delete',tournament_key:'preview',val:{match__id:'certificate-senior-1'}});
  const base=structuredClone(curt.matches[0]);
  for(const [index,years,names] of [[0,[1986,1981],['O40 Sieger','O45 Sieger']],[1,[1976,1985],['O45 Zweiter','O40 Zweiter']]]) {
   const match=structuredClone(base);match._id='certificate-senior-split-'+index;match.setup.event_name='HE 40+45';match.setup.match_name=index?'3/4':'Finale';match.setup.scheduled_date='2026-11-21';match.setup.is_doubles=false;
   match.team1_won=true;match.network_score=[[21,12],[21,10]];
   match.setup.teams=years.map((birth_year,i)=>({players:[{btp_id:30000+index*2+i,name:names[i],birth_year}]}));
   crouting.on_change({ctype:'match_add',tournament_key:'preview',val:{match__id:match._id,match}});
  }
  __certificateAction('Filter zurücksetzen');__certificateAction('Auswahl aufheben');
  window.__seniorRow=__certificatePage().querySelector('[data-event-key="HE 40+45"]');__seniorRow.querySelector('.certificate-event-name').click();
  window.__seniorControl=__seniorRow.nextElementSibling.querySelector('input[data-age-group="O45"]');
 })()`);
 await verify('Combined senior disciplines offer the older O class with the DBV cutoff for their season',String.raw`!!__seniorControl&&__seniorRow.nextElementSibling.textContent.includes('01.01.2027')&&__seniorRow.nextElementSibling.querySelectorAll('input[data-age-group]').length===1&&!__seniorControl.checked`);
 await c.evaluate(String.raw`__seniorControl.focus();__seniorControl.click()`);
 await verify('Enabling the O45 valuation preserves focus and the parent row and labels its remaining class O40',String.raw`document.activeElement===__seniorControl&&__certificatePage().querySelector('[data-event-key="HE 40+45"]')===__seniorRow&&__seniorRow.querySelector('.certificate-event-name').textContent.includes('HE O40')&&!__seniorRow.querySelector('.certificate-event-name').textContent.includes('+45')&&__certificatePending.length===1&&__certificatePending[0].message.props.certificate_age_class_splits['HE 40+45'].join('|')==='O45'`);
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props');window.__seniorChild=__certificatePage().querySelector('[data-event-key="HE 40+45::age:O45"]');__seniorChild.querySelector('.certificate-event-name').click()`);
 await verify('Each senior valuation starts at first place and contains only its own participants',String.raw`__seniorRow.nextElementSibling.querySelector('.certificate-placement-list').textContent==='1. Platz: O40 Sieger2. Platz: O40 Zweiter'&&__seniorChild.nextElementSibling.querySelector('.certificate-placement-list').textContent==='1. Platz: O45 Sieger2. Platz: O45 Zweiter'&&__seniorChild.querySelector('.certificate-event-name').textContent.includes('HE O45 (aus O40+45)')&&__seniorChild.querySelector('.certificate-starters').textContent==='2'`);
 await metrics(390,844);
 await verify('Senior split controls, cutoff explanation and both rankings fit on mobile',String.raw`document.documentElement.scrollWidth<=innerWidth&&__seniorControl.getClientRects().length>0&&__seniorChild.nextElementSibling.querySelector('.certificate-placement-list').getClientRects().length>0`);
 await metrics(1920,1080);
 await c.evaluate(String.raw`__seniorChild.querySelector('input[data-certificate-key]').click();__certificatePage().querySelector('.certificate-export-csv').click()`);
 await verify('Exporting the selected O45 valuation writes its own age and ranks and marks only its split key',String.raw`__certificatePending.length===1&&__certificatePending[0].message.event_names.join('|')==='HE 40+45::age:O45'&&(await __certificateFiles.at(-1).blob.text()).includes(';HE;O45;1. Platz;O45 Sieger;')&&(await __certificateFiles.at(-1).blob.text()).includes(';HE;O45;2. Platz;O45 Zweiter;')&&!(await __certificateFiles.at(-1).blob.text()).includes('O40 Sieger')`);
 await c.evaluate(String.raw`__certificateReply('certificate_export_mark',null,{certificate_exports:{...curt.certificate_exports,'HE 40+45::age:O45':Date.now()}});__certificateLeave();__certificateTrigger().click();__certificateAction('Filter zurücksetzen')`);
 await verify('The saved senior split and its separate export marker survive reopening the certificate page',String.raw`__certificatePage().querySelector('[data-event-key="HE 40+45"] .certificate-event-name').textContent.includes('HE O40')&&__certificatePage().querySelector('[data-certificate-key="HE 40+45::age:O45"]').dataset.exported==='true'`);
 await c.evaluate(String.raw`(()=>{
  window.__seniorRow=__certificatePage().querySelector('[data-event-key="HE 40+45"]');__seniorRow.querySelector('.certificate-event-name').click();window.__seniorControl=__seniorRow.nextElementSibling.querySelector('input[data-age-group="O45"]');__seniorControl.focus();__seniorControl.click();
 })()`);
 await verify('Removing the O split restores the original combined discipline and all four overall places',String.raw`document.activeElement===__seniorControl&&__seniorRow.querySelector('.certificate-event-name').textContent.includes('HE O40+45')&&!__certificatePage().querySelector('[data-certificate-key="HE 40+45::age:O45"]')&&__certificatePending[0].message.props.certificate_age_class_splits['HE 40+45']===undefined&&__seniorRow.querySelector('.certificate-starters').textContent==='4'`);
 await c.evaluate(String.raw`__certificateReply('tournament_edit_props');__certificatePage().querySelector('[data-event-key="MX 40+45"] .certificate-event-name').click()`);
 await verify('A combined O discipline with missing birth years explains the missing data instead of guessing a split',String.raw`(()=>{const panel=__certificatePage().querySelector('[data-event-key="MX 40+45"]').nextElementSibling;return panel.textContent.includes('Geburtsjahre aller Teilnehmer')&&!panel.querySelector('input[data-age-group]');})()`);
};
