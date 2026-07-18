import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { FormField } from "../../components/ui/form-field.js";
import { Input, Textarea } from "../../components/ui/input.js";
import { Select } from "../../components/ui/select.js";
import { StatusBadge, booleanTone } from "../../components/ui/status-badge.js";

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
    <Card>
      <CardHeader>
        <CardTitle>Sink connections</CardTitle>
      </CardHeader>
      <CardBody>
        <ul className="divide-border mb-6 divide-y" data-testid="sink-list">
          {(sinks ?? []).map((sink) => (
            <li
              key={sink.id}
              data-testid="sink-list-item"
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <div className="flex-1">
                <p className="text-text font-medium">
                  {sink.name} <span className="text-text-secondary font-normal">({sink.type})</span>
                </p>
                <p className="text-text-secondary text-xs">
                  {sink.has_credentials ? "Credentials set" : "No credentials"}
                  {sink.last_test_at ? (
                    <>
                      {" — last test: "}
                      <StatusBadge
                        tone={booleanTone(sink.last_test_ok)}
                        className="ml-1 align-middle"
                      >
                        {sink.last_test_ok ? "ok" : "failed"}
                      </StatusBadge>
                    </>
                  ) : null}
                </p>
                {testResults[sink.id] ? (
                  <p className="text-text-secondary mt-1 text-xs">{testResults[sink.id]!.detail}</p>
                ) : null}
              </div>
              <Button
                variant="secondary"
                data-testid="sink-test-button"
                onClick={() => void testSink(sink.id)}
              >
                Test connection
              </Button>
              <Button
                variant="secondary"
                data-testid="sink-remove-button"
                onClick={() => void removeSink(sink.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>

        <form
          data-testid="add-sink-form"
          onSubmit={(e) => void addSink(e)}
          className="border-border flex flex-col gap-4 border-t pt-6"
        >
          <h3 className="text-text text-sm font-semibold">Add a sink</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Type">
              <Select
                data-testid="sink-type"
                value={type}
                onChange={(e) => setType(e.target.value as SinkType)}
              >
                <option value="file">File</option>
                <option value="kafka">Kafka</option>
                <option value="rabbitmq">RabbitMQ</option>
                <option value="webhook">Webhook</option>
              </Select>
            </FormField>
            <FormField label="Name">
              <Input
                data-testid="sink-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </FormField>
          </div>
          <FormField label="Config (JSON)">
            <Textarea
              data-testid="sink-config"
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              rows={4}
              className="font-mono"
            />
          </FormField>
          {(type === "kafka" || type === "rabbitmq") && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Username">
                <Input
                  data-testid="sink-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </FormField>
              <FormField label="Password">
                <Input
                  type="password"
                  data-testid="sink-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </FormField>
            </div>
          )}
          <div>
            <Button type="submit" data-testid="add-sink-submit">
              Add sink
            </Button>
          </div>
          {error && (
            <p role="alert" data-testid="add-sink-error" className="text-danger text-sm">
              {error}
            </p>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
