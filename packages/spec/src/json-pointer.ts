/** RFC 6901 JSON Pointer helpers — the location format every InvariantViolation uses. */

export function toPointer(segments: ReadonlyArray<string | number>): string {
  if (segments.length === 0) return "";
  return (
    "/" +
    segments.map((segment) => String(segment).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")
  );
}

export function fromPointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  const parts = pointer.replace(/^\//, "").split("/");
  return parts.map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}
