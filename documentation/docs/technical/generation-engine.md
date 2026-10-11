# Generation Engine

The engine is a deterministic simulator. Given a spec and a seed it produces truth events, their labels, and each sink's delivered copy. It has no access to the wall clock and no unseeded randomness.

## Determinism

**Same seed + same spec = byte-identical output.**

- **Seeding.** The full 64 bits of the seed are spread across the generator state with SplitMix64. The generator is xoroshiro128+.
- **Independent streams.** Each partition gets its own non-overlapping random substream. Named streams, such as the merchant pool and party names, are seeded from the seed and the stream's name.
- **Simulated time only.** Every timestamp comes from arithmetic on `clock.start`. Event IDs are ULIDs built from simulated time and the seeded generator.
- **Enforced by lint.** `Math.random`, `Date.now()` and `new Date()` are banned inside the engine package.

### Engine version

Any change that alters generated output bumps `ENGINE_VERSION` (currently `6`) and is recorded in the [changelog](https://github.com/vijayg10/txloom/blob/main/CHANGELOG.md). A golden-master test pins the output of a reference spec and seed to the current version.

Each run records the engine version that made it. Regenerating, retrying or streaming a run made by a different version returns `409 engine_version_mismatch` rather than quietly producing different data. Regeneration can proceed if you accept the change explicitly.

---

## Partitioning

The consumer population is cut into contiguous partitions of about 20,000 consumers. The partition count is a function of the consumer count and the chunk size, and it is stored on the run, so it does not depend on how many threads are available.

Partitions are generated in parallel in worker threads. The number generated at once is `min(CPUs − 1, 60% of RAM in GiB)` by default, and can be set with `TXLOOM_MAX_WORKER_THREADS`.

Because each partition is a pure function of the seed, the spec and its partition number, a retry or a crash resume simply runs the partition again and rewrites the same files.

---

## Simulating a Day

Generation proceeds one simulated day at a time per partition. A day is a pure function of the world state and the day index. Memory use is one day of events plus the queue of pending fraud, so it stays flat for any number of days.

For each day the engine:

1. **Plans fraud** that starts today.
2. **Generates legitimate activity** for each consumer: spending drawn from the archetype's spend rhythm, scaled by the weekend multiplier and any seasonality window; income credits according to the archetype's income pattern.
3. **Places events in time** using a built-in hour-of-day activity curve, so traffic has a daily shape instead of being spread evenly.
4. **Assigns outcomes.** Legitimate events are declined at the baseline decline rate.
5. **Merges in the fraud events** that fall on this day.
6. **Emits** truth events and labels, and passes each event through every sink's imperfection transformer.

### Population

Consumers are instantiated from the weighted archetypes; merchants from the weighted categories. Display names come from the locale's name pack: given and family names for people, naming grammars per category for merchants. Names are part of the deterministic output.

Amounts are drawn from each merchant category's distribution: lognormal, normal or exponential.

---

## Fraud Planning

Fraud is planned per day by feedback toward the target rate. Each typology is owed a share of fraud in proportion to the legitimate volume so far plus today's expected volume, and each day plans whatever is still short. Planned events that turn out to be impossible are subtracted again, so the shortfall is planned again later.

Campaigns are queued by simulated time. A campaign that starts late on the last history day continues into the live phase.

| Typology | How a campaign is built |
|---|---|
| Card testing | A burst of `burst_size_min` to `burst_size_max` small payments inside `burst_window_minutes`. Probes are mostly declined; the final step is the most likely to be approved. |
| Account takeover | The victim is kept dormant for `dormancy_days`, then `drain_step_count` P2P transfers follow roughly 15 minutes apart. Most are approved. Attack start times are staggered across the window. |
| Refund abuse | The actor requests refunds against the consumer's most recent purchases (the last 16 are remembered). An attempt with nothing to refund is dropped. |

Every fraud event carries a label with `is_fraud`, `typology`, `actor_id` and `campaign_step`.

---

## Imperfections

Imperfections are applied by a transformer that runs once per sink, one event at a time. It receives the truth event and returns what that sink is delivered. The truth event is never modified.

| Type | Mechanism |
|---|---|
| Late arrival | The delivery waits until simulated time passes `ts + delay`. Payload `ts` is unchanged; `delivered_at` holds the arrival time. |
| Clock skew | The source's offset is added to payload `ts`. Order is unchanged. |
| Out of order | The flagged delivery is held for one slot so the next one overtakes it. The label is written only when an overtake really happens. |
| Duplicate | Extra copies follow the original immediately, each with a new `delivery_id`. |

Each sink's transformer has its own random stream. Adding or removing a sink does not change another sink's output.

Every corruption produces a label, so the answer key lists exactly which deliveries were affected and how.

---

## From History to Live

At the end of history each partition's world is checkpointed, including its random state, its pending fraud campaigns and each sink's transformer state.

The live phase restores that checkpoint and keeps calling the same day simulator for days `D`, `D+1` and so on. History days followed by live days produce exactly what one uninterrupted simulation would.

- Per sink, the partitions' deliveries are merged by `delivered_at`
- A token bucket releases them at the target rate
- Live events are stamped with simulated time; `sent_at` records the wall-clock publish time
- Checkpoints are taken as the stream runs, so a stopped or crashed session resumes from a known day

---

## Realism Report

While generating, each partition keeps running statistics. When the run completes they are merged into the realism report:

| Section | Contents |
|---|---|
| Event count | Total truth events |
| Amount | Mean, standard deviation, minimum, maximum |
| Inter-arrival time | Mean and standard deviation |
| Fraud | Achieved rate and counts per typology |
| Benchmark comparison | Reference ranges supplied by the template, where it has them |
| Chart data | Daily volume, amounts per event type, day-of-week by hour-of-day activity, daily fraud per typology |

The report is stored as `report.json` in the run's folder and served at `GET /api/v1/runs/:id/report`.

---

## Reference Scale

The documented reference scale is 200,000 consumers and 5,000 merchants over 90 days. Larger populations still generate; the validator raises a warning because they are outside the benchmarked range.

## Extending the Engine

Adding a typology, an imperfection type or a locale name pack is described in [Extending TxLoom](./extending.md).
