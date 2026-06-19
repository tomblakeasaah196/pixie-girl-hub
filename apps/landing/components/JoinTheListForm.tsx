"use client";

import { useState } from "react";
import { Bell, Check, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

/**
 * Brand-level "Join the list" form for the empty-state apex page.
 *
 * Posts to /api/public/newsletter (upserts a CRM contact with source='website').
 * No slug required since this captures interest at the brand level, not per-campaign.
 */
export function JoinTheListForm() {
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
    try {
      const res = await fetch("/api/public/newsletter", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email: email || undefined,
          phone: phone || undefined,
          notify_via: via,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        setErr(errBody || `Error: HTTP ${res.status}`);
        setBusy(false);
        return;
      }

      setSent(true);
    } catch (e) {
      setErr((e as Error)?.message || "Network error");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass rounded-[var(--radius)] p-8 text-center"
      >
        <span className="grid place-items-center w-12 h-12 rounded-full bg-[rgb(var(--success)/0.18)] text-[rgb(var(--success))] mx-auto mb-3">
          <Check className="w-5 h-5" />
        </span>
        <h3 className="font-display text-[24px]">You&apos;re on the list.</h3>
        <p className="text-[rgb(var(--text-muted))] mt-2">
          We&apos;ll let you know the moment a new drop opens.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="glass rounded-[var(--radius)] p-7 md:p-8">
      <h2 className="font-display text-[32px] leading-tight text-center">Get on the list.</h2>
      <p className="text-center text-[rgb(var(--text-muted))] text-sm mt-3">
        One email when doors open. Quiet inbox otherwise.
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
        {err && <p className="text-[12px] text-[rgb(var(--danger))]">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
          {busy ? "Sending…" : "Notify me"}
        </button>
      </form>
    </div>
  );
}
