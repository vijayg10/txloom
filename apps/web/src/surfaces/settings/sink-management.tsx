import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

type SinkType = "file" | "kafka" | "rabbitmq" | "webhook";

interface SinkConnection {
  id: string;
  type: SinkType;
  name: string;
  config: Record<string, unknown>;
  has_credentials: boolean;
  last_test_at: string | null;
  last_test_ok: boolean | null;
}

/** Connections & settings: sink management (FR-036 §6) — add a connection,
 * test it, see the last test result. Credentials are write-only: the form
 * accepts them but the list never receives anything back except
 * `has_credentials`. */
export function SinkManagement() {
  const [sinks, setSinks] = useState<SinkConnection[] | null>(null);
  const [type, setType] = useState<SinkType>("kafka");
  const [name, setName] = useState("");
  const [configJson, setConfigJson] = useState("{}");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; detail: string }>>(
    {},
  );

  function reload() {
    apiClient
      .get<{ sinks: SinkConnection[] }>("/sinks")
      .then((body) => setSinks(body.sinks))
      .catch(() => setSinks([]));
  }

  useEffect(reload, []);

  async function addSink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const config = JSON.parse(configJson) as Record<string, unknown>;
      const body: Record<string, unknown> = { type, name, config };
      if (username || password) body.credentials = { username, password };
      await apiClient.post("/sinks", body);
      setName("");
      setConfigJson("{}");
      setUsername("");
      setPassword("");
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add sink");
    }
  }

  async function testSink(id: string) {
    const result = await apiClient.post<{ ok: boolean; detail: string }>(`/sinks/${id}/test`);
    setTestResults((prev) => ({ ...prev, [id]: result }));
    reload();
  }

  async function removeSink(id: string) {
    await apiClient.delete(`/sinks/${id}`);
    reload();
  }

  return (
    <section className="sink-management">
      <h2>Sink connections</h2>

      <ul className="sink-list">
        {(sinks ?? []).map((sink) => (
          <li key={sink.id}>
            <strong>{sink.name}</strong> ({sink.type})
            {sink.has_credentials ? " — credentials set" : ""}
            {sink.last_test_at && <span> — last test: {sink.last_test_ok ? "ok" : "failed"}</span>}
            <button type="button" onClick={() => void testSink(sink.id)}>
              Test connection
            </button>
            <button type="button" onClick={() => void removeSink(sink.id)}>
              Remove
            </button>
            {testResults[sink.id] && <p>{testResults[sink.id]!.detail}</p>}
          </li>
        ))}
      </ul>

      <form onSubmit={(e) => void addSink(e)}>
        <h3>Add a sink</h3>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as SinkType)}>
            <option value="file">File</option>
            <option value="kafka">Kafka</option>
            <option value="rabbitmq">RabbitMQ</option>
            <option value="webhook">Webhook</option>
          </select>
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Config (JSON)
          <textarea value={configJson} onChange={(e) => setConfigJson(e.target.value)} />
        </label>
        {(type === "kafka" || type === "rabbitmq") && (
          <>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </>
        )}
        <button type="submit">Add sink</button>
        {error && <p className="sink-error">{error}</p>}
      </form>
    </section>
  );
}
