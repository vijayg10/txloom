import { expect, test } from "@playwright/test";
import { TxLoomUi } from "../src/ui.js";
import { TxLoomMcpClient } from "../src/mcp-client.js";
import fixture from "../fixtures/tiny-scenario.json" with { type: "json" };

// US3 (P3): an agent driving TxLoom purely through /mcp reaches the same
// outcomes as the UI flow (FR-006, constitution Principle IV). Establishes
// its own UI baseline in beforeAll (not dependent on US1) so this story
// remains independently runnable via --grep @us3 against a fresh stack.

let baselineRunId = "";
let baselineSeed = 0;
let baselineEventCount = 0;
let baselineTruthCount = 0;
let mcpRunId = "";

test.describe.configure({ mode: "default" });

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  const ui = new TxLoomUi(page);
  const { runId } = await ui.authorValidateSaveLaunch(fixture, {
    scenarioName: `e2e-us3-baseline-${Date.now()}`,
    currency: fixture.currency,
  });
  baselineRunId = runId;

  const seedText = await page.getByTestId("run-record-seed").textContent();
  baselineSeed = Number((seedText ?? "0").trim());

  await ui.openReport(runId);
  const countText = await page.getByTestId("realism-report-event-count").textContent();
  baselineEventCount = Number((countText ?? "0").replace(/[^\d]/g, ""));

  await ui.openGroundTruth(runId);
  const table = page.getByTestId("ground-truth-events-table");
  await table.waitFor();
  baselineTruthCount = await table.locator("tbody tr").count();

  await page.close();
});

test("validate_spec via MCP matches the UI validation result @us3", async () => {
  expect(baselineRunId).not.toBe("");
  const mcp = new TxLoomMcpClient();
  await mcp.connect();
  try {
    const result = await mcp.validateSpec(fixture);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  } finally {
    await mcp.close();
  }
});

test("launch + complete a run via MCP reaches completed with equivalent output @us3", async () => {
  const mcp = new TxLoomMcpClient();
  await mcp.connect();
  try {
    const scenario = await mcp.createScenario({
      name: `e2e-us3-mcp-${Date.now()}`,
      currency: fixture.currency,
    });
    await mcp.saveSpecVersion(scenario.id, fixture);
    // Same seed as the UI baseline (research.md: same seed+spec is
    // byte-identical by construction) turns "equivalent output" into an
    // exact, checkable claim rather than a fuzzy scale comparison.
    const run = await mcp.launchRun(scenario.id, { seed: baselineSeed });
    mcpRunId = run.id;

    await expect
      .poll(async () => (await mcp.getRunStatus(run.id)).status, { timeout: 60_000 })
      .toBe("completed");

    const report = await mcp.getRealismReport(run.id);
    expect(report.event_count).toBe(baselineEventCount);
  } finally {
    await mcp.close();
  }
});

test("ground truth and realism report via MCP match the UI baseline @us3", async () => {
  expect(mcpRunId).not.toBe("");
  const mcp = new TxLoomMcpClient();
  await mcp.connect();
  try {
    const report = await mcp.getRealismReport(mcpRunId);
    expect(report.event_count).toBe(baselineEventCount);

    const truth = await mcp.getTruthEvents(mcpRunId);
    expect(truth.events.length).toBe(baselineTruthCount);
  } finally {
    await mcp.close();
  }
});
