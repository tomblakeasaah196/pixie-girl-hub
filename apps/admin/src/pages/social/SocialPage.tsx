import { useUrlTab } from "@/hooks/useUrlTab";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { useAuthStore } from "@/stores/auth";
import { DeniedState } from "@/components/ui/controls";
import { Tabs } from "@/pages/stock/parts";
import { BoardTab } from "./BoardTab";
import { CalendarTab } from "./CalendarTab";
import { PerformanceTab } from "./PerformanceTab";
import { TeamTab } from "./TeamTab";
import { AccountsTab } from "./AccountsTab";

/**
 * Social Studio (`/social`, canon §6.14) — manual-first, proof-of-publish.
 *
 * Board (content plans + bulk planner) · Calendar · Performance (KPIs) ·
 * Team (leaderboard) · Accounts (handle registry). "Social Studio" is a
 * frontend-only rename — the module key, permission, and API all stay `social`.
 */

type Tab = "board" | "calendar" | "performance" | "team" | "accounts";

const TABS = [
  { key: "board", label: "Board" },
  { key: "calendar", label: "Calendar" },
  { key: "performance", label: "Performance" },
  { key: "team", label: "Team" },
  { key: "accounts", label: "Accounts" },
];

export function SocialPage() {
  useBreadcrumbs([{ label: "Social Studio" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useUrlTab<Tab>("board", [
    "board",
    "calendar",
    "performance",
    "team",
    "accounts",
  ]);

  if (!can("social", "view")) {
    return <DeniedState message="You don't have access to Social Studio." />;
  }

  return (
    <div className="max-w-[1180px] space-y-5">
      <ModuleInsights module="social_media" />
      <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k as Tab)} />

      {tab === "board" && <BoardTab />}
      {tab === "calendar" && <CalendarTab />}
      {tab === "performance" && <PerformanceTab />}
      {tab === "team" && <TeamTab />}
      {tab === "accounts" && <AccountsTab />}
    </div>
  );
}
