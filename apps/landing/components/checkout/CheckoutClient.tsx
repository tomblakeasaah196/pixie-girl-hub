"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CreditCard,
  Gift,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import { postCheckout } from "@/lib/api-client";
import type { LandingPayload } from "@/lib/types";

type Gateway = "paystack" | "opay" | "nomba" | "stripe";

export function CheckoutClient({ payload }: { payload: LandingPayload }) {
  const router = useRouter();
  const items = useCart((s) => s.items);
  const subtotal = useCart((s) => s.subtotalNgn());
  const retail = useCart((s) => s.retailSubtotalNgn());
  const savings = useCart((s) => s.savingsNgn());

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+234 ");
  const [insta, setInsta] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Lagos");
  const [country] = useState("Nigeria");
  const [notes, setNotes] = useState("");
  const [isGift, setIsGift] = useState(false);
  const [giftName, setGiftName] = useState("");
  const [giftPhone, setGiftPhone] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [waOpt, setWaOpt] = useState(false);
  const [mktOpt, setMktOpt] = useState(false);
  const [terms, setTerms] = useState(false);
  const [honey, setHoney] = useState(""); // honeypot
  const [gateway, setGateway] = useState<Gateway>("paystack");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const idemKey = useMemo(
    () =>
      `pgh-${payload.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    [payload.slug],
  );
  const empty = items.length === 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (honey) return; // bot
    if (!terms) {
      setErr("Please accept the terms to continue.");
      return;
    }
    if (!first || !last || !email || !phone || !addressLine1 || !city) {
      setErr("All required fields must be filled.");
      return;
    }
    setBusy(true);
    try {
      const res = await postCheckout({
        slug: payload.slug,
        contact: {
          first_name: first,
          last_name: last,
          email,
          phone,
          instagram_handle: insta || undefined,
          notes: notes || undefined,
          gift: isGift
            ? {
                recipient_name: giftName,
                recipient_phone: giftPhone || undefined,
                message: giftMessage || undefined,
              }
            : undefined,
          address: {
            line1: addressLine1,
            line2: addressLine2 || undefined,
            city,
            state,
            country,
          },
          consent: {
            whatsapp_opt_in: waOpt,
            marketing_opt_in: mktOpt,
            terms_accepted: true,
          },
        },
        cart: items.map((i) => ({
          bundle_id: i.bundle_id,
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price_ngn: i.unit_price_ngn,
        })),
        utm: readUtm(),
        payment_gateway: gateway,
        client_idempotency_key: idemKey,
      });
      const payUrl =
        (res as { data?: { payment_url?: string }; payment_url?: string })?.data
          ?.payment_url ?? (res as { payment_url?: string }).payment_url;
      if (payUrl) {
        window.location.href = payUrl;
      } else {
        router.push(`/sale/${payload.slug}?status=processing`);
      }
    } catch (e) {
      setErr((e as Error)?.message || "Checkout failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (empty) {
    return (
      <main className="min-h-screen grid place-items-center px-6 py-16">
        <div className="glass rounded-[var(--radius)] p-8 max-w-md text-center">
          <h1 className="font-display text-2xl">Your cart is empty.</h1>
          <Link
            href={`/sale/${payload.slug}`}
            className="mt-4 inline-flex h-11 px-5 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
          >
            Back to the sale →
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen pb-16">
      <div className="mx-auto max-w-[1080px] px-6 md:px-10 pt-10">
        <Link
          href={`/sale/${payload.slug}`}
          className="inline-flex items-center gap-1 text-[13px] font-semibold text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to the sale
        </Link>
        <h1 className="font-display text-[36px] md:text-[44px] leading-tight mt-3">
          Almost{" "}
          <em className="not-italic md:italic text-[rgb(var(--accent-glow))]">
            yours.
          </em>
        </h1>

        <form
          onSubmit={submit}
          className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6"
        >
          <div className="space-y-5">
            <Section title="Contact">
              <Row>
                <Field label="First name" required>
                  <Input
                    value={first}
                    onChange={setFirst}
                    autoComplete="given-name"
                    required
                  />
                </Field>
                <Field label="Last name" required>
                  <Input
                    value={last}
                    onChange={setLast}
                    autoComplete="family-name"
                    required
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Email" required>
                  <Input
                    type="email"
                    value={email}
                    onChange={setEmail}
                    autoComplete="email"
                    required
                  />
                </Field>
                <Field label="Phone (with country code)" required>
                  <Input
                    value={phone}
                    onChange={setPhone}
                    autoComplete="tel"
                    required
                  />
                </Field>
              </Row>
              <Field label="Instagram handle (optional)">
                <Input
                  value={insta}
                  onChange={setInsta}
                  placeholder="@yourhandle"
                />
              </Field>
            </Section>

            <Section title="Delivery">
              <Field label="Address line 1" required>
                <Input
                  value={addressLine1}
                  onChange={setAddressLine1}
                  required
                />
              </Field>
              <Field label="Address line 2">
                <Input value={addressLine2} onChange={setAddressLine2} />
              </Field>
              <Row>
                <Field label="City" required>
                  <Input value={city} onChange={setCity} required />
                </Field>
                <Field label="State">
                  <Input value={state} onChange={setState} />
                </Field>
              </Row>
              <Field label="Order notes (optional)">
                <Textarea
                  value={notes}
                  onChange={setNotes}
                  placeholder="Leave with the security guard, for my sister's birthday, etc."
                />
              </Field>
            </Section>

            <Section title="Gift order?">
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={isGift}
                  onChange={(e) => setIsGift(e.target.checked)}
                  className="accent-[rgb(var(--accent-deep))]"
                />
                <Gift className="w-3.5 h-3.5 text-[rgb(var(--accent-glow))]" />
                <span>Yes — this is a gift</span>
              </label>
              {isGift && (
                <div className="mt-3 space-y-3">
                  <Row>
                    <Field label="Recipient name" required>
                      <Input value={giftName} onChange={setGiftName} />
                    </Field>
                    <Field label="Recipient phone">
                      <Input value={giftPhone} onChange={setGiftPhone} />
                    </Field>
                  </Row>
                  <Field label="Gift message">
                    <Textarea value={giftMessage} onChange={setGiftMessage} />
                  </Field>
                </div>
              )}
            </Section>

            <Section title="Pay with">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(["paystack", "opay", "nomba", "stripe"] as Gateway[]).map(
                  (g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGateway(g)}
                      className={`p-3 rounded-xl border text-[13px] font-semibold capitalize ${
                        gateway === g
                          ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)] text-[rgb(var(--accent-glow))]"
                          : "border-[rgb(var(--border-c)/0.1)] text-[rgb(var(--text-muted))]"
                      }`}
                    >
                      {g}
                    </button>
                  ),
                )}
              </div>
            </Section>

            <Section title="Consent &amp; terms">
              <Toggle
                label="Send me sale-day updates on WhatsApp"
                checked={waOpt}
                onChange={setWaOpt}
              />
              <Toggle
                label="Sign me up for the newsletter"
                checked={mktOpt}
                onChange={setMktOpt}
              />
              <Toggle
                label="I accept the terms and privacy policy"
                checked={terms}
                onChange={setTerms}
                required
              />
              {/* Honeypot — hidden anti-bot field */}
              <label className="hidden" aria-hidden>
                Leave this empty
                <input
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honey}
                  onChange={(e) => setHoney(e.target.value)}
                />
              </label>
            </Section>

            {err && (
              <div className="text-[13px] text-[rgb(var(--danger))]">{err}</div>
            )}
          </div>

          <aside className="lg:sticky lg:top-6 h-fit">
            <div className="glass rounded-[var(--radius)] p-5 space-y-4">
              <h3 className="font-display text-[20px]">Order summary</h3>
              <ul className="space-y-2.5">
                {items.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 text-[13px]">
                    <div className="font-mono text-[rgb(var(--text-faint))] tabular-nums">
                      ×{i.quantity}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-semibold">{i.name}</div>
                      {i.preorder && (
                        <div className="text-[11px] text-[rgb(var(--warn))]">
                          Pre-order · ships in {i.preorder_lead_weeks ?? 3}{" "}
                          weeks
                        </div>
                      )}
                    </div>
                    <div className="tabular-nums font-mono">
                      {money(i.unit_price_ngn * i.quantity)}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="border-t hairline pt-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[rgb(var(--text-muted))]">
                    Subtotal
                  </span>
                  <span className="tabular-nums font-mono">
                    {money(subtotal)}
                  </span>
                </div>
                {savings > 0 && (
                  <div className="flex justify-between text-[rgb(var(--success))]">
                    <span>You save</span>
                    <span className="tabular-nums font-mono">
                      −{money(savings)}
                    </span>
                  </div>
                )}
                {savings > 0 && (
                  <div className="flex justify-between text-[12px] text-[rgb(var(--text-faint))]">
                    <span>vs retail</span>
                    <span className="tabular-nums font-mono line-through">
                      {money(retail)}
                    </span>
                  </div>
                )}
              </div>
              <div className="border-t hairline pt-3 flex justify-between">
                <span className="font-semibold">Total</span>
                <span className="font-display text-[22px] tabular-nums">
                  {money(subtotal)}
                </span>
              </div>
              <motion.button
                type="submit"
                whileTap={{ scale: 0.99 }}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen disabled:opacity-60"
              >
                {busy ? (
                  "Securing your order…"
                ) : (
                  <>
                    <Lock className="w-4 h-4" /> Pay {money(subtotal)}
                  </>
                )}
              </motion.button>
              <div className="text-[11px] text-[rgb(var(--text-faint))] text-center inline-flex items-center justify-center gap-1 w-full">
                <ShieldCheck className="w-3 h-3 text-[rgb(var(--success))]" />{" "}
                Secure checkout · DHL rates apply
              </div>
              <p className="text-[11px] text-[rgb(var(--text-faint))] text-center">
                <CreditCard className="inline w-3 h-3 mr-1" />
                You&apos;ll be redirected to your gateway.
              </p>
            </div>
          </aside>
        </form>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass rounded-[var(--radius)] p-5 space-y-3">
      <h3 className="font-display text-[18px]">{title}</h3>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="micro mb-1.5 block">
        {label}{" "}
        {required && <span className="text-[rgb(var(--accent-glow))]">*</span>}
      </span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  type = "text",
  required,
  placeholder,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className="w-full h-11 px-3.5 rounded-xl bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.5)] text-[14px]"
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      placeholder={placeholder}
      className="w-full px-3.5 py-2 rounded-xl bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)] outline-none focus:border-[rgb(var(--accent)/0.5)] text-[14px]"
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
  required,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  required?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-[13px] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required={required}
        className="mt-0.5 accent-[rgb(var(--accent-deep))]"
      />
      <span>
        {label}{" "}
        {required && <span className="text-[rgb(var(--accent-glow))]">*</span>}
        {checked && (
          <Check className="inline w-3 h-3 text-[rgb(var(--success))] ml-1" />
        )}
      </span>
    </label>
  );
}

function readUtm(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const out: Record<string, string> = {};
  for (const k of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
  ]) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out;
}
