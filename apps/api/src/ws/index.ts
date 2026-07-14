import type { FastifyInstance } from "fastify";
import { PROGRESS_SUBSCRIBE_PATTERN, createRunProgressHandler } from "./run-progress.js";
import { STREAM_SUBSCRIBE_PATTERN, createRunStreamHandler } from "./run-stream.js";

/**
 * Single `/ws` route (contracts/api.md § WebSocket channels): one socket per
 * connection, subscribing to one of `runs/:id/progress` or `runs/:id/stream`
 * via `{subscribe: "<channel>"}`. Fastify only allows one handler per
 * method+path, so every channel's subscribe pattern is dispatched from here
 * rather than each channel registering its own route.
 */
export default async function wsRoutes(app: FastifyInstance) {
  const progressHandler = createRunProgressHandler();
  const streamHandler = createRunStreamHandler();

  app.get("/ws", { websocket: true }, (socket) => {
    let stop: (() => void) | null = null;

    socket.on("message", (raw: Buffer) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const subscribe = (message as { subscribe?: string }).subscribe;
      if (typeof subscribe !== "string") return;

      stop?.();
      stop = null;

      const progressMatch = PROGRESS_SUBSCRIBE_PATTERN.exec(subscribe);
      if (progressMatch) {
        stop = progressHandler(socket, progressMatch[1]!);
        return;
      }
      const streamMatch = STREAM_SUBSCRIBE_PATTERN.exec(subscribe);
      if (streamMatch) {
        stop = streamHandler(socket, streamMatch[1]!);
      }
    });

    socket.on("close", () => stop?.());
  });
}
