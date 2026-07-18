import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";

interface ActorStoryStep {
  campaign_step: number;
  event: {
    event_id: string;
    ts: string;
    type: string;
    status: string;
    amount: number;
    consumer_name: string;
    merchant_name: string | null;
    counterparty_name: string | null;
  };
}

interface ActorStory {
  actor_id: string;
  typology: string;
  steps: ActorStoryStep[];
}

/** Actor-story timeline (FR-036 §5): the ordered multi-step sequence behind
 * one fraud actor_id — e.g. account_takeover's
 * dormancy → credential-change → drain, or a card_testing burst. */
export function ActorStory({ runId, actorId }: { runId: string; actorId: string }) {
  const [story, setStory] = useState<ActorStory | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setStory(null);
    setNotFound(false);
    apiClient
      .get<ActorStory>(`/runs/${runId}/truth/actors/${actorId}/story`)
      .then(setStory)
      .catch(() => setNotFound(true));
  }, [runId, actorId]);

  if (notFound) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-secondary text-sm">No campaign found for actor {actorId}.</p>
        </CardBody>
      </Card>
    );
  }
  if (!story) {
    return (
      <Card>
        <CardBody>
          <p className="text-text-secondary text-sm">Loading actor story…</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Actor <code className="font-mono text-base font-normal">{story.actor_id}</code> —{" "}
          {story.typology}
        </CardTitle>
      </CardHeader>
      <CardBody>
        <ol className="flex flex-col gap-2">
          {story.steps.map((step) => (
            <li
              key={step.event.event_id}
              className="border-border text-text-secondary flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm"
            >
              <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                step {step.campaign_step}
              </span>
              <span>{step.event.ts}</span>
              <span>{step.event.type}</span>
              <span>{step.event.status}</span>
              <span className="tabular-nums">{step.event.amount}</span>
              <span className="text-text">
                {step.event.consumer_name}
                {step.event.counterparty_name ? ` → ${step.event.counterparty_name}` : ""}
                {step.event.merchant_name ? ` → ${step.event.merchant_name}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
