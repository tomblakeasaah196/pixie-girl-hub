"use client";

import { useState } from "react";
import { Bell, Check, Crown, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import type { LandingPayload } from "@/lib/types";
import { postSignup } from "@/lib/api-client";
import { SectionHeader } from "./BundleShowcase";

function blockProps(
  payload: LandingPayload,
  key: string,
): Record<string, unknown> {
  const b = (payload.blocks || []).find((x) => x.key === key);
  return (b?.props as Record<string, unknown>) || {};
}

export function NewsletterCapture({ payload }: { payload: LandingPayload }) {
  const props = blockProps(payload, "newsletter_capture");
  return (
    <Form
      payload={payload}
      eyebrow="Get on the list"
      title={(props.title as string) || "Be first in line."}
      subtitle={(props.description as string) || "One email when the doors open. Quiet inbox otherwise."}
      ctaLabel={(props.button_label as string) || "Notify me"}
      anchor="signup"
      source="landing_newsletter"
    />
  );
}

export function VipSignup({ payload }: { payload: LandingPayload }) {
  if (
    !payload.vip_early_access_minutes ||
    payload.vip_early_access_minutes <= 0
  )
    return null;
  const mins = payload.vip_early_access_minutes;
  const hrs = Math.round((mins / 60) * 10) / 10;
  const props = blockProps(payload, "vip_signup");
  return (
    <Form
      payload={payload}
      eyebrow="VIP early access"
      title={(props.title as string) || "Doors open earlier — for you."}
      subtitle={(props.description as string) || `Sign up to get in ${hrs}h before everyone else. We send the private link the moment the window opens.`}
      ctaLabel={(props.button_label as string) || "Reserve my access"}
      anchor="vip-signup"
      source="landing_vip"
      icon={<Crown className="w-4 h-4" />}
      featured
    />
  );
}

function Form({
  payload,
  eyebrow,
  title,
  subtitle,
  ctaLabel,
  anchor,
  source,
  icon,
  featured,
}: {
  payload: LandingPayload;
  eyebrow: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  anchor: string;
  source: string;
  icon?: React.ReactNode;
  featured?: boolean;
}) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [via, setVia] = useState<"email" | "whatsapp" | "both">("email");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!email && !phone) {
      setErr("Email or phone is required.");
      return;
    }
    setBusy(true);
    const r = await postSignup({
      slug: payload.slug,
      email: email || undefined,
      phone: phone || undefined,
      notify_via: via,
      source,
    });
    setBusy(false);
    if (r.ok) setSent(true);
    else setErr(r.error);
  }

  if (sent) {
    return (
      <section id={anchor} className="section-tight">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-[640px] glass rounded-[var(--radius)] p-8 text-center"
        >
          <span className="grid place-items-center w-12 h-12 rounded-full bg-[rgb(var(--success)/0.18)] text-[rgb(var(--success))] mx-auto mb-3">
            <Check className="w-5 h-5" />
          </span>
          <h3 className="font-display text-[24px]">You&apos;re in.</h3>
          <p className="text-[rgb(var(--text-muted))] mt-2">
            We&apos;ll let you know the moment doors open.
          </p>
        </motion.div>
      </section>
    );
  }

  return (
    <section id={anchor} className="section-tight">
      <div
        className={`mx-auto max-w-[640px] glass rounded-[var(--radius)] p-7 md:p-8 ${
          featured ? "border-[rgb(var(--accent)/0.4)]" : ""
        }`}
      >
        <SectionHeader eyebrow={eyebrow} title={title} />
        <p className="text-center text-[rgb(var(--text-muted))] mt-3">
          {subtitle}
        </p>
        <form onSubmit={submit} className="mt-6 space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full h-12 px-4 rounded-xl bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.4)] text-[14px]"
          />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+234 ..."
            className="w-full h-12 px-4 rounded-xl bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.4)] text-[14px]"
          />
          <div className="flex gap-2 text-[12px]">
            {(["email", "whatsapp", "both"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVia(v)}
                className={`px-3 py-1.5 rounded-[10px] font-semibold capitalize border ${
                  via === v
                    ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.1)] text-[rgb(var(--accent-glow))]"
                    : "border-[rgb(var(--border-c)/0.1)] text-[rgb(var(--text-muted))]"
                }`}
              >
                {v === "both" ? "Email + WhatsApp" : v}
              </button>
            ))}
          </div>
          {err && (
            <p className="text-[12px] text-[rgb(var(--danger))]">{err}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              icon || <Bell className="w-4 h-4" />
            )}
            {busy ? "Sending…" : ctaLabel}
          </button>
        </form>
      </div>
    </section>
  );
}
