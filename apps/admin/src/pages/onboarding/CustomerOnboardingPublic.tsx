import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { api } from "@/lib/api";
import { PublicBrandShell } from "@/components/public/PublicBrandShell";
import { Collapsible } from "@/components/ui/Collapsible";
import { Toggle } from "@/components/ui/controls";
import {
  PhoneField,
  phoneToE164,
  DEFAULT_PHONE_VALUE,
  type PhoneValue,
} from "@/components/ui/PhoneField";
import {
  GeoapifyAddressSearch,
  type GeoAddress,
} from "@/components/common/GeoapifyAddressSearch";
import { searchOnboardingAddress } from "@/lib/onboarding-geo";

/**
 * Public Customer Onboarding form (the "Online QR" link customers fill).
 *
 * URL: /welcome/:business/:token  — no auth, token-protected on the
 * backend. Mobile-first, single-column, generous tap targets. Always
 * light mode (forced on PublicBrandShell) — a form filled on a stranger's
 * phone camera reads better on a light page than the app's dark default.
 */

/** Best-effort: a seeded phone string → a PhoneValue for the picker. */
function seedPhone(raw?: string): PhoneValue {
  if (!raw) return { ...DEFAULT_PHONE_VALUE };
  const parsed = parsePhoneNumberFromString(raw, "NG");
  if (parsed) {
    return { country: parsed.country ?? "NG", national: parsed.nationalNumber };
  }
  return { country: "NG", national: raw.replace(/[^\d]/g, "") };
}

export function CustomerOnboardingPublic() {
  const { business = "", token = "" } = useParams<{
    business: string;
    token: string;
  }>();

  const [stage, setStage] = useState<
    "loading" | "form" | "submitting" | "done" | "error"
  >("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [phone, setPhone] = useState<PhoneValue>(DEFAULT_PHONE_VALUE);
  const [sameAsPhoneForWhatsapp, setSameAsPhoneForWhatsapp] = useState(true);
  const [whatsapp, setWhatsapp] = useState<PhoneValue>(DEFAULT_PHONE_VALUE);
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    instagram_handle: "",
    preferred_channel: "" as "" | "whatsapp" | "instagram" | "email",
    dob_day: "",
    dob_month: "",
    special_events: "",
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
    notes: "",
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<{
          business: string;
          seed: Record<string, unknown>;
        }>(`/onboarding/${token}`, "public");
        if (cancelled) return;
        const seed = data.seed ?? {};
        setForm((f) => ({
          ...f,
          first_name: String(seed.first_name ?? f.first_name),
          last_name: String(seed.last_name ?? f.last_name),
          email: String(seed.email ?? f.email),
          instagram_handle: String(seed.instagram_handle ?? f.instagram_handle),
        }));
        if (seed.primary_phone) setPhone(seedPhone(String(seed.primary_phone)));
        if (seed.whatsapp_number && seed.whatsapp_number !== seed.primary_phone) {
          setSameAsPhoneForWhatsapp(false);
          setWhatsapp(seedPhone(String(seed.whatsapp_number)));
        }
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

  // A typed-but-invalid number blocks submit outright (rather than silently
  // going out as junk) — an empty field is just "not given," which is fine
  // as long as some other contact method covers it.
  const phoneE164 = phoneToE164(phone);
  const phoneTouched = phone.national.trim().length > 0;
  const phoneInvalid = phoneTouched && !phoneE164;
  const whatsappE164 = sameAsPhoneForWhatsapp ? phoneE164 : phoneToE164(whatsapp);
  const whatsappTouched =
    !sameAsPhoneForWhatsapp && whatsapp.national.trim().length > 0;
  const whatsappInvalid = whatsappTouched && !whatsappE164;
  const hasContactMethod = !!phoneE164 || !!whatsappE164 || !!form.email.trim();

  const canSubmit = useMemo(
    () =>
      !!form.first_name.trim() &&
      !!form.delivery_line1.trim() &&
      hasContactMethod &&
      !phoneInvalid &&
      !whatsappInvalid,
    [
      form.first_name,
      form.delivery_line1,
      hasContactMethod,
      phoneInvalid,
      whatsappInvalid,
    ],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setStage("submitting");
    setErrMsg(null);
    try {
      const combinedNotes = [
        form.special_events.trim() &&
          `Special occasions: ${form.special_events.trim()}`,
        form.notes.trim(),
      ]
        .filter(Boolean)
        .join("\n\n");
      const payload: Record<string, unknown> = {
        first_name: form.first_name,
        last_name: form.last_name || undefined,
        primary_phone: phoneE164 || undefined,
        whatsapp_number: whatsappE164 || undefined,
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
        },
        notes: combinedNotes || undefined,
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
      <form onSubmit={submit} className="space-y-4">
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
            At least a phone number or an email — we&rsquo;ll use your
            preferred channel below.
          </p>
          <PhoneField label="Phone number" value={phone} onChange={setPhone} />
          <Toggle
            checked={sameAsPhoneForWhatsapp}
            onChange={setSameAsPhoneForWhatsapp}
            label="This is my WhatsApp number too"
          />
          {!sameAsPhoneForWhatsapp && (
            <PhoneField
              label="WhatsApp number"
              value={whatsapp}
              onChange={setWhatsapp}
            />
          )}
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
        </Section>

        <Collapsible
          title="To better understand you"
          subtitle="Preferred channel, birthday, special occasions — all optional"
        >
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
          <div className="pt-2">
            <div className="text-[11px] uppercase tracking-widest text-text-faint mb-1">
              Birthday
            </div>
            <p className="text-[11.5px] text-text-faint mb-2">
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
          </div>
          <Field
            label="Special occasions (optional)"
            value={form.special_events}
            onChange={(v) => setForm({ ...form, special_events: v })}
            placeholder="An anniversary, a birthday to remember, anything else worth marking"
            textarea
          />
        </Collapsible>

        <Collapsible
          title="Delivery address"
          subtitle="So your order finds you"
          defaultOpen
        >
          <GeoapifyAddressSearch
            search={(text) => searchOnboardingAddress(token, text)}
            value={form.delivery_line1}
            onChange={(v) =>
              setForm((f) => ({ ...f, delivery_line1: v }))
            }
            onAddressSelected={(addr: GeoAddress) =>
              setForm((f) => ({
                ...f,
                delivery_line1: addr.line1 || f.delivery_line1,
                delivery_area: addr.area || f.delivery_area,
                delivery_city: addr.city || f.delivery_city,
                delivery_state: addr.state || f.delivery_state,
                delivery_country: addr.country || f.delivery_country,
                delivery_country_code:
                  addr.country_code || f.delivery_country_code,
                delivery_postal_code:
                  addr.postal_code || f.delivery_postal_code,
                delivery_latitude: addr.latitude ?? f.delivery_latitude,
                delivery_longitude: addr.longitude ?? f.delivery_longitude,
              }))
            }
          />
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
        </Collapsible>

        <Collapsible
          title="Anything we should know?"
          subtitle="Inspiration, sizing, allergies, special requests"
        >
          <Field
            label="Notes (optional)"
            value={form.notes}
            onChange={(v) => setForm({ ...form, notes: v })}
            placeholder="Inspiration, sizing, allergies, special requests…"
            textarea
          />
        </Collapsible>

        {errMsg && (
          <p className="text-[12px] text-danger flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" />
            {errMsg}
          </p>
        )}
        {form.first_name.trim() &&
          form.delivery_line1.trim() &&
          !hasContactMethod && (
            <p className="text-[12px] text-danger flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5" />
              Please add at least a phone number or an email so we can reach
              you.
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
  return (
    <PublicBrandShell
      brand={business}
      subtitle="Welcome — let's get you set up"
      maxWidth={520}
      forceTheme="light"
    >
      {children}
    </PublicBrandShell>
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
