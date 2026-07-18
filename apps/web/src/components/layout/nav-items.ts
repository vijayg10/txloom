import type { LucideIcon } from "lucide-react";
import { Database, FileText, Globe, PlayCircle, Radio, Settings } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

// Terminology (scenario, spec, run, world, typology, sink) must match UI/CLI/API/docs
// identically (constitution Principle IV) — labels below are the canonical set.
export const NAV_ITEMS: NavItem[] = [
  { to: "/scenarios", label: "Scenario workspace", icon: FileText },
  { to: "/runs", label: "Run control", icon: PlayCircle },
  { to: "/stream", label: "Stream console", icon: Radio },
  { to: "/inspector", label: "World inspector", icon: Globe },
  { to: "/ground-truth", label: "Ground-truth explorer", icon: Database },
  { to: "/settings", label: "Connections & settings", icon: Settings },
];
