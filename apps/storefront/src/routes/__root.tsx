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
import { SiteConfigProvider, type StudioPage } from "@/lib/site-config";

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
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
});

// Colour/type tokens the Studio theme may override. Non-CSS-var keys like
// `logo_url` are consumed separately (see logoFrom) and skipped here.
function tokensToCss(tokens?: Record<string, string>): string | null {
  if (!tokens || Object.keys(tokens).length === 0) return null;
  const body = Object.entries(tokens)
    .filter(([k]) => k.startsWith("--") || k.startsWith("color") || k.startsWith("font"))
    .map(([k, v]) => `${k.startsWith("--") ? k : `--${k}`}: ${v};`)
    .join("");
  if (!body) return null;
  // Dark-first maison: Studio tokens override the baked DARK palette only, so
  // the light-mode inverse in :root is preserved.
  return `.dark{${body}}`;
}

function logoFrom(tokens?: Record<string, string>): string | undefined {
  return tokens?.logo_url || tokens?.["logo-url"] || undefined;
}

// Applied before paint so a stored light-mode choice doesn't flash dark.
const THEME_BOOT = `try{var t=localStorage.getItem('sf_theme');var d=document.documentElement;if(t==='light'){d.classList.remove('dark');d.classList.add('light');}else{d.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}`;

function RootShell({ children }: { children: ReactNode }) {
  const { brand, theme } = Route.useLoaderData();
  const themeCss = tokensToCss(theme?.tokens);
  return (
    <html lang="en" data-brand={brand} className="dark">
      <head>
        <HeadContent />
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
  const { preview, theme, pages } = Route.useLoaderData();
  const logoUrl = logoFrom(theme?.tokens);
  return (
    <QueryClientProvider client={queryClient}>
      <SiteConfigProvider pages={pages}>
        {preview ? (
          <div className="bg-primary py-1.5 text-center text-[0.62rem] tracking-[0.4em] uppercase text-primary-foreground">
            Preview — showing draft changes (not published)
          </div>
        ) : null}
        <SiteHeader logoUrl={logoUrl} />
        <PageTransition>
          <Outlet />
        </PageTransition>
        <SiteFooter logoUrl={logoUrl} />
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
