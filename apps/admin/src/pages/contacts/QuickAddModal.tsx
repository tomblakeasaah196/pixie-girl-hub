import { useState } from "react";
import { Zap } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Field, TextInput, FormSection } from "@/components/ui/Form";
import { useCreateContact } from "./hooks";
import { DIAL_CODES } from "./ContactFormModal";
import type { ContactType, ContactCreateInput } from "./types";

interface Props {
  /** Pre-set contact type when triggered from another module (e.g. "customer" from Sales). */
  initialType?: ContactType;
  onClose: () => void;
  /** Called with the new contact_id so the caller can link immediately. */
  onSuccess?: (contactId: string) => void;
}

/**
 * Lightweight 3-field modal for quick contact creation: name + phone + type.
 * Used from Sales, POS, and other modules where a contact must be found or created inline.
 * The full profile can be expanded later from the Contacts directory.
 */
export function QuickAddModal({ initialType = "customer", onClose, onSuccess }: Props) {
  const createMut = useCreateContact();

  const [name, setName] = useState("");
  const [dialCode, setDialCode] = useState<(typeof DIAL_CODES)[number]>(DIAL_CODES[0]);
  const [rawPhone, setRawPhone] = useState("");
  const [email, setEmail] = useState("");
  const [type, setType] = useState<ContactType>(initialType);
  const [error, setError] = useState("");

  const phone = rawPhone.replace(/\D/g, "") ? `${dialCode.dial}${rawPhone.replace(/\D/g, "")}` : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    const payload: ContactCreateInput = {
      contact_type: [type],
      display_name: name.trim(),
      source: "walk_in",
      priority_level: "new",
      ...(phone ? { primary_phone: phone, whatsapp_number: phone } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
    };

    try {
      const created = await createMut.mutateAsync(payload);
      onSuccess?.(created.contact_id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create contact.");
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent" />
          Quick Add Contact
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
            disabled={createMut.isPending || !name.trim()}
          >
            {createMut.isPending ? "Adding…" : "Add Contact"}
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

        <p className="text-[12px] text-text-faint mb-4">
          Enter the essentials — full profile can be completed later in the Contacts directory.
        </p>

        {/* Type */}
        <FormSection>
          <Field label="Type">
            <div className="flex gap-2">
              {(
                [
                  { key: "customer", label: "Customer" },
                  { key: "supplier", label: "Supplier" },
                  { key: "staff", label: "Staff" },
                ] as { key: ContactType; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setType(key)}
                  className={[
                    "flex-1 py-2 rounded-[9px] text-[12px] font-semibold border transition-all",
                    type === key
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

        {/* Name */}
        <FormSection>
          <Field label="Full name *">
            <TextInput
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Amara Okafor"
              required
            />
          </Field>
        </FormSection>

        {/* Phone with country code */}
        <FormSection>
          <Field
            label="Phone / WhatsApp *"
            hint="Include country code for WhatsApp API accuracy"
          >
            <div className="flex gap-2">
              <select
                value={dialCode.dial}
                onChange={(e) => {
                  const d = DIAL_CODES.find((c) => c.dial === e.target.value) ?? DIAL_CODES[0];
                  setDialCode(d);
                }}
                className="h-[42px] px-2 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
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
                placeholder="8020868273"
                value={rawPhone}
                onChange={(e) => setRawPhone(e.target.value.replace(/[^\d\s\-]/g, ""))}
              />
            </div>
            {phone && (
              <p className="text-[10.5px] text-text-faint mt-1">
                Stored as: <span className="font-mono">{phone}</span>
              </p>
            )}
          </Field>
        </FormSection>

        {/* Email (optional) */}
        <FormSection>
          <Field label="Email (optional)">
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="amara@example.com"
            />
          </Field>
        </FormSection>
      </form>
    </Modal>
  );
}
