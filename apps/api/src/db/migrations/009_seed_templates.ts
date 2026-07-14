import type { Knex } from "knex";
import { WORKED_EXAMPLES } from "@txloom/agent-tools";

/**
 * Seeds the four gallery templates (FR-006/007) from the same worked-example
 * specs the agent-authoring docs already publish (packages/agent-tools) — one
 * source for both the human template gallery and the agent-facing examples.
 *
 * `benchmark_refs` are illustrative reference aggregates for the realism
 * report's achieved-vs-reference comparison (D17) — clearly labeled as
 * illustrative rather than attributed to a specific external report, since
 * v1 ships no sourced third-party dataset to cite.
 */
const BENCHMARK_REFS: Record<string, Record<string, unknown>> = {
  "upi-instant-payments": {
    note: "Illustrative reference range for UPI-style instant payments — not derived from a specific external report.",
    avg_ticket_size: { currency: "INR", low: 200, high: 900 },
    daily_transactions_per_active_user: { low: 1.5, high: 4 },
  },
  "card-present-retail": {
    note: "Illustrative reference range for US card-present retail — not derived from a specific external report.",
    avg_ticket_size: { currency: "USD", low: 35, high: 90 },
    daily_transactions_per_active_user: { low: 0.8, high: 2.5 },
  },
  "mobile-money": {
    note: "Illustrative reference range for mobile-money wallets — not derived from a specific external report.",
    avg_ticket_size: { currency: "INR", low: 150, high: 700 },
    daily_transactions_per_active_user: { low: 1, high: 3 },
  },
  "marketplace-payouts": {
    note: "Illustrative reference range for marketplace buyer/seller flows — not derived from a specific external report.",
    avg_ticket_size: { currency: "USD", low: 40, high: 150 },
    daily_transactions_per_active_user: { low: 0.3, high: 1 },
  },
};

const DESCRIPTIONS: Record<string, string> = {
  "upi-instant-payments":
    "India-style instant payments over UPI: salaried + gig-worker consumers, seasonality around Diwali, all three fraud typologies, streamed to Kafka.",
  "card-present-retail":
    "US point-of-sale swipe/tap retail: regular and frequent shoppers, Black Friday seasonality, card-testing and refund-abuse fraud, delivered as Parquet files.",
  "mobile-money":
    "Mobile-money wallets: top-ups, P2P transfers, and bill pay for wallet and agent-banking customers, account-takeover fraud, delivered over a webhook.",
  "marketplace-payouts":
    "Marketplace buyer payments and seller payouts: holiday-shopping seasonality, refund-abuse fraud, delivered as CSV files.",
};

export async function up(knex: Knex): Promise<void> {
  await knex("templates").insert(
    WORKED_EXAMPLES.map(({ template_slug, name, spec }) => ({
      slug: template_slug,
      name,
      description: DESCRIPTIONS[template_slug] ?? name,
      spec: JSON.stringify(spec),
      benchmark_refs: JSON.stringify(BENCHMARK_REFS[template_slug] ?? {}),
    })),
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex("templates")
    .whereIn(
      "slug",
      WORKED_EXAMPLES.map((e) => e.template_slug),
    )
    .delete();
}
