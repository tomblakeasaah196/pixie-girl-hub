import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence, type Variants } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Facebook,
  Gift,
  Instagram,
  Menu,
  MessageCircle,
  ShoppingBag,
  Twitter,
  X,
} from "lucide-react";
import { useCartCount, useCurrency, openCart } from "@/lib/useStore";
import { PromoBar } from "./PromoBar";
import { BrandLogo } from "./BrandLogo";
import { useNavigation, useBranding, useToolbar, type NavItem } from "@/lib/site-config";
import { waDigits } from "@/lib/toolbar";
import { SITE_IMAGES } from "@/lib/site-assets";
import { getShades } from "@/lib/storefront";
import { mapShades } from "@/lib/home-content";
import { bootstrapAuth, getReferral } from "@/lib/auth";
import type { Currency } from "@/lib/storefront";

const SOCIAL_ICON: Record<string, typeof Instagram> = {
  instagram: Instagram,
  facebook: Facebook,
  twitter: Twitter,
  whatsapp: MessageCircle,
};

// Module-scoped referral cache so re-opening the drawer doesn't re-hit the
// network. undefined = not yet checked · null = guest (no code) · string = code.
let referralCodeCache: string | null | undefined;

/**
 * Centred-logo maison header.
 *  - Desktop: grouped nav either side of the logo — Shop ▾ (browse modes),
 *    Services, Maison ▾ (our story / journal) on the left; Contact / Sign in /
 *    Bag on the right. Glass dropdowns, active-link underline.
 *  - Mobile: ☰ (left) · larger centred logo · Bag (right); ☰ opens a
 *    full-screen glass drawer with big serif links (Shop & Maison expand).
 *  - Hides on scroll-down / reappears on scroll-up, and the logo shrinks once
 *    you scroll past the hero. Entrance stagger plays once, after the preloader.
 */

// Grouped default (used until a Studio nav with groups is published).
const NAV_GROUPS: NavItem[] = [
  {
    label: "Shop",
    url: "/shop",
    children: [
      { label: "All catalogue", url: "/shop" },
      { label: "By shade", url: "/shades" },
      { label: "By collection", url: "/collections" },
      { label: "By bundle", url: "/bundles" },
      { label: "Find my shade", url: "/shade-finder" },
    ],
  },
  { label: "Services", url: "/services" },
  {
    label: "Maison",
    url: "/about",
    children: [
      { label: "Our story", url: "/about" },
      { label: "Journal", url: "/journal" },
    ],
  },
];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: -10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] } },
};

function isActive(pathname: string, url: string): boolean {
  if (url === "/") return pathname === "/";
  return pathname === url || pathname.startsWith(`${url}/`);
}

export function SiteHeader() {
  const count = useCartCount();
  const nav = useNavigation();
  const { name } = useBranding();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Prefer a Studio nav only when it actually carries groups; otherwise use the
  // grouped default so the dropdowns render even against the flat seed.
  const studio = nav?.header_items;
  const groups: NavItem[] =
    studio && studio.some((i) => i.children && i.children.length)
      ? studio
      : NAV_GROUPS;

  // Entrance gate — play the stagger after the cinematic preloader (fast on
  // return visits where it's skipped).
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

  // Scroll behaviour: hide on scroll-down / show on scroll-up; shrink past hero.
  const [hidden, setHidden] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const lastY = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 48);
      if (!mobileOpen) {
        if (y < 120) setHidden(false);
        else if (y > lastY.current + 4) setHidden(true);
        else if (y < lastY.current - 4) setHidden(false);
      }
      lastY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [mobileOpen]);

  // Close the drawer whenever the route changes.
  useEffect(() => setMobileOpen(false), [pathname]);

  const logoImg = `h-auto object-contain select-none transition-all duration-300 ${
    scrolled
      ? "w-[120px] md:w-[135px] max-h-10"
      : "w-[150px] md:w-[185px] lg:w-[205px] max-h-14"
  }`;
  const wordmark = `font-display tracking-[0.28em] uppercase text-cream whitespace-nowrap transition-all duration-300 ${
    scrolled ? "text-sm md:text-base" : "text-lg md:text-2xl"
  }`;

  return (
    <>
      <motion.header
        initial={{ y: -30, opacity: 0 }}
        animate={
          !ready
            ? { y: -30, opacity: 0 }
            : hidden
              ? { y: "-110%", opacity: 1 }
              : { y: 0, opacity: 1 }
        }
        transition={{ duration: hidden ? 0.4 : 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="fixed top-0 inset-x-0 z-50"
      >
        <div className="bg-ink/40 backdrop-blur-xl border-b border-taupe/15">
          <PromoBar />
          <div
            className={`mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-10 grid grid-cols-[1fr_auto_1fr] items-center gap-4 transition-[height] duration-300 ${
              scrolled ? "h-16" : "h-20 lg:h-24"
            }`}
          >
            {/* Left — desktop nav / mobile menu button */}
            <div className="justify-self-start">
              <motion.nav
                variants={container}
                initial="hidden"
                animate={ready ? "show" : "hidden"}
                className="hidden md:flex items-center gap-6 lg:gap-8 text-[0.68rem] tracking-[0.28em] uppercase text-cream/85"
              >
                {groups.map((g) => (
                  <motion.div key={g.label} variants={item}>
                    <DesktopNavItem group={g} pathname={pathname} />
                  </motion.div>
                ))}
              </motion.nav>
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
                className="md:hidden -ml-2 grid h-10 w-10 place-items-center text-cream"
              >
                <Menu size={22} strokeWidth={1.5} />
              </button>
            </div>

            {/* Center — logo */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={ready ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="justify-self-center"
            >
              <Link to="/" className="flex items-center shrink-0" aria-label={`${name || "Home"} — home`}>
                <BrandLogo
                  imgClassName={logoImg}
                  fallback={<span className={wordmark}>{name || "Faitlyn Hair"}</span>}
                />
              </Link>
            </motion.div>

            {/* Right — desktop actions / mobile bag */}
            <div className="justify-self-end">
              <motion.nav
                variants={container}
                initial="hidden"
                animate={ready ? "show" : "hidden"}
                className="hidden md:flex gap-6 text-[0.7rem] tracking-[0.32em] uppercase text-cream/85 items-center"
              >
                <motion.div variants={item}>
                  <Link to="/contact" className="hover:text-taupe transition-colors">Contact</Link>
                </motion.div>
                <motion.div variants={item}>
                  <Link to="/auth" className="hover:text-taupe transition-colors">Sign in</Link>
                </motion.div>
                <motion.div variants={item}>
                  <button onClick={openCart} className="text-taupe hover:text-cream transition-colors tracking-[0.28em] uppercase">
                    Bag ({count})
                  </button>
                </motion.div>
              </motion.nav>
              <button
                type="button"
                onClick={openCart}
                aria-label={`Bag, ${count} item${count === 1 ? "" : "s"}`}
                className="md:hidden relative grid h-10 w-10 place-items-center text-cream"
              >
                <ShoppingBag size={20} strokeWidth={1.5} />
                {count > 0 ? (
                  <span className="absolute right-0 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-taupe px-1 text-[0.58rem] font-semibold text-ink">
                    {count}
                  </span>
                ) : null}
              </button>
            </div>
          </div>
        </div>
      </motion.header>

      <MobileDrawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        groups={groups}
        name={name || "Faitlyn Hair"}
        pathname={pathname}
        cartCount={count}
      />
    </>
  );
}

// ── Desktop nav item (link or glass dropdown) ────────────────────────────────

function DesktopNavItem({ group, pathname }: { group: NavItem; pathname: string }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number>(0);
  const ref = useRef<HTMLDivElement>(null);
  const active =
    isActive(pathname, group.url) ||
    !!group.children?.some((c) => isActive(pathname, c.url));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const underline =
    "relative py-2 transition-colors hover:text-taupe after:content-[''] after:absolute after:left-0 after:-bottom-0.5 after:h-px after:bg-taupe after:transition-all after:duration-300";

  if (!group.children?.length) {
    return (
      <Link
        to={group.url}
        className={`${underline} ${active ? "text-cream after:w-full" : "after:w-0 hover:after:w-full"}`}
      >
        {group.label}
      </Link>
    );
  }

  const enter = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  return (
    <div ref={ref} className="relative" onMouseEnter={enter} onMouseLeave={leave}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`${underline} inline-flex items-center gap-1 ${
          active || open ? "text-cream after:w-full" : "after:w-0 hover:after:w-full"
        }`}
      >
        {group.label}
        <ChevronDown
          size={12}
          strokeWidth={2}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 top-full z-10 pt-4"
          >
            <div className="min-w-[220px] overflow-hidden rounded-xl border border-taupe/20 bg-ink/90 backdrop-blur-xl p-2 shadow-2xl">
              {group.children.map((c) => (
                <Link
                  key={c.url}
                  to={c.url}
                  onClick={() => setOpen(false)}
                  className={`block rounded-lg px-4 py-2.5 text-[0.62rem] tracking-[0.24em] uppercase transition-colors ${
                    isActive(pathname, c.url)
                      ? "bg-cream/10 text-cream"
                      : "text-cream/75 hover:bg-cream/10 hover:text-cream"
                  }`}
                >
                  {c.label}
                </Link>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ── Mobile full-screen glass drawer ──────────────────────────────────────────

function MobileDrawer({
  open,
  onClose,
  groups,
  name,
  pathname,
  cartCount,
}: {
  open: boolean;
  onClose: () => void;
  groups: NavItem[];
  name: string;
  pathname: string;
  cartCount: number;
}) {
  const nav = useNavigation();
  const toolbar = useToolbar();
  const [currency, setCurrency] = useCurrency();
  const socialEntries = Object.entries(nav?.socials ?? {}).filter(([, href]) => href);
  const waNumber = waDigits(toolbar.whatsapp.number);
  const conciergeHref = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(toolbar.whatsapp.greeting)}`
    : null;

  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[60] md:hidden"
        >
          <div className="absolute inset-0 bg-ink/95 backdrop-blur-xl" onClick={onClose} />
          <motion.div
            initial={{ y: -14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -14, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex h-full flex-col"
          >
            <div className="flex h-20 items-center justify-between border-b border-taupe/15 px-6">
              <span className="font-display text-base tracking-[0.28em] uppercase text-cream">{name}</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="grid h-10 w-10 -mr-2 place-items-center text-taupe hover:text-cream transition-colors"
              >
                <X size={22} strokeWidth={1.5} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-6 py-7">
              {groups.map((g) =>
                g.children?.length ? (
                  <DrawerAccordion key={g.label} group={g} pathname={pathname} onNavigate={onClose} />
                ) : (
                  <DrawerLink key={g.url} to={g.url} label={g.label} onNavigate={onClose} />
                ),
              )}

              {/* Shop by shade — tappable colour dots instead of a buried text link */}
              <DrawerShades onNavigate={onClose} />

              <div className="my-4 h-px bg-taupe/15" />
              <DrawerLink to="/contact" label="Contact" onNavigate={onClose} small />
              <DrawerLink to="/auth" label="Sign in" onNavigate={onClose} small />

              {/* Bag → checkout — jump straight to purchase when the bag has items */}
              {cartCount > 0 ? (
                <Link
                  to="/checkout"
                  onClick={onClose}
                  className="mt-5 flex items-center justify-between rounded-2xl border border-taupe/25 bg-cream/[0.03] px-5 py-4 transition-colors hover:bg-cream/[0.06]"
                >
                  <span className="flex items-center gap-3">
                    <ShoppingBag size={17} strokeWidth={1.5} className="text-taupe" />
                    <span className="text-[0.66rem] tracking-[0.28em] uppercase text-cream">
                      Bag ({cartCount})
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[0.62rem] tracking-[0.28em] uppercase text-taupe">
                    Checkout
                    <ArrowRight size={13} strokeWidth={1.75} />
                  </span>
                </Link>
              ) : null}

              {/* Refer a friend — the maison's word-of-mouth engine, one tap away */}
              <DrawerReferral onNavigate={onClose} />

              {/* Featured editorial — turns the dead space into a shoppable moment */}
              <Link
                to="/shop"
                onClick={onClose}
                className="group relative mt-5 block overflow-hidden rounded-2xl border border-taupe/15"
              >
                <img
                  src={SITE_IMAGES.editorialAtelier}
                  alt=""
                  loading="lazy"
                  className="h-44 w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/45 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <p className="text-[0.58rem] tracking-[0.42em] uppercase text-taupe">New in</p>
                  <p className="mt-1.5 font-display text-xl leading-tight text-cream">
                    The Maison Collection
                  </p>
                  <span className="mt-2 inline-flex items-center gap-1.5 text-[0.6rem] tracking-[0.3em] uppercase text-cream/85">
                    Shop the drop
                    <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                  </span>
                </div>
              </Link>

              {/* Concierge — a real person, one tap away */}
              {conciergeHref ? (
                <a
                  href={conciergeHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onClose}
                  className="mt-4 flex items-center justify-center gap-2.5 rounded-full border border-taupe/40 py-3.5 text-[0.66rem] tracking-[0.3em] uppercase text-cream transition-colors hover:bg-cream/5"
                >
                  <MessageCircle size={15} strokeWidth={1.5} />
                  Chat with a stylist
                </a>
              ) : (
                <Link
                  to="/contact"
                  onClick={onClose}
                  className="mt-4 flex items-center justify-center gap-2.5 rounded-full border border-taupe/40 py-3.5 text-[0.66rem] tracking-[0.3em] uppercase text-cream transition-colors hover:bg-cream/5"
                >
                  <MessageCircle size={15} strokeWidth={1.5} />
                  Book a consultation
                </Link>
              )}

              {/* Currency toggle · socials · maison signature */}
              <div className="mt-7 flex items-center justify-between">
                <div className="inline-flex overflow-hidden rounded-full border border-taupe/25">
                  {(["NGN", "USD"] as Currency[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCurrency(c)}
                      aria-pressed={currency === c}
                      className={`px-3.5 py-1.5 text-[0.6rem] tracking-[0.24em] uppercase transition-colors ${
                        currency === c ? "bg-taupe/90 text-ink" : "text-taupe hover:text-cream"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
                {socialEntries.length ? (
                  <div className="flex gap-2.5">
                    {socialEntries.map(([key, href]) => {
                      const Icon = SOCIAL_ICON[key] ?? Instagram;
                      return (
                        <a
                          key={key}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={key}
                          className="grid h-9 w-9 place-items-center rounded-full border border-taupe/30 text-taupe transition-colors hover:border-taupe hover:text-cream"
                        >
                          <Icon size={14} />
                        </a>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <p className="mt-5 text-center font-couture italic text-sm text-taupe">
                Est. Lagos · 2021
              </p>
            </nav>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function DrawerLink({
  to,
  label,
  onNavigate,
  small,
}: {
  to: string;
  label: string;
  onNavigate: () => void;
  small?: boolean;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`block font-display text-cream hover:text-taupe transition-colors ${
        small ? "py-2.5 text-base" : "py-2.5 text-2xl"
      }`}
    >
      {label}
    </Link>
  );
}

function DrawerAccordion({
  group,
  pathname,
  onNavigate,
}: {
  group: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(
    () => !!group.children?.some((c) => isActive(pathname, c.url)),
  );
  return (
    <div className="border-b border-taupe/10 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between py-2.5 font-display text-2xl text-cream"
      >
        {group.label}
        <ChevronDown
          size={18}
          strokeWidth={1.5}
          className={`text-taupe transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-3 pl-4">
              {group.children!.map((c) => (
                <Link
                  key={c.url}
                  to={c.url}
                  onClick={onNavigate}
                  className="block py-2 text-[0.7rem] tracking-[0.28em] uppercase text-cream/70 hover:text-cream transition-colors"
                >
                  {c.label}
                </Link>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

// ── Shop by shade — tappable colour dots (a swatch beats a buried text link) ──

function DrawerShades({ onNavigate }: { onNavigate: () => void }) {
  // Live, parametric shades from the catalogue — the same source /shades and the
  // homepage "Shop by shade" pull from. Shares the ["shades"] query cache, so the
  // dots are instant once either has loaded. When the catalogue has no published
  // shades we render nothing rather than fabricating demo swatches that would
  // link to dead slugs.
  const { data } = useQuery({ queryKey: ["shades"], queryFn: () => getShades() });
  const shades = mapShades(data ?? []);
  if (!shades.length) return null;

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-[0.58rem] tracking-[0.4em] uppercase text-taupe">Shop by shade</p>
        <Link
          to="/shades"
          onClick={onNavigate}
          className="text-[0.55rem] tracking-[0.28em] uppercase text-cream/55 hover:text-cream transition-colors"
        >
          View all
        </Link>
      </div>
      <div className="flex flex-wrap gap-3">
        {shades.map((s) => (
          <Link
            key={s.slug}
            to="/shades/$slug"
            params={{ slug: s.slug }}
            onClick={onNavigate}
            aria-label={s.name}
            title={s.name}
            className="h-9 w-9 overflow-hidden rounded-full border border-taupe/25 bg-cover bg-center shadow-sm transition-transform duration-200 hover:scale-110 hover:border-taupe"
            style={
              s.image
                ? { backgroundImage: `url(${s.image})` }
                : { background: s.swatch ?? "var(--taupe)" }
            }
          >
            <span className="sr-only">{s.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Refer a friend — the signed-in customer's code, or a sign-in teaser ──────

function DrawerReferral({ onNavigate }: { onNavigate: () => void }) {
  const [code, setCode] = useState<string | null | undefined>(referralCodeCache);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (referralCodeCache !== undefined) return; // resolved earlier this session
    let active = true;
    (async () => {
      let resolved: string | null = null;
      try {
        const ok = await bootstrapAuth();
        if (ok) {
          const ref = await getReferral();
          resolved = ref.referral_code || null;
        }
      } catch {
        resolved = null; // guest or offline — fall back to the teaser
      }
      referralCodeCache = resolved;
      if (active) setCode(resolved);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Guest (or not yet resolved with no cached code) → invite them to unlock one.
  if (!code) {
    return (
      <Link
        to="/auth"
        onClick={onNavigate}
        className="mt-5 flex items-center gap-3 rounded-2xl border border-taupe/25 px-5 py-4 transition-colors hover:bg-cream/[0.04]"
      >
        <Gift size={18} strokeWidth={1.5} className="shrink-0 text-taupe" />
        <span className="min-w-0">
          <span className="block text-[0.66rem] tracking-[0.26em] uppercase text-cream">
            Refer a friend
          </span>
          <span className="mt-1 block text-[0.62rem] leading-snug text-cream/55">
            Sign in for your code — you both get rewarded.
          </span>
        </span>
        <ArrowRight size={15} strokeWidth={1.5} className="ml-auto shrink-0 text-taupe" />
      </Link>
    );
  }

  const shareText = `Shop Faitlyn Hair with my code ${code} — we both get rewarded. https://faitlynhair.com`;
  const share = async () => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Faitlyn Hair", text: shareText });
        return;
      } catch {
        /* cancelled or unsupported — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className="mt-5 rounded-2xl border border-taupe/25 bg-cream/[0.03] p-5">
      <div className="flex items-center gap-2.5">
        <Gift size={16} strokeWidth={1.5} className="text-taupe" />
        <p className="text-[0.62rem] tracking-[0.3em] uppercase text-cream">Refer a friend</p>
      </div>
      <p className="mt-2 text-[0.66rem] leading-relaxed text-cream/55">
        Share your code — you both get rewarded when they shop.
      </p>
      <div className="mt-3 flex items-center gap-2.5">
        <code className="flex-1 truncate rounded-lg border border-taupe/20 bg-ink/40 px-3.5 py-2.5 text-center font-mono text-sm tracking-[0.18em] text-cream">
          {code}
        </code>
        <button
          type="button"
          onClick={share}
          aria-label={copied ? "Copied referral code" : "Share referral code"}
          className="inline-flex items-center gap-1.5 rounded-lg border border-taupe/40 px-4 py-2.5 text-[0.6rem] tracking-[0.26em] uppercase text-cream transition-colors hover:bg-cream/5"
        >
          {copied ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.75} />}
          {copied ? "Copied" : "Share"}
        </button>
      </div>
    </div>
  );
}
