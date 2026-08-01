/**
 * Agencies tab — manual 3PL/courier directory (Logistics).
 * Full CRUD over `couriers`: identity, service scope, rate card (reference
 * only — the actual fee is always typed fresh at booking time), and the
 * agency contact/commercial profile needed now that booking is fully manual.
 */

import { useMemo, useState } from "react";
import { Plus, Search, Star, Loader2, MapPin, Truck } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { ErrorState, Toggle, Select } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { toastReport } from "@/lib/error-report";
import {
  useCouriers,
  useCreateCourier,
  useUpdateCourier,
  type Courier,
  type CourierInput,
} from "@/lib/logistics-api";

export function AgenciesTab() {
  const { can } = useAuthStore();
  const couriersQ = useCouriers();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Courier | null>(null);
  const [creating, setCreating] = useState(false);
  const canEdit = can("logistics", "edit");
  const canCreate = can("logistics", "create");

  const all = couriersQ.data ?? [];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.display_name.toLowerCase().includes(q) ||
        c.contact_person?.toLowerCase().includes(q) ||
        c.courier_key.toLowerCase().includes(q),
    );
  }, [all, search]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center flex-1 min-w-[220px] max-w-md rounded-[11px] bg-text-primary/[0.04] border border-line focus-within:border-accent/50 px-3">
          <Search className="w-4 h-4 text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agencies (name, contact)…"
            className="w-full bg-transparent px-2 h-[42px] text-[13px] outline-none"
            autoComplete="off"
          />
        </div>
        {canCreate && (
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
            New agency
          </Button>
        )}
      </div>

      {couriersQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 64 }} />
          ))}
        </Card>
      ) : couriersQ.isError ? (
        <ErrorState onRetry={() => couriersQ.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Truck className="w-7 h-7" />}
          title="No agencies yet"
          message="Add the 3PLs and couriers you book manually — GIGL, GUO, Uber, In-Drive, Bolt, DHL, FedEx, UPS…"
          action={
            canCreate ? (
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                New agency
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {rows.map((c, i) => (
            <button
              key={c.courier_id}
              onClick={() => canEdit && setEditing(c)}
              disabled={!canEdit}
              className={`w-full text-left p-4 flex items-center gap-3 hover:bg-text-primary/[0.03] transition-colors disabled:cursor-default disabled:hover:bg-transparent ${
                i < rows.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <span className="grid place-items-center w-10 h-10 rounded-xl bg-panel-2 text-accent-glow border border-line shrink-0">
                <Truck className="w-5 h-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-medium">{c.display_name}</span>
                  <Pill tone={c.is_active ? "success" : "neutral"} dot={false}>
                    {c.is_active ? "Active" : "Inactive"}
                  </Pill>
                  {c.internal_rating ? (
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-warn">
                      {Array.from({ length: c.internal_rating }).map((_, s) => (
                        <Star key={s} className="w-3 h-3 fill-current" />
                      ))}
                    </span>
                  ) : null}
                </div>
                {c.contact_person && (
                  <div className="text-[12px] text-text-muted mt-0.5">
                    {c.contact_person}
                    {c.contact_phone ? ` · ${c.contact_phone}` : ""}
                  </div>
                )}
                {c.preferred_pickup_location && (
                  <div className="flex items-center gap-1 text-[11.5px] text-text-faint truncate mt-0.5">
                    <MapPin className="w-3 h-3 shrink-0" />
                    {c.preferred_pickup_location}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0 hidden sm:block">
                {c.rate_card?.flat != null && (
                  <div className="font-mono text-[12px]">
                    from ₦{Number(c.rate_card.flat).toLocaleString()}
                  </div>
                )}
                {c.rate_card?.per_kg != null && (
                  <div className="text-[10.5px] text-text-faint">
                    +₦{Number(c.rate_card.per_kg).toLocaleString()}/kg
                  </div>
                )}
              </div>
            </button>
          ))}
        </Card>
      )}

      {creating && <AgencyFormModal onClose={() => setCreating(false)} />}
      {editing && <AgencyFormModal courier={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ── Create/edit form ─────────────────────────────────────────

function AgencyFormModal({
  courier,
  onClose,
}: {
  courier?: Courier;
  onClose: () => void;
}) {
  const create = useCreateCourier();
  const update = useUpdateCourier();
  const isEdit = Boolean(courier);
  const busy = create.isPending || update.isPending;

  const [key, setKey] = useState(courier?.courier_key ?? "");
  const [name, setName] = useState(courier?.display_name ?? "");
  const [description, setDescription] = useState(courier?.description ?? "");
  const [contactPerson, setContactPerson] = useState(courier?.contact_person ?? "");
  const [contactPhone, setContactPhone] = useState(courier?.contact_phone ?? "");
  const [pickupLocation, setPickupLocation] = useState(courier?.preferred_pickup_location ?? "");
  const [paymentTerms, setPaymentTerms] = useState(courier?.payment_terms_notes ?? "");
  const [settlementMode, setSettlementMode] = useState<"invoice" | "per_drop">(
    courier?.settlement_mode ?? "invoice",
  );
  const [flat, setFlat] = useState(courier?.rate_card?.flat != null ? String(courier.rate_card.flat) : "");
  const [perKg, setPerKg] = useState(courier?.rate_card?.per_kg != null ? String(courier.rate_card.per_kg) : "");
  const [rating, setRating] = useState(courier?.internal_rating ?? 0);
  const [notes, setNotes] = useState(courier?.internal_notes ?? "");
  const [local, setLocal] = useState(courier?.serves_local ?? true);
  const [nationwide, setNationwide] = useState(courier?.serves_nationwide ?? false);
  const [international, setInternational] = useState(courier?.serves_international ?? false);
  const [active, setActive] = useState(courier?.is_active ?? true);

  const canSave = name.trim().length > 0 && (isEdit || key.trim().length > 0) && !busy;

  function submit() {
    const rate_card =
      flat || perKg
        ? { ...(flat ? { flat: Number(flat) } : {}), ...(perKg ? { per_kg: Number(perKg) } : {}) }
        : undefined;
    const body: CourierInput = {
      display_name: name.trim(),
      description: description.trim() || undefined,
      serves_local: local,
      serves_nationwide: nationwide,
      serves_international: international,
      rate_card,
      contact_person: contactPerson.trim() || undefined,
      contact_phone: contactPhone.trim() || undefined,
      preferred_pickup_location: pickupLocation.trim() || undefined,
      payment_terms_notes: paymentTerms.trim() || undefined,
      settlement_mode: settlementMode,
      internal_rating: rating || undefined,
      internal_notes: notes.trim() || undefined,
    };
    if (isEdit && courier) {
      update.mutate(
        { id: courier.courier_id, patch: { ...body, is_active: active } },
        {
          onSuccess: onClose,
          onError: (e) => toastReport("Logistics → Agencies", "Save agency", e),
        },
      );
    } else {
      create.mutate(
        { ...body, courier_key: key.trim() },
        {
          onSuccess: onClose,
          onError: (e) => toastReport("Logistics → Agencies", "Add agency", e),
        },
      );
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? "Edit agency" : "New agency"}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={submit}
            icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            {isEdit ? "Save changes" : "Add agency"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Agency name">
            <Input value={name} onChange={setName} placeholder="e.g. GIGL, Uber, DHL Express" />
          </Field>
          {!isEdit && (
            <Field label="Key (unique, lowercase)">
              <Input
                value={key}
                onChange={(v) => setKey(v.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                placeholder="gigl / uber / dhl_express"
              />
            </Field>
          )}
        </div>

        <Field label="Description">
          <Input value={description} onChange={setDescription} placeholder="Optional notes about this agency" />
        </Field>

        <div>
          <div className="micro mb-2">Service scope</div>
          <div className="flex flex-wrap gap-4 text-[12.5px] text-text-muted">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} className="accent-accent" />
              Local (intra-city)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={nationwide} onChange={(e) => setNationwide(e.target.checked)} className="accent-accent" />
              Nationwide
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={international} onChange={(e) => setInternational(e.target.checked)} className="accent-accent" />
              International
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Reference rate — flat (₦)">
            <Input value={flat} onChange={(v) => setFlat(v.replace(/[^0-9.]/g, ""))} placeholder="0" mono />
          </Field>
          <Field label="Reference rate — per kg (₦)">
            <Input value={perKg} onChange={(v) => setPerKg(v.replace(/[^0-9.]/g, ""))} placeholder="0" mono />
          </Field>
        </div>
        <p className="text-[11px] text-text-faint -mt-3">
          Shown for comparison only when booking — the actual agreed fee is always typed in fresh at booking time.
        </p>

        <div className="micro">Agency contact</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Contact person">
            <Input value={contactPerson} onChange={setContactPerson} placeholder="Name" />
          </Field>
          <Field label="Contact phone">
            <Input value={contactPhone} onChange={setContactPhone} placeholder="0801…" />
          </Field>
        </div>
        <Field label="Preferred pickup location">
          <Input value={pickupLocation} onChange={setPickupLocation} placeholder="Where this agency collects from" />
        </Field>
        <Field label="How we pay them">
          <Select
            value={settlementMode}
            onChange={(v) => setSettlementMode(v as "invoice" | "per_drop")}
            ariaLabel="Settlement mode"
            options={[
              { value: "invoice", label: "They invoice us periodically" },
              { value: "per_drop", label: "Paid per drop, at pickup" },
            ]}
          />
          <p className="text-[11px] text-text-faint mt-1">
            Decides where this courier&rsquo;s delivery costs settle — a
            periodic invoice batches into one expense, per-drop cash settles
            through a cash request.
          </p>
        </Field>

        <Field label="Payment terms">
          <Input value={paymentTerms} onChange={setPaymentTerms} placeholder="e.g. Pay before pickup, transfer only" />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          <Field label="Internal rating">
            <div className="flex items-center gap-1 h-[42px]">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(rating === n ? 0 : n)}
                  aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  className="p-0.5"
                >
                  <Star className={`w-4 h-4 ${n <= rating ? "text-warn fill-current" : "text-text-faint"}`} />
                </button>
              ))}
            </div>
          </Field>
          {isEdit && (
            <Field label="Active">
              <div className="h-[42px] flex items-center">
                <Toggle checked={active} onChange={setActive} />
              </div>
            </Field>
          )}
        </div>
        <Field label="Internal notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Reliability, issues, anything ops should know…"
            className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-accent/50 resize-y"
          />
        </Field>

        {(create.isError || update.isError) && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t save this agency.</p>
        )}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 ${mono ? "font-mono text-[12px]" : ""}`}
      autoComplete="off"
    />
  );
}
