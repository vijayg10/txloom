import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { AppShell } from "../src/components/layout/app-shell.js";

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function visit(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell />
      <Where />
    </MemoryRouter>,
  );
}

class QuietSocket {
  addEventListener() {}
  send() {}
  close() {}
}

// contracts/ui-routes.md "Redirects from v1 routes" — every old URL lands on its new home.
describe("route redirects", () => {
  beforeAll(() => {
    vi.stubEnv("VITE_TXLOOM_MOCK", "1");
  });

  beforeEach(() => {
    vi.stubGlobal("WebSocket", QuietSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ scenarios: [], runs: [] }),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ["/stream", "/runs?filter=streamable"],
    ["/stream/run-live", "/runs/run-live/live"],
    ["/stream?run=run-live", "/runs/run-live/live"],
    ["/inspector", "/runs"],
    ["/inspector/run-live", "/runs/run-live/inspect"],
    ["/ground-truth", "/runs"],
    ["/ground-truth/run-live", "/runs/run-live/truth"],
    ["/settings/sinks", "/connections"],
    ["/runs/run-live", "/runs/run-live/progress"],
    ["/runs/new?scenario=sc-1", "/scenarios/sc-1?launch=1"],
    ["/runs?scenario=sc-1", "/scenarios/sc-1?launch=1"],
  ])("%s → %s", async (from, to) => {
    visit(from);
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe(to));
  });

  it("the sidebar lists Scenarios, Runs and Connections, with Settings in the footer", async () => {
    visit("/connections");
    for (const label of ["Scenarios", "Runs", "Connections", "Settings"]) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
    expect(screen.queryByText("Stream console")).toBeNull();
    expect(screen.queryByText("World inspector")).toBeNull();
  });
});
