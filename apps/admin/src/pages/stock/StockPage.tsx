import { useState } from "react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { DeniedState } from "@/components/ui/controls";
import { Tabs } from "./parts";
import OverviewTab from "./OverviewTab";
import ReceiveTab from "./ReceiveTab";
import MovementsTab from "./MovementsTab";
import TransfersTab from "./TransfersTab";
import AdjustmentsTab from "./AdjustmentsTab";
import AlertsTab from "./AlertsTab";
import LocationsTab from "./LocationsTab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "receive", label: "Receive" },
  { key: "movements", label: "Movements" },
  { key: "transfers", label: "Transfers" },
  { key: "adjustments", label: "Adjustments" },
  { key: "alerts", label: "Alerts" },
  { key: "locations", label: "Locations" },
];

export function StockPage() {
  useBreadcrumbs([{ label: "Stock & Inventory" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useState("overview");

  if (!can("stock", "view")) {
    return (
      <DeniedState message="You don't have access to Stock & Inventory. Ask an admin in Org & Workflow." />
    );
  }

  return (
    <div className="space-y-5">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === "overview" && <OverviewTab />}
      {tab === "receive" && <ReceiveTab />}
      {tab === "movements" && <MovementsTab />}
      {tab === "transfers" && <TransfersTab />}
      {tab === "adjustments" && <AdjustmentsTab />}
      {tab === "alerts" && <AlertsTab />}
      {tab === "locations" && <LocationsTab />}
    </div>
  );
}
