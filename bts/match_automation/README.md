# Match automation helpers

`frontier_positions.js` indexes block positions in an ordered match list. It
counts consecutive block changes, so a block name that occurs again later has
a new position. Lookups prefer the match object and fall back to the first
strictly matching ID. Missing matches have infinite distance.

One `FrontierPositions` instance lives only for a synchronous calculation.
`match_automation.js` passes it through a private symbol on copied options;
caller options and tournament objects are not modified. Each exact list is
indexed lazily once, and different lists retain separate positions. Keys and
list order must stay unchanged during the calculation. Subsequent calculations
create a fresh instance and therefore observe edits, deletions and reordering.

Preparation selection shares the index across candidate checks, display
windows, and diagnostics. Its court diagnostics also reuse one ordered list
per location. Existing eligibility rules and bye dependencies remain in
`match_automation.js`.
