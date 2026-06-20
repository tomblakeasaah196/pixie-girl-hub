"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="min-h-screen grid place-items-center px-6 py-16">
      <div className="glass rounded-[var(--radius)] p-8 max-w-md text-center space-y-4">
        <div className="micro">Something interrupted us</div>
        <h1 className="font-display text-3xl leading-tight">
          We hit a{" "}
          <span className="italic text-[rgb(var(--accent-glow))]">snag</span>{" "}
          loading this sale.
        </h1>
        <p className="text-[rgb(var(--text-muted))] text-sm">
          {error?.message?.startsWith("Hub returned")
            ? error.message
            : "Please try again in a moment."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center h-11 px-5 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
