"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="min-h-screen grid place-items-center px-6 py-16 bg-black text-white/90">
      <div className="max-w-md text-center space-y-4">
        <div className="text-[10px] tracking-[0.4em] uppercase opacity-60">
          A small interruption
        </div>
        <h1
          className="text-3xl leading-tight"
          style={{ fontFamily: "var(--font-atelier-display, serif)" }}
        >
          We couldn&apos;t open this <em className="italic opacity-80">chapter</em>.
        </h1>
        <p className="text-sm opacity-70">
          {error?.message?.startsWith("Hub returned")
            ? error.message
            : "Please try again in a moment."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 items-center justify-center rounded-full px-5 text-[11px] tracking-[0.3em] uppercase"
          style={{
            background: "rgb(var(--brand-glow, 199 156 107))",
            color: "rgb(var(--brand-ink, 16 9 5))",
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
