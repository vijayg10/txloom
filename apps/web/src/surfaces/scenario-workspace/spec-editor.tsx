import { useCallback, useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { apiClient } from "../../api/client.js";

interface InvariantViolation {
  path: string;
  code: string;
  message: string;
  severity?: "error" | "warning";
}

interface ValidationResult {
  valid: boolean;
  violations: InvariantViolation[];
}

const MODEL_URI = "inmemory://model/spec.json";

/** Monaco editor with schema-aware autocomplete (JSON Schema fetched from
 * GET /spec/schema) and inline invariant markers sourced from POST
 * /spec/validate — the same located-violation model the API and MCP server
 * use (FR-004/010, constitution Principle IV). */
export function SpecEditor({
  initialSpec,
  onValidChange,
}: {
  initialSpec: object;
  onValidChange?: (spec: object, valid: boolean) => void;
}) {
  const [value, setValue] = useState(() => JSON.stringify(initialSpec, null, 2));
  const [violations, setViolations] = useState<InvariantViolation[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validate = useCallback(
    async (text: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setViolations([{ path: "", code: "json-syntax-error", message: "Not valid JSON" }]);
        return;
      }
      try {
        const result = await apiClient.post<ValidationResult>("/spec/validate", parsed);
        setViolations(result.violations);
        onValidChange?.(parsed as object, result.valid);
      } catch {
        // Network/API errors don't clear existing markers — the editor stays usable offline.
      }
    },
    [onValidChange],
  );

  useEffect(() => {
    // Runs once against the initial spec only — `handleChange` drives
    // re-validation on every subsequent edit via its own debounce.
    void validate(value);
  }, []);

  function handleChange(next: string | undefined) {
    const text = next ?? "";
    setValue(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void validate(text), 400);
  }

  const handleMount: OnMount = async (editor, monaco) => {
    try {
      const schema = await apiClient.get<object>("/spec/schema");
      monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
        validate: true,
        schemas: [
          { uri: "https://txloom.dev/schema/simulation-spec.json", fileMatch: [MODEL_URI], schema },
        ],
      });
    } catch {
      // Schema fetch failure just disables autocomplete — validation still runs via the API.
    }
    void editor;
  };

  return (
    <div>
      <Editor
        height="70vh"
        defaultLanguage="json"
        path={MODEL_URI}
        value={value}
        onChange={handleChange}
        onMount={handleMount}
        options={{ minimap: { enabled: false } }}
      />
      {violations.length > 0 && (
        <ul className="spec-editor-violations" data-testid="spec-editor-violations">
          {violations.map((v) => (
            <li key={`${v.path}-${v.code}`} data-severity={v.severity ?? "error"}>
              <code>{v.path || "(root)"}</code> — {v.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
