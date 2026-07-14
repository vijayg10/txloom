import type { AccountTakeoverParams } from "@txloom/spec";
import type { Rng } from "../rng.js";
import type { FraudEventDraft } from "./types.js";

const STEP_GAP_MS = 15 * 60_000;
const STEP_JITTER_MS = 5 * 60_000;

/** Multi-step P2P-drain script that fires once the dormancy precondition is
 * satisfied (checked by the orchestrator against clock.days, mirroring the
 * dormancy-satisfiable invariant) — credential change followed by a sequence
 * of draining transfers. */
export function generateAccountTakeoverScript(
  params: AccountTakeoverParams,
  rng: Rng,
): FraudEventDraft[] {
  return Array.from({ length: params.drain_step_count }, (_, step) => ({
    offsetMs: step * STEP_GAP_MS + Math.round(rng.nextFloat() * STEP_JITTER_MS),
    amount: Math.round((500 + rng.nextFloat() * 4500) * 100) / 100,
    campaignStep: step,
    type: "p2p_transfer",
  }));
}
