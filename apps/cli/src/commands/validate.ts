import { readFile } from "node:fs/promises";
import { ApiClient } from "../http-client.js";
import type { Command } from "../registry.js";

interface ValidationResult {
  valid: boolean;
  violations: { path: string; code: string; message: string }[];
}

export const validateCommand: Command = {
  name: "validate",
  description: "Validate a spec JSON file: txloom validate <spec.json>",
  async run(args) {
    const [specPath] = args;
    if (!specPath) throw new Error("Usage: txloom validate <spec.json>");

    const spec = JSON.parse(await readFile(specPath, "utf-8"));
    const client = new ApiClient();
    const result = await client.post<ValidationResult>("/spec/validate", spec);

    if (result.valid) {
      console.log("valid");
      return;
    }
    console.log(`invalid — ${result.violations.length} violation(s):`);
    for (const violation of result.violations) {
      console.log(`  ${violation.path}  [${violation.code}]  ${violation.message}`);
    }
    process.exitCode = 1;
  },
};
