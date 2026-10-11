import { Rocket } from "lucide-react";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody } from "../../components/ui/card.js";

interface FirstRunCardProps {
  onStart: () => void;
  starting?: boolean;
  error?: string | null;
}

/** The first-run card (FR-052): shown only on a fresh install (zero scenarios). Its action clones
 * the UPI template, binds `local-kafka` and launches history-then-live, so two clicks (open the
 * app, press start) put events on a topic (SC-001). */
export function FirstRunCard({ onStart, starting = false, error = null }: FirstRunCardProps) {
  return (
    <Card data-testid="first-run-card" className="mx-auto max-w-xl text-center">
      <CardBody className="flex flex-col items-center gap-4 py-10">
        <Rocket className="text-primary h-10 w-10" aria-hidden="true" />
        <div>
          <h2 className="text-text text-xl font-semibold">See it work in two clicks</h2>
          <p className="text-text-secondary mt-2 text-sm">
            Clone the UPI fraud reference scenario and launch it straight to the bundled demo Kafka
            broker — history, then a live stream, with no setup.
          </p>
        </div>
        <Button data-testid="first-run-start" onClick={onStart} loading={starting}>
          Start the UPI reference run
        </Button>
        {error && (
          <p role="alert" data-testid="first-run-error" className="text-danger max-w-md text-sm">
            {error}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
