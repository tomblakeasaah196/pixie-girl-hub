import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

import appCss from "../styles.css?url";

/**
 * SSR shell for the Stylist Partner Programme portal (§6.26).
 * Public pages (landing / apply / verify / directory) are SEO-shaped; the
 * review page and the dashboard opt out via their own head() meta.
 */
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "theme-color", content: "#0f0809" },
      {
        title: "Pixie Girl Global — Stylist Partner Programme",
      },
      {
        name: "description",
        content:
          "The global reference network for Pixie hair styling. Vetted, certified partner stylists with verifiable badges — apply to join, or find a certified stylist near you.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
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
      <div className="min-h-dvh flex flex-col">
        <Header />
        <main className="flex-1">
          <Outlet />
        </main>
        <Footer />
      </div>
    </QueryClientProvider>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 glass">
      <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-3 no-underline">
          <span className="grid place-items-center w-9 h-9 rounded-full border border-accent/60 text-cream font-display text-[15px]">
            P
          </span>
          <span className="font-display text-[17px] text-cream">
            Pixie Girl <span className="text-accent-glow">Style</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-[13px] font-semibold">
          <Link
            to="/stylists"
            className="px-3.5 py-2 rounded-full text-cream-muted hover:text-cream no-underline transition-colors"
          >
            Find a stylist
          </Link>
          <Link
            to="/apply"
            className="hidden sm:inline-flex px-3.5 py-2 rounded-full text-cream-muted hover:text-cream no-underline transition-colors"
          >
            Apply
          </Link>
          <Link to="/apply" className="btn-primary !py-2.5 !px-5 no-underline">
            Become a partner
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line mt-20">
      <div className="mx-auto max-w-6xl px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-[12px] text-cream-faint">
          © {new Date().getFullYear()} Pixie Girl Global — Stylist Partner
          Programme. Every badge verifies live; every review comes from a real
          routed customer.
        </p>
        <div className="flex gap-5 text-[12px] text-cream-muted">
          <Link to="/stylists" className="no-underline hover:text-cream">
            Directory
          </Link>
          <Link to="/apply" className="no-underline hover:text-cream">
            Apply
          </Link>
          <a
            href="https://pixiegirlglobal.com"
            className="no-underline hover:text-cream"
          >
            pixiegirlglobal.com
          </a>
        </div>
      </div>
    </footer>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-5 py-32 text-center">
      <div className="font-display text-[42px] mb-3">Lost your lace?</div>
      <p className="text-cream-muted text-[14px] mb-8">
        This page doesn't exist. The programme lives at the links below.
      </p>
      <div className="flex justify-center gap-3">
        <Link to="/" className="btn-primary no-underline">
          Programme home
        </Link>
        <Link to="/stylists" className="btn-ghost no-underline">
          Find a stylist
        </Link>
      </div>
    </div>
  );
}
