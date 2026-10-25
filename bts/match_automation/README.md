# Match automation helpers

`frontier_positions.js` indexes block positions in an ordered match list. It
counts consecutive block changes, so a block name that occurs again later has
a new position. Lookups prefer the match object and fall back to the first
strictly matching ID. Missing matches have infinite distance.

One `FrontierPositions` instance lives only for one calculation over stable inputs.
`match_automation.js` passes it through a private symbol on copied options;
caller options and tournament objects are not modified. Each exact list is
indexed lazily once, and different lists retain separate positions. Keys and
list order must stay unchanged during the calculation. Subsequent calculations
create a fresh instance and therefore observe edits, deletions and reordering.

Read-only admin selections use immutable snapshot records and can yield between
candidate discovery, display-window calculation, and diagnostic batches. The
cooperative runner checks point priority before advancing each step and gives
the event loop a turn after roughly 2 ms of work. An individual step can exceed
that budget. Synchronous automation drains the same calculation steps without
pausing; eligibility and selection rules are shared by both paths.

Preparation selection shares the index across candidate checks, display
windows, and diagnostics. Its court diagnostics also reuse one ordered list
per location. Existing eligibility rules and bye dependencies remain in
`match_automation.js`.
