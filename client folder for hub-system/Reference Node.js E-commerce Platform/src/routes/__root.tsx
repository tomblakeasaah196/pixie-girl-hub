import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { CartProvider } from "@/lib/cart";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider, themeBootstrapScript, useTheme } from "@/lib/theme";
import { CurrencyProvider } from "@/lib/currency";
import { AmbientBackground } from "@/components/site/AmbientBackground";
import { CartDrawer } from "@/components/site/CartDrawer";
import { NewsletterModal } from "@/components/site/NewsletterModal";
import { PageTransition } from "@/components/site/PageTransition";
import { Toaster } from "sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl text-taupe">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center bg-taupe px-6 py-3 text-[0.7rem] tracking-[0.4em] uppercase text-ink hover:bg-cream transition-colors">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong on our end.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="bg-taupe px-4 py-2 text-sm text-ink">Try again</button>
          <a href="/" className="border border-taupe/40 px-4 py-2 text-sm text-taupe">Go home</a>
        </div>
      </div>
    </div>
  );
}

const ORG_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Faitlyn Hair",
  url: "/",
  logo: "/favicon.ico",
  sameAs: [],
  description: "A Lagos atelier crafting the world's most coveted pixies, bobs and curls. Hand-finished, lace-perfect luxury hair, shipped worldwide.",
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Sitewide defaults — leaf routes override title/description and add their own canonical/og:url.
      { title: "Faitlyn Hair — Luxury Natural Hair, Crafted in Lagos" },
      { name: "description", content: "Hand-finished pixies, bobs and curls from a Lagos atelier. Shipped worldwide." },
      { name: "theme-color", content: "#0c0a09" },
      { name: "format-detection", content: "telephone=no" },
      { property: "og:site_name", content: "Faitlyn Hair" },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "en_US" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@faitlynhair" },
      { name: "robots", content: "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" },
      { property: "og:title", content: "Faitlyn Hair — Luxury Natural Hair, Crafted in Lagos" },
      { name: "twitter:title", content: "Faitlyn Hair — Luxury Natural Hair, Crafted in Lagos" },
      { property: "og:description", content: "Hand-finished pixies, bobs and curls from a Lagos atelier. Shipped worldwide." },
      { name: "twitter:description", content: "Hand-finished pixies, bobs and curls from a Lagos atelier. Shipped worldwide." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/bbc8eb69-5dbc-4db5-8f1e-66dbe1aef3dd" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/bbc8eb69-5dbc-4db5-8f1e-66dbe1aef3dd" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Adaptive favicon — browsers pick the asset matching the user's system theme.
      { rel: "icon", type: "image/svg+xml", href: "/favicon-light.svg", media: "(prefers-color-scheme: light)" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon-dark.svg", media: "(prefers-color-scheme: dark)" },
      // Fallback for browsers that ignore the media query.
      { rel: "alternate icon", href: "/favicon.ico" },
    ],
    scripts: [
      { children: themeBootstrapScript },
      { type: "application/ld+json", children: JSON.stringify(ORG_LD) },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
      <ThemeProvider>
        <AuthProvider>
          <CurrencyProvider>
            <CartProvider>
              <AmbientBackground />
              <PageTransition>
                <Outlet />
              </PageTransition>
              <CartDrawer />
              <NewsletterModal />
              <ThemedToaster />
            </CartProvider>
          </CurrencyProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme ?? "dark"} position="bottom-right" />;
}
