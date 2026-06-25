/**
 * Checkout loading skeleton.
 *
 * Critical: without this file the App Router has NO instant UI to show while the
 * checkout server component awaits `fetchCampaign`. A `router.push` into a slow
 * (cold backend / live-sale load) render would commit nothing — the buyer taps
 * "Checkout", the drawer closes, and the screen sits on the sale page as if the
 * button did nothing. With a loading boundary the navigation commits IMMEDIATELY
 * to this skeleton, so the buyer always sees they're moving to checkout.
 */
export default function Loading() {
  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto max-w-[1080px] px-6 md:px-10 pt-10">
        <div className="h-4 w-28 rounded bg-[rgb(var(--text)/0.06)] animate-pulse" />
        <div className="h-10 w-64 rounded bg-[rgb(var(--text)/0.06)] animate-pulse mt-4" />

        <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="glass rounded-[var(--radius)] p-5 space-y-3"
              >
                <div className="h-5 w-32 rounded bg-[rgb(var(--text)/0.06)] animate-pulse" />
                <div className="h-11 rounded-xl bg-[rgb(var(--text)/0.04)] animate-pulse" />
                <div className="h-11 rounded-xl bg-[rgb(var(--text)/0.04)] animate-pulse" />
              </div>
            ))}
          </div>
          <aside className="h-fit">
            <div className="glass rounded-[var(--radius)] p-5 space-y-4">
              <div className="h-5 w-36 rounded bg-[rgb(var(--text)/0.06)] animate-pulse" />
              <div className="h-4 rounded bg-[rgb(var(--text)/0.04)] animate-pulse" />
              <div className="h-4 w-2/3 rounded bg-[rgb(var(--text)/0.04)] animate-pulse" />
              <div className="h-12 rounded-xl bg-[rgb(var(--text)/0.06)] animate-pulse mt-2" />
              <p className="micro text-center animate-pulse">
                Securing your checkout…
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
