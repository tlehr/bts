# BTP bulk response decoding

`btp_conn.send_request` routes `SENDTOURNAMENTINFO` responses through one
persistent, lazily created worker. Login and `SENDUPDATE` replies retain the
synchronous `btp_proto.decode` path. The public synchronous decoder still has
its original callback/throw behavior; the connection's worker path reports all
decode failures through its callback, including malformed gzip packets.

- `codec.js` holds the shared packet and XML conversion functions. Typed values,
  repeated IDs and DateTime records use the same code in both paths.
- `worker.js` decodes an isolated packet and returns plain response data.
- `pool.js` owns the worker, FIFO queue, request association and cancellation.
- `index.js` exposes the shared pool and explicit shutdown.

The pool allows one active job and up to 64 waiting jobs. The worker is referenced
while active and unreferenced while idle, so it does not keep an otherwise finished
process alive. A worker failure fails its active request once; waiting requests
continue on a replacement worker. A cancelled queued request is removed. An active
cancellation terminates the parser's thread and starts the next queued request on
a replacement, since a synchronous parser cannot consume cancellation messages.
Callbacks of cancelled jobs are suppressed; the fetch owner settles its promise.

The existing hard fetch deadline includes worker queueing and decoding. Timeout
and connection termination cancel the underlying request, including the socket
before receipt or worker after receipt. Late responses are ignored. Reset/enable
checks, snapshot validation, targeted integration locks and bye processing remain
in the integration pipeline. No tournament resource locks are held by the decoder.

Socket buffers can share backing storage. The pool copies exactly the packet
bytes into an owned ArrayBuffer before transferring it, without detaching the
original or adjacent buffers. Returned objects are structured clones, with no
references to the main thread's canonical tournament objects. Integration must
still update those objects under the existing resource locks.

With `BTS_BTP_SYNC_TIMING=1`, the usual `btp_fetch:response_decode` line adds
`execution: "worker"`, request association and transport measurements; see
`../timing/README.md`. The worker logs through the main thread and never returns
packet/XML contents in diagnostic records. Its first request includes startup
cost; subsequent requests reuse the worker. Returning a large object still incurs
cloning and deserialization on both threads, so offloading does not eliminate all
main-thread work or necessarily reduce total sync latency.

Offline comparison without any network or database:

```bash
node debug/btp_decode_benchmark.js > /tmp/bts-worker-offline-benchmark.json
```

The synthetic 519-match packet differs from the real tournament response. The
comparison checks full result equality and measures heartbeat delay, decoder
duration and transport separately; it does not predict tablet-to-TV latency.
