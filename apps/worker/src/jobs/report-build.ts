import path from "node:path";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { mergeRealismReport, type PartitionRealismStats } from "@txloom/engine";

export interface ReportBuildJobData {
  runId: string;
  dataDir: string;
  benchmarkRefs: Record<string, unknown> | null;
}

export interface ReportBuildDeps {
  connection: ConnectionOptions;
  onReportReady: (data: ReportBuildJobData, reportPath: string) => Promise<void>;
}

/** Merges every partition's streaming realism stats (written alongside its
 * truth Parquet segment by partition-worker.ts) into `report.json` at run
 * completion — no second pass over the truth store (D17). */
export function startReportBuildWorker(deps: ReportBuildDeps): Worker<ReportBuildJobData> {
  return new Worker<ReportBuildJobData>(
    "report-build",
    async (job: Job<ReportBuildJobData>) => {
      const { runId, dataDir, benchmarkRefs } = job.data;
      const truthDir = path.join(dataDir, "runs", runId, "truth");
      const files = (await readdir(truthDir)).filter((f) => f.endsWith(".stats.json"));

      const stats: PartitionRealismStats[] = await Promise.all(
        files.map(
          async (file) =>
            JSON.parse(await readFile(path.join(truthDir, file), "utf-8")) as PartitionRealismStats,
        ),
      );

      const report = mergeRealismReport(stats, benchmarkRefs);
      const reportPath = path.join(dataDir, "runs", runId, "report.json");
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      await deps.onReportReady(job.data, reportPath);
      return report;
    },
    { connection: deps.connection },
  );
}
