import type { LucideIcon } from "lucide-react";
import { FileText, Plug, PlayCircle, Settings } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

// Terminology (scenario, spec, run, world, typology, sink) must match UI/CLI/API/docs
// identically (constitution Principle IV) — labels below are the canonical set.
// Navigation per contracts/ui-routes.md: Scenarios · Runs · Connections, with
// Settings kept separately in the sidebar footer (T018).
export const NAV_ITEMS: NavItem[] = [
  { to: "/scenarios", label: "Scenarios", icon: FileText },
  { to: "/runs", label: "Runs", icon: PlayCircle },
  { to: "/connections", label: "Connections", icon: Plug },
];

export const FOOTER_NAV_ITEMS: NavItem[] = [{ to: "/settings", label: "Settings", icon: Settings }];
