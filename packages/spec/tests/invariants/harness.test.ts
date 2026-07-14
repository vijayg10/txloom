import { describe, expect, it } from "vitest";
import type { InvariantFn, SimulationSpec } from "../../src/types.js";
import { ALL_INVARIANTS } from "../../src/invariants/index.js";
import { baseValidSpec, cloneSpec } from "../fixtures.js";

interface Case {
  name: string;
  fn: InvariantFn;
  expectedCode: string;
  breakIt: (spec: SimulationSpec) => SimulationSpec;
}

// One deliberately-broken mutation per invariant, paired with the invariant it exercises.
// The unmodified baseValidSpec() fixture is the known-good case for every invariant —
// it must satisfy the whole battery simultaneously.
const cases: Case[] = [
  {
    name: "seasonality-window",
    fn: ALL_INVARIANTS.find((i) => i.name === "seasonality-window")!.fn,
    expectedCode: "seasonality-window-outside-clock",
    breakIt: (spec) => {
      spec.seasonality[0]!.window = ["2030-01-01", "2030-01-05"];
      return spec;
    },
  },
  {
    name: "weights-sum",
    fn: ALL_INVARIANTS.find((i) => i.name === "weights-sum")!.fn,
    expectedCode: "archetype-weights-not-normalized",
    breakIt: (spec) => {
      spec.population.consumers.archetypes[0]!.weight = 0.9;
      return spec;
    },
  },
  {
    name: "fraud-rate-bounds",
    fn: ALL_INVARIANTS.find((i) => i.name === "fraud-rate-bounds")!.fn,
    expectedCode: "fraud-rate-out-of-bounds",
    breakIt: (spec) => {
      spec.fraud.target_rate = 0.75;
      return spec;
    },
  },
  {
    name: "dormancy-satisfiable",
    fn: ALL_INVARIANTS.find((i) => i.name === "dormancy-satisfiable")!.fn,
    expectedCode: "dormancy-not-satisfiable",
    breakIt: (spec) => {
      const ato = spec.fraud.typologies.find((t) => t.type === "account_takeover");
      if (ato?.type === "account_takeover") ato.params.dormancy_days = 9999;
      return spec;
    },
  },
  {
    name: "imperfection-bounds",
    fn: ALL_INVARIANTS.find((i) => i.name === "imperfection-bounds")!.fn,
    expectedCode: "imperfection-rate-out-of-bounds",
    breakIt: (spec) => {
      spec.imperfections.duplicate_delivery = { rate: 0.9, sinks: ["primary-file"] };
      return spec;
    },
  },
  {
    name: "reference-integrity",
    fn: ALL_INVARIANTS.find((i) => i.name === "reference-integrity")!.fn,
    expectedCode: "locale-pack-not-found",
    breakIt: (spec) => {
      spec.locale = "xx-NOPE";
      return spec;
    },
  },
  {
    name: "scale-envelope",
    fn: ALL_INVARIANTS.find((i) => i.name === "scale-envelope")!.fn,
    expectedCode: "population-above-reference-scale",
    breakIt: (spec) => {
      spec.population.consumers.count = 10_000_000;
      return spec;
    },
  },
];

describe("invariant battery", () => {
  it.each(cases)("$name: no violation on the known-good fixture", ({ fn }) => {
    expect(fn(baseValidSpec())).toEqual([]);
  });

  it.each(cases)(
    "$name: returns a located violation for the known-bad fixture",
    ({ fn, breakIt, expectedCode }) => {
      const bad = breakIt(cloneSpec(baseValidSpec()));
      const violations = fn(bad);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.some((v) => v.code === expectedCode)).toBe(true);
      for (const v of violations) {
        expect(v.path.startsWith("/")).toBe(true);
        expect(v.message.length).toBeGreaterThan(0);
      }
    },
  );

  it("registers exactly the seven documented invariants", () => {
    expect(ALL_INVARIANTS.map((i) => i.name).sort()).toEqual(
      [
        "dormancy-satisfiable",
        "fraud-rate-bounds",
        "imperfection-bounds",
        "reference-integrity",
        "scale-envelope",
        "seasonality-window",
        "weights-sum",
      ].sort(),
    );
  });
});
