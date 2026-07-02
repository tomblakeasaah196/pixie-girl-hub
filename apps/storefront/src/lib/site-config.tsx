import { createContext, useContext, type ReactNode } from "react";

/**
 * Site-wide Studio config, hydrated once at the root from GET /site (all
 * published pages + popups). Any page reads its editable `slots` by page_key via
 * usePageSlots(), merges them over its baked defaults, and renders — so every
 * page is Studio-editable without its own loader.
 */

export interface StudioPage {
  page_key?: string;
  template_key?: string;
  url_path?: string;
  meta_title?: string;
  meta_description?: string;
  og_image_url?: string;
  slots?: Record<string, unknown>;
}

export interface StudioPopup {
  popup_key?: string;
  trigger_type?: string;
  trigger_value?: number;
  audience?: string;
  content?: Record<string, unknown>;
  display_rules?: Record<string, unknown>;
}

export interface NavItem {
  label: string;
  url: string;
  children?: { label: string; url: string }[];
}
export interface FooterColumn {
  title: string;
  links: { label: string; url: string }[];
}
export interface StudioNavigation {
  header_items?: NavItem[];
  footer_columns?: FooterColumn[];
  socials?: Record<string, string>;
}

const PagesCtx = createContext<StudioPage[]>([]);
const PopupsCtx = createContext<StudioPopup[]>([]);
const NavCtx = createContext<StudioNavigation | null>(null);

export function SiteConfigProvider({
  pages,
  popups,
  navigation,
  children,
}: {
  pages?: StudioPage[];
  popups?: StudioPopup[];
  navigation?: StudioNavigation | null;
  children: ReactNode;
}) {
  return (
    <PagesCtx.Provider value={pages ?? []}>
      <PopupsCtx.Provider value={popups ?? []}>
        <NavCtx.Provider value={navigation ?? null}>{children}</NavCtx.Provider>
      </PopupsCtx.Provider>
    </PagesCtx.Provider>
  );
}

/** Published navigation (header items / footer columns / socials), or null. */
export function useNavigation(): StudioNavigation | null {
  return useContext(NavCtx);
}

/** Published popup config by key (undefined when unseeded). */
export function usePopup(popupKey: string): StudioPopup | undefined {
  const popups = useContext(PopupsCtx);
  return popups.find((p) => p.popup_key === popupKey);
}

/** Published slots for a page_key (empty object when unseeded). */
export function usePageSlots(pageKey: string): Record<string, unknown> {
  const pages = useContext(PagesCtx);
  const p = pages.find((x) => x.page_key === pageKey);
  return (p?.slots as Record<string, unknown>) ?? {};
}

/** Merge published slots over a page's baked defaults. */
export function withSlots<T extends object>(def: T, slots: Record<string, unknown>): T {
  return { ...def, ...(slots as Partial<T>) };
}
