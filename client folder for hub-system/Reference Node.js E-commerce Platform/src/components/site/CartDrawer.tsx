import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { BULK_TIERS, computeOrderTotals } from "@/lib/pricing";
import { Price } from "./Price";
import { useCurrency, settlementCurrency } from "@/lib/currency";
import { getProduct } from "@/lib/products";

type Step = "bag" | "details" | "review";
type Fulfillment = "delivery" | "pickup";

// Recipient name: letters, spaces, hyphens, apostrophes, dots (international friendly).
const NAME_RE = /^[\p{L}][\p{L}\s'.\-]{1,119}$/u;
// Phone: optional +, digits, spaces, dashes, parens — must contain at least 7 digits.
const PHONE_RE = /^[+\d][\d\s().\-]{5,38}$/;

function formatPhone(raw: string): string {
  // Strip anything that's not + or digit/space/().-
  return raw.replace(/[^\d+()\-.\s]/g, "").replace(/\s{2,}/g, " ").slice(0, 40);
}
function formatName(raw: string): string {
  return raw.replace(/[^\p{L}\s'.\-]/gu, "").replace(/\s{2,}/g, " ").slice(0, 120);
}
function digitsOf(s: string) { return (s.match(/\d/g) ?? []).length; }

const addressSchema = z.object({
  recipient_name: z.string().trim().regex(NAME_RE, "Enter a valid recipient name").max(120),
  recipient_phone: z.string().trim().regex(PHONE_RE, "Enter a valid phone with country code").max(40)
    .refine((v) => digitsOf(v) >= 7, "Phone needs at least 7 digits"),
  email: z.string().trim().email("Valid email required").max(255),
  line1: z.string().trim().min(2, "Address required").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "City required").max(120),
  region: z.string().trim().max(120).optional(),
  postal: z.string().trim().max(40).optional(),
  country: z.string().trim().min(2, "Country required").max(120),
  notes: z.string().trim().max(2000).optional(),
});

const pickupSchema = z.object({
  recipient_name: z.string().trim().regex(NAME_RE, "Enter a valid recipient name").max(120),
  recipient_phone: z.string().trim().regex(PHONE_RE, "Enter a valid phone").max(40)
    .refine((v) => digitsOf(v) >= 7, "Phone needs at least 7 digits"),
  email: z.string().trim().email().max(255),
  notes: z.string().trim().max(2000).optional(),
});

export function CartDrawer() {
  const { lines, open, setOpen, update, remove, clear } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("bag");
  const [fulfillment, setFulfillment] = useState<Fulfillment>("delivery");

  // Recipient + address
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [email, setEmail] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postal, setPostal] = useState("");
  const [country, setCountry] = useState("");
  const [notes, setNotes] = useState("");

  // Inline auth
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);

  // Reset step + prefill when opening / when user changes
  useEffect(() => {
    if (!open) return;
    setStep("bag");
  }, [open]);

  useEffect(() => {
    if (user?.email) setEmail((e) => e || user.email!);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle().then(({ data }) => {
      if (data?.full_name && !recipientName) setRecipientName(data.full_name);
      if (data?.phone && !recipientPhone) setRecipientPhone(data.phone);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const totals = useMemo(
    () => computeOrderTotals(lines, fulfillment === "pickup" ? "Nigeria" : country),
    [lines, country, fulfillment],
  );
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const nextTier = BULK_TIERS.find((t) => totalQty < t.qty);
  const loyaltyPoints = Math.floor(totals.total); // display-only: 1pt per $1 after discount

  // Contact Picker progressive enhancement
  const contactPickerSupported = typeof window !== "undefined" && "contacts" in navigator && "ContactsManager" in window;

  async function pickFromContacts() {
    try {
      // @ts-expect-error — Contact Picker API is not in lib.dom yet
      const picked = await navigator.contacts.select(["name", "tel"], { multiple: false });
      const c = picked?.[0];
      if (!c) return;
      const name = (c.name?.[0] ?? "").trim();
      const tel = (c.tel?.[0] ?? "").trim();
      if (name) setRecipientName(name);
      if (tel) setRecipientPhone(tel);
      toast.success("Recipient pulled from contacts");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't access contacts");
    }
  }

  function shipToMyself() {
    if (!user) {
      toast("Sign in first to pull your saved details", { description: "Or just type — it's quick." });
      return;
    }
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).maybeSingle().then(({ data }) => {
      if (data?.full_name) setRecipientName(data.full_name);
      if (data?.phone) setRecipientPhone(data.phone);
      if (user.email) setEmail(user.email);
    });
  }

  function close() {
    setOpen(false);
  }

  async function inlineAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!email || pw.length < 8) {
      return toast.error("Email + 8-char password");
    }
    setBusy(true);
    try {
      if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password: pw,
          options: {
            emailRedirectTo: `${window.location.origin}/account`,
            data: { full_name: recipientName || null },
          },
        });
        if (error) throw error;
        toast.success("Welcome to Faitlyn");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      }
      setPw("");
    } catch (err: any) {
      toast.error(err?.message ?? "Auth failed");
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder() {
    if (!user) return toast.error("Sign in to confirm the order");
    if (lines.length === 0) return toast.error("Your bag is empty");

    const baseShape = fulfillment === "pickup"
      ? pickupSchema.safeParse({ recipient_name: recipientName, recipient_phone: recipientPhone, email, notes })
      : addressSchema.safeParse({
          recipient_name: recipientName, recipient_phone: recipientPhone, email,
          line1, line2, city, region, postal, country, notes,
        });
    if (!baseShape.success) return toast.error(baseShape.error.issues[0].message);

    const shipping =
      fulfillment === "pickup"
        ? { fulfillment: "pickup", recipient: recipientName, recipient_phone: recipientPhone, country: "Nigeria" }
        : {
            fulfillment: "delivery",
            recipient: recipientName,
            recipient_phone: recipientPhone,
            line1, line2, city, region, postal_code: postal, country,
          };

    setBusy(true);
    const { data, error } = await supabase
      .from("orders")
      .insert({
        user_id: user.id,
        status: "inquiry",
        subtotal: totals.subtotal,
        total: totals.total,
        items: lines.map((l) => ({
          slug: l.slug, name: l.name, variant: l.variant, qty: l.qty, price: l.price, image: l.image,
        })),
        shipping_address: shipping,
        contact_email: email,
        contact_phone: recipientPhone,
        preferred_contact: "email",
        concierge_notes: notes || null,
        notes: recipientName,
      })
      .select("id, order_number")
      .single();
    setBusy(false);

    if (error || !data) return toast.error(error?.message ?? "Could not place order");
    clear();
    setOpen(false);
    toast.success(`Order placed · ${loyaltyPoints} loyalty points pending`);
    navigate({ to: "/order/$id", params: { id: data.id } });
  }

  // ----- UI -----
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="bg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
            className="fixed inset-0 bg-ink/70 backdrop-blur-sm z-[80]"
          />
          <motion.aside
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-ink border-l border-taupe/20 z-[90] flex flex-col"
          >
            <DrawerHeader step={step} onBack={() => setStep(step === "review" ? "details" : step === "details" ? "bag" : "bag")} onClose={close} />

            <div className="flex-1 overflow-y-auto">
              {step === "bag" && (
                <BagStep lines={lines} update={update} remove={remove} />
              )}
              {step === "details" && (
                <DetailsStep
                  fulfillment={fulfillment} setFulfillment={setFulfillment}
                  contactPickerSupported={contactPickerSupported}
                  onPickContact={pickFromContacts} onShipToSelf={shipToMyself}
                  recipientName={recipientName} setRecipientName={setRecipientName}
                  recipientPhone={recipientPhone} setRecipientPhone={setRecipientPhone}
                  email={email} setEmail={setEmail}
                  line1={line1} setLine1={setLine1}
                  line2={line2} setLine2={setLine2}
                  city={city} setCity={setCity}
                  region={region} setRegion={setRegion}
                  postal={postal} setPostal={setPostal}
                  country={country} setCountry={setCountry}
                  notes={notes} setNotes={setNotes}
                  signedIn={!!user}
                />
              )}
              {step === "review" && (
                <ReviewStep
                  totals={totals} lines={lines} fulfillment={fulfillment}
                  recipientName={recipientName} recipientPhone={recipientPhone}
                  line1={line1} city={city} country={country} email={email}
                  loyaltyPoints={loyaltyPoints}
                  user={user}
                  authMode={authMode} setAuthMode={setAuthMode}
                  pw={pw} setPw={setPw} busy={busy} onAuth={inlineAuth}
                />
              )}
            </div>

            <Footer
              step={step} setStep={setStep}
              totals={totals} totalQty={totalQty} nextTier={nextTier}
              lines={lines} country={country} fulfillment={fulfillment}
              user={user} busy={busy} onPlace={placeOrder}
              onContinueShopping={() => { setOpen(false); navigate({ to: "/shop" }); }}
            />

          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ============ Sub-components ============

function DrawerHeader({ step, onBack, onClose }: { step: Step; onBack: () => void; onClose: () => void }) {
  const titles: Record<Step, string> = { bag: "Your bag", details: "Delivery", review: "Review & confirm" };
  return (
    <header className="flex items-center justify-between p-6 border-b border-taupe/15">
      <div className="flex items-center gap-3">
        {step !== "bag" && (
          <button onClick={onBack} className="text-taupe text-[0.6rem] tracking-[0.3em] uppercase hover:text-cream">← Back</button>
        )}
        <h2 className="font-display text-2xl">{titles[step]}</h2>
      </div>
      <button onClick={onClose} className="text-taupe text-xs tracking-[0.3em] uppercase hover:text-cream">Close</button>
    </header>
  );
}

function BagStep({ lines, update, remove }: { lines: ReturnType<typeof useCart>["lines"]; update: ReturnType<typeof useCart>["update"]; remove: ReturnType<typeof useCart>["remove"] }) {
  return (
    <div className="p-6 space-y-6">
      {lines.length === 0 && (
        <p className="text-center text-muted-foreground text-sm py-20">Your bag is empty.</p>
      )}
      {lines.map((l) => (
        <div key={l.id} className="flex gap-4">
          <img src={l.image} alt={l.name} className="w-20 h-24 object-cover bg-card" />
          <div className="flex-1 flex flex-col">
            <div className="flex justify-between gap-2">
              <h3 className="font-display text-lg leading-tight">{l.name}</h3>
              <Price usd={l.price * l.qty} slug={l.slug} qty={l.qty} className="text-sm text-taupe" />
            </div>
            <p className="text-[0.65rem] tracking-[0.2em] uppercase text-muted-foreground mt-1">{l.variant}</p>
            <div className="mt-auto flex items-center justify-between">
              <div className="flex items-center border border-taupe/30">
                <button onClick={() => update(l.id, l.qty - 1)} className="px-3 py-1 hover:bg-taupe/10">−</button>
                <span className="px-3 text-sm">{l.qty}</span>
                <button onClick={() => update(l.id, l.qty + 1)} className="px-3 py-1 hover:bg-taupe/10">+</button>
              </div>
              <button onClick={() => remove(l.id)} className="text-[0.6rem] tracking-[0.3em] uppercase text-muted-foreground hover:text-cream">Remove</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailsStep(props: {
  fulfillment: Fulfillment; setFulfillment: (v: Fulfillment) => void;
  contactPickerSupported: boolean;
  onPickContact: () => void; onShipToSelf: () => void;
  recipientName: string; setRecipientName: (v: string) => void;
  recipientPhone: string; setRecipientPhone: (v: string) => void;
  email: string; setEmail: (v: string) => void;
  line1: string; setLine1: (v: string) => void;
  line2: string; setLine2: (v: string) => void;
  city: string; setCity: (v: string) => void;
  region: string; setRegion: (v: string) => void;
  postal: string; setPostal: (v: string) => void;
  country: string; setCountry: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  signedIn: boolean;
}) {
  const {
    fulfillment, setFulfillment, contactPickerSupported, onPickContact, onShipToSelf,
    recipientName, setRecipientName, recipientPhone, setRecipientPhone, email, setEmail,
    line1, setLine1, line2, setLine2, city, setCity, region, setRegion,
    postal, setPostal, country, setCountry, notes, setNotes, signedIn,
  } = props;

  return (
    <div className="p-6 space-y-7">
      {/* Fulfillment toggle */}
      <div>
        <Label>Fulfillment</Label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {(["delivery", "pickup"] as Fulfillment[]).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setFulfillment(opt)}
              className={`py-3 text-[0.6rem] tracking-[0.32em] uppercase border transition-colors ${
                fulfillment === opt ? "bg-taupe text-ink border-taupe" : "border-taupe/30 text-cream/80 hover:border-taupe"
              }`}
            >
              {opt === "delivery" ? "Ship to me" : "Pickup · Lagos"}
            </button>
          ))}
        </div>
        {fulfillment === "pickup" && (
          <p className="text-[0.6rem] tracking-[0.25em] uppercase text-taupe/70 mt-2">Concierge confirms studio appointment after order.</p>
        )}
      </div>

      {/* Recipient quick fill */}
      <div>
        <div className="flex items-center justify-between">
          <Label>Recipient</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onShipToSelf}
              className="text-[0.55rem] tracking-[0.3em] uppercase text-rose border-b border-rose/40 pb-0.5 hover:text-cream hover:border-cream/50"
            >
              {fulfillment === "pickup" ? "It's me" : "Ship to myself"}
            </button>
            {contactPickerSupported && (
              <button
                type="button"
                onClick={onPickContact}
                className="text-[0.55rem] tracking-[0.3em] uppercase text-rose border-b border-rose/40 pb-0.5 hover:text-cream hover:border-cream/50"
              >
                Pick from contacts
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 mt-3">
          <Input placeholder="Full name" value={recipientName} onChange={(v) => setRecipientName(formatName(v))} maxLength={120} testid="recipient-name" />
          <Input placeholder="Phone — e.g. +234 802 555 0140" value={recipientPhone} onChange={(v) => setRecipientPhone(formatPhone(v))} maxLength={40} testid="recipient-phone" />
        </div>
        {!contactPickerSupported && (
          <p className="text-[0.55rem] tracking-[0.22em] uppercase text-cream/45 mt-2">
            Contact picker not available in this browser — type the recipient's details, or tap <span className="text-rose">Ship to myself</span> to use your saved profile. Picker works on Chrome / Edge on Android.
          </p>
        )}
      </div>

      {/* Email (also auth identifier) */}
      <div>
        <Label>Email {signedIn ? "" : "· we'll use this to sign you in"}</Label>
        <Input type="email" placeholder="you@email.com" value={email} onChange={setEmail} maxLength={255} />
      </div>

      {/* Address (delivery only) */}
      {fulfillment === "delivery" && (
        <div className="space-y-3">
          <Label>Shipping address</Label>
          <Input placeholder="Address line 1" value={line1} onChange={setLine1} maxLength={200} />
          <Input placeholder="Apartment / suite (optional)" value={line2} onChange={setLine2} maxLength={200} />
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="City" value={city} onChange={setCity} maxLength={120} />
            <Input placeholder="Region / state" value={region} onChange={setRegion} maxLength={120} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Postal code" value={postal} onChange={setPostal} maxLength={40} />
            <Input placeholder="Country" value={country} onChange={setCountry} maxLength={120} />
          </div>
        </div>
      )}

      <div>
        <Label>Notes for the concierge</Label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Custom length, colour match, event date…"
          className="mt-2 w-full bg-transparent border border-taupe/30 focus:border-taupe p-3 text-sm text-cream outline-none resize-none transition-colors"
        />
      </div>
    </div>
  );
}

function ReviewStep(props: {
  totals: ReturnType<typeof computeOrderTotals>;
  lines: ReturnType<typeof useCart>["lines"];
  fulfillment: Fulfillment;
  recipientName: string; recipientPhone: string;
  line1: string; city: string; country: string; email: string;
  loyaltyPoints: number;
  user: ReturnType<typeof useAuth>["user"];
  authMode: "signin" | "signup"; setAuthMode: (m: "signin" | "signup") => void;
  pw: string; setPw: (v: string) => void; busy: boolean;
  onAuth: (e: React.FormEvent) => void;
}) {
  const {
    totals, lines, fulfillment, recipientName, recipientPhone,
    line1, city, country, email, loyaltyPoints,
    user, authMode, setAuthMode, pw, setPw, busy, onAuth,
  } = props;

  const { currency } = useCurrency();
  const settleUsd = settlementCurrency(currency) === "USD";

  return (
    <div className="p-6 space-y-6">
      {/* Items */}
      <div className="space-y-3">
        {lines.map((l) => (
          <div key={l.id} className="flex justify-between text-xs">
            <span className="text-cream/80">{l.name} <span className="text-cream/40">× {l.qty}</span></span>
            <Price usd={l.price * l.qty} slug={l.slug} qty={l.qty} forceUsd={settleUsd} className="text-taupe" />
          </div>
        ))}
      </div>

      {/* Ship-to summary */}
      <div className="border-t border-taupe/15 pt-4">
        <p className="text-[0.55rem] tracking-[0.4em] uppercase text-taupe/70">{fulfillment === "pickup" ? "Pickup" : "Ship to"}</p>
        <p className="font-display text-lg mt-1">{recipientName || "—"}</p>
        <p className="text-cream/60 text-xs">{recipientPhone}</p>
        {fulfillment === "delivery" && (
          <p className="text-cream/60 text-xs mt-1">{line1}, {city}, {country}</p>
        )}
        {fulfillment === "pickup" && (
          <p className="text-cream/60 text-xs mt-1">Faitlyn Atelier · Lagos</p>
        )}
      </div>

      {/* Detailed shipping explanation */}
      <ShippingExplanation totals={totals} country={country} fulfillment={fulfillment} />

      {/* Loyalty preview */}
      <div className="border border-rose/30 bg-rose/5 p-4">
        <p className="text-[0.55rem] tracking-[0.4em] uppercase text-rose">Loyalty preview</p>
        <p className="font-display text-2xl mt-1">+{loyaltyPoints} points</p>
        <p className="text-[0.6rem] tracking-[0.22em] uppercase text-cream/55 mt-1">
          1 point per $1 · redeem against future couture pieces. Posted after the concierge confirms.
        </p>
      </div>

      {/* Payment method · routed by active currency */}
      <PaymentMethodBlock />


      {!user && (
        <form onSubmit={onAuth} className="border border-taupe/25 p-4 space-y-3 bg-ink/40">
          <div className="flex items-baseline justify-between">
            <p className="text-[0.6rem] tracking-[0.4em] uppercase text-cream">{authMode === "signin" ? "Sign in to confirm" : "Create your atelier"}</p>
            <button
              type="button"
              onClick={() => setAuthMode(authMode === "signin" ? "signup" : "signin")}
              className="text-[0.55rem] tracking-[0.32em] uppercase text-taupe/80 hover:text-cream"
            >
              {authMode === "signin" ? "New? Sign up" : "Have an account?"}
            </button>
          </div>
          <p className="text-[0.6rem] tracking-[0.22em] uppercase text-rose/90">Highly encouraged — track order, earn points, save addresses.</p>
          <Input type="email" placeholder="Email" value={email} onChange={() => {}} maxLength={255} disabled />
          <Input type="password" placeholder="Password (min 8)" value={pw} onChange={setPw} maxLength={72} />
          <button
            type="submit"
            disabled={busy}
            className="w-full py-3 bg-rose text-ink text-[0.65rem] tracking-[0.35em] uppercase hover:bg-cream transition-colors disabled:opacity-50"
          >
            {busy ? "…" : authMode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
      )}
    </div>
  );
}

/** Payment provider routing — Stripe for international currencies, Paystack + Nomba for NGN.
 *  UI selector only · real provider integration pending keys. */
function PaymentMethodBlock() {
  const { currency } = useCurrency();
  const settle = settlementCurrency(currency);
  const options =
    settle === "NGN"
      ? [
          { id: "paystack", label: "Paystack", note: "Card · Bank transfer · USSD" },
          { id: "nomba",    label: "Nomba",    note: "NOMBANK MFB · in-app + POS" },
        ]
      : [
          { id: "stripe", label: "Stripe", note: `Cards · Apple Pay · settled in USD` },
        ];

  return (
    <div className="border border-taupe/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[0.55rem] tracking-[0.4em] uppercase text-taupe/80">Payment</p>
        <span className="text-[0.55rem] tracking-[0.3em] uppercase text-cream/50">
          Settles in {settle}
        </span>
      </div>
      <div className="space-y-2">
        {options.map((o, i) => (
          <label key={o.id} className="flex items-start gap-3 border border-taupe/20 hover:border-taupe/50 transition-colors p-3 cursor-pointer">
            <input type="radio" name="pay" defaultChecked={i === 0} className="mt-1 accent-rose" />
            <div className="flex-1">
              <p className="text-sm text-cream">{o.label}</p>
              <p className="text-[0.6rem] tracking-[0.22em] uppercase text-cream/55 mt-0.5">{o.note}</p>
            </div>
            <span className="text-[0.5rem] tracking-[0.3em] uppercase text-rose/80 self-center">Coming soon</span>
          </label>
        ))}
      </div>
      {settle === "USD" && currency !== "USD" && (
        <p className="text-[0.55rem] tracking-[0.22em] uppercase text-cream/45">
          Displayed in {currency} on the site · charged in USD at checkout.
        </p>
      )}
    </div>
  );
}


function ShippingExplanation({
  totals, country, fulfillment,
}: { totals: ReturnType<typeof computeOrderTotals>; country: string; fulfillment: Fulfillment }) {
  const isNigeria = (country.trim().toLowerCase() === "nigeria") || fulfillment === "pickup";
  const region = isNigeria ? "Nigeria" : country.trim() || "international";
  const threshold = totals.shippingThreshold;

  let line: string;
  if (fulfillment === "pickup") {
    line = `Studio pickup in Lagos · no shipping charge.`;
  } else if (!country.trim()) {
    line = `Enter a country to confirm shipping. Free over $${threshold} worldwide · $1000 within Nigeria.`;
  } else if (totals.freeShipping) {
    line = `Your order qualifies for complimentary shipping to ${region} — over the $${threshold} threshold.`;
  } else {
    line = `Add $${totals.amountToFreeShipping} more to unlock complimentary shipping to ${region} (free over $${threshold}).`;
  }

  return (
    <div className="border border-taupe/20 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[0.55rem] tracking-[0.4em] uppercase text-taupe/70">Shipping</p>
        <span className={`text-xs ${totals.freeShipping || fulfillment === "pickup" ? "text-rose" : "text-cream/70"}`}>
          {fulfillment === "pickup" ? "Studio pickup" : totals.freeShipping ? "Complimentary" : "Calculated by concierge"}
        </span>
      </div>
      <p className="text-[0.7rem] leading-relaxed text-cream/70">{line}</p>
      {fulfillment === "delivery" && (
        <p className="text-[0.55rem] tracking-[0.22em] uppercase text-cream/40">
          Thresholds · Nigeria $1000 · Worldwide $2000
        </p>
      )}
    </div>
  );
}

function Footer({
  step, setStep, totals, totalQty, nextTier, lines, country, fulfillment, user, busy, onPlace, onContinueShopping,
}: {
  step: Step; setStep: (s: Step) => void;
  totals: ReturnType<typeof computeOrderTotals>;
  totalQty: number; nextTier: typeof BULK_TIERS[number] | undefined;
  lines: ReturnType<typeof useCart>["lines"];
  country: string; fulfillment: Fulfillment;
  user: ReturnType<typeof useAuth>["user"]; busy: boolean; onPlace: () => void;
  onContinueShopping: () => void;
}) {
  const { currency, format } = useCurrency();
  const settleUsd = settlementCurrency(currency) === "USD";
  // Force USD at review step for international customers; bag step shows their currency.
  const reviewForceUsd = step === "review" && settleUsd;

  // NGN total uses hand-set per-product NGN prices (sum × qty), keeping Naira pricing
  // independent of live FX. International totals use catalog USD × FX rate.
  const ngnSubtotal = lines.reduce((s, l) => {
    const p = getProduct(l.slug);
    return s + (p?.priceNgn ?? 0) * l.qty;
  }, 0);
  const ngnTotal = Math.max(0, ngnSubtotal - totals.bulkDiscount * 1650); // approximate bulk discount in NGN

  const fmtMoney = (usd: number, ngnOverride?: number) =>
    reviewForceUsd ? format(usd, { forceUsd: true }) : format(usd, { ngnOverride });

  const avgItem = totalQty > 0 ? totals.subtotal / totalQty : 0;
  const nearFreeShipping =
    fulfillment === "delivery" &&
    totalQty > 0 &&
    !totals.freeShipping &&
    totals.amountToFreeShipping > 0 &&
    totals.amountToFreeShipping <= Math.max(avgItem * 1.2, 250);

  return (
    <footer className="p-6 border-t border-taupe/15 space-y-3">
      {nextTier && lines.length > 0 && (
        <button
          type="button"
          onClick={onContinueShopping}
          data-testid="bulk-savings-link"
          className="block w-full text-left text-[0.6rem] tracking-[0.28em] uppercase text-rose underline-offset-4 hover:underline hover:text-cream transition-colors"
        >
          + Add {nextTier.qty - totalQty} more · save ${nextTier.discount} — browse the edit →
        </button>
      )}
      {nearFreeShipping && (
        <button
          type="button"
          onClick={onContinueShopping}
          data-testid="free-shipping-link"
          className="block w-full text-left text-[0.6rem] tracking-[0.28em] uppercase text-rose underline-offset-4 hover:underline hover:text-cream transition-colors"
        >
          + Just ${totals.amountToFreeShipping} from complimentary shipping — add one more piece →
        </button>
      )}
      <div className="flex justify-between text-xs text-cream/70">
        <span className="tracking-[0.25em] uppercase">Subtotal</span>
        <span>{fmtMoney(totals.subtotal, ngnSubtotal)}</span>
      </div>
      {totals.bulkDiscount > 0 && (
        <div className="flex justify-between text-xs">
          <span className="tracking-[0.25em] uppercase text-cream/70">Bulk savings</span>
          <span className="text-rose">− {fmtMoney(totals.bulkDiscount)}</span>
        </div>
      )}
      <div className="flex justify-between text-xs">
        <span className="tracking-[0.25em] uppercase text-cream/70">Shipping</span>
        <span className={totals.freeShipping || fulfillment === "pickup" ? "text-rose" : "text-cream/70"}>
          {fulfillment === "pickup"
            ? "Pickup"
            : totals.freeShipping
              ? "Complimentary"
              : country.trim()
                ? `+ ${fmtMoney(totals.amountToFreeShipping)} to free`
                : `Free over $${totals.shippingThreshold}`}
        </span>
      </div>
      <div className="flex justify-between items-end pt-2 border-t border-taupe/10">
        <span className="tracking-[0.3em] uppercase text-taupe text-xs">Total</span>
        <span className="font-display text-2xl">{fmtMoney(totals.total, ngnTotal)}</span>
      </div>

      {step === "bag" && (
        <button
          disabled={lines.length === 0}
          onClick={() => setStep("details")}
          data-testid="drawer-continue"
          className="w-full py-4 bg-taupe text-ink text-[0.7rem] tracking-[0.4em] uppercase disabled:opacity-40 hover:bg-cream transition-colors"
        >
          Continue
        </button>
      )}
      {step === "details" && (
        <button
          onClick={() => setStep("review")}
          data-testid="drawer-review"
          className="w-full py-4 bg-taupe text-ink text-[0.7rem] tracking-[0.4em] uppercase hover:bg-cream transition-colors"
        >
          Review order
        </button>
      )}
      {step === "review" && (
        <button
          disabled={busy || !user}
          onClick={onPlace}
          data-testid="drawer-place"
          className="w-full py-4 bg-rose text-ink text-[0.7rem] tracking-[0.4em] uppercase hover:bg-cream transition-colors disabled:opacity-40"
        >
          {busy ? "Placing…" : user ? "Place order" : "Sign in above to confirm"}
        </button>
      )}
      <p className="text-[0.55rem] tracking-[0.25em] uppercase text-muted-foreground text-center">
        No card charged · concierge confirms within 24 hours
      </p>
    </footer>
  );
}

// ============ tiny inputs ============
function Label({ children }: { children: React.ReactNode }) {
  return <span className="block text-[0.6rem] tracking-[0.4em] uppercase text-taupe/80">{children}</span>;
}
function Input({
  value, onChange, placeholder, type = "text", maxLength, disabled, testid,
}: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; maxLength?: number; disabled?: boolean; testid?: string }) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      disabled={disabled}
      data-testid={testid}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-transparent border border-taupe/30 focus:border-taupe px-3 py-2 text-sm text-cream placeholder:text-cream/35 outline-none transition-colors disabled:opacity-60"
    />
  );
}
