import { useSearchParams } from "react-router-dom";
import { Sun, LayoutGrid, Users } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { TodayTab } from "./today/TodayTab";
import { PipelineTab } from "./pipeline/PipelineTab";
import { ClientsTab } from "./clients/ClientsTab";

type CrmTab = "today" | "pipeline" | "clients";

const TABS: { key: CrmTab; label: string; icon: typeof Sun }[] = [
  { key: "today", label: "Today", icon: Sun },
  { key: "pipeline", label: "Pipeline", icon: LayoutGrid },
  { key: "clients", label: "Clients", icon: Users },
];

export function CrmPage() {
  useBreadcrumbs([{ label: "CRM" }]);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") as CrmTab) ?? "today";

  function setTab(tab: CrmTab) {
    setSearchParams({ tab });
  }

  return (
    <div className="animate-fade-in">
      {/* Tab bar */}
      <div className="flex items-center gap-2 mb-6">
        <div className="flex gap-0.5 p-0.5 rounded-[12px] bg-text-primary/[0.04] border hairline">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={[
                "flex items-center gap-2 px-4 h-[36px] rounded-[10px] text-[13px] font-semibold transition-all",
                activeTab === key
                  ? "bg-accent-deep text-[#F4E9D9] shadow-sm"
                  : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]",
              ].join(" ")}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "today" && <TodayTab />}
      {activeTab === "pipeline" && <PipelineTab />}
      {activeTab === "clients" && <ClientsTab />}
    </div>
  );
}
