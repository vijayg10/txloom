# Agent Authoring

TxLoom embeds no language model. Plain-English authoring is done by an AI agent you already use, connected to TxLoom's MCP server.

The agent proposes a spec. The validator checks it and reports located, machine-readable errors. The agent repairs the draft and saves it. The deterministic engine generates the data. No language model ever produces a transaction.

## The MCP Endpoint

| | |
|---|---|
| Address | `http://localhost:3000/mcp` |
| Transport | Streamable HTTP, stateless |
| Authentication | None. See the [security note](../guide/installation.md#security). |

The address is shown in the studio under **Settings → Agent integration**.

### Connecting Claude Code

Add a `.mcp.json` to your project:

```json
{
  "mcpServers": {
    "txloom": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Other MCP clients take the same URL in their own configuration format.

## Tools

Every tool maps onto one REST endpoint under `/api/v1`. There is no agent-only capability.

### Learn

| Tool | Endpoint | Purpose |
|---|---|---|
| `get_spec_schema` | `GET /spec/schema` | The JSON Schema for a spec |
| `get_authoring_docs` | `GET /spec/docs` | Field reference, invariant catalog with remedies, worked examples |
| `list_templates` | `GET /templates` | The gallery templates |
| `list_connections` | `GET /connections` | Saved connections. Secrets are never returned. |

### Author

| Tool | Endpoint | Purpose |
|---|---|---|
| `validate_spec` | `POST /spec/validate` | Check a draft. Always succeeds and returns `valid` plus located violations. No side effects. |
| `estimate_run` | `POST /spec/estimate` | Expected history events, partitions and generation time |
| `create_scenario` | `POST /scenarios` | Create a blank scenario or clone a template |
| `save_spec_version` | `POST /scenarios/:id/versions` | Validate and save a spec as the scenario's newest version |

### Run

| Tool | Endpoint | Purpose |
|---|---|---|
| `launch_run` | `POST /scenarios/:id/runs` | Launch the current version with destinations, a mode, an optional seed and an optional history replay |
| `get_run_status` | `GET /runs/:id` | Run record: status, phase, spec snapshot, seed |
| `retry_run` | `POST /runs/:id/retry` | Re-queue the partitions of a failed run that did not finish |
| `start_stream` | `POST /runs/:id/stream/start` | Start the live stream to the run's destinations |
| `stop_stream` | `POST /runs/:id/stream/stop` | Stop the live stream |

### Read results

| Tool | Endpoint | Purpose |
|---|---|---|
| `get_realism_report` | `GET /runs/:id/report` | Distribution summaries and achieved fraud rate |
| `get_truth_events` | `GET /runs/:id/truth/events` | Labeled events, filterable by typology, actor and status |
| `create_export` | `POST /runs/:id/exports` | Start an export build |
| `get_export` | `GET /runs/:id/exports/:exportId` | Export status and file names |

## A Typical Session

You say:

> Create a card-present retail scenario for the US with 3,000 shoppers, a Black Friday spike, and 1% fraud that is mostly card testing. Write Parquet files and run it.

The agent then:

1. Calls `get_authoring_docs` and `list_templates` to learn the spec format
2. Drafts a spec and calls `validate_spec`
3. Fixes any violation using its path, code and remedy, and validates again
4. Calls `create_scenario`, then `save_spec_version`
5. Calls `estimate_run` to check the size
6. Calls `launch_run`, then polls `get_run_status`
7. Calls `get_realism_report` and summarizes the result for you

The saved version appears in the scenario's version history in the studio, where you can compare it with the previous version or roll it back.

## Rules an Agent Must Follow

These come from the authoring docs the agent reads.

- **Destinations.** Every non-file sink needs a destination: a connection of the same type, by ID, from `list_connections`. Addresses and credentials are never passed inline.
- **Seeds are strings.** Pass `seed` as a decimal string so 64-bit values survive JSON. Leave it out to use the spec's seed. A run is never given a random seed.
- **Mode.** `history_only`, or `history_then_live`, which is the default when any destination is a broker. The live stream then starts by itself after history.
- **Replay.** With `replay_history: true`, the run's `phase` goes through `generating`, `replaying` and `live`.
- **Exports are asynchronous.** `create_export` returns `queued`; poll `get_export` until `completed` or `failed`.
- **Labels are excluded by default.** `include_labels: true` requires `acknowledged_warning: true`.

## What an Agent Cannot Do

- It cannot generate events. Only the engine does.
- It cannot skip validation. An invalid spec is rejected with `422` and the same violations `validate_spec` returns.
- It cannot read connection secrets.

## Authoring Docs

The documentation agents read is generated from the same package that defines the tools, so it stays in step with the validator. It is served at `GET /api/v1/spec/docs` and published on this site as the [Agent Reference](./agent-reference.md).
