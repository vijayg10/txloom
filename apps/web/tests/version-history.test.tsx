import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VersionHistory } from "../src/surfaces/scenario-workspace/version-history.js";

const v1 = {
  id: "v1",
  version_no: 1,
  spec: { a: 1 },
  author_type: "user" as const,
  parent_version_id: null,
  created_at: "2026-01-01T00:00:00.000Z",
};
const v2 = {
  id: "v2",
  version_no: 2,
  spec: { a: 2 },
  author_type: "agent" as const,
  parent_version_id: "v1",
  created_at: "2026-01-02T00:00:00.000Z",
};

function mockFetch(versions: (typeof v1)[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/versions") && method === "GET") {
      return { ok: true, json: async () => ({ versions }) };
    }
    if (url.includes("/rollback") && method === "POST") {
      return { ok: true, json: async () => ({ ...v1, id: "v3", version_no: 3 }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe("VersionHistory", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch([v2, v1]));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders every version with its author type", async () => {
    render(<VersionHistory scenarioId="scenario1" />);
    await screen.findByText(/v2 · agent/);
    expect(screen.getByText(/v1 · user/)).toBeTruthy();
  });

  it("shows a per-field diff when comparing a version to its parent", async () => {
    render(<VersionHistory scenarioId="scenario1" />);
    await screen.findByText(/v2 · agent/);

    const compareButtons = screen.getAllByText("Compare to previous");
    fireEvent.click(compareButtons[0]!); // v2, which has a parent (v1)

    await screen.findByText("/a");
    expect(screen.getByText(/changed/)).toBeTruthy();
  });

  it("reports no prior version when comparing the root version", async () => {
    render(<VersionHistory scenarioId="scenario1" />);
    await screen.findByText(/v1 · user/);

    const compareButtons = screen.getAllByText("Compare to previous");
    fireEvent.click(compareButtons[1]!); // v1, no parent

    await screen.findByText("No prior version to compare against.");
  });

  it("rolling back posts to the rollback endpoint and refreshes the list", async () => {
    render(<VersionHistory scenarioId="scenario1" />);
    await screen.findByText(/v1 · user/);

    const rollbackButtons = screen.getAllByText("Rollback to this");
    fireEvent.click(rollbackButtons[1]!); // roll back to v1

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/v1/scenarios/scenario1/versions/v1/rollback",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
