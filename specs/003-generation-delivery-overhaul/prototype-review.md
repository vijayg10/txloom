# Prototype Review (T019)

**Date**: 2026-10-10 | **Against**: contracts/ui-routes.md, contracts/api.md | **Mode**:
`VITE_TXLOOM_MOCK=1 pnpm --filter @txloom/web dev`, walked with a real browser
(Playwright) against the mock adapter (T012) and the components built in Phase 3
(T013–T018).

## Flows walked

### US1 — Connections (quickstart.md § US1)

- Add connection → Kafka → SASL_SSL shows SASL mechanism, CA upload, username/password. ✅
- Typing `localhost:9092` as the bootstrap server shows the `conn-localhost-warning`
  mentioning `kafka:29092`. ✅
- `Test` runs and stages a result (`ok` / `Connected.`) before `Save` is pressed; `Save`
  stays enabled throughout. ✅
- After saving, reopening the connection for edit: the password field is empty and shows
  "Leave blank to keep the stored credentials", type picker is locked. ✅
- RabbitMQ and webhook forms show their own typed fields only (host/port/vhost/TLS/exchange
  vs. url/timeout/headers). ✅

**Finding (minor, not fixed)**: a connection saved right after a successful pre-save test
shows `untested` on the Connections card, because the mock's `createConnection` doesn't
carry the staged probe into `health`. The real API (T038) records `last_test_result` at
save time regardless of whether the probe ran during this session, so this is a mock-only
gap — no contract change needed, left for T012's mock to optionally improve later.

### US5 — Launch drawer (quickstart.md § US5)

Walked via a temporary local harness (deleted after the review) that mounted
`LaunchDrawer` directly, since the real `/scenarios/:id` wiring is T143's job and the mock
has no `/scenarios` listing behind the raw `apiClient`.

- Destinations prefill from `scenario_launch_defaults` / `scenario_destination_defaults`
  (local-kafka, topic `txloom.events`). ✅
- Mode defaults to `history_then_live` once a broker destination exists. ✅
- Estimate line renders and updates between history-only and replay-on. ✅ (see fix below)
- "New connection…" opens a nested drawer over the first; saving it selects the new
  connection in the destination row and **keeps every other field** (mode, rate, advanced
  state). ✅ (see fix below)
- Clearing a sink's destination shows `launch-error` naming the sink and disables
  `launch-submit`. ✅

**Bugs found and fixed in this review (all in Phase 3 components, before any later-phase
task builds on them):**

1. `apps/web/src/surfaces/scenario-workspace/launch-drawer.tsx` — saving a brand-new
   connection via "New connection…" selected it in the destination row but left the topic
   field blank instead of defaulting to the new connection's `default_topic`. Fixed by
   reusing `defaultTargetFor()` (now exported from `destination-picker.tsx`) in the
   `onSaved` handler.
2. `apps/web/src/api/mock/fixtures.ts` / `mock/index.ts` — `makeEstimate()` ignored
   `replay_history` and always returned `replay_messages: 0`, so toggling
   "Replay history to destinations" never changed the estimate line. Fixed by threading
   `replayHistory` through `estimateRun()`.

### US8 — Two-click first run (quickstart.md § US8)

- `/` shows the first-run card when there are no scenarios (confirmed: the mock has no
  `/scenarios` listing, so the raw `apiClient.get("/scenarios")` call fails and the card
  shows — the intended "fresh install" state). ✅
- Clicking **Start the UPI reference run** launches via the mock client and navigates to
  `/runs/:id/live`. ✅
- The run page shows the title (`Scenario · v<n> · date`), the phase badge, the read-only
  destination chip (`events → local-kafka`, Change disabled), and all five tabs
  (Progress/Live/Inspect/Ground truth/Export) with working `NavLink` routing. ✅

**Bug found and fixed:** `apps/web/src/surfaces/run/index.tsx` originally nested a second
`<Routes>` inside `RunPage` to render the active tab's panel, but the parent route
(`/runs/:runId/:tab`) already consumes the full path, leaving nothing for the nested
`<Routes>` to match — no tab content ever rendered. Fixed by deriving the active tab
directly from the `:tab` param and rendering `TabPanel` unconditionally (no nested router).
This is the real shell every later phase (US8's T175) will host content inside, so it
needed to work before being built on.

## Contract changes agreed

**None.** `contracts/ui-routes.md` and `contracts/api.md` match what was built:
navigation (Scenarios · Runs · Connections, Settings in the footer), the route set, and
every `data-testid` exercised above matched the contract's names on the first try. No
`ui-routes.md`/`api.md` edits were needed before proceeding to T046–T047, T143 or
T175–T178.

## Carried forward to later tasks (not fixed now, out of this phase's scope)

- The Connections page's "untested after a pre-save test" mock gap (above) — cosmetic,
  mock-only.
- `apps/web/src/surfaces/home/index.tsx`'s scenario-count check uses the raw `apiClient`
  (not the mock-aware `createApiClient()`), so in mock mode it always falls through to
  "zero scenarios" via the failed fetch's `catch`. T178 replaces this with the real
  clone-template flow and should read the scenario count through a client method instead.
- The Launch drawer and Connections form are not yet wired into the real
  `scenario-workspace` page or a real `/connections/new` route — that is T046–T047 (US1)
  and T143 (US5), which can now build on a verified-working component.
