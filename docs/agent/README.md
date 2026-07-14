# TxLoom agent authoring guide

Generated from packages/agent-tools/src/docs — do not hand-edit; run `pnpm build:agent-docs`.

# SimulationSpec field reference

- `/seed` — Any integer. Same seed + same spec always reproduces byte-identical output — this is the product's core guarantee.
- `/currency` — ISO 4217 3-letter code (e.g. INR, USD). Exactly one currency per scenario.
- `/locale` — Selects the name-dictionary pack for consumer/merchant display names. Must be a shipped pack — currently en-IN, en-US.
- `/channel` — A free-text label stamped on every event, e.g. "upi", "card_present", "wallet" — pick something matching the scenario's real-world channel.
- `/clock/start` — ISO date the history phase begins, e.g. "2026-01-01".
- `/clock/days` — Length of the history phase in days. Typical range 30–90 for a demo, up to the reference scale's 90-day benchmark.
- `/clock/then_stream_tps` — Optional — if set, the run continues past history as a live stream at this target TPS. Omit for a batch-only run.
- `/population/consumers/count` — Reference scale is 200,000; smaller (100s–1000s) is fine and faster for demos/tests.
- `/population/consumers/archetypes` — Weighted list; weights across all archetypes must sum to 1 (±1e-6).
- `/population/consumers/archetypes/*/income_pattern` — kind: "fixed_credit_day" (salaried, needs day_of_month 1-28) or "irregular_weekly" (gig work, no day_of_month).
- `/population/merchants/categories` — Keyed by category name; weights across all categories must sum to 1 (±1e-6).
- `/seasonality/*/window` — [startDate, endDate] — must intersect [clock.start, clock.start + clock.days) or the invariant battery rejects it.
- `/fraud/target_rate` — 0 to 0.5. The achieved rate converges to this within a few percentage points — see get_realism_report after a run.
- `/fraud/typologies` — shares across the array must sum to 1 (±1e-6). Each typology's params shape depends on its type — see the worked examples.
- `/fraud/typologies/*[type=account_takeover]/params/dormancy_days` — Must be less than clock.days, or no persona can ever satisfy the dormancy precondition.
- `/imperfections/*` — Each configured imperfection needs rate in [0, 0.2]. duplicate_delivery/late_arrival/out_of_order/clock_skew accept an optional `sinks` allowlist — omit it to apply to every sink.
- `/imperfections/clock_skew/sources` — Each source.source must name a declared output.sinks[].name.
- `/output/sinks` — At least one sink. type: file | kafka | rabbitmq | webhook. `name` is the join key imperfections target.
- `/output/labels` — "separate_export" (default, recommended) keeps the answer key out of the main export; "merged_with_warning" requires acknowledged_warning:true on export.

# Semantic invariant catalog

## `seasonality-window-outside-clock`

Every seasonality window must intersect [clock.start, clock.start + clock.days).

**Remedy:** Move the window's [start, end] dates inside the clock range, or extend clock.days to cover it.

## `archetype-weights-not-normalized`

population.consumers.archetypes[].weight must sum to 1 (±1e-6).

**Remedy:** Rescale each archetype's weight so the array sums to exactly 1.

## `merchant-category-weights-not-normalized`

population.merchants.categories[].weight must sum to 1 (±1e-6).

**Remedy:** Rescale each category's weight so all categories sum to exactly 1.

## `fraud-typology-shares-not-normalized`

fraud.typologies[].share must sum to 1 (±1e-6).

**Remedy:** Rescale each typology's share so the array sums to exactly 1.

## `fraud-rate-out-of-bounds`

fraud.target_rate must be between 0 and 0.5 inclusive.

**Remedy:** Lower (or raise) target_rate into [0, 0.5].

## `dormancy-not-satisfiable`

An account_takeover typology's dormancy_days must be less than clock.days.

**Remedy:** Reduce fraud.typologies[].params.dormancy_days below clock.days, or increase clock.days.

## `imperfection-rate-out-of-bounds`

Every configured imperfection's rate must be between 0 and 0.2 inclusive.

**Remedy:** Lower the offending imperfections.<type>.rate into [0, 0.2].

## `imperfection-sink-not-declared`

imperfections.<type>.sinks entries must name a sink declared in output.sinks[].name.

**Remedy:** Either add the missing sink to output.sinks, or remove/rename the entry in the imperfection's sinks list.

## `locale-pack-not-found`

spec.locale must reference a shipped name-dictionary pack.

**Remedy:** Use a shipped locale (currently en-IN or en-US), or contribute a new pack under packages/engine/data/name-packs/.

## `clock-skew-source-not-declared`

imperfections.clock_skew.sources[].source must name a sink declared in output.sinks[].name.

**Remedy:** Either add the missing sink to output.sinks, or fix the source name to match an existing sink.

## `population-above-reference-scale`

population counts above the documented reference scale (200k consumers / 5k merchants) are a warning, not a rejection.

**Remedy:** No action required — generation still works; this is outside the benchmarked envelope, so expect longer run times.

## `stream-tps-above-benchmark`

clock.then_stream_tps above the benchmarked maximum (1,000 TPS sustained to Kafka) is a warning, not a rejection.

**Remedy:** No action required — sustained delivery above this rate is simply unverified by the published benchmark.

# Worked examples

## UPI-style instant payments (`upi-instant-payments`)

```json
{
  "seed": 20260101,
  "currency": "INR",
  "locale": "en-IN",
  "channel": "upi",
  "clock": {
    "start": "2026-01-01",
    "days": 90,
    "then_stream_tps": 50
  },
  "population": {
    "consumers": {
      "count": 5000,
      "archetypes": [
        {
          "name": "salaried",
          "weight": 0.55,
          "income_pattern": {
            "kind": "fixed_credit_day",
            "day_of_month": 1,
            "amount_mean": 60000,
            "amount_stddev": 15000
          },
          "spend_rhythm": {
            "daily_transaction_count_mean": 2.5,
            "daily_transaction_count_stddev": 1.2,
            "weekend_multiplier": 1.4
          }
        },
        {
          "name": "gig_worker",
          "weight": 0.45,
          "income_pattern": {
            "kind": "irregular_weekly",
            "amount_mean": 9000,
            "amount_stddev": 3000
          },
          "spend_rhythm": {
            "daily_transaction_count_mean": 3.5,
            "daily_transaction_count_stddev": 1.5,
            "weekend_multiplier": 1.1
          }
        }
      ]
    },
    "merchants": {
      "count": 400,
      "categories": {
        "grocery": {
          "name": "grocery",
          "weight": 0.35,
          "amount_distribution": {
            "kind": "lognormal",
            "mean": 400,
            "stddev": 150
          }
        },
        "electronics": {
          "name": "electronics",
          "weight": 0.15,
          "amount_distribution": {
            "kind": "lognormal",
            "mean": 4000,
            "stddev": 2500
          }
        },
        "restaurant": {
          "name": "restaurant",
          "weight": 0.3,
          "amount_distribution": {
            "kind": "lognormal",
            "mean": 350,
            "stddev": 200
          }
        },
        "fuel": {
          "name": "fuel",
          "weight": 0.2,
          "amount_distribution": {
            "kind": "normal",
            "mean": 800,
            "stddev": 300
          }
        }
      }
    }
  },
  "seasonality": [
    {
      "event": "diwali",
      "window": [
        "2026-02-10",
        "2026-02-17"
      ],
      "volume_multiplier": 2.2
    }
  ],
  "fraud": {
    "target_rate": 0.015,
    "typologies": [
      {
        "type": "card_testing",
        "share": 0.4,
        "params": {
          "burst_size_min": 3,
          "burst_size_max": 8,
          "burst_window_minutes": 4,
          "amount_min": 1,
          "amount_max": 25
        }
      },
      {
        "type": "account_takeover",
        "share": 0.4,
        "params": {
          "dormancy_days": 45,
          "drain_step_count": 4
        }
      },
      {
        "type": "refund_abuse",
        "share": 0.2,
        "params": {
          "refund_rate": 0.25,
          "max_refunds_per_actor": 4
        }
      }
    ]
  },
  "outcomes": {
    "baseline_decline_rate": 0.02
  },
  "imperfections": {
    "duplicate_delivery": {
      "rate": 0.01,
      "sinks": [
        "upi-stream"
      ]
    },
    "late_arrival": {
      "rate": 0.03,
      "delay_seconds_mean": 20,
      "delay_seconds_stddev": 8,
      "sinks": [
        "upi-stream"
      ]
    },
    "out_of_order": {
      "rate": 0.01,
      "sinks": [
        "upi-stream"
      ]
    },
    "clock_skew": {
      "rate": 0.01,
      "sources": [
        {
          "source": "upi-stream",
          "offset_seconds": 45
        }
      ]
    }
  },
  "output": {
    "sinks": [
      {
        "type": "kafka",
        "name": "upi-stream",
        "format": "json"
      }
    ],
    "labels": "separate_export"
  }
}
```

## Card-present retail (`card-present-retail`)

```json
{
  "seed": 20260202,
  "currency": "USD",
  "locale": "en-US",
  "channel": "card_present",
  "clock": {
    "start": "2026-03-01",
    "days": 60
  },
  "population": {
    "consumers": {
      "count": 3000,
      "archetypes": [
        {
          "name": "regular_shopper",
          "weight": 0.7,
          "income_pattern": {
            "kind": "fixed_credit_day",
            "day_of_month": 15,
            "amount_mean": 4500,
            "amount_stddev": 900
          },
          "spend_rhythm": {
            "daily_transaction_count_mean": 1.5,
            "daily_transaction_count_stddev": 0.8,
            "weekend_multiplier": 1.6
          }
        },
        {
          "name": "frequent_shopper",
          "weight": 0.3,
          "income_pattern": {
            "kind": "irregular_weekly",
            "amount_mean": 1200,
            "amount_stddev": 400
          },
          "spend_rhythm": {
            "daily_transaction_count_mean": 3,
            "daily_transaction_count_stddev": 1.5,
            "weekend_multiplier": 1.3
          }
        }
      ]
    },
    "merchants": {
      "count": 150,
      "categories": {
        "grocery": {
          "name": "grocery",
          "weight": 0.4,
          "amount_distribution": {
            "kind": "lognormal",
            "mean": 65,
            "stddev": 25
          }
        },
        "electronics": {
          "name": "electronics",
          "weight": 0.1,
          "amount_distribution": {
            "kind": "lognormal",
            "mean": 250,
            "stddev": 180
          }
        },
        "apparel": {
          "name": "apparel",
          "weight": 0.3,
          "amount_distribution": {
            "kind": "lognormal",
            "mean": 55,
            "stddev": 30
          }
        },
        "fuel": {
          "name": "fuel",
          "weight": 0.2,
          "amount_distribution": {
            "kind": "normal",
            "mean": 45,
            "stddev": 15
          }
        }
      }
    }
  },
  "seasonality": [
    {
      "event": "black_friday",
      "window": [
        "2026-04-27",
        "2026-04-28"
      ],
      "volume_multiplier": 3
    }
  ],
  "fraud": {
    "target_rate": 0.01,
    "typologies": [
      {
        "type": "card_testing",
        "share": 0.7,
        "params": {
          "burst_size_min": 4,
          "burst_size_max": 10,
          "burst_window_minutes": 3,
          "amount_min": 0.5,
          "amount_max": 5
        }
      },
      {
        "type": "refund_abuse",
        "share": 0.3,
        "params": {
          "refund_rate": 0.2,
          "max_refunds_per_actor": 3
        }
      }
    ]
  },
  "outcomes": {
    "baseline_decline_rate": 0.015
  },
  "imperfections": {
    "duplicate_delivery": {
      "rate": 0.005,
      "sinks": [
        "pos-files"
      ]
    },
    "late_arrival": {
      "rate": 0.02,
      "delay_seconds_mean": 60,
      "delay_seconds_stddev": 20,
      "sinks": [
        "pos-files"
      ]
    }
  },
  "output": {
    "sinks": [
      {
        "type": "file",
        "name": "pos-files",
        "format": "parquet"
      }
    ],
    "labels": "separate_export"
  }
}
```

## Mobile money (`mobile-money`)

```json
{
  "seed": 20260303,
  "currency": "INR",
  "locale": "en-IN",
  "channel": "mobile_money",
  "clock": {
    "start": "2026-01-01",
    "days": 45,
    "then_stream_tps": 20
  },
  "population": {
    "consumers": {
      "count": 8000,
      "archetypes": [
        {
          "name": "wallet_user",
          "weight": 0.65,
          "income_pattern": {
            "kind": "irregular_weekly",
            "amount_mean": 5000,
            "amount_stddev": 2000
          },
          "spend_rhythm": {
            "daily_transaction_count_mean": 2,
            "daily_transaction_count_stddev": 1,
            "weekend_multiplier": 1.2
          }
        },
        {
          "name": "agent_customer",
          "weight": 0.35,
          "income_pattern": {
            "kind": "fixed_credit_day",
            "day_of_month": 5,
            "amount_mean": 15000,
            "amount_stddev": 4000
          },
          "spend_rhythm": {
            "daily_transaction_count_mean": 1.2,
            "daily_transaction_count_stddev": 0.6,
            "weekend_multiplier": 1
          }
        }
      ]
    },
    "merchants": {
      "count": 200,
      "categories": {
        "airtime": {
          "name": "airtime",
          "weight": 0.4,
          "amount_distribution": {
            "kind": "exponential",
            "mean": 100
          }
        },
        "bill_pay": {
          "name": "bill_pay",
          "weight": 0.35,
          "amount_distribution": {
            "kind": "lognormal",
            "mean": 600,
            "stddev": 300
          }
        },
        "grocery": {
          "name": "grocery",
          "weight": 0.25,
          "amount_distribution": {
            "kind": "lognormal",
            "mean": 300,
            "stddev": 120
          }
        }
      }
    }
  },
  "seasonality": [],
  "fraud": {
    "target_rate": 0.03,
    "typologies": [
      {
        "type": "account_takeover",
        "share": 1,
        "params": {
          "dormancy_days": 20,
          "drain_step_count": 5
        }
      }
    ]
  },
  "outcomes": {
    "baseline_decline_rate": 0.04
  },
  "imperfections": {
    "late_arrival": {
      "rate": 0.05,
      "delay_seconds_mean": 15,
      "delay_seconds_stddev": 10,
      "sinks": [
        "mm-webhook"
      ]
    },
    "out_of_order": {
      "rate": 0.02,
      "sinks": [
        "mm-webhook"
      ]
    }
  },
  "output": {
    "sinks": [
      {
        "type": "webhook",
        "name": "mm-webhook",
        "format": "json"
      }
    ],
    "labels": "separate_export"
  }
}
```

## Marketplace payouts (`marketplace-payouts`)

```json
{
  "seed": 20260404,
  "currency": "USD",
  "locale": "en-US",
  "channel": "marketplace_payout",
  "clock": {
    "start": "2026-05-01",
    "days": 60
  },
  "population": {
    "consumers": {
      "count": 2000,
      "archetypes": [
        {
          "name": "buyer",
          "weight": 0.8,
          "income_pattern": {
            "kind": "fixed_credit_day",
            "day_of_month": 1,
            "amount_mean": 5000,
            "amount_stddev": 1200
          },
          "spend_rhythm": {
            "daily_transaction_count_mean": 0.8,
            "daily_transaction_count_stddev": 0.5,
            "weekend_multiplier": 1.8
          }
        },
        {
          "name": "power_seller",
          "weight": 0.2,
          "income_pattern": {
            "kind": "irregular_weekly",
            "amount_mean": 3000,
            "amount_stddev": 1500
          },
          "spend_rhythm": {
            "daily_transaction_count_mean": 0.3,
            "daily_transaction_count_stddev": 0.2,
            "weekend_multiplier": 1
          }
        }
      ]
    },
    "merchants": {
      "count": 500,
      "categories": {
        "marketplace_seller": {
          "name": "marketplace_seller",
          "weight": 1,
          "amount_distribution": {
            "kind": "lognormal",
            "mean": 80,
            "stddev": 60
          }
        }
      }
    }
  },
  "seasonality": [
    {
      "event": "holiday_shopping",
      "window": [
        "2026-06-20",
        "2026-06-27"
      ],
      "volume_multiplier": 2.5
    }
  ],
  "fraud": {
    "target_rate": 0.02,
    "typologies": [
      {
        "type": "refund_abuse",
        "share": 1,
        "params": {
          "refund_rate": 0.35,
          "max_refunds_per_actor": 6
        }
      }
    ]
  },
  "outcomes": {
    "baseline_decline_rate": 0.025
  },
  "imperfections": {
    "duplicate_delivery": {
      "rate": 0.01,
      "sinks": [
        "payout-export"
      ]
    }
  },
  "output": {
    "sinks": [
      {
        "type": "file",
        "name": "payout-export",
        "format": "csv"
      }
    ],
    "labels": "separate_export"
  }
}
```
