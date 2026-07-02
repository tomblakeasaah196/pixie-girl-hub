import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BadgeCheck,
  Compass,
  FileSignature,
  Globe2,
  QrCode,
  Star,
  Wallet,
} from "lucide-react";

/**
 * Public landing (§6.26 section A). Positioning per spec: an elite,
 * prestigious network — never a school — so it attracts strong stylists.
 * Referenced from the main website; applications open the wizard.
 */
export const Route = createFileRoute("/")({
  component: Landing,
});

const STEPS = [
  {
    icon: FileSignature,
    title: "Apply with your work",
    body: "Portfolio, Instagram or YouTube, and a short brand-alignment questionnaire. Every application is reviewed by a human — never an algorithm.",
  },
  {
    icon: BadgeCheck,
    title: "Get vetted & certified",
    body: "ID and portfolio verification, a scored review, then certification. Your partner agreement is e-signed online and your badge issues the moment you sign.",
  },
  {
    icon: Compass,
    title: "Receive routed clients",
    body: "Pixie routes nearby customers to you — weighted by tier, verified rating and availability. First to accept wins the job.",
  },
  {
    icon: Wallet,
    title: "Get paid by Pixie",
    body: "Customers pay Pixie; Pixie pays you — service fees and referral commission on wig sales through your personal link, settled together.",
  },
];

const TIERS = [
  {
    key: "Certified",
    blurb: "The mark of a vetted Pixie partner — verified skill, verified identity, live badge.",
  },
  {
    key: "Pro",
    blurb: "Consistent verified reviews and routed volume. Priority in routing and a higher payout multiplier.",
  },
  {
    key: "Elite",
    blurb: "The reference tier. Top routing weight, top multiplier, and first call on flagship work.",
  },
];

function Landing() {
  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pt-20 pb-16 text-center">
        <p className="micro rise mb-5">
          Pixie Girl Global · Stylist Partner Programme
        </p>
        <h1
          className="font-display rise text-[42px] sm:text-[64px] leading-[1.05] max-w-3xl mx-auto"
          style={{ animationDelay: "80ms" }}
        >
          The global reference for{" "}
          <em className="text-accent-glow not-italic font-display italic">
            Pixie hair
          </em>{" "}
          styling.
        </h1>
        <p
          className="rise text-cream-muted text-[15px] max-w-xl mx-auto mt-6 leading-relaxed"
          style={{ animationDelay: "160ms" }}
        >
          A vetted, certified network of stylists worldwide — with verifiable
          badges, routed clients and payments handled by Pixie. Elite by
          design. Never a school.
        </p>
        <div
          className="rise flex flex-wrap justify-center gap-3 mt-9"
          style={{ animationDelay: "240ms" }}
        >
          <Link to="/apply" className="btn-primary no-underline">
            Apply to partner
          </Link>
          <Link to="/stylists" className="btn-ghost no-underline">
            Find a certified stylist
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="micro text-center mb-8">How the programme works</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              className="glass rounded-xl2 p-6 rise"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent-deep/40 text-accent-glow mb-4">
                <s.icon className="w-5 h-5" />
              </span>
              <h3 className="font-display text-[18px] mb-2">{s.title}</h3>
              <p className="text-[13px] text-cream-muted leading-relaxed">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Tiers */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="micro text-center mb-2">Tiered certification</h2>
        <p className="text-center font-display text-[26px] mb-8">
          Certified → Pro → Elite
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          {TIERS.map((t, i) => (
            <div
              key={t.key}
              className="glass rounded-xl2 p-6 text-center rise"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <Star className="w-5 h-5 mx-auto text-accent-glow mb-3" />
              <h3 className="font-display text-[20px] mb-2">{t.key}</h3>
              <p className="text-[13px] text-cream-muted leading-relaxed">
                {t.blurb}
              </p>
            </div>
          ))}
        </div>
        <p className="text-center text-[12px] text-cream-faint mt-6">
          Tiers are time-bound and re-validated — status reflects live on every
          badge.
        </p>
      </section>

      {/* Badge */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="glass rounded-xl2 p-8 sm:p-12 grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <h2 className="micro mb-3">The verifiable badge</h2>
            <p className="font-display text-[30px] leading-tight mb-4">
              A badge that cannot be faked.
            </p>
            <p className="text-[14px] text-cream-muted leading-relaxed mb-6">
              Every partner carries a unique QR badge that resolves to a live
              verification page — tier, status and expiry straight from the
              programme, updated the instant anything changes. Suspended or
              lapsed partners show it immediately. Customers scan; the truth
              answers.
            </p>
            <div className="flex gap-4 text-[12.5px] text-cream-muted">
              <span className="inline-flex items-center gap-1.5">
                <QrCode className="w-4 h-4 text-accent-glow" /> Live QR verify
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Star className="w-4 h-4 text-accent-glow" /> Verified reviews only
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Globe2 className="w-4 h-4 text-accent-glow" /> Worldwide
              </span>
            </div>
          </div>
          <div className="mx-auto w-[250px] rounded-[18px] p-6 border border-accent/40 bg-gradient-to-br from-panel to-panel-2 text-center">
            <p className="micro mb-4">Pixie Girl Global</p>
            <span className="inline-block px-3 py-1 rounded-full border border-accent text-[10px] font-bold tracking-[0.18em] uppercase mb-3">
              Certified Partner
            </span>
            <p className="font-display text-[20px] mb-1">Your name here</p>
            <p className="font-mono text-[11px] text-cream-faint mb-4">PXS-XXXX</p>
            <div className="mx-auto w-28 h-28 rounded-xl bg-cream grid place-items-center">
              <QrCode className="w-16 h-16 text-ink" />
            </div>
            <p className="text-[10px] text-cream-faint mt-3">
              Scan to verify · status live
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-5 py-16 text-center">
        <p className="font-display text-[32px] leading-tight mb-4">
          Strong hands. Verified craft.{" "}
          <span className="text-accent-glow">Routed clients.</span>
        </p>
        <p className="text-[14px] text-cream-muted mb-8">
          Faitlyn is the first certified servicer of Pixie hair in Nigeria —
          the network extends that same standard worldwide. If your work
          belongs at that level, apply.
        </p>
        <Link to="/apply" className="btn-primary no-underline">
          Start your application
        </Link>
      </section>
    </div>
  );
}
