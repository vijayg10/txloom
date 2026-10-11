import { Link } from "react-router-dom";
import { PageHeader } from "../../components/layout/page-header.js";
import { AgentConnectionPanel } from "./agent-connection.js";
import { GlobalDefaultsForm } from "./global-defaults.js";

export function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-6">
        <p className="text-text-secondary text-sm">
          Kafka, RabbitMQ and webhook destinations live on the{" "}
          <Link
            data-testid="settings-connections-link"
            to="/connections"
            className="text-primary hover:underline"
          >
            Connections
          </Link>{" "}
          page.
        </p>
        <div data-testid="global-defaults">
          <GlobalDefaultsForm />
        </div>
        <div data-testid="agent-connection">
          <AgentConnectionPanel />
        </div>
      </div>
    </div>
  );
}
