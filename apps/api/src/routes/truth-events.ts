import { readdir } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { readParquet } from "@txloom/sinks";

async function listParquetFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".parquet"));
  } catch {
    return [];
  }
}

async function loadRunTruthAndLabels(dataDir: string, runId: string) {
  const truthDir = path.join(dataDir, "runs", runId, "truth");
  const labelsDir = path.join(dataDir, "runs", runId, "labels");

  const events: Record<string, unknown>[] = [];
  for (const file of await listParquetFiles(truthDir)) {
    for await (const row of readParquet(path.join(truthDir, file))) events.push(row);
  }

  const labelsByEventId = new Map<string, Record<string, unknown>>();
  for (const file of await listParquetFiles(labelsDir)) {
    for await (const row of readParquet(path.join(labelsDir, file))) {
      // corruption-only rows share event_id with a primary fraud/legit row; keep the primary one.
      if (row.corruption_type == null) labelsByEventId.set(row.event_id as string, row);
    }
  }

  return { events, labelsByEventId };
}

/** GET /runs/:id/truth/events — filter/browse ground truth by typology, actor,
 * status, with cursor pagination (FR-036 §5). v1 scans the run's Parquet
 * segments directly; a query-optimized truth index is a documented follow-up. */
export default async function truthEventsRoutes(app: FastifyInstance) {
  const dataDir = process.env.DATA_DIR ?? "./data";

  app.get("/runs/:id/truth/events", async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as {
      typology?: string;
      actor_id?: string;
      status?: string;
      cursor?: string;
      limit?: string;
    };

    const { events, labelsByEventId } = await loadRunTruthAndLabels(dataDir, id);

    type EventWithLabel = Record<string, unknown> & { label: Record<string, unknown> | null };
    let filtered: EventWithLabel[] = events.map((event) => ({
      ...event,
      label: labelsByEventId.get(event.event_id as string) ?? null,
    }));
    if (query.status) filtered = filtered.filter((e) => e.status === query.status);
    if (query.typology)
      filtered = filtered.filter(
        (e) => (e.label as Record<string, unknown> | null)?.typology === query.typology,
      );
    if (query.actor_id)
      filtered = filtered.filter(
        (e) => (e.label as Record<string, unknown> | null)?.actor_id === query.actor_id,
      );

    filtered.sort((a, b) => String(a.event_id).localeCompare(String(b.event_id)));
    if (query.cursor) filtered = filtered.filter((e) => String(e.event_id) > query.cursor!);

    const limit = query.limit ? Number(query.limit) : 100;
    const page = filtered.slice(0, limit);
    const last = page.at(-1);

    return {
      events: page,
      next_cursor: page.length === limit && last ? String(last.event_id) : null,
    };
  });
}
