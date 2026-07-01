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

const PagesCtx = createContext<StudioPage[]>([]);

export function SiteConfigProvider({
  pages,
  children,
}: {
  pages?: StudioPage[];
  children: ReactNode;
}) {
  return <PagesCtx.Provider value={pages ?? []}>{children}</PagesCtx.Provider>;
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
