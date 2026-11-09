# Extending TxLoom

TxLoom has three extension surfaces: sinks, fraud typologies and imperfection types. Sinks are a real plugin interface. Typologies and imperfections are extended by adding a branch to one central function, which is a known gap and not hidden. Locale name packs are data plus a one-line allowlist entry.

## Sinks

Every delivery target implements `Sink` and is built by a matching `SinkFactory`, both defined in `packages/sinks/src/interface.ts` (`SINK_PLUGIN_API_VERSION = 2`). The full contract is `specs/003-generation-delivery-overhaul/contracts/sink-plugin.md`. File output does not use this interface, because the generation pipeline writes it.

```ts
export interface Sink {
  readonly type: SinkType;
  readonly name: string;
  readonly maxInFlight: number; // most unacknowledged publishes the pump may keep outstanding
  readonly maxAttempts?: number; // attempts before a delivery is dropped (default 5)
  readonly partitionKeyField?: string; // wire field used as `SinkTarget.key` (default consumer_id)

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
4. Register the factory in the three `FACTORIES` maps: `apps/api/src/services/connection-validation.ts`, `apps/worker/src/jobs/stream-drive.ts` and `apps/worker/src/jobs/connection-test.ts`.
5. Widen the connection-type enums with a **new** migration, not an edit to an existing one: `connections.type` and `run_destinations.connection_type`.
6. Widen the connection-type unions the API, worker and spec package hard-code, and give the new type its own branches where they switch on it:
   - `apps/api/src/db/repositories/connections.ts` and `run-destinations.ts` (`ConnectionType`)
   - `apps/api/src/services/connection-probe.ts` and `connection-validation.ts`
   - `apps/api/src/routes/connections.ts` (the default `SinkTarget` for a connection)
   - `apps/worker/src/jobs/stream-drive.ts` (how a destination's target maps onto the sink)
   - `packages/spec/src/connection-warnings.ts`
7. Wire the clients so every surface can reach the new type:
   - Web: `apps/web/src/api/client.ts` (`ConnectionType` and the typed config), `surfaces/connections/connection-form.tsx` (type picker and fields) and `components/data/destination-picker.tsx`
   - CLI: `apps/cli/src/commands/connections.ts`
8. Add integration tests under `packages/sinks/tests/integration/`. Use the Testcontainers pattern, or a local-server pattern like `webhook-retry.test.ts` if the target needs no real broker.

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

Three typologies ship: `card_testing`, `account_takeover` and `refund_abuse`. Fraud is planned and emitted in two steps, both in `packages/engine/src/fraud/planner.ts`:

- **`planDay`** runs once per simulated day. There is no global budget. The target rate is met by feedback: each typology is owed `rate / (1 − rate) × share × legitimate volume so far`, and the day plans campaigns for whatever is still short. It dispatches per typology through an `if` chain and pushes each campaign's steps onto `world.pendingFraud` as `ScheduledFraudEvent`s keyed by simulated time.
- **`drainDay`** pops the scheduled events that fall inside the day and turns each into a `TruthEvent` and its `LabelRecord`. Events that cannot happen (for example a refund with no purchase to refund) are dropped and un-planned, so the next `planDay` makes up the shortfall.

`card_testing` and `account_takeover` keep their step generation in their own files (`card-testing.ts`, `account-takeover.ts`), each returning `FraudEventDraft[]` (`fraud/types.ts`). `refund_abuse` is written inline in `planDay`, and its refunds are matched against the consumer's recent purchases in `drainDay`.

### Adding a Typology

1. Add the variant to `FraudTypologyConfig` in `packages/spec/src/types.ts`, with its JSON Schema and invariants (for example a bounds check on its params, like `dormancy-satisfiable.ts` for `account_takeover`).
2. Write `packages/engine/src/fraud/<name>.ts` exporting a function that takes the typology's params and the RNG and returns `FraudEventDraft[]`. See `generateCardTestingBurst` or `generateAccountTakeoverScript`. The `FraudEventDraft[]` return type is the contract; function names vary.
3. Add a branch to `planDay`'s dispatch that calls it and schedules each draft onto `world.pendingFraud`, adding to `world.planner.fraudPlanned` for the feedback loop. Use the `card_testing` or `account_takeover` branch as a template. If the new typology's events depend on world state at emission time, resolve them in `drainDay` as `refund_abuse` does.
4. Add golden-master and property-test coverage. `packages/engine/tests/property/fraud-rate.test.ts` shows the achieved-versus-target convergence pattern every typology must satisfy.

::: warning Known gap
Typologies are not behind a formal interface or registry. `planDay` is one function with one branch per typology, and `drainDay` special-cases refunds. A real plugin registry, mirroring `Sink` and `SinkFactory`, would be a larger refactor.
:::

## Imperfection Types

`ImperfectionTransformer` (`packages/engine/src/imperfections/transformer.ts`) runs once per output sink. For each event it checks `late_arrival`, `clock_skew`, `out_of_order` and `duplicate_delivery` in turn and calls a small pure function per type (`late-arrival.ts`, `clock-skew.ts`, `out-of-order.ts`, `duplicate.ts`). That function decides, using the sink's own RNG, whether and how the *delivered* copy is corrupted. The truth event is never mutated. `push` queues a delivery, `drainUntil(t)` emits what is due by simulated time `t`, and `flush()` emits the rest.

### Adding an Imperfection Type

1. Add the key to `ImperfectionsConfig` in `packages/spec/src/types.ts` (extend `ImperfectionRateConfig` if it needs extra params, as `LateArrivalConfig` and `ClockSkewConfig` do), plus a bounds invariant following `imperfection-bounds.ts` (rate in [0, 0.2]).
2. Add a `CorruptionType` variant in `packages/engine/src/types.ts`.
3. Write `packages/engine/src/imperfections/<name>.ts` exporting a pure decision function taking `(config, rng)` and any per-event context, and returning what to corrupt.
4. Add a branch to `ImperfectionTransformer.push` (or `emit`, if the effect is on delivery order). It must add a `LabelRecord` with the new `corruption_type` to the delivery's `corruptions`, so the answer key lists every corruption.
5. Any new random draw changes generated output. Bump `ENGINE_VERSION` and re-baseline the golden master.
6. Add a property test in `packages/engine/tests/property/imperfections.test.ts` asserting the corruption only touches delivered copies, never the truth store.

::: warning Known gap
Like typologies, this is a branch in one class and not a formal plugin interface.
:::

## Name-Dictionary Packs

A locale pack is mostly data. Two packs ship, `en-IN` and `en-US`, under `packages/engine/data/name-packs/`. `packages/engine/src/naming/pack-loader.ts` defines the pack shape: `given-names.json` and `family-names.json` (weighted entries) and `merchant-grammars.json` (naming patterns and word lists), each with a `source` field recording where the data came from.

1. Add `packages/engine/data/name-packs/<locale>/` with the same three files.
2. Add `<locale>` to `SHIPPED_LOCALE_PACKS` in `packages/spec/src/invariants/reference-integrity.ts`. The validator rejects any spec whose `locale` is not in that list.
3. Set `<locale>` as the spec's top-level `locale`.
