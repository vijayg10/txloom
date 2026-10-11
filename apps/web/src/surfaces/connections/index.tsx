import { useEffect, useState } from "react";
import { createApiClient, type Connection } from "../../api/client.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/card.js";
import { EmptyState } from "../../components/ui/empty-state.js";
import { Modal } from "../../components/ui/modal.js";
import { StatusBadge, booleanTone } from "../../components/ui/status-badge.js";
import { ConnectionForm } from "./connection-form.js";

/** The Connections page (T013): cards with a health indicator, "Local Kafka
 * detected" prompt (FR-013), and Add connection. */
export function ConnectionsPage() {
  const client = createApiClient();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [suggestions, setSuggestions] = useState<
    { kind: string; input: Parameters<typeof client.createConnection>[0]; detail: string }[]
  >([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Connection | undefined>(undefined);

  function reload() {
    client.listConnections().then((body) => setConnections(body.connections));
    client.getConnectionSuggestions().then((body) => setSuggestions(body.suggestions));
  }

  useEffect(reload, []);

  function openNew() {
    setEditing(undefined);
    setFormOpen(true);
  }

  function openEdit(connection: Connection) {
    setEditing(connection);
    setFormOpen(true);
  }

  async function remove(connection: Connection) {
    await client.deleteConnection(connection.id);
    reload();
  }

  async function addSuggestion(suggestion: (typeof suggestions)[number]) {
    await client.createConnection(suggestion.input);
    reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-text text-2xl font-semibold">Connections</h1>
        <Button data-testid="connection-add" onClick={openNew}>
          Add connection
        </Button>
      </div>

      {suggestions.map((suggestion) => (
        <Card
          key={suggestion.kind}
          data-testid="local-kafka-suggestion"
          className="border-primary/30"
        >
          <CardBody className="flex items-center justify-between gap-4">
            <div>
              <p className="text-text font-medium">Local Kafka detected</p>
              <p className="text-text-secondary text-xs">{suggestion.detail}</p>
            </div>
            <Button data-testid="local-kafka-add" onClick={() => void addSuggestion(suggestion)}>
              Add local-kafka
            </Button>
          </CardBody>
        </Card>
      ))}

      {connections === null ? null : connections.length === 0 ? (
        <EmptyState
          title="No connections yet"
          description="Add a Kafka, RabbitMQ or webhook connection to send runs and streams somewhere real."
          action={<Button onClick={openNew}>Add connection</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {connections.map((connection) => (
            <Card key={connection.id} data-testid={`connection-card-${connection.name}`}>
              <CardHeader>
                <CardTitle className="text-base">{connection.name}</CardTitle>
                <StatusBadge
                  tone={booleanTone(connection.health.ok)}
                  data-testid={`connection-health-${connection.name}`}
                >
                  {connection.health.ok === null
                    ? "untested"
                    : connection.health.ok
                      ? "ok"
                      : "failed"}
                </StatusBadge>
              </CardHeader>
              <CardBody className="flex flex-col gap-2">
                <p className="text-text-secondary text-xs capitalize">
                  {connection.type} · {connection.managed_by}
                </p>
                {connection.health.summary && (
                  <p className="text-text-secondary text-xs">{connection.health.summary}</p>
                )}
                {connection.warnings.map((w) => (
                  <p key={w.code} className="text-xs text-amber-600">
                    {w.message}
                  </p>
                ))}
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    variant="secondary"
                    disabled={connection.managed_by === "env"}
                    onClick={() => openEdit(connection)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={connection.managed_by === "env"}
                    onClick={() => void remove(connection)}
                  >
                    Delete
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? `Edit ${editing.name}` : "Add connection"}
      >
        <ConnectionForm
          {...(editing ? { initial: editing } : {})}
          onSaved={() => {
            setFormOpen(false);
            reload();
          }}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>
    </div>
  );
}
