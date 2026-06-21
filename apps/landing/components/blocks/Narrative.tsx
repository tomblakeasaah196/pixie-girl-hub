"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Heart, Quote, Scissors, Star, Truck } from "lucide-react";
import type { LandingPayload } from "@/lib/types";
import { SectionHeader } from "./BundleShowcase";

// Story copy seeds. The campaign can override per-block via block.props,
// otherwise the brand voice profile drives the default editorial copy.

function blockProps(
  payload: LandingPayload,
  key: string,
): Record<string, unknown> {
  const b = (payload.blocks || []).find((x) => x.key === key);
  return (b?.props as Record<string, unknown>) || {};
}

/* ── Brand Story ──────────────────────────────────────────────── */
export function BrandStory({ payload }: { payload: LandingPayload }) {
  const props = blockProps(payload, "brand_story");
  const title = (props.title as string) || "A house that gets it.";
  const body =
    (props.body as string) ||
    `For the girl who walks into the room and changes the temperature. ${
      payload.brand?.display_name || "We"
    } is for that girl — hair that doesn't reach for attention because it already has the room.`;
  return (
    <section className="section">
      <div className="mx-auto max-w-[820px] text-center">
        <SectionHeader eyebrow="Our story" title={title} />
        <p className="mt-6 text-[rgb(var(--text-muted))] leading-relaxed text-[17px]">
          {body}
        </p>
      </div>
    </section>
  );
}

/* ── Founder Quote ──────────────────────────────────────────── */
export function FounderQuote({ payload }: { payload: LandingPayload }) {
  const props = blockProps(payload, "founder_quote");
  const quote =
    (props.quote as string) ||
    "I built this because nothing on shelves felt like me. Every bundle in this drop is one I'd wear myself.";
  const author = (props.author as string) || "Faith — founder";
  return (
    <section className="section-tight">
      <div className="mx-auto max-w-[760px] glass rounded-[var(--radius)] p-8 md:p-10 text-center relative">
        <Quote className="absolute top-5 left-6 w-7 h-7 text-[rgb(var(--accent-glow)/0.6)]" />
        <p className="font-display text-[clamp(22px,3vw,30px)] leading-[1.35]">
          &ldquo;{quote}&rdquo;
        </p>
        <div className="micro mt-6">— {author}</div>
      </div>
    </section>
  );
}

/* ── Why Buy ────────────────────────────────────────────────── */
export function WhyBuy({ payload }: { payload: LandingPayload }) {
  const props = blockProps(payload, "why_buy");
  const items = (props.items as {
    icon?: string;
    title: string;
    body: string;
  }[]) || [
    {
      title: "Real human hair, every strand",
      body: "Sourced and inspected by us — never substituted.",
    },
    {
      title: "Stylist-tested fit",
      body: "Cap construction tested on hundreds of head shapes.",
    },
    {
      title: "Wear-it-forever care",
      body: "Detailed care guide in every box; replace nothing.",
    },
  ];
  return (
    <section className="section">
      <div className="mx-auto max-w-[1080px]">
        <SectionHeader title="Why this drop matters." />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-10">
          {items.map((it, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className="glass rounded-[var(--radius)] p-6"
            >
              <span className="grid place-items-center w-10 h-10 rounded-xl bg-[rgb(var(--gold)/0.12)] text-[rgb(var(--gold))] mb-4">
                <Heart className="w-5 h-5" />
              </span>
              <h3 className="font-display text-[20px] leading-tight mb-2">
                {it.title}
              </h3>
              <p className="text-[rgb(var(--text-muted))] text-[14px] leading-relaxed">
                {it.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Testimonials ───────────────────────────────────────────── */
export function Testimonials({ payload }: { payload: LandingPayload }) {
  const props = blockProps(payload, "testimonials");
  const items =
    (props.items as { quote: string; name?: string; handle?: string }[]) || [];
  if (!items.length) return null;
  return (
    <section className="section">
      <div className="mx-auto max-w-[1080px]">
        <SectionHeader
          eyebrow="What they said"
          title="Real customers. Real words."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-10">
          {items.slice(0, 6).map((t, i) => (
            <div key={i} className="glass rounded-[var(--radius)] p-6">
              <div className="flex gap-1 mb-3">
                {[0, 1, 2, 3, 4].map((s) => (
                  <Star
                    key={s}
                    className="w-3.5 h-3.5 fill-[rgb(var(--gold))] text-[rgb(var(--gold))]"
                  />
                ))}
              </div>
              <p className="text-[rgb(var(--text-muted))] leading-relaxed">
                &ldquo;{t.quote}&rdquo;
              </p>
              {(t.name || t.handle) && (
                <div className="micro mt-4">
                  {t.name} {t.handle ? `· @${t.handle}` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ────────────────────────────────────────────────────── */
export function Faq({ payload }: { payload: LandingPayload }) {
  const props = blockProps(payload, "faq");
  const items = (props.items as { q: string; a: string }[]) || [
    {
      q: "When does the sale end?",
      a: "When the timer hits zero — that is the only rule.",
    },
    {
      q: "Do you ship internationally?",
      a: "Yes. We use DHL for international delivery.",
    },
    {
      q: "What if I order the wrong colour?",
      a: "Reach out within 48 hours of delivery and we'll work it out.",
    },
    {
      q: "Are these real human hair?",
      a: "Yes. Every strand. We inspect each unit before shipping.",
    },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="section">
      <div className="mx-auto max-w-[760px]">
        <SectionHeader eyebrow="Honest answers" title="Questions, answered." />
        <div className="mt-8 space-y-2">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className="glass rounded-[var(--radius)] overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between text-left px-5 py-4"
                >
                  <span className="font-display text-[17px]">{it.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180 text-[rgb(var(--gold))]" : ""}`}
                  />
                </button>
                <motion.div
                  initial={false}
                  animate={{
                    height: isOpen ? "auto" : 0,
                    opacity: isOpen ? 1 : 0,
                  }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 text-[rgb(var(--text-muted))] text-[14.5px] leading-relaxed">
                    {it.a}
                  </div>
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Wig Care ───────────────────────────────────────────────── */
export function WigCare({ payload }: { payload: LandingPayload }) {
  void payload;
  return (
    <section className="section-tight">
      <div className="mx-auto max-w-[820px] glass rounded-[var(--radius)] p-8">
        <SectionHeader
          eyebrow="Wear it forever"
          title="A 4-step care ritual."
        />
        <ol className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-[14px] text-[rgb(var(--text-muted))]">
          {[
            [
              "Wash gently every 8-10 wears",
              "Use sulphate-free shampoo. Soak, don't scrub.",
            ],
            ["Detangle from tips upward", "A wide-tooth comb. No hairbrushes."],
            ["Air-dry on a stand", "Direct heat dulls the cuticle."],
            ["Store braided + zipped", "Tangle-free between wears."],
          ].map(([title, body], i) => (
            <li key={i} className="flex gap-3">
              <span className="font-display text-[26px] text-[rgb(var(--gold))] leading-none">
                {i + 1}
              </span>
              <div>
                <div className="font-semibold text-[rgb(var(--text))]">
                  {title}
                </div>
                <div>{body}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Stylist Spotlight ─────────────────────────────────────── */
export function StylistSpotlight({ payload }: { payload: LandingPayload }) {
  const props = blockProps(payload, "stylist_spotlight");
  const name = (props.name as string) || "Our partner stylists";
  const body =
    (props.body as string) ||
    "Have it installed by a stylist who knows our cap construction. Discounted rates during sale weeks.";
  return (
    <section className="section-tight">
      <div className="mx-auto max-w-[760px] glass rounded-[var(--radius)] p-7 flex items-start gap-4">
        <span className="grid place-items-center w-12 h-12 rounded-xl bg-[rgb(var(--gold)/0.12)] text-[rgb(var(--gold))] flex-shrink-0">
          <Scissors className="w-5 h-5" />
        </span>
        <div>
          <div className="micro">Stylist spotlight</div>
          <h3 className="font-display text-[22px] leading-tight mt-1">
            {name}
          </h3>
          <p className="mt-2 text-[rgb(var(--text-muted))]">{body}</p>
        </div>
      </div>
    </section>
  );
}

/* ── Shipping & Returns ────────────────────────────────────── */
export function ShippingReturns({ payload }: { payload: LandingPayload }) {
  void payload;
  return (
    <section className="section-tight">
      <div className="mx-auto max-w-[920px] glass rounded-[var(--radius)] p-6 grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="flex gap-3 items-start">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-[rgb(var(--gold)/0.12)] text-[rgb(var(--gold))]">
            <Truck className="w-4.5 h-4.5" />
          </span>
          <div>
            <div className="font-semibold">DHL worldwide</div>
            <div className="text-[12.5px] text-[rgb(var(--text-muted))]">
              Tracked, insured.
            </div>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-[rgb(var(--gold)/0.12)] text-[rgb(var(--gold))]">
            <Heart className="w-4.5 h-4.5" />
          </span>
          <div>
            <div className="font-semibold">Hand-inspected</div>
            <div className="text-[12.5px] text-[rgb(var(--text-muted))]">
              Every unit, every time.
            </div>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-[rgb(var(--gold)/0.12)] text-[rgb(var(--gold))]">
            <Quote className="w-4.5 h-4.5" />
          </span>
          <div>
            <div className="font-semibold">48-hour grace</div>
            <div className="text-[12.5px] text-[rgb(var(--text-muted))]">
              Reach us in two days; we&apos;ll work it out.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
