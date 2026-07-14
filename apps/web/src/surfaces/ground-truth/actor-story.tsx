import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

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

  if (notFound) return <p>No campaign found for actor {actorId}.</p>;
  if (!story) return <p>Loading actor story…</p>;

  return (
    <div className="actor-story">
      <h3>
        Actor <code>{story.actor_id}</code> — {story.typology}
      </h3>
      <ol className="actor-story-steps">
        {story.steps.map((step) => (
          <li key={step.event.event_id}>
            <span className="campaign-step">step {step.campaign_step}</span>
            <span>{step.event.ts}</span>
            <span>{step.event.type}</span>
            <span>{step.event.status}</span>
            <span>{step.event.amount}</span>
            <span>
              {step.event.consumer_name}
              {step.event.counterparty_name ? ` → ${step.event.counterparty_name}` : ""}
              {step.event.merchant_name ? ` → ${step.event.merchant_name}` : ""}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
