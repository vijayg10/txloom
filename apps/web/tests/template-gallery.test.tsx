import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TemplateGallery } from "../src/surfaces/scenario-workspace/template-gallery.js";

const templates = [
  {
    slug: "upi-instant-payments",
    name: "UPI-style instant payments",
    description: "…",
    benchmark_refs: {},
  },
  {
    slug: "card-present-retail",
    name: "Card-present retail",
    description: "…",
    benchmark_refs: {},
  },
];

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/templates") && method === "GET") {
      return { ok: true, json: async () => ({ templates }) };
    }
    if (url.endsWith("/scenarios") && method === "POST") {
      return { ok: true, json: async () => ({ id: "scenario1", name: "cloned" }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe("TemplateGallery", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists every seeded template", async () => {
    render(<TemplateGallery />);
    await screen.findByText("UPI-style instant payments");
    expect(screen.getByText("Card-present retail")).toBeTruthy();
  });

  it("clones a template into a new scenario and reports the new id", async () => {
    const onCloned = vi.fn();
    render(<TemplateGallery onCloned={onCloned} />);
    await screen.findByText("UPI-style instant payments");

    const [cloneButton] = screen.getAllByText("New from template");
    fireEvent.click(cloneButton!);

    await vi.waitFor(() => expect(onCloned).toHaveBeenCalledWith("scenario1"));

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/scenarios",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "UPI-style instant payments (from template)",
          template_slug: "upi-instant-payments",
        }),
      }),
    );
  });
});
