# UI Contract: Routes, Navigation and Test IDs

**Date**: 2026-10-10 | **Plan**: [../plan.md](../plan.md) | **Research**: R17

This is the stable contract between `apps/web`, the e2e suite (`apps/e2e/src/ui.ts`,
specs/002) and the docs. The clickable prototype (`VITE_TXLOOM_MOCK=1`) is built against this
contract first. Any revision the prototype prompts must be made here before the P2 APIs are
frozen.

## Navigation (FR-049)

Sidebar: **Scenarios** (`/scenarios`) · **Runs** (`/runs`) · **Connections** (`/connections`).
The footer link **Settings** (`/settings`) keeps global defaults and agent connection details.

## Routes

| Route                        | Surface                                                                                          | FR                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | --------------------- |
| `/`                          | Home: the first-run card on an empty install, otherwise redirects to `/scenarios`                | FR-052                |
| `/scenarios`                 | Scenario list plus template gallery                                                              | FR-036 §1             |
| `/scenarios/:id`             | Scenario workspace: editor, preview, versions, and the **Launch** button that opens the drawer   | FR-045, FR-053        |
| `/scenarios/:id?launch=1`    | Same page with the Launch drawer open (deep-linkable)                                            | FR-045                |
| `/runs`                      | Run list: scenario name · v<n> · start time; ID secondary                                        | FR-050                |
| `/runs/:id`                  | Redirects to `/runs/:id/progress`                                                                |                       |
| `/runs/:id/progress`         | Generation, then replay, then live phase progress; partitions; logs; controls                    | FR-047, FR-036 §2     |
| `/runs/:id/live`             | Stream console: destination chip, rate dial, lag, backpressure, ticker, sessions                 | FR-047, FR-048, §3    |
| `/runs/:id/inspect`          | World inspector, scoped to this run (compare picks the *other* run only)                         | FR-047, §4            |
| `/runs/:id/truth`            | Ground-truth explorer                                                                            | FR-047, §5            |
| `/runs/:id/export`           | Export controls (source: truth or a file sink) with the label warning; queued/running status while the export job runs                            | FR-047                |
| `/connections`               | Connection cards, the "Local Kafka detected" prompt, and **Add connection**                      | FR-007, FR-011, FR-013 |
| `/connections/new?type=kafka`| Typed form (also rendered inside the Launch drawer)                                              | FR-007, FR-046        |
| `/connections/:id`           | Edit form                                                                                        | FR-007                |

**Automatic tab switching.** While the run page is on `progress`, it moves to `live` when the
`run-progress` WebSocket reports `phase: "live"`. It does this only if the user hasn't
switched tabs manually since the page loaded.

## Redirects from v1 routes (FR-049)

| Old                         | New                                                         |
| --------------------------- | ----------------------------------------------------------- |
| `/stream`                   | `/runs?filter=streamable`                                   |
| `/stream/:runId` or `/stream?run=:runId` | `/runs/:runId/live`                            |
| `/inspector`, `/inspector/:runId`        | `/runs`, `/runs/:runId/inspect`                |
| `/ground-truth`, `/ground-truth/:runId`  | `/runs`, `/runs/:runId/truth`                  |
| `/settings/sinks`           | `/connections`                                              |

Every in-app link uses the router (`<Link>` or `navigate`), never `<a href>` (FR-051). A lint
rule (`no-restricted-syntax` on JSX `a[href^="/"]`) enforces this.

## Stable `data-testid`s

### New

| Test ID                                  | Element                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `first-run-card`, `first-run-start`      | Home card and its primary button                                         |
| `launch-open`                            | Scenario page **Launch** button                                          |
| `launch-drawer`                          | The drawer root                                                          |
| `launch-sink-row-<sink>`                 | One row per spec sink                                                    |
| `launch-destination-<sink>`              | Destination select (options: connections, `__new__`)                     |
| `launch-topic-<sink>`                    | Topic input                                                              |
| `launch-mode-history-only`, `launch-mode-history-then-live` | Mode radios                                           |
| `launch-rate`                            | TPS input                                                                |
| `launch-advanced`                        | Advanced disclosure                                                      |
| `launch-seed`, `launch-label-channel`, `launch-replay-history`, `launch-scale-*` | Advanced fields       |
| `launch-estimate`                        | Estimate line                                                            |
| `launch-error`                           | Blocking message (e.g. unbound sink)                                     |
| `launch-warning-retention`               | Non-blocking warning: topic retention shorter than the replayed history |
| `launch-submit`                          | **Launch ▶**                                                             |
| `connection-card-<name>`                 | Card on the Connections page                                             |
| `connection-health-<name>`               | Health indicator                                                         |
| `connection-add`                         | **Add connection**                                                       |
| `connection-type-<kafka\|rabbitmq\|webhook>` | Type picker                                                         |
| `conn-name`, `conn-bootstrap`, `conn-security`, `conn-sasl-mechanism`, `conn-username`, `conn-password`, `conn-ca-upload`, `conn-default-topic`, `conn-host`, `conn-port`, `conn-vhost`, `conn-tls`, `conn-exchange`, `conn-routing-key`, `conn-url`, `conn-timeout` | Typed form fields |
| `conn-localhost-warning`                 | FR-012 warning                                                           |
| `conn-test`, `conn-test-result`          | Test-before-save button and its staged result                            |
| `conn-topic-missing-warning`             | Shown when the test reports a missing topic that can't be auto-created; Save stays enabled |
| `conn-save`, `conn-cancel`               |                                                                          |
| `local-kafka-suggestion`, `local-kafka-add` | FR-013 prompt                                                         |
| `run-tab-<progress\|live\|inspect\|truth\|export>` | Run page tabs                                               |
| `run-title`                              | "Scenario · v3 · 10 Oct 14:02"                                           |
| `run-phase`                              | `generating \| replaying \| live \| done`                                |
| `run-retry`                              | Retry (failed runs)                                                      |
| `delivery-row-<sink>`, `delivery-retry-<sink>`, `delivery-skip-<sink>` | Replay phase rows                     |
| `live-destination-chip-<sink>`, `live-destination-change` | Read-only destination plus Change (enabled only when stopped) |
| `stream-start`, `stream-pause`, `stream-resume`, `stream-stop`, `stream-rate`, `stream-state`, `stream-lag`, `stream-backpressure`, `stream-error` | Live tab controls |
| `engine-mismatch-dialog`, `engine-mismatch-confirm` | FR-003                                                        |
| `version-saved-badge`                    | "v1 saved" after a clone (FR-053)                                        |

### Kept

`spec-editor`, `spec-editor-violations`, `save-spec-version`, `save-spec-success`,
`validation-result-panel`, `create-blank-scenario`, `new-scenario-name`,
`new-scenario-currency`, `run-status`, `view-run-link`, `export-*`, `ground-truth-explorer`,
`inspector-realism-report`, `inspector-volume-chart`, `stream-console` (now the Live tab
root), `stream-stop`, `stream-target-tps` (alias of `stream-rate` for one release).

### Removed

`launch-run-button`, which becomes `launch-submit`. The inline launcher's `stream-sink-type`,
`stream-kafka-*`, `stream-rabbitmq-*`, `stream-webhook-url` and `stream-start-button`. The
raw-JSON sink form's `sink-config`, `sink-type`, `sink-name`, `sink-username`,
`sink-password`, `add-sink-submit` and `sink-list`. The e2e flows that used them are
rewritten against the new IDs in the same PR that removes them.
