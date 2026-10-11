import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { createApiClient } from "../src/api/client.js";
import { HomePage } from "../src/surfaces/home/index.js";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const cloned = {
  id: "scenario-new",
  name: "UPI fraud reference",
  current_version: { id: "v1", number: 1 },
  spec: { output: { sinks: [{ type: "kafka", name: "upi-stream" }] } },
};

// The mock adapter (VITE_TXLOOM_MOCK=1) serves the "local-kafka" connection.
describe("first-run card", () => {
  beforeAll(() => {
    vi.stubEnv("VITE_TXLOOM_MOCK", "1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("appears only when there are no scenarios", async () => {
    vi.spyOn(createApiClient(), "listScenarios").mockResolvedValue({ scenarios: [] });
    renderHome();
    expect(await screen.findByTestId("first-run-card")).toBeTruthy();
    expect(screen.getByTestId("first-run-start")).toBeTruthy();
  });

  it("redirects to the scenarios list once there is one", async () => {
    vi.spyOn(createApiClient(), "listScenarios").mockResolvedValue({
      scenarios: [{ id: "s1", name: "Mine" }],
    });
    renderHome();
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/scenarios"));
    expect(screen.queryByTestId("first-run-card")).toBeNull();
  });

  it("start clones the UPI template, then launches history-then-live to local-kafka", async () => {
    const client = createApiClient();
    vi.spyOn(client, "listScenarios").mockResolvedValue({ scenarios: [] });
    const clone = vi.spyOn(client, "cloneTemplate").mockResolvedValue(cloned as never);
    const launch = vi.spyOn(client, "launchRun").mockResolvedValue({ id: "run-first" } as never);
    renderHome();
    fireEvent.click(await screen.findByTestId("first-run-start"));

    await waitFor(() => expect(launch).toHaveBeenCalled());
    expect(clone).toHaveBeenCalledWith("upi-instant-payments", expect.any(String));
    expect(launch).toHaveBeenCalledWith(
      "scenario-new",
      expect.objectContaining({
        mode: "history_then_live",
        destinations: [{ sink: "upi-stream", connection_id: "conn-local-kafka" }],
      }),
    );
    // Clone happens before launch.
    expect(clone.mock.invocationCallOrder[0]!).toBeLessThan(launch.mock.invocationCallOrder[0]!);
    // And the user lands on the run's live tab.
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("/runs/run-first/live"),
    );
  });

  it("registers the detected local broker first when local-kafka is not saved yet", async () => {
    const client = createApiClient();
    vi.spyOn(client, "listScenarios").mockResolvedValue({ scenarios: [] });
    vi.spyOn(client, "listConnections").mockResolvedValue({ connections: [] });
    vi.spyOn(client, "getConnectionSuggestions").mockResolvedValue({
      suggestions: [
        {
          kind: "local_kafka",
          detail: "demo broker",
          input: {
            type: "kafka",
            name: "local-kafka",
            config: {
              bootstrap_servers: ["kafka:29092"],
              security_protocol: "PLAINTEXT",
              default_topic: "txloom.events",
            },
          },
        },
      ],
    });
    const create = vi
      .spyOn(client, "createConnection")
      .mockResolvedValue({ id: "conn-fresh", name: "local-kafka", type: "kafka" } as never);
    vi.spyOn(client, "cloneTemplate").mockResolvedValue(cloned as never);
    const launch = vi.spyOn(client, "launchRun").mockResolvedValue({ id: "run-2" } as never);
    renderHome();
    fireEvent.click(await screen.findByTestId("first-run-start"));
    await waitFor(() => expect(launch).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: "local-kafka" }));
    expect(launch.mock.calls[0]![1].destinations).toEqual([
      { sink: "upi-stream", connection_id: "conn-fresh" },
    ]);
  });

  it("says what to start when there is no Kafka to send to", async () => {
    const client = createApiClient();
    vi.spyOn(client, "listScenarios").mockResolvedValue({ scenarios: [] });
    vi.spyOn(client, "listConnections").mockResolvedValue({ connections: [] });
    vi.spyOn(client, "getConnectionSuggestions").mockResolvedValue({ suggestions: [] });
    const launch = vi.spyOn(client, "launchRun");
    renderHome();
    fireEvent.click(await screen.findByTestId("first-run-start"));
    const message = await screen.findByTestId("first-run-error");
    expect(message.textContent).toContain("demo-brokers");
    expect(launch).not.toHaveBeenCalled();
  });
});
