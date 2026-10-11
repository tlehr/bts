# Timing probes

`event_loop_probe.js` measures delayed timer execution during asynchronous
waits. `steps.js` records component steps and reports short ones when their
parent operation is slow.

`btp_decode.js` measures synchronous BTP response decoding, enabled by
`BTS_BTP_SYNC_TIMING=1` or the tournament's detailed server diagnostics setting.
An explicit `BTS_BTP_SYNC_TIMING=0` disables these measurements. Every measured response produces one compact JSON line
tagged `btp_fetch:response_decode`, including short responses and failures:

- `tournament_key` and request `action` identify the connection and operation.
- `start_ts` / `ts` bound decoding in real UTC epoch milliseconds, independent
  of a tournament's simulated clock. Durations use the monotonic clock.
- `phases` contains `decompress`, `utf8`, `xml_parse` (including parser creation)
  and `object_conversion`. Each reports elapsed `duration_ms`, process CPU
  `cpu_ms` and `status`. Failed phases are included; subsequent phases are absent.
- Whole-decoder `duration_ms`, `cpu_user_ms` and `cpu_system_ms` are captured
  before logging or calling the response consumer. Phase times exclude response
  integration, hash computation, socket wait and consumer callbacks.
- `packet_bytes`, `compressed_bytes` and `xml_bytes` show response sizes.
  `xml_bytes` is absent if decompression did not complete. On an invalid header,
  `compressed_bytes` describes the available packet body, not a verified size.
- Failed decodes report `status: "error"`, `failed_phase` and `error_type`.
  XML, response values, credentials and error messages are not logged.

CPU usage is **process-wide**, including garbage collection and background
threads during the interval. It is not an exclusive per-thread CPU profile.
Do not add a phase's CPU time to its elapsed time or add whole-decoder time to
the phase sum. Compare timestamp intervals with slow score traces and timer
lateness. The existing `response_received.duration_ms` includes socket waiting
and decoding; it is not a pure network measurement.

Score `total_ms` starts at server handler entry. A message sent by a client
during synchronous decoding can wait before that entry; this delay is absent
from the server score duration. Do not infer a server processing interval by
adding `total_ms` to the client timestamp encoded in `trace_id`. Compare client
send timestamps directly with decoder intervals and use client-to-TV latency
for the complete path.

The public synchronous decoder's callback and thrown-error behavior is preserved.
Diagnostics do not acquire tournament locks. With diagnostics disabled, no CPU
samples or stage timing records are collected.

Bulk `SENDTOURNAMENTINFO` responses now decode on a persistent worker. Their
records have `execution: "worker"` and a pool-wide `request_id`. The decoder
`start_ts` / `ts` and phase times describe worker work, **not a main-thread
blockade**. Historical records and small direct responses without `execution`
describe main-thread decoding. Do not attribute a client wait to the worker merely
because its timestamp falls within the worker's decoder interval.

Worker records also report monotonic elapsed durations in milliseconds:

- `queue_wait_ms`: waiting in the decoder queue before dispatch begins.
- `dispatch_ms`: main-thread worker creation (first use), owned input copy and
  `postMessage` call. Copying protects adjacent buffers from detachment.
- `input_wait_ms`: dispatch completion until worker handler entry, including
  startup on first use and thread scheduling. Clamped to zero when sender and
  receiver overlap around dispatch completion.
- `return_delivery_ms`: worker timestamp immediately before its output
  `postMessage` until main-thread handler entry. Includes serialization,
  delivery, deserialization and scheduling; it is **not isolated cloning time**
  and is not entirely main-thread blocking time.
- `decode_roundtrip_ms`: main dispatch start until main handler entry; excludes
  earlier decoder queue waiting, result logging, consumer callback and integration.

The first job starts the worker lazily; compare warm requests separately from
startup. Cancelled jobs and crashed workers may produce no completed decoder
record; the existing fetch timeout/connection error still reports their failure.
Process CPU samples still include all threads, and can exceed elapsed time.

## Sync commit and resource waits

`btp_sync:phase_timing` includes real `start_ts` / `ts`. The existing
`incremental_apply` includes writes, effect/notification publication and cache
updates. Its children `incremental_writes`, `incremental_publish` and
`incremental_cache` separate those costs. Validation occurs before this interval;
all four stages still hold the selected resource locks. Never add parent and
child durations.

When score or sync timing is on, the resource queue's default slow-task threshold
is 50 ms (otherwise 500 ms). `BTS_UPDATE_QUEUE_SLOW_TASK_MS` overrides it, and
`0` disables the records. `update_queue:slow_task` includes task `id`, score
`trace_id`, enqueue/start/end timestamps and the last observed lock blocker with
its own task ID, key, timestamps and active/pending state. `conflicting_locks`
lists only the waiting task's requested locks which conflict with the blocker's
held/requested locks. `observed_lock_conflict: false` means no conflict was
observed during queue draining; it does not exclude a conflict that ended before
the drain ran. An observed blocker does not account for every millisecond of
the wait, which also includes event-loop scheduling. No resource lock semantics
change for these measurements.

With `BTS_COMPACTION_MODEL_READS=1`, successful score-context reads during pure
compaction emit `database:compaction_model_read` when timing is enabled. The
record includes collection, model ID, queue depth, active-executor snapshot and
`read_ms`, but no model contents. `compaction_read_bypassed` / decision
`pure_compaction` identify this path. Slow normal reads include a decision such
as `prior_write_or_unknown_task`, `no_active_compaction`, `not_ready`,
`untracked_tasks`, `ttl_index`, or `disabled`. Safety tracking of task kinds runs
without diagnostic flags; timing is not used to authorize a bypass. The snapshot
is captured synchronously, while callback delivery remains asynchronous.

## Automatic preparation

With score, sync or offload timing enabled, `preparation:timing` records one
automatic preparation operation on the main thread. It contains a process-local
`id`, real `start_ts` / `ts`, monotonic duration, event-loop timer lateness, actual
feature profile and completed phase intervals. Queue timing starts after resource
locks have been acquired; lock waiting remains in `update_queue:slow_task`.

`read_tournament` measures the queued job's initial query.
`status_read_locations`, `status_read_courts` and `status_read_matches` separate
the initial demand-check inputs; `read_source` distinguishes `database` from
`object_model`. `status_calculation` measures the synchronous demand check.
When more preparation is needed, `selection_read_*` reports the six parallel
ordinary queries, then `candidate_calculation` measures selection synchronously.
`resolve_waiting_tabletoperator` and `execute_preparation_calls` include their
existing async execution; delayed call gaps are reported separately as a boolean.

Synchronous calculation phases include `process_cpu_ms`; process CPU includes
worker threads and GC, so it is not an exclusive main-thread CPU profile.
Read/execution elapsed times include waits and scheduling. Parallel reads must
not be summed; nested phases are already contained in the operation duration.
On an error, other parallel reads may still be unfinished and lack end timestamps.
The diagnostics log counts and error types, not input documents or messages.
Worker planning does not emit these main-thread preparation records. With flags
off there are no probes, CPU samples or timing records for this operation.
