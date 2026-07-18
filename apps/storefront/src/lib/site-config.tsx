import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_TOOLBAR, type ToolbarConfig } from "./toolbar";

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
  display_order?: number;
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

/**
 * Studio config is authored in the admin, and older drafts stored link targets
 * under `href` while the storefront reads `url`. Normalise once at the root so
 * every consumer (header, mobile drawer, footer) sees a clean `{ label, url }`
 * — a link with only `href` would otherwise render as a dead `to={undefined}`.
 */
function coerceLink(x: unknown): { label: string; url: string } {
  const o = (x || {}) as Record<string, unknown>;
  return {
    label: typeof o.label === "string" ? o.label : "",
    url:
      (typeof o.url === "string" && o.url) ||
      (typeof o.href === "string" && o.href) ||
      "/",
  };
}
function normalizeNavigation(
  nav?: StudioNavigation | null,
): StudioNavigation | null {
  if (!nav) return null;
  return {
    ...nav,
    header_items: Array.isArray(nav.header_items)
      ? nav.header_items.map((it) => {
          const base = coerceLink(it);
          const kids = (it as { children?: unknown }).children;
          return {
            ...base,
            children: Array.isArray(kids) ? kids.map(coerceLink) : undefined,
          };
        })
      : nav.header_items,
    footer_columns: Array.isArray(nav.footer_columns)
      ? nav.footer_columns.map((col) => ({
          title: typeof col?.title === "string" ? col.title : "",
          links: Array.isArray(col?.links) ? col.links.map(coerceLink) : [],
        }))
      : nav.footer_columns,
  };
}

/**
 * Resolved branding for the chrome — the operator's uploaded logos/favicons
 * (Storefront Studio → Branding, stored as theme tokens) plus the brand's
 * display name. The dark/light logo swaps with the site theme; the header and
 * footer share the same assets so they always match.
 */
export interface SiteBranding {
  name: string;
  logoDark?: string;
  logoLight?: string;
  faviconDark?: string;
  faviconLight?: string;
}

const PagesCtx = createContext<StudioPage[]>([]);
const PopupsCtx = createContext<StudioPopup[]>([]);
const NavCtx = createContext<StudioNavigation | null>(null);
const BrandingCtx = createContext<SiteBranding>({ name: "" });
const ToolbarCtx = createContext<ToolbarConfig>(DEFAULT_TOOLBAR);

export function SiteConfigProvider({
  pages,
  popups,
  navigation,
  branding,
  toolbar,
  children,
}: {
  pages?: StudioPage[];
  popups?: StudioPopup[];
  navigation?: StudioNavigation | null;
  branding?: SiteBranding;
  toolbar?: ToolbarConfig;
  children: ReactNode;
}) {
  return (
    <PagesCtx.Provider value={pages ?? []}>
      <PopupsCtx.Provider value={popups ?? []}>
        <NavCtx.Provider value={normalizeNavigation(navigation)}>
          <BrandingCtx.Provider value={branding ?? { name: "" }}>
            <ToolbarCtx.Provider value={toolbar ?? DEFAULT_TOOLBAR}>
              {children}
            </ToolbarCtx.Provider>
          </BrandingCtx.Provider>
        </NavCtx.Provider>
      </PopupsCtx.Provider>
    </PagesCtx.Provider>
  );
}

/** Published navigation (header items / footer columns / socials), or null. */
export function useNavigation(): StudioNavigation | null {
  return useContext(NavCtx);
}

/** Resolved branding (logos/favicons/name) for header, footer and preloader. */
export function useBranding(): SiteBranding {
  return useContext(BrandingCtx);
}

/** Resolved floating-toolbar config (buttons, dock, WhatsApp, help steps). */
export function useToolbar(): ToolbarConfig {
  return useContext(ToolbarCtx);
}

/** Published popup config by key (undefined when unseeded). */
export function usePopup(popupKey: string): StudioPopup | undefined {
  const popups = useContext(PopupsCtx);
  return popups.find((p) => p.popup_key === popupKey);
}

/** Every published popup, in display order (empty when unseeded). The generic
 *  StudioPopups renderer reads this so any Studio-created popup shows up — not
 *  just the bespoke ones (newsletter) that have their own component. */
export function usePopups(): StudioPopup[] {
  return useContext(PopupsCtx);
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
