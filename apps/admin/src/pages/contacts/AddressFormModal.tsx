import { useState } from "react";
import { MapPin } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { Toggle } from "@/components/ui/controls";
import { useCreateAddress } from "./hooks";
import type { AddressType, AddressCreateInput } from "./types";

const NG_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue",
  "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina",
  "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun",
  "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba",
  "Yobe", "Zamfara",
];

interface Props {
  contactId: string;
  onClose: () => void;
}

export function AddressFormModal({ contactId, onClose }: Props) {
  const createMut = useCreateAddress(contactId);

  const [addrType, setAddrType] = useState<AddressType>("delivery");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [area, setArea] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("Lagos");
  const [country] = useState("Nigeria");
  const [countryCode] = useState("NG");
  const [postalCode, setPostalCode] = useState("");
  const [landmark, setLandmark] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!line1.trim() || !city.trim() || !state) {
      setError("Address line 1, city, and state are required.");
      return;
    }

    const input: AddressCreateInput = {
      address_type: addrType,
      line1: line1.trim(),
      ...(line2.trim() ? { line2: line2.trim() } : {}),
      ...(area.trim() ? { area: area.trim() } : {}),
      city: city.trim(),
      state,
      country,
      country_code: countryCode,
      ...(postalCode.trim() ? { postal_code: postalCode.trim() } : {}),
      ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
      ...(recipientName.trim() ? { recipient_name: recipientName.trim() } : {}),
      ...(recipientPhone.trim() ? { recipient_phone: recipientPhone.trim() } : {}),
      ...(mapsUrl.trim() ? { google_maps_url: mapsUrl.trim() } : {}),
      is_default: isDefault,
    };

    try {
      await createMut.mutateAsync(input);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save address.");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-accent" />
          Add Address
        </span>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={createMut.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={createMut.isPending}
          >
            {createMut.isPending ? "Saving…" : "Save Address"}
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
          <Field label="Address type">
            <div className="flex gap-2 flex-wrap">
              {(
                [
                  { key: "delivery", label: "Delivery" },
                  { key: "billing", label: "Billing" },
                  { key: "office", label: "Office" },
                  { key: "home", label: "Home" },
                  { key: "other", label: "Other" },
                ] as { key: AddressType; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAddrType(key)}
                  className={[
                    "px-3 h-[32px] rounded-[8px] text-[12px] font-semibold border transition-all",
                    addrType === key
                      ? "bg-accent-deep/[0.15] border-accent-deep/50 text-accent-glow"
                      : "bg-text-primary/[0.04] border-line text-text-muted hover:text-text-primary",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </FormSection>

        {/* Street */}
        <FormSection title="Street">
          <Field label="Address line 1 *">
            <TextInput
              autoFocus
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              placeholder="House no / Street name"
            />
          </Field>
          <Field label="Address line 2">
            <TextInput
              value={line2}
              onChange={(e) => setLine2(e.target.value)}
              placeholder="Flat, floor, building name…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Area / Neighbourhood">
              <TextInput
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="e.g. Victoria Island"
              />
            </Field>
            <Field label="City *">
              <TextInput
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Lagos"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State *">
              <select
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
              >
                {NG_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
                <option value="Other">Other</option>
              </select>
            </Field>
            <Field label="Postal code">
              <TextInput
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="e.g. 101001"
              />
            </Field>
          </div>
          <Field label="Landmark">
            <TextInput
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              placeholder="e.g. Beside Access Bank, after the junction"
            />
          </Field>
        </FormSection>

        {/* Recipient */}
        <FormSection title="Recipient (if different)">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Recipient name">
              <TextInput
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Full name"
              />
            </Field>
            <Field label="Recipient phone">
              <TextInput
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
                placeholder="+234…"
              />
            </Field>
          </div>
        </FormSection>

        {/* Google Maps */}
        <FormSection>
          <Field label="Google Maps URL" hint="Paste from Google Maps → Share → Copy link">
            <TextInput
              value={mapsUrl}
              onChange={(e) => setMapsUrl(e.target.value)}
              placeholder="https://maps.google.com/…"
            />
          </Field>
        </FormSection>

        {/* Default toggle */}
        <FormSection>
          <Toggle
            checked={isDefault}
            onChange={setIsDefault}
            label={<span className="text-[13px] text-text-muted">Set as default address</span>}
          />
        </FormSection>
      </form>
    </Modal>
  );
}
