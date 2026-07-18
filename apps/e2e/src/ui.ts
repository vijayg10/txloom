import { expect, type Page } from "@playwright/test";

/** Role/text-first locator helpers keyed to the `data-testid`s added across
 * the six surfaces (research.md R7) — one group per surface, so every spec
 * file drives the rendered SPA the same way a real user would (FR-002). */
export class TxLoomUi {
  constructor(private readonly page: Page) {}

  // ---- Scenario workspace ----------------------------------------------

  async createBlankScenario(name: string, currency: string): Promise<string> {
    await this.page.goto("/scenarios");
    await this.page.getByTestId("new-scenario-name").fill(name);
    await this.page.getByTestId("new-scenario-currency").fill(currency);
    await this.page.getByTestId("create-blank-scenario").click();
    // react-router's client-side navigate() updates history via pushState with
    // no "load" event, so poll the URL directly rather than page.waitForURL().
    await expect(this.page).toHaveURL(/\/scenarios\/[^/]+$/);
    const match = /\/scenarios\/([^/]+)$/.exec(this.page.url());
    if (!match) throw new Error(`unexpected URL after creating scenario: ${this.page.url()}`);
    return match[1]!;
  }

  async openScenario(scenarioId: string): Promise<void> {
    await this.page.goto(`/scenarios/${scenarioId}`);
    await this.page.getByTestId("spec-editor").locator(".monaco-editor").waitFor();
  }

  /** Replaces the Monaco editor's full content by setting the model value
   * directly. Keyboard-driven select-all+type is fragile here: focus doesn't
   * reliably land in Monaco's hidden textarea via a container click, and
   * `insertText`'s embedded newlines trigger cascading auto-indent. The
   * `@monaco-editor/react` package exposes the AMD `monaco` global on
   * `window`, and `setValue` still fires the `onDidChangeModelContent` event
   * SpecEditor's `onChange` relies on, so validation runs exactly as it
   * would for a real edit. */
  async authorSpec(spec: unknown): Promise<void> {
    await this.page.getByTestId("spec-editor").locator(".monaco-editor").waitFor();
    await this.page.evaluate(
      (text) => {
        interface MonacoGlobal {
          editor: { getModels(): { setValue(value: string): void }[] };
        }
        const monaco = (window as unknown as { monaco: MonacoGlobal }).monaco;
        const model = monaco.editor.getModels()[0];
        if (!model) throw new Error("no Monaco model found on the page");
        model.setValue(text);
      },
      JSON.stringify(spec, null, 2),
    );
  }

  async waitForValid(timeoutMs = 10_000): Promise<void> {
    await expect(this.page.getByTestId("validation-result-panel")).toHaveAttribute(
      "data-valid",
      "true",
      { timeout: timeoutMs },
    );
  }

  async violationCount(): Promise<number> {
    const list = this.page.getByTestId("spec-editor-violations");
    if (!(await list.isVisible().catch(() => false))) return 0;
    return list.locator("li").count();
  }

  async saveSpecVersion(): Promise<void> {
    await this.page.getByTestId("save-spec-version").click();
    await expect(this.page.getByTestId("save-spec-success")).toBeVisible();
  }

  /** Composite convenience spanning scenario-workspace + run-control, reused
   * by every story that needs a fresh completed run of the fixture spec. */
  async authorValidateSaveLaunch(
    spec: unknown,
    opts: { scenarioName: string; currency: string },
  ): Promise<{ scenarioId: string; runId: string }> {
    const scenarioId = await this.createBlankScenario(opts.scenarioName, opts.currency);
    await this.openScenario(scenarioId);
    await this.authorSpec(spec);
    await this.waitForValid();
    await this.saveSpecVersion();
    const runId = await this.launchRunFromScenario(scenarioId);
    await this.openRun(runId);
    await this.waitForRunStatus("completed", 120_000);
    return { scenarioId, runId };
  }

  // ---- Run control -------------------------------------------------------

  async launchRunFromScenario(scenarioId: string): Promise<string> {
    await this.page.goto(`/runs?scenario=${scenarioId}`);
    await this.page.getByTestId("launch-run-button").click();
    await expect(this.page.getByTestId("run-status")).toBeVisible();
    const href = await this.page.getByTestId("view-run-link").getAttribute("href");
    if (!href) throw new Error("launch result had no 'View run' link");
    const match = /\/runs\/([^/]+)$/.exec(href);
    if (!match) throw new Error(`unexpected run link href: ${href}`);
    return match[1]!;
  }

  async openRun(runId: string): Promise<void> {
    await this.page.goto(`/runs/${runId}`);
  }

  async waitForRunStatus(status: string, timeoutMs = 120_000): Promise<void> {
    await expect(this.page.getByTestId("run-status")).toContainText(status, { timeout: timeoutMs });
  }

  async waitForRunComplete(runId: string, timeoutMs = 120_000): Promise<void> {
    await this.openRun(runId);
    await this.waitForRunStatus("completed", timeoutMs);
  }

  // ---- Stream console ------------------------------------------------------

  async startStream(
    runId: string,
    sink:
      | { type: "webhook"; url: string }
      | { type: "kafka"; brokers: string; topic: string }
      | { type: "rabbitmq"; url: string; exchange: string; routingKey: string },
    targetTps?: number,
  ): Promise<void> {
    await this.page.goto(`/stream/${runId}`);
    await this.page.getByTestId("stream-sink-type").selectOption(sink.type);
    if (sink.type === "webhook") {
      await this.page.getByTestId("stream-webhook-url").fill(sink.url);
    } else if (sink.type === "kafka") {
      await this.page.getByTestId("stream-kafka-brokers").fill(sink.brokers);
      await this.page.getByTestId("stream-kafka-topic").fill(sink.topic);
    } else {
      await this.page.getByTestId("stream-rabbitmq-url").fill(sink.url);
      await this.page.getByTestId("stream-rabbitmq-exchange").fill(sink.exchange);
      await this.page.getByTestId("stream-rabbitmq-routing-key").fill(sink.routingKey);
    }
    if (targetTps !== undefined) {
      await this.page.getByTestId("stream-target-tps").fill(String(targetTps));
    }
    await this.page.getByTestId("stream-start-button").click();
    await this.page.getByTestId("stream-console").waitFor();
  }

  async stopStream(): Promise<void> {
    await this.page.getByTestId("stream-stop").click();
  }

  // ---- World inspector / ground truth --------------------------------------

  async openInspector(runId: string): Promise<void> {
    await this.page.goto(`/inspector/${runId}`);
    await this.page.getByTestId("inspector-volume-chart").waitFor();
  }

  async openReport(runId: string): Promise<void> {
    await this.page.goto(`/inspector/${runId}`);
    await this.page.getByTestId("inspector-realism-report").waitFor();
  }

  async openGroundTruth(runId: string): Promise<void> {
    await this.page.goto(`/ground-truth/${runId}`);
    await this.page.getByTestId("ground-truth-explorer").waitFor();
  }

  // ---- Settings / sink connections --------------------------------------

  async configureSink(input: {
    type: "file" | "kafka" | "rabbitmq" | "webhook";
    name: string;
    config: Record<string, unknown>;
    username?: string;
    password?: string;
  }): Promise<void> {
    await this.page.goto("/settings");
    await this.page.getByTestId("sink-type").selectOption(input.type);
    await this.page.getByTestId("sink-name").fill(input.name);
    await this.page.getByTestId("sink-config").fill(JSON.stringify(input.config));
    if (input.username) await this.page.getByTestId("sink-username").fill(input.username);
    if (input.password) await this.page.getByTestId("sink-password").fill(input.password);
    await this.page.getByTestId("add-sink-submit").click();
    await expect(this.page.getByTestId("sink-list")).toContainText(input.name);
  }

  // ---- Export ------------------------------------------------------------

  async triggerExport(
    runId: string,
    format: "csv" | "parquet" | "json",
    opts: { includeLabels?: boolean } = {},
  ): Promise<{ downloadHref: string; fileName: string }> {
    await this.openRun(runId);
    await this.page.getByTestId("export-format").selectOption(format);
    if (opts.includeLabels) {
      await this.page.getByTestId("export-include-labels").check();
      await this.page.getByTestId("export-acknowledge-warning").check();
    }
    await this.page.getByTestId("export-submit").click();
    const link = this.page.getByTestId("export-download-link");
    await link.waitFor();
    const href = await link.getAttribute("href");
    const text = await link.textContent();
    if (!href) throw new Error("export result had no download link");
    return { downloadHref: href, fileName: (text ?? "").replace(/^Download\s+/, "") };
  }
}
