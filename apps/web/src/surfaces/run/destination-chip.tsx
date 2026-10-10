import type { Destination } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";

interface DestinationChipProps {
  destinations: Destination[];
  canChange: boolean;
  onChange?: () => void;
}

/** Read-only destination chips (T016). Changing a run's live destinations is
 * only ever allowed while the stream is stopped (FR-048) — `live-destination-change`
 * stays disabled otherwise. */
export function DestinationChip({ destinations, canChange, onChange }: DestinationChipProps) {
  if (destinations.length === 0) {
    return <span className="text-text-secondary text-xs">No destinations</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {destinations.map((d) => (
        <span
          key={d.sink}
          data-testid={`live-destination-chip-${d.sink}`}
          className="border-border bg-hover text-text-secondary inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
        >
          {d.sink} → {d.connection_missing ? "deleted connection" : d.connection_name}
          {d.topic ? `:${d.topic}` : d.routing_key ? `:${d.routing_key}` : ""}
        </span>
      ))}
      <Button
        variant="secondary"
        data-testid="live-destination-change"
        disabled={!canChange}
        onClick={onChange}
      >
        Change
      </Button>
    </div>
  );
}
