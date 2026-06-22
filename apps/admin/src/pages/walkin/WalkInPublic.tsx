import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, Store } from "lucide-react";
import { api } from "@/lib/api";
import {
  AddressAutocomplete,
  type PlaceAddress,
} from "@/components/ui/AddressAutocomplete";
import { usePublicBrand } from "@/lib/public-brand";

/**
 * Public Walk-in Registration form.
 *
 * URL: /walkin/:brand  — no auth. A walk-in customer scans the counter QR,
 * lands here, and self-registers in ~30 seconds: name, a way to reach them
 * (phone or email — at least one), an optional birthday, and their delivery
 * address captured via Google Places (so dispatch has real lat/lng).
 *
 * Mirrors the Online-QR onboarding form's mobile-first shell; posts to the
 * public endpoint POST /api/public/walk-in (IP-throttled, de-dupes on
 * phone/email). It's a standing counter link, so the success screen offers
 * "Register another" for the next customer.
 */

const BRAND_NAMES: Record<string, string> = {
  pixiegirl: "Pixie Girl",
  faitlynhair: "Faitlyn Hair",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const emptyAddress = {
  line1: "",
  area: "",
  city: "Lagos",
  state: "Lagos",
  country: "Nigeria",
  country_code: "NG",
  postal_code: "",
  google_maps_url: "",
  latitude: null as number | null,
  longitude: null as number | null,
};

type Address = typeof emptyAddress;

const blankForm = {
  first_name: "",
  last_name: "",
  primary_phone: "",
  whatsapp_number: "",
  email: "",
  dob_month: "",
  dob_day: "",
};

export function WalkInPublic() {
  const { brand = "" } = useParams<{ brand: string }>();
  const brandInfo = usePublicBrand(brand, BRAND_NAMES[brand] ?? titleCase(brand));
  const brandName = brandInfo.name ?? BRAND_NAMES[brand] ?? titleCase(brand);

  const [stage, setStage] = useState<"form" | "submitting" | "done">("form");
  const [form, setForm] = useState({ ...blankForm });
  const [address, setAddress] = useState<Address>({ ...emptyAddress });
  const [error, setError] = useState<string | null>(null);

  const reach = `${form.primary_phone}${form.email}`.trim();
  const canSubmit = useMemo(
    () => Boolean(form.first_name.trim() && reach && address.line1.trim()),
    [form.first_name, reach, address.line1],
  );

  const set = (k: keyof typeof blankForm, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Defensive merge: a full Places selection fills every field, while a GPS
  // capture sends only lat/lng — so empty siblings must never wipe what the
  // customer already typed.
  const onPlace = (p: PlaceAddress) =>
    setAddress((a) => ({
      ...a,
      line1: p.line1 || a.line1,
      area: p.area || a.area,
      city: p.city || a.city,
      state: p.state || a.state,
      country: p.country || a.country,
      country_code: p.country_code || a.country_code,
      postal_code: p.postal_code || a.postal_code,
      google_maps_url: p.google_maps_url || a.google_maps_url,
      latitude: p.latitude ?? a.latitude,
      longitude: p.longitude ?? a.longitude,
    }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || stage === "submitting") return;
    setStage("submitting");
    setError(null);
    try {
      await api.post(
        "/walk-in",
        {
          brand,
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim() || undefined,
          primary_phone: form.primary_phone.trim() || undefined,
          whatsapp_number: form.whatsapp_number.trim() || undefined,
          email: form.email.trim() || undefined,
          dob_month: form.dob_month ? Number(form.dob_month) : undefined,
          dob_day: form.dob_day ? Number(form.dob_day) : undefined,
          address: {
            line1: address.line1.trim(),
            area: address.area || undefined,
            city: address.city || undefined,
            state: address.state || undefined,
            country: address.country || undefined,
            country_code: address.country_code || undefined,
            postal_code: address.postal_code || undefined,
            google_maps_url: address.google_maps_url || undefined,
            latitude: address.latitude ?? undefined,
            longitude: address.longitude ?? undefined,
          },
        },
        "public",
      );
      setStage("done");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong — try again.",
      );
      setStage("form");
    }
  }

  function registerAnother() {
    setForm({ ...blankForm });
    setAddress({ ...emptyAddress });
    setError(null);
    setStage("form");
  }

  if (stage === "done") {
    return (
      <Shell
      brandName={brandName}
      logoUrl={brandInfo.logoUrl}
      styleVars={brandInfo.styleVars}
    >
        <div className="text-center py-10">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-green-400" />
          <p className="font-display text-[21px] mb-1">You&rsquo;re in 🌹</p>
          <p className="text-[13px] text-text-muted max-w-[360px] mx-auto">
            Thanks for registering with {brandName}. We&rsquo;ve saved your
            details and your delivery address.
          </p>
          <button
            onClick={registerAnother}
            className="mt-6 h-[42px] px-5 rounded-xl bg-panel-2 border hairline text-[13px] font-semibold hover:border-accent/40 transition-colors"
          >
            Register another person
          </button>
        </div>
      </Shell>
    );
  }

  const submitting = stage === "submitting";

  return (
    <Shell
      brandName={brandName}
      logoUrl={brandInfo.logoUrl}
      styleVars={brandInfo.styleVars}
    >
      <form onSubmit={submit} className="space-y-5">
        <p className="text-[13px] text-text-muted leading-relaxed">
          Welcome! Add your details so we can look after you — it takes about 30
          seconds.
        </p>

        <Section title="Your name">
          <Row>
            <Field
              label="First name"
              required
              value={form.first_name}
              onChange={(v) => set("first_name", v)}
            />
            <Field
              label="Last name"
              value={form.last_name}
              onChange={(v) => set("last_name", v)}
            />
          </Row>
        </Section>

        <Section title="How can we reach you?">
          <p className="text-[11.5px] text-text-faint -mt-1 mb-1">
            Give us at least a phone number or an email.
          </p>
          <Row>
            <Field
              label="Phone"
              type="tel"
              required
              value={form.primary_phone}
              onChange={(v) => set("primary_phone", v)}
              placeholder="+234…"
            />
            <Field
              label="WhatsApp (optional)"
              type="tel"
              value={form.whatsapp_number}
              onChange={(v) => set("whatsapp_number", v)}
              placeholder="+234…"
            />
          </Row>
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={(v) => set("email", v)}
            placeholder="you@example.com"
          />
        </Section>

        <Section title="Delivery address">
          <label className="block">
            <span className="block text-[11.5px] text-text-muted mb-1">
              Search your address<span className="text-danger ml-1">*</span>
            </span>
            <AddressAutocomplete
              value={address.line1}
              onChange={(v) => setAddress((a) => ({ ...a, line1: v }))}
              onPlaceSelected={onPlace}
              countryCode={address.country_code || "NG"}
              placeholder="Start typing your street, estate or landmark…"
              enableGps
            />
          </label>
          <Row>
            <Field
              label="Area"
              value={address.area}
              onChange={(v) => setAddress((a) => ({ ...a, area: v }))}
            />
            <Field
              label="City"
              value={address.city}
              onChange={(v) => setAddress((a) => ({ ...a, city: v }))}
            />
          </Row>
          <Row>
            <Field
              label="State"
              value={address.state}
              onChange={(v) => setAddress((a) => ({ ...a, state: v }))}
            />
            <Field
              label="Country"
              value={address.country}
              onChange={(v) => setAddress((a) => ({ ...a, country: v }))}
            />
          </Row>
        </Section>

        <Section title="Birthday (optional)">
          <p className="text-[11.5px] text-text-faint -mt-1 mb-1">
            We&rsquo;ll send you a little something each year.
          </p>
          <Row>
            <SelectField
              label="Month"
              value={form.dob_month}
              onChange={(v) => set("dob_month", v)}
              options={[
                { value: "", label: "—" },
                ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
              ]}
            />
            <SelectField
              label="Day"
              value={form.dob_day}
              onChange={(v) => set("dob_day", v)}
              options={[
                { value: "", label: "—" },
                ...Array.from({ length: 31 }, (_, i) => ({
                  value: String(i + 1),
                  label: String(i + 1),
                })),
              ]}
            />
          </Row>
        </Section>

        {error && <p className="text-[12.5px] text-danger">{error}</p>}

        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="w-full h-[46px] rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[14px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none hover:bg-accent transition-colors"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {submitting ? "Saving…" : "Add me"}
        </button>
        <p className="text-[10.5px] text-text-faint text-center">
          By submitting you agree to be contacted by {brandName}.
        </p>
      </form>
    </Shell>
  );
}

function titleCase(s: string) {
  return s
    ? s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Walk-in";
}

function Shell({
  brandName,
  logoUrl,
  styleVars,
  children,
}: {
  brandName: string;
  logoUrl?: string | null;
  styleVars?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    // h-[100dvh] + own scroll: the app pins `body { overflow:hidden }` for the
    // authenticated shell, so this standalone public page must scroll itself or
    // tall content (and the submit button) is unreachable on a phone.
    // styleVars re-tint --accent/--accent-deep to the real brand colour.
    <div
      style={styleVars}
      className="h-[100dvh] overflow-y-auto overscroll-contain bg-bg text-text-primary px-4 py-6 sm:px-6 sm:py-10"
    >
      <div className="max-w-[520px] mx-auto">
        <div className="flex items-center gap-2 mb-5">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-accent text-bg overflow-hidden">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={brandName}
                className="w-full h-full object-cover"
              />
            ) : (
              <Store className="w-5 h-5" />
            )}
          </div>
          <div>
            <p className="font-display text-[18px] leading-none">{brandName}</p>
            <p className="text-[11.5px] text-text-faint">
              Walk-in registration
            </p>
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
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40 [color-scheme:dark]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
