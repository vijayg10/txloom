import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { apiClient, createApiClient } from "../../api/client.js";
import { MOCK_SCENARIO_ID } from "../../api/mock/fixtures.js";
import { FirstRunCard } from "./first-run.js";

/** `/`: the first-run card on a fresh install (zero scenarios), otherwise a
 * redirect to `/scenarios` (FR-052, T017/T018). The real clone-template +
 * launch flow is wired in T178 (US8); this calls the same client methods
 * against whatever `createApiClient()` returns. */
export function HomePage() {
  const navigate = useNavigate();
  const [scenarioCount, setScenarioCount] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    apiClient
      .get<{ scenarios: unknown[] }>("/scenarios")
      .then((res) => setScenarioCount(res.scenarios.length))
      .catch(() => setScenarioCount(0));
  }, []);

  async function start() {
    setStarting(true);
    const client = createApiClient();
    try {
      const { connections } = await client.listConnections();
      const localKafka = connections.find((c) => c.name === "local-kafka");
      const run = await client.launchRun(MOCK_SCENARIO_ID, {
        mode: "history_then_live",
        ...(localKafka
          ? { destinations: [{ sink: "events", connection_id: localKafka.id }] }
          : {}),
      });
      navigate(`/runs/${run.id}/live`);
    } finally {
      setStarting(false);
    }
  }

  if (scenarioCount === null) return null;
  if (scenarioCount > 0) return <Navigate to="/scenarios" replace />;

  return (
    <div className="flex flex-1 items-center justify-center py-12">
      <FirstRunCard onStart={() => void start()} starting={starting} />
    </div>
  );
}
