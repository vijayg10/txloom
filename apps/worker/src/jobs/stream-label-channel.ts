import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { LabelRecord } from "@txloom/engine";

/**
 * Opt-in parallel label channel for streamed events (FR-030a): appends each
 * live event's ground-truth label as one JSON line to
 * `runs/<run_id>/stream-labels.jsonl`, independent of whichever sink the
 * delivered events go to — the streaming label channel is a sink-level
 * channel of its own, not a field mixed into the delivered payload
 * (contracts/api.md § Contract invariants).
 */
export class StreamLabelChannel {
  private readonly ready: Promise<void>;

  constructor(
    private readonly dataDir: string,
    private readonly runId: string,
  ) {
    this.ready = mkdir(path.join(dataDir, "runs", runId), { recursive: true }).then(
      () => undefined,
    );
  }

  private filePath(): string {
    return path.join(this.dataDir, "runs", this.runId, "stream-labels.jsonl");
  }

  async append(label: LabelRecord): Promise<void> {
    await this.ready;
    await appendFile(this.filePath(), JSON.stringify(label) + "\n", "utf-8");
  }
}
