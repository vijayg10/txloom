import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { createApiClient } from "../../api/client.js";
import { FirstRunCard } from "./first-run.js";

const FIRST_RUN_TEMPLATE = "upi-instant-payments";

/** `/`: the first-run card on a fresh install (zero scenarios), otherwise a redirect to
 * `/scenarios` (FR-052). */
export function HomePage() {
  const navigate = useNavigate();
  const client = createApiClient();
  const [scenarioCount, setScenarioCount] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createApiClient()
      .listScenarios()
      .then((res) => setScenarioCount(res.scenarios.length))
      .catch(() => setScenarioCount(0));
  }, []);

  /** The saved `local-kafka` connection, registering the detected demo broker if it isn't yet. */
  async function localKafkaId(): Promise<string | null> {
    const { connections } = await client.listConnections();
    const saved = connections.find((c) => c.name === "local-kafka");
    if (saved) return saved.id;
    const { suggestions } = await client.getConnectionSuggestions();
    const suggestion = suggestions.find((s) => s.kind === "local_kafka");
    if (!suggestion) return null;
    return (await client.createConnection(suggestion.input)).id;
  }

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const connectionId = await localKafkaId();
      if (!connectionId) {
        setError(
          "No Kafka broker was found to send to. Start the bundled one with `docker compose --profile demo-brokers up`, then try again.",
        );
        return;
      }
      const scenario = await client.cloneTemplate(FIRST_RUN_TEMPLATE, "UPI fraud reference");
      const run = await client.launchRun(scenario.id, {
        mode: "history_then_live",
        destinations: scenario.spec.output.sinks
          .filter((sink) => sink.type === "kafka")
          .map((sink) => ({ sink: sink.name, connection_id: connectionId })),
      });
      navigate(`/runs/${run.id}/live`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the reference run.");
    } finally {
      setStarting(false);
    }
  }

  if (scenarioCount === null) return null;
  if (scenarioCount > 0) return <Navigate to="/scenarios" replace />;

  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <FirstRunCard onStart={() => void start()} starting={starting} error={error} />
    </div>
  );
}
