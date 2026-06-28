import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ShoppingBag, User, Moon, Sun } from "lucide-react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { clientBrand, type BrandKey } from "@/lib/brand";
import { ssrSite } from "@/lib/server";
import { useCurrency, useCartCount } from "@/lib/useStore";

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
  // Resolve brand + published Studio theme via a server fn (the only place the
  // server-only request is read). Falls back to baked tokens if /site is empty.
  loader: async (): Promise<SiteConfig> => ssrSite(),
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
      <Preloader />
      <Header />
      <Outlet />
      <Footer />
      <Toaster position="bottom-center" theme="dark" />
    </QueryClientProvider>
  );
}

function Header() {
  const [currency, setCurrency] = useCurrency();
  const count = useCartCount();
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const isDark = !document.documentElement.classList.contains("light");
    setDark(isDark);
  }, []);
  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.classList.toggle("light", !next);
  };

  const brandName =
    clientBrand() === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 md:px-6">
        {/* Left: currency + theme */}
        <div className="flex items-center gap-3">
          <div className="flex overflow-hidden rounded-full border border-border text-xs">
            {(["NGN", "USD"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className={`px-2.5 py-1 ${currency === c ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
              >
                {c}
              </button>
            ))}
          </div>
          <button onClick={toggleDark} aria-label="Toggle theme" className="text-muted-foreground hover:text-foreground">
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>

        {/* Center: logo */}
        <Link to="/" className="text-h5 md:text-h4 font-display tracking-tight">
          {brandName}
        </Link>

        {/* Right: account + cart */}
        <div className="flex items-center gap-4">
          <Link to="/auth" className="text-muted-foreground hover:text-foreground" aria-label="Account">
            <User size={18} />
          </Link>
          <Link to="/cart" className="relative text-muted-foreground hover:text-foreground" aria-label="Cart">
            <ShoppingBag size={18} />
            {count > 0 ? (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose px-1 text-[10px] text-cream">
                {count}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 pb-2 text-caption md:px-6">
        <Link to="/shop" className="hover:text-foreground">Shop</Link>
        <Link to="/shades" className="hover:text-foreground">Shades</Link>
        <Link to="/bundles" className="hover:text-foreground">Bundles</Link>
      </nav>
    </header>
  );
}

function Preloader() {
  // 2s logo shimmer on first visit of the session; respects reduced motion.
  const [show, setShow] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced || sessionStorage.getItem("sf_preloaded")) return;
    setShow(true);
    const t1 = setTimeout(() => setLeaving(true), 1700);
    const t2 = setTimeout(() => {
      setShow(false);
      sessionStorage.setItem("sf_preloaded", "1");
    }, 2100);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (!show) return null;
  const brandName =
    clientBrand() === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl";
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background transition-opacity duration-300"
      style