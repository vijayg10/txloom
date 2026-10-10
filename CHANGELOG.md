# Changelog

All notable changes to TxLoom are recorded here.

## Unreleased

### Engine output changes (breaking; one `ENGINE_VERSION` bump per entry)

- **`ENGINE_VERSION` 4 — per-event imperfection transformer.** Imperfections are applied to each
  sink's delivered copy one event at a time instead of over a whole day's array. Late events are
  now physically delivered later (in `delivered_at` order) and keep their original `ts`; clock skew
  alone changes `ts`; each sink draws from its own random stream, so adding a sink no longer
  changes another sink's output; out-of-order labels are written only when a later delivery really
  overtakes the flagged one. Delivered rows gain `delivery_id`, `delivered_at` and `sent_at`.
  Labels gain `delivery_outcome`. The golden master was re-baselined.
- **`ENGINE_VERSION` 3 — per-day generation, planned fraud, refund rings.** A partition is now
  simulated one day at a time: event times follow an hour-of-day activity curve, fraud campaigns
  are planned per day (so they can continue into live days), account-takeover victims go
  dormant until the attack, and refund abuse picks from each consumer's last 16 purchases.
  Every seed produces different output from version 2; the golden master was re-baselined.
- **`ENGINE_VERSION` 2 — 64-bit seeds and named streams.** The seed's full 64 bits now seed the
  generator (previously only the low 32 bits did, so seeds `1` and `4294967297` collided). Named
  streams (merchant pool, party names) are seeded directly from the seed and the stream name
  instead of jump-walking a hashed partition index. Every seed produces different output from
  version 1; the reference golden master was re-baselined.

### Sink plugin API v2 (breaking)

`SINK_PLUGIN_API_VERSION` is `2`. Third-party sinks must migrate (the table in
`docs/extending.md` lists each change):

- `publish(target, body, envelope, signal)` takes an already wire-encoded `Uint8Array` body.
  `envelope.ts` is gone.
- `publish` resolves only once the destination acknowledges the message (Kafka delivery report,
  RabbitMQ publisher confirm, HTTP 2xx), as `{ ok, retryable?, error? }`. The old `backpressure`
  flag is replaced by `saturated` and `waitForCapacity()`.
- A sink makes one attempt per call and never retries; the shared `DeliveryPump` owns retries
  (jittered backoff, `max_attempts`), the in-flight window (`maxInFlight`) and a circuit breaker.
- A delivery the pump gives up on is written to the answer key with `delivery_outcome: "dropped"`
  (`corruption_type` stays `null`, reserved for the four injectable imperfections).
- Delivered counts now mean acknowledged messages.
- Sinks publish up to `maxInFlight` messages at once (webhook 32, RabbitMQ 256, Kafka 1,000), so a
  webhook receiver can see requests out of generation order. Kafka keeps per-key order within a
  partition.

### Wire format (breaking)

- `ts` is the event time as the source reported it: the truth time plus any clock-skew offset. It
  is no longer moved by late arrival.
- New `delivered_at`: the simulated arrival time (truth time plus the late-arrival delay,
  otherwise equal to truth time). Events are published in `delivered_at` order, so a late event is
  physically delivered later and keeps its original `ts`.
- New `sent_at`: the wall-clock publish time in live streams; `null` in files and history replay.
- Kafka messages carry the headers `txloom-run-id`, `txloom-session-seq` and
  `txloom-engine-version`. Delivered Parquet rows gain `delivery_id`, `delivered_at` and `sent_at`.
- Consumers that treated `ts` as arrival time must read `delivered_at` instead. The Flink lab's
  `CleanAndOrderJob` and `Event` now do.

### API removals

- `POST /runs/:id/exports` is asynchronous: it returns `202` with `status: "queued"`, and an
  `export-build` worker job builds the files. Poll `GET /runs/:id/exports/:exportId` until
  `status` is `completed` (or `failed`, with `error`); the download is available only when
  `completed` (`409 export_not_ready` before that). The body gains `source`
  (`{kind:"truth"}` or `{kind:"sink", name}`), defaulting to the first file sink, else truth.
  The CLI `export` command and the MCP `create_export` / `get_export` tools follow the same flow.
- `/sinks` is replaced by `/connections` (`/sinks*` now returns `410 gone`). Connections are typed
  (Kafka, RabbitMQ, webhook), their secrets are write-only, and a run is sent to a connection by ID.
- `POST /runs/:id/stream/start` no longer accepts an inline `sink`; it returns
  `400 inline_sink_removed`. Streams go to the destinations bound at launch.
- `POST /scenarios/:id/runs` no longer uses `sink_connection_ids` (accepted with a `Deprecation`
  header and ignored). Pass `destinations` (`sink`, `connection_id`, optional `topic`,
  `routing_key`, `label_topic`) instead.
- CLI: `sinks-list`, `sinks-add` and `sinks-test` are replaced by `connections-list`,
  `connections-add` and `connections-test`. `run` takes `--dest sink=connection[:topic]`, and
  `stream-start` no longer takes sink arguments.
- MCP: `start_stream` no longer has a `sink` input; `launch_run` takes `destinations`; new
  `list_connections` tool.
- `POST /scenarios/:id/runs`: a launch without a `seed` now uses the spec's `seed` instead of a
  random one, so two such launches are byte-identical. `seed` is a decimal string up to
  `18446744073709551615`; JSON numbers above `9007199254740991` are rejected with `400 invalid_seed`.
  Run responses return `seed` as a string. `spec.seed` itself is limited to `0 … 9007199254740991`.
- `POST /runs/:id/regenerate` returns `409 engine_version_mismatch` when the run was made by a
  different engine version, unless the request sets `accept_engine_change`. Stream start and
  resume return the same error for such runs.
