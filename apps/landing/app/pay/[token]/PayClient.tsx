"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle,
  Clock,
  Loader2,
  Lock,
  MessageCircle,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import {
  fetchPayPreview,
  postPayLink,
  type PayPreview,
} from "@/lib/api-client";
import { displayMoney } from "@/lib/format";

type Choice = "balance" | "half" | "custom";

const n = (s: string | number | null | undefined) => Number(s || 0);

/**
 * Flexi Pay balance page (PR-2). Renders four states — loading, not-found,
 * fully-paid, and the pay UI — from the Hub preview (single source of truth for
 * every figure). The buyer picks how much to pay now (balance / half / custom ≥
 * the plan minimum) and is handed to the gateway; on return the page re-fetches
 * and reflects the new balance.
 */
export function PayClient({
  token,
  brandName,
  whatsappHref,
}: {
  token: string;
  brandName: string;
  whatsappHref: string | null;
}) {
  const [preview, setPreview] = useState<PayPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [choice, setChoice] = useState<Choice>("balance");
  const [customStr, setCustomStr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the buyer has just returned from the gateway (?ref=…). We poll the
  // preview a few times so the freshly-confirmed payment shows without a manual
  // refresh (the webhook records it a few seconds after the redirect).
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const data = await fetchPayPreview(token);
    if (!data) {
      setNotFound(true);
      setPreview(null);
    } else {
      setPreview(data);
      setNotFound(false);
    }
    setLoading(false);
    return data;
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // If the URL carries a gateway ref (buyer just returned from paying), poll
  // for up to ~40s so the confirmed payment lands on the page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hasRef = new URLSearchParams(window.location.search).has("ref");
    if (!hasRef) return;
    setConfirming(true);
    let tries = 0;
    const prevPaid = n(preview?.amount_paid_ngn);
    const id = setInterval(async () => {
      tries += 1;
      const data = await load();
      const paidNow = n(data?.amount_paid_ngn);
      if (paidNow > prevPaid || n(data?.outstanding_ngn) <= 0 || tries >= 10) {
        clearInterval(id);
        setConfirming(false);
      }
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const cur = preview?.display_currency || "NGN";
  const rate = preview?.display_fx_rate ?? null;
  const show = useCallback(
    (ngn: number) => displayMoney(ngn, cur, rate),
    [cur, rate],
  );

  const total = n(preview?.total_ngn);
  const paid = n(preview?.amount_paid_ngn);
  const outstanding = n(preview?.outstanding_ngn);
  const min = n(preview?.min_next_payment_ngn);
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

  // "Pay half" is only meaningful when half is a genuine split above the
  // minimum and below the full balance.
  const halfNgn = Math.max(min, Math.round(outstanding / 2));
  const showHalf = halfNgn > min - 1 && halfNgn < outstanding;

  // Amount to charge (NGN base), from the current choice.
  const amountNgn = useMemo(() => {
    if (choice === "balance") return outstanding;
    if (choice === "half") return halfNgn;
    // Custom input is entered in the DISPLAY currency; convert to NGN base.
    const raw = Number(customStr.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return cur !== "NGN" && rate && rate > 0
      ? Math.round(raw * rate)
      : Math.round(raw);
  }, [choice, outstanding, halfNgn, customStr, cur, rate]);

  const customTooLow = choice === "custom" && amountNgn > 0 && amountNgn < min;
  const customTooHigh = choice === "custom" && amountNgn > outstanding;
  const canPay =
    !submitting &&
    amountNgn >= min &&
    amountNgn <= outstanding &&
    amountNgn > 0;

  const handlePay = async () => {
    if (!canPay) return;
    setSubmitting(true);
    setError(null);
    try {
      const { checkout_url } = await postPayLink({
        token,
        amount_ngn: amountNgn,
        currency: cur !== "NGN" ? cur : undefined,
      });
      window.location.href = checkout_url;
    } catch (e) {
      setError((e as Error)?.message || "Could not start the payment.");
      setSubmitting(false);
    }
  };

  // ── Loading ──────────────────────────────────────────────
  if (loading) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-4 py-10">
          <Loader2 className="w-8 h-8 animate-spin text-[rgb(var(--accent-glow))]" />
          <p className="text-[rgb(var(--text-muted))] text-[14px]">
            Loading your order…
          </p>
        </div>
      </Shell>
    );
  }

  // ── Not found ────────────────────────────────────────────
  if (notFound || !preview) {
    return (
      <Shell>
        <div className="text-center space-y-4 py-6">
          <h1 className="font-display text-[28px] leading-tight">
            Link not found
          </h1>
          <p className="text-[rgb(var(--text-muted))] text-[14px]">
            This payment link is invalid or has expired. If you think this is a
            mistake, reach out and we&apos;ll help.
          </p>
          {whatsappHref && <SupportButton href={whatsappHref} />}
        </div>
      </Shell>
    );
  }

  const fullyPaid =
    outstanding <= 0 ||
    preview.status === "paid" ||
    preview.status === "completed";

  // ── Fully paid ───────────────────────────────────────────
  if (fullyPaid) {
    return (
      <Shell>
        <div className="text-center space-y-5 py-2">
          <div className="mx-auto w-16 h-16 rounded-full bg-[rgb(var(--success)/0.12)] grid place-items-center">
            <CheckCircle className="w-8 h-8 text-[rgb(var(--success))]" />
          </div>
          <h1 className="font-display text-[30px] md:text-[38px] leading-tight">
            Paid in{" "}
            <em className="not-italic md:italic text-[rgb(var(--accent-glow))]">
              full.
            </em>
          </h1>
          <p className="text-[rgb(var(--text-muted))]">
            Order{" "}
            <span className="font-mono font-semibold">
              {preview.order_number}
            </span>{" "}
            is fully paid. Thank you for shopping with {brandName}.
          </p>
          {preview.payments.length > 0 && (
            <History payments={preview.payments} show={show} />
          )}
          {whatsappHref && <SupportButton href={whatsappHref} />}
        </div>
      </Shell>
    );
  }

  // ── Pay UI ───────────────────────────────────────────────
  return (
    <Shell>
      <div className="space-y-6">
        <div className="text-center space-y-1.5">
          <p className="text-[11px] tracking-[0.2em] uppercase text-[rgb(var(--accent-glow))]">
            {preview.plan_display_name}
          </p>
          <h1 className="font-display text-[26px] md:text-[32px] leading-tight">
            Complete your payment
          </h1>
          <p className="text-[13px] text-[rgb(var(--text-muted))]">
            Order{" "}
            <span className="font-mono font-semibold">
              {preview.order_number}
            </span>
          </p>
        </div>

        {confirming && (
          <div className="flex items-center justify-center gap-2 text-[13px] text-[rgb(var(--text-muted))]">
            <Clock className="w-4 h-4 animate-pulse text-[rgb(var(--accent-glow))]" />
            Confirming your last payment…
          </div>
        )}

        {/* Progress */}
        <div className="glass rounded-xl p-5 space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[rgb(var(--text-muted))]">
                Balance remaining
              </div>
              <div className="font-mono text-[26px] font-semibold text-[rgb(var(--accent-glow))]">
                {show(outstanding)}
              </div>
            </div>
            <div className="text-right text-[12px] text-[rgb(var(--text-muted))]">
              <div>Paid {show(paid)}</div>
              <div>of {show(total)}</div>
            </div>
          </div>
          <div className="h-2 rounded-full bg-[rgb(var(--text)/0.08)] overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-[rgb(var(--accent-deep))]"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <div className="text-[11px] text-[rgb(var(--text-faint))] text-right">
            {pct}% paid
          </div>
        </div>

        {/* Amount choice */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            <AmountOption
              active={choice === "balance"}
              onClick={() => setChoice("balance")}
              label="Pay the full balance"
              value={show(outstanding)}
            />
            {showHalf && (
              <AmountOption
                active={choice === "half"}
                onClick={() => setChoice("half")}
                label="Pay half now"
                value={show(halfNgn)}
              />
            )}
            <AmountOption
              active={choice === "custom"}
              onClick={() => setChoice("custom")}
              label="Choose an amount"
              value={`Min ${show(min)}`}
            />
          </div>

          {choice === "custom" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 glass rounded-xl px-4 h-12">
                <span className="text-[rgb(var(--text-muted))] font-mono">
                  {cur === "NGN" ? "₦" : cur === "USD" ? "$" : cur}
                </span>
                <input
                  inputMode="decimal"
                  autoFocus
                  value={customStr}
                  onChange={(e) => setCustomStr(e.target.value)}
                  placeholder={`${cur === "NGN" ? "" : ""}Enter amount`}
                  className="flex-1 bg-transparent outline-none font-mono text-[16px] text-[rgb(var(--text))] placeholder:text-[rgb(var(--text-faint))]"
                />
              </div>
              {customTooLow && (
                <p className="text-[12px] text-[rgb(var(--warn))]">
                  Minimum payment is {show(min)}. You can also pay the exact
                  balance.
                </p>
              )}
              {customTooHigh && (
                <p className="text-[12px] text-[rgb(var(--warn))]">
                  That&apos;s more than the {show(outstanding)} outstanding.
                </p>
              )}
            </div>
          )}
        </div>

        {error && (
          <p className="text-[13px] text-[rgb(var(--warn))] text-center">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handlePay}
          disabled={!canPay}
          className="inline-flex items-center justify-center gap-2 w-full h-13 min-h-[52px] rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Starting…
            </>
          ) : (
            <>
              <Lock className="w-4 h-4" /> Pay {show(amountNgn || 0)}
            </>
          )}
        </button>

        <div className="flex items-center justify-center gap-1.5 text-[11px] text-[rgb(var(--text-faint))]">
          <ShieldCheck className="w-3.5 h-3.5" />
          Secured by your bank&apos;s payment gateway
        </div>

        {/* Terms */}
        {preview.plan_terms?.length > 0 && (
          <details className="glass rounded-xl px-4 py-3 text-[13px]">
            <summary className="cursor-pointer font-semibold text-[rgb(var(--text-muted))]">
              How {preview.plan_display_name} works
            </summary>
            <ul className="mt-3 space-y-2 text-[rgb(var(--text-muted))]">
              {preview.plan_terms.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[rgb(var(--accent-glow))]">•</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* History */}
        {preview.payments.length > 0 && (
          <History payments={preview.payments} show={show} />
        )}

        {whatsappHref && (
          <div className="text-center">
            <SupportButton href={whatsappHref} subtle />
          </div>
        )}

        <p className="text-center text-[11px] text-[rgb(var(--text-faint))]">
          Save this link — you can pay the rest anytime.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen grid place-items-center px-5 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="glass rounded-[var(--radius)] p-6 md:p-8 max-w-md w-full"
      >
        {children}
      </motion.div>
    </main>
  );
}

function AmountOption({
  active,
  onClick,
  label,
  value,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  value: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between w-full h-12 px-4 rounded-xl border transition-colors text-left ${
        active
          ? "border-[rgb(var(--accent-glow))] bg-[rgb(var(--accent)/0.08)]"
          : "border-[rgb(var(--text)/0.12)] hover:border-[rgb(var(--text)/0.25)]"
      }`}
    >
      <span className="flex items-center gap-2.5 text-[14px]">
        <span
          className={`w-4 h-4 rounded-full border grid place-items-center ${
            active
              ? "border-[rgb(var(--accent-glow))]"
              : "border-[rgb(var(--text)/0.3)]"
          }`}
        >
          {active && (
            <span className="w-2 h-2 rounded-full bg-[rgb(var(--accent-glow))]" />
          )}
        </span>
        {label}
      </span>
      <span className="font-mono text-[13px] text-[rgb(var(--text-muted))]">
        {value}
      </span>
    </button>
  );
}

function History({
  payments,
  show,
}: {
  payments: PayPreview["payments"];
  show: (ngn: number) => string;
}) {
  const fmt = (iso: string | null) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "";
    }
  };
  return (
    <div className="glass rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[rgb(var(--text-muted))]">
        <Receipt className="w-4 h-4 text-[rgb(var(--accent-glow))]" />
        Payment history
      </div>
      <ul className="space-y-2">
        {payments.map((p) => (
          <li
            key={p.payment_number}
            className="flex items-center justify-between text-[13px]"
          >
            <span className="text-[rgb(var(--text-muted))]">
              {fmt(p.paid_at)}
            </span>
            <span className="font-mono font-semibold">
              {show(Number(p.amount_ngn))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SupportButton({ href, subtle }: { href: string; subtle?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        subtle
          ? "inline-flex items-center gap-1.5 text-[12px] text-[rgb(var(--text-muted))] hover:text-[rgb(var(--accent-glow))] transition-colors"
          : "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl border border-[rgb(var(--text)/0.15)] text-[14px] font-medium"
      }
    >
      <MessageCircle className="w-4 h-4" />
      Need help? Chat with us
    </a>
  );
}
