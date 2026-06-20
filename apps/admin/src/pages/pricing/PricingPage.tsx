import { useState } from "react";
import {
  Tag,
  Shield,
  ClipboardList,
  Gauge,
  Lock,
  SlidersHorizontal,
  Repeat,
  Settings as SettingsIcon,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import {
  Card,
  EmptyState,
  KpiTile,
  Skeleton,
} from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useRules, useProposals, useFloors } from "./hooks";
import { AdvisorTab } from "./AdvisorTab";
import { ScenariosTab } from "./ScenariosTab";
import { RulesTab } from "./RulesTab";
import { FloorsTab } from "./FloorsTab";
import { OverridesTab } from "./OverridesTab";
import { ProposalsTab } from "./ProposalsTab";
import { SettingsTab } from "./SettingsTab";

type Tab =
  | "advisor"
  | "scenarios"
  | "rules"
  | "floors"
  | "overrides"
  | "proposals"
  | "settings";

export function PricingPage() {
  useBreadcrumbs([{ label: "Pricing" }]);
  const can = useAuthStore((s) => s.can);
  const canEdit = can("pricing", "edit");
  const [tab, setTab] = useState<Tab>("advisor");

  if (!can("pricing", "view")) {
    return (
      <div className="py-20">
        <EmptyState
          icon={<Lock className="w-8 h-8" />}
          title="Access restricted"
          message="You don't have permission to view the Pricing module."
        />
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "advisor", label: "Advisor", icon: <Gauge className="w-4 h-4" /> },
    {
      key: "scenarios",
      label: "Scenarios",
      icon: <SlidersHorizontal className="w-4 h-4" />,
    },
    { key: "rules", label: "Rules", icon: <Tag className="w-4 h-4" /> },
    { key: "floors", label: "Floors", icon: <Shield className="w-4 h-4" /> },
    {
      key: "overrides",
      label: "Overrides",
      icon: <Repeat className="w-4 h-4" />,
    },
    {
      key: "proposals",
      label: "Proposals",
      icon: <ClipboardList className="w-4 h-4" />,
    },
    {
      key: "settings",
      label: "Settings",
      icon: <SettingsIcon className="w-4 h-4" />,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-medium">Pricing</h1>
        <p className="text-text-muted text-sm mt-0.5">
          An advisory engine — grounded in true cost, governed by thresholds.
          The catalogue keeps the live prices.
        </p>
      </div>

      <PricingKpiStrip />

      <div className="flex gap-1 p-1 glass rounded-2xl overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all",
              tab === t.key
                ? "bg-accent-deep text-[#F4E9D9] shadow-md"
                : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "advisor" && (
        <AdvisorTab
          canEdit={canEdit}
          onGoToProposals={() => setTab("proposals")}
        />
      )}
      {tab === "scenarios" && (
        <ScenariosTab
          canEdit={canEdit}
          onGoToProposals={() => setTab("proposals")}
        />
      )}
      {tab === "rules" && <RulesTab canEdit={canEdit} />}
      {tab === "floors" && <FloorsTab canEdit={canEdit} />}
      {tab === "overrides" && <OverridesTab canEdit={canEdit} />}
      {tab === "proposals" && (
        <ProposalsTab canApprove={can("pricing", "approve")} />
      )}
      {tab === "settings" && <SettingsTab canEdit={canEdit} />}
    </div>
  );
}

function PricingKpiStrip() {
  const rules = useRules({ is_active: true });
  const proposals = useProposals("pending_approval");
  const floors = useFloors();

  if (rules.isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="w-20 mb-3" />
            <Skeleton className="w-16 h-7" />
          </Card>
        ))}
      </div>
    );
  }

  const pending = proposals.data?.length ?? 0;
  return (
    <div className="grid grid-cols-3 gap-4">
      <KpiTile
        label="Active rules"
        value={String(rules.data?.length ?? 0)}
        tone="accent"
      />
      <KpiTile
        label="Pending approval"
        value={String(pending)}
        tone={pending ? "warn" : "neutral"}
      />
      <KpiTile
        label="Price floors"
        value={String(floors.data?.length ?? 0)}
        tone="info"
      />
    </div>
  );
}
