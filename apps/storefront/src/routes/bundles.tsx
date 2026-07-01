import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { getBundles, addCartItem, fmt } from "@/lib/storefront";
import { useCurrency, notifyCartChanged } from "@/lib/useStore";
import { usePageSlots, withSlots } from "@/lib/site-config";

export const Route = createFileRoute("/bundles")({
  head: () => ({ meta: [{ title: "Bundles — Better Together · Faitlyn Hair" }] }),
  component: BundlesPage,
});

const n = (x: unknown) => (x == null ? 0 : Number(x) || 0);

function BundlesPage() {
  const [currency] = useCurrency();
  const [busy, setBusy] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["bundles"], queryFn: () => getBundles() });
  const bundles = data ?? [];
  const s = withSlots(
    {
      eyebrow: "Bundles · Ensembles",
      heading: "Better ",
      headingAccent: "together",
      headingAfter: ".",
      body: "Curated sets at a couture discount. Three pieces. Two pieces. One opportunity to save.",
    },
    usePageSlots("bundles"),
  );

  async function add(bundle_id: string) {
    setBusy(bundle_id);
    try {
      await addCartItem({ bundle_id, quantity: 1, display_currency: currency });
      notifyCartChanged();
      toast.success("Bundle added to your bag");
    } catch {
      toast.error("Couldn't add bundle. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="bg-ink text-cream">
      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-32 md:pt-28 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe">{s.eyebrow}</p>
          <h1 className="mt-5 font-display text-5xl md:text-7xl leading-[0.95] tracking-tight text-balance">
            {s.heading}<em className="gold-shimmer not-italic">{s.headingAccent}</em>{s.headingAfter}
          </h1>
          <p className="mt-6 text-cream/70 leading-relaxed text-base md:text-lg">{s.body}</p>
        </motion.div>
      </section>

      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pb-32 space-y-6">
        {isLoading ? (
          <div className="h-[520px] w-full animate-pulse bg-card" />
        ) : bundles.length === 0 ? (
          <p className="py-24 text-center text-cream/50">No bundles available right now.</p>
        ) : (
          bundles.map((b, i) => {
            const comps = b.components ?? [];
            const compareAt = comps.reduce((s, c) => s + n(c.price_ngn) * (Number(c.quantity) || 1), 0);
            const price = n(b.bundle_price_ngn);
            const savePct = compareAt > 0 ? Math.round(((compareAt - price) / compareAt) * 100) : 0;
            const cover = b.hero_image_url ?? comps[0]?.image_url;
            return (
              <motion.article
                key={b.bundle_id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.8, delay: (i % 2) * 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="grid lg:grid-cols-2 border border-taupe/15 bg-card overflow-hidden"
              >
                <div className="relative min-h-[320px] lg:min-h-[520px] overflow-hidden group">
                  {cover ? (
                    <img src={cover} alt={b.display_name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-105" />
                  ) : null}
                  {savePct > 0 ? (
                    <span className="absolute top-5 left-5 bg-rose text-ink text-[0.6rem] tracking-[0.4em] uppercase px-3 py-1.5">
                      Save {savePct}%
                    </span>
                  ) : null}
                </div>
                <div className="p-8 md:p-14 flex flex-col justify-center">
                  <p className="text-[0.62rem] tracking-[0.4em] uppercase text-rose">Bundle · Meilleur ensemble</p>
                  <h2 className="mt-4 font-display text-4xl md:text-5xl leading-tight">{b.display_name}</h2>
                  {b.description ? <p className="mt-4 text-cream/70 leading-relaxed max-w-md">{b.description}</p> : null}
                  {comps.length ? (
                    <ul className="mt-6 space-y-2">
                      {comps.map((c, idx) => (
                        <li key={idx} className="flex items-center gap-3 text-cream/85">
                          <span className="text-taupe">—</span>
                          {c.name || "Piece"}
                          {c.quantity && c.quantity > 1 ? <span className="text-cream/40 text-sm">×{c.quantity}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-8 flex items-baseline gap-3">
                    <span className="font-display text-3xl text-taupe">{fmt(price, "NGN")}</span>
                    {compareAt > price ? <span className="text-cream/40 line-through">{fmt(compareAt, "NGN")}</span> : null}
                  </div>
                  {compareAt > price ? (
                    <p className="mt-2 text-[0.62rem] tracking-[0.4em] uppercase text-rose">You save {fmt(compareAt - price, "NGN")}</p>
                  ) : null}
                  <div className="mt-8 flex flex-wrap gap-4">
                    <button
                      onClick={() => add(b.bundle_id)}
                      disabled={busy === b.bundle_id}
                      className="bg-taupe text-ink px-9 py-4 text-[0.7rem] tracking-[0.4em] uppercase font-medium hover:bg-cream transition-colors disabled:opacity-60"
                    >
                      {busy === b.bundle_id ? "Adding…" : "Add to bag"}
                    </button>
                    <Link
                      to="/bundles/$slug"
                      params={{ slug: b.bundle_code }}
                      className="border border-taupe/40 text-taupe px-9 py-4 text-[0.7rem] tracking-[0.4em] uppercase hover:bg-taupe/10 transition-colors"
                    >
                      See bundle
                    </Link>
                  </div>
                </div>
              </motion.article>
            );
          })
        )}
      </section>
    </main>
  );
}
