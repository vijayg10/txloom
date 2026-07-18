import { AgentConnectionPanel } from "./agent-connection.js";
import { GlobalDefaultsForm } from "./global-defaults.js";
import { SinkManagement } from "./sink-management.js";

export function SettingsPage() {
  return (
    <section>
      <h1>Connections &amp; settings</h1>
      <div data-testid="sink-management">
        <SinkManagement />
      </div>
      <div data-testid="global-defaults">
        <GlobalDefaultsForm />
      </div>
      <div data-testid="agent-connection">
        <AgentConnectionPanel />
      </div>
    </section>
  );
}
