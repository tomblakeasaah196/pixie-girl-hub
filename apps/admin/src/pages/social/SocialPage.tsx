import { CalendarDays, TrendingUp, AtSign } from "lucide-react";
import { useUrlTab } from "@/hooks/useUrlTab";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { DeniedState } from "@/components/ui/controls";
import { StudioTabs, type StudioTab } from "./StudioTabs";
import { CalendarTab } from "./CalendarTab";
import { PerformanceTab } from "./PerformanceTab";
import { AccountsTab } from "./AccountsTab";

/**
 * Social Studio (`/social`) — simplified to a native, app-like surface.
 *
 * Three tabs, no friction: **Calendar** (log a posted link on its day, see it
 * embedded), **Performance** (received vs. the fixed 6/week cadence), and
 * **Account** (the brand's handles). The old Board / plans / approvals / team /
 * targets and all content authoring are gone — the module key, permission, and
 * API all stay `social`.
 */

type Tab = "calendar" | "performance" | "account";

const TABS: StudioTab<Tab>[] = [
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "performance", label: "Performance", icon: TrendingUp },
  { key: "account", label: "Account", icon: AtSign },
];

export function SocialPage() {
  useBreadcrumbs([{ label: "Social Studio" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useUrlTab<Tab>("calendar", ["calendar", "performance", "account"]);

  if (!can("social", "view")) {
    return <DeniedState message="You don't have access to Social Studio." />;
  }

  return (
    <div className="mx-auto max-w-[900px]">
      <StudioTabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="mt-1">
        {tab === "calendar" && <CalendarTab />}
        {tab === "performance" && <PerformanceTab />}
        {tab === "account" && <AccountsTab />}
      </div>
    </div>
  );
}
