import { useEffect, useState } from "react";
import { apiClient } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { FormField } from "../../components/ui/form-field.js";
import { TableSkeleton } from "../../components/ui/loading-skeleton.js";
import { Select } from "../../components/ui/select.js";
import { Pagination } from "../../components/data/pagination.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "../../components/data/table.js";

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
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [page, setPage] = useState<TruthEventsPage | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (typology) params.set("typology", typology);
    if (cursor) params.set("cursor", cursor);
    const query = params.toString();
    apiClient
      .get<TruthEventsPage>(`/runs/${runId}/truth/events${query ? `?${query}` : ""}`)
      .then(setPage)
      .catch(() => setPage(null));
  }, [runId, typology, cursor]);

  function changeTypology(next: Typology | "") {
    setTypology(next);
    setCursor(null);
    setCursorStack([]);
  }

  function nextPage() {
    if (!page?.next_cursor) return;
    setCursorStack((stack) => [...stack, cursor ?? ""]);
    setCursor(page.next_cursor);
  }

  function previousPage() {
    setCursorStack((stack) => {
      const next = [...stack];
      const previousCursor = next.pop() ?? null;
      setCursor(previousCursor || null);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-4 max-w-xs">
        <FormField label="Typology">
          <Select
            data-testid="ground-truth-typology-filter"
            value={typology}
            onChange={(e) => changeTypology(e.target.value as Typology | "")}
          >
            <option value="">All</option>
            {TYPOLOGIES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      {!page && <TableSkeleton columns={7} />}

      {page && page.events.length === 0 && <EmptyState title="No matching events" />}

      {page && page.events.length > 0 && (
        <>
          <Table data-testid="ground-truth-events-table">
            <TableHead>
              <TableHeaderRow>
                <TableHeaderCell>Event</TableHeaderCell>
                <TableHeaderCell>Timestamp</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Amount</TableHeaderCell>
                <TableHeaderCell>Typology</TableHeaderCell>
                <TableHeaderCell>Actor</TableHeaderCell>
              </TableHeaderRow>
            </TableHead>
            <TableBody>
              {page.events.map((event) => (
                <TableRow key={event.event_id}>
                  <TableCell className="font-mono text-xs">{event.event_id}</TableCell>
                  <TableCell className="text-text-secondary">{event.ts}</TableCell>
                  <TableCell>{event.type}</TableCell>
                  <TableCell>{event.status}</TableCell>
                  <TableCell>{event.amount}</TableCell>
                  <TableCell>{event.label?.typology ?? "—"}</TableCell>
                  <TableCell>
                    {event.label?.actor_id ? (
                      <Button
                        variant="secondary"
                        data-testid="ground-truth-select-actor"
                        onClick={() => onSelectActor?.(event.label!.actor_id!)}
                      >
                        {event.label.actor_id}
                      </Button>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            hasNext={Boolean(page.next_cursor)}
            hasPrevious={cursorStack.length > 0}
            onNext={nextPage}
            onPrevious={previousPage}
          />
        </>
      )}
    </div>
  );
}
