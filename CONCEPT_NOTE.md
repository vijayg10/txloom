# TxLoom — Synthetic Transaction Studio

An open-source, self-hosted **payments world simulator**. It models a population of consumers, merchants, and fraud actors behaving over time — salaries, spending rhythms, seasonal spikes, fraud campaigns — and emits the resulting transactions wherever you need them: files for ML teams, or live Kafka/RabbitMQ streams and webhooks at controlled TPS for platform testing. Every event carries hidden ground-truth labels: which transactions are fraudulent, which typology produced them, which records were deliberately corrupted. A natural-language interface compiles plain-English scenario descriptions into the underlying simulation spec, but the spec — versioned, validated, hand-editable — is the product's source of truth, not the prompt.

**One-line pitch:** "A simulated financial world — with the answer key."

---

## The problem

Everyone building or testing financial software needs transaction data, and nobody has it. Real payment data is locked behind privacy regulation and commercial sensitivity. Fraud and AML teams can't train or benchmark models without labeled examples, which are by definition a fraction of a percent of real volume. Platform teams testing payment switches, ledgers, reconciliation systems, and fraud pipelines need realistic *event streams* with realistic *failure modes* — duplicates, late arrivals, out-of-order delivery — not just clean static files. And developers building fintech products need seed data that behaves like real customers: rent on the 3rd, salary on the 1st, festival-week spikes, the occasional bounced transfer.

## Landscape

**Academic simulators.** PaySim simulates mobile money transactions calibrated from real logs with injected fraud, but is a fixed-domain artifact best known as a static Kaggle CSV. BankSim is the same era and pattern. MoMTSim adds richer fraud typologies (SIM-swap ATO, refund fraud) but remains a research toolkit with no product surface. These established the *labeled fraud simulation* idea and then stopped evolving.

**ML-based tabular synthesizers.** SDV (open source), Gretel, Mostly AI, YData: statistically faithful synthesis that *requires real seed data*, is general-purpose rather than payments-native, and produces tables, not behavior over time.

**Declarative streaming generators.** ShadowTraffic (commercial, closed-source container) declaratively generates production-like traffic to Kafka, Postgres, S3, and webhooks from a JSON config, with relational lookups and state machines. This is the strongest adjacent product for the streaming mechanics. It has no domain model — no personas, no time-structured behavior, no fraud, no labels — and it is not open source.

**AI-configured generators.** Mockaroo's AI fields generate schemas and field values from plain-English descriptions; Tonic Fabricate (commercial) offers agentic AI configuration with cross-table relational consistency. These own the "describe it, get rows" convenience story. Notably, Tonic's own published analysis concedes that raw LLM generation lacks statistical consistency at scale and breaks referential integrity — the exact failure mode this product's architecture is designed around.

**Niche entrants.** Santander's gen-fraud-graph generates synthetic transaction graphs with injected fraud for benchmarking graph-based fraud models — a strong demand signal, narrowly scoped, Python, no streaming, no UI.

## What is actually novel here — and what is not

Not novel, and deliberately not the headline: generating data from a natural-language description (Mockaroo, Fabricate), streaming synthetic events to Kafka (ShadowTraffic), labeled fraud datasets as a concept (PaySim lineage).

Novel — no existing tool has even one of these, let alone the combination:

1. **A behavioral world model.** Personas with income and spending rhythms, merchant catalogs, seasonality, and fraud actors executing multi-step typologies *woven into legitimate traffic over a simulated clock*. Competitors generate plausible rows; this simulates causes and emits their consequences.
2. **Ground-truth answer keys.** Every event is traceable to the actor and typology that produced it, exportable as a separate label set. You can benchmark a fraud model, a recon engine, or an alerting pipeline against known truth.
3. **A labeled imperfection engine.** Deliberate, configurable data pathology: duplicates, missing fields, out-of-order and late-arriving events, clock skew and timezone offsets between sources. Because imperfections are injected, they are also *labeled* — you know exactly which records your dedup logic should have caught.
4. **History-to-live continuity.** Generate 90 days of history as files, then the *same world state* continues as a live stream at controlled TPS. Batch tools and streaming tools exist; a world that does both is unclaimed.
5. **Multi-perspective output (v1.1 headline).** One underlying truth emitted as N inconsistent views — issuer extract, acquirer extract, switch log, end-of-day settlement file — with configurable injected breaks. This makes it the only tool for testing reconciliation systems, and no competitor is architected to add it.
6. **Open source and self-hosted.** ShadowTraffic, Fabricate, Gretel, and Mockaroo are all commercial. In a domain where the data is the sensitive asset, self-hosted matters.

The LLM's role is deliberately constrained: it compiles English into a validated spec and applies natural-language edit patches to it. It never generates transactions. This is the "LLM proposes, engine enforces" pattern — deterministic, reproducible, auditable, cheap at any volume.

## How it works

**Describe.** *"A UPI-style instant payment network in India. 200k consumers, 5k merchants across groceries, fuel, food delivery and electronics. Salary credits at month start, spike during Diwali week. Include 1.2% fraud: card-testing bursts, account takeover after dormancy, and refund abuse. Add realistic mess: 0.5% duplicate webhooks, occasional late-arriving events. 90 days of history, then stream live at 50 TPS."*

**Compile.** An LLM agent translates this into a structured simulation spec: persona archetypes, merchant catalogs, temporal patterns, network topology, fraud typology configs, imperfection profiles. The spec is validated against a JSON Schema *and a battery of semantic invariants* before anything runs; invalid specs bounce through a repair loop. Example invariant: a seasonality event scheduled outside the simulation's clock window is syntactically valid JSON but semantically dead — the validator rejects it with an explanation the repair loop can act on. The spec is the source of truth: inspectable, hand-editable, versioned in git.

**Edit conversationally.** "Raise fraud to 2% and add a mule ring of 15 accounts" produces a *spec diff* for review, not a regenerated spec — the same mental model as a code review.

**Generate.** The deterministic engine executes the spec from a seed. Persona agents wake on their schedules and transact; fraud actors run their typology scripts; the imperfection layer corrupts a labeled subset of the delivery (never the truth record). Same seed + same spec = identical output, always — parallel workers get deterministic partitions of the persona space with per-partition RNG streams.

**Deliver.** Pluggable sinks: CSV/Parquet/JSON files; Kafka producer with configurable partitioning and TPS control with backpressure; RabbitMQ publisher with configurable exchange/routing and the same TPS control; signed webhook delivery with retries. Ground-truth labels (is_fraud, typology, actor_id, corruption_type) export separately so the answer key never leaks into the test surface unless requested.

**Verify.** Every run produces a **realism report**: distribution summaries per category, inter-arrival statistics, achieved-vs-target fraud rates, seasonality effect sizes, and reference-benchmark comparisons where public aggregates exist (e.g., RBI UPI statistics for the India pack). This is the run's quality evidence — the norm ML users expect from SDV-class tools, and the direct answer to "how do I know this is realistic?"

**Inspect.** A dashboard renders the world before export: volume over time, amount distributions, fraud-injection timeline, per-persona activity heatmaps, imperfection audit. Iterate on the scenario visually, not by grepping a CSV.

## Architecture

```
  natural language ──► Scenario compiler (LLM)      NL edit ──► Spec differ (LLM)
                              │ spec (JSON)                        │ spec patch
                              ▼                                    ▼
                       ┌────────────────────────────────────────────┐
                       │ Spec validator: JSON Schema + semantic      │
                       │ invariants + repair loop                    │
                       └──────────────────┬─────────────────────────┘
                                          ▼
                       ┌────────────────────────────────────────────┐
                       │ Generation engine (seeded, deterministic)   │
                       │ persona agents · fraud actors · virtual     │
                       │ clock · partitioned parallel workers        │
                       └──────────────────┬─────────────────────────┘
                                          │ truth stream
                       ┌──────────────────▼─────────────────────────┐
                       │ Imperfection engine (labeled corruption:    │
                       │ dupes · drops · reorder · late · clock skew)│
                       └──────────────────┬─────────────────────────┘
              ┌────────────┬──────────────┼──────────────┬──────────────┐
              ▼            ▼              ▼              ▼              ▼
         Files        Kafka sink     RabbitMQ sink  Webhook sink   Dashboard +
         csv/parquet  TPS control    exchange/      signed,        realism report
         + label set  backpressure   routing, TPS   retries        (React)

  v1.1: Recon views (issuer/acquirer/switch/settlement w/ breaks) · MCP server
```

Services: Fastify API + job orchestration, BullMQ workers for chunked parallel generation with idempotent resume, MySQL (Knex for migrations and query building, no ORM) for scenarios/specs/run metadata, Redis for queues, React + Recharts dashboard built as a Vite SPA. Node worker_threads inside each generation worker for CPU-bound throughput; a documented performance budget with a published benchmark ("sustains 1,000 TPS to Kafka with flat memory") is part of the v1 definition of done. TypeScript end to end. Ships as one `docker compose up`.

## Simulation spec (illustrative excerpt)

```jsonc
{
  "seed": 42,
  "clock": { "start": "2026-09-01", "days": 90, "then_stream_tps": 50 },
  "population": {
    "consumers": { "count": 200000, "archetypes": [
      { "name": "salaried_urban", "weight": 0.55,
        "income": { "credit_day": 1, "amount": { "dist": "lognormal", "median": 45000, "sigma": 0.4 } },
        "spend_rhythm": { "daily_txn": { "dist": "poisson", "lambda": 1.8 }, "weekend_multiplier": 1.4 } },
      { "name": "gig_worker", "weight": 0.20, "income": { "pattern": "irregular_weekly" } }
    ]},
    "merchants": { "count": 5000, "categories": {
      "groceries": { "weight": 0.35, "amount": { "dist": "lognormal", "median": 320, "sigma": 0.6 } },
      "fuel":      { "weight": 0.15, "amount": { "dist": "normal", "mean": 900, "std": 250 } }
    }}
  },
  "seasonality": [
    { "event": "diwali", "window": ["2026-11-08", "2026-11-15"], "volume_multiplier": 2.1 }
    // validator invariant: every seasonality window must intersect [clock.start, clock.start + days]
  ],
  "fraud": {
    "target_rate": 0.012,
    "typologies": [
      { "type": "card_testing", "share": 0.5, "burst": { "txns": [15, 40], "window_s": 120 }, "amounts": [1, 10] },
      { "type": "account_takeover", "share": 0.3, "precondition": "dormant_days>=30", "behavior": "drain_via_p2p" },
      { "type": "refund_abuse", "share": 0.2 }
    ]
  },
  "imperfections": {
    "duplicate_delivery": { "rate": 0.005, "sinks": ["kafka", "webhook"] },
    "late_arrival":       { "rate": 0.002, "delay_s": { "dist": "exponential", "mean": 300 } },
    "out_of_order":       { "rate": 0.003 },
    "clock_skew":         { "sources": { "acquirer_feed": "+00:05:30" } }
  },
  "output": { "sinks": ["parquet", "kafka"], "labels": "separate_export" }
}
```

## The Studio UI

Every capability is operable from the web UI — the CLI is an automation convenience, not the primary interface. Six surfaces cover the product:

**1. Scenario workspace.** The home of the "studio" experience. A natural-language prompt panel compiles a description into a spec; the result opens in a split view — Monaco JSON editor on the left with schema autocomplete and inline semantic-invariant errors (the Diwali-outside-clock class of mistake is a red squiggle with an explanation, not a failed run), and a live structural preview on the right (population summary, typology list, imperfection profile, estimated volume). Natural-language edits produce a **diff review panel** — accept/reject hunks like a code review. A template gallery (UPI-style, card-present retail, mobile money, marketplace payouts) lets users clone and modify instead of starting blank, and every saved scenario keeps a version history with one-click rollback.

**2. Run control.** Launch runs from a scenario with run-scoped parameters (seed, scale override, sink selection). A run list shows status, progress from the chunked workers (per-partition progress bars), throughput, and ETA; run detail offers logs, pause/cancel, and idempotent resume. Completed runs are immutable records — spec snapshot, seed, realism report, and outputs are permanently linked, which is what makes "regenerate exactly this dataset" a button.

**3. Stream console.** For live mode: start/stop/pause, a TPS dial with live achieved-vs-target throughput, sink lag and backpressure indicators, and an event ticker sampling the stream in real time. Dialing TPS up while a Kafka consumer dashboard reacts is the 30-second wow moment.

**4. World inspector.** The analysis surface: volume-over-time with seasonality overlays, amount distributions per category, persona activity heatmaps, the fraud-injection timeline, and the imperfection audit (what was corrupted, where, labeled). The realism report renders here per run, and any two runs can be compared side by side.

**5. Ground-truth explorer.** Filter and browse by typology, then drill into an actor's *story*: an account-takeover actor's timeline from dormancy through credential-change signal to drain transactions, rendered as a sequence. Export controls live here — with or without labels, per format, with an explicit warning when labels are included in the main export rather than the separate answer key.

**6. Connections & settings.** Sink management (Kafka clusters, RabbitMQ brokers, webhook endpoints) with test-connection buttons and credential storage; LLM provider configuration; global defaults. Nothing requires editing a config file on disk.

The UI is a pure client of the same REST/WebSocket API the CLI and the future MCP server use — one API surface, three clients.

## Feature roadmap beyond v1

**v1.1 — the reconciliation release.** Multi-perspective sinks: the same truth emitted as issuer, acquirer, and switch extracts plus end-of-day settlement files, with configurable injected breaks (missing legs, amount mismatches, timing differences). Turns the tool from "test data" into "the only way to test a recon system." Plus an **MCP server** exposing compile/generate/fetch as tools, so coding agents can self-serve labeled test datasets mid-task — cheap to build on the existing API and highly visible.

**v1.2 — the AML release.** Structuring/smurfing and mule-network typologies with graph-shaped ground truth (rings, layering chains), plus graph exports — expanding the audience from fraud-detection to compliance teams and answering gen-fraud-graph on its own turf with a full product around it.

**v2 candidates.** Concept-drift scheduling (fraud tactics evolve mid-run, for MLOps evaluation of model decay); format packs (ISO 8583, ISO 20022 pacs.008, UPI-like, generic JSON); label-noise injection for robustness testing; a community scenario-pack registry.

**Distribution flywheel.** Publish flagship generated datasets ("TxLoom-1M: labeled UPI-style transactions with 4 fraud typologies") on Kaggle and Hugging Face with the spec included — every download is an advertisement for the generator, and reproducibility from spec+seed is the differentiator no static dataset has.

## Roadmap (8 weeks)

The UI is a parallel workstream from week 3, not a final-fortnight afterthought — the API-first architecture makes this natural since every engine capability lands as an endpoint the UI consumes.

| Weeks | Engine & API | Studio UI |
|---|---|---|
| 1–2 | Spec format + JSON Schema + semantic invariant validator; deterministic engine core (personas, virtual clock, seeded partitioned RNG); CSV sink; REST API skeleton + CLI runner | — (API contracts defined) |
| 3–4 | Fraud typologies (card testing, ATO, refund abuse) with label export; imperfection engine (dupes, late, out-of-order, clock skew); Parquet + Kafka sinks with TPS control; chunked parallel generation via BullMQ; WebSocket progress events | App shell + Run control (launch, progress bars, logs, cancel/resume); spec editor with schema validation |
| 5–6 | LLM scenario compiler with validation/repair loop; NL spec-diff endpoint; realism report generation; scenario template library | Scenario workspace (NL prompt panel, inline invariant errors, diff review, template gallery); World inspector (charts, fraud timeline, imperfection audit, realism report) |
| 7–8 | Webhook + RabbitMQ sinks; streaming mode hardening; performance benchmark | Stream console (TPS dial, live throughput, event ticker); Ground-truth explorer (actor stories, export controls); Connections & settings; run comparison; polish |

De-scope order if time compresses: run comparison and template gallery first, ground-truth actor stories second (labels still exportable via files), webhook sink third. The irreducible v1 is: scenario workspace + run control + world inspector in the UI, with Kafka + labeled fraud + imperfections + realism report underneath. Multi-perspective recon mode and MCP are explicitly *not* in the 8 weeks — they are the announced v1.1 so the README shows a living roadmap.

## Risks and mitigations

**Positioning risk.** "Generate data from English" reads as a Mockaroo/Fabricate clone; leading with it buries the actual novelty. Mitigation: all messaging leads with the world model, ground truth, and answer key; the LLM is described as the on-ramp, not the engine.

**Realism credibility.** Users who know payments will spot naive distributions. Mitigation: the realism report makes fidelity measurable per run; defaults calibrated against published aggregates (RBI UPI stats, category splits) with sources documented; every distribution overridable in the spec.

**ShadowTraffic overlap.** The streaming mechanics will invite comparison. Mitigation: don't compete on generator breadth — compete on domain depth, labels, and openness; say so plainly in a README comparison table.

**Scope creep.** Sinks and typologies can grow forever. Mitigation: v1 ships exactly three typologies, four sinks, four imperfection types; everything else is a plugin interface plus a CONTRIBUTING.md invitation, which doubles as the community-growth mechanism.

**LLM spec quality.** Mitigation: the repair loop plus hand-editability means a mediocre first compile is an inconvenience, not a failure; the engine works without the LLM at all.

## Positioning line for the README

> Academic simulators are rigid. ML synthesizers need your real data. Streaming generators make plausible rows with no ground truth. TxLoom simulates a financial world — customers, merchants, fraudsters, and mess — and hands you both the data and the answer key: as files, as a Kafka or RabbitMQ firehose, or as a stream of signed webhooks.
