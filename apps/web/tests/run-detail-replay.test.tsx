import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createApiClient } from "../src/api/client.js";
import { RunDetail } from "../src/surfaces/run-control/run-detail.js";

// The mock adapter (VITE_TXLOOM_MOCK=1) serves "run-replaying" (one running delivery),
// "run-replay-failed" (one failed delivery) and "run-generating" (no deliveries yet).
describe("RunDetail replay phase", () => {
  beforeAll(() => {
    vi.stubEnv("VITE_TXLOOM_MOCK", "1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows one delivery row per destination with its progress while replaying", async () => {
    render(<RunDetail runId="run-replaying" />);
    const row = await screen.findByTestId("delivery-row-events");
    expect(row.textContent).toContain("events");
    expect(row.textContent).toContain("local-kafka");
    expect(row.textContent).toContain("64,200");
    expect(row.textContent).toContain("182,400");
    // Still running: nothing to decide yet.
    expect(screen.queryByTestId("delivery-retry-events")).toBeNull();
    expect(screen.queryByTestId("delivery-skip-events")).toBeNull();
  });

  it("offers retry and skip on a failed row, which call the deliveries endpoints", async () => {
    const retry = vi.spyOn(createApiClient(), "retryDelivery");
    const skip = vi.spyOn(createApiClient(), "skipDelivery");
    render(<RunDetail runId="run-replay-failed" />);

    const row = await screen.findByTestId("delivery-row-events");
    expect(row.textContent).toContain("could not be delivered");

    fireEvent.click(screen.getByTestId("delivery-retry-events"));
    await waitFor(() => expect(retry).toHaveBeenCalledWith("run-replay-failed", "events"));

    fireEvent.click(screen.getByTestId("delivery-skip-events"));
    await waitFor(() => expect(skip).toHaveBeenCalledWith("run-replay-failed", "events"));
  });

  it("shows no delivery rows before the replay phase", async () => {
    render(<RunDetail runId="run-generating" />);
    await screen.findByTestId("run-status");
    expect(screen.queryByTestId("delivery-row-events")).toBeNull();
  });
});
