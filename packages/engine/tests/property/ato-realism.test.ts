import { describe, expect, it } from "vitest";
import type { SimulationSpec } from "@txloom/spec";
import { generateMerchantPool, initPartitionWorld, planDay, simulateDay } from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

const DAY_MS = 86_400_000;

/** Kolmogorov–Smirnov statistic of integer samples against a uniform distribution over the
 * integers `[low, high)`. */
function ksUniform(samples: number[], low: number, high: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const span = high - low;
  let worst = 0;
  sorted.forEach((value, i) => {
    const below = (value - low) / span; // F just below `value`
    const at = (value - low + 1) / span; // F at `value`
    worst = Math.max(
      worst,
      Math.abs((i + 1) / sorted.length - at),
      Math.abs(i / sorted.length - below),
    );
  });
  return worst;
}

/** The two-sided critical value at α = 0.01: 1.63 / √n. */
const ksCritical = (n: number) => 1.63 / Math.sqrt(n);

function atoSpec(): SimulationSpec {
  const spec = structuredClone(referenceScenarioSpec());
  spec.clock.days = 40;
  spec.population.consumers.count = 4000;
  spec.fraud = {
    target_rate: 0.2,
    typologies: [
      { type: "account_takeover", share: 1, params: { dormancy_days: 5, drain_step_count: 3 } },
    ],
  };
  return spec;
}

describe("account-takeover realism", () => {
  it("staggers anchor days uniformly over the remaining horizon (KS, α = 0.01, 200 campaigns)", () => {
    const spec = atoSpec();
    const seed = BigInt(spec.seed);
    const world = initPartitionWorld(spec, seed, 0, 1, generateMerchantPool(spec, seed));
    // One planning day owing many campaigns: each draws its anchor from [dormancy, horizon).
    planDay(world, 0, spec.population.consumers.count * 2.4);

    const firstByActor = new Map<string, number>();
    for (const event of world.pendingFraud.toArray()) {
      if (event.typology !== "account_takeover") continue;
      const known = firstByActor.get(event.actorId);
      if (known === undefined || event.atMs < known) firstByActor.set(event.actorId, event.atMs);
    }
    const clockStartMs = Date.parse(`${spec.clock.start}T00:00:00.000Z`);
    // The heap holds them by time, so take the first 200 campaigns as they were planned.
    const planned = [...firstByActor.entries()]
      .sort((a, b) => Number(a[0].split("_").pop()) - Number(b[0].split("_").pop()))
      .slice(0, 200);
    const anchorDays = planned.map(([, atMs]) => Math.floor((atMs - clockStartMs) / DAY_MS));
    expect(anchorDays).toHaveLength(200);

    const dormancy = 5;
    expect(Math.min(...anchorDays)).toBeGreaterThanOrEqual(dormancy);
    expect(Math.max(...anchorDays)).toBeLessThan(spec.clock.days);
    expect(ksUniform(anchorDays, dormancy, spec.clock.days)).toBeLessThan(ksCritical(200));
  });

  it("the KS check rejects clustered anchors", () => {
    const clustered = Array.from({ length: 200 }, (_, i) => 5 + (i % 4));
    expect(ksUniform(clustered, 5, 40)).toBeGreaterThan(ksCritical(200));
  });

  it("no victim has a legitimate payment or income credit while it is dormant", () => {
    const spec = atoSpec();
    spec.population.consumers.count = 600;
    const seed = BigInt(spec.seed);
    const world = initPartitionWorld(spec, seed, 0, 1, generateMerchantPool(spec, seed));
    let victims = 0;
    for (let day = 0; day < spec.clock.days; day++) {
      const output = simulateDay(world, day);
      // A victim is marked dormant when its campaign is planned, at the start of the day, and
      // stays so until the takeover.
      const dormant = new Map(
        world.consumers
          .filter((c) => c.dormantUntilMs !== null)
          .map((c) => [c.id, c.dormantUntilMs!]),
      );
      victims = Math.max(victims, dormant.size);
      output.events.forEach((event, i) => {
        if (output.labels[i]!.is_fraud) return;
        if (event.type !== "payment" && event.type !== "income_credit") return;
        const until = dormant.get(event.consumer_id);
        if (until === undefined) return;
        expect(Date.parse(event.ts)).toBeGreaterThanOrEqual(until);
      });
    }
    expect(victims).toBeGreaterThan(20);
  });

  it("dormant victims go quiet: a consumer's legitimate volume drops while dormant", () => {
    const spec = atoSpec();
    spec.population.consumers.count = 600;
    const seed = BigInt(spec.seed);
    const world = initPartitionWorld(spec, seed, 0, 1, generateMerchantPool(spec, seed));
    let dormantDays = 0;
    let dormantEvents = 0;
    let activeDays = 0;
    let activeEvents = 0;
    for (let day = 0; day < spec.clock.days; day++) {
      const output = simulateDay(world, day);
      const dormantIds = new Set(
        world.consumers.filter((c) => c.dormantUntilMs !== null).map((c) => c.id),
      );
      const perConsumer = new Map<string, number>();
      output.events.forEach((event, i) => {
        if (output.labels[i]!.is_fraud) return;
        perConsumer.set(event.consumer_id, (perConsumer.get(event.consumer_id) ?? 0) + 1);
      });
      for (const consumer of world.consumers) {
        const count = perConsumer.get(consumer.id) ?? 0;
        if (dormantIds.has(consumer.id)) {
          dormantDays++;
          dormantEvents += count;
        } else {
          activeDays++;
          activeEvents += count;
        }
      }
    }
    expect(dormantDays).toBeGreaterThan(500);
    // A dormant consumer-day can still show events before its takeover time on the anchor day,
    // but on the whole it is near silent against an ordinary one.
    expect(dormantEvents / dormantDays).toBeLessThan((activeEvents / activeDays) * 0.2);
  });
});
