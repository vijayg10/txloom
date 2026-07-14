import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExportControls } from "../src/surfaces/ground-truth/export-controls.js";

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled;
}

describe("ExportControls", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          export_id: "exp1",
          file_name: "data.csv",
          answer_key_file_name: null,
        }),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("submits without a warning when labels are not included", async () => {
    render(<ExportControls runId="run1" />);
    const submit = screen.getByRole("button", { name: "Export" });
    expect(isDisabled(submit)).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(submit);
    await screen.findByText(/Download data.csv/);

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/runs/run1/exports",
      expect.objectContaining({
        body: JSON.stringify({ format: "csv", include_labels: false }),
      }),
    );
  });

  it("surfaces the label-inclusion warning and blocks submit without acknowledgment (FR-022)", () => {
    render(<ExportControls runId="run1" />);

    const includeLabels = screen.getByLabelText("Include ground-truth labels in this export");
    fireEvent.click(includeLabels);

    expect(screen.getByRole("alert")).toBeTruthy();

    const submit = screen.getByRole("button", { name: "Export" });
    expect(isDisabled(submit)).toBe(true);

    fireEvent.click(submit);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("enables submit once the warning is explicitly acknowledged", async () => {
    render(<ExportControls runId="run1" />);

    fireEvent.click(screen.getByLabelText("Include ground-truth labels in this export"));
    const acknowledge = screen.getByLabelText(
      "I understand labels will be merged into the main export",
    );
    fireEvent.click(acknowledge);

    const submit = screen.getByRole("button", { name: "Export" });
    expect(isDisabled(submit)).toBe(false);

    fireEvent.click(submit);
    await screen.findByText(/Download data.csv/);

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/runs/run1/exports",
      expect.objectContaining({
        body: JSON.stringify({ format: "csv", include_labels: true, acknowledged_warning: true }),
      }),
    );
  });

  it("unchecking include-labels clears the acknowledgment (re-showing the block on re-check)", () => {
    render(<ExportControls runId="run1" />);

    const includeLabels = screen.getByLabelText("Include ground-truth labels in this export");
    fireEvent.click(includeLabels);
    fireEvent.click(
      screen.getByLabelText("I understand labels will be merged into the main export"),
    );
    expect(isDisabled(screen.getByRole("button", { name: "Export" }))).toBe(false);

    fireEvent.click(includeLabels); // uncheck
    fireEvent.click(includeLabels); // re-check

    expect(isDisabled(screen.getByRole("button", { name: "Export" }))).toBe(true);
  });
});
