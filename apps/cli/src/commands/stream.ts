import { ApiClient } from "../http-client.js";
import type { Command } from "../registry.js";

interface StreamRow {
  id: string;
  state: string;
  target_tps: number;
}

export const streamStartCommand: Command = {
  name: "stream-start",
  description:
    "Start a stream: txloom stream-start <run_id> <sink_type> <sink_config_json> [target_tps]",
  async run(args) {
    const [runId, sinkType, sinkConfigJson, targetTps] = args;
    if (!runId || !sinkType || !sinkConfigJson) {
      throw new Error(
        "Usage: txloom stream-start <run_id> <sink_type> <sink_config_json> [target_tps]",
      );
    }
    const client = new ApiClient();
    const body: Record<string, unknown> = {
      sink: { type: sinkType, config: JSON.parse(sinkConfigJson) as Record<string, unknown> },
    };
    if (targetTps !== undefined) body.target_tps = Number(targetTps);
    const stream = await client.post<StreamRow>(`/runs/${runId}/stream/start`, body);
    console.log(`stream ${stream.id}: ${stream.state} @ ${stream.target_tps} tps`);
  },
};

function makeControlCommand(name: "pause" | "resume" | "stop"): Command {
  return {
    name: `stream-${name}`,
    description: `${name[0]!.toUpperCase()}${name.slice(1)} a stream: txloom stream-${name} <run_id>`,
    async run(args) {
      const [runId] = args;
      if (!runId) throw new Error(`Usage: txloom stream-${name} <run_id>`);
      const client = new ApiClient();
      const stream = await client.post<StreamRow>(`/runs/${runId}/stream/${name}`);
      console.log(`stream ${stream.id}: ${stream.state}`);
    },
  };
}

export const streamPauseCommand = makeControlCommand("pause");
export const streamResumeCommand = makeControlCommand("resume");
export const streamStopCommand = makeControlCommand("stop");

export const streamSetRateCommand: Command = {
  name: "stream-set-rate",
  description: "Live-adjust a stream's target TPS: txloom stream-set-rate <run_id> <target_tps>",
  async run(args) {
    const [runId, targetTps] = args;
    if (!runId || !targetTps)
      throw new Error("Usage: txloom stream-set-rate <run_id> <target_tps>");
    const client = new ApiClient();
    const stream = await client.request<StreamRow>("PATCH", `/runs/${runId}/stream`, {
      target_tps: Number(targetTps),
    });
    console.log(`stream ${stream.id}: target_tps now ${stream.target_tps}`);
  },
};
