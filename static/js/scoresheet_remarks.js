/* global calc */
'use strict';

// BUP and tournament-control remarks share the native scoresheet's note presses.
var btsScoresheetRemarks = (scoring => {
 const MAX_LENGTH = 4000;
 const ROLES = Object.freeze({umpire:'Schiedsrichter',tournament_control:'Turnierleitung',referee:'Referee'});
 function roleLabel(role) { return Object.hasOwn(ROLES,role) ? ROLES[role] : ROLES.umpire; }
 function entries(match, {includeDeleted = false} = {}) {
  let notes;
  try { notes = scoring.note_history(match.presses); }
  catch { notes = []; } // A malformed history remains available in the raw-data tab.
  for (const note of notes) for (const version of note.versions) if (!Array.isArray(version.score) && match.setup) {
   try {
    const state=scoring.remote_state({},match.setup,match.presses.slice(0,version.index+1));
    version.score=scoring.netscore(state,true);
   } catch { /* Older incomplete histories cannot supply a reliable score. */ }
  }
  if (match.scoresheet_notes) notes.push({key:'legacy',latest_key:'legacy',val:match.scoresheet_notes,role:'umpire',deleted:false,
   versions:[{key:'legacy',val:match.scoresheet_notes,source:'tournament-control',role:'umpire',deleted:false}]});
  return includeDeleted ? notes : notes.filter(note => !note.deleted);
 }
 function text(match) { return entries(match).map(note => (note.role === 'umpire' ? '' : roleLabel(note.role) + ': ') + note.val).join('\n\n'); }
 function scoreText(score) {
  if (!Array.isArray(score)) return 'nicht überliefert';
  return score.length ? score.map(set => set.join(':')).join('  ') : '0:0';
 }
 function signature(match) {
  const notes = [];
  (match.presses || []).forEach((press,index) => {
   if (press.type === 'note') notes.push(press.note_id || [index,press.val,press.timestamp]);
   else if (['undo','redo'].includes(press.type)) notes.push([index,press.type]);
  });
  return JSON.stringify([match.scoresheet_notes || '', notes]);
 }
 function stateForReport(state, match = state) {
  // Preserve the full history: the native renderer resolves undo/redo itself.
  const presses = [...(match.presses || [])];
  if (match.scoresheet_notes) presses.push({type:'note',val:match.scoresheet_notes,note_id:'legacy'});
  return {...state, presses};
 }
 return { MAX_LENGTH, ROLES, roleLabel, entries, text, stateForReport, signature, scoreText };
})(typeof module !== 'undefined' && module.exports ? require('../bup/dev/js/calc') : calc);

/*@DEV*/
if (typeof module !== 'undefined') module.exports = btsScoresheetRemarks;
/*/@DEV*/
