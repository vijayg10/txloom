import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { FormField } from "../../components/ui/form-field.js";
import { apiClient, ApiError } from "../../api/client.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { StreamConsole } from "./stream-console.js";

/** Starts the live phase into the destinations the run was launched with — no sink is
 * entered here (the inline form was removed with `/sinks`). */
function StreamStart({ runId, onStarted }: { runId: string; onStarted: () => void }) {
  const [targetTps, setTargetTps] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setStarting(true);
    setError(null);
    try {
      await apiClient.post(`/runs/${runId}/stream/start`, {
        ...(targetTps ? { target_tps: Number(targetTps) } : {}),
      });
      onStarted();
    } catch (err) {
      // stream_paused and stream_limit carry their own remedy ("Resume it, or stop it first…",
      // "Stop one, or raise the limit"), so the server's message is shown as written.
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
          <p className="text-text-secondary text-sm">
            Events go to the destinations this run was launched with.
          </p>
          <div className="max-w-xs">
            <FormField label="Target TPS" hint="Leave blank to use the spec's rate">
              <Input
                data-testid="stream-target-tps"
                type="number"
                value={targetTps}
                onChange={(e) => setTargetTps(e.target.value)}
              />
            </FormField>
          </div>
          {error && (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          )}
          <div>
            <Button type="submit" data-testid="stream-start" loading={starting}>
              Start stream
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/** The Live tab of a run: starts the stream into the destinations the run was launched with, or
 * shows the console once it exists. */
export function LiveTab({ runId }: { runId: string }) {
  const [hasStream, setHasStream] = useState<boolean | null>(null);

  // A `history_then_live` run gets its stream from the worker once history is done, possibly while
  // this tab is already open, so keep looking until there is one.
  useEffect(() => {
    let active = true;
    const look = () =>
      apiClient
        .get(`/runs/${runId}/stream`)
        .then(() => active && setHasStream(true))
        .catch((err) => {
          if (active) setHasStream(err instanceof ApiError && err.status === 404 ? false : true);
        });
    void look();
    const timer = setInterval(() => {
      if (!hasStreamRef.current) void look();
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [runId]);
  const hasStreamRef = useRef(hasStream);
  hasStreamRef.current = hasStream;

  if (hasStream === null) return <p className="text-text-secondary text-sm">Loading…</p>;
  if (!hasStream) {
    return (
      <div data-testid="stream-launcher">
        <StreamStart runId={runId} onStarted={() => setHasStream(true)} />
      </div>
    );
  }
  return (
    <div data-testid="stream-console">
      <StreamConsole runId={runId} />
    </div>
  );
}
