import { useState } from "react";
import { apiClient } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { FormField } from "../../components/ui/form-field.js";
import { Input } from "../../components/ui/input.js";
import { Select } from "../../components/ui/select.js";

type SinkType = "kafka" | "rabbitmq" | "webhook";

interface StreamRow {
  id: string;
  run_id: string;
  state: string;
}

/** Starts the live phase for a completed run (`POST /runs/:id/stream/start`).
 * v1's stream sink is supplied inline (broker/exchange/webhook address) rather
 * than resolved from a stored sink connection — see stream-control.ts's scope
 * note — so this form collects exactly that inline shape. */
export function StreamLauncher({ runId, onStarted }: { runId: string; onStarted?: () => void }) {
  const [type, setType] = useState<SinkType>("webhook");
  const [targetTps, setTargetTps] = useState("");
  const [kafkaBrokers, setKafkaBrokers] = useState("kafka:29092");
  const [kafkaTopic, setKafkaTopic] = useState("txloom.stream.e2e");
  const [rabbitUrl, setRabbitUrl] = useState("amqp://rabbitmq:5672");
  const [rabbitExchange, setRabbitExchange] = useState("txloom.stream.e2e");
  const [rabbitRoutingKey, setRabbitRoutingKey] = useState("txloom.stream.e2e");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function sinkPayload(): Record<string, unknown> {
    if (type === "kafka") {
      return {
        type: "kafka",
        config: { brokers: kafkaBrokers.split(",").map((b) => b.trim()), topic: kafkaTopic },
      };
    }
    if (type === "rabbitmq") {
      return {
        type: "rabbitmq",
        config: { url: rabbitUrl, exchange: rabbitExchange, routingKey: rabbitRoutingKey },
      };
    }
    return { type: "webhook", config: { url: webhookUrl } };
  }

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setStarting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { sink: sinkPayload() };
      if (targetTps) body.target_tps = Number(targetTps);
      await apiClient.post<StreamRow>(`/runs/${runId}/stream/start`, body);
      onStarted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to start stream");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start stream</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={(e) => void start(e)} className="flex flex-col gap-4">
          <div className="max-w-xs">
            <FormField label="Sink type">
              <Select
                data-testid="stream-sink-type"
                value={type}
                onChange={(e) => setType(e.target.value as SinkType)}
              >
                <option value="webhook">Webhook</option>
                <option value="kafka">Kafka</option>
                <option value="rabbitmq">RabbitMQ</option>
              </Select>
            </FormField>
          </div>

          {type === "kafka" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Brokers">
                <Input
                  data-testid="stream-kafka-brokers"
                  value={kafkaBrokers}
                  onChange={(e) => setKafkaBrokers(e.target.value)}
                />
              </FormField>
              <FormField label="Topic">
                <Input
                  data-testid="stream-kafka-topic"
                  value={kafkaTopic}
                  onChange={(e) => setKafkaTopic(e.target.value)}
                />
              </FormField>
            </div>
          )}

          {type === "rabbitmq" && (
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="URL">
                <Input
                  data-testid="stream-rabbitmq-url"
                  value={rabbitUrl}
                  onChange={(e) => setRabbitUrl(e.target.value)}
                />
              </FormField>
              <FormField label="Exchange">
                <Input
                  data-testid="stream-rabbitmq-exchange"
                  value={rabbitExchange}
                  onChange={(e) => setRabbitExchange(e.target.value)}
                />
              </FormField>
              <FormField label="Routing key">
                <Input
                  data-testid="stream-rabbitmq-routing-key"
                  value={rabbitRoutingKey}
                  onChange={(e) => setRabbitRoutingKey(e.target.value)}
                />
              </FormField>
            </div>
          )}

          {type === "webhook" && (
            <div className="max-w-md">
              <FormField label="URL">
                <Input
                  data-testid="stream-webhook-url"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  required
                />
              </FormField>
            </div>
          )}

          <div className="max-w-xs">
            <FormField
              label="Target TPS"
              hint="Optional — falls back to the spec's then_stream_tps"
            >
              <Input
                data-testid="stream-target-tps"
                value={targetTps}
                onChange={(e) => setTargetTps(e.target.value)}
              />
            </FormField>
          </div>

          <div>
            <Button
              type="submit"
              data-testid="stream-start-button"
              disabled={starting}
              loading={starting}
            >
              {starting ? "Starting…" : "Start stream"}
            </Button>
          </div>
          {error && (
            <p role="alert" data-testid="stream-start-error" className="text-danger text-sm">
              {error}
            </p>
          )}
        </form>
      </CardBody>
    </Card>
  );
}
