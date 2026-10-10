import { ApiClient } from "../http-client.js";
import type { Command } from "../registry.js";

interface RunRow {
  id: string;
  status: string;
}

const USAGE =
  "Usage: txloom run <scenario_id> [--seed N] [--dest sink=connection_id[:topic]]... [--replay-history]";

interface Destination {
  sink: string;
  connection_id: string;
  topic?: string;
}

/** `sink=connection_id[:topic]` — the topic is optional and defaults to the connection's. */
function parseDest(value: string): Destination {
  const eq = value.indexOf("=");
  if (eq < 1) throw new Error(`--dest expects sink=connection[:topic], got "${value}"`);
  const sink = value.slice(0, eq);
  const [connectionId, ...topicParts] = value.slice(eq + 1).split(":");
  if (!connectionId) throw new Error(`--dest "${value}" is missing a connection id`);
  const topic = topicParts.join(":");
  return { sink, connection_id: connectionId, ...(topic ? { topic } : {}) };
}

export const runCommand: Command = {
  name: "run",
  description: USAGE,
  async run(args) {
    const [scenarioId, ...rest] = args;
    if (!scenarioId) throw new Error(USAGE);

    let seed: string | undefined;
    const destinations: Destination[] = [];
    let replayHistory = false;
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i];
      const value = rest[i + 1];
      if (flag === "--replay-history") {
        replayHistory = true;
      } else if (flag === "--seed" && value !== undefined) {
        seed = value;
        i++;
      } else if (flag === "--dest" && value !== undefined) {
        destinations.push(parseDest(value));
        i++;
      } else {
        throw new Error(`Unexpected argument "${flag}"\n${USAGE}`);
      }
    }

    const client = new ApiClient();
    const body = {
      ...(seed !== undefined ? { seed } : {}),
      ...(destinations.length > 0 ? { destinations } : {}),
      ...(replayHistory ? { replay_history: true } : {}),
    };
    const run = await client.post<RunRow>(`/scenarios/${scenarioId}/runs`, body);
    console.log(`launched run ${run.id} (status: ${run.status})`);
  },
};
