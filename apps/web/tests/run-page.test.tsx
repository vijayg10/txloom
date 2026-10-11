import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { createApiClient, type Stream } from "../src/api/client.js";
import { RunPage } from "../src/surfaces/run/index.js";

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

function renderRun(path: string, props: { pollMs?: number } = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/runs/:runId/:tab" element={<RunPage {...props} />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

const stream = (state: Stream["state"]): Stream =>
  ({
    state,
    achieved_tps: 0,
    target_tps: 50,
    aimd_rate: 50,
    sink_lag: 0,
    in_flight: 0,
    retry_queue: 0,
    backpressure: false,
    delivered_total: 0,
    failed_total: 0,
    sim_time: "2026-10-10T00:00:00.000Z",
    last_error: null,
    destinations: [],
    session: null,
    sessions_count: 0,
  }) as Stream;

// The surfaces inside the tabs still read through the plain HTTP client; answer those calls with
// empty shapes so only the run page's own behaviour is under test. The mock adapter
// (VITE_TXLOOM_MOCK=1) serves the run itself.
class QuietSocket {
  addEventListener() {}
  send() {}
  close() {}
}

describe("RunPage", () => {
  beforeAll(() => {
    vi.stubEnv("VITE_TXLOOM_MOCK", "1");
  });

  beforeEach(() => {
    vi.stubGlobal("WebSocket", QuietSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const body = url.endsWith("/stream")
          ? {
              id: "s",
              run_id: "run-live",
              state: "streaming",
              target_tps: 50,
              label_channel_enabled: false,
            }
          : url.includes("/runs?") || url.endsWith("/runs")
            ? { runs: [] }
            : {};
        return { ok: true, status: 200, json: async () => body };
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("names the run by scenario, version and start time", async () => {
    renderRun("/runs/run-live/progress");
    const title = await screen.findByTestId("run-title");
    await waitFor(() => expect(title.textContent).toMatch(/UPI fraud reference · v3 · /));
  });

  it.each([
    ["progress", "run-status"],
    ["live", "stream-console"],
    ["inspect", "inspector-volume-chart"],
    ["truth", "ground-truth-explorer"],
    ["export", "export-controls"],
  ])("the %s tab renders run-scoped content with no run picker", async (tab, testId) => {
    // A run that is still replaying never auto-switches, so each tab can be asserted in place.
    renderRun(`/runs/run-replaying/${tab}`);
    expect(await screen.findByTestId(testId, {}, { timeout: 3000 })).toBeTruthy();
    for (const picker of ["stream-run-picker", "inspector-run-picker", "ground-truth-run-picker"]) {
      expect(screen.queryByTestId(picker)).toBeNull();
    }
  });

  it("links every tab with a router link", async () => {
    renderRun("/runs/run-live/progress");
    for (const tab of ["progress", "live", "inspect", "truth", "export"]) {
      const link = await screen.findByTestId(`run-tab-${tab}`);
      expect(link.getAttribute("href")).toBe(`/runs/run-live/${tab}`);
    }
  });

  describe("automatic tab switching", () => {
    function phases(...sequence: ("replaying" | "live")[]) {
      const client = createApiClient();
      const real = client.getRun.bind(client);
      let calls = 0;
      vi.spyOn(client, "getRun").mockImplementation(async (id) => {
        const run = await real("run-replaying");
        const phase = sequence[Math.min(calls++, sequence.length - 1)]!;
        return { ...run, id, phase };
      });
    }

    it("moves from Progress to Live when the phase becomes live", async () => {
      phases("replaying", "replaying", "live");
      renderRun("/runs/run-replaying/progress", { pollMs: 20 });
      await waitFor(() =>
        expect(screen.getByTestId("where").textContent).toBe("/runs/run-replaying/live"),
      );
    });

    it("stays where the user went if they switched tabs manually", async () => {
      phases("replaying", "replaying", "replaying", "live");
      renderRun("/runs/run-replaying/progress", { pollMs: 40 });
      await screen.findByTestId("run-tab-export");
      fireEvent.click(screen.getByTestId("run-tab-export"));
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(screen.getByTestId("where").textContent).toBe("/runs/run-replaying/export");
    });

    it("does not jump when the page is opened on another tab", async () => {
      phases("live");
      renderRun("/runs/run-replaying/export", { pollMs: 20 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(screen.getByTestId("where").textContent).toBe("/runs/run-replaying/export");
    });
  });

  describe("destination chip", () => {
    it("is read-only, and Change is enabled only when the stream is stopped", async () => {
      const client = createApiClient();
      const cases: [Stream["state"], boolean][] = [
        ["streaming", true],
        ["paused", true],
        ["error", true],
        ["stopped", false],
      ];
      for (const [state, disabled] of cases) {
        vi.spyOn(client, "getStream").mockResolvedValue(stream(state));
        const view = renderRun("/runs/run-live/progress");
        const chip = await screen.findByTestId("live-destination-chip-events");
        expect(chip.tagName).not.toBe("INPUT");
        expect(chip.textContent).toContain("local-kafka");
        const change = (await screen.findByTestId("live-destination-change")) as HTMLButtonElement;
        await waitFor(() => expect(change.disabled).toBe(disabled));
        view.unmount();
      }
    });

    it("saves new destinations through the stream destinations endpoint", async () => {
      const client = createApiClient();
      vi.spyOn(client, "getStream").mockResolvedValue(stream("stopped"));
      const save = vi.spyOn(client, "setStreamDestinations");
      renderRun("/runs/run-live/live");
      await waitFor(() =>
        expect((screen.getByTestId("live-destination-change") as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      fireEvent.click(screen.getByTestId("live-destination-change"));
      const picker = await screen.findByTestId("launch-destination-events");
      await waitFor(() =>
        expect(
          screen
            .getAllByRole("option")
            .some((o) => (o as HTMLOptionElement).value === "conn-short-retention"),
        ).toBe(true),
      );
      fireEvent.change(picker, { target: { value: "conn-short-retention" } });
      fireEvent.click(screen.getByTestId("live-destination-save"));
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith("run-live", [
          expect.objectContaining({ sink: "events", connection_id: "conn-short-retention" }),
        ]),
      );
    });
  });
});
