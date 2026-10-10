/** Typed client over the same REST surface the CLI and MCP server use
 * (contracts/api.md). One origin for REST/WS/UI (D4) — relative paths, no CORS. */

import { createMockApiClient } from "./mock/index.js";

const BASE_URL = "/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE_URL}${path}`, init);

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = (
      payload as { error?: { code?: string; message?: string; details?: unknown } } | undefined
    )?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "unknown_error",
      error?.message ?? response.statusText,
      error?.details,
    );
  }
  return payload as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

export interface Capabilities {
  modules: { ai_assist: boolean };
}

export function getCapabilities(): Promise<Capabilities> {
  return apiClient.get<Capabilities>("/capabilities");
}

// --- Connections (contracts/api.md "Connections", data-model.md §1.1) ---

export type ConnectionType = "kafka" | "rabbitmq" | "webhook";

export interface KafkaConfig {
  bootstrap_servers: string[];
  security_protocol: "PLAINTEXT" | "SSL" | "SASL_PLAINTEXT" | "SASL_SSL";
  sasl_mechanism?: "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512";
  ca_pem?: string;
  default_topic: string;
  partition_key_field?: string;
}

export interface RabbitConfig {
  host: string;
  port: number;
  vhost: string;
  tls: boolean;
  ca_pem?: string;
  exchange: string;
  exchange_type: "direct" | "topic" | "fanout";
  default_routing_key: string;
}

export interface WebhookConfig {
  url: string;
  timeout_ms: number;
  max_attempts: number;
}

export type ConnectionConfig = KafkaConfig | RabbitConfig | WebhookConfig;

export type ConnectionInput =
  | { type: "kafka"; name: string; config: KafkaConfig; secrets?: { username: string; password: string } | null }
  | { type: "rabbitmq"; name: string; config: RabbitConfig; secrets?: { username: string; password: string } | null }
  | {
      type: "webhook";
      name: string;
      config: WebhookConfig;
      secrets?: { headers: Record<string, string> } | null;
    };

export type ProbeStage = "resolve" | "connect" | "tls" | "auth" | "topic" | "done";

export interface ProbeResult {
  ok: boolean;
  stage: ProbeStage;
  detail: string;
  topic?: {
    name: string;
    exists: boolean;
    partitions?: number;
    auto_create_allowed?: boolean;
    retention_ms?: number | null;
  };
  latency_ms: number;
}

export interface Connection {
  id: string;
  type: ConnectionType;
  name: string;
  config: ConnectionConfig;
  has_credentials: boolean;
  managed_by: "user" | "env" | "auto";
  health: { last_test_at: string | null; ok: boolean | null; summary: string | null; stage: ProbeStage | null };
  warnings: { code: "localhost_address" | "topic_missing"; message: string }[];
  created_at: string;
  updated_at: string;
}

export interface ConnectionSuggestion {
  kind: "local_kafka";
  input: ConnectionInput;
  detail: string;
}

// --- Destinations and launch (contracts/api.md "Launch and runs") ---

export interface DestinationInput {
  sink: string;
  connection_id: string;
  topic?: string;
  routing_key?: string;
  label_topic?: string;
}

export interface Destination extends DestinationInput {
  connection_name: string;
  connection_type: string;
  connection_missing: boolean;
}

export interface RunEstimate {
  history_events: number;
  replay_messages: number;
  partitions: number;
  generation_seconds: number;
  assumptions: string[];
}

export interface LaunchRequest {
  seed?: string | number;
  mode?: "history_only" | "history_then_live";
  destinations?: DestinationInput[];
  replay_history?: boolean;
  target_tps?: number;
  label_channel?: boolean;
  label_export?: "separate_export" | "merged_with_warning";
  scale_override?: { consumers?: number; merchants?: number; days?: number };
}

export interface LaunchDefaults {
  destinations: Destination[];
  mode: "history_only" | "history_then_live";
  target_tps: number | null;
  replay_history: boolean;
  label_channel: boolean;
}

export type RunMode = "history_only" | "history_then_live";
export type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type RunPhase = "generating" | "replaying" | "live" | "done";

export interface RunDelivery {
  sink: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  published: number;
  failed: number;
  total: number;
  destination_snapshot: Destination;
  last_error: string | null;
}

export interface Run {
  id: string;
  scenario_id: string;
  scenario: { id: string; name: string };
  spec_version: { id: string; number: number };
  spec_snapshot: unknown;
  seed: string;
  status: RunStatus;
  mode: RunMode;
  engine_version: number;
  partition_count: number;
  replay_history: boolean;
  target_tps: number | null;
  launch_destinations: Destination[];
  deliveries: RunDelivery[];
  stream_summary: unknown;
  phase?: RunPhase;
  outputs_deleted_at: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  source_run_id?: string | null;
}

// --- Streaming (contracts/api.md "Streaming") ---

export interface StreamMetrics {
  achieved_tps: number;
  target_tps: number;
  aimd_rate: number;
  sink_lag: number;
  in_flight: number;
  retry_queue: number;
  backpressure: boolean;
  delivered_total: number;
  failed_total: number;
  sim_time: string;
  last_error: string | null;
  ticker?: unknown;
}

export interface StreamSession {
  id: string;
  seq: number;
  engine_version: number;
  destinations_snapshot: Destination[];
  resume_from: { kind: "history_end" } | { kind: "session"; session_id: string; day_index: number };
  sim_time_ms: number;
  delivered: number;
  failed: number;
  duplicates_injected: number;
}

export interface Stream extends StreamMetrics {
  state: "idle" | "streaming" | "paused" | "stopped" | "error";
  destinations: Destination[];
  session: StreamSession | null;
  sessions_count: number;
}

/**
 * The full client surface the UI codes against (contracts/api.md). `createApiClient()`
 * returns the real HTTP-backed implementation, or the mock adapter over fixtures when
 * `VITE_TXLOOM_MOCK=1` (apps/web/src/api/mock/index.ts).
 */
export interface TxLoomApiClient {
  listConnections(): Promise<{ connections: Connection[] }>;
  createConnection(input: ConnectionInput): Promise<Connection>;
  getConnection(id: string): Promise<Connection>;
  updateConnection(id: string, input: Partial<ConnectionInput>): Promise<Connection>;
  deleteConnection(id: string): Promise<void>;
  testConnection(input: ConnectionInput): Promise<ProbeResult>;
  testSavedConnection(id: string): Promise<ProbeResult>;
  getConnectionSuggestions(): Promise<{ suggestions: ConnectionSuggestion[] }>;

  estimateRun(spec: unknown, replayHistory?: boolean): Promise<RunEstimate>;
  getLaunchDefaults(scenarioId: string): Promise<LaunchDefaults>;
  launchRun(scenarioId: string, request: LaunchRequest): Promise<Run>;
  regenerateRun(runId: string, acceptEngineChange?: boolean): Promise<Run>;
  retryRun(runId: string): Promise<Run>;
  retryDelivery(runId: string, sink: string): Promise<void>;
  skipDelivery(runId: string, sink: string): Promise<void>;
  listRuns(): Promise<{ runs: Run[] }>;
  getRun(id: string): Promise<Run>;

  startStream(runId: string, targetTps?: number, labelChannelEnabled?: boolean): Promise<Stream>;
  pauseStream(runId: string): Promise<Stream>;
  resumeStream(runId: string): Promise<Stream>;
  stopStream(runId: string): Promise<Stream>;
  getStream(runId: string): Promise<Stream>;
  listStreamSessions(runId: string): Promise<{ sessions: StreamSession[] }>;
  setStreamDestinations(runId: string, destinations: DestinationInput[]): Promise<void>;
}

function createRealApiClient(): TxLoomApiClient {
  return {
    listConnections: () => apiClient.get("/connections"),
    createConnection: (input) => apiClient.post("/connections", input),
    getConnection: (id) => apiClient.get(`/connections/${id}`),
    updateConnection: (id, input) => apiClient.patch(`/connections/${id}`, input),
    deleteConnection: (id) => apiClient.delete(`/connections/${id}`),
    testConnection: (input) => apiClient.post("/connections/test", input),
    testSavedConnection: (id) => apiClient.post(`/connections/${id}/test`),
    getConnectionSuggestions: () => apiClient.get("/connections/suggestions"),

    estimateRun: (spec, replayHistory) =>
      apiClient.post("/spec/estimate", { spec, replay_history: replayHistory }),
    getLaunchDefaults: (scenarioId) => apiClient.get(`/scenarios/${scenarioId}/launch-defaults`),
    launchRun: (scenarioId, request) => apiClient.post(`/scenarios/${scenarioId}/runs`, request),
    regenerateRun: (runId, acceptEngineChange) =>
      apiClient.post(`/runs/${runId}/regenerate`, { accept_engine_change: acceptEngineChange }),
    retryRun: (runId) => apiClient.post(`/runs/${runId}/retry`),
    retryDelivery: (runId, sink) => apiClient.post(`/runs/${runId}/deliveries/${sink}/retry`),
    skipDelivery: (runId, sink) => apiClient.post(`/runs/${runId}/deliveries/${sink}/skip`),
    listRuns: () => apiClient.get("/runs"),
    getRun: (id) => apiClient.get(`/runs/${id}`),

    startStream: (runId, targetTps, labelChannelEnabled) =>
      apiClient.post(`/runs/${runId}/stream/start`, {
        target_tps: targetTps,
        label_channel_enabled: labelChannelEnabled,
      }),
    pauseStream: (runId) => apiClient.post(`/runs/${runId}/stream/pause`),
    resumeStream: (runId) => apiClient.post(`/runs/${runId}/stream/resume`),
    stopStream: (runId) => apiClient.post(`/runs/${runId}/stream/stop`),
    getStream: (runId) => apiClient.get(`/runs/${runId}/stream`),
    listStreamSessions: (runId) => apiClient.get(`/runs/${runId}/stream/sessions`),
    setStreamDestinations: (runId, destinations) =>
      apiClient.put(`/runs/${runId}/stream/destinations`, { destinations }),
  };
}

let cachedClient: TxLoomApiClient | undefined;

/** Returns the mock adapter over fixtures when `VITE_TXLOOM_MOCK=1`, otherwise the real
 * HTTP-backed client (T012). The mock keeps the UI prototype and its component tests
 * Docker- and backend-free. */
export function createApiClient(): TxLoomApiClient {
  if (!cachedClient) {
    cachedClient =
      import.meta.env.VITE_TXLOOM_MOCK === "1" ? createMockApiClient() : createRealApiClient();
  }
  return cachedClient;
}
