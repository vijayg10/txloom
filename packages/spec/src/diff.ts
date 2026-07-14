import { toPointer } from "./json-pointer.js";

export interface SpecDiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: unknown;
  after?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural diff between two spec versions, used by the scenario workspace's
 * version-history per-version comparison surface (FR-036 §1, constitution Principle IV). */
export function diffSpecs(
  before: unknown,
  after: unknown,
  path: (string | number)[] = [],
): SpecDiffEntry[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].flatMap((key) => diffSpecs(before[key], after[key], [...path, key]));
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const maxLength = Math.max(before.length, after.length);
    const entries: SpecDiffEntry[] = [];
    for (let i = 0; i < maxLength; i++) {
      entries.push(...diffSpecs(before[i], after[i], [...path, i]));
    }
    return entries;
  }

  const same = JSON.stringify(before) === JSON.stringify(after);
  if (same) return [];

  if (before === undefined) {
    return [{ path: toPointer(path), kind: "added", after }];
  }
  if (after === undefined) {
    return [{ path: toPointer(path), kind: "removed", before }];
  }
  return [{ path: toPointer(path), kind: "changed", before, after }];
}
