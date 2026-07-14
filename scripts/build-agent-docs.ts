import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderAuthoringDocsMarkdown } from "@txloom/agent-tools";

const repoRoot = path.join(fileURLToPath(import.meta.url), "../..");
const outDir = path.join(repoRoot, "docs", "agent");

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "README.md"), renderAuthoringDocsMarkdown());

console.log(`wrote ${path.join("docs", "agent", "README.md")}`);
