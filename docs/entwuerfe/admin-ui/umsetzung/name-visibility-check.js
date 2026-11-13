'use strict';
/* eslint-disable no-console, quotes -- Native browser checks embed JavaScript scripts. */
const fs=require('fs'),assert=require('assert');
module.exports=async({c,open,previews})=>require('./call-status-benchmark')({c,open,afterSetup:async()=>{
const result=await c.evaluate(`(async()=>{
for(const match of curt.matches)delete match.btp_winner;
ctournament.ui_show();await __statusBench.settle();await new Promise(r=>setTimeout(r,200));
const match=curt.matches.at(-1),row=document.querySelector('tr[data-match_id="'+match._id+'"]'),player=match.setup.teams[0].players[0],node=row.querySelector('.player[data-btp_id="'+player.btp_id+'"]'),name=node.firstChild;
const prototypes=[...new Set([CanvasRenderingContext2D.prototype,globalThis.OffscreenCanvasRenderingContext2D?.prototype].filter(Boolean))],originals=prototypes.map(p=>[p,p.measureText]);let calls=0;
const rectangle=Element.prototype.getBoundingClientRect,rangeRectangle=Range.prototype.getBoundingClientRect;let rectangles=0;
for(const [prototype,native]of originals)prototype.measureText=function(...args){calls++;return native.apply(this,args)};
Element.prototype.getBoundingClientRect=function(...args){if(this.closest?.('.ls-probe-root,[data-ls-text-ruler]')||this.matches?.('.ls-layout-probe'))rectangles++;return rectangle.apply(this,args)};
Range.prototype.getBoundingClientRect=function(...args){rectangles++;return rangeRectangle.apply(this,args)};
try {
player.now_playing_on_court='C77';cmatch.update_player_status_indicators_for_match_players(match,{immediate:true});await __statusBench.settle();
const hidden={calls,rectangles,badge:node.querySelector('.ls-resource-court')?.textContent,nameRetained:node.firstChild===name};
row.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,100));await __statusBench.settle();
const box=rectangle.call(row),team=row.querySelector('.team-one');
const after={calls,rectangles,visible:box.top<innerHeight&&box.bottom>0,badge:node.querySelector('.ls-resource-court')?.textContent,stacked:team.classList.contains('ls-team-stacked'),teamWidth:team.clientWidth,maxPlayerWidth:Math.max(...[...team.querySelectorAll('.player')].map(p=>rectangle.call(p).width)),nameRetained:node.firstChild===name};
scrollTo(0,0);await new Promise(r=>setTimeout(r,200));await __statusBench.settle();
const beforeRename={calls,rectangles};Object.assign(player,{firstname:'Visibility',lastname:'Changed',name:'Visibility Changed'});node.style.fontWeight='bold';cmatch.update_match_player_names(match);await __statusBench.settle();
const hiddenRename={calls:calls-beforeRename.calls,rectangles:rectangles-beforeRename.rectangles};
row.scrollIntoView({block:'center'});await new Promise(r=>setTimeout(r,100));await __statusBench.settle();
return {hidden,after,hiddenRename,renamedAfterScroll:node.textContent.includes('Changed'),errors:__statusErrors};
}finally{for(const [prototype,native]of originals)prototype.measureText=native;Element.prototype.getBoundingClientRect=rectangle;Range.prototype.getBoundingClientRect=rangeRectangle;}
})()`);
fs.writeFileSync(previews+'/name-visibility-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
assert(!result.errors.length&&result.hidden.nameRetained&&result.after.nameRetained&&result.hidden.badge==='C77'&&result.after.badge==='C77');
assert.strictEqual(result.hidden.calls,0,'Distant names need no canvas measurement');assert.strictEqual(result.hidden.rectangles,0,'Distant names need no native fitting');
assert(result.after.visible&&result.after.calls+result.after.rectangles>0,'Scrolling must fit the pending names before use');
assert.deepStrictEqual(result.hiddenRename,{calls:0,rectangles:0},'Hidden renamed/styled players wait for approach');assert(result.renamedAfterScroll,'Scrolling must use the latest player name and style');
}});
