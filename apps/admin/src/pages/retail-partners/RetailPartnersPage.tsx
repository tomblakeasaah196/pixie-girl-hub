import { useMemo, useState } from "react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { DeniedState } from "@/components/ui/controls";
import { KpiTile, Skeleton } from "@/components/ui/primitives";
import { moneyCompact } from "@/lib/format";
import {
  usePartners,
  useConsignmentStock,
  useConsignmentMovements,
  useSettlements,
} from "./hooks";
import { Tabs } from "./parts";
import { num } from "./types";
import PartnersTab from "./PartnersTab";
import StockTab from "./StockTab";
import MovementsTab from "./MovementsTab";
import SettlementsTab from "./SettlementsTab";

const TABS = [
  { key: "partners", label: "Partners" },
  { key: "stock", label: "Consignment Stock" },
  { key: "movements", label: "Movements" },
  { key: "settlements", label: "Settlements" },
];

/**
 * Retail / Consignment Partners (guide §2.21 — closes audit gap G-3).
 * One page, four tabs, partner + settlement detail drawers. The backend has
 * no overview endpoint, so the KPI strip is computed client-side from the
 * lists the tabs already load (question-gate Q14).
 */
export function RetailPartnersPage() {
  useBreadcrumbs([{ label: "Retail Partners" }]);
  const { can } = useAuthStore();

  const [tab, setTab] = useState("partners");
  const [settlementsPartnerFilter, setSettlementsPartnerFilter] = useState("");

  if (!can("retail_partners", "view")) {
    return (
      <DeniedState message="You don't have access to Retail Partners. Ask an admin in Org & Workflow." />
    );
  }

  return (
    <div className="space-y-5">
      <KpiStrip />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "partners" && (
        <PartnersTab
          onGoToSettlements={(partnerId) => {
            setSettlementsPartnerFilter(partnerId);
            setTab("settlements");
          }}
        />
      )}
      {tab === "stock" && <StockTab />}
      {tab === "movements" && <MovementsTab />}
      {tab === "settlements" && (
        <SettlementsTab
          partnerFilter={settlementsPartnerFilter}
          onPartnerFilterChange={setSettlementsPartnerFilter}
        />
      )}
    </div>
  );
}

/** Rendered only behind the permission gate so its queries never fire for a
 *  role without retail_partners.view (canon: the button's absence is never
 *  the enforcement, but we also never request what a role can't see). */
function KpiStrip() {
  const partnersQ = usePartners();
  const stockQ = useConsignmentStock({});
  const unsettledQ = useConsignmentMovements({ settled: false });
  const settlementsQ = useSettlements({});

  const kpis = useMemo(() => {
    const partners = partnersQ.data ?? [];
    const stock = stockQ.data ?? [];
    const unsettled = unsettledQ.data ?? [];
    const settlements = settlementsQ.data ?? [];
    const unsettledSales = unsettled
      .filter((m) => m.movement_type === "partner_sale")
      .reduce(
        (s, m) => s + Math.abs(m.quantity) * num(m.unit_retail_price_ngn),
        0,
      );
    const owed = settlements
      .filter((s) => s.status === "approved" || s.status === "invoiced")
      .reduce((s, x) => s + num(x.total_partner_share_ngn), 0);
    return {
      activePartners: partners.filter((p) => p.status === "active").length,
      unitsHeld: stock.reduce((s, r) => s + r.qty_on_hand, 0),
      unsettledSales,
      owed,
    };
  }, [partnersQ.data, stockQ.data, unsettledQ.data, settlementsQ.data]);

  const loading =
    partnersQ.isLoading ||
    stockQ.isLoading ||
    unsettledQ.isLoading ||
    settlementsQ.isLoading;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {loading ? (
        Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[92px] rounded-[var(--radius)]" />
        ))
      ) : (
        <>
          <KpiTile label="Active partners" value={String(kpis.activePartners)} />
          <KpiTile
            label="Units on consignment"
            value={kpis.unitsHeld.toLocaleString("en-NG")}
          />
          <KpiTile
            label="Unsettled sales"
            value={moneyCompact(kpis.unsettledSales)}
            tone={kpis.unsettledSales > 0 ? "warn" : "accent"}
          />
          <KpiTile label="Owed to partners" value={moneyCompact(kpis.owed)} />
        </>
      )}
    </div>
  );
}
