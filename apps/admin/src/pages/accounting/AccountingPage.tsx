import { lazy, Suspense, useState } from "react";
import { Lock } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

const ReportsTab = lazy(() => import("./ReportsTab"));
const JournalsTab = lazy(() => import("./JournalsTab"));
const CoaTab = lazy(() => import("./CoaTab"));
const TaxCenterTab = lazy(() => import("./TaxCenterTab"));
const PeriodsTab = lazy(() => import("./PeriodsTab"));
const BankTab = lazy(() => import("./BankTab"));

const TABS = [
  { key: "reports", label: "Reports" },
  { key: "journals", label: "Journals" },
  { key: "coa", label: "Chart of Accounts" },
  { key: "tax", label: "Tax Center" },
  { key: "periods", label: "Periods" },
  { key: "bank", label: "Bank" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Accounting workspace (V2.2 §6.6) — the books, computed from the GL. */
export default function AccountingPage() {
  useBreadcrumbs([{ label: "Accounting" }]);
  const can = useAuthStore((s) => s.can);
  const [tab, setTab] = useState<TabKey>("reports");

  if (!can("accounting", "view")) {
    return (
      <div className="py-20">
        <EmptyState
          icon={<Lock className="w-8 h-8" />}
          title="Access restricted"
          message="You don't have permission to view the books."
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-medium">Accounting</h1>
        <p className="text-text-muted text-sm mt-0.5">
          Double-entry ledger, financial statements &amp; tax
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3.5 h-9 rounded-full text-[13px] font-medium transition-colors",
              tab === t.key
                ? "bg-accent text-white"
                : "bg-text-primary/[0.05] text-text-muted hover:text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<Skeleton className="w-full h-64 rounded-2xl" />}>
        {tab === "reports" && <ReportsTab />}
        {tab === "journals" && <JournalsTab />}
        {tab === "coa" && <CoaTab />}
        {tab === "tax" && <TaxCenterTab />}
        {tab === "periods" && <PeriodsTab />}
        {tab === "bank" && <BankTab />}
      </Suspense>
    </div>
  );
}
