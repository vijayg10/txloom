import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { SimulationSpec } from "@txloom/spec";
import { createApiClient, type LaunchDefaults } from "../src/api/client.js";
import { LaunchDrawer } from "../src/surfaces/scenario-workspace/launch-drawer.js";

const SCENARIO_ID = "scenario-upi-fraud";

// A kafka sink "events" and a file sink "archive", with a 14-day history.
const spec = {
  clock: { start: "2026-01-01", days: 14 },
  output: {
    sinks: [
      { type: "kafka", name: "events" },
      { type: "file", name: "archive", format: "parquet" },
    ],
    labels: "separate_export",
  },
} as unknown as SimulationSpec;

const NO_DESTINATIONS: LaunchDefaults = {
  destinations: [],
  mode: "history_only",
  target_tps: null,
  replay_history: false,
  label_channel: false,
};

function withDefaults(defaults: Partial<LaunchDefaults>): void {
  vi.spyOn(createApiClient(), "getLaunchDefaults").mockResolvedValue({
    ...NO_DESTINATIONS,
    ...defaults,
  });
}

function boundTo(connectionId: string, connectionName: string): LaunchDefaults["destinations"] {
  return [
    {
      sink: "events",
      connection_id: connectionId,
      connection_name: connectionName,
      connection_type: "kafka",
      connection_missing: false,
    },
  ];
}

function renderDrawer(onLaunched = vi.fn()) {
  render(
    <LaunchDrawer
      open
      onOpenChange={() => {}}
      scenarioId={SCENARIO_ID}
      spec={spec}
      onLaunched={onLaunched}
    />,
  );
  return onLaunched;
}

function select(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

/** The mock adapter (VITE_TXLOOM_MOCK=1) serves local-kafka, staging-msk and short-retention-kafka. */
describe("LaunchDrawer", () => {
  beforeAll(() => {
    vi.stubEnv("VITE_TXLOOM_MOCK", "1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows a row per spec sink", async () => {
    withDefaults({});
    renderDrawer();
    expect(await screen.findByTestId("launch-sink-row-events")).toBeTruthy();
    expect(screen.getByTestId("launch-sink-row-archive")).toBeTruthy();
    // Only the broker sink needs a destination.
    expect(screen.getByTestId("launch-destination-events")).toBeTruthy();
    expect(screen.queryByTestId("launch-destination-archive")).toBeNull();
  });

  it("preselects history-then-live when a Kafka destination is chosen", async () => {
    withDefaults({});
    renderDrawer();
    await screen.findByTestId("launch-sink-row-events");
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));
    expect((screen.getByTestId("launch-mode-history-only") as HTMLInputElement).checked).toBe(true);

    select("launch-destination-events", "conn-local-kafka");
    await waitFor(() =>
      expect(
        (screen.getByTestId("launch-mode-history-then-live") as HTMLInputElement).checked,
      ).toBe(true),
    );
  });

  it("blocks launch for an unbound broker sink, naming it", async () => {
    withDefaults({});
    const launchRun = vi.spyOn(createApiClient(), "launchRun");
    renderDrawer();
    const error = await screen.findByTestId("launch-error");
    expect(error.textContent).toContain("events");
    const submit = screen.getByTestId("launch-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(launchRun).not.toHaveBeenCalled();
  });

  it("launches with the chosen destinations, mode and rate", async () => {
    withDefaults({});
    const launchRun = vi.spyOn(createApiClient(), "launchRun");
    const onLaunched = renderDrawer();
    await screen.findByTestId("launch-sink-row-events");
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));
    select("launch-destination-events", "conn-local-kafka");
    fireEvent.change(screen.getByTestId("launch-rate"), { target: { value: "120" } });

    await waitFor(() =>
      expect((screen.getByTestId("launch-submit") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("launch-submit"));
    await waitFor(() => expect(onLaunched).toHaveBeenCalled());
    expect(launchRun).toHaveBeenCalledWith(
      SCENARIO_ID,
      expect.objectContaining({
        mode: "history_then_live",
        target_tps: 120,
        destinations: [
          expect.objectContaining({ sink: "events", connection_id: "conn-local-kafka" }),
        ],
      }),
    );
  });

  it("selects a newly created connection and keeps every other field", async () => {
    withDefaults({});
    renderDrawer();
    await screen.findByTestId("launch-sink-row-events");
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));

    fireEvent.change(screen.getByTestId("launch-rate"), { target: { value: "77" } });
    fireEvent.click(screen.getByTestId("launch-advanced"));
    fireEvent.change(screen.getByTestId("launch-seed"), { target: { value: "4242" } });

    select("launch-destination-events", "__new__");
    const nested = await screen.findByTestId("launch-new-connection-drawer");
    fireEvent.change(within(nested).getByTestId("conn-name"), { target: { value: "fresh-kafka" } });
    fireEvent.change(within(nested).getByTestId("conn-bootstrap"), {
      target: { value: "broker.example.com:9092" },
    });
    fireEvent.change(within(nested).getByTestId("conn-default-topic"), {
      target: { value: "fresh.events" },
    });
    fireEvent.click(within(nested).getByTestId("conn-save"));

    await waitFor(() => expect(screen.queryByTestId("launch-new-connection-drawer")).toBeNull());
    const picked = screen.getByTestId("launch-destination-events") as HTMLSelectElement;
    expect(picked.selectedOptions[0]?.textContent).toBe("fresh-kafka");
    expect((screen.getByTestId("launch-topic-events") as HTMLInputElement).value).toBe(
      "fresh.events",
    );
    expect((screen.getByTestId("launch-rate") as HTMLInputElement).value).toBe("77");
    expect((screen.getByTestId("launch-seed") as HTMLInputElement).value).toBe("4242");
  });

  it("prefills from the scenario's launch defaults", async () => {
    withDefaults({
      destinations: boundTo("conn-local-kafka", "local-kafka"),
      mode: "history_then_live",
      target_tps: 120,
      replay_history: true,
      label_channel: true,
    });
    renderDrawer();
    await waitFor(() =>
      expect((screen.getByTestId("launch-rate") as HTMLInputElement).value).toBe("120"),
    );
    expect((screen.getByTestId("launch-mode-history-then-live") as HTMLInputElement).checked).toBe(
      true,
    );
    await waitFor(() =>
      expect((screen.getByTestId("launch-destination-events") as HTMLSelectElement).value).toBe(
        "conn-local-kafka",
      ),
    );
    fireEvent.click(screen.getByTestId("launch-advanced"));
    expect(screen.getByTestId("launch-replay-history").getAttribute("data-state")).toBe("checked");
    expect(screen.getByTestId("launch-label-channel").getAttribute("data-state")).toBe("checked");
  });

  it("updates the estimate when replay is turned on", async () => {
    withDefaults({ destinations: boundTo("conn-local-kafka", "local-kafka") });
    renderDrawer();
    const estimate = await screen.findByTestId("launch-estimate");
    expect(estimate.textContent).not.toContain("replayed");

    fireEvent.click(screen.getByTestId("launch-advanced"));
    fireEvent.click(screen.getByTestId("launch-replay-history"));
    await waitFor(() =>
      expect(screen.getByTestId("launch-estimate").textContent).toContain("replayed"),
    );
  });

  describe("retention warning", () => {
    it("appears for a destination whose last test reported a shorter retention, and Launch stays enabled", async () => {
      withDefaults({
        destinations: boundTo("conn-short-retention", "short-retention-kafka"),
        replay_history: true,
        mode: "history_then_live",
      });
      renderDrawer();
      const warning = await screen.findByTestId("launch-warning-retention");
      expect(warning.textContent).toContain("short-retention-kafka");
      expect((screen.getByTestId("launch-submit") as HTMLButtonElement).disabled).toBe(false);
    });

    it("is absent when retention covers the history, or when replay is off", async () => {
      withDefaults({
        destinations: boundTo("conn-local-kafka", "local-kafka"),
        replay_history: true,
      });
      renderDrawer();
      await screen.findByTestId("launch-estimate");
      expect(screen.queryByTestId("launch-warning-retention")).toBeNull();

      cleanup();
      withDefaults({
        destinations: boundTo("conn-short-retention", "short-retention-kafka"),
        replay_history: false,
      });
      renderDrawer();
      await screen.findByTestId("launch-estimate");
      expect(screen.queryByTestId("launch-warning-retention")).toBeNull();
    });

    it("shows the API's own warning from the launch response", async () => {
      withDefaults({ destinations: boundTo("conn-local-kafka", "local-kafka") });
      vi.spyOn(createApiClient(), "launchRun").mockResolvedValue({
        id: "run-new",
        warnings: [
          {
            code: "retention_shorter_than_history",
            message: "Topic retention is shorter than the history.",
            details: { sink: "events" },
          },
        ],
      } as never);
      const onLaunched = renderDrawer();
      await waitFor(() =>
        expect((screen.getByTestId("launch-submit") as HTMLButtonElement).disabled).toBe(false),
      );
      fireEvent.click(screen.getByTestId("launch-submit"));
      await waitFor(() => expect(onLaunched).toHaveBeenCalled());
      expect(onLaunched.mock.calls[0]![0].warnings[0].code).toBe("retention_shorter_than_history");
    });
  });

  describe("local Kafka suggestion", () => {
    const suggestion = {
      kind: "local_kafka" as const,
      detail: "A Kafka broker is reachable at kafka:29092 (the bundled demo broker).",
      input: {
        type: "kafka" as const,
        name: "local-kafka-2",
        config: {
          bootstrap_servers: ["kafka:29092"],
          security_protocol: "PLAINTEXT" as const,
          default_topic: "txloom.events",
        },
      },
    };

    it("offers the detected broker for an unbound Kafka sink and binds it on accept", async () => {
      withDefaults({});
      vi.spyOn(createApiClient(), "getConnectionSuggestions").mockResolvedValue({
        suggestions: [suggestion],
      });
      renderDrawer();
      expect((await screen.findByTestId("local-kafka-suggestion")).textContent).toContain(
        "kafka:29092",
      );
      fireEvent.click(screen.getByTestId("local-kafka-add"));
      await waitFor(() => expect(screen.queryByTestId("local-kafka-suggestion")).toBeNull());
      await waitFor(() =>
        expect(
          (screen.getByTestId("launch-destination-events") as HTMLSelectElement).selectedOptions[0]
            ?.textContent,
        ).toBe("local-kafka-2"),
      );
    });

    it("does not offer it when every Kafka sink already has a destination", async () => {
      withDefaults({ destinations: boundTo("conn-local-kafka", "local-kafka") });
      vi.spyOn(createApiClient(), "getConnectionSuggestions").mockResolvedValue({
        suggestions: [suggestion],
      });
      renderDrawer();
      await screen.findByTestId("launch-estimate");
      expect(screen.queryByTestId("local-kafka-suggestion")).toBeNull();
    });
  });
});
