import type {
  Connection,
  ExportManifest,
  ExportRequest,
  ConnectionInput,
  DestinationInput,
  LaunchRequest,
  ProbeResult,
  Run,
  Stream,
  TxLoomApiClient,
} from "../client.js";
import {
  makeConnections,
  makeConnectionSuggestions,
  makeEstimate,
  makeLaunchDefaults,
  makeRuns,
  makeStream,
  MOCK_SCENARIO_ID,
} from "./fixtures.js";

function delay<T>(value: T, ms = 150): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function localhostWarning(input: ConnectionInput): Connection["warnings"] {
  const host =
    input.type === "kafka"
      ? input.config.bootstrap_servers.join(",")
      : input.type === "rabbitmq"
        ? input.config.host
        : input.config.url;
  const isLocalhost = /localhost|127\.0\.0\.1|::1/.test(host);
  return isLocalhost
    ? [
        {
          code: "localhost_address" as const,
          message:
            "This address is resolved by the TxLoom worker. Inside Docker, localhost is the worker itself; the bundled demo broker is kafka:29092.",
        },
      ]
    : [];
}

function probeFor(input: ConnectionInput): ProbeResult {
  // staging-msk's shape (SASL_SSL with no stored secrets check) mocks an auth failure;
  // everything else succeeds, mirroring the fixtures in makeConnections().
  if (input.type === "kafka" && input.name === "staging-msk") {
    return {
      ok: false,
      stage: "auth",
      detail: "Authentication failed: invalid username or password.",
      latency_ms: 420,
    };
  }
  return {
    ok: true,
    stage: "done",
    detail: "Connected.",
    ...(input.type === "kafka"
      ? { topic: { name: input.config.default_topic, exists: true, partitions: 3 } }
      : {}),
    latency_ms: 80,
  };
}

/** The mock adapter (`VITE_TXLOOM_MOCK=1`): the full client surface over in-memory
 * fixtures, so the prototype and component tests never touch the network (T012). */
export function createMockApiClient(): TxLoomApiClient {
  let connections = makeConnections();
  const runs = makeRuns();
  const suggestionsDismissed = new Set<string>();
  let nextConnId = 100;
  let streamState: Stream["state"] = "idle";
  const exportsById = new Map<string, { manifest: ExportManifest; polls: number }>();
  let nextExportId = 1;

  function resolveDestinations(inputs: DestinationInput[] | undefined) {
    return (inputs ?? []).map((input) => {
      const conn = connections.find((c) => c.id === input.connection_id);
      return {
        ...input,
        connection_name: conn?.name ?? "unknown",
        connection_type: conn?.type ?? "kafka",
        connection_missing: !conn,
      };
    });
  }

  const client: TxLoomApiClient = {
    listConnections: () => delay({ connections }),
    createConnection: (input) => {
      const created: Connection = {
        id: `conn-${nextConnId++}`,
        type: input.type,
        name: input.name,
        config: input.config,
        has_credentials: Boolean(input.secrets),
        managed_by: "user",
        health: { last_test_at: null, ok: null, summary: null, stage: null },
        warnings: localhostWarning(input),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      connections = [...connections, created];
      return delay(created);
    },
    getConnection: (id) => {
      const conn = connections.find((c) => c.id === id);
      if (!conn) return Promise.reject(new Error(`connection ${id} not found`));
      return delay(conn);
    },
    updateConnection: (id, input) => {
      connections = connections.map((c) =>
        c.id === id
          ? {
              ...c,
              ...(input.name ? { name: input.name } : {}),
              ...(input.config
                ? { config: { ...c.config, ...input.config } as typeof c.config }
                : {}),
              updated_at: new Date().toISOString(),
            }
          : c,
      );
      const updated = connections.find((c) => c.id === id)!;
      return delay(updated);
    },
    deleteConnection: (id) => {
      connections = connections.filter((c) => c.id !== id);
      return delay(undefined);
    },
    testConnection: (input) => delay(probeFor(input), 400),
    testSavedConnection: (id) => {
      const conn = connections.find((c) => c.id === id);
      if (!conn) return Promise.reject(new Error(`connection ${id} not found`));
      return delay(
        probeFor({ type: conn.type, name: conn.name, config: conn.config } as ConnectionInput),
        400,
      );
    },
    getConnectionSuggestions: () => {
      const suggestions = makeConnectionSuggestions(connections).filter(
        (s) => !suggestionsDismissed.has(s.kind),
      );
      return delay({ suggestions });
    },

    estimateRun: (_spec, replayHistory) => delay(makeEstimate(replayHistory), 300),
    getLaunchDefaults: () => delay(makeLaunchDefaults()),
    launchRun: (scenarioId, request: LaunchRequest) => {
      const run: Run = {
        ...runs[0]!,
        id: `run-${Date.now()}`,
        scenario_id: scenarioId,
        mode: request.mode ?? "history_then_live",
        replay_history: request.replay_history ?? false,
        target_tps: request.target_tps ?? 50,
        launch_destinations: resolveDestinations(request.destinations),
        phase: "generating",
        status: "running",
      };
      runs.unshift(run);
      return delay(run, 300);
    },
    regenerateRun: (runId) => {
      const source = runs.find((r) => r.id === runId);
      if (!source) return Promise.reject(new Error(`run ${runId} not found`));
      const run: Run = { ...source, id: `run-${Date.now()}`, source_run_id: runId };
      runs.unshift(run);
      return delay(run);
    },
    retryRun: (runId) => {
      const run = runs.find((r) => r.id === runId);
      if (!run) return Promise.reject(new Error(`run ${runId} not found`));
      run.status = "running";
      return delay(run);
    },
    retryDelivery: () => delay(undefined),
    skipDelivery: () => delay(undefined),
    listRuns: () => delay({ runs }),
    getRun: (id) => {
      const run = runs.find((r) => r.id === id);
      if (!run) return Promise.reject(new Error(`run ${id} not found`));
      return delay(run);
    },

    createExport: (runId, request: ExportRequest) => {
      const run = runs.find((r) => r.id === runId);
      const sinks =
        (
          run?.spec_snapshot as
            { output?: { sinks?: { type: string; name: string }[] } } | undefined
        )?.output?.sinks ?? [];
      const fileSink = sinks.find((sink) => sink.type === "file");
      const manifest: ExportManifest = {
        export_id: `export-${nextExportId++}`,
        run_id: runId,
        format: request.format,
        include_labels: request.include_labels,
        source:
          request.source ?? (fileSink ? { kind: "sink", name: fileSink.name } : { kind: "truth" }),
        status: "queued",
        file_name: `data.${request.format}`,
        answer_key_file_name: request.include_labels ? null : `labels.${request.format}`,
      };
      exportsById.set(manifest.export_id, { manifest, polls: 0 });
      return delay(manifest);
    },
    // Each poll moves the export along: queued, then running, then completed.
    getExport: (_runId, exportId) => {
      const entry = exportsById.get(exportId);
      if (!entry) return Promise.reject(new Error(`export ${exportId} not found`));
      entry.polls += 1;
      entry.manifest = {
        ...entry.manifest,
        status: entry.polls === 1 ? "running" : "completed",
      };
      return delay(entry.manifest, 50);
    },

    startStream: (_runId, targetTps) => {
      streamState = "streaming";
      return delay({ ...makeStream(targetTps ?? 50), state: streamState });
    },
    pauseStream: () => {
      streamState = "paused";
      return delay({ ...makeStream(), state: streamState });
    },
    resumeStream: () => {
      streamState = "streaming";
      return delay({ ...makeStream(), state: streamState });
    },
    stopStream: () => {
      streamState = "stopped";
      return delay({ ...makeStream(), state: streamState });
    },
    getStream: () => delay({ ...makeStream(), state: streamState }),
    listStreamSessions: () => delay({ sessions: [makeStream().session!] }),
    setStreamDestinations: () => delay(undefined),
  };

  return client;
}

export { MOCK_SCENARIO_ID };
