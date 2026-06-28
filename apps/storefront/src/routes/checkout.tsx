import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { checkout, type CheckoutInput } from "@/lib/storefront";
import { useCurrency } from "@/lib/useStore";
import { Section } from "@/components/parts";

export const Route = createFileRoute("/checkout")({ component: CheckoutPage });

const COUNTRIES: { code: string; name: string }[] = [
  { code: "NG", name: "Nigeria" },
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GH", name: "Ghana" },
];

function CheckoutPage() {
  const [currency] = useCurrency();
  const [busy, setBusy] = useState(false);
  const [fulfilment, setFulfilment] = useState<"delivery" | "pickup">("delivery");
  const [gateway, setGateway] = useState("nomba");
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    country_code: "NG",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const country = COUNTRIES.find((c) => c.code === f.country_code)?.name;
      const input: CheckoutInput = {
        contact: {
          first_name: f.first_name,
          last_name: f.last_name,
          email: f.email,
          phone: f.phone,
          ...(fulfilment === "delivery"
            ? {
                address: {
                  line1: f.line1,
                  line2: f.line2,
                  city: f.city,
                  state: f.state,
                  country,
                  country_code: f.country_code,
                  zone_code: f.country_code,
                },
              }
            : {}),
        },
        fulfilment_type: fulfilment,
        display_currency: currency,
        payment_gateway: gateway,
        client_idempotency_key:
          (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
          `sf-${Date.now()}`,
      };
      const res = await checkout(input);
      // Hand off to the gateway hosted page.
      window.location.href = res.payment_url;
    } catch (err) {
      const m =
        (err as { userMessage?: string })?.userMessage ||
        "Checkout failed. Please review your details and try again.";
      toast.error(m);
      setBusy(false);
    }
  }

  const field =
    "input-line text-body placeholder:text-muted-foreground";

  return (
    <Section className="max-w-2xl">
      <h1 className="text-h3 font-display">Checkout</h1>
      <Link to="/cart" className="mt-1 inline-block text-body-sm text-muted-foreground hover:text-foreground">
        ← Back to bag
      </Link>

      <form onSubmit={submit} className="mt-8 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <input className={field} placeholder="First name" value={f.first_name} onChange={set("first_name")} required />
          <input className={field} placeholder="Last name" value={f.last_name} onChange={set("last_name")} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <input className={field} type="email" placeholder="Email" value={f.email} onChange={set("email")} required />
          <input className={field} placeholder="Phone" value={f.phone} onChange={set("phone")} required />
        </div>

        <div className="flex gap-2">
          {(["delivery", "pickup"] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setFulfilment(t)}
              className={`rounded-full border px-4 py-1.5 text-body-sm capitalize ${fulfilment === t ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
            >
              {t === "pickup" ? "Store pickup" : "Delivery"}
            </button>
          ))}
        </div>

        {fulfilment === "delivery" ? (
          <div className="space-y-4">
            <input className={field} placeholder="Address line 1" value={f.line1} onChange={set("line1")} required />
            <input className={field} placeholder="Address line 2 (optional)" value={f.line2} onChange={set("line2")} />
            <div className="grid grid-cols-2 gap-4">
              <input className={field} placeholder="City" value={f.city} onChange={set("city")} required />
              <input className={field} placeholder="State / region" value={f.state} onChange={set("state")} />
            </div>
            <select
              className="input-line text-body"
              value={f.country_code}
              onChange={(e) => setF((s) => ({ ...s, country_code: e.target.value }))}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <p className="text-caption">Payment</p>
          <div className="mt-3 flex gap-2">
            {(currency === "USD" ? ["nomba", "stripe"] : ["nomba", "paystack"]).map((g) => (
              <button
                type="button"
                key={g}
                onClick={() => setGateway(g)}
                className={`rounded-full border px-4 py-1.5 text-body-sm capitalize ${gateway === g ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-primary py-3.5 text-body text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Starting secure payment…" : `Pay in ${currency}`}
        </button>
        <p className="text-center text-body-sm text-muted-foreground">
          You'll be taken to a secure payment page. You won't be charged twice on retry.
        </p>
      </form>
    </Section>
  );
}
