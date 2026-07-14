import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

describe("GET /health", () => {
  it("200s with a compose-healthcheck-friendly body", async () => {
    const app = await buildApp({ skipDb: true });
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });
});

describe("GET /capabilities", () => {
  it("200s and advertises optional modules, ai_assist disabled in v1 (FR-012)", async () => {
    const app = await buildApp({ skipDb: true });
    const response = await app.inject({ method: "GET", url: "/api/v1/capabilities" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty("modules");
    expect(body.modules.ai_assist).toBe(false);
    await app.close();
  });
});
