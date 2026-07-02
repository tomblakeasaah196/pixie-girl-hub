import { Link } from "@tanstack/react-router";
import { motion, type Variants } from "motion/react";
import { useEffect, useState } from "react";
import { useCartCount, openCart } from "@/lib/useStore";
import { PromoBar } from "./PromoBar";
import { CurrencySwitcher } from "./CurrencySwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { BrandLogo } from "./BrandLogo";
import { useNavigation, useBranding } from "@/lib/site-config";

// Fallback nav (used when Storefront Studio navigation isn't published yet).
const NAV_FALLBACK = [
  { label: "Shop", url: "/shop" },
  { label: "Bundles", url: "/bundles" },
  { label: "Services", url: "/services" },
  { label: "Maison", url: "/about" },
  { label: "Journal", url: "/journal" },
];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: -10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

export function SiteHeader() {
  const count = useCartCount();
  const nav = useNavigation();
  const { name } = useBranding();
  const items =
    nav?.header_items && nav.header_items.length ? nav.header_items : NAV_FALLBACK;
  // The cinematic preloader covers the first ~2s on the home page; gate the
  // header entrance so the stagger plays AFTER the gold reveal (and quickly on
  // return visits where the preloader is skipped).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let preloaded = false;
    try {
      preloaded = sessionStorage.getItem("faitlyn:preloaded") === "1";
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => setReady(true), preloaded ? 150 : 1950);
    return () => clearTimeout(t);
  }, []);

  return (
    <motion.header
      initial={{ y: -30, opacity: 0 }}
      animate={ready ? { y: 0, opacity: 1 } : { y: -30, opacity: 0 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 inset-x-0 z-50"
    >
      <div className="bg-ink/40 backdrop-blur-xl border-b border-taupe/15">
        <PromoBar />
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 h-16 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          {/* Left: primary nav — spread out, staggered entrance */}
          <motion.nav
            variants={container}
            initial="hidden"
            animate={ready ? "show" : "hidden"}
            className="hidden md:flex items-center gap-5 lg:gap-7 text-[0.68rem] tracking-[0.28em] uppercase text-cream/85 justify-self-start"
          >
            {items.map((n) => (
              <motion.div key={n.url} variants={item}>
                <Link to={n.url} className="relative py-2 transition-colors hover:text-taupe after:content-[''] after:absolute after:left-0 after:-bottom-0.5 after:h-px after:w-0 after:bg-taupe after:transition-all after:duration-300 hover:after:w-full">
                  {n.label}
                </Link>
              </motion.div>
            ))}
          </motion.nav>

          {/* Center: wordmark / logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={ready ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="justify-self-center"
          >
            <Link to="/" className="flex items-center shrink-0" aria-label={`${name || "Home"} — home`}>
              <BrandLogo
                imgClassName="h-auto w-[120px] sm:w-[140px] md:w-[160px] lg:w-[170px] max-h-12 object-contain select-none"
                fallback={
                  <span className="font-display text-base md:text-lg tracking-[0.28em] uppercase text-cream whitespace-nowrap">
                    {name || "Faitlyn Hair"}
                  </span>
                }
              />
            </Link>
          </motion.div>

          {/* Right: actions — staggered entrance */}
          <motion.nav
            variants={container}
            initial="hidden"
            animate={ready ? "show" : "hidden"}
            className="flex gap-4 md:gap-6 text-[0.7rem] tracking-[0.32em] uppercase text-cream/85 items-center justify-self-end"
          >
            <motion.div variants={item} className="hidden md:block">
              <Link to="/contact" className="hover:text-taupe transition-colors">Contact</Link>
            </motion.div>
            <motion.div variants={item}><CurrencySwitcher /></motion.div>
            <motion.div variants={item}><ThemeToggle /></motion.div>
            <motion.div variants={item}>
              <Link to="/auth" className="hover:text-taupe transition-colors">Sign in</Link>
            </motion.div>
            <motion.div variants={item}>
              <button onClick={openCart} className="text-taupe hover:text-cream transition-colors tracking-[0.28em] uppercase">
                Bag ({count})
              </button>
            </motion.div>
          </motion.nav>
        </div>

        {/* Mobile nav — horizontally scrollable */}
        <nav className="md:hidden flex items-center gap-5 overflow-x-auto px-6 pb-2.5 text-[0.62rem] tracking-[0.28em] uppercase text-cream/80 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {items.map((n) => (
            <Link key={n.url} to={n.url} className="whitespace-nowrap hover:text-taupe transition-colors">
              {n.label}
            </Link>
          ))}
          <Link to="/contact" className="whitespace-nowrap hover:text-taupe transition-colors">Contact</Link>
        </nav>
      </div>
    </motion.header>
  );
}
