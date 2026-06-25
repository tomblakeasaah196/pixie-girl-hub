"use client";

/**
 * Checkout error boundary.
 *
 * Critical: without this file a throw inside the checkout server component
 * (e.g. `fetchCampaign` getting a 5xx from the Hub during a live sale) bubbles
 * past the segment with no boundary to catch it. During a client-side
 * `router.push` that aborts the navigation SILENTLY — the cart drawer closes
 * and the buyer is dumped back on the sale page with no explanation. This
 * boundary converts that silent failure into a visible, recoverable error with
 * a one-tap retry, so checkout never just "does nothing".
 */
import { useEffect } from "react";

export default function CheckoutError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console / monitoring so a live failure is never
    // invisible to us either.
    console.error("[checkout] render failed:", error);
  }, [error]);

  // The path is /checkout/<slug>; recover the slug for a "back to the sale"
  // link without needing route params (error.tsx receives none).
  const slug =
    typeof window !== "undefined"
      ? decodeURIComponent(window.location.pathname.split("/")[2] || "")
      : "";

  return (
    <main className="min-h-screen grid place-items-center px-6 py-16">
      <div className="glass rounded-[var(--radius)] p-8 max-w-md text-center space-y-4">
        <div className="micro">We couldn&apos;t open checkout</div>
        <h1 className="font-display text-3xl leading-tight">
          A quick{" "}
          <span className="italic text-[rgb(var(--accent-glow))]">hiccup</span>{" "}
          on our side.
        </h1>
        <p className="text-[rgb(var(--text-muted))] text-sm">
          Your cart is safe. This is usually momentary — please try again.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center pt-1">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center h-11 px-5 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
          >
            Try again
          </button>
          {slug && (
            <a
              href={`/sale/${slug}/live`}
              className="inline-flex items-center justify-center h-11 px-5 rounded-xl border border-[rgb(var(--border-c)/0.15)] text-[rgb(var(--text-muted))] font-semibold hover:text-[rgb(var(--text))]"
            >
              Back to the sale
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
