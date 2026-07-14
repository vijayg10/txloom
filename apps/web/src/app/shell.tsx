import { NavLink, Route, Routes } from "react-router-dom";
import { ScenarioWorkspacePage } from "../surfaces/scenario-workspace/index.js";
import { RunControlPage } from "../surfaces/run-control/index.js";
import { StreamConsolePage } from "../surfaces/stream-console/index.js";
import { WorldInspectorPage } from "../surfaces/world-inspector/index.js";
import { GroundTruthPage } from "../surfaces/ground-truth/index.js";
import { SettingsPage } from "../surfaces/settings/index.js";

// Terminology (scenario, spec, run, world, typology, sink) must match UI/CLI/API/docs
// identically (constitution Principle IV) — nav labels below are the canonical set.
const NAV = [
  { to: "/scenarios", label: "Scenario workspace" },
  { to: "/runs", label: "Run control" },
  { to: "/stream", label: "Stream console" },
  { to: "/inspector", label: "World inspector" },
  { to: "/ground-truth", label: "Ground-truth explorer" },
  { to: "/settings", label: "Connections & settings" },
];

export function AppShell() {
  return (
    <div className="app-shell">
      <nav>
        <div className="brand">TxLoom</div>
        <ul>
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to}>{item.label}</NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<ScenarioWorkspacePage />} />
          <Route path="/scenarios/*" element={<ScenarioWorkspacePage />} />
          <Route path="/runs/*" element={<RunControlPage />} />
          <Route path="/stream/*" element={<StreamConsolePage />} />
          <Route path="/inspector/*" element={<WorldInspectorPage />} />
          <Route path="/ground-truth/*" element={<GroundTruthPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}
