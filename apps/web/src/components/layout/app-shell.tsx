import { useState } from "react";
import { Route, Routes } from "react-router-dom";
import { ScenarioWorkspacePage } from "../../surfaces/scenario-workspace/index.js";
import { RunControlPage } from "../../surfaces/run-control/index.js";
import { StreamConsolePage } from "../../surfaces/stream-console/index.js";
import { WorldInspectorPage } from "../../surfaces/world-inspector/index.js";
import { GroundTruthPage } from "../../surfaces/ground-truth/index.js";
import { SettingsPage } from "../../surfaces/settings/index.js";
import { Sidebar } from "./sidebar.js";
import { TopNavbar } from "./top-navbar.js";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="bg-bg flex h-screen overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNavbar onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
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
    </div>
  );
}
