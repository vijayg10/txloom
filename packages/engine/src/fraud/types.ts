/** One fraud event within a campaign, relative to the campaign's start instant —
 * the orchestrator (fraud/orchestrator.ts) anchors `offsetMs` to an actual
 * virtual-clock timestamp and turns this into a full TruthEvent. */
export interface FraudEventDraft {
  offsetMs: number;
  amount: number;
  campaignStep: number;
  type: "payment" | "p2p_transfer" | "refund";
  /** True for refund_abuse drafts that mark an existing legit event as refunded
   * rather than minting a new event. */
  refundsPriorStep?: boolean;
}
