import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Moon, Quote, Sun } from "lucide-react";
import { useBranding, useLoginConfig } from "@/lib/branding";
import { getGeoWelcome } from "@/lib/auth-api";
import { loginIcon } from "@/lib/login-icons";
import { useUiStore } from "@/stores/ui";
import { useAuthStore } from "@/stores/auth";
import { Particles } from "@/components/login/Particles";
import { AuthModal } from "@/components/login/AuthModal";
import { BootSplash } from "@/components/auth/BootSplash";

/**
 * The logged-out command-center door (canon §3). A living brand hero —
 * dynamic greeting from the visitor's region, rotating house quotes, the
 * Pixie Standard, and the active businesses pulled from the DB — fronted by
 * one animated "Access Hub" CTA that opens the glass sign-in modal.
 *
 * Every word, quote, toggle and business here is DB-driven
 * (platform_settings.login_config + business_config); the in-code fallback
 * only covers a cold, API-unreachable load.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const { data: branding } = useBranding();
  const cfg = useLoginConfig();
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  // A returning visitor with a live refresh cookie shouldn't see the door.
  const status = useAuthStore((s) => s.status);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  useEffect(() => {
    if (status === "authed") navigate("/", { replace: true });
  }, [status, navigate]);

  const platform = branding?.platform;
  const productName = platform?.product_name ?? "Pixie Girl Hub";
  const businesses = useMemo(
    () => (branding?.businesses ?? []).filter(Boolean),
    [branding],
  );
  const t = cfg.toggles ?? {};

  // Splash on first paint (DB-toggleable).
  const [splash, setSplash] = useState(t.splash !== false);
  useEffect(() => {
    if (!splash) return;
    const id = setTimeout(() => setSplash(false), 1500);
    return () => clearTimeout(id);
  }, [splash]);

  const [modalOpen, setModalOpen] = useState(false);

  // Region welcome (server-side IP lookup → DB region copy + fallback).
  const geo = useQuery({
    queryKey: ["geo-welcome"],
    queryFn: getGeoWelcome,
    enabled: t.geo_welcome !== false,
    staleTime: 10 * 60_000,
    retry: false,
  });

  // Rotating house quotes.
  const quotes = cfg.quotes ?? [];
  const [qi, setQi] = useState(0);
  useEffect(() => {
    if (t.quotes === false || quotes.length < 2) return;
    const id = setInterval(() => setQi((i) => (i + 1) % quotes.length), 7000);
    return () => clearInterval(id);
  }, [t.quotes, quotes.length]);

  // Product wordmark: accent the final word ("Pixie Girl Hub" → Hub).
  const words = productName.split(" ");
  const tail = words.length > 1 ? words.pop()! : "";
  const head = words.join(" ");

  const hero = cfg.hero ?? {};
  const geoMsg = geo.data;

  if (splash) return <BootSplash />;

  return (
    <div className="auth-scroll fixed inset-0 z-0">
      {/* Ambient particles over the global mesh background. */}
      {t.particles !== false && (
        <div className="fixed inset-0 pointer-events-none">
          <Particles />
        </div>
      )}

      {/* Top bar: wordmark + theme toggle. */}
      <header className="relative z-10 flex items-center justify-between px-5 sm:px-10 py-5">
        <div className="flex items-center gap-3">
          {platform?.logo_dark_url ? (
            <img
              src={platform.logo_dark_url}
              alt={productName}
              className="h-9 w-auto object-contain"
            />
          ) : (
            <span className="grid place-items-center w-10 h-10 rounded-xl font-display font-semibold text-[#F4E9D9] bg-[linear-gradient(140deg,var(--biz-1),var(--biz-2))]">
              {productName.charAt(0)}
            </span>
          )}
          <span className="font-display text-[15px] tracking-wide hidden sm:block">
            {head}
            {tail && <span className="text-accent-glow"> {tail}</span>}
          </span>
        </div>
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="grid place-items-center w-10 h-10 rounded-xl glass text-text-muted hover:text-text-primary transition-all"
        >
          {theme === "dark" ? (
            <Sun className="w-[18px] h-[18px]" />
          ) : (
            <Moon className="w-[18px] h-[18px]" />
          )}
        </button>
      </header>

      {/* Hero. */}
      <main className="relative z-10 max-w-[980px] mx-auto px-5 sm:px-8 pt-6 pb-16 text-center">
        {t.geo_welcome !== false && geoMsg && (
          <div className="animate-rise-in inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass text-[12px] text-text-muted mb-7">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            {geoMsg.location?.city
              ? `${geoMsg.welcome} — ${geoMsg.location.city}${geoMsg.location.country ? `, ${geoMsg.location.country}` : ""}`
              : geoMsg.welcome}
          </div>
        )}

        {hero.eyebrow && (
          <div
            className="micro mb-4 animate-rise-in"
            style={{ animationDelay: "60ms" }}
          >
            {hero.eyebrow}
          </div>
        )}

        <h1
          className="font-display font-light text-[40px] sm:text-[62px] leading-[1.05] tracking-tight animate-rise-in"
          style={{ animationDelay: "120ms" }}
        >
          {hero.headline ? (
            hero.headline
          ) : (
            <>
              {head}
              {tail && <span className="text-accent-glow"> {tail}</span>}
            </>
          )}
        </h1>

        {(hero.subline || geoMsg?.note) && (
          <p
            className="text-text-muted text-[15px] sm:text-[16.5px] max-w-[620px] mx-auto mt-5 animate-rise-in"
            style={{ animationDelay: "180ms" }}
          >
            {hero.subline}
            {geoMsg?.note && (
              <span className="block mt-2 text-text-faint text-[13.5px] italic">
                {geoMsg.note}
              </span>
            )}
          </p>
        )}

        {/* Business badges (DB-driven). */}
        {t.business_badges !== false && businesses.length > 0 && (
          <div
            className="flex flex-wrap items-center justify-center gap-3 mt-8 animate-rise-in"
            style={{ animationDelay: "240ms" }}
          >
            {businesses.map((b) => {
              const accent = b.accent_colour || "#690909";
              return (
                <span
                  key={b.business_key}
                  className="inline-flex items-center gap-2 pl-2 pr-4 py-1.5 rounded-full border text-[12px] font-semibold uppercase tracking-wide"
                  style={{
                    color: accent,
                    borderColor: `${accent}55`,
                    backgroundColor: `${accent}14`,
                  }}
                >
                  {b.logo_path ? (
                    <img
                      src={b.logo_path}
                      alt=""
                      className="w-5 h-5 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: accent }}
                    />
                  )}
                  {b.display_name}
                </span>
              );
            })}
          </div>
        )}

        {/* The animated Access Hub CTA. */}
        <div
          className="mt-10 animate-rise-in"
          style={{ animationDelay: "300ms" }}
        >
          <button
            onClick={() => setModalOpen(true)}
            className="group cta-breathe relative inline-flex items-center gap-3 pl-8 pr-3 py-3.5 rounded-full bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-[0.18em] uppercase hover:bg-accent transition-colors overflow-hidden"
          >
            <span>{hero.cta_label || "Access Hub"}</span>
            <span className="grid place-items-center w-9 h-9 rounded-full bg-[#F4E9D9] text-accent-deep transition-transform group-hover:translate-x-0.5">
              <ArrowRight className="w-4 h-4" />
            </span>
            <span className="cta-sheen" />
          </button>
        </div>

        {/* Rotating house quote. */}
        {t.quotes !== false && quotes.length > 0 && (
          <div
            className="mt-14 max-w-[620px] mx-auto animate-rise-in"
            style={{ animationDelay: "360ms" }}
          >
            <div
              key={qi}
              className="animate-fade-in relative px-7 py-6 rounded-2xl glass text-left"
            >
              <Quote className="w-5 h-5 text-accent/50 mb-2" />
              <p className="font-display text-[19px] leading-snug text-text-primary">
                {quotes[qi].text}
              </p>
              {quotes[qi].author && (
                <p className="micro mt-3">{quotes[qi].author}</p>
              )}
            </div>
          </div>
        )}

        {/* The Pixie Standard (DB-driven). */}
        {t.standards !== false && (cfg.standards?.length ?? 0) > 0 && (
          <div className="mt-14">
            <div className="micro mb-6">The {productName.split(" ")[0]} Standard</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {cfg.standards!.map((s, i) => {
                const Icon = loginIcon(s.icon);
                return (
                  <div
                    key={i}
                    className="glass rounded-2xl p-5 text-left animate-rise-in"
                    style={{ animationDelay: `${400 + i * 70}ms` }}
                  >
                    <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20 mb-3">
                      <Icon className="w-5 h-5" />
                    </span>
                    <div className="font-display text-[16px]">{s.title}</div>
                    <p className="text-text-muted text-[13px] mt-1.5 leading-relaxed">
                      {s.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Website links — only the brands whose `website` column is filled. */}
        {t.website_links !== false &&
          businesses.some((b) => b.website) && (
            <div className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12.5px]">
              <span className="text-text-faint">Explore our houses:</span>
              {businesses
                .filter((b) => b.website)
                .map((b) => (
                  <a
                    key={b.business_key}
                    href={b.website!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-semibold text-text-muted hover:text-accent-glow transition-colors"
                  >
                    {b.display_name}
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ))}
            </div>
          )}

        <footer className="mt-16 text-[11px] text-text-faint">
          © {new Date().getFullYear()} {platform?.company_name ?? productName}.
          All rights reserved.
        </footer>
      </main>

      <AuthModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        toggles={t}
        productName={productName}
      />
    </div>
  );
}
