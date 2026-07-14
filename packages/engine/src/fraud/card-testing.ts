import type { CardTestingParams } from "@txloom/spec";
import type { Rng } from "../rng.js";
import { randInt } from "../distributions.js";
import type { FraudEventDraft } from "./types.js";

/** A burst of small-amount payment probes within a short window — the classic
 * card-testing pattern (a fraudster validates a stolen card with tiny charges
 * before a larger one). */
export function generateCardTestingBurst(params: CardTestingParams, rng: Rng): FraudEventDraft[] {
  const burstSize = randInt(rng, params.burst_size_min, params.burst_size_max + 1);
  const windowMs = params.burst_window_minutes * 60_000;
  const amountSpread = params.amount_max - params.amount_min;

  const drafts: FraudEventDraft[] = Array.from({ length: burstSize }, (_, step) => ({
    offsetMs: Math.round(rng.nextFloat() * windowMs),
    amount: Math.round((params.amount_min + rng.nextFloat() * amountSpread) * 100) / 100,
    campaignStep: step,
    type: "payment",
  }));

  return drafts
    .sort((a, b) => a.offsetMs - b.offsetMs)
    .map((draft, step) => ({ ...draft, campaignStep: step }));
}
