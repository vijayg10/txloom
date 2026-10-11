import { useState } from "react";
import { Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { ScenarioWorkspacePage } from "../../surfaces/scenario-workspace/index.js";
import { RunControlPage } from "../../surfaces/run-control/index.js";
import { SettingsPage } from "../../surfaces/settings/index.js";
import { ConnectionsPage } from "../../surfaces/connections/index.js";
import { HomePage } from "../../surfaces/home/index.js";
import { RunPage } from "../../surfaces/run/index.js";
import { Sidebar } from "./sidebar.js";
import { TopNavbar } from "./top-navbar.js";

/** An old run-scoped URL (`/stream/:runId`, …) sent to its tab on the run page. */
function RunTabRedirect({ tab }: { tab: string }) {
  const { runId } = useParams<{ runId: string }>();
  return <Navigate to={`/runs/${runId}/${tab}`} replace />;
}

/** `/stream` also carried the run as `?run=`. */
function StreamRedirect() {
  const [params] = useSearchParams();
  const run = params.get("run");
  return <Navigate to={run ? `/runs/${run}/live` : "/runs?filter=streamable"} replace />;
}

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
            <Route path="/" element={<HomePage />} />
            <Route path="/scenarios/*" element={<ScenarioWorkspacePage />} />
            <Route path="/connections/*" element={<ConnectionsPage />} />
            {/* contracts/ui-routes.md: one page per run, tabbed (T016/T175). More
                specific than /runs/*, so it wins for /runs/:id/:tab. */}
            <Route path="/runs/:runId/:tab" element={<RunPage />} />
            <Route path="/runs/*" element={<RunControlPage />} />
            {/* v1 routes (FR-049): redirected, never dead. */}
            <Route path="/stream" element={<StreamRedirect />} />
            <Route path="/stream/:runId" element={<RunTabRedirect tab="live" />} />
            <Route path="/inspector" element={<Navigate to="/runs" replace />} />
            <Route path="/inspector/:runId" element={<RunTabRedirect tab="inspect" />} />
            <Route path="/ground-truth" element={<Navigate to="/runs" replace />} />
            <Route path="/ground-truth/:runId" element={<RunTabRedirect tab="truth" />} />
            <Route path="/settings/sinks" element={<Navigate to="/connections" replace />} />
            <Route path="/settings/*" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
