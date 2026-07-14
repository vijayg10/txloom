import { ApiClient } from "../http-client.js";
import type { Command } from "../registry.js";

interface TruthEventsPage {
  events: Array<{
    event_id: string;
    ts: string;
    type: string;
    status: string;
    amount: number;
    label: { typology: string | null; actor_id: string | null } | null;
  }>;
  next_cursor: string | null;
}

interface ActorStory {
  actor_id: string;
  typology: string;
  steps: Array<{ campaign_step: number; event: { event_id: string; ts: string; type: string } }>;
}

export const truthFilterCommand: Command = {
  name: "truth-filter",
  description:
    "Browse ground truth: txloom truth-filter <run_id> [--typology T] [--actor-id A] [--status S]",
  async run(args) {
    const [runId, ...rest] = args;
    if (!runId) {
      throw new Error(
        "Usage: txloom truth-filter <run_id> [--typology T] [--actor-id A] [--status S]",
      );
    }
    const params = new URLSearchParams();
    for (const [flag, key] of [
      ["--typology", "typology"],
      ["--actor-id", "actor_id"],
      ["--status", "status"],
    ] as const) {
      const index = rest.indexOf(flag);
      if (index >= 0 && rest[index + 1]) params.set(key, rest[index + 1]!);
    }

    const client = new ApiClient();
    const query = params.toString();
    const page = await client.get<TruthEventsPage>(
      `/runs/${runId}/truth/events${query ? `?${query}` : ""}`,
    );
    for (const event of page.events) {
      const label = event.label
        ? ` [${event.label.typology ?? "legit"}${event.label.actor_id ? ` actor=${event.label.actor_id}` : ""}]`
        : "";
      console.log(
        `${event.event_id} ${event.ts} ${event.type} ${event.status} ${event.amount}${label}`,
      );
    }
    if (page.next_cursor) console.log(`(more results — cursor=${page.next_cursor})`);
  },
};

export const truthActorStoryCommand: Command = {
  name: "truth-actor-story",
  description:
    "Show a fraud actor's campaign timeline: txloom truth-actor-story <run_id> <actor_id>",
  async run(args) {
    const [runId, actorId] = args;
    if (!runId || !actorId) throw new Error("Usage: txloom truth-actor-story <run_id> <actor_id>");
    const client = new ApiClient();
    const story = await client.get<ActorStory>(`/runs/${runId}/truth/actors/${actorId}/story`);
    console.log(`actor ${story.actor_id} — ${story.typology}`);
    for (const step of story.steps) {
      console.log(
        `  step ${step.campaign_step}: ${step.event.event_id} ${step.event.ts} ${step.event.type}`,
      );
    }
  },
};
