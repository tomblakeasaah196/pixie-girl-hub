import { useSearchParams } from "react-router-dom";
import { FileBarChart, FileText, Undo2, Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth";
import { ArAgeingView } from "./ArAgeingView";
import { InvoicesView } from "./InvoicesView";
import { CreditNotesView } from "./CreditNotesView";
import { DocumentSettingsTab } from "./DocumentSettingsTab";

type InvoicingTab = "ar-ageing" | "invoices" | "credit-notes" | "settings";
const TABS: { key: InvoicingTab; label: string; icon: typeof FileText }[] = [
  { key: "ar-ageing", label: "AR Ageing", icon: FileBarChart },
  { key: "invoices", label: "Invoices", icon: FileText },
  { key: "credit-notes", label: "Credit Notes", icon: Undo2 },
  { key: "settings", label: "Settings", icon: Settings2 },
];

export function InvoicingPage() {
  const [sp, setSp] = useSearchParams();
  const can = useAuthStore((s) => s.can);
  const canEdit = can("invoicing", "edit");
  const tab = (sp.get("tab") as InvoicingTab) ?? "ar-ageing";
  const setTab = (t: InvoicingTab) => setSp({ tab: t });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="font-display text-2xl font-medium">Invoicing & Billing</h1>
      </div>

      <div className="flex gap-1 p-1 rounded-[13px] glass shadow-glass overflow-x-auto" role="tablist">
        {TABS.map((t) => {
          const on = t.key === tab;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-2 px-4 h-10 rounded-[10px] text-[13px] font-semibold whitespace-nowrap transition-all",
                on
                  ? "bg-accent-deep text-[#F4E9D9] shadow-[0_6px_18px_rgb(var(--accent-deep)/0.4)]"
                  : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]",
              )}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "ar-ageing" && <ArAgeingView />}
      {tab === "invoices" && <InvoicesView />}
      {tab === "credit-notes" && <CreditNotesView />}
      {tab === "settings" && <DocumentSettingsTab canEdit={canEdit} />}
    </div>
  );
}
