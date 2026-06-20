import { useSearchParams } from "react-router-dom";
import { ShoppingBag, Zap, FileText } from "lucide-react";
import { cn } from "@/lib/cn";
import { KpiTile } from "@/components/ui/primitives";
import { money } from "@/lib/format";
import { useSalesKpis } from "./hooks";
import { QuickSaleForm } from "./QuickSaleForm";
import { OrdersView } from "./OrdersView";
import { QuotationsView } from "./QuotationsView";

type SalesTab = "quick-sale" | "orders" | "quotations";
const TABS: { key: SalesTab; label: string; icon: typeof Zap }[] = [
  { key: "quick-sale", label: "Quick Sale", icon: Zap },
  { key: "orders", label: "Orders", icon: ShoppingBag },
  { key: "quotations", label: "Quotations", icon: FileText },
];

export function SalesPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as SalesTab) ?? "quick-sale";
  const setTab = (t: SalesTab) => setSp({ tab: t });
  const { data: kpis } = useSalesKpis();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="font-display text-2xl font-medium">Sales</h1>
      </div>

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiTile label="Orders MTD" value={String(kpis.orders_mtd)} />
          <KpiTile
            label="Revenue MTD"
            value={money(Number(kpis.revenue_mtd))}
          />
          <KpiTile
            label="Pending Payment"
            value={String(kpis.pending_payment_count)}
            tone="warn"
          />
          <KpiTile
            label="Avg Order Value"
            value={money(Number(kpis.avg_order_value))}
          />
          <KpiTile label="Open Quotes" value={String(kpis.open_quotes)} />
        </div>
      )}

      <div
        className="flex gap-1 p-1 rounded-[13px] glass shadow-glass overflow-x-auto"
        role="tablist"
      >
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

      {tab === "quick-sale" && <QuickSaleForm />}
      {tab === "orders" && <OrdersView />}
      {tab === "quotations" && <QuotationsView />}
    </div>
  );
}
