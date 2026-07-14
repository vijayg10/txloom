import { ApiClient } from "../http-client.js";
import type { Command } from "../registry.js";

interface RunRow {
  id: string;
  status: string;
}

export const runCommand: Command = {
  name: "run",
  description: "Launch a run: txloom run <scenario_id> [--seed N]",
  async run(args) {
    const [scenarioId, ...rest] = args;
    if (!scenarioId) throw new Error("Usage: txloom run <scenario_id> [--seed N]");

    const seedFlagIndex = rest.indexOf("--seed");
    const seed = seedFlagIndex >= 0 ? Number(rest[seedFlagIndex + 1]) : undefined;

    const client = new ApiClient();
    const body = seed !== undefined ? { seed } : {};
    const run = await client.post<RunRow>(`/scenarios/${scenarioId}/runs`, body);
    console.log(`launched run ${run.id} (status: ${run.status})`);
  },
};
