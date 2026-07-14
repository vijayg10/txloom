import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";

type Typology = "card_testing" | "account_takeover" | "refund_abuse";

interface TruthEventRow {
  event_id: string;
  ts: string;
  type: string;
  status: string;
  amount: number;
  consumer_name: string;
  merchant_name: string | null;
  label: { typology: Typology | null; actor_id: string | null } | null;
}

interface TruthEventsPage {
  events: TruthEventRow[];
  next_cursor: string | null;
}

const TYPOLOGIES: Typology[] = ["card_testing", "account_takeover", "refund_abuse"];

/** Ground-truth explorer (FR-036 §5): filter the world by fraud typology and
 * browse matching events; selecting an actor hands off to the actor-story
 * timeline (`onSelectActor`). */
export function GroundTruthExplorer({
  runId,
  onSelectActor,
}: {
  runId: string;
  onSelectActor?: (actorId: string) => void;
}) {
  const [typology, setTypology] = useState<Typology | "">("");
  const [page, setPage] = useState<TruthEventsPage | null>(null);

  useEffect(() => {
    const query = typology ? `?typology=${typology}` : "";
    apiClient
      .get<TruthEventsPage>(`/runs/${runId}/truth/events${query}`)
      .then(setPage)
      .catch(() => setPage(null));
  }, [runId, typology]);

  return (
    <div className="ground-truth-explorer">
      <label>
        Typology
        <select value={typology} onChange={(e) => setTypology(e.target.value as Typology | "")}>
          <option value="">All</option>
          {TYPOLOGIES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      {!page && <p>Loading events…</p>}

      {page && (
        <table className="truth-events-table">
          <thead>
            <tr>
              <th>event</th>
              <th>ts</th>
              <th>type</th>
              <th>status</th>
              <th>amount</th>
              <th>typology</th>
              <th>actor</th>
            </tr>
          </thead>
          <tbody>
            {page.events.map((event) => (
              <tr key={event.event_id}>
                <td>{event.event_id}</td>
                <td>{event.ts}</td>
                <td>{event.type}</td>
                <td>{event.status}</td>
                <td>{event.amount}</td>
                <td>{event.label?.typology ?? ""}</td>
                <td>
                  {event.label?.actor_id ? (
                    <button type="button" onClick={() => onSelectActor?.(event.label!.actor_id!)}>
                      {event.label.actor_id}
                    </button>
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
