import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { GooglePlacesAutocomplete } from "@/components/common/GooglePlacesAutocomplete";

/**
 * Public Customer Onboarding form (the "Online QR" link customers fill).
 *
 * URL: /welcome/:business/:token  — no auth, token-protected on the
 * backend. Mobile-first, single-column, generous tap targets.
 *
 * We don't ship Google Places autocomplete in this PR — a clean
 * structured form already collects the data we need. The lat/lng
 * pickup over Places lands in a follow-up PR where we'll also add
 * the address pin map.
 */
export function CustomerOnboardingPublic() {
  const { business = "", token = "" } = useParams<{
    business: string;
    token: string;
  }>();

  const [stage, setStage] = useState<
    "loading" | "form" | "submitting" | "done" | "error"
  >("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    primary_phone: "",
    whatsapp_number: "",
    email: "",
    instagram_handle: "",
    preferred_channel: "" as "" | "whatsapp" | "instagram" | "email",
    dob_day: "",
    dob_month: "",
    delivery_line1: "",
    delivery_area: "",
    delivery_city: "Lagos",
    delivery_state: "Lagos",
    delivery_country: "Nigeria",
    delivery_country_code: "NG",
    delivery_postal_code: "",
    delivery_landmark: "",
    delivery_latitude: undefined as number | undefined,
    delivery_longitude: undefined as number | undefined,
    delivery_google_maps_url: "",
    billing_same_as_delivery: true,
    billing_line1: "",
    billing_city: "Lagos",
    billing_state: "Lagos",
    notes: "",
  });
  const [internationalAddress, setInternationalAddress] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{
          business: string;
          seed: Record<string, unknown>;
        }>(`/onboarding/${token}`, "public");
        if (cancelled) return;
        // Pre-fill known fields
        setForm((f) => ({
          ...f,
          first_name: String(data.seed?.first_name ?? f.first_name),
          last_name: String(data.seed?.last_name ?? f.last_name),
          primary_phone: String(data.seed?.primary_phone ?? f.primary_phone),
          whatsapp_number: String(
            data.seed?.whatsapp_number ?? f.whatsapp_number,
          ),
          email: String(data.seed?.email ?? f.email),
          instagram_handle: String(
            data.seed?.instagram_handle ?? f.instagram_handle,
          ),
        }));
        setStage("form");
      } catch (e: unknown) {
        if (cancelled) return;
        setErrMsg(
          e instanceof Error ? e.message : "We couldn't load this form.",
        );
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const canSubmit = useMemo(() => {
    return (
      !!form.first_name &&
      !!form.delivery_line1 &&
      !!(
        form.primary_phone ||
        form.whatsapp_number ||
        form.email ||
        form.instagram_handle
      )
    );
  }, [form]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStage("submitting");
    setErrMsg(null);
    try {
      const payload: Record<string, unknown> = {
        first_name: form.first_name,
        last_name: form.last_name || undefined,
        primary_phone: form.primary_phone || undefined,
        whatsapp_number: form.whatsapp_number || undefined,
        email: form.email || undefined,
        instagram_handle: form.instagram_handle || undefined,
        preferred_channel: form.preferred_channel || undefined,
        dob_day: form.dob_day ? Number(form.dob_day) : undefined,
        dob_month: form.dob_month ? Number(form.dob_month) : undefined,
        delivery_address: {
          line1: form.delivery_line1,
          area: form.delivery_area || undefined,
          city: form.delivery_city || "Lagos",
          state: form.delivery_state || "Lagos",
          country: form.delivery_country || "Nigeria",
          country_code: form.delivery_country_code || "NG",
          postal_code: form.delivery_postal_code || undefined,
          landmark: form.delivery_landmark || undefined,
          latitude: form.delivery_latitude,
          longitude: form.delivery_longitude,
          google_maps_url: form.delivery_google_maps_url || undefined,
        },
        billing_same_as_delivery: form.billing_same_as_delivery,
        billing_address: form.billing_same_as_delivery
          ? undefined
          : {
              line1: form.billing_line1,
              city: form.billing_city || "Lagos",
              state: form.billing_state || "Lagos",
              country: "Nigeria",
              country_code: "NG",
            },
        notes: form.notes || undefined,
      };
      await api.post(`/onboarding/${token}`, payload, "public");
      setStage("done");
    } catch (e: unknown) {
      setErrMsg(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
      setStage("form");
    }
  }

  if (stage === "loading") {
    return (
      <Shell business={business}>
        <div className="grid place-items-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-accent-glow" />
        </div>
      </Shell>
    );
  }
  if (stage === "error") {
    return (
      <Shell business={business}>
        <div className="text-center py-12">
          <AlertCircle className="w-8 h-8 mx-auto mb-3 text-danger" />
          <p className="text-[14px] font-medium">
            Sorry — link no longer works.
          </p>
          <p className="text-[12.5px] text-text-muted mt-1">
            {errMsg ?? "Please ask us for a fresh link."}
          </p>
        </div>
      </Shell>
    );
  }
  if (stage === "done") {
    return (
      <Shell business={business}>
        <div className="text-center py-12">
          <CheckCircle2 className="w-9 h-9 mx-auto mb-3 text-green-400" />
          <p className="font-display text-[20px] mb-1">Thank you 🌹</p>
          <p className="text-[13px] text-text-muted max-w-[360px] mx-auto">
            We have your details. We&rsquo;ll reach out shortly — and your
            delivery is now mapped to the address you gave.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell business={business}>
      <form onSubmit={submit} className="space-y-5">
        <p className="text-[13px] text-text-muted leading-relaxed">
          One quick form so we can deliver to you exactly the way you want.
          Takes about 60 seconds.
        </p>

        <Section title="Your name">
          <Row>
            <Field
              label="First name"
              required
              value={form.first_name}
              onChange={(v) => setForm({ ...form, first_name: v })}
            />
            <Field
              label="Last name"
              value={form.last_name}
              onChange={(v) => setForm({ ...form, last_name: v })}
            />
          </Row>
        </Section>

        <Section title="How can we reach you?">
          <p className="text-[11.5px] text-text-faint -mt-2 mb-2">
            Any one of these works. We&rsquo;ll use your preferred channel
            below.
          </p>
          <Row>
            <Field
              label="WhatsApp number"
              type="tel"
              value={form.whatsapp_number}
              onChange={(v) => setForm({ ...form, whatsapp_number: v })}
              placeholder="+234…"
            />
            <Field
              label="Phone"
              type="tel"
              value={form.primary_phone}
              onChange={(v) => setForm({ ...form, primary_phone: v })}
              placeholder="+234…"
            />
          </Row>
          <Row>
            <Field
              label="Email"
              type="email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
            />
            <Field
              label="Instagram handle"
              value={form.instagram_handle}
              onChange={(v) =>
                setForm({ ...form, instagram_handle: v.replace(/^@/, "") })
              }
              placeholder="username"
            />
          </Row>
          <div className="grid grid-cols-1">
            <Select
              label="Preferred channel"
              value={form.preferred_channel}
              onChange={(v) =>
                setForm({
                  ...form,
                  preferred_channel: v as typeof form.preferred_channel,
                })
              }
              options={[
                { value: "", label: "No preference" },
                { value: "email", label: "Email" },
                { value: "instagram", label: "Instagram DM" },
                { value: "whatsapp", label: "WhatsApp" },
              ]}
            />
          </div>
        </Section>

        <Section title="Birthday (optional)">
          <p className="text-[11.5px] text-text-faint -mt-2 mb-2">
            We&rsquo;ll send you a little something. No year needed.
          </p>
          <Row>
            <Select
              label="Day"
              value={form.dob_day}
              onChange={(v) => setForm({ ...form, dob_day: v })}
              options={[
                { value: "", label: "Day" },
                ...Array.from({ length: 31 }, (_, i) => ({
                  value: String(i + 1),
                  label: String(i + 1),
                })),
              ]}
            />
            <Select
              label="Month"
              value={form.dob_month}
              onChange={(v) => setForm({ ...form, dob_month: v })}
              options={[
                { value: "", label: "Month" },
                ...[
                  "Jan",
                  "Feb",
                  "Mar",
                  "Apr",
                  "May",
                  "Jun",
                  "Jul",
                  "Aug",
                  "Sep",
                  "Oct",
                  "Nov",
                  "Dec",
                ].map((m, i) => ({ value: String(i + 1), label: m })),
              ]}
            />
          </Row>
        </Section>

        <Section title="Delivery address">
          <GooglePlacesAutocomplete
            label="Search your address"
            required
            countryRestriction={internationalAddress ? null : "ng"}
            initial={{
              line1: form.delivery_line1,
              latitude: form.delivery_latitude,
              longitude: form.delivery_longitude,
              formatted_address: [
                form.delivery_line1,
                form.delivery_area,
                form.delivery_city,
                form.delivery_state,
              ]
                .filter(Boolean)
                .join(", "),
            }}
            onChange={(p) =>
              setForm((f) => ({
                ...f,
                // Defensive merge: a manually-typed address sends only line1
                // (empty siblings), so keep the existing values rather than
                // wiping city/state/area on every keystroke.
                delivery_line1: p.line1 || f.delivery_line1,
                delivery_area: p.area || f.delivery_area,
                delivery_city: p.city || f.delivery_city,
                delivery_state: p.state || f.delivery_state,
                delivery_country: p.country || f.delivery_country,
                delivery_country_code:
                  p.country_code || f.delivery_country_code,
                delivery_postal_code: p.postal_code || f.delivery_postal_code,
                delivery_latitude: p.latitude ?? f.delivery_latitude,
                delivery_longitude: p.longitude ?? f.delivery_longitude,
                delivery_google_maps_url:
                  p.google_maps_url || f.delivery_google_maps_url,
              }))
            }
          />
          <label className="flex items-center gap-2 text-[12px] text-text-muted">
            <input
              type="checkbox"
              checked={internationalAddress}
              onChange={(e) => setInternationalAddress(e.target.checked)}
              className="rounded accent-accent"
            />
            Delivering outside Nigeria
          </label>
          <Field
            label="Apartment / floor / extra detail (optional)"
            value={form.delivery_area}
            onChange={(v) => setForm({ ...form, delivery_area: v })}
            placeholder="e.g. Block C, Flat 5"
          />
          <Field
            label="Landmark (helps the rider find you)"
            value={form.delivery_landmark}
            onChange={(v) => setForm({ ...form, delivery_landmark: v })}
          />
        </Section>

        <Section title="Billing address">
          <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
            <input
              type="checkbox"
              checked={form.billing_same_as_delivery}
              onChange={(e) =>
                setForm({
                  ...form,
                  billing_same_as_delivery: e.target.checked,
                })
              }
              className="rounded accent-accent"
            />
            Same as delivery address
          </label>
          {!form.billing_same_as_delivery && (
            <div className="mt-3 space-y-2">
              <Field
                label="Street / house"
                value={form.billing_line1}
                onChange={(v) => setForm({ ...form, billing_line1: v })}
              />
              <Row>
                <Field
                  label="City"
                  value={form.billing_city}
                  onChange={(v) => setForm({ ...form, billing_city: v })}
                />
                <Field
                  label="State"
                  value={form.billing_state}
                  onChange={(v) => setForm({ ...form, billing_state: v })}
                />
              </Row>
            </div>
          )}
        </Section>

        <Section title="Anything we should know?">
          <Field
            label="Notes (optional)"
            value={form.notes}
            onChange={(v) => setForm({ ...form, notes: v })}
            placeholder="Inspiration, sizing, allergies, special requests…"
            textarea
          />
        </Section>

        {errMsg && (
          <p className="text-[12px] text-danger flex items-center gap-2">
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
            "Submit"
          )}
        </button>

        <p className="text-[11px] text-text-faint text-center">
          Your details are saved to your customer profile only. Used to fulfil
          your orders.
        </p>
      </form>
    </Shell>
  );
}

// ── Layout shell ──────────────────────────────────────────

function Shell({
  business,
  children,
}: {
  business: string;
  children: React.ReactNode;
}) {
  const brandName =
    business === "faitlynhair"
      ? "Faitlyn"
      : business === "pixiegirl"
        ? "Pixie Girl"
        : "Welcome";
  return (
    // h-[100dvh] + own scroll: the app pins `body { overflow:hidden }` for the
    // authenticated shell, so this standalone public page must scroll itself or
    // tall content (and the submit button) is unreachable on a phone.
    <div className="h-[100dvh] overflow-y-auto overscroll-contain bg-bg text-text-primary px-4 py-6 sm:px-6 sm:py-10">
      <div className="max-w-[520px] mx-auto">
        <div className="flex items-center gap-2 mb-5">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-accent text-bg font-display text-[18px]">
            {brandName[0]}
          </div>
          <div>
            <p className="font-display text-[18px] leading-none">{brandName}</p>
            <p className="text-[11.5px] text-text-faint">
              Welcome — let&rsquo;s get you set up
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
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  textarea?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </span>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
        />
      )}
    </label>
  );
}

function Select({
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
        className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
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
