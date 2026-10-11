# Incremental BTP match selection

`sources.js` compares the incoming match fields and shared player, draw, event,
stage, scoring, court and official inputs. Player entry-status Maps participate
in the comparison. Player profiles are separated from planning topology so one
check-in does not invalidate an entire draw. Matches also observe their immediate
planning sources, including hidden entries and byes.

`integrated_match.js` shares the integration loop's eligibility check: only
`IsMatch[0]` records without `ReverseHomeAway` enter the match selection and its
local-document comparisons. Hidden nodes and reversed records stay in the full
planning graph and the existing dependency lookup. Their changes still invalidate
dependent matches and hidden-bye candidate caches; they never need a local match
document merely to track those dependencies.

`graph.js` tracks planning records and their topology separately from player
profiles and match check-in bits. Unchanged topology fingerprints are reused.
`match_input.js` computes the combined persistent signature only for a selected
match, through a shared prototype.
`input_revision.js` retains immutable, equal source revisions without repeating
their JSON serialization, including player entry-status Maps.

`local.js` compares immutable local document revisions. Ordinary point traffic
does not invalidate a running match; results, opponents, check-ins, court/setup
changes and pending BTP confirmations do. The cached projection never owns mutable
database copies and never modifies canonical tournament objects.

`index.js` selects candidates and owns the successful baseline per datastore and
tournament. Result, participant and graph changes conservatively select the
affected draw. Global configuration changes select all matches. Selected matches
still pass the existing signature, result protection, merge and write checks.
The persisted signature also includes the selected source inputs, covering club
names and nested entry-status Maps which the old match-only JSON omitted.

Local baselines describe the start of the integration. Writes during integration,
concurrent edits, discarded plans and rollback therefore remain visible on the
next pass. Known successful writes without result/participant dependency changes
can advance just their own baseline. Later edits are still compared with that
exact written state. A failed integration drops the baseline. Live and private planner
datastores have separate caches.

When topology and local result/participant dependencies are unchanged, dependency
lookups and hidden-bye candidate scans are reused. `dependencies.js` rebinds the
lookup data maps to the current response and local document revisions before
processing selected matches; topology arrays and labels remain valid. Required hidden-bye deliveries
still repeat until BTP acknowledges them. Normalizers and their time-dependent
pause checks continue after match integration.

`integrate_matches_detail` timing reports `raw_incoming` (all BTP match records),
`excluded_from_selection` (records excluded by the integration eligibility check),
`incoming` (unique integratable match IDs), `selected`,
`skipped_by_delta`, `source_changes`, `local_changes`, `dependency_draws`,
`dependency_changes`, `delta_ms` and `dependency_cache_hit` alongside the existing processing timings.
The selector still reads incoming inputs once per response; it avoids the full
integration loop for unchanged matches rather than claiming constant-time syncs.
