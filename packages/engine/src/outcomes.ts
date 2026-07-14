import type { OutcomesConfig } from "@txloom/spec";
import type { Rng } from "./rng.js";
import type { EventStatus } from "./types.js";

/** Ordinary legitimate-traffic outcome: baseline decline rate, everything else approved. */
export function drawLegitOutcome(outcomes: OutcomesConfig, rng: Rng): EventStatus {
  return rng.nextFloat() < outcomes.baseline_decline_rate ? "declined" : "approved";
}

/** Card-testing probes are mostly declined by construction — that's what makes them
 * probes; a late-burst step is more likely to be the one that succeeds. */
export function drawCardTestingOutcome(rng: Rng, isLastStep: boolean): EventStatus {
  const approveChance = isLastStep ? 0.6 : 0.15;
  return rng.nextFloat() < approveChance ? "approved" : "declined";
}

/** Drain-script transfers mostly succeed — the account has already been taken over. */
export function drawAccountTakeoverOutcome(rng: Rng): EventStatus {
  return rng.nextFloat() < 0.85 ? "approved" : "declined";
}
