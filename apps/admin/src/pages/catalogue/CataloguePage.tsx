import { useState } from "react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { DeniedState } from "@/components/ui/controls";
import { useCategoriesEnabled } from "@/lib/catalogue";
import { Tabs } from "./parts";
import { BaseTab } from "./BaseTab";
import { StyledTab } from "./StyledTab";
import { CategoriesTab } from "./CategoriesTab";
import { CollectionsTab } from "./CollectionsTab";
import { BundlesTab } from "./BundlesTab";
import { ServicesTab } from "./ServicesTab";
import { CatalogueSettingsTab } from "./CatalogueSettingsTab";

/**
 * Catalogue (V2.2 §6.4) — the base→styled product model.
 *  • Base    — China-origin, stock-bearing register (the only place stock lives)
 *  • Styled  — storefront skins drawing down from a base (drafts + AI live here)
 *  • Categories / Collections — merchandising
 *  • Bundles — promotional offers (retention engine), surfaced here
 */
export function CataloguePage() {
  useBreadcrumbs([{ label: "Catalogue" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useState("styled");
  // Categories are hidden unless re-enabled from Config (owner directive).
  const categoriesOn = useCategoriesEnabled();

  if (!can("catalogue", "view")) {
    return (
      <DeniedState message="You don't have access to the Catalogue. Ask an admin in Org & Workflow." />
    );
  }

  const tabs = [
    { key: "styled", label: "Styled" },
    { key: "base", label: "Base" },
    ...(categoriesOn ? [{ key: "categories", label: "Categories" }] : []),
    { key: "collections", label: "Collections" },
    { key: "bundles", label: "Bundles" },
    { key: "services", label: "Services" },
    { key: "config", label: "Config" },
  ];

  // If Categories gets switched off while it's the active tab, fall back.
  const active = tab === "categories" && !categoriesOn ? "styled" : tab;

  return (
    <div className="space-y-5">
      <Tabs tabs={tabs} active={active} onChange={setTab} />
      {active === "styled" && <StyledTab />}
      {active === "base" && <BaseTab />}
      {active === "categories" && categoriesOn && <CategoriesTab />}
      {active === "collections" && <CollectionsTab />}
      {active === "bundles" && <BundlesTab />}
      {active === "services" && <ServicesTab />}
      {active === "config" && <CatalogueSettingsTab />}
    </div>
  );
}
