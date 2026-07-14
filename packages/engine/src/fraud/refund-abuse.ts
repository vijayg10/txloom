import type { RefundAbuseParams } from "@txloom/spec";
import type { Rng } from "../rng.js";
import type { FraudEventDraft } from "./types.js";

/** Refund-abuse fires against an *existing* legitimate purchase rather than
 * minting a new payment — the orchestrator picks a prior legit event and this
 * decides whether (and when, relative to it) a refund follows. */
export function maybeGenerateRefund(
  params: RefundAbuseParams,
  refundsSoFarForActor: number,
  purchaseAmount: number,
  rng: Rng,
): FraudEventDraft | null {
  if (refundsSoFarForActor >= params.max_refunds_per_actor) return null;
  if (rng.nextFloat() >= params.refund_rate) return null;

  return {
    offsetMs: Math.round((30 + rng.nextFloat() * 4 * 60) * 60_000), // 30min–4.5h after purchase
    amount: purchaseAmount,
    campaignStep: refundsSoFarForActor,
    type: "refund",
    refundsPriorStep: true,
  };
}
