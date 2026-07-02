import { useMemo, useState, type ReactNode } from "react";
import {
  Store,
  MapPin,
  Plus,
  Pencil,
  Truck,
  BadgeCent,
  FileText,
  ArrowRight,
} from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import {
  Button,
  MoneyText,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { ConfirmDialog, ErrorState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { useAuthStore } from "@/stores/auth";
import { usePartnerDetail, useRpMutations } from "./hooks";
import { PartnerFormModal } from "./PartnerFormModal";
import { LocationFormModal } from "./LocationFormModal";
import { MovementModal } from "./MovementModal";
import {
  FieldLabel,
  TextInput,
  PartnerStatusPill,
  MicroLabel,
} from "./parts";
import { fmtDate, fmtDateTime } from "./format";
import type { MovementType, PartnerStatus } from "./types";
import { FREQUENCY_LABEL, num } from "./types";

/** Curated lifecycle moves — the API accepts any status at any time, so the
 *  UI is the only guard (question-gate Q11). Terminated is final. */
const TRANSITIONS: Record<
  PartnerStatus,
  { to: PartnerStatus; label: string; tone: "accent" | "danger"; needsReason?: boolean }[]
> = {
  pending_approval: [{ to: "active", label: "Activate partner", tone: "accent" }],
  active: [
    { to: "suspended", label: "Suspend", tone: "danger", needsReason: true },
    { to: "terminated", label: "Terminate", tone: "danger" },
  ],
  suspended: [
    { to: "active", label: "Reactivate", tone: "accent" },
    { to: "terminated", label: "Terminate", tone: "danger" },
  ],
  terminated: [],
};

export function PartnerDrawer({
  partnerId,
  onClose,
  onGoToSettlements,
}: {
  partnerId: string | null;
  onClose: () => void;
  onGoToSettlements: (partnerId: string) => void;
}) {
  const can = useAuthStore((s) => s.can);
  const canEdit = can("retail_partners", "edit");
  const canCreate = can("retail_partners", "create");

  const { data: partner, isLoading, isError, error, refetch } =
    usePartnerDetail(partnerId);
  const { setPartnerStatus } = useRpMutations();

  const [editOpen, setEditOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [movementIntent, setMovementIntent] = useState<MovementType | null>(null);
  const [confirm, setConfirm] = useState<{
    to: PartnerStatus;
    label: string;
    needsReason?: boolean;
  } | null>(null);
  const [reason, setReason] = useState("");

  const unitsHeld = useMemo(
    () => (partner?.stock ?? []).reduce((s, r) => s + r.qty_on_hand, 0),
    [partner],
  );

  const applyStatus = () => {
    if (!partner || !confirm) return;
    setPartnerStatus.mutate(
      {
        id: partner.partner_id,
        status: confirm.to,
        ...(confirm.needsReason && reason.trim() ? { reason: reason.trim() } : {}),
      },
      {
        onSuccess: () => {
          setConfirm(null);
          setReason("");
        },
      },
    );
  };

  return (
    <>
      <Drawer
        open={!!partnerId}
        onClose={onClose}
        wide
        leading={
          <span className="grid place-items-center w-10 h-10 rounded-[12px] bg-accent/10 text-accent-glow border border-accent/20 shrink-0">
            <Store className="w-5 h-5" />
          </span>
        }
        title={partner?.display_name ?? "Partner"}
        subtitle={
          partner ? (
            <span className="font-mono">{partner.partner_code}</span>
          ) : undefined
        }
        footer={
          partner && (
            <>
              <span className="mr-auto text-[11px] text-text-faint self-center">
                Updated {fmtDateTime(partner.updated_at)}
              </span>
              {canEdit && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Pencil className="w-3.5 h-3.5" />}
                  onClick={() => setEditOpen(true)}
                >
                  Edit terms
                </Button>
              )}
            </>
          )
        }
      >
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="w-1/2 h-5" />
            <Skeleton className="w-full h-24" />
            <Skeleton className="w-full h-40" />
          </div>
        )}
        {isError && (
          <ErrorState
            message={(error as Error)?.message}
            onRetry={() => refetch()}
          />
        )}

        {partner && (
          <div className="flex flex-col gap-6">
            {/* Status + lifecycle */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <PartnerStatusPill status={partner.status} />
              {partner.status === "suspended" && partner.suspended_reason && (
                <span className="text-[12px] text-text-muted">
                  “{partner.suspended_reason}”
                </span>
              )}
              <span className="flex-1" />
              {canEdit &&
                TRANSITIONS[partner.status].map((t) => (
                  <Button
                    key={t.to + t.label}
                    size="sm"
                    variant={t.tone === "danger" ? "danger" : "secondary"}
                    onClick={() => setConfirm(t)}
                  >
                    {t.label}
                  </Button>
                ))}
            </div>

            {/* Terms */}
            <section>
              <MicroLabel>Commercial terms</MicroLabel>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <TermCard label="Partner margin" value={`${num(partner.margin_share_pct)}%`} />
                <TermCard label="Payment terms" value={`${partner.payment_terms_days} days`} />
                <TermCard
                  label="Settlement"
                  value={FREQUENCY_LABEL[partner.settlement_frequency]}
                />
                <TermCard
                  label="Credit limit"
                  value={
                    partner.credit_limit_ngn ? (
                      <MoneyText ngn={num(partner.credit_limit_ngn)} />
                    ) : (
                      "—"
                    )
                  }
                />
                <TermCard label="Onboarded" value={fmtDate(partner.onboarded_at)} />
                <TermCard label="Units held" value={String(unitsHeld)} />
              </div>
            </section>

            {/* Contact */}
            <section>
              <MicroLabel>Contact</MicroLabel>
              <div className="mt-2 p-3.5 rounded-[13px] border border-line bg-text-primary/[0.02] text-[13px] leading-relaxed">
                <div className="font-semibold">
                  {partner.company_name || partner.display_name}
                </div>
                <div className="text-text-muted">
                  {[partner.primary_phone, partner.email]
                    .filter(Boolean)
                    .join(" · ") || "No phone or email on the contact record."}
                </div>
              </div>
            </section>

            {/* Quick actions */}
            {canCreate && partner.status === "active" && (
              <section className="flex gap-2 flex-wrap">
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Truck className="w-3.5 h-3.5" />}
                  onClick={() => setMovementIntent("dispatch_to_partner")}
                >
                  Dispatch stock
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<BadgeCent className="w-3.5 h-3.5" />}
                  onClick={() => setMovementIntent("partner_sale")}
                >
                  Record sale
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<FileText className="w-3.5 h-3.5" />}
                  onClick={() => onGoToSettlements(partner.partner_id)}
                >
                  Settlements
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </section>
            )}

            {/* Locations */}
            <section>
              <div className="flex items-center gap-2">
                <MicroLabel>Locations ({partner.locations.length})</MicroLabel>
                <span className="flex-1" />
                {canCreate && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Plus className="w-3.5 h-3.5" />}
                    onClick={() => setLocationOpen(true)}
                  >
                    Add location
                  </Button>
                )}
              </div>
              <div className="mt-2 flex flex-col gap-2">
                {partner.locations.length === 0 && (
                  <EmptyState
                    icon={<MapPin className="w-6 h-6" />}
                    title="No locations yet"
                    message="Add the partner's boutique or showroom before dispatching stock."
                    action={
                      canCreate ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setLocationOpen(true)}
                        >
                          Add the first location
                        </Button>
                      ) : undefined
                    }
                  />
                )}
                {partner.locations.map((l) => (
                  <div
                    key={l.consignment_location_id}
                    className="flex items-start gap-3 p-3.5 rounded-[13px] border border-line bg-text-primary/[0.02]"
                  >
                    <MapPin className="w-4 h-4 text-text-faint mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold truncate">
                        {l.display_name}
                      </div>
                      <div className="text-[12px] text-text-muted truncate">
                        {[l.address, l.city, l.state].filter(Boolean).join(", ") ||
                          "No address on file"}
                      </div>
                      {(l.manager_name || l.manager_phone) && (
                        <div className="text-[11.5px] text-text-faint mt-0.5">
                          {[l.manager_name, l.manager_phone]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      )}
                    </div>
                    <Pill tone={l.is_active ? "success" : "neutral"}>
                      {l.is_active ? "Active" : "Inactive"}
                    </Pill>
                  </div>
                ))}
              </div>
            </section>

            {/* Consignment stock at this partner */}
            <section>
              <MicroLabel>On consignment ({partner.stock.length} lines)</MicroLabel>
              <div className="mt-2 overflow-x-auto rounded-[13px] border border-line">
                <table className="w-full border-collapse min-w-[480px]">
                  <thead>
                    <tr>
                      {["Item", "Location", "On hand", "Sold*", "Agreed price"].map(
                        (h, idx) => (
                          <th
                            key={h}
                            className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02]"
                            style={{ textAlign: idx >= 2 ? "right" : "left" }}
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {partner.stock.length === 0 && (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-4 text-center text-[12.5px] text-text-muted"
                        >
                          Nothing on consignment yet.
                        </td>
                      </tr>
                    )}
                    {partner.stock.map((r) => (
                      <tr key={r.consignment_stock_id} className="border-b hairline last:border-0">
                        <td className="p-[10px_14px] text-[13px]">
                          <div className="font-medium truncate max-w-[180px]">
                            {r.variant_name || r.sku || `${r.variant_id.slice(0, 8)}…`}
                          </div>
                          {r.sku && (
                            <div className="text-[11px] text-text-faint font-mono">
                              {r.sku}
                            </div>
                          )}
                        </td>
                        <td className="p-[10px_14px] text-[12.5px] text-text-muted">
                          {r.location_name ?? "—"}
                        </td>
                        <td className="p-[10px_14px] text-right tabular-nums font-semibold">
                          {r.qty_on_hand}
                        </td>
                        <td className="p-[10px_14px] text-right tabular-nums text-text-muted">
                          {r.qty_sold_since_last_settlement}
                        </td>
                        <td className="p-[10px_14px] text-right">
                          {r.agreed_retail_price_ngn ? (
                            <MoneyText ngn={num(r.agreed_retail_price_ngn)} className="text-[13px]" />
                          ) : (
                            <span className="text-text-faint">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[10.5px] text-text-faint mt-1.5">
                *Sold since the last settlement.
              </div>
            </section>

            {/* Notes + audit */}
            {partner.notes && (
              <section>
                <MicroLabel>Notes</MicroLabel>
                <p className="mt-1.5 text-[13px] text-text-muted whitespace-pre-wrap leading-relaxed">
                  {partner.notes}
                </p>
              </section>
            )}
            <div className="text-[11px] text-text-faint">
              Created {fmtDateTime(partner.created_at)} · Updated{" "}
              {fmtDateTime(partner.updated_at)}
            </div>
          </div>
        )}
      </Drawer>

      {/* Edit terms */}
      {partner && (
        <PartnerFormModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          partner={partner}
        />
      )}

      {/* Add location */}
      {partner && (
        <LocationFormModal
          open={locationOpen}
          onClose={() => setLocationOpen(false)}
          partner={partner}
        />
      )}

      {/* Quick movement */}
      {partner && (
        <MovementModal
          open={movementIntent !== null}
          onClose={() => setMovementIntent(null)}
          intent={movementIntent}
          presetPartnerId={partner.partner_id}
        />
      )}

      {/* Plain confirms (activate / reactivate / terminate) */}
      <ConfirmDialog
        open={!!confirm && !confirm.needsReason}
        onClose={() => setConfirm(null)}
        onConfirm={applyStatus}
        title={confirm?.label ?? ""}
        tone={confirm?.to === "active" ? "accent" : "danger"}
        busy={setPartnerStatus.isPending}
        confirmLabel={confirm?.label}
        message={
          confirm?.to === "terminated" ? (
            <>
              Terminating <b>{partner?.display_name}</b> is final — the UI
              offers no way back. Outstanding consignment stock should be
              recalled and settlements closed out first.
            </>
          ) : (
            <>
              {confirm?.label} <b>{partner?.display_name}</b>?
            </>
          )
        }
      />

      {/* Suspend (reason required) */}
      <Modal
        open={!!confirm?.needsReason}
        onClose={() => setConfirm(null)}
        title={`Suspend ${partner?.display_name ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={applyStatus}
              disabled={!reason.trim() || setPartnerStatus.isPending}
            >
              {setPartnerStatus.isPending ? "Suspending…" : "Suspend partner"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-muted">
            Dispatches and sales stop while a partner is suspended. The reason
            is stored on the record.
          </p>
          <div>
            <FieldLabel>Reason *</FieldLabel>
            <TextInput
              value={reason}
              onChange={setReason}
              placeholder="e.g. Unpaid settlement PXG-SET-0007"
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

function TermCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="p-3 rounded-[13px] border border-line bg-text-primary/[0.02]">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-faint">
        {label}
      </div>
      <div className="mt-1 text-[15px] font-display font-medium tabular-nums">
        {value}
      </div>
    </div>
  );
}
