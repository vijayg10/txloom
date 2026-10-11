import { useState } from "react";
import { ActorStory } from "./actor-story.js";
import { GroundTruthExplorer } from "./explorer.js";

/** The Ground truth tab of a run. */
export function TruthTab({ runId }: { runId: string }) {
  const [actorId, setActorId] = useState<string | null>(null);

  return (
    <div>
      <div className="flex flex-col gap-6">
        <div data-testid="ground-truth-explorer">
          <GroundTruthExplorer runId={runId} onSelectActor={setActorId} />
        </div>
        {actorId && (
          <div data-testid="ground-truth-actor-story">
            <ActorStory runId={runId} actorId={actorId} />
          </div>
        )}
      </div>
    </div>
  );
}
