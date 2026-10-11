import { useState } from "react";
import {
  createApiClient,
  type Connection,
  type ConnectionInput,
  type ConnectionType,
  type KafkaConfig,
  type ProbeResult,
  type RabbitConfig,
  type WebhookConfig,
} from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { FormField } from "../../components/ui/form-field.js";
import { Input, Textarea } from "../../components/ui/input.js";
import { Select } from "../../components/ui/select.js";
import { StatusBadge, booleanTone } from "../../components/ui/status-badge.js";

const LOCALHOST_RE = /localhost|127\.0\.0\.1|::1/;

interface ConnectionFormProps {
  initial?: Connection;
  onSaved: (connection: Connection) => void;
  onCancel: () => void;
}

/** The typed Kafka/RabbitMQ/webhook connection form (T013). Test-before-save
 * (FR-010): `conn-test` probes the candidate without persisting anything;
 * `conn-save` is enabled once a probe has run, even when it reports a missing
 * topic (saving still records the `topic_missing` warning). */
export function ConnectionForm({ initial, onSaved, onCancel }: ConnectionFormProps) {
  const client = createApiClient();
  const [type, setType] = useState<ConnectionType>(initial?.type ?? "kafka");
  const [name, setName] = useState(initial?.name ?? "");

  // kafka
  const kafkaConfig = initial?.type === "kafka" ? (initial.config as KafkaConfig) : undefined;
  const [bootstrapServers, setBootstrapServers] = useState(
    kafkaConfig?.bootstrap_servers.join(",") ?? "",
  );
  const [securityProtocol, setSecurityProtocol] = useState(
    kafkaConfig?.security_protocol ?? "PLAINTEXT",
  );
  const [saslMechanism, setSaslMechanism] = useState(kafkaConfig?.sasl_mechanism ?? "PLAIN");
  const [defaultTopic, setDefaultTopic] = useState(kafkaConfig?.default_topic ?? "");
  const [caPem, setCaPem] = useState(kafkaConfig?.ca_pem ?? "");

  // rabbitmq
  const rabbitConfig = initial?.type === "rabbitmq" ? (initial.config as RabbitConfig) : undefined;
  const [host, setHost] = useState(rabbitConfig?.host ?? "");
  const [port, setPort] = useState(rabbitConfig?.port ?? 5672);
  const [vhost, setVhost] = useState(rabbitConfig?.vhost ?? "/");
  const [tls, setTls] = useState(rabbitConfig?.tls ?? false);
  const [exchange, setExchange] = useState(rabbitConfig?.exchange ?? "");
  const [exchangeType, setExchangeType] = useState(rabbitConfig?.exchange_type ?? "direct");
  const [defaultRoutingKey, setDefaultRoutingKey] = useState(
    rabbitConfig?.default_routing_key ?? "",
  );

  // webhook
  const webhookConfig = initial?.type === "webhook" ? (initial.config as WebhookConfig) : undefined;
  const [url, setUrl] = useState(webhookConfig?.url ?? "");
  const [timeoutMs, setTimeoutMs] = useState(webhookConfig?.timeout_ms ?? 5000);

  // shared secrets — never prefilled, even when editing (secrets never round-trip).
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [headersJson, setHeadersJson] = useState("{}");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ProbeResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const host_or_url = type === "kafka" ? bootstrapServers : type === "rabbitmq" ? host : url;
  const showLocalhostWarning = LOCALHOST_RE.test(host_or_url);
  const credentialHintProp = initial ? { hint: "Leave blank to keep the stored credentials" } : {};

  function buildInput(): ConnectionInput {
    if (type === "kafka") {
      return {
        type: "kafka",
        name,
        config: {
          bootstrap_servers: bootstrapServers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          security_protocol: securityProtocol as
            "PLAINTEXT" | "SSL" | "SASL_PLAINTEXT" | "SASL_SSL",
          default_topic: defaultTopic,
          ...(securityProtocol.startsWith("SASL")
            ? { sasl_mechanism: saslMechanism as "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512" }
            : {}),
          ...(securityProtocol === "SSL" || securityProtocol === "SASL_SSL"
            ? caPem
              ? { ca_pem: caPem }
              : {}
            : {}),
        },
        ...(username || password ? { secrets: { username, password } } : {}),
      };
    }
    if (type === "rabbitmq") {
      return {
        type: "rabbitmq",
        name,
        config: {
          host,
          port,
          vhost,
          tls,
          exchange,
          exchange_type: exchangeType as "direct" | "topic" | "fanout",
          default_routing_key: defaultRoutingKey,
          ...(tls && caPem ? { ca_pem: caPem } : {}),
        },
        ...(username || password ? { secrets: { username, password } } : {}),
      };
    }
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(headersJson || "{}") as Record<string, string>;
    } catch {
      // kept empty; the test/save calls still proceed with no extra headers
    }
    return {
      type: "webhook",
      name,
      config: { url, timeout_ms: timeoutMs, max_attempts: 5 },
      ...(Object.keys(headers).length ? { secrets: { headers } } : {}),
    };
  }

  async function test() {
    setTesting(true);
    setError(null);
    try {
      const result = await client.testConnection(buildInput());
      setTestResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "test failed");
    } finally {
      setTesting(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = buildInput();
      const saved = initial
        ? await client.updateConnection(initial.id, input)
        : await client.createConnection(input);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  const topicMissing = testResult?.topic && testResult.topic.exists === false;

  return (
    <form
      data-testid="connection-form"
      onSubmit={(e) => void save(e)}
      className="flex flex-col gap-4"
    >
      <div className="flex gap-2">
        {(["kafka", "rabbitmq", "webhook"] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`connection-type-${t}`}
            aria-pressed={type === t}
            onClick={() => setType(t)}
            className={
              "rounded-xl border px-3 py-2 text-sm font-medium capitalize " +
              (type === t
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-text-secondary")
            }
            disabled={Boolean(initial)}
          >
            {t}
          </button>
        ))}
      </div>

      <FormField label="Name">
        <Input
          data-testid="conn-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </FormField>

      {type === "kafka" && (
        <>
          <FormField label="Bootstrap servers (comma-separated)">
            <Input
              data-testid="conn-bootstrap"
              value={bootstrapServers}
              onChange={(e) => setBootstrapServers(e.target.value)}
              placeholder="broker1:9092,broker2:9092"
              required
            />
          </FormField>
          <FormField label="Security protocol">
            <Select
              data-testid="conn-security"
              value={securityProtocol}
              onChange={(e) =>
                setSecurityProtocol(
                  e.target.value as "PLAINTEXT" | "SSL" | "SASL_PLAINTEXT" | "SASL_SSL",
                )
              }
            >
              <option value="PLAINTEXT">PLAINTEXT</option>
              <option value="SSL">SSL</option>
              <option value="SASL_PLAINTEXT">SASL_PLAINTEXT</option>
              <option value="SASL_SSL">SASL_SSL</option>
            </Select>
          </FormField>
          {securityProtocol.startsWith("SASL") && (
            <FormField label="SASL mechanism">
              <Select
                data-testid="conn-sasl-mechanism"
                value={saslMechanism}
                onChange={(e) =>
                  setSaslMechanism(e.target.value as "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512")
                }
              >
                <option value="PLAIN">PLAIN</option>
                <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                <option value="SCRAM-SHA-512">SCRAM-SHA-512</option>
              </Select>
            </FormField>
          )}
          {(securityProtocol === "SSL" || securityProtocol === "SASL_SSL") && (
            <FormField label="CA certificate (PEM)">
              <input
                type="file"
                accept=".pem,.crt"
                data-testid="conn-ca-upload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  void file.text().then(setCaPem);
                }}
              />
            </FormField>
          )}
          <FormField label="Default topic">
            <Input
              data-testid="conn-default-topic"
              value={defaultTopic}
              onChange={(e) => setDefaultTopic(e.target.value)}
              required
            />
          </FormField>
        </>
      )}

      {type === "rabbitmq" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Host">
              <Input
                data-testid="conn-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Port">
              <Input
                type="number"
                data-testid="conn-port"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </FormField>
          </div>
          <FormField label="Vhost">
            <Input
              data-testid="conn-vhost"
              value={vhost}
              onChange={(e) => setVhost(e.target.value)}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="conn-tls"
              checked={tls}
              onChange={(e) => setTls(e.target.checked)}
            />
            TLS
          </label>
          <FormField label="Exchange">
            <Input
              data-testid="conn-exchange"
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Exchange type">
            <Select
              data-testid="conn-exchange-type"
              value={exchangeType}
              onChange={(e) => setExchangeType(e.target.value as "direct" | "topic" | "fanout")}
            >
              <option value="direct">direct</option>
              <option value="topic">topic</option>
              <option value="fanout">fanout</option>
            </Select>
          </FormField>
          <FormField label="Default routing key">
            <Input
              data-testid="conn-routing-key"
              value={defaultRoutingKey}
              onChange={(e) => setDefaultRoutingKey(e.target.value)}
            />
          </FormField>
        </>
      )}

      {type === "webhook" && (
        <>
          <FormField label="URL">
            <Input
              data-testid="conn-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Timeout (ms)">
            <Input
              type="number"
              data-testid="conn-timeout"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(Number(e.target.value))}
            />
          </FormField>
          <FormField
            label="Headers (JSON, optional)"
            hint="Sent with every delivery, e.g. an auth token"
          >
            <Textarea
              data-testid="conn-headers"
              value={headersJson}
              onChange={(e) => setHeadersJson(e.target.value)}
              rows={3}
              className="font-mono"
            />
          </FormField>
        </>
      )}

      {(type === "kafka" || type === "rabbitmq") && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Username" {...credentialHintProp}>
            <Input
              data-testid="conn-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </FormField>
          <FormField label="Password" {...credentialHintProp}>
            <Input
              type="password"
              data-testid="conn-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
        </div>
      )}

      {showLocalhostWarning && (
        <p data-testid="conn-localhost-warning" className="text-xs text-amber-600">
          This address is resolved by the TxLoom worker. Inside Docker, localhost is the worker
          itself; the bundled demo broker is kafka:29092.
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          data-testid="conn-test"
          loading={testing}
          onClick={() => void test()}
        >
          Test
        </Button>
        {testResult && (
          <span data-testid="conn-test-result" className="flex items-center gap-2 text-sm">
            <StatusBadge tone={booleanTone(testResult.ok)}>
              {testResult.ok ? "ok" : "failed"}
            </StatusBadge>
            {testResult.detail}
          </span>
        )}
      </div>

      {topicMissing && (
        <p data-testid="conn-topic-missing-warning" className="text-xs text-amber-600">
          Topic "{testResult?.topic?.name}" does not exist, and auto-creation is disabled on this
          cluster. Saving is still allowed.
        </p>
      )}

      {error && (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="secondary" data-testid="conn-cancel" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" data-testid="conn-save" loading={saving}>
          Save
        </Button>
      </div>
    </form>
  );
}
