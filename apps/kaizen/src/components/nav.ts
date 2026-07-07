import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Bug,
  Activity,
  Gauge,
  DatabaseBackup,
  BellRing,
  Users,
  Settings,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
  phase?: string;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/errors", label: "Errors", icon: Bug, soon: true, phase: "Phase 1" },
  { to: "/health", label: "Health", icon: Activity, soon: true, phase: "Phase 2" },
  { to: "/performance", label: "Performance", icon: Gauge, soon: true, phase: "Phase 2" },
  { to: "/backups", label: "Backups", icon: DatabaseBackup, soon: true, phase: "Phase 3" },
  { to: "/alerts", label: "Alerts", icon: BellRing, soon: true, phase: "Phase 5" },
  { to: "/operators", label: "Operators", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings, soon: true, phase: "Phase 5" },
];
