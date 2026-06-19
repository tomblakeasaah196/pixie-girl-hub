import Link from "next/link";

/**
 * Root index for the sales subdomain.
 *
 * In normal operation every URL on sales.* lands on /sale/<slug>. The
 * apex (sales.pixiegirlglobal.com/) renders this graceful placeholder so
 * the domain never shows a 404 to a confused visitor — it gently nudges
 * them to the main storefront.
 */
export default function Page() {
  return (
    <main className="min-h-screen grid place-items-center px-6 py-16">
      <div className="glass rounded-[var(--radius)] p-8 max-w-md text-center space-y-4">
        <div className="micro">No live sale right now</div>
        <h1 className="font-display text-3xl leading-tight">
          The doors are{" "}
          <span className="italic text-[rgb(var(--accent-glow))]">closed</span>{" "}
          — for now.
        </h1>
        <p className="text-[rgb(var(--text-muted))] text-sm">
          When a new sale opens we&apos;ll meet you back here. In the meantime,
          shop our full collection on the main storefront.
        </p>
        <Link
          href="https://pixiegirlglobal.com"
          className="inline-flex items-center justify-center h-11 px-5 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
        >
          Visit the storefront →
        </Link>
      </div>
    </main>
  );
}
