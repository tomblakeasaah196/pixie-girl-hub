import Link from "next/link";

/**
 * Checkout not-found boundary.
 *
 * Reached when the checkout server component calls `notFound()` because
 * `fetchCampaign` returned a 404 (campaign unpublished / wrong slug). Without a
 * segment-local boundary this would fall through to Next's bare default 404,
 * which during a soft navigation can look like the button did nothing. This
 * gives a clear, on-brand dead-end with a way back.
 */
export default function CheckoutNotFound() {
  return (
    <main className="min-h-screen grid place-items-center px-6 py-16">
      <div className="glass rounded-[var(--radius)] p-8 max-w-md text-center space-y-4">
        <div className="micro">We couldn&apos;t find that checkout</div>
        <h1 className="font-display text-3xl leading-tight">
          This sale isn&apos;t{" "}
          <span className="italic text-[rgb(var(--accent-glow))]">
            taking orders
          </span>{" "}
          right now.
        </h1>
        <p className="text-[rgb(var(--text-muted))] text-sm">
          The link may have changed or the sale has closed. Our full collection
          is alive and well on the main storefront.
        </p>
        <Link
          href="https://pixiegirlglobal.com"
          className="inline-flex items-center justify-center h-11 px-5 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
        >
          Shop the collection →
        </Link>
      </div>
    </main>
  );
}
