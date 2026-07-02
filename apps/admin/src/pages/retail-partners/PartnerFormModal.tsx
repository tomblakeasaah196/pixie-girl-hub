import { useEffect, useRef, useState } from "react";
import { Search, UserPlus, X as XIcon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Select, NumberField } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { rpApi } from "./api";
import { useRpMutations } from "./hooks";
import { FieldLabel, TextInput, TextArea, InfoBanner } from "./parts";
import { isoDay } from "./format";
import type {
  ContactHit,
  RetailPartner,
  PartnerCreateInput,
  PartnerUpdateInput,
  SettlementFrequency,
} from "./types";
import { FREQUENCY_LABEL } from "./types";

const FREQ_OPTS = (
  Object.entries(FREQUENCY_LABEL) as [SettlementFrequency, string][]
).map(([value, label]) => ({ value, label }));

/** Create + edit partner. Create links (or quick-creates) a shared.contact —
 *  the backend requires contact_id; edit only patches commercial terms. */
export function PartnerFormModal({
  open,
  onClose,
  partner,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, the modal edits this partner instead of creating. */
  partner?: RetailPartner | null;
}) {
  const editing = !!partner;
  const { createPartner, updatePartner } = useRpMutations();
  const mutation = editing ? updatePartner : createPartner;

  // ── Contact link (create only) ────────────────────────────
  const [contact, setContact] = useState<ContactHit | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [contactHits, setContactHits] = useState<ContactHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [newContactMode, setNewContactMode] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncCompany, setNcCompany] = useState("");
  const [ncPhone, setNcPhone] = useState("");
  const [ncEmail, setNcEmail] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  // ── Terms ─────────────────────────────────────────────────
  const [displayName, setDisplayName] = useState("");
  const [margin, setMargin] = useState("30");
  const [termsDays, setTermsDays] = useState("30");
  const [creditLimit, setCreditLimit] = useState("");
  const [frequency, setFrequency] = useState<SettlementFrequency>("monthly");
  const [onboardedAt, setOnboardedAt] = useState(isoDay());
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (partner) {
      setDisplayName(partner.display_name);
      setMargin(String(partner.margin_share_pct ?? "30"));
      setTermsDays(String(partner.payment_terms_days ?? "30"));
      setCreditLimit(partner.credit_limit_ngn ?? "");
      setFrequency(partner.settlement_frequency);
      setNotes(partner.notes ?? "");
    } else {
      setContact(null);
      setContactQuery("");
      setContactHits([]);
      setNewContactMode(false);
      setNcName("");
      setNcCompany("");
      setNcPhone("");
      setNcEmail("");
      setDisplayName("");
      setMargin("30");
      setTermsDays("30");
      setCreditLimit("");
      setFrequency("monthly");
      setOnboardedAt(isoDay());
      setNotes("");
    }
    setContactError(null);
    mutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partner?.partner_id]);

  const runSearch = (q: string) => {
    setContactQuery(q);
    clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setContactHits([]);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await rpApi.searchContacts(q.trim());
        setContactHits(res.data ?? []);
      } catch {
        setContactHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  };

  const pickContact = (c: ContactHit) => {
    setContact(c);
    setContactHits([]);
    setContactQuery("");
    if (!displayName) setDisplayName(c.display_name);
  };

  const marginNum = Number(margin || "0");
  const marginBad = margin !== "" && (marginNum < 0 || marginNum > 100);
  const canSubmit = editing
    ? !!displayName.trim() && !marginBad
    : !!displayName.trim() &&
      !marginBad &&
      (contact !== null || (newContactMode && ncName.trim().length > 0));

  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setContactError(null);

    if (editing && partner) {
      const patch: PartnerUpdateInput = {
        display_name: displayName.trim(),
        margin_share_pct: marginNum,
        payment_terms_days: Number(termsDays || "0"),
        settlement_frequency: frequency,
        ...(creditLimit !== "" ? { credit_limit_ngn: Number(creditLimit) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      updatePartner.mutate(
        { id: partner.partner_id, patch },
        { onSuccess: onClose },
      );
      return;
    }

    setBusy(true);
    try {
      // Quick-create the contact first when asked to.
      let contactId = contact?.contact_id ?? null;
      if (!contactId && newContactMode) {
        const created = await rpApi.createContact({
          display_name: ncName.trim(),
          ...(ncCompany.trim() ? { company_name: ncCompany.trim() } : {}),
          ...(ncPhone.trim() ? { primary_phone: ncPhone.trim() } : {}),
          ...(ncEmail.trim() ? { email: ncEmail.trim() } : {}),
        });
        contactId = created.contact_id;
      }
      if (!contactId) return;

      const input: PartnerCreateInput = {
        contact_id: contactId,
        display_name: displayName.trim(),
        margin_share_pct: marginNum,
        payment_terms_days: Number(termsDays || "0"),
        settlement_frequency: frequency,
        onboarded_at: onboardedAt,
        ...(creditLimit !== "" ? { credit_limit_ngn: Number(creditLimit) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      createPartner.mutate(input, { onSuccess: onClose });
    } catch (err) {
      setContactError(
        (err as Error)?.message || "Could not create the contact",
      );
    } finally {
      setBusy(false);
    }
  };

  const pending = busy || mutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Edit partner terms" : "Add retail partner"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canSubmit || pending}
          >
            {pending
              ? "Saving…"
              : editing
                ? "Save changes"
                : "Create partner"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* ── Contact link (create only) ── */}
        {!editing && (
          <div className="flex flex-col gap-2.5">
            <FieldLabel>Partner contact</FieldLabel>
            {contact ? (
              <div className="flex items-center gap-3 p-3 rounded-[11px] border border-accent/30 bg-accent/[0.06]">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold truncate">
                    {contact.display_name}
                  </div>
                  <div className="text-[11.5px] text-text-muted truncate">
                    {[contact.company_name, contact.primary_phone, contact.email]
                      .filter(Boolean)
                      .join(" · ") || "No details on file"}
                  </div>
                </div>
                <button
                  onClick={() => setContact(null)}
                  aria-label="Unlink contact"
                  className="grid place-items-center w-8 h-8 rounded-lg text-text-muted hover:bg-text-primary/[0.07]"
                >
                  <XIcon className="w-4 h-4" />
                </button>
              </div>
            ) : newContactMode ? (
              <div className="p-3 rounded-[11px] border border-line bg-text-primary/[0.02] flex flex-col gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Contact name *</FieldLabel>
                    <TextInput
                      value={ncName}
                      onChange={setNcName}
                      placeholder="e.g. Adaeze Boutique"
                    />
                  </div>
                  <div>
                    <FieldLabel>Company</FieldLabel>
                    <TextInput
                      value={ncCompany}
                      onChange={setNcCompany}
                      placeholder="Registered name"
                    />
                  </div>
                  <div>
                    <FieldLabel>Phone</FieldLabel>
                    <TextInput
                      value={ncPhone}
                      onChange={setNcPhone}
                      placeholder="+234…"
                    />
                  </div>
                  <div>
                    <FieldLabel>Email</FieldLabel>
                    <TextInput
                      value={ncEmail}
                      onChange={setNcEmail}
                      placeholder="name@business.com"
                      type="email"
                    />
                  </div>
                </div>
                <button
                  onClick={() => setNewContactMode(false)}
                  className="self-start text-[12px] font-semibold text-text-muted hover:text-text-primary"
                >
                  ← Search existing contacts instead
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
                  <input
                    value={contactQuery}
                    onChange={(e) => runSearch(e.target.value)}
                    placeholder="Search contacts by name, phone or email…"
                    className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
                  />
                </div>
                {(contactHits.length > 0 || searching) &&
                  contactQuery.trim().length >= 2 && (
                    <div className="select-dropdown-list absolute z-50 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] overflow-hidden py-1 max-h-[220px] overflow-y-auto">
                      {searching && (
                        <div className="px-3 py-2 text-[12px] text-text-faint">
                          Searching…
                        </div>
                      )}
                      {!searching &&
                        contactHits.map((c) => (
                          <button
                            key={c.contact_id}
                            onClick={() => pickContact(c)}
                            className="w-full px-3 py-2 text-left hover:bg-text-primary/[0.06]"
                          >
                            <div className="text-[13px] font-medium">
                              {c.display_name}
                            </div>
                            <div className="text-[11px] text-text-faint truncate">
                              {[c.company_name, c.primary_phone, c.email]
                                .filter(Boolean)
                                .join(" · ")}
                            </div>
                          </button>
                        ))}
                    </div>
                  )}
                <button
                  onClick={() => {
                    setNewContactMode(true);
                    setNcName(contactQuery.trim());
                  }}
                  className={cn(
                    "mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold",
                    "text-accent-glow hover:brightness-110",
                  )}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  New contact
                </button>
              </div>
            )}
            {contactError && <InfoBanner tone="warn">{contactError}</InfoBanner>}
          </div>
        )}

        {/* ── Terms ── */}
        <div>
          <FieldLabel>Display name *</FieldLabel>
          <TextInput
            value={displayName}
            onChange={setDisplayName}
            placeholder="How the partner appears across the hub"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel>Partner margin share</FieldLabel>
            <NumberField
              value={margin}
              onChange={setMargin}
              allowDecimal
              placeholder="30"
              suffix="%"
            />
            {marginBad && (
              <div className="text-[11px] text-danger mt-1">
                Must be between 0 and 100.
              </div>
            )}
          </div>
          <div>
            <FieldLabel>Payment terms</FieldLabel>
            <NumberField
              value={termsDays}
              onChange={setTermsDays}
              allowDecimal={false}
              placeholder="30"
              suffix="days"
            />
          </div>
          <div>
            <FieldLabel>Credit limit (optional)</FieldLabel>
            <NumberField
              value={creditLimit}
              onChange={setCreditLimit}
              allowDecimal
              placeholder="0.00"
              suffix="NGN"
            />
          </div>
          <div>
            <FieldLabel>Settlement frequency</FieldLabel>
            <Select
              value={frequency}
              onChange={setFrequency}
              options={FREQ_OPTS}
            />
          </div>
          {!editing && (
            <div>
              <FieldLabel>Onboarded on</FieldLabel>
              <TextInput
                value={onboardedAt}
                onChange={setOnboardedAt}
                type="date"
              />
            </div>
          )}
        </div>

        <div>
          <FieldLabel>Notes</FieldLabel>
          <TextArea
            value={notes}
            onChange={setNotes}
            placeholder="Agreement details, delivery quirks, anything the team should know…"
          />
        </div>

        {mutation.isError && (
          <InfoBanner tone="warn">
            {(mutation.error as Error)?.message || "Something went wrong."}
          </InfoBanner>
        )}
      </div>
    </Modal>
  );
}
