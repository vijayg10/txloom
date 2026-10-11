import { expect, test } from "@playwright/test";
import { TxLoomUi } from "../src/ui.js";
import fixture from "../fixtures/tiny-scenario.json" with { type: "json" };

// US1 (P1, MVP): author -> validate -> run -> inspect -> report -> export,
// entirely through the rendered SPA against the full stack (FR-002/003).
test("golden path via Web UI @us1", async ({ page }) => {
  const ui = new TxLoomUi(page);
  let scenarioId = "";
  let runId = "";

  await test.step("author the tiny fixture spec and validate with no errors", async () => {
    scenarioId = await ui.createBlankScenario(`e2e-us1-${Date.now()}`, fixture.currency);
    await ui.openScenario(scenarioId);
    await ui.authorSpec(fixture);
    await ui.waitForValid();
    expect(await ui.violationCount()).toBe(0);
    await ui.saveSpecVersion();
  });

  await test.step("launch a history-only run from the Launch drawer and watch it reach completed", async () => {
    // open → (no broker sinks, so no destinations to pick) → submit
    await page.goto(`/scenarios/${scenarioId}`);
    await expect(page.getByTestId("launch-open")).toBeEnabled();
    await page.getByTestId("launch-open").click();
    await expect(page.getByTestId("launch-drawer")).toBeVisible();
    await expect(page.getByTestId("launch-estimate")).toBeVisible();
    await page.getByTestId("launch-submit").click();
    await expect(page).toHaveURL(/\/runs\/[^/?]+\/progress$/);
    runId = /\/runs\/([^/?]+)\/progress$/.exec(page.url())![1]!;
    await ui.openRun(runId);
    await expect(page.getByTestId("run-progress")).toBeVisible({ timeout: 30_000 });
    await ui.waitForRunStatus("completed", 120_000);
  });

  await test.step("open Stream Console, World Inspector, and Ground Truth after completion", async () => {
    await page.goto(`/runs/${runId}/live`);
    await expect(page.getByTestId("stream-launcher")).toBeVisible();

    await ui.openInspector(runId);
    await expect(page.getByTestId("inspector-volume-chart")).toBeVisible();

    await ui.openGroundTruth(runId);
    await expect(page.getByTestId("ground-truth-events-table")).toBeVisible();
  });

  await test.step("open the realism report and assert it reflects the run", async () => {
    await ui.openReport(runId);
    await expect(page.getByTestId("realism-report")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("realism-report-event-count")).toBeVisible();
  });

  await test.step("trigger an export from the UI and assert the file is retrievable and non-empty", async () => {
    const { downloadHref } = await ui.triggerExport(runId, "json");
    const response = await page.request.get(downloadHref);
    expect(response.ok()).toBeTruthy();
    const body = await response.body();
    expect(body.byteLength).toBeGreaterThan(0);
  });
});
