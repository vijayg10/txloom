import { Worker, type ConnectionOptions, type Job } from "bullmq";
import {
  kafkaSinkFactory,
  rabbitMqSinkFactory,
  webhookSinkFactory,
  type ProbeResult,
  type SinkTarget,
} from "@txloom/sinks";
import { decryptSecret, getOrCreateInstanceKey } from "../../../api/src/services/secrets.js";

export interface ConnectionTestJobData {
  type: "kafka" | "rabbitmq" | "webhook";
  name: string;
  config: unknown;
  /** AES-256-GCM envelope, hex-encoded — sealed by the API under the shared instance key
   * (research R11) so the plaintext password never touches the Redis job payload. */
  sealedSecrets: string | null;
  target: SinkTarget;
  dataDir: string;
}

const FACTORIES = {
  kafka: kafkaSinkFactory,
  rabbitmq: rabbitMqSinkFactory,
  webhook: webhookSinkFactory,
};

export interface ConnectionTestDeps {
  connection: ConnectionOptions;
}

/** Consumes `connection-test` jobs (FR-010, research R11): unseals the secrets under the
 * instance key both containers share, builds the sink through its factory, probes the
 * target, then closes it. The worker runs this — not the API — because the worker is what
 * actually publishes, so it alone sees the real network (the `localhost` vs `kafka:29092`
 * trap). */
export function startConnectionTestWorker(deps: ConnectionTestDeps): Worker<ConnectionTestJobData> {
  return new Worker<ConnectionTestJobData>(
    "connection-test",
    async (job: Job<ConnectionTestJobData>): Promise<ProbeResult> => {
      const { type, name, config, sealedSecrets, target, dataDir } = job.data;
      const secrets = sealedSecrets
        ? (JSON.parse(
            decryptSecret(Buffer.from(sealedSecrets, "hex"), getOrCreateInstanceKey(dataDir)),
          ) as unknown)
        : null;

      const factory = FACTORIES[type];
      const sink = factory.create(name, config as never, secrets as never);
      try {
        return await sink.probe(target);
      } finally {
        await sink.close();
      }
    },
    { connection: deps.connection },
  );
}
