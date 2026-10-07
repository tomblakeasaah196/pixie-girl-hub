import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import {
  ShoppingBag,
  Zap,
  FileText,
  Truck,
  FileSpreadsheet,
  CreditCard,
  Landmark,
  CalendarClock,
  PackageSearch,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, KpiTile } from "@/components/ui/primitives";
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { money } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import {
  useSalesKpis,
  useCollectionsSummary,
  useDeliveryPendingOrders,
  usePosReconciliation,
} from "./hooks";
import { QuickSaleForm } from "./QuickSaleForm";
import { OrdersView } from "./OrdersView";
import { PreordersView } from "./PreordersView";
import { QuotationsView } from "./QuotationsView";
import { DeliveryPendingView } from "./DeliveryPendingView";
import { DeliveryReviewView } from "./DeliveryReviewView";
import { useCareAvailability } from "@/lib/care-accessories";
import { PosReconciliationView } from "./PosReconciliationView";
import { PaymentSettingsView } from "./PaymentSettingsView";
import { SalesReportExportModal } from "./SalesReportExportModal";

type SalesTab =
  | "quick-sale"
  | "orders"
  | "preorders"
  | "quotations"
  | "delivery-pending"
  | "delivery-review"
  | "pos-reconciliation"
  | "payments";
const TABS: { key: SalesTab; label: string; icon: typeof Zap }[] = [
  { key: "quick-sale", label: "Quick Sale", icon: Zap },
  { key: "orders", label: "Orders", icon: ShoppingBag },
  { key: "preorders", label: "Pre-orders", icon: CalendarClock },
  { key: "quotations", label: "Quotations", icon: FileText },
  { key: "delivery-pending", label: "Delivery Pending", icon: Truck },
  // Care & Accessories manual fee review — only shown when the PXG gate is on.
  { key: "delivery-review", label: "Delivery Fee Review", icon: PackageSearch },
  { key: "pos-reconciliation", label: "POS Reconciliation", icon: Landmark },
  { key: "payments", label: "Payments", icon: CreditCard },
];

export function SalesPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as SalesTab) ?? "quick-sale";
  const setTab = (t: SalesTab) => setSp({ tab: t });
  const { data: kpis } = useSalesKpis();
  // Live receivables (Sales → Orders → Collections). Point-in-time, not MTD:
  // what customers owe now is not a period figure.
  const { data: collections } = useCollectionsSummary();
  const { data: pendingFee } = useDeliveryPendingOrders({ page_size: 1 });
  const pendingCount = pendingFee?.meta?.total ?? 0;
  const { data: pendingRecon } = usePosReconciliation({ page_size: 1 });
  const pendingReconCount = pendingRecon?.meta?.total ?? 0;
  const can = useAuthStore((s) => s.can);
  const careOn = useCareAvailability().data?.enabled === true;
  // The review queue outlives the rollout flag: orders already queued must
  // still be priced (they can't dispatch until they are), so keep the tab for
  // PXG while anything is waiting even if Care selling is switched off.
  const activeBrand = useBusinessStore((s) => s.activeKey);
  const { data: reviewQueue } = useQuery({
    queryKey: ["delivery-reviews", activeBrand, "count"],
    queryFn: () =>
      api.get<{ data: unknown[]; meta: { total: number } }>(
        "/sales/delivery-reviews?page_size=1",
      ),
    enabled: activeBrand === "pixiegirl" && !careOn,
    retry: false,
  });
  const showReviews = careOn || (reviewQueue?.meta?.total ?? 0) > 0;
  const tabs = TABS.filter((t) => t.key !== "delivery-review" || showReviews);
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <div className="space-y-5">
      <ModuleInsights module="sales" />
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="font-display text-2xl font-medium">Sales</h1>
        {can("sales", "export") && (
          <Button
            variant="secondary"
            onClick={() => setExportOpen(true)}
            icon={<FileSpreadsheet className="w-4 h-4" />}
          >
            Export Report
          </Button>
        )}
      </div>

      <SalesReportExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiTile label="Orders MTD" value={String(kpis.orders_mtd)} />
          {/* The monthly money headline is CASH: captured/authorised customer
              payments that landed this Lagos month. It used to be gross order
              value under a "Revenue" label, which counted money nobody had paid
              and missed deposits taken on older orders. */}
          <KpiTile
            label="Cash Collected MTD"
            value={money(Number(kpis.cash_collected_mtd))}
            hint={`${kpis.payments_mtd} captured payments`}
          />
          <KpiTile
            label="Order Value MTD"
            value={money(Number(kpis.order_value_mtd))}
            hint={`avg ${money(Number(kpis.avg_order_value))} · gross, not cash`}
          />
          {/* Live receivables — the Orders → Collections queue in one figure. */}
          <KpiTile
            label="Outstanding Balance"
            value={
              collections
                ? money(Number(collections.outstanding_balance_ngn))
                : "—"
            }
            hint={
              collections
                ? `${collections.outstanding_orders} active orders owe a balance`
                : undefined
            }
            tone="warn"
          />
          <KpiTile
            label="Pending Payment"
            value={String(kpis.pending_payment_count)}
            tone="warn"
          />
          <KpiTile label="Open Quotes" value={String(kpis.open_quotes)} />
        </div>
      )}

      <div
        className="flex gap-1 p-1 rounded-[13px] glass shadow-glass overflow-x-auto hide-scrollbar"
        role="tablist"
      >
        {tabs.map((t) => {
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
              {(() => {
                const badgeCount =
                  t.key === "delivery-pending"
                    ? pendingCount
                    : t.key === "pos-reconciliation"
                      ? pendingReconCount
                      : 0;
                return (
                  badgeCount > 0 && (
                    <span
                      className={cn(
                        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold",
                        on ? "bg-white/20 text-white" : "bg-warn text-black",
                      )}
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )
                );
              })()}
            </button>
          );
        })}
      </div>

      {tab === "quick-sale" && <QuickSaleForm />}
      {tab === "orders" && <OrdersView />}
      {tab === "preorders" && <PreordersView />}
      {tab === "quotations" && <QuotationsView />}
      {tab === "delivery-pending" && <DeliveryPendingView />}
      {tab === "delivery-review" && showReviews && <DeliveryReviewView />}
      {tab === "pos-reconciliation" && <PosReconciliationView />}
      {tab === "payments" && <PaymentSettingsView />}
    </div>
  );
}
