import { PageHeader } from "../../components/layout/page-header.js";
import { AgentConnectionPanel } from "./agent-connection.js";
import { GlobalDefaultsForm } from "./global-defaults.js";
import { SinkManagement } from "./sink-management.js";

export function SettingsPage() {
  return (
    <div>
      <PageHeader title="Connections & settings" />
      <div className="flex flex-col gap-6">
        <div data-testid="sink-management">
          <SinkManagement />
        </div>
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
