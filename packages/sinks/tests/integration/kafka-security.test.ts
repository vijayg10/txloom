import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { KafkaJS } from "@confluentinc/kafka-javascript";
import { KafkaSink, type KafkaSinkConfig } from "../../src/kafka/producer.js";

const USER = "txloom";
const PASSWORD = "scram-secret-pw";
const KEYSTORE_PASSWORD = "changeit";

interface SecureBroker {
  container: StartedTestContainer;
  bootstrap: string;
}

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/** A single-node KRaft broker with a SASL_SSL listener (SCRAM-SHA-512, the self-signed
 * keystore in `certDir`) for clients, and an in-container PLAINTEXT listener used to create
 * the SCRAM user. */
async function startSecureBroker(
  certDir: string,
  options: { autoCreateTopics: boolean },
): Promise<SecureBroker> {
  const port = await freePort();
  const container = await new GenericContainer("apache/kafka:3.9.0")
    .withExposedPorts({ container: 9094, host: port })
    .withCopyFilesToContainer([
      {
        source: path.join(certDir, "keystore.p12"),
        target: "/etc/kafka/secrets/keystore.p12",
        mode: 0o644,
      },
    ])
    .withEnvironment({
      KAFKA_NODE_ID: "1",
      KAFKA_PROCESS_ROLES: "broker,controller",
      KAFKA_LISTENERS: "PLAINTEXT://:9092,SECURE://:9094,CONTROLLER://:9093",
      KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://localhost:9092,SECURE://localhost:${port}`,
      KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
      KAFKA_CONTROLLER_QUORUM_VOTERS: "1@localhost:9093",
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP:
        "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT,SECURE:SASL_SSL",
      KAFKA_INTER_BROKER_LISTENER_NAME: "PLAINTEXT",
      KAFKA_SASL_ENABLED_MECHANISMS: "SCRAM-SHA-512",
      // listener.name.secure.scram-sha-512.sasl.jaas.config ("___" is the image's escape for "-")
      KAFKA_LISTENER_NAME_SECURE_SCRAM___SHA___512_SASL_JAAS_CONFIG:
        "org.apache.kafka.common.security.scram.ScramLoginModule required;",
      KAFKA_SSL_KEYSTORE_TYPE: "PKCS12",
      KAFKA_SSL_KEYSTORE_LOCATION: "/etc/kafka/secrets/keystore.p12",
      KAFKA_SSL_KEYSTORE_PASSWORD: KEYSTORE_PASSWORD,
      KAFKA_SSL_KEY_PASSWORD: KEYSTORE_PASSWORD,
      KAFKA_SSL_CLIENT_AUTH: "none",
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: String(options.autoCreateTopics),
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: "1",
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: "1",
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: "1",
    })
    .start();

  // Create the SCRAM user over the plaintext listener, inside the container.
  const result = await container.exec([
    "/opt/kafka/bin/kafka-configs.sh",
    "--bootstrap-server",
    "localhost:9092",
    "--alter",
    "--add-config",
    `SCRAM-SHA-512=[password=${PASSWORD}]`,
    "--entity-type",
    "users",
    "--entity-name",
    USER,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`creating the SCRAM user failed: ${result.output}`);
  }
  return { container, bootstrap: `localhost:${port}` };
}

describe("Kafka sink: SASL_SSL with SCRAM-SHA-512 and a custom CA", () => {
  let certDir: string;
  let caPem: string;
  let withAutoCreate: SecureBroker;
  let withoutAutoCreate: SecureBroker;
  const topic = "secure.events";

  function sinkFor(
    broker: SecureBroker,
    overrides: { ca?: boolean; password?: string; topic?: string } = {},
  ): KafkaSink {
    const config: KafkaSinkConfig = {
      bootstrap_servers: [broker.bootstrap],
      security_protocol: "SASL_SSL",
      sasl_mechanism: "SCRAM-SHA-512",
      default_topic: overrides.topic ?? topic,
      ...(overrides.ca === false ? {} : { ca_pem: caPem }),
    };
    return new KafkaSink("secure", config, {
      username: USER,
      password: overrides.password ?? PASSWORD,
    });
  }

  beforeAll(async () => {
    certDir = await mkdtemp(path.join(tmpdir(), "txloom-kafka-tls-"));
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "2",
        "-keyout",
        path.join(certDir, "key.pem"),
        "-out",
        path.join(certDir, "cert.pem"),
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "openssl",
      [
        "pkcs12",
        "-export",
        "-in",
        path.join(certDir, "cert.pem"),
        "-inkey",
        path.join(certDir, "key.pem"),
        "-out",
        path.join(certDir, "keystore.p12"),
        "-name",
        "broker",
        "-passout",
        `pass:${KEYSTORE_PASSWORD}`,
      ],
      { stdio: "ignore" },
    );
    caPem = await readFile(path.join(certDir, "cert.pem"), "utf8");

    [withAutoCreate, withoutAutoCreate] = await Promise.all([
      startSecureBroker(certDir, { autoCreateTopics: true }),
      startSecureBroker(certDir, { autoCreateTopics: false }),
    ]);

    // The topic is created over the secure listener, which also proves the credentials work.
    for (const broker of [withAutoCreate, withoutAutoCreate]) {
      const admin = new KafkaJS.Kafka({
        "bootstrap.servers": broker.bootstrap,
        "security.protocol": "sasl_ssl",
        "sasl.mechanisms": "SCRAM-SHA-512",
        "sasl.username": USER,
        "sasl.password": PASSWORD,
        "ssl.ca.pem": caPem,
        kafkaJS: { brokers: [broker.bootstrap] },
      }).admin();
      await admin.connect();
      await admin.createTopics({ topics: [{ topic, numPartitions: 3 }] });
      await admin.disconnect();
    }
  }, 300_000);

  afterAll(async () => {
    await Promise.all([withAutoCreate?.container.stop(), withoutAutoCreate?.container.stop()]);
    if (certDir) await rm(certDir, { recursive: true, force: true });
  });

  it("probe() succeeds over SASL_SSL with stage done and reports the topic's partitions", async () => {
    const sink = sinkFor(withAutoCreate);
    try {
      const result = await sink.probe({ topic });
      expect(result).toMatchObject({
        ok: true,
        stage: "done",
        topic: { name: topic, exists: true, partitions: 3 },
      });
    } finally {
      await sink.close();
    }
  }, 60_000);

  it("reports stage auth for a wrong password", async () => {
    const sink = sinkFor(withAutoCreate, { password: "not-the-password" });
    try {
      const result = await sink.probe({ topic });
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("auth");
    } finally {
      await sink.close();
    }
  }, 60_000);

  it("reports stage tls when the CA certificate is missing", async () => {
    const sink = sinkFor(withAutoCreate, { ca: false });
    try {
      const result = await sink.probe({ topic });
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("tls");
    } finally {
      await sink.close();
    }
  }, 60_000);

  it("reports topic.exists=false for a missing topic", async () => {
    const sink = sinkFor(withAutoCreate);
    try {
      const result = await sink.probe({ topic: "does.not.exist" });
      expect(result.topic).toMatchObject({ name: "does.not.exist", exists: false });
    } finally {
      await sink.close();
    }
  }, 60_000);

  // Blocked: @confluentinc/kafka-javascript 0.5.2 exposes no DescribeConfigs, so the probe cannot
  // read the broker's `auto.create.topics.enable` without creating the topic as a side effect.
  // Un-skip once research R11's "describe the broker's auto.create.topics.enable" has a source.
  it.skip("fails with stage topic, naming it, when the topic is missing and the broker forbids auto-creation", async () => {
    const sink = sinkFor(withoutAutoCreate);
    try {
      const result = await sink.probe({ topic: "also.missing" });
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("topic");
      expect(result.detail).toContain("also.missing");
      expect(result.topic).toMatchObject({
        name: "also.missing",
        exists: false,
        auto_create_allowed: false,
      });
    } finally {
      await sink.close();
    }
  }, 60_000);

  it("publishes over SASL_SSL", async () => {
    const sink = sinkFor(withAutoCreate);
    try {
      sink.setRunContext({ runId: "run-1", sessionSeq: 1, engineVersion: 1 });
      const result = await sink.publish(
        { topic },
        Buffer.from(JSON.stringify({ hello: "world" })),
        { event_id: "evt-1" } as never,
        new AbortController().signal,
      );
      expect(result).toEqual({ ok: true });
    } finally {
      await sink.close();
    }
  }, 60_000);
});
