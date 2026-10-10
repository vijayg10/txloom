# API Contract Delta: Generation-to-Delivery Overhaul

**Date**: 2026-10-10 | **Plan**: [../plan.md](../plan.md) | **Base contract**:
[001 contracts/api.md](../../001-synthetic-transaction-studio/contracts/api.md)

This document lists only what changes. Base path `/api/v1`; error envelope
`{ error: { code, message, details? } }` (unchanged). The UI, the CLI and the MCP server
remain pure clients of these endpoints (constitution IV). Every endpoint below gets contract
tests, and every MCP tool gets a parity test against its REST endpoint.

**Conventions**:

- `seed` is always a **decimal string** in responses. Requests accept either a decimal string
  or a safe JSON integer (R2).
- Every message tells the user what is wrong, where (`details.path` or `details.sink`), and
  how to fix it.

## Connections (replaces `/sinks`)

| Method & Path                       | Purpose                                     | Notes                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/connections`                  | List                                        | `{connections: Connection[]}`, ordered by name                                                                                                                 |
| POST `/connections`                 | Create                                      | body `ConnectionInput`; 201 `Connection`; 400 `invalid_connection` with `details.violations[]` (JSON Pointer into the body); 409 `name_taken`               |
| GET `/connections/:id`              | Detail                                      |                                                                                                                                                               |
| PATCH `/connections/:id`            | Edit                                        | partial `ConnectionInput`. Omitted `secrets` are kept, `null` clears them. 403 `managed_connection` when `managed_by = "env"`                                |
| DELETE `/connections/:id`           | Delete                                      | 204. Destinations referencing it keep their snapshot (`connection_id → null`)                                                                                    |
| POST `/connections/test`            | **Test an unsaved candidate** (FR-010)      | body `ConnectionInput`; 200 `ProbeResult`; 503 `worker_unavailable`. Nothing is stored                                                                      |
| POST `/connections/:id/test`        | Test a saved connection                     | 200 `ProbeResult`; records `last_test_*`                                                                                                                      |
| GET `/connections/suggestions`      | Detected but unregistered brokers (FR-013)  | `{suggestions: [{kind: "local_kafka", input: ConnectionInput, detail}]}`                                                                                     |
| ~~`/sinks`, `/sinks/:id`, `/sinks/:id/test`~~ | Removed                           | 410 `gone`, with message `"Sink connections moved to /api/v1/connections"`, kept for one minor release                                                       |

```ts
type ConnectionInput =
  | { type: "kafka"; name: string; config: KafkaConfig; secrets?: { username: string; password: string } | null }
  | { type: "rabbitmq"; name: string; config: RabbitConfig; secrets?: { username: string; password: string } | null }
  | { type: "webhook"; name: string; config: WebhookConfig; secrets?: { headers: Record<string, string> } | null };
// KafkaConfig / RabbitConfig / WebhookConfig: data-model.md §1.1.1

interface Connection {
  id: string; type: "kafka" | "rabbitmq" | "webhook"; name: string;
  config: KafkaConfig | RabbitConfig | WebhookConfig;   // never contains secrets
  has_credentials: boolean;
  managed_by: "user" | "env" | "auto";
  health: { last_test_at: string | null; ok: boolean | null; summary: string | null; stage: ProbeStage | null };
  warnings: { code: "localhost_address" | "topic_missing"; message: string }[];   // FR-012; topic_missing from the last test
  created_at: string; updated_at: string;
}
// ProbeResult / ProbeStage: contracts/sink-plugin.md
```

A probe of a topic that doesn't exist on a cluster that forbids auto-creation returns
`ok: false`, `stage: "topic"`, with the topic named. Saving is still allowed, and the saved
connection then carries the `topic_missing` warning (spec edge case).

The `localhost_address` warning appears when any host is `localhost`, `127.0.0.1` or `::1`.
Its message reads: *"This address is resolved by the TxLoom worker. Inside Docker, `localhost`
is the worker itself; the bundled demo broker is `kafka:29092`."*

## Launch and runs

| Method & Path                                | Change                                                                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/scenarios/:id/runs`                   | **Body replaced** with `LaunchRequest` (below). Re-validates the spec: 400 `spec_invalid` with `details.violations[]`. 400 `sink_without_destination` with `details.sink`. 400 `destination_type_mismatch`. 400 `invalid_seed`. 201 `Run`, plus `warnings[]` (e.g. `retention_shorter_than_history` when replaying to a topic whose known retention is shorter than the history window; never blocking) |
| POST `/spec/estimate`                        | **New.** body `{spec, replay_history?: boolean}` → `RunEstimate` (FR-045). Side-effect free                                                                                                  |
| GET `/scenarios/:id/launch-defaults`         | **New.** `{destinations: Destination[], mode, target_tps, replay_history, label_channel}`, prefilled from `scenario_destination_defaults`, `scenario_launch_defaults` and the current spec. Sinks that no longer exist are dropped (FR-019) |
| GET `/runs`, GET `/runs/:id`                 | `Run` gains `engine_version`, `partition_count`, `mode`, `replay_history`, `target_tps`, `launch_destinations[]` (immutable launch record), `deliveries[]` (each with its `destination_snapshot`), `stream_summary`, `scenario: {id, name}`, `spec_version: {id, number}` (FR-050) |
| POST `/runs/:id/regenerate`                  | body `{accept_engine_change?: boolean}`. 409 `engine_version_mismatch` with `details: {run_engine_version, current_engine_version}` unless accepted. The new run carries `source_run_id`      |
| POST `/runs/:id/retry`                       | **New** (FR-038). Only from `failed`, else 409 `invalid_state`. 409 `engine_version_mismatch` if the versions differ                                                                          |
| POST `/runs/:id/deliveries/:sink/retry`      | **New** (FR-021 edge case). `failed` → `running`, continuing from the cursor                                                                                                                  |
| POST `/runs/:id/deliveries/:sink/skip`       | **New.** `failed` → `skipped`. May trigger the live auto-start                                                                                                                                |
| POST `/scenarios/:id/versions/:v/rollback`   | Now re-validates: 400 `spec_invalid` (FR-039)                                                                                                                                                 |
| POST `/scenarios` with `{template_slug}`     | Now re-validates the template spec: 400 `spec_invalid` (FR-039). The response includes `current_version: {id, number: 1}` (FR-053)                                                            |

```ts
interface LaunchRequest {
  seed?: string | number;                  // R2; omitted → spec.seed (schema-bounded to 0…2^53−1). Never random
  mode?: "history_only" | "history_then_live";   // default: history_then_live if any broker destination, else history_only
  destinations?: DestinationInput[];               // required for every non-file output sink
  replay_history?: boolean;                // default false (FR-021)
  target_tps?: number;                     // default spec.clock.then_stream_tps ?? 50
  label_channel?: boolean;                 // default spec.output.stream_label_channel ?? false
  label_export?: "separate_export" | "merged_with_warning";
  scale_override?: { consumers?: number; merchants?: number; days?: number };
}
interface DestinationInput { sink: string; connection_id: string; topic?: string; routing_key?: string; label_topic?: string }
interface Destination extends DestinationInput { connection_name: string; connection_type: string; connection_missing: boolean }

interface RunEstimate {
  history_events: number; replay_messages: number; partitions: number;
  generation_seconds: number; assumptions: string[];
}
```

**Removed:** `sink_connection_ids`, `stream_label_channel` (renamed to `label_channel`), and
the mode values `batch` and `batch_then_stream`. Old values are accepted with a `Deprecation`
header for one minor release and mapped across.

## Streaming

| Method & Path                    | Change                                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/runs/:id/stream/start`    | **Body is now** `{target_tps?, label_channel_enabled?}`. It uses the run's destinations. The inline `sink` field is **removed**: 400 `inline_sink_removed` if present          |
|                                  | 409 `stream_paused`: *"Stream is paused. Resume it, or stop it first to change the destination."* (FR-027)                                                                  |
|                                  | 409 `replay_pending`: history replay is still running, or failed and needs a retry or skip                                                                                  |
|                                  | 409 `destination_connection_missing` with `details.sink`; 409 `engine_version_mismatch`; 409 `stream_limit` when `TXLOOM_MAX_STREAMS` are busy                                 |
|                                  | From `idle` or `stopped`: creates session `seq + 1` and returns 200 `Stream` including `session`                                                                            |
| POST `/runs/:id/stream/pause`    | unchanged                                                                                                                                                                   |
| POST `/runs/:id/stream/resume`   | unchanged                                                                                                                                                                   |
| POST `/runs/:id/stream/stop`     | also allowed from `error`                                                                                                                                                   |
| PATCH `/runs/:id/stream`         | unchanged (rate)                                                                                                                                                            |
| GET `/runs/:id/stream`           | `Stream` gains `state: …\|"error"`, `destinations[]` (current), `session`, `sessions_count`, and the metrics below                                                          |
| GET `/runs/:id/stream/sessions`  | **New.** Session history, each with its `destinations_snapshot`                                                                                                             |
| PUT `/runs/:id/stream/destinations` | **New** (FR-048). body `{destinations: DestinationInput[]}`. Changes `streams.destinations`, used by future sessions; the run's launch record is never changed. 409 `stream_active` while a session is `streaming`, `paused` or `error` |

```ts
interface StreamMetrics {
  achieved_tps: number; target_tps: number; aimd_rate: number;
  sink_lag: number;            // in_flight + retry_queue + due backlog (real; FR-030)
  in_flight: number; retry_queue: number;
  backpressure: boolean;
  delivered_total: number; failed_total: number;
  sim_time: string;            // simulated clock (ISO) — FR-042
  last_error: string | null;
  ticker?: WirePayload;        // contracts/wire-format.md
}
```

## Exports

| Method & Path              | Change                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/runs/:id/exports`   | **Now asynchronous** (R19): returns `202 {export_id, status: "queued"}`, and an `export-build` worker job builds the files. Body gains `source?: {kind: "truth"} \| {kind: "sink", name: string}`, defaulting to the first `file` sink if the spec has one, else `truth`. The `include_labels` merge keeps **all** label fields (`is_fraud, typology, actor_id, campaign_step, corruption_type, delivery_outcome`) with constant memory. The answer-key file for a sink source includes corruptions and `delivery_outcome: dropped` rows |
| GET `/runs/:id/exports/:exportId` | `status: "queued" \| "running" \| "completed" \| "failed"` (plus `error` when failed). The download link is valid only when `completed` |

## WebSocket channels

- `run-progress`: the payload gains `phase: "generating" | "replaying" | "live" | "done"` and
  `deliveries[]` (per-sink `{published, failed, total, state}`). This lets the run page
  switch tabs on its own (FR-047).
- `run-stream`: carries the `StreamMetrics` above.

## MCP tools (agent parity, FR-018)

| Tool                    | Change                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `list_connections`      | **New.** → GET `/connections` (no secrets)                                                   |
| `launch_run`            | input gains `destinations[]`, `mode`, `replay_history`, `target_tps`, `seed: string`. Drops `sink_connection_ids` |
| `start_stream`          | input `{run_id, target_tps?, label_channel_enabled?}`. **`sink` removed**                    |
| `estimate_run`          | **New.** → POST `/spec/estimate`                                                             |
| `retry_run`             | **New.** → POST `/runs/:id/retry`                                                            |
| `create_export`, `get_export` | Follow the asynchronous export: `create_export` returns `queued`, and `get_export` is polled until `completed` |
| others                  | unchanged                                                                                    |

Tool definitions live in `packages/agent-tools/src/tools.ts`. Authoring docs
(`docs/agent/`) are rebuilt.

## CLI

| Command                                       | Change                                                       |
| --------------------------------------------- | ------------------------------------------------------------ |
| `connections-list`, `connections-add`, `connections-test` | replace `sinks-*`. `connections-add` takes typed flags (`--type kafka --bootstrap … --security SASL_SSL --sasl SCRAM-SHA-512 --ca-file … --topic …`), and reads the password from a prompt or `--password-stdin` |
| `run`                                         | `--dest events=local-kafka[:topic]` (repeatable), `--mode`, `--replay-history`, `--tps`, `--seed <string>` |
| `stream-start`                                | drops the broker/URL flags                                   |
| `run-retry`                                   | new                                                          |
| `export`                                      | polls the asynchronous export until `completed` or `failed`; gains `--source truth\|<sink>` |

## Contract invariants (additions)

1. No response, log line, job payload in plaintext, or run record ever contains a connection
   secret.
2. No client can supply a broker address, URL or credential to launch or stream; only
   `connection_id`s.
3. `GET /runs/:id` exposes everything needed to reproduce the run: `spec_snapshot`, `seed`,
   `engine_version`, `partition_count`.
4. A stream reported as `streaming` has a BullMQ job for its current session, either active
   or stalled and waiting to be re-run. After a worker restart, a stalled session resumes on
   its own from its latest day checkpoint, keeping the same `seq` (research R7). Only a
   stream whose session job is *missing* from BullMQ is moved to `stopped` at boot, with
   `last_error` set.
5. `run_destinations` (exposed as `launch_destinations[]`) never changes after launch.
