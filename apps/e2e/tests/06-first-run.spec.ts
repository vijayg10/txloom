import { expect, test } from "@playwright/test";
import { KafkaTestConsumer } from "../src/kafka-consumer.js";

// US8 (P3, SC-001): on a fresh install with the bundled demo broker, two clicks (open the app,
// press the card's button) put events on a topic. The card exists only while there are no
// scenarios, so this story needs an empty stack: run it on its own with
//   pnpm test:e2e --grep @first-run
// (the suite's other stories create scenarios and would skip it).
test("first run: one button puts events on txloom.events @first-run", async ({ page, request }) => {
  const scenarios = await request.get("/api/v1/scenarios");
  const existing = ((await scenarios.json()) as { scenarios: unknown[] }).scenarios.length;
  test.skip(existing > 0, "needs a fresh install: run with --grep @first-run");
  test.setTimeout(300_000); // history generation, then live, on a cold stack

  const consumer = new KafkaTestConsumer();
  await consumer.start("txloom.events");
  try {
    await page.goto("/");
    await expect(page.getByTestId("first-run-card")).toBeVisible();
    await page.getByTestId("first-run-start").click();

    // The click lands on the new run's Live tab, with no other page visited.
    await expect(page).toHaveURL(/\/runs\/[^/?]+\/live$/, { timeout: 30_000 });
    await expect(page.getByTestId("run-tab-live")).toBeVisible();
    await expect(page.getByTestId("run-title")).toContainText("UPI");

    // History generates, then the worker starts live by itself and the events land on the topic.
    await expect
      .poll(() => consumer.received.length, { timeout: 180_000, intervals: [2_000] })
      .toBeGreaterThan(0);
    await expect(page.getByTestId("stream-console")).toBeVisible({ timeout: 60_000 });
  } finally {
    await consumer.stop();
  }
});
