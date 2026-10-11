# Extending TxLoom

TxLoom ships three extension surfaces (constitution Principle I; FR-027):
sinks, fraud typologies, and imperfection types. This doc covers what exists
today for each, honestly — sinks are a real plugin interface; typologies and
imperfections currently extend by adding a branch to a central function
(documented below as a known follow-up, not papered over).

## Sinks (a real plugin interface, API v2)

Every delivery target implements `Sink` and is constructed by a matching
`SinkFactory`, both defined in `packages/sinks/src/interface.ts`
(`SINK_PLUGIN_API_VERSION = 2`; the full contract is
`specs/003-generation-delivery-overhaul/contracts/sink-plugin.md`). File output
does not use this interface: it is written by the generation pipeline.

```ts
export interface Sink {
  readonly type: SinkType;
  readonly name: string;
  readonly maxInFlight: number; // most unacknowledged publishes the pump may keep outstanding
  readonly maxAttempts?: number; // attempts before a delivery is dropped (default 5)

  // Resolves ONLY once the destination has acknowledged the message, or ok:false on failure.
  // Never retries internally; honours `signal` (abort → {ok:false, retryable:true}).
  publish(
    target: SinkTarget, // { topic?, routing_key?, key? }
    body: Uint8Array, // the wire-encoded event (packages/sinks/src/wire.ts)
    envelope: SinkDeliveryEnvelope, // { delivery_id, event_id }
    signal: AbortSignal,
  ): Promise<{ ok: boolean; retryable?: boolean; error?: string }>;

  readonly saturated?: boolean; // transport backpressure hint
  waitForCapacity?(): Promise<void>; // resolves when `saturated` clears
  setRunContext?(context: { runId; sessionSeq; engineVersion }): void;

  probe(target: SinkTarget): Promise<ProbeResult>;
  close(): Promise<void>;
}

export interface SinkFactory<TConfig = unknown, TSecrets = unknown> {
  readonly type: SinkType;
  readonly configSchema: object; // JSON Schema the API validates connection bodies against
  readonly secretsSchema: object | null;
  create(name: string, config: TConfig, secrets: TSecrets | null): Sink;
}
```

Retries, backoff, the in-flight window, backpressure and the `dropped` answer-key
labels belong to the shared `DeliveryPump` (`packages/sinks/src/pump.ts`), so a
sink only has to report what happened to one message.

To add a new sink type:

1. Add the new literal to `SinkType` in `packages/spec/src/types.ts` (this is
   a schema change — bump the JSON Schema in `packages/spec/src/schema.json`
   too, and add an invariant if the new type has its own constraints).
2. Implement `Sink` + a `SinkFactory` under `packages/sinks/src/<name>/`,
   following `packages/sinks/src/kafka/producer.ts`, `rabbitmq/publisher.ts`
   or `webhook/publisher.ts`. `publish` must resolve on the destination's
   acknowledgement (a delivery report, a publisher confirm, an HTTP 2xx), and
   classify failures: `retryable: false` only for errors that retrying cannot
   fix (an HTTP 400, say). `close()` should release any held connection.
3. Export the factory from `packages/sinks/src/index.ts`.
4. Register it in the factory maps in `apps/api/src/services/connection-validation.ts`,
   `apps/worker/src/jobs/stream-drive.ts` (`FACTORIES`) and
   `apps/worker/src/jobs/connection-test.ts`, and widen the `type` enum of the
   `connections` table with a new migration (not an edit to an existing one).
5. Add integration tests under `packages/sinks/tests/integration/` following
   the existing Testcontainers pattern (or a local-server pattern like
   `webhook-retry.test.ts` if the target doesn't need a real broker).

### Migrating a v1 sink to v2

| v1                                                            | v2                                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `publish(payload, envelope)`; the sink serialized the payload | `publish(target, body, envelope, signal)`; the body is already encoded      |
| `envelope.ts`                                                 | removed; `delivered_at` is inside the body                                  |
| result `{ ok, backpressure?, error? }`                        | `{ ok, retryable?, error? }`; backpressure is `saturated`/`waitForCapacity` |
| `ok` could mean "handed to the client"                        | `ok` means the destination acknowledged it                                  |
| the sink retried internally (webhook backoff loop)            | the sink makes one attempt; the pump retries                                |
| no concurrency limit                                          | declare `maxInFlight`                                                       |
| `testConnection()`                                            | `probe(target)` (since the connections work)                                |

## Fraud typologies (currently: a branch in the orchestrator)

`packages/engine/src/fraud/planner.ts`'s `planDay` allocates the fraud budget
across `spec.fraud.typologies` each simulated day (with feedback control toward
the target rate) and dispatches per typology via an `if` chain — each
typology's event-generation logic lives in its own file (`card-testing.ts`,
`account-takeover.ts`) returning `FraudEventDraft[]` (`fraud/types.ts`), which
the planner turns into scheduled `TruthEvent`/`LabelRecord` pairs.

To add a new typology today:

1. Add the new variant to `FraudTypologyConfig` in `packages/spec/src/types.ts`
   and its JSON Schema/invariants (e.g. a bounds check on its params, similar
   to `dormancy-satisfiable.ts` for account_takeover).
2. Write `packages/engine/src/fraud/<name>.ts` exporting a function that
   takes the typology's params + the RNG and returns `FraudEventDraft[]`
   (see `generateCardTestingBurst`, `generateAccountTakeoverScript`, or
   `maybeGenerateRefund` for the existing shapes — naming varies by typology,
   the `FraudEventDraft[]` return contract is what's load-bearing).
3. Add a branch to `planDay`'s dispatch in `planner.ts` that calls it and
   schedules the `TruthEvent`/`LabelRecord` pairs (follow the `card_testing` or
   `account_takeover` branch as a template).
4. Add golden-master + property-test coverage (constitution Principle III) —
   see `packages/engine/tests/property/fraud-rate.test.ts` for the
   achieved-vs-target convergence pattern every typology must satisfy.

**Known follow-up**: unlike sinks, typologies aren't behind a formal
TypeScript interface/registry — `planDay` is a single function with
one branch per typology. Formalizing this into a real plugin registry
(mirroring `Sink`/`SinkFactory`) is a natural improvement but a larger,
riskier refactor than this doc's scope; flagged here rather than silently
implied to already exist.

## Imperfection types (currently: a branch in the delivery transformer)

`packages/engine/src/imperfections/transformer.ts`'s `ImperfectionTransformer`
runs once per output sink (R9). For each event it checks
`imperfections.late_arrival` / `clock_skew` / `out_of_order` /
`duplicate_delivery` in turn and calls a small pure function per type
(`late-arrival.ts`, `clock-skew.ts`, `out-of-order.ts`, `duplicate.ts`) that
decides, given the sink's own RNG, whether/how this event's _delivered_ copy is
corrupted. The truth event passed in is never mutated (constitution Principle
II, FR-024/025). `push` queues a delivery, `drainUntil(t)` emits what is due by
simulated time `t`, and `flush()` emits the rest.

To add a new imperfection type:

1. Add the new key to `ImperfectionsConfig` in `packages/spec/src/types.ts`
   (extend `ImperfectionRateConfig` if it needs extra params, like
   `LateArrivalConfig` does) plus a bounds invariant
   (`imperfection-bounds.ts` pattern: rate ∈ [0, 0.2]).
2. Add a new `CorruptionType` variant in `packages/engine/src/types.ts`.
3. Write `packages/engine/src/imperfections/<name>.ts` exporting a pure
   decision function taking `(config, rng)` (and any other per-event
   context it needs) and returning what to corrupt.
4. Add a branch to `ImperfectionTransformer.push` (or `emit`, if the effect is
   on delivery order) calling it and adding a `LabelRecord` with the new
   `corruption_type` to the delivery's `corruptions` — every corruption must be
   labeled so the answer key enumerates it (FR-025). Any new random draw changes
   generated output: bump `ENGINE_VERSION` and re-baseline the golden master.
5. Add a property test under `packages/engine/tests/property/imperfections.test.ts`
   asserting the new corruption only ever touches delivered copies, never
   the truth store.

**Known follow-up**: same as typologies — this is a branch in one class, not a
formal plugin interface, documented as a real gap rather than an implied one.

## Name-dictionary packs (locale support)

Not a code plugin — a data contribution. See
`packages/engine/src/naming/pack-loader.ts` for the pack schema and
`packages/engine/data/name-packs/en-IN/` for the reference pack (given/family
names, merchant naming grammars, sources recorded). Add a new
`packages/engine/data/name-packs/<locale>/` directory following that shape,
then reference `<locale>` from a spec's top-level `locale` field.
