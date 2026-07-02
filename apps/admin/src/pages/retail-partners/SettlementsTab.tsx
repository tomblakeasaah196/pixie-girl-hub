import { useEffect, useMemo, useState } from "react";
import { FileText, Plus, ChevronRight, CheckCircle2, Banknote } from "lucide-react";
import { Button, MoneyText, Skeleton } from "@/components/ui/primitives";
import type { Column } from "@/components/ui/DataTable";
import { Select, ConfirmDialog, ErrorState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Drawer } from "@/components/ui/Drawer";
import { useAuthStore } from "@/stores/auth";
import {
  useSettlements,
  useSettlementDetail,
  useConsignmentMovements,
  usePartners,
  useRpMutations,
} from "./hooks";
import {
  FieldLabel,
  TextInput,
  InfoBanner,
  ResponsiveTable,
  SettlementStatusPill,
  MicroLabel,
} from "./parts";
import { fmtDate, fmtDateTime, isoDay } from "./format";
import type { PartnerSettlement, SettlementStatus } from "./types";
import { SETTLEMENT_STATUS_LABEL, num } from "./types";

const STATUS_OPTS = [
  { value: "", label: "All statuses" },
  ...(Object.keys(SETTLEMENT_STATUS_LABEL) as SettlementStatus[]).map((s) => ({
    value: s as string,
    label: SETTLEMENT_STATUS_LABEL[s],
  })),
];

/** First/last day of the previous month — the natural settlement period. */
function previousMonthRange(): { start: string; end: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start: isoDay(first), end: isoDay(last) };
}

/* ── Generate settlement ───────────────────────────────────────────── */
function GenerateModal({
  open,
  onClose,
  presetPartnerId,
}: {
  open: boolean;
  onClose: () => void;
  presetPartnerId?: string | null;
}) {
  const { data: partners = [] } = usePartners();
  const { generateSettlement } = useRpMutations();

  const [partnerId, setPartnerId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (!open) return;
    const range = previousMonthRange();
    setPartnerId(presetPartnerId ?? "");
    setStart(range.start);
    setEnd(range.end);
    generateSettlement.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetPartnerId]);

  // Preview: the partner's unsettled sale/return/damage movements in period.
  const { data: unsettled = [], isLoading: previewLoading } =
    useConsignmentMovements(partnerId ? { partner_id: partnerId, settled: false } : {});
  const preview = useMemo(() => {
    if (!partnerId || !start || !end) return null;
    const inPeriod = unsettled.filter((m) => {
      const day = m.recorded_at.slice(0, 10);
      return (
        day >= start &&
        day <= end &&
        ["partner_sale", "partner_return", "partner_damage"].includes(
          m.movement_type,
        )
      );
    });
    const gross = inPeriod
      .filter((m) => m.movement_type === "partner_sale")
      .reduce((s, m) => s + Math.abs(m.quantity) * num(m.unit_retail_price_ngn), 0);
    const partnerShare = inPeriod
      .filter((m) => m.movement_type === "partner_sale")
      .reduce((s, m) => s + num(m.partner_share_ngn), 0);
    return { count: inPeriod.length, gross, partnerShare };
  }, [unsettled, partnerId, start, end]);

  const rangeBad = !!start && !!end && end < start;
  const canGenerate =
    !!partnerId && !!start && !!end && !rangeBad && (preview?.count ?? 0) > 0;

  const submit = () => {
    if (!canGenerate) return;
    generateSettlement.mutate(
      { partner_id: partnerId, period_start: start, period_end: end },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate settlement"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!canGenerate || generateSettlement.isPending}
          >
            {generateSettlement.isPending ? "Generating…" : "Generate"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12.5px] text-text-muted -mt-1">
          Rolls the partner's unsettled sales, returns and damages in the
          period into one statement: what they owe you, and what they keep.
        </p>
        <div>
          <FieldLabel>Partner</FieldLabel>
          <Select
            value={partnerId}
            onChange={setPartnerId}
            options={[
              { value: "", label: "Choose a partner…" },
              ...partners.map((p) => ({
                value: p.partner_id,
                label: p.display_name,
              })),
            ]}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel>Period start</FieldLabel>
            <TextInput value={start} onChange={setStart} type="date" />
          </div>
          <div>
            <FieldLabel>Period end</FieldLabel>
            <TextInput value={end} onChange={setEnd} type="date" />
          </div>
        </div>
        {rangeBad && (
          <InfoBanner tone="warn">
            The period end must be on or after the start.
          </InfoBanner>
        )}

        {partnerId && !rangeBad && (
          <div className="p-3.5 rounded-[13px] border border-line bg-text-primary/[0.02]">
            {previewLoading ? (
              <Skeleton className="w-2/3" />
            ) : preview && preview.count > 0 ? (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-text-faint">
                    Movements
                  </div>
                  <div className="text-[17px] font-display font-medium tabular-nums">
                    {preview.count}
                  </div>
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-text-faint">
                    Est. gross sales
                  </div>
                  <MoneyText ngn={preview.gross} className="text-[15px]" />
                </div>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wide text-text-faint">
                    Est. partner share
                  </div>
                  <MoneyText ngn={preview.partnerShare} className="text-[15px]" />
                </div>
              </div>
            ) : (
              <div className="text-[12.5px] text-text-muted">
                No unsettled sales, returns or damages in this period — nothing
                to settle yet.
              </div>
            )}
          </div>
        )}

        {generateSettlement.isError && (
          <InfoBanner tone="warn">
            {(generateSettlement.error as Error)?.message ||
              "Could not generate the settlement."}
          </InfoBanner>
        )}
      </div>
    </Modal>
  );
}

/* ── Settlement detail drawer ──────────────────────────────────────── */
function SettlementDrawer({
  settlementId,
  onClose,
}: {
  settlementId: string | null;
  onClose: () => void;
}) {
  const can = useAuthStore((s) => s.can);
  const canApprove = can("retail_partners", "approve");

  const { data: s, isLoading, isError, error, refetch } =
    useSettlementDetail(settlementId);
  const { approveSettlement, markSettlementPaid } = useRpMutations();

  const [approveOpen, setApproveOpen] = useState(false);
  const [paidOpen, setPaidOpen] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");

  const canApproveNow =
    !!s && canApprove && (s.status === "draft" || s.status === "reviewed");
  const canPayNow =
    !!s && canApprove && (s.status === "approved" || s.status === "invoiced");

  return (
    <>
      <Drawer
        open={!!settlementId}
        onClose={onClose}
        wide
        title={s?.settlement_number ?? "Settlement"}
        subtitle={
          s ? (
            <>
              {s.partner_name ?? "Partner"} · {fmtDate(s.period_start)} –{" "}
              {fmtDate(s.period_end)}
            </>
          ) : undefined
        }
        footer={
          s && (
            <>
              <span className="mr-auto self-center">
                <SettlementStatusPill status={s.status} />
              </span>
              {canApproveNow && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                  onClick={() => setApproveOpen(true)}
                >
                  Approve
                </Button>
              )}
              {canPayNow && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Banknote className="w-3.5 h-3.5" />}
                  onClick={() => setPaidOpen(true)}
                >
                  Mark paid
                </Button>
              )}
            </>
          )
        }
      >
        {isLoading && (
          <div className="space-y-4">
            <Skeleton className="w-1/2 h-5" />
            <Skeleton className="w-full h-28" />
            <Skeleton className="w-full h-44" />
          </div>
        )}
        {isError && (
          <ErrorState message={(error as Error)?.message} onRetry={() => refetch()} />
        )}
        {s && (
          <div className="flex flex-col gap-6">
            {/* Totals */}
            <section>
              <MicroLabel>Totals</MicroLabel>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <TotalCard label="Gross sales" ngn={num(s.total_gross_sales_ngn)} />
                <TotalCard label="Returns" ngn={num(s.total_returns_ngn)} />
                <TotalCard label="Net sales" ngn={num(s.total_net_sales_ngn)} />
                <TotalCard
                  label="Partner keeps"
                  ngn={num(s.total_partner_share_ngn)}
                  strong
                />
                <TotalCard label="Our share" ngn={num(s.total_brand_share_ngn)} strong />
                <TotalCard label="Damages" ngn={num(s.total_damages_ngn)} />
              </div>
              <div className="mt-2 text-[12px] text-text-muted">
                {s.units_sold} sold · {s.units_returned} returned
              </div>
            </section>

            {/* Lines */}
            <section>
              <MicroLabel>Lines ({s.lines.length})</MicroLabel>
              <div className="mt-2 overflow-x-auto rounded-[13px] border border-line">
                <table className="w-full border-collapse min-w-[560px]">
                  <thead>
                    <tr>
                      {["Item", "Location", "Sold", "Ret.", "Dmg.", "Gross", "Partner share"].map(
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
                    {s.lines.map((l) => (
                      <tr key={l.line_id} className="border-b hairline last:border-0">
                        <td className="p-[10px_14px] text-[13px]">
                          <div className="font-medium truncate max-w-[180px]">
                            {l.variant_name || l.sku || (l.variant_id ? `${l.variant_id.slice(0, 8)}…` : "—")}
                          </div>
                          {l.sku && (
                            <div className="text-[11px] text-text-faint font-mono">
                              {l.sku}
                            </div>
                          )}
                        </td>
                        <td className="p-[10px_14px] text-[12.5px] text-text-muted">
                          {l.location_name ?? "—"}
                        </td>
                        <td className="p-[10px_14px] text-right tabular-nums">
                          {l.units_sold}
                        </td>
                        <td className="p-[10px_14px] text-right tabular-nums text-text-muted">
                          {l.units_returned}
                        </td>
                        <td className="p-[10px_14px] text-right tabular-nums text-text-muted">
                          {l.units_damaged}
                        </td>
                        <td className="p-[10px_14px] text-right">
                          <MoneyText ngn={num(l.gross_sales_ngn)} className="text-[13px]" />
                        </td>
                        <td className="p-[10px_14px] text-right">
                          <MoneyText ngn={num(l.partner_share_ngn)} className="text-[13px]" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Trail */}
            <section className="text-[12px] text-text-muted flex flex-col gap-1">
              <div>Created {fmtDateTime(s.created_at)}</div>
              {s.approved_at && <div>Approved {fmtDateTime(s.approved_at)}</div>}
              {s.paid_at && (
                <div>
                  Paid {fmtDateTime(s.paid_at)}
                  {s.payment_reference && (
                    <>
                      {" · ref "}
                      <span className="font-mono">{s.payment_reference}</span>
                    </>
                  )}
                </div>
              )}
              {s.notes && <div className="text-text-faint">“{s.notes}”</div>}
            </section>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        onConfirm={() =>
          s &&
          approveSettlement.mutate(s.settlement_id, {
            onSuccess: () => setApproveOpen(false),
          })
        }
        title="Approve settlement"
        tone="accent"
        busy={approveSettlement.isPending}
        confirmLabel="Approve"
        message={
          <>
            Approve <b>{s?.settlement_number}</b>? The partner keeps{" "}
            <b>₦{num(s?.total_partner_share_ngn).toLocaleString("en-NG")}</b> of{" "}
            ₦{num(s?.total_gross_sales_ngn).toLocaleString("en-NG")} gross.
            Approved settlements are read-only.
          </>
        }
      />

      <Modal
        open={paidOpen}
        onClose={() => setPaidOpen(false)}
        title={`Mark ${s?.settlement_number ?? ""} paid`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaidOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() =>
                s &&
                markSettlementPaid.mutate(
                  {
                    id: s.settlement_id,
                    ...(paymentRef.trim()
                      ? { payment_reference: paymentRef.trim() }
                      : {}),
                  },
                  {
                    onSuccess: () => {
                      setPaidOpen(false);
                      setPaymentRef("");
                    },
                  },
                )
              }
              disabled={markSettlementPaid.isPending}
            >
              {markSettlementPaid.isPending ? "Saving…" : "Mark paid"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-muted">
            Confirms the partner's share has been settled. Add the transfer
            reference so Finance can trace it.
          </p>
          <div>
            <FieldLabel>Payment reference (optional)</FieldLabel>
            <TextInput
              value={paymentRef}
              onChange={setPaymentRef}
              placeholder="Bank transfer ref"
            />
          </div>
          {markSettlementPaid.isError && (
            <InfoBanner tone="warn">
              {(markSettlementPaid.error as Error)?.message ||
                "Could not mark as paid."}
            </InfoBanner>
          )}
        </div>
      </Modal>
    </>
  );
}

function TotalCard({
  label,
  ngn,
  strong,
}: {
  label: string;
  ngn: number;
  strong?: boolean;
}) {
  return (
    <div
      className={`p-3 rounded-[13px] border ${
        strong ? "border-accent/30 bg-accent/[0.05]" : "border-line bg-text-primary/[0.02]"
      }`}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-faint">
        {label}
      </div>
      <div className="mt-1">
        <MoneyText ngn={ngn} className="text-[16px]" />
      </div>
    </div>
  );
}

/* ── SettlementsTab ────────────────────────────────────────────────── */
export default function SettlementsTab({
  partnerFilter,
  onPartnerFilterChange,
}: {
  partnerFilter: string;
  onPartnerFilterChange: (id: string) => void;
}) {
  const can = useAuthStore((s) => s.can);
  const canCreate = can("retail_partners", "create");

  const [statusFilter, setStatusFilter] = useState("");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [openSettlementId, setOpenSettlementId] = useState<string | null>(null);

  const { data: partners = [] } = usePartners();
  const { data: settlements = [], isLoading, isError, error, refetch } =
    useSettlements({
      ...(partnerFilter ? { partner_id: partnerFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    });

  const partnerOpts = useMemo(
    () => [
      { value: "", label: "All partners" },
      ...partners.map((p) => ({ value: p.partner_id, label: p.display_name })),
    ],
    [partners],
  );

  const columns: Column<PartnerSettlement>[] = useMemo(
    () => [
      {
        key: "number",
        header: "Number",
        width: "150px",
        render: (s) => (
          <span className="font-mono text-[12px] text-accent-glow">
            {s.settlement_number}
          </span>
        ),
      },
      {
        key: "partner",
        header: "Partner",
        render: (s) => (
          <span className="text-[13px] truncate block max-w-[190px]">
            {s.partner_name ?? "—"}
          </span>
        ),
      },
      {
        key: "period",
        header: "Period",
        width: "190px",
        render: (s) => (
          <span className="text-[12.5px] text-text-muted">
            {fmtDate(s.period_start)} – {fmtDate(s.period_end)}
          </span>
        ),
      },
      {
        key: "units",
        header: "Sold",
        width: "70px",
        align: "right",
        render: (s) => <span className="tabular-nums">{s.units_sold}</span>,
      },
      {
        key: "gross",
        header: "Gross",
        width: "125px",
        align: "right",
        render: (s) => (
          <MoneyText ngn={num(s.total_gross_sales_ngn)} className="text-[13px]" />
        ),
      },
      {
        key: "share",
        header: "Partner share",
        width: "130px",
        align: "right",
        render: (s) => (
          <MoneyText ngn={num(s.total_partner_share_ngn)} className="text-[13px]" />
        ),
      },
      {
        key: "status",
        header: "Status",
        width: "120px",
        render: (s) => <SettlementStatusPill status={s.status} />,
      },
      {
        key: "chev",
        header: "",
        width: "40px",
        render: () => <ChevronRight className="w-4 h-4 text-text-faint" />,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={partnerFilter}
          onChange={onPartnerFilterChange}
          options={partnerOpts}
          className="w-[220px]"
        />
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_OPTS}
          className="w-[180px]"
        />
        <div className="flex-1" />
        {canCreate && (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setGenerateOpen(true)}
          >
            Generate settlement
          </Button>
        )}
      </div>

      <ResponsiveTable<PartnerSettlement>
        columns={columns}
        rows={settlements}
        rowKey={(s) => s.settlement_id}
        onRowClick={(s) => setOpenSettlementId(s.settlement_id)}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => refetch()}
        empty={{
          icon: <FileText className="w-6 h-6" />,
          title: "No settlements yet",
          message:
            "Generate a settlement to roll a partner's unsettled sales into a statement you can approve and pay.",
          action: canCreate ? (
            <Button variant="primary" onClick={() => setGenerateOpen(true)}>
              Generate settlement
            </Button>
          ) : undefined,
        }}
        card={(s) => (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold truncate">
                {s.partner_name ?? s.settlement_number}
              </div>
              <div className="text-[11.5px] text-text-faint font-mono">
                {s.settlement_number}
              </div>
              <div className="text-[12px] text-text-muted mt-0.5">
                {fmtDate(s.period_start)} – {fmtDate(s.period_end)}
              </div>
            </div>
            <div className="text-right shrink-0">
              <MoneyText
                ngn={num(s.total_partner_share_ngn)}
                className="text-[14px]"
              />
              <div className="mt-1">
                <SettlementStatusPill status={s.status} />
              </div>
            </div>
          </div>
        )}
      />

      <GenerateModal
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        presetPartnerId={partnerFilter || null}
      />
      <SettlementDrawer
        settlementId={openSettlementId}
        onClose={() => setOpenSettlementId(null)}
      />
    </div>
  );
}
