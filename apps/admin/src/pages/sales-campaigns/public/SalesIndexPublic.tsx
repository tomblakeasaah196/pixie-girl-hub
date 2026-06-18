/**
 * SalesIndexPublic — the sales subdomain root (/sale, no slug).
 *
 * This is what a stranger sees at sales.pixiegirlglobal.com:
 *   • a live drop is headlined and they're invited straight in;
 *   • between drops, an editorial "join the list" experience (never a cold
 *     "no sale" message);
 *   • the archive of past drops is VIP-GATED — blurred until they join the
 *     list, then revealed as the reward for signing up.
 *
 * Capture reuses the public newsletter endpoint (email + WhatsApp → CRM
 * contact). Four CTAs: join the list · shop the store · VIP/ambassador · IG.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowRight, Check, Instagram, Loader2, Lock, ShoppingBag, Sparkles } from "lucide-react";
import {
  type SalesIndexCampaign,
  subscribeSalesList,
  usePublicSalesIndex,
} from "@/lib/campaigns";
import { placeholderBg } from "../landing/LandingRender";

// Brand-facing constants. Confirm/extend per brand — these are the public
// destinations for the storefront + social CTAs.
const BRAND_NAME: Record<string, string> = {
  pixiegirl: "Pixie Girl",
  faitlynhair: "Faitlyn",
};
const STORE_URL: Record<string, string> = {
  pixiegirl: "https://pixiegirlglobal.com",
};
const IG_URL: Record<string, string> = {
  pixiegirl: "https://instagram.com/pixiegirlglobal",
};

function useCountdown(target?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  const ms = Math.max(0, new Date(target).getTime() - now);
  return {
    days: Math.floor(ms / 86_400_000),
    hours: Math.floor((ms % 86_400_000) / 3_600_000),
    mins: Math.floor((ms % 3_600_000) / 60_000),
    secs: Math.floor((ms % 60_000) / 1000),
  };
}

function CountdownRow({ to }: { to: string }) {
  const cd = useCountdown(to);
  if (!cd) return null;
  const units = [
    { v: cd.days, l: "Days" },
    { v: cd.hours, l: "Hrs" },
    { v: cd.mins, l: "Min" },
    { v: cd.secs, l: "Sec" },
  ];
  return (
    <div className="flex items-center gap-3">
      {units.map((u) => (
        <div key={u.l} className="min-w-[58px] md:min-w-[68px] rounded-[14px] bg-black/35 backdrop-blur-md border border-white/15 px-3 py-2.5 text-center">
          <div className="font-mono text-[22px] md:text-[28px] tabular-nums text-white leading-none">{String(u.v).padStart(2, "0")}</div>
          <div className="text-[9px] tracking-[0.22em] uppercase text-white/55 mt-1.5">{u.l}</div>
        </div>
      ))}
    </div>
  );
}

export function SalesIndexPublic() {
  const [params] = useSearchParams();
  const brand = params.get("brand") || undefined;
  const q = usePublicSalesIndex(brand);
  const data = q.data;

  const brandKey = data?.brand || brand || "";
  const brandName = BRAND_NAME[brandKey] || "The House";
  const storeUrl = STORE_URL[brandKey];
  const igUrl = IG_URL[brandKey];

  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => {
    if (brandKey && localStorage.getItem(`pgh-sale-list:${brandKey}`)) setSubscribed(true);
  }, [brandKey]);

  const upcomingNext = data?.upcoming?.[0];
  const heroImage = data?.active?.hero_image_url || upcomingNext?.hero_image_url || null;

  function onJoined() {
    setSubscribed(true);
    if (brandKey) localStorage.setItem(`pgh-sale-list:${brandKey}`, "1");
  }

  if (q.isLoading) {
    return (
      <div className="min-h-screen bg-bg grid place-items-center text-text-muted">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-bg text-text-primary antialiased min-h-screen">
      {/* Slim top bar */}
      <div className="flex items-center justify-between px-6 md:px-12 py-5">
        <div className="font-display text-[20px] tracking-tight">{brandName}</div>
        <div className="flex items-center gap-5 text-[12.5px] text-text-muted">
          {storeUrl && (
            <a href={storeUrl} className="hover:text-text-primary transition-colors">Shop</a>
          )}
          {igUrl && (
            <a href={igUrl} className="hover:text-text-primary transition-colors">Instagram</a>
          )}
          <a href="#join" className="text-accent-glow font-semibold">Join the list</a>
        </div>
      </div>

      {/* HERO */}
      <header className="relative min-h-[72vh] flex items-center overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: heroImage
              ? `linear-gradient(180deg, rgb(0 0 0/0.25), rgb(var(--bg)/0.95) 100%), url("${heroImage}")`
              : placeholderBg(brandKey || "index"),
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="relative w-full px-6 md:px-12">
          <div className="max-w-[1140px] mx-auto">
            {data?.active ? (
              <div className="max-w-[680px]">
                <div className="inline-flex items-center gap-2 text-[11px] tracking-[0.32em] uppercase text-[#F4E9D9]/90 mb-5 px-3 py-1.5 rounded-full border border-[#F4E9D9]/25 backdrop-blur-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-glow animate-pulse" /> The sale is live
                </div>
                <h1 className="font-display text-[clamp(40px,7vw,82px)] leading-[0.98] text-white">{data.active.name}</h1>
                {data.active.hero_subtitle && (
                  <p className="mt-5 text-[15px] md:text-[18px] text-white/85 max-w-[540px]">{data.active.hero_subtitle}</p>
                )}
                <div className="mt-8"><CountdownRow to={data.active.ends_at} /></div>
                <a
                  href={`/sale/${data.active.slug}${brand ? `?brand=${brand}` : ""}`}
                  className="mt-9 inline-flex items-center gap-2 h-[54px] px-9 rounded-full bg-accent text-[#F4E9D9] font-semibold text-[15px] shadow-[0_12px_40px_rgb(var(--accent)/0.45)] hover:brightness-110 transition"
                >
                  Enter the sale <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            ) : (
              <div className="max-w-[720px]">
                <div className="text-[11px] tracking-[0.34em] uppercase text-[#F4E9D9]/80 mb-5">Between drops</div>
                <h1 className="font-display text-[clamp(40px,7.5vw,88px)] leading-[0.98] text-white">
                  The next chapter is <span className="italic text-accent-glow">being prepared.</span>
                </h1>
                <p className="mt-5 text-[15px] md:text-[18px] text-white/85 max-w-[560px]">
                  Our drops are limited, intentional, and gone quickly. Join the list to be first through
                  the door — with private prices and the occasional gift.
                </p>
                {upcomingNext && (
                  <div className="mt-8">
                    <div className="text-[11px] tracking-[0.25em] uppercase text-white/55 mb-3">
                      Next drop · {upcomingNext.name}
                    </div>
                    <CountdownRow to={upcomingNext.starts_at} />
                  </div>
                )}
                <a
                  href="#join"
                  className="mt-9 inline-flex items-center gap-2 h-[54px] px-9 rounded-full bg-accent text-[#F4E9D9] font-semibold text-[15px] shadow-[0_12px_40px_rgb(var(--accent)/0.45)] hover:brightness-110 transition"
                >
                  Join the list <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* JOIN THE LIST */}
      <section id="join" className="px-6 md:px-12 py-16 md:py-24">
        <div className="max-w-[640px] mx-auto text-center">
          <div className="text-[11px] tracking-[0.3em] uppercase text-accent-glow/90 font-semibold mb-3">The list</div>
          <h2 className="font-display text-[30px] md:text-[44px] leading-[1.05]">Be first, always</h2>
          <p className="text-text-muted mt-4 leading-relaxed">
            Early access before every public launch, private prices, and first pick while it lasts. We
            send rarely — only when it matters.
          </p>
          <JoinForm brand={brand} joined={subscribed} onJoined={onJoined} />
        </div>
      </section>

      {/* VIP-GATED ARCHIVE */}
      {(data?.past?.length ?? 0) > 0 && (
        <section className="px-6 md:px-12 pb-20">
          <div className="max-w-[1140px] mx-auto">
            <div className="flex items-end justify-between gap-4 mb-8">
              <div>
                <div className="text-[11px] tracking-[0.3em] uppercase text-accent-glow/90 font-semibold mb-2">The archive</div>
                <h2 className="font-display text-[26px] md:text-[36px] leading-tight">Past drops</h2>
              </div>
              {!subscribed && (
                <a href="#join" className="hidden md:inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent-glow">
                  <Lock className="w-3.5 h-3.5" /> Join to unlock
                </a>
              )}
            </div>

            <div className="relative">
              <div className={`grid grid-cols-2 lg:grid-cols-3 gap-4 ${subscribed ? "" : "blur-[6px] pointer-events-none select-none"}`}>
                {(data?.past || []).map((c) => (
                  <ArchiveCard key={c.slug} c={c} brand={brand} locked={!subscribed} />
                ))}
              </div>
              {!subscribed && (
                <div className="absolute inset-0 grid place-items-center">
                  <a
                    href="#join"
                    className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full bg-bg/80 backdrop-blur border border-accent/40 text-[13.5px] font-semibold text-text-primary shadow-xl"
                  >
                    <Lock className="w-4 h-4 text-accent-glow" /> Join the list to unlock past drops
                  </a>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* FOUR CTAS */}
      <section className="px-6 md:px-12 pb-20">
        <div className="max-w-[1140px] mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <CtaCard icon={<Sparkles className="w-5 h-5" />} title="Join the list" sub="Early access + VIP perks" href="#join" />
          <CtaCard
            icon={<ShoppingBag className="w-5 h-5" />}
            title="Shop the store"
            sub="The permanent collection"
            href={data?.active ? `/sale/${data.active.slug}${brand ? `?brand=${brand}` : ""}` : storeUrl || "#join"}
          />
          <CtaCard icon={<Check className="w-5 h-5" />} title="Apply for VIP" sub="Our inner circle + ambassadors" href="#join" />
          <CtaCard icon={<Instagram className="w-5 h-5" />} title="Follow along" sub="Behind every drop" href={igUrl || "#"} />
        </div>
      </section>

      <footer className="border-t border-line/60 px-6 md:px-12 py-10">
        <div className="max-w-[1140px] mx-auto flex flex-col md:flex-row gap-4 md:items-center justify-between text-[12px] text-text-faint">
          <div className="font-display text-[18px] text-text-primary">{brandName}</div>
          <div>© {new Date().getFullYear()} {brandName}. By invitation.</div>
        </div>
      </footer>
    </div>
  );
}

function ArchiveCard({ c, brand, locked }: { c: SalesIndexCampaign; brand?: string; locked: boolean }) {
  const ended = new Date(c.ends_at);
  const inner = (
    <div className="group rounded-[18px] overflow-hidden border border-line/70 bg-panel/40">
      <div
        className="h-44 relative"
        style={{
          backgroundImage: c.hero_image_url ? `url("${c.hero_image_url}")` : undefined,
          background: c.hero_image_url ? undefined : placeholderBg(c.slug),
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute top-3 left-3 text-[10px] tracking-[0.2em] uppercase bg-black/55 text-white px-2.5 py-1 rounded-full">
          Sold out
        </div>
      </div>
      <div className="p-4">
        <div className="font-display text-[18px] truncate">{c.name}</div>
        <div className="text-text-faint text-[12px] mt-1">{ended.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
      </div>
    </div>
  );
  if (locked) return inner;
  return (
    <a href={`/sale/${c.slug}${brand ? `?brand=${brand}` : ""}`} className="block hover:-translate-y-0.5 transition-transform">
      {inner}
    </a>
  );
}

function CtaCard({ icon, title, sub, href }: { icon: React.ReactNode; title: string; sub: string; href: string }) {
  return (
    <a
      href={href}
      className="group rounded-[18px] border border-line/70 p-5 hover:border-accent/45 hover:bg-accent/[0.04] transition-colors"
    >
      <div className="w-10 h-10 rounded-[12px] bg-accent/[0.12] text-accent-glow grid place-items-center mb-4">{icon}</div>
      <div className="font-display text-[18px]">{title}</div>
      <div className="text-text-muted text-[12.5px] mt-1">{sub}</div>
      <div className="mt-3 text-accent-glow text-[12.5px] font-semibold inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        Go <ArrowRight className="w-3.5 h-3.5" />
      </div>
    </a>
  );
}

function JoinForm({ brand, joined, onJoined }: { brand?: string; joined: boolean; onJoined: () => void }) {
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || phone.replace(/\D/g, "").length < 7) {
      setError("Please enter your email and a WhatsApp number.");
      return;
    }
    setBusy(true);
    try {
      await subscribeSalesList({ email, phone, first_name: firstName || undefined }, brand);
      onJoined();
    } catch (err) {
      setError((err as Error)?.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (joined) {
    return (
      <div className="mt-8 rounded-[18px] border border-success/40 bg-success/[0.08] px-6 py-7">
        <div className="inline-flex items-center gap-2 text-success font-semibold">
          <Check className="w-5 h-5" /> You're on the list
        </div>
        <p className="text-text-muted text-[13.5px] mt-2">
          Watch your inbox and WhatsApp — you'll hear from us before anyone else. The archive below is
          now unlocked.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 text-left">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First name (optional)"
          className="h-[52px] px-5 rounded-[14px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/60 text-[14px]"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="you@email.com"
          className="h-[52px] px-5 rounded-[14px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/60 text-[14px]"
        />
      </div>
      <input
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="WhatsApp number (e.g. +234…)"
        className="mt-3 w-full h-[52px] px-5 rounded-[14px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/60 text-[14px]"
      />
      {error && <p className="text-danger text-[12.5px] mt-3">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="mt-4 w-full h-[54px] rounded-full bg-accent text-[#F4E9D9] font-semibold text-[15px] hover:brightness-110 transition inline-flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-4 h-4" />}
        {busy ? "Joining…" : "Join the list"}
      </button>
      <p className="text-text-faint text-[11.5px] mt-3 text-center">
        Early access, private prices and the occasional gift. No noise — leave anytime.
      </p>
    </form>
  );
}
