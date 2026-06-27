import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { getWebRequest } from "@tanstack/react-start/server";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";
import { api } from "@/lib/api";
import { brandFromHost, type BrandKey } from "@/lib/brand";

/**
 * SSR shell for the Storefront Website.
 *
 *   1. Resolve brand from the request host (apps/landing pattern).
 *   2. Fetch the PUBLISHED Studio config for that brand (theme tokens, nav,
 *      popups) from the Hub. Studio is the source of truth for appearance.
 *   3. Inject the theme tokens as CSS variables + set <html data-brand>, then
 *      render. The header/footer/popups host are TODO (port from the reference;
 *      see PORTING.md) — this scaffold proves the brand + theme wiring only.
 */

interface SiteConfig {
  brand: BrandKey;
  theme?: { tokens?: Record<string, string> };
  navigation?: unknown;
  popups?: unknown[];
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async (): Promise<SiteConfig> => {
    // Server-side: read host (brand) + cookie (auth) from the live request.
    let brand: BrandKey = "pixiegirl";
    let cookie: string | undefined;
    try {
      const req = getWebRequest();
      brand = brandFromHost(req?.headers.get("host"));
      cookie = req?.headers.get("cookie") ?? undefined;
    } catch {
      // Non-request context (build/prerender) — fall back to env default.
      brand = brandFromHost(null);
    }

    try {
      const site = await api.get<SiteConfig>("/api/public/storefront/site", {
        brand,
        cookie,
      });
      return { ...site, brand };
    } catch {
      // Studio endpoint not live yet (Phase 4) — render with reference tokens.
      return { brand };
    }
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "robots", content: "index,follow,max-image-preview:large" },
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

function tokensToCss(tokens?: Record<string, string>): string | null {
  if (!tokens || Object.keys(tokens).length === 0) return null;
  const body = Object.entries(tokens)
    .map(([k, v]) => `${k.startsWith("--") ? k : `--${k}`}: ${v};`)
    .join("");
  return `:root{${body}}`;
}

function RootShell({ children }: { children: ReactNode }) {
  const { brand, theme } = Route.useLoaderData();
  const themeCss = tokensToCss(theme?.tokens);
  return (
    <html lang="en" data-brand={brand}>
      <head>
        <HeadContent />
        {themeCss ? <style dangerouslySetInnerHTML={{ __html: themeCss }} /> : null}
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
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="text-center">
        <h1 className="text-6xl font-bold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">This page doesn't exist.</p>
        <Link to="/" className="mt-6 inline-block underline">
          Go home
        </Link>
      </div>
    </div>
  );
}
