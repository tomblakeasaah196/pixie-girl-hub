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

// ── Site-wide chrome (promo bar · footer copy · mobile-menu extras) ──────────
// These live on the whole site rather than any one page, so they ride a
// synthetic `site_chrome` page in Studio → Pages. Every value here has a control
// there; the storefront resolves the published slots over these defaults.

export interface PromoItem {
  text: string;
  /** Highlighted tail, e.g. a code ("FAITLYN10") or "auto-applied". */
  emphasis?: string;
  /** Optional path the strip links to. */
  url?: string;
}
export interface SiteChrome {
  promo: { items: PromoItem[] };
  /** Optional brand mark shown BETWEEN the phrases on BOTH announcement bars —
   *  the scrolling promo bar (top) and the value-prop ribbon below the hero.
   *  Empty → a subtle dot is used. Managed in Studio → Site chrome; falls back to
   *  the legacy Home "Divider image" upload so existing marks keep showing. */
  dividerImage: string;
  footer: { blurb: string; signature: string; copyrightName: string };
  drawer: {
    featureEyebrow: string;
    featureTitle: string;
    featureCta: string;
    featureHref: string;
    featureImage: string;
    signature: string;
    conciergeLabel: string;
    consultLabel: string;
  };
}

export const DEFAULT_SITE_CHROME: SiteChrome = {
  promo: {
    items: [
      { text: "Complimentary worldwide shipping on orders over $800" },
      { text: "Bulk savings — 2 pieces $40 off · 3 pieces $90 off", emphasis: "auto-applied" },
      { text: "First order? Take 10% off with code", emphasis: "FAITLYN10" },
      { text: "Refer & earn up to $50 atelier credit", url: "/account" },
    ],
  },
  dividerImage: "",
  footer: {
    blurb:
      "A Lagos-born atelier of luxury natural hair. Curated, ethically sourced, finished by hand.",
    signature: "Maison Faitlyn — fait à la main à Lagos",
    copyrightName: "",
  },
  drawer: {
    featureEyebrow: "New in",
    featureTitle: "The Maison Collection",
    featureCta: "Shop the drop",
    featureHref: "/shop",
    featureImage: "/maison/editorial-atelier.jpg",
    signature: "Est. Lagos · 2021",
    conciergeLabel: "Chat with a stylist",
    consultLabel: "Book a consultation",
  },
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown, def: string): string {
  return typeof v === "string" && v ? v : def;
}

/** Normalise the promo `items` slot (objects or bare strings) or null if empty. */
function resolvePromoItems(raw: unknown): PromoItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .map((x): PromoItem | null => {
      if (typeof x === "string") return x ? { text: x } : null;
      if (isObj(x)) {
        const text = str(x.text, "");
        if (!text) return null;
        return {
          text,
          emphasis: str(x.emphasis, "") || undefined,
          url: str(x.url, "") || str(x.to, "") || str(x.href, "") || undefined,
        };
      }
      return null;
    })
    .filter((x): x is PromoItem => x !== null);
  return items.length ? items : null;
}

/** Resolve the published `site_chrome` slots over the defaults. */
export function useSiteChrome(): SiteChrome {
  const slots = usePageSlots("site_chrome");
  // The divider mark is one shared value for BOTH bars: prefer the Site chrome
  // slot, then fall back to the legacy Home "Divider image" (marqueeImage) so a
  // mark already uploaded there keeps showing without a re-upload. All pages'
  // slots are hydrated at the root, so reading "home" works on every page.
  const homeSlots = usePageSlots("home");
  const promo = isObj(slots.promo) ? slots.promo : {};
  const footer = isObj(slots.footer) ? slots.footer : {};
  const drawer = isObj(slots.drawer) ? slots.drawer : {};
  const d = DEFAULT_SITE_CHROME;
  return {
    promo: { items: resolvePromoItems(promo.items) ?? d.promo.items },
    dividerImage:
      (typeof slots.dividerImage === "string" && slots.dividerImage) ||
      (typeof homeSlots.marqueeImage === "string" && homeSlots.marqueeImage) ||
      "",
    footer: {
      blurb: str(footer.blurb, d.footer.blurb),
      signature: str(footer.signature, d.footer.signature),
      copyrightName: str(footer.copyrightName, d.footer.copyrightName),
    },
    drawer: {
      featureEyebrow: str(drawer.featureEyebrow, d.drawer.featureEyebrow),
      featureTitle: str(drawer.featureTitle, d.drawer.featureTitle),
      featureCta: str(drawer.featureCta, d.drawer.featureCta),
      featureHref: str(drawer.featureHref, d.drawer.featureHref),
      featureImage: str(drawer.featureImage, d.drawer.featureImage),
      signature: str(drawer.signature, d.drawer.signature),
      conciergeLabel: str(drawer.conciergeLabel, d.drawer.conciergeLabel),
      consultLabel: str(drawer.consultLabel, d.drawer.consultLabel),
    },
  };
}
