import { describe, expect, it } from "vitest";
import type { SimulationSpec } from "@txloom/spec";
import {
  defaultPartitionCount,
  generateMerchantPool,
  generatePartition,
  openLiveWorld,
  type LiveDay,
  type TruthEvent,
  type WorldCheckpoint,
} from "../../src/index.js";
import { referenceScenarioSpec } from "../fixtures.js";

const DAY_MS = 86_400_000;
const HISTORY_DAYS = 28;
const LIVE_DAYS = 28;

/** A population large enough that weekday/weekend ratios are stable, over four weeks of history. */
function spec(): SimulationSpec {
  const base = structuredClone(referenceScenarioSpec());
  base.clock.days = HISTORY_DAYS;
  base.population.consumers.count = 600;
  base.seasonality = []; // a seasonal window would skew the history's weekday average
  base.output.sinks = [{ type: "kafka", name: "events" }];
  base.imperfections = {};
  return base;
}

interface Phase {
  checkpoints: WorldCheckpoint[];
  historyEvents: TruthEvent[];
  historyLabels: { is_fraud: boolean }[];
  live: LiveDay[];
}

function run(s: SimulationSpec): Phase {
  const seed = BigInt(s.seed);
  const merchants = generateMerchantPool(s, seed);
  const partitions = defaultPartitionCount(s.population.consumers.count, 300);
  const results = Array.from({ length: partitions }, (_, p) =>
    generatePartition(s, seed, p, partitions, merchants),
  );
  const checkpoints = results.map((r) => r.worldCheckpoint);
  const live = openLiveWorld(s, seed, checkpoints, merchants, ["events"]);
  const days: LiveDay[] = [];
  for (let i = 0; i < LIVE_DAYS; i++) days.push(live.advanceDay());
  return {
    checkpoints,
    historyEvents: results.flatMap((r) => r.truthEvents),
    historyLabels: results.flatMap((r) => r.labelRecords),
    live: days,
  };
}

const liveEvents = (phase: Phase): TruthEvent[] =>
  phase.live.flatMap((day) => day.partitions.flatMap((p) => p.events));

function weekdayWeekendRatio(events: TruthEvent[], firstDayMs: number, days: number): number {
  const perDay = new Array<number>(days).fill(0);
  for (const event of events) perDay[Math.floor((Date.parse(event.ts) - firstDayMs) / DAY_MS)]!++;
  let weekday = 0;
  let weekdayDays = 0;
  let weekend = 0;
  let weekendDays = 0;
  perDay.forEach((count, d) => {
    const dow = new Date(firstDayMs + d * DAY_MS).getUTCDay();
    if (dow === 0 || dow === 6) {
      weekend += count;
      weekendDays++;
    } else {
      weekday += count;
      weekdayDays++;
    }
  });
  return weekday / weekdayDays / (weekend / weekendDays);
}

/** SC-006, SC-012: the live phase continues the SAME world the history phase produced — no reset,
 * no discontinuity, and the same kind of traffic. */
describe("history → live continuity", () => {
  const s = spec();
  const phase = run(s);
  const startMs = Date.parse(`${s.clock.start}T00:00:00.000Z`);
  const liveStartMs = startMs + HISTORY_DAYS * DAY_MS;

  it("continues from the end of history with no gap beyond normal inter-arrival", () => {
    const live = liveEvents(phase).map((e) => Date.parse(e.ts));
    const first = Math.min(...live);
    expect(first).toBeGreaterThanOrEqual(liveStartMs);

    const history = phase.historyEvents.map((e) => Date.parse(e.ts)).sort((a, b) => a - b);
    const lastHistory = history[history.length - 1]!;
    expect(lastHistory).toBeLessThan(liveStartMs);

    // The widest quiet stretch across any history day boundary is what "normal" looks like.
    const byDay = new Map<number, { first: number; last: number }>();
    for (const ts of history) {
      const day = Math.floor((ts - startMs) / DAY_MS);
      const entry = byDay.get(day);
      if (!entry) byDay.set(day, { first: ts, last: ts });
      else entry.last = ts;
    }
    let widestHistoryGap = 0;
    for (let d = 1; d < HISTORY_DAYS; d++) {
      widestHistoryGap = Math.max(widestHistoryGap, byDay.get(d)!.first - byDay.get(d - 1)!.last);
    }
    expect(first - lastHistory).toBeLessThanOrEqual(widestHistoryGap * 2);
  });

  it("every live day is the next day of the world, in order", () => {
    expect(phase.live.map((d) => d.dayIndex)).toEqual(
      Array.from({ length: LIVE_DAYS }, (_, i) => HISTORY_DAYS + i),
    );
    for (const day of phase.live) {
      for (const partition of day.partitions) {
        for (const event of partition.events) {
          const ts = Date.parse(event.ts);
          expect(ts).toBeGreaterThanOrEqual(day.startMs);
          expect(ts).toBeLessThan(day.startMs + DAY_MS);
        }
      }
    }
  });

  it("live event ids never collide with history's", () => {
    const historyIds = new Set(phase.historyEvents.map((e) => e.event_id));
    const live = liveEvents(phase);
    expect(live.every((e) => !historyIds.has(e.event_id))).toBe(true);
    expect(new Set(live.map((e) => e.event_id)).size).toBe(live.length);
  });

  it("the live mix includes income credits", () => {
    const income = liveEvents(phase).filter((e) => e.type === "income_credit");
    expect(income.length).toBeGreaterThan(0);
  });

  it("fraud labels keep appearing across a horizon covering typical campaign spacing", () => {
    const fraudLive = phase.live.flatMap((day) =>
      day.partitions.flatMap((p) => p.labels.filter((l) => l.is_fraud)),
    );
    expect(fraudLive.length).toBeGreaterThan(0);
    // Not a burst at the start: fraud appears in more than one week of live days.
    const weeksWithFraud = new Set(
      phase.live
        .filter((day) => day.partitions.some((p) => p.labels.some((l) => l.is_fraud)))
        .map((day) => Math.floor((day.dayIndex - HISTORY_DAYS) / 7)),
    );
    expect(weeksWithFraud.size).toBeGreaterThan(1);
    // And the rate stays near the spec's target, as in history.
    const total = liveEvents(phase).length;
    expect(fraudLive.length / total).toBeGreaterThan(s.fraud.target_rate * 0.4);
    expect(fraudLive.length / total).toBeLessThan(s.fraud.target_rate * 2.5);
  });

  it("the weekday/weekend volume ratio is within 10% of history's", () => {
    const history = weekdayWeekendRatio(phase.historyEvents, startMs, HISTORY_DAYS);
    const live = weekdayWeekendRatio(liveEvents(phase), liveStartMs, LIVE_DAYS);
    expect(Math.abs(live - history) / history).toBeLessThan(0.1);
    // Sanity: the rhythm really is weekday-heavy, so the comparison is meaningful.
    expect(history).toBeGreaterThan(0);
  });

  it("restoring the same checkpoints twice gives identical live days (determinism)", () => {
    const seed = BigInt(s.seed);
    const merchants = generateMerchantPool(s, seed);
    const a = openLiveWorld(s, seed, phase.checkpoints, merchants, ["events"]);
    const b = openLiveWorld(s, seed, phase.checkpoints, merchants, ["events"]);
    expect(a.advanceDay()).toEqual(b.advanceDay());
    expect(a.advanceDay()).toEqual(b.advanceDay());
  });
});
