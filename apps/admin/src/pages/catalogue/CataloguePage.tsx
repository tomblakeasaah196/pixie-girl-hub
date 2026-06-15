import { useState } from "react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { DeniedState } from "@/components/ui/controls";
import { Tabs } from "./parts";
import { BaseTab } from "./BaseTab";
import { StyledTab } from "./StyledTab";
import { CategoriesTab } from "./CategoriesTab";
import { CollectionsTab } from "./CollectionsTab";
import { BundlesTab } from "./BundlesTab";

/**
 * Catalogue (V2.2 §6.4) — the base→styled product model.
 *  • Base    — China-origin, stock-bearing register (the only place stock lives)
 *  • Styled  — storefront skins drawing down from a base (drafts + AI live here)
 *  • Categories / Collections — merchandising
 *  • Bundles — promotional offers (retention engine), surfaced here
 */
const TABS = [
  { key: "styled", label: "Styled" },
  { key: "base", label: "Base" },
  { key: "categories", label: "Categories" },
  { key: "collections", label: "Collections" },
  { key: "bundles", label: "Bundles" },
];

export function CataloguePage() {
  useBreadcrumbs([{ label: "Catalogue" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useState("styled");

  if (!can("catalogue", "view")) {
    return <DeniedState message="You don't have access to the Catalogue. Ask an admin in Org & Workflow." />;
  }

  return (
    <div className="space-y-5">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === "styled" && <StyledTab />}
      {tab === "base" && <BaseTab />}
      {tab === "categories" && <CategoriesTab />}
      {tab === "collections" && <CollectionsTab />}
      {tab === "bundles" && <BundlesTab />}
    </div>
  );
}
