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
  { to: "/errors", label: "Errors", icon: Bug },
  { to: "/health", label: "Health", icon: Activity },
  { to: "/performance", label: "Performance", icon: Gauge },
  { to: "/backups", label: "Backups", icon: DatabaseBackup },
  { to: "/alerts", label: "Alerts", icon: BellRing },
  { to: "/operators", label: "Operators", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];
