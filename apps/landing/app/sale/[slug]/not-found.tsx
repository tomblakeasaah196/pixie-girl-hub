import Link from "next/link";

export default function NotFound() {
  return (
    <main className="min-h-screen grid place-items-center px-6 py-16">
      <div className="glass rounded-[var(--radius)] p-8 max-w-md text-center space-y-4">
        <div className="micro">Not the page you remember</div>
        <h1 className="font-display text-3xl leading-tight">
          That sale has <span className="italic text-[rgb(var(--accent-glow))]">left the room.</span>
        </h1>
        <p className="text-[rgb(var(--text-muted))] text-sm">
          You may be a few hours too late — or the link is mistyped. Either
          way, our full collection is alive and well on the main storefront.
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
