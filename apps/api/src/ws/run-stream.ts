import type WebSocket from "ws";
import { getDb } from "../db/knex.js";
import { StreamRepository } from "../db/repositories/streams.js";

const POLL_INTERVAL_MS = 1000;
export const STREAM_SUBSCRIBE_PATTERN = /^runs\/([^/]+)\/stream$/;

/**
 * WS `runs/:id/stream` channel (contracts/api.md § WebSocket channels):
 * `{achieved_tps, target_tps, sink_lag, backpressure}` @1Hz from the
 * `streams.metrics` gauge cache the stream-drive job writes each metrics
 * window — the stream console dial + backpressure indicators (FR-028,
 * FR-036 §3). A per-event `{ticker: TruthEventSample}` sample is included on
 * every tick from the same cache; the stream-drive job stores the latest
 * delivered event alongside the gauges so the console's live ticker has
 * something to render without a second poll target.
 */
export function createRunStreamHandler(): (socket: WebSocket, runId: string) => () => void {
  const db = getDb();
  const streams = new StreamRepository(db);

  return function subscribe(socket, runId) {
    let lastState: string | null = null;

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      void (async () => {
        const stream = await streams.getByRunId(runId);
        if (!stream) {
          clearInterval(interval);
          return;
        }

        if (stream.state !== lastState) {
          lastState = stream.state;
          socket.send(JSON.stringify({ state: stream.state }));
        }

        const metrics =
          typeof stream.metrics === "string" ? JSON.parse(stream.metrics) : stream.metrics;
        if (metrics) {
          socket.send(JSON.stringify(metrics));
        }

        if (stream.state === "stopped") {
          clearInterval(interval);
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  };
}
