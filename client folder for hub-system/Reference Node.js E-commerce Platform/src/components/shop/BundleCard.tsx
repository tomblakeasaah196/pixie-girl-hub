import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Price } from "@/components/site/Price";
import {
  type Bundle,
  bundleCompareAtUsd,
  bundleSavingsUsd,
  bundleSavingsPct,
  getBundleProducts,
} from "@/lib/bundles";

export function BundleCard({ bundle, highlighted = false }: { bundle: Bundle; highlighted?: boolean }) {
  const members = getBundleProducts(bundle);
  const cover = bundle.image ?? members[0]?.images[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={`grid md:grid-cols-[1.1fr_1fr] gap-px border ${highlighted ? "border-rose/40 bg-rose/[0.04]" : "border-taupe/20 bg-card/30"}`}
    >
      <div className="relative aspect-[5/4] md:aspect-auto bg-ink overflow-hidden">
        {cover && (
          <img src={cover} alt={bundle.name} className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:scale-105 transition-transform duration-700" />
        )}
        <span className="absolute top-4 left-4 bg-rose text-ink text-[0.6rem] tracking-[0.4em] uppercase px-3 py-1.5">
          Save {bundleSavingsPct(bundle)}%
        </span>
      </div>

      <div className="p-7 md:p-10 flex flex-col justify-center">
        <p className="text-[0.65rem] tracking-[0.5em] uppercase text-rose mb-3">Bundle · meilleur ensemble</p>
        <h3 className="font-display text-3xl md:text-4xl leading-tight">{bundle.name}</h3>
        <p className="text-cream/70 mt-3">{bundle.tagline}</p>

        <ul className="mt-6 space-y-2 text-sm text-cream/75">
          {members.map((p) => (
            <li key={p.slug} className="flex gap-3">
              <span className="text-taupe">—</span>{p.name}
            </li>
          ))}
        </ul>

        <div className="mt-7 flex items-baseline gap-4">
          <Price usd={bundle.priceUsd} ngnOverride={bundle.priceNgn} className="text-3xl font-display text-taupe" />
          <Price usd={bundleCompareAtUsd(bundle)} className="text-base text-cream/40 line-through" />
        </div>
        <p className="text-[0.65rem] tracking-[0.4em] uppercase text-rose mt-2">
          You save <Price usd={bundleSavingsUsd(bundle)} forceUsd />
        </p>

        <Link
          to="/bundles/$slug"
          params={{ slug: bundle.slug }}
          className="mt-7 inline-block self-start px-7 py-3.5 bg-taupe text-ink text-[0.65rem] tracking-[0.4em] uppercase hover:bg-cream transition-colors"
        >
          See the bundle →
        </Link>
      </div>
    </motion.div>
  );
}
