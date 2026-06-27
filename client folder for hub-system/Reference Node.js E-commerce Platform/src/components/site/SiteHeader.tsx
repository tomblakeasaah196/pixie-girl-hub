import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { PromoBar } from "./PromoBar";
import { CurrencySwitcher } from "./CurrencySwitcher";
import { ThemeToggle } from "./ThemeToggle";
import logoLight from "@/assets/faitlyn-logo-light-mode.png.asset.json";
import logoDark from "@/assets/faitlyn-logo-dark-mode.png.asset.json";

type NavItem = { to: string; label: string };

function NavWithMenu({ label, to, items }: { label: string; to: string; items: NavItem[] }) {
  return (
    <div className="relative group">
      <Link
        to={to}
        className="hover:text-taupe transition-colors inline-flex items-center gap-1 py-2"
      >
        {label}
        <span aria-hidden className="text-[0.55rem] opacity-60 group-hover:opacity-100 transition-opacity">▾</span>
      </Link>
      <div
        className="invisible opacity-0 translate-y-1 group-hover:visible group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:visible group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all duration-200 absolute left-1/2 -translate-x-1/2 top-full pt-2 z-50"
        role="menu"
      >
        <div className="min-w-[180px] rounded-md border border-taupe/20 bg-ink/95 backdrop-blur-xl shadow-2xl py-2">
          {items.map((it) => (
            <Link
              key={it.to}
              to={it.to}
              role="menuitem"
              className="block px-4 py-2 text-[0.65rem] tracking-[0.28em] text-cream/85 hover:text-taupe hover:bg-cream/5 transition-colors"
            >
              {it.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SiteHeader() {
  const { count, setOpen } = useCart();
  const { user } = useAuth();
  return (
    <motion.header
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.9, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 inset-x-0 z-50"
    >
      <div className="bg-ink/40 backdrop-blur-xl border-b border-taupe/15">
        <PromoBar />
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 h-16 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <nav className="hidden md:flex items-center gap-8 text-[0.7rem] tracking-[0.32em] uppercase text-cream/85 justify-self-start">
            <NavWithMenu
              label="Shop"
              to="/shop"
              items={[
                { to: "/shop", label: "All catalogue" },
                { to: "/bundles", label: "Bundles" },
              ]}
            />
            <div className="relative">
              <Link to="/services" className="hover:text-taupe transition-colors inline-flex items-center gap-1 py-2">
                Services
              </Link>
            </div>
            <NavWithMenu
              label="Maison"
              to="/about"
              items={[
                { to: "/about", label: "Our story" },
                { to: "/journal", label: "Journal" },
              ]}
            />
          </nav>
          <Link to="/" className="flex items-center shrink-0 justify-self-center" aria-label="Faitlyn Hair — home">
            {/* Logo is a wide landscape wordmark (~3.14:1). Both variants are rendered
                so theme swap is hydration-safe and instant — CSS hides the inactive one. */}
            <img
              src={logoLight.url}
              alt="Faitlyn Hair"
              width={709}
              height={274}
              className="h-auto w-[120px] sm:w-[140px] md:w-[160px] lg:w-[170px] max-h-12 object-contain select-none block dark:hidden"
              draggable={false}
            />
            <img
              src={logoDark.url}
              alt=""
              aria-hidden="true"
              width={709}
              height={274}
              className="h-auto w-[120px] sm:w-[140px] md:w-[160px] lg:w-[170px] max-h-12 object-contain select-none hidden dark:block"
              draggable={false}
            />
          </Link>
          <nav className="flex gap-5 md:gap-7 text-[0.7rem] tracking-[0.32em] uppercase text-cream/85 items-center justify-self-end">
            <Link to="/contact" className="hidden md:inline hover:text-taupe transition-colors">Contact</Link>
            <CurrencySwitcher />
            <ThemeToggle />
            <Link to={user ? "/account" : "/auth"} className="hover:text-taupe transition-colors">
              {user ? "Account" : "Sign in"}
            </Link>
            <button onClick={() => setOpen(true)} className="text-taupe hover:text-cream transition-colors">
              Bag ({count})
            </button>
          </nav>
        </div>
      </div>
    </motion.header>
  );
}
