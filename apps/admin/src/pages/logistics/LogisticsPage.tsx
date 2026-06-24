import { useEffect, useMemo, useRef, useState } from "react";
import {
  Truck,
  Plus,
  Search,
  Package,
  MapPin,
  Phone,
  Loader2,
  ArrowRight,
  Ban,
  CheckCircle2,
  Clock,
  CircleAlert,
  Trash2,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { money } from "@/lib/format";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { ErrorState, DeniedState, Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  useDeliveries,
  useDelivery,
  useCouriers,
  useCreateDelivery,
  useBookDelivery,
  useAdvanceDelivery,
  useCancelDelivery,
  useRecordAttempt,
  useRecordProof,
  STATUS_META,
  FLOW,
  ADVANCE_STATES,
  TAB_STATUSES,
  addressLine,
  type DeliveryAddress,
  type DeliveryItem,
} from "@/lib/logistics-api";
import { searchContacts } from "@/pages/sales/api";
import { ShippingRatesTab } from "./ShippingRates";

/**
 * Logistics (`/logistics`) — dispatch queue, tracking and proof of delivery.
 * Ports the hub-system UX onto this backend's delivery state machine.
 */

type Tab = "queue" | "active" | "delivered" | "issues" | "all" | "rates";

const TABS: { key: Tab; label: string }[] = [
  { key: "queue", label: "Queue" },
  { key: "active", label: "Active" },
  { key: "delivered", label: "Delivered" },
  { key: "issues", label: "Issues" },
  { key: "all", label: "All" },
  { key: "rates", label: "Shipping Rates" },
];

export function LogisticsPage() {
  useBreadcrumbs([{ label: "Logistics" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useState<Tab>("queue");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const deliveriesQ = useDeliveries({ q: search || undefined });
  const all = deliveriesQ.data ?? [];

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of Object.keys(TAB_STATUSES)) {
      const set = new Set(TAB_STATUSES[t]);
      c[t] = all.filter((d) => set.has(d.status)).length;
    }
    return c;
  }, [all]);

  const rows = useMemo(() => {
    if (tab === "all" || tab === "rates") return all;
    const set = new Set(TAB_STATUSES[tab]);
    return all.filter((d) => set.has(d.status));
  }, [all, tab]);

  if (!can("logistics", "view")) {
    return <DeniedState message="You don't have access to Logistics." />;
  }

  return (
    <div className="max-w-[1180px] space-y-5">
      {tab !== "rates" && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center flex-1 min-w-[220px] max-w-md rounded-[11px] bg-text-primary/[0.04] border border-line focus-within:border-accent/50 px-3">
            <Search className="w-4 h-4 text-text-faint" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deliveries (number, recipient)…"
              className="w-full bg-transparent px-2 h-[42px] text-[13px] outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            {can("logistics", "create") && (
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                New delivery
              </Button>
            )}
          </div>
        </div>
      )}

      <nav className="flex items-center gap-1 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.key
                ? "border-accent text-accent-glow"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            {t.label}
            {t.key !== "all" && t.key !== "rates" && counts[t.key] > 0 && (
              <span className="text-[10.5px] rounded-full bg-accent/[0.15] text-accent-glow px-1.5 py-px">
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === "rates" ? (
        <ShippingRatesTab />
      ) : deliveriesQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} style={{ height: 52 }} />)}
        </Card>
      ) : deliveriesQ.isError ? (
        <ErrorState onRetry={() => deliveriesQ.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Truck className="w-7 h-7" />}
          title="No deliveries here"
          message="Create a delivery to dispatch an order, transfer, or sample."
          action={
            can("logistics", "create") ? (
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
                New delivery
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {rows.map((d, i) => (
            <button
              key={d.delivery_id}
              onClick={() => setDetailId(d.delivery_id)}
              className={`w-full text-left p-4 flex items-center gap-3 hover:bg-text-primary/[0.03] transition-colors ${
                i < rows.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <span className="grid place-items-center w-10 h-10 rounded-xl bg-panel-2 text-accent-glow border border-line shrink-0">
                <Package className="w-5 h-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[12px] text-text-faint">{d.delivery_number}</span>
                  <Pill tone={STATUS_META[d.status]?.tone ?? "neutral"}>
                    {STATUS_META[d.status]?.label ?? d.status}
                  </Pill>
                  {d.is_pay_on_delivery && <Pill tone="warn" dot={false}>POD</Pill>}
                </div>
                <div className="text-[13px] mt-0.5 truncate">
                  {d.recipient_name_snapshot || d.delivery_address_snapshot?.recipient_name || "—"}
                </div>
                <div className="text-[11.5px] text-text-faint truncate">
                  {addressLine(d.delivery_address_snapshot)}
                </div>
              </div>
              <div className="text-right shrink-0 hidden sm:block">
                {d.courier_name && (
                  <div className="text-[11.5px] text-text-muted">{d.courier_name}</div>
                )}
                {d.courier_fee_ngn != null && (
                  <div className="font-mono text-[12px]">{money(d.courier_fee_ngn)}</div>
                )}
              </div>
            </button>
          ))}
        </Card>
      )}

      {creating && <CreateDeliveryDrawer onClose={() => setCreating(false)} />}
      {detailId && (
        <DeliveryDetailDrawer id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

// ── Detail drawer ───────────────────────────────────────────

function DeliveryDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuthStore();
  const detailQ = useDelivery(id);
  const book = useBookDelivery();
  const advance = useAdvanceDelivery();
  const cancel = useCancelDelivery();
  const attempt = useRecordAttempt();
  const proof = useRecordProof();

  const d = detailQ.data;
  const canEdit = can("logistics", "edit");
  const canCancel = can("logistics", "delete");

  const nextStates = d ? (FLOW[d.status] ?? []) : [];
  const advanceTargets = nextStates.filter((s) => ADVANCE_STATES.has(s));
  const canRecordAttempt = nextStates.includes("attempted_failed");
  const canCancelNow = canCancel && nextStates.includes("cancelled");
  const busy =
    book.isPending || advance.isPending || cancel.isPending || attempt.isPending || proof.isPending;

  return (
    <Drawer
      open
      onClose={onClose}
      title={d ? d.delivery_number : "Delivery"}
      subtitle={d ? STATUS_META[d.status]?.label : ""}
    >
      {detailQ.isLoading || !d ? (
        <div className="p-1 space-y-3">
          <Skeleton style={{ height: 24, width: "50%" }} />
          <Skeleton style={{ height: 80 }} />
        </div>
      ) : (
        <div className="space-y-4 p-1">
          <Pill tone={STATUS_META[d.status]?.tone ?? "neutral"}>
            {STATUS_META[d.status]?.label ?? d.status}
          </Pill>

          {/* Recipient + address */}
          <div className="rounded-xl border border-line p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-[13.5px] font-medium">
              {d.recipient_name_snapshot || d.delivery_address_snapshot?.recipient_name || "—"}
            </div>
            {(d.recipient_phone_snapshot || d.delivery_address_snapshot?.phone) && (
              <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                <Phone className="w-3.5 h-3.5" />
                {d.recipient_phone_snapshot || d.delivery_address_snapshot?.phone}
              </div>
            )}
            <div className="flex items-start gap-1.5 text-[12px] text-text-muted">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {addressLine(d.delivery_address_snapshot)}
            </div>
          </div>

          {/* Meta */}
          <dl className="grid grid-cols-2 gap-y-2 gap-x-4 text-[12.5px]">
            {d.courier_name && <Meta label="Courier" value={d.courier_name} />}
            {d.courier_fee_ngn != null && <Meta label="Fee" value={money(d.courier_fee_ngn)} />}
            {d.courier_tracking_ref && <Meta label="Tracking" value={d.courier_tracking_ref} mono />}
            {d.is_pay_on_delivery && (
              <Meta label="POD expected" value={money(d.pod_amount_expected_ngn ?? 0)} />
            )}
            {d.expected_delivery_at && (
              <Meta label="ETA" value={new Date(d.expected_delivery_at).toLocaleString()} />
            )}
          </dl>

          {d.delivery_instructions && (
            <div>
              <div className="micro mb-1">Instructions</div>
              <p className="text-[12.5px] text-text-muted">{d.delivery_instructions}</p>
            </div>
          )}

          {/* Timeline */}
          {d.state_history && d.state_history.length > 0 && (
            <div>
              <div className="micro mb-2">Timeline</div>
              <div className="space-y-1.5">
                {d.state_history.map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11.5px] text-text-muted">
                    <Clock className="w-3 h-3 text-text-faint" />
                    <span className="font-medium">{STATUS_META[h.to_status]?.label ?? h.to_status}</span>
                    {h.occurred_at && (
                      <span className="text-text-faint">{new Date(h.occurred_at).toLocaleString()}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {canEdit && (
            <div className="space-y-2 pt-2 border-t border-line">
              <div className="micro">Update status</div>

              {d.status === "queued" && (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => book.mutate({ id })}
                  icon={book.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                >
                  Book with courier
                </Button>
              )}

              {advanceTargets.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {advanceTargets.map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={s === "delivered" ? "primary" : "secondary"}
                      disabled={busy}
                      onClick={() => advance.mutate({ id, to_status: s })}
                      icon={s === "delivered" ? <CheckCircle2 className="w-4 h-4" /> : <ArrowRight className="w-4 h-4" />}
                    >
                      {STATUS_META[s]?.label ?? s}
                    </Button>
                  ))}
                </div>
              )}

              {canRecordAttempt && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    attempt.mutate({ id, outcome: "recipient_unavailable" })
                  }
                  icon={<CircleAlert className="w-4 h-4" />}
                >
                  Record failed attempt
                </Button>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => proof.mutate({ id, proof_type: "recipient_signature" })}
                  icon={<CheckCircle2 className="w-4 h-4" />}
                >
                  Add proof
                </Button>
                {canCancelNow && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt("Reason for cancelling?") ?? undefined;
                      cancel.mutate({ id, reason });
                    }}
                    icon={<Ban className="w-4 h-4" />}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ── Create drawer ───────────────────────────────────────────

interface ContactHit {
  contact_id: string;
  display_name: string;
  primary_phone?: string | null;
}

function CreateDeliveryDrawer({ onClose }: { onClose: () => void }) {
  const couriersQ = useCouriers();
  const create = useCreateDelivery();
  const couriers = (couriersQ.data ?? []).filter((c) => c.is_active);

  // Customer search (debounced)
  const [contactId, setContactId] = useState("");
  const [cq, setCq] = useState("");
  const [results, setResults] = useState<ContactHit[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (contactId || cq.trim().length < 2) {
      setResults([]);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await searchContacts(cq.trim());
        setResults(((r as { data?: ContactHit[] })?.data ?? []) as ContactHit[]);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [cq, contactId]);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [area, setArea] = useState("");
  const [landmark, setLandmark] = useState("");
  const [city, setCity] = useState("Lagos");
  const [stateV, setStateV] = useState("Lagos");
  const [country, setCountry] = useState("Nigeria");
  const [courierId, setCourierId] = useState("");
  const [fee, setFee] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pod, setPod] = useState(false);
  const [podAmount, setPodAmount] = useState("");
  const [items, setItems] = useState<{ description: string; quantity: string }[]>([
    { description: "", quantity: "1" },
  ]);

  const resolvedCourier = courierId || couriers[0]?.courier_id || "";
  const validItems = items.filter((it) => it.description.trim());
  const canSave =
    !!resolvedCourier && !!name && !!line1 && !!city && validItems.length > 0 && !create.isPending;

  function pick(c: ContactHit) {
    setContactId(c.contact_id);
    setCq(c.display_name);
    setOpen(false);
    if (!name) setName(c.display_name);
    if (!phone && c.primary_phone) setPhone(c.primary_phone);
  }

  function submit() {
    const address: DeliveryAddress = {
      line1,
      area: area || undefined,
      landmark: landmark || undefined,
      city,
      state: stateV || undefined,
      country: country || undefined,
      recipient_name: name,
      phone: phone || undefined,
    };
    const lines: DeliveryItem[] = validItems.map((it) => ({
      description: it.description.trim(),
      quantity: Number(it.quantity) || 1,
    }));
    create.mutate(
      {
        courier_id: resolvedCourier,
        recipient_contact_id: contactId || undefined,
        recipient_name_snapshot: name,
        recipient_phone_snapshot: phone || undefined,
        delivery_address_snapshot: address,
        delivery_instructions: instructions || undefined,
        courier_fee_ngn: fee ? Number(fee) : undefined,
        is_pay_on_delivery: pod || undefined,
        pod_amount_expected_ngn: pod && podAmount ? Number(podAmount) : undefined,
        items: lines,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Drawer open onClose={onClose} title="New delivery" subtitle="Dispatch a package">
      <div className="space-y-5 p-1">
        {/* Customer */}
        <Field label="Customer">
          <div className="relative">
            <Input
              value={cq}
              onChange={(v) => {
                setCq(v);
                setContactId("");
              }}
              placeholder="Search customer by name or phone…"
            />
            {open && results.length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 rounded-[11px] border border-line bg-panel-2 shadow-glass overflow-hidden">
                {results.map((c) => (
                  <button
                    key={c.contact_id}
                    type="button"
                    onClick={() => pick(c)}
                    className="w-full text-left px-3 py-2 text-[13px] hover:bg-text-primary/[0.06]"
                  >
                    <div className="font-medium">{c.display_name}</div>
                    {c.primary_phone && <div className="text-[11px] text-text-faint">{c.primary_phone}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Address */}
          <div className="space-y-3">
            <div className="micro">Delivery address</div>
            <Field label="Recipient name"><Input value={name} onChange={setName} placeholder="Jane Doe" /></Field>
            <Field label="Phone"><Input value={phone} onChange={setPhone} placeholder="0801…" /></Field>
            <Field label="Street address"><Input value={line1} onChange={setLine1} placeholder="14 Admiralty Way" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Area"><Input value={area} onChange={setArea} placeholder="Lekki Phase 1" /></Field>
              <Field label="Landmark"><Input value={landmark} onChange={setLandmark} placeholder="Near…" /></Field>
              <Field label="City"><Input value={city} onChange={setCity} /></Field>
              <Field label="State"><Input value={stateV} onChange={setStateV} /></Field>
            </div>
            <Field label="Country"><Input value={country} onChange={setCountry} /></Field>
          </div>

          {/* Courier & fee */}
          <div className="space-y-3">
            <div className="micro">Courier &amp; fee</div>
            <Field label="Courier">
              <Select
                value={resolvedCourier}
                onChange={setCourierId}
                options={
                  couriers.length
                    ? couriers.map((c) => ({ value: c.courier_id, label: c.display_name }))
                    : [{ value: "", label: "No couriers configured" }]
                }
              />
            </Field>
            <Field label="Delivery fee (₦)">
              <Input value={fee} onChange={(v) => setFee(v.replace(/[^0-9.]/g, ""))} placeholder="0" mono />
            </Field>
            <label className="flex items-center gap-2 text-[12.5px] text-text-muted">
              <input type="checkbox" checked={pod} onChange={(e) => setPod(e.target.checked)} className="accent-accent" />
              Pay on delivery
            </label>
            {pod && (
              <Field label="POD amount (₦)">
                <Input value={podAmount} onChange={(v) => setPodAmount(v.replace(/[^0-9.]/g, ""))} placeholder="0" mono />
              </Field>
            )}
            <Field label="Instructions">
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={2}
                placeholder="Call on arrival, gate code…"
                className="w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 py-2.5 text-[13px] outline-none focus:border-accent/50 resize-y"
              />
            </Field>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-2">
          <div className="micro">What&rsquo;s being delivered?</div>
          {items.map((it, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  value={it.description}
                  onChange={(v) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, description: v } : x)))}
                  placeholder="e.g. Rouge 500ml"
                />
              </div>
              <input
                value={it.quantity}
                onChange={(e) =>
                  setItems((arr) => arr.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/[^0-9]/g, "") } : x)))
                }
                className="w-16 h-[42px] px-2 text-center rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50 tabular-nums"
                placeholder="1"
              />
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}
                  className="p-2.5 text-text-faint hover:text-danger"
                  aria-label="Remove item"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setItems((arr) => [...arr, { description: "", quantity: "1" }])}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line py-2 text-[12px] text-text-muted hover:text-accent-glow hover:border-accent/40"
          >
            <Plus className="w-3.5 h-3.5" /> Add item
          </button>
        </div>

        {couriers.length === 0 && (
          <p className="text-[12px] text-warn">No couriers configured — add one before dispatching.</p>
        )}
        {create.isError && <p className="text-[12px] text-danger">Couldn&rsquo;t create the delivery.</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!canSave}
            onClick={submit}
            icon={create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          >
            Create delivery
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Shared bits ─────────────────────────────────────────────

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10.5px] uppercase tracking-widest text-text-faint">{label}</dt>
      <dd className={`text-text-primary ${mono ? "font-mono text-[11.5px] break-all" : ""}`}>{value}</dd>
    </div>
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
    />
  );
}
