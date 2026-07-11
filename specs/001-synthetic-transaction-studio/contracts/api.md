# API Contract: TxLoom v1 — REST + WebSocket

**Date**: 2026-07-11 | **Plan**: [../plan.md](../plan.md)

One capability surface (FR-035/037): the web UI, CLI, and future agent integrations are all
clients of this contract. Base path `/api/v1`. All bodies JSON (Ajv-validated). No auth in v1.

**Error envelope** (all non-2xx): `{ error: { code, message, details? } }`. Spec-validation
failures use `details.violations[]: { path (JSON Pointer), code, message }` — the same located
error model consumed by Monaco markers and the LLM repair loop (FR-004, FR-038).

## Scenarios & spec versions

| Method & Path | Purpose | Notes |
|---|---|---|
| GET `/scenarios` | List scenarios | paging: `?limit&cursor` |
| POST `/scenarios` | Create (blank or `{template_slug}`) | clones template spec (FR-006) |
| GET `/scenarios/:id` | Detail + current spec version | |
| PATCH `/scenarios/:id` | Rename / description | |
| DELETE `/scenarios/:id` | Delete scenario (blocked while runs active) | |
| GET `/scenarios/:id/versions` | Version history (FR-005) | |
| POST `/scenarios/:id/versions` | Save edited spec as new head | body `{spec}`; runs full validation first |
| POST `/scenarios/:id/versions/:versionId/rollback` | One-click rollback → new head | |

## Spec validation, compile, and NL edit

| Method & Path | Purpose | Notes |
|---|---|---|
| POST `/spec/validate` | Validate arbitrary spec document | 200 `{valid, violations[]}` — powers inline editor errors (FR-038); never 4xx for invalid specs |
| POST `/spec/compile` | NL description → validated spec (FR-008/009) | body `{description}`; 200 `{spec, repair_attempts}`; 422 `{best_candidate, violations[]}` when repair loop exhausts; 409 if no LLM provider configured (FR-012) |
| POST `/scenarios/:id/spec-diff` | NL edit → reviewable diff (FR-010) | body `{instruction}`; 200 `{diff: hunks[]}` — never auto-applies |
| POST `/scenarios/:id/spec-diff/apply` | Apply accepted hunks | body `{hunks[]}` (accepted subset); creates new spec version |
| GET `/spec/schema` | JSON Schema for editor autocomplete | |

## Runs

| Method & Path | Purpose | Notes |
|---|---|---|
| POST `/scenarios/:id/runs` | Launch run | body `{seed?, scale_override?, sink_connection_ids[], mode, label_export, stream_label_channel?}` (FR-031); snapshots spec verbatim |
| GET `/runs` | Run list with status/progress/throughput/ETA (FR-032) | |
| GET `/runs/:id` | Immutable record: spec snapshot, seed, links (FR-033) | |
| GET `/runs/:id/logs` | Run logs | `?cursor` |
| POST `/runs/:id/pause` \| `/resume` \| `/cancel` | Run control (FR-018/032) | resume is idempotent from checkpoints |
| POST `/runs/:id/regenerate` | "Exactly this dataset" button (FR-033) | launches new run from stored snapshot+seed |
| DELETE `/runs/:id/outputs` | Reclaim storage, keep metadata (FR-033a) | |
| GET `/runs/:id/report` | Realism report (FR-034) | |
| GET `/runs/:id/inspector/*` | World-inspector aggregates | `volume-over-time`, `amount-distributions`, `persona-heatmap`, `fraud-timeline`, `imperfection-audit` (FR-036 §4) |
| GET `/runs/compare?a&b` | Side-by-side comparison payload | |

## Ground truth & exports

| Method & Path | Purpose | Notes |
|---|---|---|
| GET `/runs/:id/truth/events` | Filter/browse ground truth | `?typology&actor_id&status&cursor` |
| GET `/runs/:id/truth/actors/:actorId/story` | Actor timeline sequence (FR-036 §5) | ordered campaign steps |
| POST `/runs/:id/exports` | Create export | body `{format: csv\|parquet\|json, include_labels: false\|true, acknowledged_warning?}`; `include_labels:true` REQUIRES `acknowledged_warning:true` else 422 (FR-022) |
| GET `/runs/:id/exports/:exportId` | Export status + download URL | |
| GET `/runs/:id/exports/:exportId/download` | Stream file | answer key is always a distinct file (FR-021) |

## Streaming

| Method & Path | Purpose | Notes |
|---|---|---|
| POST `/runs/:id/stream/start` \| `/pause` \| `/resume` \| `/stop` | Stream lifecycle (FR-030) | continuity with history world state (FR-029) |
| PATCH `/runs/:id/stream` | body `{target_tps}` — live rate adjustment | |
| GET `/runs/:id/stream` | State + metrics snapshot (achieved tps, lag, backpressure) (FR-028) | |

## Sinks, templates, settings

| Method & Path | Purpose | Notes |
|---|---|---|
| GET/POST `/sinks`, GET/PATCH/DELETE `/sinks/:id` | Sink connection CRUD (FR-036 §6) | secrets write-only (never echoed) |
| POST `/sinks/:id/test` | Test connection | 200 `{ok, detail}` |
| GET `/templates` | Template gallery (FR-006) | |
| GET/PUT `/settings` | Global defaults + LLM provider config | provider: `anthropic` \| `openai_compatible {base_url}`; keys write-only |
| GET `/health` | Compose healthcheck | |

## WebSocket channels

`GET /ws` upgrades; client subscribes with `{subscribe: "<channel>"}`.

| Channel | Messages | Purpose |
|---|---|---|
| `runs/:id/progress` | `{partition_no, state, events_generated, throughput, eta}` per tick; `{status}` transitions | per-partition progress bars, run control (FR-032) |
| `runs/:id/stream` | `{achieved_tps, target_tps, sink_lag, backpressure}` @1Hz; `{ticker: TruthEventSample}` sampled | stream console dial + event ticker (FR-036 §3) |

## Contract invariants

- Every UI capability maps to an endpoint above — no UI-only backdoors (FR-035/037).
- `POST /spec/validate` responses and editor markers share one violation shape (FR-004).
- Label fields never appear in event/export payloads unless the warning flow ran (FR-021/022);
  the streaming label channel is a sink-level channel, not an API field (FR-030a).
- All mutation endpoints are idempotent-safe under retry (ULID request keys where needed).
- CLI maps 1:1 onto these endpoints (`txloom compile|validate|run|stream|export|sinks|…`).
