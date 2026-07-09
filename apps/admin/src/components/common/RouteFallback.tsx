import { Skeleton } from "@/components/ui/primitives";

/**
 * Route-level Suspense fallback for lazily-loaded module pages.
 *
 * Every lazy route previously used `fallback={null}`, which shows a blank
 * content area while the JS chunk downloads — noticeable on slow mobile
 * networks (the canon is mobile-first, and the buyer/staff base is on 3G/4G).
 * This renders a lightweight page skeleton (header + toolbar + rows) so a
 * navigation always has an immediate, on-brand loading state.
 *
 * Intentionally token-only (no inline hex) and cheap to render — it must not
 * itself pull in a heavy dependency, or it defeats the purpose.
 */
export function RouteFallback() {
  return (
    <div
      className="p-5 md:p-7 animate-fade-in"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>

      {/* Title + subtitle */}
      <Skeleton style={{ height: 26, width: "min(38%, 260px)" }} />
      <Skeleton className="mt-2.5" style={{ height: 13, width: "min(52%, 360px)" }} />

      {/* Toolbar row */}
      <div className="mt-6 flex flex-wrap gap-2.5">
        <Skeleton style={{ height: 38, width: 180, borderRadius: 12 }} />
        <Skeleton style={{ height: 38, width: 120, borderRadius: 12 }} />
        <Skeleton className="ml-auto" style={{ height: 38, width: 120, borderRadius: 12 }} />
      </div>

      {/* List / table rows */}
      <div className="mt-5 space-y-2.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton
            key={i}
            style={{ height: 52, borderRadius: 14, opacity: 1 - i * 0.07 }}
          />
        ))}
      </div>
    </div>
  );
}
