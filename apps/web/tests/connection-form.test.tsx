import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createApiClient, type Connection } from "../src/api/client.js";
import { ConnectionForm } from "../src/surfaces/connections/connection-form.js";

function renderForm(initial?: Connection) {
  return render(<ConnectionForm initial={initial} onSaved={() => {}} onCancel={() => {}} />);
}

function fill(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

// The mock adapter (VITE_TXLOOM_MOCK=1) serves the connection fixtures and probes without a network.
describe("ConnectionForm", () => {
  beforeAll(() => {
    vi.stubEnv("VITE_TXLOOM_MOCK", "1");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows the SASL fields only for SASL protocols", () => {
    renderForm();
    for (const protocol of ["PLAINTEXT", "SSL"]) {
      fill("conn-security", protocol);
      expect(screen.queryByTestId("conn-sasl-mechanism")).toBeNull();
    }
    for (const protocol of ["SASL_PLAINTEXT", "SASL_SSL"]) {
      fill("conn-security", protocol);
      expect(screen.getByTestId("conn-sasl-mechanism")).toBeTruthy();
    }
  });

  it("shows the CA upload only for SSL protocols", () => {
    renderForm();
    for (const protocol of ["PLAINTEXT", "SASL_PLAINTEXT"]) {
      fill("conn-security", protocol);
      expect(screen.queryByTestId("conn-ca-upload")).toBeNull();
    }
    for (const protocol of ["SSL", "SASL_SSL"]) {
      fill("conn-security", protocol);
      expect(screen.getByTestId("conn-ca-upload")).toBeTruthy();
    }
  });

  it("tests before saving and shows the probe result; Test is enabled before Save", async () => {
    renderForm();
    const test = screen.getByTestId("conn-test") as HTMLButtonElement;
    expect(test.disabled).toBe(false);
    expect(screen.queryByTestId("conn-test-result")).toBeNull();

    fill("conn-name", "demo");
    fill("conn-bootstrap", "broker.example.com:9092");
    fill("conn-default-topic", "events");
    fireEvent.click(test);

    const result = await screen.findByTestId("conn-test-result");
    expect(result.textContent).toContain("ok");
    expect(result.textContent).toContain("Connected.");
  });

  it("shows the failing stage's detail when the probe fails", async () => {
    vi.spyOn(createApiClient(), "testConnection").mockResolvedValue({
      ok: false,
      stage: "auth",
      detail: "Authentication failed: invalid username or password.",
      latency_ms: 10,
    });
    renderForm();
    fireEvent.click(screen.getByTestId("conn-test"));
    const result = await screen.findByTestId("conn-test-result");
    expect(result.textContent).toContain("failed");
    expect(result.textContent).toContain("Authentication failed");
  });

  it("leaves the password input empty when editing", () => {
    const existing: Connection = {
      id: "c1",
      type: "kafka",
      name: "staging-msk",
      config: {
        bootstrap_servers: ["b-1.example.com:9096"],
        security_protocol: "SASL_SSL",
        sasl_mechanism: "SCRAM-SHA-512",
        default_topic: "events",
      },
      has_credentials: true,
      managed_by: "user",
      health: { ok: null, last_test_at: null, summary: null, stage: null },
      warnings: [],
    } as unknown as Connection;
    renderForm(existing);
    expect((screen.getByTestId("conn-password") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("conn-username") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("conn-name") as HTMLInputElement).value).toBe("staging-msk");
  });

  it("warns about localhost addresses", () => {
    renderForm();
    expect(screen.queryByTestId("conn-localhost-warning")).toBeNull();
    fill("conn-bootstrap", "localhost:9092");
    expect(screen.getByTestId("conn-localhost-warning")).toBeTruthy();
  });

  it("warns about a missing topic but keeps Save enabled", async () => {
    vi.spyOn(createApiClient(), "testConnection").mockResolvedValue({
      ok: false,
      stage: "topic",
      detail: 'Topic "not-there" does not exist',
      topic: { name: "not-there", exists: false, auto_create_allowed: false },
      latency_ms: 10,
    });
    renderForm();
    fireEvent.click(screen.getByTestId("conn-test"));
    await waitFor(() => expect(screen.getByTestId("conn-topic-missing-warning")).toBeTruthy());
    expect((screen.getByTestId("conn-save") as HTMLButtonElement).disabled).toBe(false);
  });
});
