'use strict';

const labels = {match_results:'Ergebnisse und Sieger',court_assignments:'Feldzuweisungen',player_pauses:'Spielerpausen'};

function validate({target, actions, match_ids} = {}) {
 if (!['bts','both'].includes(target)) throw new Error('Bitte BTS oder BTS und BTP als Ziel auswählen.');
 if (!Array.isArray(actions) || !actions.length || actions.length > 3 ||
  actions.some(action => typeof action !== 'string' || !Object.hasOwn(labels,action)) || new Set(actions).size !== actions.length) {
  throw new Error('Bitte mindestens einen gültigen Bereich ohne doppelte Einträge auswählen.');
 }
 if (match_ids !== undefined && (!actions.includes('match_results') || !Array.isArray(match_ids) || !match_ids.length ||
  match_ids.some(id => typeof id !== 'string' || !id) || new Set(match_ids).size !== match_ids.length)) throw new Error('Ungültige Spielauswahl.');
 return {target,actions:Object.keys(labels).filter(action => actions.includes(action)),...(match_ids ? {match_ids:[...match_ids]} : {})};
}

// BTP writes cannot be rolled back as a transaction. Report completed steps
// explicitly if a later action fails; never claim that the entire plan succeeded.
async function execute(plan, operations) {
 const {target,actions,match_ids} = validate(plan), completed = [], results = {};
 for (const action of actions) {
  try {results[action] = await operations[action](target,match_ids);completed.push(action);}
  catch (error) {
   const prefix = completed.length ? 'Bereits ausgeführt: ' + completed.map(name => labels[name]).join(', ') + '. ' : '';
   throw Object.assign(new Error(prefix + labels[action] + ': ' + (error.message || 'Zurücksetzen fehlgeschlagen.')), {completed:[...completed],results,failed:action});
  }
 }
 return {target,completed,results};
}

module.exports = {validate,execute};
