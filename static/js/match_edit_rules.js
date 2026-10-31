'use strict';

// Shared completion definition for the editor and its server-side guard.
// eslint-disable-next-line no-unused-vars -- Used by the classic browser scripts.
var btsMatchEditRules = (() => {
 const setupFields = ['state', 'now_on_court', 'court_id', 'location_id', 'umpire', 'service_judge', 'tabletoperators', 'preparation_call_deferred'];
 const controls = ['match_status', 'court_id', 'umpire_name', 'service_judge_name', 'show_all_officials', 'tabletoperator_assignment_id', 'tabletoperator_replacement_name', 'tabletoperator_replacement_btp_id'];
 function finished(match) {
  const setup = match?.setup || {};
  return setup.state === 'finished' || !!match?.btp_winner || !!match?.end_ts || !!setup.end_ts ||
   (!setup.now_on_court && (typeof match?.team1_won === 'boolean' || ['walkover', 'retired', 'disqualified', 'no_match'].includes(match?.score_status)));
 }
 return {finished, setupFields, controls};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = btsMatchEditRules;
