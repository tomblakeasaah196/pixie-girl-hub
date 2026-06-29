/**
 * Customer Retention & Loyalty (V2.2 §6.23) — module hub.
 *
 * One screen, tabbed: Strategies (the no-code engine), Loyalty, Rewards,
 * Referrals, Coupons, Subscriptions, Bundles, Maintenance, Analytics. Every
 * tab is entity-scoped and permission-aware; the create/activate controls hide
 * when the user lacks the grant (canon §4 #3).
 */

import { useState } from "react";
import {
  Sparkles,
  Gift,
  Crown,
  Users,
  Ticket,
  Repeat,
  Boxes,
  Wrench,
  BarChart3,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { DeniedState } from "@/components/ui/controls";
import { StrategiesTab } from "./StrategiesTab";
import { LoyaltyTab } from "./LoyaltyTab";
import { RewardsTab } from "./RewardsTab";
import { ReferralsTab } from "./ReferralsTab";
import { AnalyticsTab } from "./AnalyticsTab";
import { CouponsTab, SubscriptionsTab, BundlesTab, MaintenanceTab } from "./CatalogueTabs";

type Tab =
  | "strategies"
  | "loyalty"
  | "rewards"
  | "referrals"
  | "coupons"
  | "subscriptions"
  | "bundles"
  | "maintenance"
  | "analytics";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "strategies", label: "Strategies", icon: <Sparkles className="w-4 h-4" /> },
  { key: "loyalty", label: "Loyalty", icon: <Crown className="w-4 h-4" /> },
  { key: "rewards", label: "Rewards", icon: <Gift className="w-4 h-4" /> },
  { key: "referrals", label: "Referrals", icon: <Users className="w-4 h-4" /> },
  { key: "coupons", label: "Coupons", icon: <Ticket className="w-4 h-4" /> },
  { key: "subscriptions", label: "Subscriptions", icon: <Repeat className="w-4 h-4" /> },
  { key: "bundles", label: "Bundles", icon: <Boxes className="w-4 h-4" /> },
  { key: "maintenance", label: "Maintenance", icon: <Wrench className="w-4 h-4" /> },
  { key: "analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
];

export function RetentionPage() {
  useBreadcrumbs([{ label: "Retention" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useState<Tab>("strategies");

  if (!can("retention", "view")) {
    return <DeniedState message="You don't have access to Retention." />;
  }

  return (
    <div className="max-w-[1180px] space-y-5">
      <nav className="flex items-center gap-1 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === t.key
                ? "border-accent text-accent-glow"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "strategies" && <StrategiesTab />}
      {tab === "loyalty" && <LoyaltyTab />}
      {tab === "rewards" && <RewardsTab />}
      {tab === "referrals" && <ReferralsTab />}
      {tab === "coupons" && <CouponsTab />}
      {tab === "subscriptions" && <SubscriptionsTab />}
      {tab === "bundles" && <BundlesTab />}
      {tab === "maintenance" && <MaintenanceTab />}
      {tab === "analytics" && <AnalyticsTab />}
    </div>
  );
}
