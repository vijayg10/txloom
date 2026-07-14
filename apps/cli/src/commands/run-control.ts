import { ApiClient } from "../http-client.js";
import type { Command } from "../registry.js";

interface RunRow {
  id: string;
  status: string;
}

function makeControlCommand(name: "pause" | "resume" | "cancel" | "regenerate"): Command {
  return {
    name: `run-${name}`,
    description: `${name[0]!.toUpperCase()}${name.slice(1)} a run: txloom run-${name} <run_id>`,
    async run(args) {
      const [runId] = args;
      if (!runId) throw new Error(`Usage: txloom run-${name} <run_id>`);
      const client = new ApiClient();
      const run = await client.post<RunRow>(`/runs/${runId}/${name}`, {});
      console.log(`run ${run.id}: ${run.status}`);
    },
  };
}

export const runPauseCommand = makeControlCommand("pause");
export const runResumeCommand = makeControlCommand("resume");
export const runCancelCommand = makeControlCommand("cancel");
export const runRegenerateCommand = makeControlCommand("regenerate");

export const runStatusCommand: Command = {
  name: "run-status",
  description: "Show a run's status: txloom run-status <run_id>",
  async run(args) {
    const [runId] = args;
    if (!runId) throw new Error("Usage: txloom run-status <run_id>");
    const client = new ApiClient();
    const run = await client.get<RunRow>(`/runs/${runId}`);
    console.log(`run ${run.id}: ${run.status}`);
  },
};
