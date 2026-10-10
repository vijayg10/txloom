import { expect, type Page } from "@playwright/test";

/** Role/text-first locator helpers keyed to the `data-testid`s added across
 * the six surfaces (research.md R7) — one group per surface, so every spec
 * file drives the rendered SPA the same way a real user would (FR-002). */
export interface UiDestination {
  /** The spec sink's name. */
  sink: string;
  /** The saved connection's name, as shown in the destination picker. */
  connection: string;
  /** Kafka topic or RabbitMQ routing key override (defaults to the connection's). */
  target?: string;
}

export type UiConnection =
  | { type: "kafka"; name: string; bootstrap: string; topic: string }
  | { type: "rabbitmq"; name: string; host: string; exchange: string; routingKey: string }
  | { type: "webhook"; name: string; url: string };

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
    opts: {
      scenarioName: string;
      currency: string;
      destinations?: UiDestination[];
      replayHistory?: boolean;
    },
  ): Promise<{ scenarioId: string; runId: string }> {
    const scenarioId = await this.createBlankScenario(opts.scenarioName, opts.currency);
    await this.openScenario(scenarioId);
    await this.authorSpec(spec);
    await this.waitForValid();
    await this.saveSpecVersion();
    const runId = await this.launchRunFromScenario(
      scenarioId,
      opts.destinations,
      opts.replayHistory,
    );
    await this.openRun(runId);
    await this.waitForRunStatus("completed", 120_000);
    return { scenarioId, runId };
  }

  // ---- Run control -------------------------------------------------------

  async launchRunFromScenario(
    scenarioId: string,
    destinations: UiDestination[] = [],
    replayHistory = false,
  ): Promise<string> {
    await this.page.goto(`/runs?scenario=${scenarioId}`);
    for (const destination of destinations) {
      await this.page
        .getByTestId(`launch-destination-${destination.sink}`)
        .selectOption({ label: destination.connection });
      if (destination.target !== undefined) {
        await this.page.getByTestId(`launch-topic-${destination.sink}`).fill(destination.target);
      }
    }
    if (replayHistory) await this.page.getByTestId("launch-replay-history").click();
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

  /** Starts the stream into the destinations the run was launched with. */
  async startStream(runId: string, targetTps?: number): Promise<void> {
    await this.page.goto(`/stream/${runId}`);
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

  // ---- Connections -----------------------------------------------------

  async createConnection(input: UiConnection): Promise<void> {
    await this.page.goto("/connections");
    await this.page.getByTestId("connection-add").click();
    await this.page.getByTestId(`connection-type-${input.type}`).click();
    await this.page.getByTestId("conn-name").fill(input.name);
    if (input.type === "kafka") {
      await this.page.getByTestId("conn-bootstrap").fill(input.bootstrap);
      await this.page.getByTestId("conn-default-topic").fill(input.topic);
    } else if (input.type === "rabbitmq") {
      await this.page.getByTestId("conn-host").fill(input.host);
      await this.page.getByTestId("conn-exchange").fill(input.exchange);
      await this.page.getByTestId("conn-routing-key").fill(input.routingKey);
    } else {
      await this.page.getByTestId("conn-url").fill(input.url);
    }
    await this.page.getByTestId("conn-save").click();
    await expect(this.page.getByTestId(`connection-card-${input.name}`)).toBeVisible();
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
