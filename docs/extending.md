# Extending TxLoom

TxLoom ships three extension surfaces (constitution Principle I; FR-027):
sinks, fraud typologies, and imperfection types. This doc covers what exists
today for each, honestly — sinks are a real plugin interface; typologies and
imperfections currently extend by adding a branch to a central function
(documented below as a known follow-up, not papered over).

## Sinks (a real plugin interface)

Every delivery target implements `Sink` and is constructed by a matching
`SinkFactory`, both defined in `packages/sinks/src/interface.ts`:

```ts
export interface Sink {
  readonly type: SinkType;
  readonly name: string;
  publish(
    payload: Record<string, unknown>,
    envelope: SinkDeliveryEnvelope,
  ): Promise<SinkPublishResult>;
  testConnection(): Promise<SinkTestResult>;
  close(): Promise<void>;
}

export interface SinkFactory<TConfig = unknown> {
  readonly type: SinkType;
  create(name: string, config: TConfig, credentials: Buffer | null): Sink;
}
```

To add a new sink type:

1. Add the new literal to `SinkType` in `packages/spec/src/types.ts` (this is
   a schema change — bump the JSON Schema in `packages/spec/src/schema.json`
   too, and add an invariant if the new type has its own constraints).
2. Implement `Sink` + a `SinkFactory` under `packages/sinks/src/<name>/`,
   following the pattern in `packages/sinks/src/kafka/producer.ts`,
   `rabbitmq/publisher.ts`, or `webhook/publisher.ts` — `publish()` should
   report `backpressure: true` when the caller should slow down (the
   stream-drive job's token bucket, `packages/engine/src/streaming/token-bucket.ts`,
   reacts to this), and `close()` should release any held connection.
3. Export the factory from `packages/sinks/src/index.ts`.
4. Wire the factory into:
   - `apps/api/src/routes/sink-test.ts`'s dispatch switch (test-connection).
   - `apps/worker/src/jobs/stream-drive.ts`'s `defaultCreateSink` switch (live
     streaming).
   - `apps/api/src/db/migrations/006_sink_connections.ts`'s `type` enum
     (a new migration to widen it, not an edit to the existing one).
5. Add integration tests under `packages/sinks/tests/integration/` following
   the existing Testcontainers pattern (or a local-server pattern like
   `webhook-retry.test.ts` if the target doesn't need a real broker).

## Fraud typologies (currently: a branch in the orchestrator)

`packages/engine/src/fraud/orchestrator.ts`'s `orchestrateFraud` allocates
the fraud budget across `spec.fraud.typologies` and dispatches per typology
via an `if (typology.type === "card_testing") {...} else if (...) {...}`
chain — each typology's actual event-generation logic lives in its own file
(`card-testing.ts`, `account-takeover.ts`, `refund-abuse.ts`) returning
`FraudEventDraft[]` (`fraud/types.ts`), which the orchestrator turns into
full `TruthEvent`/`LabelRecord` pairs.

To add a new typology today:

1. Add the new variant to `FraudTypologyConfig` in `packages/spec/src/types.ts`
   and its JSON Schema/invariants (e.g. a bounds check on its params, similar
   to `dormancy-satisfiable.ts` for account_takeover).
2. Write `packages/engine/src/fraud/<name>.ts` exporting a function that
   takes the typology's params + the RNG and returns `FraudEventDraft[]`
   (see `generateCardTestingBurst`, `generateAccountTakeoverScript`, or
   `maybeGenerateRefund` for the existing shapes — naming varies by typology,
   the `FraudEventDraft[]` return contract is what's load-bearing).
3. Add a branch to `orchestrateFraud`'s dispatch in `orchestrator.ts` that
   calls it and builds the `TruthEvent`/`LabelRecord` pairs (follow the
   `card_testing` or `account_takeover` branch as a template).
4. Add golden-master + property-test coverage (constitution Principle III) —
   see `packages/engine/tests/property/fraud-rate.test.ts` for the
   achieved-vs-target convergence pattern every typology must satisfy.

**Known follow-up**: unlike sinks, typologies aren't behind a formal
TypeScript interface/registry — `orchestrateFraud` is a single function with
one branch per typology. Formalizing this into a real plugin registry
(mirroring `Sink`/`SinkFactory`) is a natural improvement but a larger,
riskier refactor than this doc's scope; flagged here rather than silently
implied to already exist.

## Imperfection types (currently: a branch in the delivery pipeline)

`packages/engine/src/imperfections/pipeline.ts`'s `applyImperfections` checks
each of `imperfections.duplicate_delivery` / `late_arrival` / `out_of_order` /
`clock_skew` in turn and calls a small pure function per type
(`duplicate.ts`, `late-arrival.ts`, `out-of-order.ts`, `clock-skew.ts`) that
decides, given the RNG, whether/how this event's _delivered_ copy should be
corrupted — the truth record passed into the pipeline is never mutated
(constitution Principle II, FR-024/025).

To add a new imperfection type:

1. Add the new key to `ImperfectionsConfig` in `packages/spec/src/types.ts`
   (extend `ImperfectionRateConfig` if it needs extra params, like
   `LateArrivalConfig` does) plus a bounds invariant
   (`imperfection-bounds.ts` pattern: rate ∈ [0, 0.2]).
2. Add a new `CorruptionType` variant in `packages/engine/src/types.ts`.
3. Write `packages/engine/src/imperfections/<name>.ts` exporting a pure
   decision function taking `(config, rng)` (and any other per-event
   context it needs) and returning what to corrupt.
4. Add a branch to `applyImperfections` in `pipeline.ts` calling it and
   pushing a `LabelRecord` with the new `corruption_type` — every corruption
   must be labeled so the answer key enumerates it (FR-025).
5. Add a property test under `packages/engine/tests/property/imperfections.test.ts`
   asserting the new corruption only ever touches delivered copies, never
   the truth store.

**Known follow-up**: same as typologies — this is a branch in one function,
not a formal plugin interface, documented as a real gap rather than an
implied one.

## Name-dictionary packs (locale support)

Not a code plugin — a data contribution. See
`packages/engine/src/naming/pack-loader.ts` for the pack schema and
`packages/engine/data/name-packs/en-IN/` for the reference pack (given/family
names, merchant naming grammars, sources recorded). Add a new
`packages/engine/data/name-packs/<locale>/` directory following that shape,
then reference `<locale>` from a spec's top-level `locale` field.
