import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { useCreateContact, useUpdateContact } from "./hooks";
import type { Contact, ContactType, PriorityLevel, ContactSource, ContactCreateInput } from "./types";

// ── Country dial codes (E.164 support) ─────────────────────────────────

export const DIAL_CODES = [
  { code: "NG", dial: "+234", flag: "🇳🇬", label: "Nigeria" },
  { code: "GH", dial: "+233", flag: "🇬🇭", label: "Ghana" },
  { code: "CM", dial: "+237", flag: "🇨🇲", label: "Cameroon" },
  { code: "GB", dial: "+44", flag: "🇬🇧", label: "United Kingdom" },
  { code: "US", dial: "+1", flag: "🇺🇸", label: "United States" },
  { code: "CA", dial: "+1", flag: "🇨🇦", label: "Canada" },
  { code: "ZA", dial: "+27", flag: "🇿🇦", label: "South Africa" },
  { code: "KE", dial: "+254", flag: "🇰🇪", label: "Kenya" },
  { code: "SN", dial: "+221", flag: "🇸🇳", label: "Senegal" },
  { code: "CI", dial: "+225", flag: "🇨🇮", label: "Côte d'Ivoire" },
  { code: "BJ", dial: "+229", flag: "🇧🇯", label: "Benin" },
  { code: "TG", dial: "+228", flag: "🇹🇬", label: "Togo" },
  { code: "FR", dial: "+33", flag: "🇫🇷", label: "France" },
  { code: "DE", dial: "+49", flag: "🇩🇪", label: "Germany" },
  { code: "AE", dial: "+971", flag: "🇦🇪", label: "UAE" },
  { code: "OTHER", dial: "+", flag: "🌍", label: "Other" },
] as const;

type DialCode = (typeof DIAL_CODES)[number];

/** Phone field with country dial code selector + raw number.
 *  Combines to E.164 on output: {dial}{number} */
function PhoneField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (e164: string) => void;
  placeholder?: string;
}) {
  // Parse existing value back to dial + number
  const parsedDial = DIAL_CODES.find((d) => value.startsWith(d.dial) && d.dial !== "+") ?? DIAL_CODES[0];
  const parsedNumber = parsedDial ? value.replace(parsedDial.dial, "") : value;

  const [selectedDial, setSelectedDial] = useState<DialCode>(parsedDial);
  const [rawNumber, setRawNumber] = useState(parsedNumber);

  const handleDialChange = (dialCode: string) => {
    const d = DIAL_CODES.find((c) => c.dial === dialCode) ?? DIAL_CODES[0];
    setSelectedDial(d);
    const stripped = rawNumber.replace(/\D/g, "");
    onChange(stripped ? `${d.dial}${stripped}` : "");
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d\s\-]/g, "");
    setRawNumber(raw);
    const stripped = raw.replace(/\D/g, "");
    onChange(stripped ? `${selectedDial.dial}${stripped}` : "");
  };

  return (
    <Field label={label}>
      <div className="flex gap-2">
        <select
          value={selectedDial.dial}
          onChange={(e) => handleDialChange(e.target.value)}
          className="h-[42px] px-2 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors flex-shrink-0"
          style={{ width: 90 }}
        >
          {DIAL_CODES.map((d) => (
            <option key={`${d.code}-${d.dial}`} value={d.dial}>
              {d.flag} {d.dial}
            </option>
          ))}
        </select>
        <TextInput
          className="flex-1"
          type="tel"
          inputMode="numeric"
          placeholder={placeholder ?? "e.g. 8020868273"}
          value={rawNumber}
          onChange={handleNumberChange}
        />
      </div>
      {rawNumber && (
        <p className="text-[10.5px] text-text-faint mt-1">
          Will be stored as: <span className="font-mono">{selectedDial.dial}{rawNumber.replace(/\D/g, "")}</span>
        </p>
      )}
    </Field>
  );
}

// ── Social-handle field ───────────────────────────────────────────────────
// Renders an '@' prefix and strips it on input + on store, so the canonical
// stored handle has no leading '@'. Matches the backend's contactCreate
// validator (preprocesses ""→undefined, regex ^@?[A-Za-z0-9._]{1,30}$).
function SocialHandleField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (handle: string) => void;
  placeholder?: string;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center h-[42px] rounded-[11px] bg-text-primary/[0.04] border border-line focus-within:border-accent/50 transition-colors">
        <span className="px-3 text-[13px] text-text-faint select-none">@</span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/^@+/, ""))}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none pr-3"
        />
      </div>
    </Field>
  );
}

// ── Multi-select chip component ──────────────────────────────────────────

function TypeChips({
  value,
  onChange,
}: {
  value: ContactType[];
  onChange: (v: ContactType[]) => void;
}) {
  const ALL: { key: ContactType; label: string }[] = [
    { key: "customer", label: "Customer" },
    { key: "supplier", label: "Supplier" },
    { key: "staff", label: "Staff" },
    { key: "retail_partner", label: "Retail Partner" },
    { key: "stylist_partner", label: "Stylist" },
  ];

  const toggle = (k: ContactType) => {
    onChange(value.includes(k) ? value.filter((v) => v !== k) : [...value, k]);
  };

  return (
    <Field label="Contact type *">
      <div className="flex flex-wrap gap-2">
        {ALL.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            className={[
              "px-3 h-[34px] rounded-[9px] text-[12px] font-semibold border transition-all",
              value.includes(key)
                ? "bg-accent-deep/[0.15] border-accent-deep/50 text-accent-glow"
                : "bg-text-primary/[0.04] border-line text-text-muted hover:text-text-primary hover:border-line/80",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>
      {value.length === 0 && (
        <p className="text-[11px] text-danger/80 mt-1">Select at least one type</p>
      )}
    </Field>
  );
}

// ── Main form ────────────────────────────────────────────────────────────

interface Props {
  contact?: Contact;
  initialType?: ContactType;
  onClose: () => void;
  onSuccess?: (contactId: string) => void;
}

export function ContactFormModal({ contact, initialType, onClose, onSuccess }: Props) {
  const isEdit = !!contact;

  const createMut = useCreateContact();
  const updateMut = useUpdateContact(contact?.contact_id ?? "");

  // Form state
  const [types, setTypes] = useState<ContactType[]>(
    contact?.contact_type ?? (initialType ? [initialType] : ["customer"]),
  );
  const [displayName, setDisplayName] = useState(contact?.display_name ?? "");
  const [firstName, setFirstName] = useState(contact?.first_name ?? "");
  const [lastName, setLastName] = useState(contact?.last_name ?? "");
  const [company, setCompany] = useState(contact?.company_name ?? "");
  const [phone, setPhone] = useState(contact?.primary_phone ?? "");
  const [whatsapp, setWhatsapp] = useState(contact?.whatsapp_number ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [gender, setGender] = useState(contact?.gender ?? "");
  // Social handles — stored without the leading '@'. UI shows the '@' prefix.
  const [instagram, setInstagram] = useState(contact?.instagram_handle ?? "");
  const [tiktok, setTiktok] = useState(contact?.tiktok_handle ?? "");
  const [facebook, setFacebook] = useState(contact?.facebook_handle ?? "");
  // Birthday: store as month + day, year optional (defaults to 1900 for birthday-only)
  const [birthMonth, setBirthMonth] = useState(() => {
    if (!contact?.date_of_birth) return "";
    const d = new Date(contact.date_of_birth);
    return String(d.getMonth() + 1).padStart(2, "0");
  });
  const [birthDay, setBirthDay] = useState(() => {
    if (!contact?.date_of_birth) return "";
    const d = new Date(contact.date_of_birth);
    return String(d.getDate()).padStart(2, "0");
  });
  const [birthYear, setBirthYear] = useState(() => {
    if (!contact?.date_of_birth) return "";
    const d = new Date(contact.date_of_birth);
    const y = d.getFullYear();
    return y === 1900 ? "" : String(y);
  });
  const [priority, setPriority] = useState<PriorityLevel>(contact?.priority_level ?? "regular");
  const [source, setSource] = useState<ContactSource | "">(contact?.source ?? "");
  const [tin, setTin] = useState(contact?.tin ?? "");
  const [cac, setCac] = useState(contact?.cac_number ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [countryCode, setCountryCode] = useState(contact?.country_code ?? "NG");

  const [error, setError] = useState("");

  const isDirty =
    types.join() !== (contact?.contact_type ?? ["customer"]).join() ||
    displayName !== (contact?.display_name ?? "") ||
    firstName !== (contact?.first_name ?? "") ||
    lastName !== (contact?.last_name ?? "") ||
    phone !== (contact?.primary_phone ?? "") ||
    whatsapp !== (contact?.whatsapp_number ?? "") ||
    email !== (contact?.email ?? "") ||
    instagram !== (contact?.instagram_handle ?? "") ||
    tiktok !== (contact?.tiktok_handle ?? "") ||
    facebook !== (contact?.facebook_handle ?? "") ||
    gender !== (contact?.gender ?? "") ||
    priority !== (contact?.priority_level ?? "regular") ||
    source !== (contact?.source ?? "") ||
    notes !== (contact?.notes ?? "");

  const buildDob = (): string | undefined => {
    if (!birthMonth || !birthDay) return undefined;
    const y = birthYear || "1900";
    return `${y}-${birthMonth}-${birthDay}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (types.length === 0) {
      setError("Select at least one contact type.");
      return;
    }
    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }

    const payload: ContactCreateInput = {
      contact_type: types,
      display_name: displayName.trim(),
      ...(firstName.trim() ? { first_name: firstName.trim() } : {}),
      ...(lastName.trim() ? { last_name: lastName.trim() } : {}),
      ...(company.trim() ? { company_name: company.trim() } : {}),
      ...(phone ? { primary_phone: phone } : {}),
      ...(whatsapp ? { whatsapp_number: whatsapp } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(instagram.trim() ? { instagram_handle: instagram.trim() } : {}),
      ...(tiktok.trim() ? { tiktok_handle: tiktok.trim() } : {}),
      ...(facebook.trim() ? { facebook_handle: facebook.trim() } : {}),
      ...(gender ? { gender } : {}),
      ...(buildDob() ? { date_of_birth: buildDob() } : {}),
      ...(countryCode ? { country_code: countryCode } : {}),
      priority_level: priority,
      ...(source ? { source } : {}),
      ...(tin.trim() ? { tin: tin.trim() } : {}),
      ...(cac.trim() ? { cac_number: cac.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };

    try {
      if (isEdit) {
        await updateMut.mutateAsync(payload);
        onClose();
      } else {
        const created = await createMut.mutateAsync(payload);
        onSuccess?.(created.contact_id);
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit · ${contact.display_name}` : "New Contact"}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={busy || (!isEdit && !isDirty && types.length === 0)}
          >
            {busy ? "Saving…" : isEdit ? "Save Changes" : "Create Contact"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-0">
        {error && (
          <div className="mb-4 px-3 py-2.5 rounded-[10px] bg-danger/[0.1] border border-danger/30 text-[12px] text-danger">
            {error}
          </div>
        )}

        {/* Type */}
        <FormSection>
          <TypeChips value={types} onChange={setTypes} />
        </FormSection>

        {/* Identity */}
        <FormSection title="Identity">
          <Field label="Display name *">
            <TextInput
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Amara Okafor or Pixie Hair Ltd"
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <TextInput
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Amara"
              />
            </Field>
            <Field label="Last name">
              <TextInput
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Okafor"
              />
            </Field>
          </div>
          {(types.includes("supplier") || types.includes("retail_partner")) && (
            <Field label="Company / Organisation">
              <TextInput
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="e.g. Faitlyn Hair Nigeria Ltd"
              />
            </Field>
          )}
        </FormSection>

        {/* Contact */}
        <FormSection title="Contact Details">
          <PhoneField
            label="Primary phone *"
            value={phone}
            onChange={setPhone}
            placeholder="8020868273"
          />
          <PhoneField
            label="WhatsApp number"
            value={whatsapp}
            onChange={setWhatsapp}
            placeholder="Same as phone if same"
          />
          <Field label="Email">
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="amara@example.com"
            />
          </Field>
          <SocialHandleField
            label="Instagram"
            value={instagram}
            onChange={setInstagram}
            placeholder="amara.style"
          />
          <div className="grid grid-cols-2 gap-3">
            <SocialHandleField
              label="TikTok"
              value={tiktok}
              onChange={setTiktok}
              placeholder="amara.style"
            />
            <SocialHandleField
              label="Facebook"
              value={facebook}
              onChange={setFacebook}
              placeholder="amara.style"
            />
          </div>
        </FormSection>

        {/* Personal */}
        <FormSection title="Personal">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Gender">
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">— select —</option>
                <option value="F">Female</option>
                <option value="M">Male</option>
                <option value="other">Non-binary / Other</option>
                <option value="prefer_not">Prefer not to say</option>
              </select>
            </Field>
            <Field label="Country">
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                {DIAL_CODES.filter((d) => d.code !== "OTHER").map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.flag} {d.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Birthday: month + day (year optional) */}
          <Field label="Birthday (month & day)" hint="Used for birthday reminders. Year is optional.">
            <div className="flex gap-2 items-center">
              <select
                value={birthMonth}
                onChange={(e) => setBirthMonth(e.target.value)}
                className="flex-1 h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">Month</option>
                {[
                  "January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December",
                ].map((m, i) => (
                  <option key={m} value={String(i + 1).padStart(2, "0")}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                value={birthDay}
                onChange={(e) => setBirthDay(e.target.value)}
                className="flex-1 h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">Day</option>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1).padStart(2, "0")}>
                    {i + 1}
                  </option>
                ))}
              </select>
              <TextInput
                type="number"
                placeholder="Year"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                min={1900}
                max={new Date().getFullYear()}
                style={{ width: 90 }}
                className="flex-shrink-0"
              />
            </div>
          </Field>
        </FormSection>

        {/* Classification */}
        <FormSection title="Classification">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as PriorityLevel)}
                className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="new">New</option>
                <option value="regular">Regular</option>
                <option value="vip">VIP</option>
              </select>
            </Field>
            <Field label="Source">
              <select
                value={source}
                onChange={(e) => setSource(e.target.value as ContactSource | "")}
                className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                <option value="">— select —</option>
                <option value="walk_in">Walk-in</option>
                <option value="instagram_dm">Instagram DM</option>
                <option value="social_media">Social Media</option>
                <option value="referral">Referral</option>
                <option value="website">Website</option>
                <option value="storefront">Storefront</option>
                <option value="event">Event</option>
              </select>
            </Field>
          </div>
        </FormSection>

        {/* Business identifiers (for suppliers/retail) */}
        {(types.includes("supplier") ||
          types.includes("retail_partner") ||
          types.includes("staff")) && (
          <FormSection title="Business Identifiers">
            <div className="grid grid-cols-2 gap-3">
              <Field label="TIN">
                <TextInput
                  value={tin}
                  onChange={(e) => setTin(e.target.value)}
                  placeholder="Tax Identification No."
                />
              </Field>
              <Field label="CAC Number">
                <TextInput
                  value={cac}
                  onChange={(e) => setCac(e.target.value)}
                  placeholder="RC 123456"
                />
              </Field>
            </div>
          </FormSection>
        )}

        {/* Notes */}
        <FormSection>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any internal notes about this contact…"
              rows={3}
              className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 transition-colors resize-none"
            />
          </Field>
        </FormSection>
      </form>
    </Modal>
  );
}
