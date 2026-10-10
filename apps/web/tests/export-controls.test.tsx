import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createApiClient } from "../src/api/client.js";
import { ExportControls } from "../src/surfaces/ground-truth/export-controls.js";

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled;
}

// The mock adapter (VITE_TXLOOM_MOCK=1) serves the run "run-live", whose spec declares a kafka sink
// "events" and a file sink "archive". Its exports move queued → running → completed per poll.
describe("ExportControls", () => {
  beforeAll(() => {
    vi.stubEnv("VITE_TXLOOM_MOCK", "1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("lists Truth plus each file sink, defaulting to the first file sink", async () => {
    render(<ExportControls runId="run-live" pollMs={10} />);
    const select = (await screen.findByTestId("export-source")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("sink:archive"));
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual(["Truth", "archive (file sink)"]);
  });

  it("requests the chosen source and format without a warning when labels are not included", async () => {
    const create = vi.spyOn(createApiClient(), "createExport");
    render(<ExportControls runId="run-live" pollMs={10} />);
    await waitFor(() =>
      expect((screen.getByTestId("export-source") as HTMLSelectElement).value).toBe("sink:archive"),
    );
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith("run-live", {
      format: "csv",
      include_labels: false,
      source: { kind: "sink", name: "archive" },
    });
  });

  it("sends the truth source when Truth is picked", async () => {
    const create = vi.spyOn(createApiClient(), "createExport");
    render(<ExportControls runId="run-live" pollMs={10} />);
    const select = await screen.findByTestId("export-source");
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("sink:archive"));
    fireEvent.change(select, { target: { value: "truth" } });
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![1].source).toEqual({ kind: "truth" });
  });

  it("shows queued then running while the job works, and offers the download only when completed", async () => {
    render(<ExportControls runId="run-live" pollMs={30} />);
    await waitFor(() =>
      expect((screen.getByTestId("export-source") as HTMLSelectElement).value).toBe("sink:archive"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    expect((await screen.findByTestId("export-status")).textContent).toMatch(/queued/i);
    expect(screen.queryByTestId("export-download-link")).toBeNull();

    await waitFor(() =>
      expect(screen.getByTestId("export-status").textContent).toMatch(/building/i),
    );
    expect(screen.queryByTestId("export-download-link")).toBeNull();

    const link = await screen.findByTestId("export-download-link");
    expect(link.textContent).toMatch(/Download data.csv/);
    expect(screen.queryByTestId("export-status")).toBeNull();
  });

  it("surfaces the label-inclusion warning and blocks submit without acknowledgment (FR-022)", async () => {
    const create = vi.spyOn(createApiClient(), "createExport");
    render(<ExportControls runId="run-live" pollMs={10} />);

    fireEvent.click(screen.getByLabelText("Include ground-truth labels in this export"));
    expect(screen.getByRole("alert")).toBeTruthy();

    const submit = screen.getByRole("button", { name: "Export" });
    expect(isDisabled(submit)).toBe(true);
    fireEvent.click(submit);
    expect(create).not.toHaveBeenCalled();
  });

  it("enables submit once the warning is acknowledged, and sends the acknowledgement", async () => {
    const create = vi.spyOn(createApiClient(), "createExport");
    render(<ExportControls runId="run-live" pollMs={10} />);

    fireEvent.click(screen.getByLabelText("Include ground-truth labels in this export"));
    fireEvent.click(
      screen.getByLabelText("I understand labels will be merged into the main export"),
    );
    const submit = screen.getByRole("button", { name: "Export" });
    expect(isDisabled(submit)).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![1]).toMatchObject({
      include_labels: true,
      acknowledged_warning: true,
    });
  });

  it("unchecking include-labels clears the acknowledgment (re-showing the block on re-check)", () => {
    render(<ExportControls runId="run-live" pollMs={10} />);

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
