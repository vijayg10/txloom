import { ApiClient } from "../http-client.js";
import type { Command } from "../registry.js";

interface SinkConnection {
  id: string;
  type: string;
  name: string;
  has_credentials: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
}

export const sinksListCommand: Command = {
  name: "sinks-list",
  description: "List sink connections: txloom sinks-list",
  async run() {
    const client = new ApiClient();
    const { sinks } = await client.get<{ sinks: SinkConnection[] }>("/sinks");
    for (const sink of sinks) {
      const tested = sink.last_test_at ? (sink.last_test_ok ? "ok" : "failed") : "untested";
      console.log(`${sink.id} ${sink.name} (${sink.type}) — ${tested}`);
    }
  },
};

export const sinksAddCommand: Command = {
  name: "sinks-add",
  description: "Add a sink connection: txloom sinks-add <type> <name> <config_json>",
  async run(args) {
    const [type, name, configJson] = args;
    if (!type || !name || !configJson) {
      throw new Error("Usage: txloom sinks-add <type> <name> <config_json>");
    }
    const client = new ApiClient();
    const sink = await client.post<SinkConnection>("/sinks", {
      type,
      name,
      config: JSON.parse(configJson) as Record<string, unknown>,
    });
    console.log(`sink ${sink.id}: ${sink.name} (${sink.type})`);
  },
};

export const sinksTestCommand: Command = {
  name: "sinks-test",
  description: "Test a sink connection: txloom sinks-test <sink_id>",
  async run(args) {
    const [sinkId] = args;
    if (!sinkId) throw new Error("Usage: txloom sinks-test <sink_id>");
    const client = new ApiClient();
    const result = await client.post<{ ok: boolean; detail: string }>(`/sinks/${sinkId}/test`);
    console.log(`${result.ok ? "ok" : "failed"}: ${result.detail}`);
  },
};
