# Extending TxLoom

TxLoom has three extension surfaces: sinks, fraud typologies and imperfection types. Sinks are a real plugin interface. Typologies and imperfections are extended by adding a branch to one central function, which is a known gap and not hidden. Locale name packs are data only.

## Sinks

Every delivery target implements `Sink` and is built by a matching `SinkFactory`, both defined in `packages/sinks/src/interface.ts` (`SINK_PLUGIN_API_VERSION = 2`). The full contract is `specs/003-generation-delivery-overhaul/contracts/sink-plugin.md`. File output does not use this interface, because the generation pipeline writes it.

```ts
export interface Sink {
  readonly type: SinkType;
  readonly name: string;
  readonly maxInFlight: number; // most unacknowledged publishes the pump may keep outstanding
  readonly maxAttempts?: number; // attempts before a delivery is dropped (default 5)

  // Resolves ONLY once the destination has acknowledged the message, or ok:false on failure.
  // Never retries internally; honours `signal` (abort -> {ok:false, retryable:true}).
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

Retries, backoff, the in-flight window, backpressure and the `dropped` answer-key labels belong to the shared `DeliveryPump` (`packages/sinks/src/pump.ts`). A sink only reports what happened to one message.

### Adding a Sink Type

1. Add the new literal to `SinkType` in `packages/spec/src/types.ts`. This is a schema change, so update the JSON Schema in `packages/spec/src/schema.json` too, and add an invariant if the type has its own constraints.
2. Implement `Sink` and a `SinkFactory` under `packages/sinks/src/<name>/`, following `kafka/producer.ts`, `rabbitmq/publisher.ts` or `webhook/publisher.ts`.
   - `publish` must resolve on the destination's acknowledgement: a delivery report, a publisher confirm or an HTTP 2xx.
   - Mark a failure `retryable: false` only when retrying cannot fix it, such as an HTTP 400.
   - `close()` should release any held connection.
3. Export the factory from `packages/sinks/src/index.ts`.
4. Register it in the factory maps in `apps/api/src/services/connection-validation.ts`, `apps/worker/src/jobs/stream-drive.ts` (`FACTORIES`) and `apps/worker/src/jobs/connection-test.ts`. Widen the `type` enum of the `connections` table with a **new** migration, not an edit to an existing one.
5. Add integration tests under `packages/sinks/tests/integration/`. Use the Testcontainers pattern, or a local-server pattern like `webhook-retry.test.ts` if the target needs no real broker.

### Migrating a v1 Sink to v2

| v1 | v2 |
|---|---|
| `publish(payload, envelope)`; the sink serialized the payload | `publish(target, body, envelope, signal)`; the body is already encoded |
| `envelope.ts` | Removed; `delivered_at` is inside the body |
| Result `{ ok, backpressure?, error? }` | `{ ok, retryable?, error? }`; backpressure is `saturated` / `waitForCapacity` |
| `ok` could mean "handed to the client" | `ok` means the destination acknowledged it |
| The sink retried internally (webhook backoff loop) | The sink makes one attempt; the pump retries |
| No concurrency limit | Declare `maxInFlight` |
| `testConnection()` | `probe(target)` |

## Fraud Typologies

`planDay` in `packages/engine/src/fraud/planner.ts` allocates the fraud budget across `spec.fraud.typologies` each simulated day, with feedback control toward the target rate. It dispatches per typology through an `if` chain. Each typology's generation logic lives in its own file (`card-testing.ts`, `account-takeover.ts`) and returns `FraudEventDraft[]` (`fraud/types.ts`). The planner turns those into scheduled `TruthEvent` and `LabelRecord` pairs.

### Adding a Typology

1. Add the variant to `FraudTypologyConfig` in `packages/spec/src/types.ts`, with its JSON Schema and invariants (for example a bounds check on its params, like `dormancy-satisfiable.ts` for `account_takeover`).
2. Write `packages/engine/src/fraud/<name>.ts` exporting a function that takes the typology's params and the RNG and returns `FraudEventDraft[]`. See `generateCardTestingBurst`, `generateAccountTakeoverScript` or `maybeGenerateRefund`. The `FraudEventDraft[]` return type is the contract; function names vary.
3. Add a branch to `planDay`'s dispatch that calls it and schedules the `TruthEvent` and `LabelRecord` pairs. Use the `card_testing` or `account_takeover` branch as a template.
4. Add golden-master and property-test coverage. `packages/engine/tests/property/fraud-rate.test.ts` shows the achieved-versus-target convergence pattern every typology must satisfy.

::: warning Known gap
Typologies are not behind a formal interface or registry. `planDay` is one function with one branch per typology. A real plugin registry, mirroring `Sink` and `SinkFactory`, would be a larger refactor.
:::

## Imperfection Types

`ImperfectionTransformer` (`packages/engine/src/imperfections/transformer.ts`) runs once per output sink. For each event it checks `late_arrival`, `clock_skew`, `out_of_order` and `duplicate_delivery` in turn and calls a small pure function per type (`late-arrival.ts`, `clock-skew.ts`, `out-of-order.ts`, `duplicate.ts`). That function decides, using the sink's own RNG, whether and how the *delivered* copy is corrupted. The truth event is never mutated. `push` queues a delivery, `drainUntil(t)` emits what is due by simulated time `t`, and `flush()` emits the rest.

### Adding an Imperfection Type

1. Add the key to `ImperfectionsConfig` in `packages/spec/src/types.ts` (extend `ImperfectionRateConfig` if it needs extra params, as `LateArrivalConfig` does), plus a bounds invariant following `imperfection-bounds.ts` (rate in [0, 0.2]).
2. Add a `CorruptionType` variant in `packages/engine/src/types.ts`.
3. Write `packages/engine/src/imperfections/<name>.ts` exporting a pure decision function taking `(config, rng)` and any per-event context, and returning what to corrupt.
4. Add a branch to `ImperfectionTransformer.push` (or `emit`, if the effect is on delivery order). It must add a `LabelRecord` with the new `corruption_type` to the delivery's `corruptions`, so the answer key lists every corruption.
5. Any new random draw changes generated output. Bump `ENGINE_VERSION` and re-baseline the golden master.
6. Add a property test in `packages/engine/tests/property/imperfections.test.ts` asserting the corruption only touches delivered copies, never the truth store.

::: warning Known gap
Like typologies, this is a branch in one class and not a formal plugin interface.
:::

## Name-Dictionary Packs

A locale pack is a data contribution, not code. `packages/engine/src/naming/pack-loader.ts` defines the pack schema, and `packages/engine/data/name-packs/en-IN/` is the reference pack (given and family names, merchant naming grammars, recorded sources). Add `packages/engine/data/name-packs/<locale>/` in the same shape, then set `<locale>` as the spec's top-level `locale`.
