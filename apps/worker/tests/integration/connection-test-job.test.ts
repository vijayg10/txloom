import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Redis } from "ioredis";
import type { Worker } from "bullmq";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { closeQueues, getQueues } from "../../../api/src/services/queues.js";
import { probeConnection } from "../../../api/src/services/connection-probe.js";
import {
  startConnectionTestWorker,
  type ConnectionTestJobData,
} from "../../src/jobs/connection-test.js";

const SECRET = "Bearer s3cr3t-token-value";

// Testcontainers Redis. The worker decrypts the sealed secrets with the instance key it
// shares with the API, and the plaintext never appears in the job payload at rest in Redis.
// Run via `pnpm test:integration`.
describe("connection-test job", () => {
  let redis: StartedTestContainer;
  let inspector: Redis;
  let dataDir: string;
  let server: http.Server;
  let serverUrl: string;
  const seenAuthorization: (string | undefined)[] = [];

  beforeAll(async () => {
    redis = await new GenericContainer("redis:7-alpine").withExposedPorts(6379).start();
    process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    dataDir = await mkdtemp(path.join(tmpdir(), "txloom-conn-test-job-"));
    process.env.DATA_DIR = dataDir;
    inspector = new Redis(process.env.REDIS_URL);

    server = http.createServer((request, response) => {
      seenAuthorization.push(request.headers.authorization);
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  }, 120_000);

  afterAll(async () => {
    inspector?.disconnect();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await closeQueues();
    await redis?.stop();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  async function jobPayloadsInRedis(): Promise<string> {
    const keys = await inspector.keys("bull:connection-test:*");
    const dumps: string[] = [];
    for (const key of keys) {
      const type = await inspector.type(key);
      if (type === "hash") dumps.push(JSON.stringify(await inspector.hgetall(key)));
      else if (type === "string") dumps.push((await inspector.get(key)) ?? "");
    }
    return dumps.join("\n");
  }

  it("unseals secrets with the instance key and probes, with no plaintext in the Redis job payload", async () => {
    const pending = probeConnection(
      {
        type: "webhook",
        name: "sealed-hook",
        config: { url: serverUrl, timeout_ms: 5000, max_attempts: 1 },
        secrets: { headers: { authorization: SECRET } },
      },
      {},
      dataDir,
    );

    // No worker is consuming yet, so the job sits in Redis: scan everything stored for it.
    let payloads = "";
    for (let attempt = 0; attempt < 50 && !payloads.includes("sealed-hook"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      payloads = await jobPayloadsInRedis();
    }
    expect(payloads).toContain("sealed-hook");
    expect(payloads).toContain("sealedSecrets");
    expect(payloads).not.toContain(SECRET);
    expect(payloads).not.toContain("s3cr3t-token-value");

    const worker: Worker<ConnectionTestJobData> = startConnectionTestWorker({
      connection: getQueues().connectionTest.opts.connection!,
    });
    try {
      const result = await pending;
      expect(result).toMatchObject({ ok: true, stage: "done" });
      // The worker decrypted the header and used it.
      expect(seenAuthorization).toContain(SECRET);
    } finally {
      await worker.close();
    }
  }, 60_000);
});
