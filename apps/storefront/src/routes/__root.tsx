import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { type BrandKey } from "@/lib/brand";
import { ssrSite } from "@/lib/server";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { PageTransition } from "@/components/site/PageTransition";
import { NewsletterModal } from "@/components/site/NewsletterModal";
import { CartDrawer } from "@/components/site/CartDrawer";
import { FloatingToolbar } from "@/components/site/FloatingToolbar";
import { SiteConfigProvider, type StudioPage } from "@/lib/site-config";
import { resolveToolbar } from "@/lib/toolbar";

/*
 * SSR shell for the Storefront Website (dark-first maison).
 * 1. Resolve brand from the request host (apps/landing pattern).
 * 2. Fetch published Studio config (theme tokens) from the Hub.
 * 3. Inject theme tokens as CSS variables + set <html data-brand class="dark">,
 *    then render the ported SiteHeader / SiteFooter chrome. Falls back to the
 *    baked maison tokens when /site is not published yet.
 */

interface SiteConfig {
  brand: BrandKey;
  theme?: { tokens?: Record<string, string> };
  navigation?: unknown;
  pages?: StudioPage[];
  popups?: unknown[];
  preview?: boolean;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async (): Promise<SiteConfig> => ssrSite(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "robots", content: "index,follow,max-image-preview:large" },
      { name: "theme-color", content: "#0c0a09" },
    ],
    // The favicon is emitted dynamically in RootShell from the Studio-uploaded
    // branding tokens (dark/light aware), so it isn't declared here.
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
});

// Branding tokens are consumed as image URLs (logo <img>, favicon <link>), not
// as CSS custom properties — keep them out of the palette <style> block.
const NON_CSS_TOKENS = new Set([
  "--logo-url",
  "--logo-url-dark",
  "--logo-url-light",
  "--favicon-url",
  "--favicon-url-dark",
  "--favicon-url-light",
  "--og-image",
]);

// Colour/type tokens the Studio theme may override. Branding image keys (logo /
// favicon / OG) are consumed separately (see brandingFrom) and skipped here.
function tokensToCss(tokens?: Record<string, string>): string | null {
  if (!tokens || Object.keys(tokens).length === 0) return null;
  const body = Object.entries(tokens)
    .filter(
      ([k]) =>
        !NON_CSS_TOKENS.has(k) &&
        (k.startsWith("--") || k.startsWith("color") || k.startsWith("font")),
    )
    .map(([k, v]) => `${k.startsWith("--") ? k : `--${k}`}: ${v};`)
    .join("");
  if (!body) return null;
  // Dark-first maison: Studio tokens override the baked DARK palette only, so
  // the light-mode inverse in :root is preserved.
  return `.dark{${body}}`;
}

const BRAND_NAMES: Record<BrandKey, string> = {
  faitlynhair: "Faitlyn Hair",
  pixiegirl: "Pixie Girl",
};

function firstToken(
  tokens: Record<string, string> | undefined,
  keys: string[],
): string | undefined {
  if (!tokens) return undefined;
  for (const k of keys) {
    const v = tokens[k];
    if (v) return v;
  }
  return undefined;
}

// Resolve the operator's uploaded logos/favicons from the theme tokens. Reads
// the dark/light keys, falling back to the legacy single key (`--logo-url` /
// `--favicon-url`, and the older non-prefixed aliases) so nothing regresses.
function brandingFrom(tokens: Record<string, string> | undefined, brand: BrandKey) {
  return {
    name: BRAND_NAMES[brand] ?? "",
    logoDark: firstToken(tokens, ["--logo-url-dark", "--logo-url", "logo_url", "logo-url"]),
    logoLight: firstToken(tokens, ["--logo-url-light", "--logo-url", "logo_url", "logo-url"]),
    faviconDark: firstToken(tokens, ["--favicon-url-dark", "--favicon-url", "favicon_url", "favicon-url"]),
    faviconLight: firstToken(tokens, ["--favicon-url-light", "--favicon-url", "favicon_url", "favicon-url"]),
  };
}

// Applied before paint so a stored light-mode choice doesn't flash dark.
const THEME_BOOT = `try{var t=localStorage.getItem('sf_theme');var d=document.documentElement;if(t==='light'){d.classList.remove('dark');d.classList.add('light');}else{d.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}`;

function RootShell({ children }: { children: ReactNode }) {
  const { brand, theme } = Route.useLoaderData();
  const themeCss = tokensToCss(theme?.tokens);
  const { faviconDark, faviconLight } = brandingFrom(theme?.tokens, brand);
  // Dark-default site → the plain link (fallback for browsers that ignore
  // `media` on icons) uses the dark favicon; the media links pick the right
  // one by the browser/OS colour scheme, which is what renders the tab.
  const faviconDefault = faviconDark || faviconLight;
  return (
    <html lang="en" data-brand={brand} className="dark">
      <head>
        <HeadContent />
        {faviconDefault ? (
          <>
            <link rel="icon" href={faviconDefault} />
            <link rel="icon" href={faviconDark || faviconDefault} media="(prefers-color-scheme: dark)" />
            <link rel="icon" href={faviconLight || faviconDefault} media="(prefers-color-scheme: light)" />
          </>
        ) : (
          <link rel="icon" href="/favicon.ico" />
        )}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        {themeCss ? (
          <style dangerouslySetInnerHTML={{ __html: themeCss }} />
        ) : null}
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { preview, theme, pages, popups, navigation, brand } =
    Route.useLoaderData();
  const branding = brandingFrom(theme?.tokens, brand);
  // Toolbar config lives in the theme tokens (Studio → Toolbar); fall back to
  // the brand's WhatsApp from nav socials when no number is set there.
  const navSocials = (navigation as { socials?: Record<string, string> } | null)
    ?.socials;
  const toolbar = resolveToolbar(
    (theme?.tokens as Record<string, unknown> | undefined)?.toolbar,
    navSocials?.whatsapp,
  );
  return (
    <QueryClientProvider client={queryClient}>
      <SiteConfigProvider
        pages={pages}
        popups={popups as never}
        navigation={navigation as never}
        branding={branding}
        toolbar={toolbar}
      >
        {preview ? (
          <div className="bg-primary py-1.5 text-center text-[0.62rem] tracking-[0.4em] uppercase text-primary-foreground">
            Preview — showing draft changes (not published)
          </div>
        ) : null}
        <SiteHeader />
        <PageTransition>
          <Outlet />
        </PageTransition>
        <SiteFooter />
        <FloatingToolbar />
        <CartDrawer />
        <NewsletterModal />
        <Toaster position="bottom-center" theme="dark" />
      </SiteConfigProvider>
    </QueryClientProvider>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4 text-cream">
      <div className="text-center">
        <h1 className="font-display text-7xl">404</h1>
        <p className="mt-3 text-sm text-taupe">This page does not exist.</p>
        <Link
          to="/"
          className="mt-6 inline-block text-[0.65rem] tracking-[0.4em] uppercase text-taupe underline-offset-4 hover:underline"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
