import { describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WORKED_EXAMPLES } from "@txloom/agent-tools";
import type { InvariantViolation } from "@txloom/spec";

/**
 * Agent-convergence eval harness (SC-009): drives a corpus of plain-English
 * scenario descriptions through a real MCP client against
 * validate_spec/save_spec_version, and reports the percentage that converge
 * to a valid spec without human hand-editing — gated against the documented
 * 90% bar.
 *
 * `ScenarioProposer` is the pluggable seam where a real AI agent goes: given
 * a plain-English description and (on repair iterations) the prior
 * violations, it returns a candidate spec document. This file ships a
 * deterministic reference proposer so the harness itself is verifiable in
 * CI without API keys; wire a real LLM-backed proposer in to measure actual
 * SC-009 convergence.
 */
export interface CorpusItem {
  template_slug: string;
  description: string;
}

export type ScenarioProposer = (
  description: string,
  priorViolations: InvariantViolation[] | null,
) => Promise<unknown>;

export interface ConvergenceResult {
  description: string;
  converged: boolean;
  iterations: number;
}

const MAX_REPAIR_ITERATIONS = 3;

/** Corpus scoped to the four gallery templates (T126a). */
export const CONVERGENCE_CORPUS: readonly CorpusItem[] = [
  {
    template_slug: "upi-instant-payments",
    description:
      "A UPI-style instant payments scenario for India with salaried and gig-worker consumers, card-testing and account-takeover fraud, and a Diwali seasonality spike.",
  },
  {
    template_slug: "card-present-retail",
    description:
      "A US card-present retail scenario with grocery, apparel, and fuel merchants, a Black Friday spike, and card-testing fraud.",
  },
  {
    template_slug: "mobile-money",
    description:
      "A mobile-money scenario with wallet top-ups and airtime purchases, targeting account-takeover fraud after a dormancy period.",
  },
  {
    template_slug: "marketplace-payouts",
    description:
      "A marketplace payouts scenario with buyers and power sellers, refund-abuse fraud, and a holiday shopping seasonality spike.",
  },
];

/** Runs one corpus item through propose → validate → (repair → validate)*
 * against the real MCP server, exactly the loop an external agent runs. */
export async function runConvergenceItem(
  client: Client,
  item: CorpusItem,
  proposer: ScenarioProposer,
): Promise<ConvergenceResult> {
  let priorViolations: InvariantViolation[] | null = null;

  for (let iteration = 1; iteration <= MAX_REPAIR_ITERATIONS; iteration++) {
    const candidate = await proposer(item.description, priorViolations);
    const result = await client.callTool({ name: "validate_spec", arguments: { spec: candidate } });
    const body = JSON.parse((result.content as { text: string }[])[0]!.text) as {
      valid: boolean;
      violations: InvariantViolation[];
    };
    if (body.valid) {
      return { description: item.description, converged: true, iterations: iteration };
    }
    priorViolations = body.violations;
  }

  return { description: item.description, converged: false, iterations: MAX_REPAIR_ITERATIONS };
}

export async function runConvergenceEval(
  client: Client,
  corpus: readonly CorpusItem[],
  proposer: ScenarioProposer,
): Promise<{ results: ConvergenceResult[]; convergenceRate: number }> {
  const results = await Promise.all(
    corpus.map((item) => runConvergenceItem(client, item, proposer)),
  );
  const convergenceRate = results.filter((r) => r.converged).length / results.length;
  return { results, convergenceRate };
}

/** Deterministic reference proposer — returns the matching worked example on
 * the first attempt (a stand-in for "an agent that already knows the
 * template"). Verifies harness mechanics only; it is not a measurement of a
 * real agent's SC-009 convergence rate. */
export const referenceProposer: ScenarioProposer = async (description) => {
  const item = CONVERGENCE_CORPUS.find((c) => description === c.description);
  const example = WORKED_EXAMPLES.find((w) => w.template_slug === item?.template_slug);
  if (!example) throw new Error(`No worked example for description: ${description}`);
  return example.spec;
};

describe("agent-convergence eval harness (reference proposer smoke check)", () => {
  it("harness mechanics converge for every corpus item using the reference proposer", async () => {
    // A minimal fake client satisfying just the callTool surface the harness
    // uses — exercises scoring/repair-loop logic without a live MCP server.
    const { validateSpec } = await import("@txloom/spec");
    const fakeClient = {
      callTool: async ({ arguments: args }: { arguments: { spec: unknown } }) => {
        const result = validateSpec(args.spec);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    } as unknown as Client;

    const { results, convergenceRate } = await runConvergenceEval(
      fakeClient,
      CONVERGENCE_CORPUS,
      referenceProposer,
    );

    expect(convergenceRate).toBe(1);
    for (const result of results) {
      expect(result.converged).toBe(true);
      expect(result.iterations).toBe(1);
    }
  });
});
