import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  ShoppingBag,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api";

/**
 * Public Order Capture consumer (`/order/capture/:token`).
 *
 * The customer lands here from a link a staffer generated inside a
 * Smartcomm chat. We verify the signed JWT via the public verifier
 * endpoint, hydrate the item list + their delivery address from
 * `contact_addresses`, let them confirm / edit the address, then post
 * to the existing public order-form endpoint to create a real order.
 *
 * The customer never has to retype their address — it's pre-filled
 * from the Online QR form they completed earlier (or the contact
 * record we already had).
 */

interface PrefillItem {
  product_id: string;
  variant_id: string | null;
  qty: number;
  price_ngn: string | null;
  note: string | null;
  name: string | null;
  product_code: string | null;
  image_url: string | null;
}

interface PrefillAddress {
  line1: string | null;
  line2: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  country_code: string | null;
  landmark: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface PrefillContext {
  brand: string;
  sales_channel: string | null;
  expires_at: string;
  contact: {
    contact_id: string;
    first_name: string | null;
    last_name: string | null;
    display_name: string | null;
    primary_phone: string | null;
    whatsapp_number: string | null;
    email: string | null;
  };
  delivery_address: PrefillAddress | null;
  items: PrefillItem[];
  notes: string | null;
}

type Stage = "loading" | "form" | "submitting" | "done" | "error";

export function OrderCapturePublic() {
  const { token = "" } = useParams<{ token: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [ctx, setCtx] = useState<PrefillContext | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const [address, setAddress] = useState({
    line1: "",
    area: "",
    city: "Lagos",
    state: "Lagos",
    landmark: "",
  });
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.post<PrefillContext>(
          "/order-capture/verify",
          { token },
          "public",
        );
        if (cancelled) return;
        setCtx(data);
        if (data.delivery_address) {
          setAddress({
            line1: data.delivery_address.line1 ?? "",
            area: data.delivery_address.area ?? "",
            city: data.delivery_address.city ?? "Lagos",
            state: data.delivery_address.state ?? "Lagos",
            landmark: data.delivery_address.landmark ?? "",
          });
        }
        setPhone(
          data.contact.primary_phone || data.contact.whatsapp_number || "",
        );
        setEmail(data.contact.email ?? "");
        setStage("form");
      } catch (e: unknown) {
        if (cancelled) return;
        setErrMsg(
          e instanceof Error ? e.message : "We couldn't open this order link.",
        );
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const variantItems = useMemo(
    () => (ctx?.items ?? []).filter((i) => i.variant_id),
    [ctx],
  );
  const unsupportedItems = useMemo(
    () => (ctx?.items ?? []).filter((i) => !i.variant_id),
    [ctx],
  );

  const canSubmit = !!address.line1 && !!phone && variantItems.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !ctx) return;
    setStage("submitting");
    setErrMsg(null);
    try {
      await api.post(
        "/order-form",
        {
          first_name: ctx.contact.first_name || undefined,
          last_name: ctx.contact.last_name || undefined,
          phone,
          email: email || undefined,
          delivery_address: [
            address.line1,
            address.area,
            address.city,
            address.state,
            address.landmark ? `Landmark: ${address.landmark}` : null,
          ]
            .filter(Boolean)
            .join(", "),
          sales_channel:
            ctx.sales_channel &&
            ["public_form", "whatsapp", "instagram", "facebook"].includes(
              ctx.sales_channel,
            )
              ? ctx.sales_channel
              : "public_form",
          items: variantItems.map((i) => ({
            variant_id: i.variant_id!,
            quantity: i.qty,
          })),
          client_idempotency_key: `capture:${token.slice(-24)}`,
        },
        "public",
      );
      setStage("done");
    } catch (e: unknown) {
      setErrMsg(
        e instanceof Error
          ? e.message
          : "Couldn't place your order. Please try again.",
      );
      setStage("form");
    }
  }

  if (stage === "loading") {
    return (
      <Shell>
        <div className="grid place-items-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-accent-glow" />
        </div>
      </Shell>
    );
  }
  if (stage === "error") {
    return (
      <Shell>
        <div className="text-center py-12">
          <AlertCircle className="w-8 h-8 mx-auto mb-3 text-danger" />
          <p className="text-[14px] font-medium">
            Sorry — link no longer works.
          </p>
          <p className="text-[12.5px] text-text-muted mt-1 max-w-[360px] mx-auto">
            {errMsg ?? "Please ask us for a fresh order link."}
          </p>
        </div>
      </Shell>
    );
  }
  if (stage === "done") {
    return (
      <Shell>
        <div className="text-center py-12">
          <CheckCircle2 className="w-9 h-9 mx-auto mb-3 text-green-400" />
          <p className="font-display text-[20px] mb-1">Order placed 🌹</p>
          <p className="text-[13px] text-text-muted max-w-[360px] mx-auto">
            We&rsquo;ll WhatsApp you a payment link in a moment. Once payment
            lands, your order moves into production.
          </p>
        </div>
      </Shell>
    );
  }

  if (!ctx) return null;

  return (
    <Shell brand={ctx.brand}>
      <p className="text-[13px] text-text-muted leading-relaxed mb-5">
        Hi {ctx.contact.first_name || "there"} — your selection is below.
        Confirm your delivery address and place the order.
      </p>

      {/* Items */}
      <div className="rounded-2xl bg-bg/50 border hairline p-3 mb-5">
        <div className="flex items-center gap-2 mb-2.5">
          <ShoppingBag className="w-4 h-4 text-accent-glow" />
          <span className="text-[12px] uppercase tracking-widest text-text-faint font-semibold">
            Your selection ({ctx.items.length})
          </span>
        </div>
        <div className="space-y-2">
          {ctx.items.map((i) => (
            <div
              key={i.product_id}
              className="flex items-center gap-3 rounded-lg bg-panel-2 border hairline p-2.5"
            >
              {i.image_url ? (
                <img
                  src={i.image_url}
                  alt=""
                  className="w-12 h-12 rounded-lg object-cover border hairline"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-panel grid place-items-center text-text-faint border hairline">
                  <ShoppingBag className="w-4 h-4" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] truncate">
                  {i.name ?? "Product"}
                </div>
                {i.note && (
                  <div className="text-[11.5px] text-text-faint truncate">
                    {i.note}
                  </div>
                )}
                {!i.variant_id && (
                  <div className="text-[11px] text-amber-300 mt-0.5">
                    Variant unavailable — we&rsquo;ll confirm by WhatsApp.
                  </div>
                )}
              </div>
              <span className="text-[12px] font-medium tabular-nums">
                ×{i.qty}
              </span>
            </div>
          ))}
        </div>
      </div>

      {unsupportedItems.length > 0 && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 mb-5 text-[12px] text-amber-200">
          Some items couldn&rsquo;t be added automatically. They&rsquo;re
          flagged above — our team will follow up on WhatsApp to finalise those
          before shipping.
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <Section title="Delivery">
          <Field
            label="Street / house"
            required
            value={address.line1}
            onChange={(v) => setAddress({ ...address, line1: v })}
            placeholder="e.g. 12 Admiralty Way"
          />
          <Field
            label="Area / neighbourhood"
            value={address.area}
            onChange={(v) => setAddress({ ...address, area: v })}
          />
          <Row>
            <Field
              label="City"
              value={address.city}
              onChange={(v) => setAddress({ ...address, city: v })}
            />
            <Field
              label="State"
              value={address.state}
              onChange={(v) => setAddress({ ...address, state: v })}
            />
          </Row>
          <Field
            label="Landmark (helps the rider)"
            value={address.landmark}
            onChange={(v) => setAddress({ ...address, landmark: v })}
          />
        </Section>

        <Section title="Contact">
          <Field
            label="Phone (for delivery)"
            type="tel"
            required
            value={phone}
            onChange={setPhone}
            placeholder="+234…"
          />
          <Field
            label="Email (receipt)"
            type="email"
            value={email}
            onChange={setEmail}
          />
        </Section>

        {errMsg && (
          <p className="text-[12px] text-danger inline-flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" />
            {errMsg}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit || stage === "submitting"}
          className="w-full grid place-items-center rounded-xl bg-accent text-bg font-semibold py-3 text-[14px] hover:bg-accent-glow disabled:opacity-50 transition-all"
        >
          {stage === "submitting" ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "Place order"
          )}
        </button>

        <div className="flex items-start gap-2 text-[11.5px] text-text-faint">
          <ShieldCheck className="w-3.5 h-3.5 mt-[1px] shrink-0" />
          <span>
            Secured by a one-time link bound to this conversation. Expires{" "}
            {new Date(ctx.expires_at).toLocaleString()}.
          </span>
        </div>
      </form>
    </Shell>
  );
}

// ── Layout shell ──────────────────────────────────────────

function Shell({
  brand,
  children,
}: {
  brand?: string;
  children: React.ReactNode;
}) {
  const brandName =
    brand === "faitlynhair"
      ? "Faitlyn"
      : brand === "pixiegirl"
        ? "Pixie Girl"
        : "Order";
  return (
    // Own scroll: the app pins `body { overflow:hidden }` for the authed shell,
    // so this standalone public page must scroll itself or tall content is
    // unreachable on a phone.
    <div className="h-[100dvh] overflow-y-auto overscroll-contain bg-bg text-text-primary px-4 py-6 sm:px-6 sm:py-10">
      <div className="max-w-[560px] mx-auto">
        <div className="flex items-center gap-2 mb-5">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-accent text-bg font-display text-[18px]">
            {brandName[0]}
          </div>
          <div>
            <p className="font-display text-[18px] leading-none">{brandName}</p>
            <p className="text-[11.5px] text-text-faint">Confirm your order</p>
          </div>
        </div>
        <div className="rounded-2xl bg-panel border hairline p-5 sm:p-6">
          {children}
        </div>
      </div>
    </div>
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
    <div>
      <div className="text-[11px] uppercase tracking-widest text-text-faint mb-2">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{children}</div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
      />
    </label>
  );
}
