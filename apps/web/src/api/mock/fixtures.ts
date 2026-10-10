import type {
  Connection,
  ConnectionSuggestion,
  Destination,
  LaunchDefaults,
  Run,
  RunEstimate,
  Stream,
  StreamMetrics,
  StreamSession,
} from "../client.js";

// Fixtures for the clickable prototype (`VITE_TXLOOM_MOCK=1`, T012). Walked by the
// prototype review (T019) and reused by the component tests that follow.

export const MOCK_SCENARIO_ID = "scenario-upi-fraud";
export const MOCK_SCENARIO_NAME = "UPI fraud reference";

export function makeConnections(): Connection[] {
  return [
    {
      id: "conn-local-kafka",
      type: "kafka",
      name: "local-kafka",
      config: {
        bootstrap_servers: ["kafka:29092"],
        security_protocol: "PLAINTEXT",
        default_topic: "txloom.events",
      },
      has_credentials: false,
      managed_by: "auto",
      health: {
        last_test_at: "2026-10-09T08:00:00.000Z",
        ok: true,
        summary: "Connected. Topic txloom.events has 3 partitions.",
        stage: "done",
      },
      warnings: [],
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-09T08:00:00.000Z",
    },
    {
      id: "conn-staging-msk",
      type: "kafka",
      name: "staging-msk",
      config: {
        bootstrap_servers: ["b-1.staging-msk.kafka.ap-south-1.amazonaws.com:9096"],
        security_protocol: "SASL_SSL",
        sasl_mechanism: "SCRAM-SHA-512",
        default_topic: "staging.txloom.events",
      },
      has_credentials: true,
      managed_by: "user",
      health: {
        last_test_at: "2026-10-08T14:22:00.000Z",
        ok: false,
        summary: "Authentication failed: invalid username or password.",
        stage: "auth",
      },
      warnings: [],
      created_at: "2026-09-20T00:00:00.000Z",
      updated_at: "2026-10-08T14:22:00.000Z",
    },
  ];
}

export function makeConnectionSuggestions(connections: Connection[]): ConnectionSuggestion[] {
  const hasLocalKafka = connections.some((c) => c.name === "local-kafka");
  if (hasLocalKafka) return [];
  return [
    {
      kind: "local_kafka",
      input: {
        type: "kafka",
        name: "local-kafka",
        config: {
          bootstrap_servers: ["kafka:29092"],
          security_protocol: "PLAINTEXT",
          default_topic: "txloom.events",
        },
      },
      detail: "A Kafka broker is reachable at kafka:29092 (the bundled demo broker).",
    },
  ];
}

function destination(sink: string, connectionId: string, connectionName: string): Destination {
  return {
    sink,
    connection_id: connectionId,
    connection_name: connectionName,
    connection_type: "kafka",
    topic: "txloom.events",
    connection_missing: false,
  };
}

export function makeLaunchDefaults(): LaunchDefaults {
  return {
    destinations: [destination("events", "conn-local-kafka", "local-kafka")],
    mode: "history_then_live",
    target_tps: 50,
    replay_history: false,
    label_channel: false,
  };
}

export function makeEstimate(replayHistory = false): RunEstimate {
  return {
    history_events: 182_400,
    replay_messages: replayHistory ? 182_400 : 0,
    partitions: 4,
    generation_seconds: 38,
    assumptions: [
      "150,000 events/s per generation thread",
      replayHistory
        ? "replays every history event to its destination"
        : "no replay (replay_history=false)",
    ],
  };
}

function baseRun(overrides: Partial<Run>): Run {
  return {
    id: "run-generating",
    scenario_id: MOCK_SCENARIO_ID,
    scenario: { id: MOCK_SCENARIO_ID, name: MOCK_SCENARIO_NAME },
    spec_version: { id: "specver-1", number: 3 },
    spec_snapshot: {
      output: {
        sinks: [
          { type: "kafka", name: "events" },
          { type: "file", name: "archive", format: "parquet" },
        ],
      },
    },
    seed: "424242",
    status: "running",
    mode: "history_then_live",
    engine_version: 1,
    partition_count: 4,
    replay_history: false,
    target_tps: 50,
    launch_destinations: [destination("events", "conn-local-kafka", "local-kafka")],
    deliveries: [],
    stream_summary: null,
    outputs_deleted_at: null,
    created_at: "2026-10-10T08:00:00.000Z",
    started_at: "2026-10-10T08:00:01.000Z",
    completed_at: null,
    ...overrides,
  };
}

export function makeRuns(): Run[] {
  return [
    baseRun({
      id: "run-generating",
      phase: "generating",
      status: "running",
    }),
    baseRun({
      id: "run-replaying",
      phase: "replaying",
      replay_history: true,
      status: "running",
      deliveries: [
        {
          sink: "events",
          state: "running",
          published: 64_200,
          failed: 0,
          total: 182_400,
          destination_snapshot: destination("events", "conn-local-kafka", "local-kafka"),
          last_error: null,
        },
      ],
    }),
    baseRun({
      id: "run-live",
      phase: "live",
      status: "running",
      started_at: "2026-10-09T08:00:01.000Z",
      deliveries: [
        {
          sink: "events",
          state: "done",
          published: 182_400,
          failed: 0,
          total: 182_400,
          destination_snapshot: destination("events", "conn-local-kafka", "local-kafka"),
          last_error: null,
        },
      ],
    }),
  ];
}

let streamTick = 0;

/** A ticking StreamMetrics generator for the Live tab's polling loop in mock mode. */
export function tickStreamMetrics(targetTps = 50): StreamMetrics {
  streamTick += 1;
  const achieved = targetTps - (streamTick % 5 === 0 ? 8 : 0);
  return {
    achieved_tps: achieved,
    target_tps: targetTps,
    aimd_rate: targetTps,
    sink_lag: streamTick % 5 === 0 ? 120 : 4,
    in_flight: 12,
    retry_queue: 0,
    backpressure: streamTick % 5 === 0,
    delivered_total: 182_400 + streamTick * achieved,
    failed_total: 0,
    sim_time: new Date(Date.parse("2026-10-10T00:00:00.000Z") + streamTick * 1000).toISOString(),
    last_error: null,
  };
}

export function makeStreamSession(seq = 1): StreamSession {
  return {
    id: `session-${seq}`,
    seq,
    engine_version: 1,
    destinations_snapshot: [destination("events", "conn-local-kafka", "local-kafka")],
    resume_from: { kind: "history_end" },
    sim_time_ms: 0,
    delivered: 0,
    failed: 0,
    duplicates_injected: 0,
  };
}

export function makeStream(targetTps = 50): Stream {
  return {
    ...tickStreamMetrics(targetTps),
    state: "streaming",
    destinations: [destination("events", "conn-local-kafka", "local-kafka")],
    session: makeStreamSession(1),
    sessions_count: 1,
  };
}
