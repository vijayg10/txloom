import type { ProbeResult, SinkTarget } from "@txloom/sinks";
import { encryptSecret, getOrCreateInstanceKey } from "./secrets.js";
import { getQueues } from "./queues.js";

export class WorkerUnavailableError extends Error {
  constructor() {
    super("No worker is running to test this connection. Start the worker container and try again.");
  }
}

export interface ProbeCandidate {
  type: "kafka" | "rabbitmq" | "webhook";
  name: string;
  config: unknown;
  secrets: unknown | null;
}

const PROBE_TIMEOUT_MS = 15_000;

/**
 * Enqueues a `connection-test` job and waits for the worker to run it (FR-010,
 * research R11) — probing has to happen where publishing happens, so the API never
 * does it itself. Secrets are sealed under the shared instance key so the plaintext
 * password never touches the Redis job payload (verified by T023).
 */
export async function probeConnection(
  candidate: ProbeCandidate,
  target: SinkTarget,
  dataDir: string,
): Promise<ProbeResult> {
  const queues = getQueues();
  const sealedSecrets = candidate.secrets
    ? encryptSecret(JSON.stringify(candidate.secrets), getOrCreateInstanceKey(dataDir)).toString("hex")
    : null;

  const job = await queues.connectionTest.add(
    "probe",
    {
      type: candidate.type,
      name: candidate.name,
      config: candidate.config,
      sealedSecrets,
      target,
      dataDir,
    },
    { removeOnComplete: true, removeOnFail: true },
  );

  try {
    return (await job.waitUntilFinished(queues.connectionTestEvents, PROBE_TIMEOUT_MS)) as ProbeResult;
  } catch {
    throw new WorkerUnavailableError();
  }
}
