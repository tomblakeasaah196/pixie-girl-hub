import { useState, useMemo, useCallback } from "react";
import {
  ClipboardCheck,
  Plus,
  Trash2,
  ShieldCheck,
  ShieldX,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { ErrorState, Select, NumberField, ConfirmDialog } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { useAuthStore } from "@/stores/auth";
import {
  useStockAdjustments,
  useStockLocations,
  useStockLevels,
  useStockMutations,
} from "./hooks";
import type { StockAdjustment, StockLevel } from "./types";
import {
  StatusPill,
  SearchBox,
  FieldLabel,
  TextInput,
  InfoBanner,
  Pagination,
  TableSkeleton,
} from "./parts";

/* ─── Constants ─── */

const ADJUSTMENT_TYPE_TONE: Record<string, "info" | "warn" | "danger" | "success" | "accent" | "neutral"> = {
  count: "info",
  damage: "danger",
  theft: "danger",
  found: "success",
  lost: "warn",
  tester_display: "neutral",
  quality_reject: "warn",
  write_off: "danger",
};

const WRITEOFF_REASONS = [
  { value: "damaged", label: "Damaged" },
  { value: "lost", label: "Lost" },
  { value: "tester_display", label: "Tester / Display" },
  { value: "quality_reject", label: "Quality Reject" },
  { value: "theft", label: "Theft" },
] as const;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "posted", label: "Posted" },
  { value: "rejected", label: "Rejected" },
];

const PAGE_SIZE = 20;

/* ─── Helper ─── */

function sumDelta(adj: StockAdjustment): number {
  return (adj.lines ?? []).reduce((s, l) => s + l.delta, 0);
}

/* ─── Writeoff Line ─── */

interface WriteoffLineInput {
  variant_id: string;
  qty: string;
  notes: string;
}

/* ─── Main Component ─── */

export default function AdjustmentsTab() {
  const { can, user } = useAuthStore();
  const canCreate = can("stock", "create");
  const isCeo = user?.isCeo ?? false;

  /* filters & pagination */
  const [statusFilter, setStatusFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [page, setPage] = useState(1);

  /* drawers */
  const [stocktakeOpen, setStocktakeOpen] = useState(false);
  const [writeoffOpen, setWriteoffOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);

  /* data */
  const locationsQ = useStockLocations();
  const locations = locationsQ.data ?? [];
  const locationOptions = useMemo(
    () => [
      { value: "", label: "All locations" },
      ...locations.map((l) => ({ value: l.location_id, label: l.display_name })),
    ],
    [locations],
  );

  const adjustmentsQ = useStockAdjustments({
    status: statusFilter || undefined,
    location_id: locationFilter || undefined,
    page,
    page_size: PAGE_SIZE,
  });
  const adjustments = adjustmentsQ.data?.data ?? [];
  const meta = adjustmentsQ.data?.meta;

  /* approval queue (CEO only) */
  const approvalQ = useStockAdjustments({
    status: "submitted",
    page: 1,
    page_size: 50,
  });
  const pendingApprovals = approvalQ.data?.data ?? [];

  /* mutations */
  const mutations = useStockMutations();

  /* ─── Approve / Reject handlers ─── */

  const handleApprove = useCallback(
    async (id: string) => {
      await mutations.approveAdjustment.mutateAsync(id);
      await mutations.postAdjustment.mutateAsync(id);
    },
    [mutations],
  );

  const handleReject = useCallback(
    async () => {
      if (!rejectTarget) return;
      await mutations.rejectAdjustment.mutateAsync(rejectTarget);
      setRejectTarget(null);
    },
    [rejectTarget, mutations],
  );

  /* ─── Columns ─── */

  const locationMap = useMemo(() => {
    const m: Record<string, string> = {};
    locations.forEach((l) => (m[l.location_id] = l.display_name));
    return m;
  }, [locations]);

  const columns: Column<StockAdjustment>[] = [
    {
      key: "adjustment_number",
      header: "Adjustment Ref",
      render: (r) => (
        <span className="font-mono text-[13px] text-text-primary">{r.adjustment_number}</span>
      ),
    },
    {
      key: "adjustment_type",
      header: "Type",
      render: (r) => (
        <Pill tone={ADJUSTMENT_TYPE_TONE[r.adjustment_type] ?? "neutral"}>
          {r.adjustment_type.replace(/_/g, " ")}
        </Pill>
      ),
    },
    {
      key: "location_id",
      header: "Location",
      render: (r) => (
        <span className="text-[13px] text-text-secondary">
          {locationMap[r.location_id] ?? r.location_id}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
    {
      key: "lines",
      header: "Lines",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-[13px] text-text-secondary">
          {(r.lines ?? []).length}
        </span>
      ),
    },
    {
      key: "variance",
      header: "Variance",
      align: "right",
      render: (r) => {
        const d = sumDelta(r);
        return (
          <span
            className={`tabular-nums text-[13px] font-semibold ${
              d > 0 ? "text-success" : d < 0 ? "text-danger" : "text-text-muted"
            }`}
          >
            {d > 0 ? `+${d}` : d}
          </span>
        );
      },
    },
    {
      key: "created_at",
      header: "Created",
      render: (r) => (
        <span className="text-[12px] text-text-faint tabular-nums">
          {new Date(r.created_at).toLocaleDateString()}
        </span>
      ),
    },
  ];

  /* ─── Render ─── */

  if (adjustmentsQ.isError) {
    return <ErrorState message="Failed to load adjustments." onRetry={() => adjustmentsQ.refetch()} />;
  }

  return (
    <div className="space-y-6">
      {/* ── CEO Approval Queue ── */}
      {isCeo && pendingApprovals.length > 0 && (
        <Card className="p-5 space-y-4">
          <h3 className="text-[14px] font-semibold text-text-primary flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-accent" />
            Awaiting Approval ({pendingApprovals.length})
          </h3>
          <div className="space-y-2">
            {pendingApprovals.map((adj) => (
              <div
                key={adj.adjustment_id}
                className="flex items-center justify-between gap-4 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-[13px] text-text-primary">
                    {adj.adjustment_number}
                  </span>
                  <Pill tone={ADJUSTMENT_TYPE_TONE[adj.adjustment_type] ?? "neutral"}>
                    {adj.adjustment_type.replace(/_/g, " ")}
                  </Pill>
                  <span className="text-[12px] text-text-muted truncate">
                    {locationMap[adj.location_id] ?? adj.location_id}
                  </span>
                  <span
                    className={`tabular-nums text-[13px] font-semibold ${
                      sumDelta(adj) < 0 ? "text-danger" : "text-success"
                    }`}
                  >
                    {sumDelta(adj) > 0 ? `+${sumDelta(adj)}` : sumDelta(adj)}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<ShieldCheck className="w-3.5 h-3.5" />}
                    onClick={() => handleApprove(adj.adjustment_id)}
                    disabled={mutations.approveAdjustment.isPending || mutations.postAdjustment.isPending}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<ShieldX className="w-3.5 h-3.5" />}
                    onClick={() => setRejectTarget(adj.adjustment_id)}
                    disabled={mutations.rejectAdjustment.isPending}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
        <Select value={locationFilter} onChange={setLocationFilter} options={locationOptions} />
        <div className="flex-1" />
        {canCreate && (
          <>
            <Button
              variant="primary"
              size="sm"
              icon={<ClipboardCheck className="w-4 h-4" />}
              onClick={() => setStocktakeOpen(true)}
            >
              New Stocktake
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 className="w-4 h-4" />}
              onClick={() => setWriteoffOpen(true)}
            >
              Log Write-off
            </Button>
          </>
        )}
      </div>

      {/* ── Table ── */}
      <DataTable
        columns={columns}
        rows={adjustments}
        rowKey={(r) => r.adjustment_id}
        loading={adjustmentsQ.isLoading}
        empty={{
          icon: <ClipboardCheck className="w-10 h-10" />,
          title: "No adjustments found",
          message: "Stock adjustments and stocktakes will appear here.",
        }}
      />
      {meta && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={meta.total} onChange={setPage} />
      )}

      {/* ── Reject confirm dialog ── */}
      <ConfirmDialog
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleReject}
        title="Reject Adjustment"
        message="Are you sure you want to reject this adjustment? This action cannot be undone."
        confirmLabel="Reject"
        tone="danger"
        busy={mutations.rejectAdjustment.isPending}
      />

      {/* ── Stocktake Drawer ── */}
      <StocktakeDrawer
        open={stocktakeOpen}
        onClose={() => setStocktakeOpen(false)}
        locations={locations}
        mutations={mutations}
      />

      {/* ── Write-off Drawer ── */}
      <WriteoffDrawer
        open={writeoffOpen}
        onClose={() => setWriteoffOpen(false)}
        locations={locations}
        mutations={mutations}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════
   Stocktake Drawer (multi-step)
   ═══════════════════════════════════════════ */

function StocktakeDrawer({
  open,
  onClose,
  locations,
  mutations,
}: {
  open: boolean;
  onClose: () => void;
  locations: { location_id: string; display_name: string }[];
  mutations: ReturnType<typeof useStockMutations>;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [countPage, setCountPage] = useState(1);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const locationOptions = useMemo(
    () => [
      { value: "", label: "Select location" },
      ...locations.map((l) => ({ value: l.location_id, label: l.display_name })),
    ],
    [locations],
  );

  /* stock levels at selected location */
  const levelsQ = useStockLevels({
    location_id: locationId || undefined,
    page: countPage,
    page_size: PAGE_SIZE,
  });
  const levels: StockLevel[] = Array.isArray(levelsQ.data) ? levelsQ.data : (levelsQ.data as any)?.data ?? [];

  const filteredLevels = useMemo(() => {
    if (!search) return levels;
    const q = search.toLowerCase();
    return levels.filter(
      (l) =>
        (l.sku ?? "").toLowerCase().includes(q) ||
        (l.variant_name ?? "").toLowerCase().includes(q),
    );
  }, [levels, search]);

  /* summary for step 3 */
  const summary = useMemo(() => {
    let surplus = 0;
    let writeDown = 0;
    let lineCount = 0;
    for (const lv of levels) {
      const physical = counts[lv.variant_id];
      if (physical === undefined || physical === "") continue;
      const p = Number(physical);
      const d = p - lv.on_hand;
      if (d !== 0) {
        lineCount++;
        if (d > 0) surplus += d;
        else writeDown += Math.abs(d);
      }
    }
    return { lineCount, surplus, writeDown, hasWriteDown: writeDown > 0 };
  }, [levels, counts]);

  const reset = () => {
    setStep(1);
    setLocationId("");
    setNote("");
    setSearch("");
    setCountPage(1);
    setCounts({});
    setSubmitting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const lines = levels
        .filter((lv) => {
          const p = counts[lv.variant_id];
          return p !== undefined && p !== "" && Number(p) !== lv.on_hand;
        })
        .map((lv) => ({
          variant_id: lv.variant_id,
          system_count: lv.on_hand,
          physical_count: Number(counts[lv.variant_id]),
        }));

      const adj = await mutations.createAdjustment.mutateAsync({
        location_id: locationId,
        adjustment_type: "count",
        reason: note || "Stocktake",
        lines,
      });

      if (summary.hasWriteDown) {
        await mutations.submitAdjustment.mutateAsync(adj.adjustment_id);
      } else {
        await mutations.postAdjustment.mutateAsync(adj.adjustment_id);
      }

      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  const stepFooter = (
    <div className="flex items-center justify-between w-full">
      <div>
        {step > 1 && (
          <Button
            variant="ghost"
            size="sm"
            icon={<ChevronLeft className="w-4 h-4" />}
            onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
          >
            Back
          </Button>
        )}
      </div>
      <div>
        {step === 1 && (
          <Button
            variant="primary"
            size="sm"
            disabled={!locationId}
            icon={<ChevronRight className="w-4 h-4" />}
            onClick={() => setStep(2)}
          >
            Start Count
          </Button>
        )}
        {step === 2 && (
          <Button
            variant="primary"
            size="sm"
            icon={<ChevronRight className="w-4 h-4" />}
            onClick={() => setStep(3)}
          >
            Review
          </Button>
        )}
        {step === 3 && (
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || summary.lineCount === 0}
          >
            {summary.hasWriteDown ? "Submit for Approval" : "Post Immediately"}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="New Stocktake"
      subtitle={`Step ${step} of 3`}
      wide
      footer={stepFooter}
    >
      {/* Step 1 — Setup */}
      {step === 1 && (
        <div className="space-y-5 p-1">
          <InfoBanner>
            <AlertTriangle className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />
            Active sales during a count may cause discrepancies. Consider pausing POS sales at this
            location while counting.
          </InfoBanner>
          <div>
            <FieldLabel>Location</FieldLabel>
            <Select value={locationId} onChange={setLocationId} options={locationOptions} />
          </div>
          <div>
            <FieldLabel>Note / Reference</FieldLabel>
            <TextInput value={note} onChange={setNote} placeholder="e.g. Monthly stocktake June" />
          </div>
        </div>
      )}

      {/* Step 2 — Count Entry */}
      {step === 2 && (
        <div className="space-y-4 p-1">
          <SearchBox value={search} onChange={setSearch} placeholder="Filter by SKU or name..." />
          <div className="overflow-x-auto rounded-[11px] border border-line">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-text-muted text-[11px] uppercase tracking-wider">
                  <th className="px-4 py-2.5">SKU</th>
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5 text-right">System Count</th>
                  <th className="px-4 py-2.5 text-right">Physical Count</th>
                </tr>
              </thead>
              <tbody>
                {levelsQ.isLoading ? (
                  <TableSkeleton cols={4} rows={8} />
                ) : (
                  filteredLevels.map((lv) => {
                    const physical = counts[lv.variant_id] ?? "";
                    const p = physical === "" ? lv.on_hand : Number(physical);
                    const diff = p - lv.on_hand;
                    let rowColor = "";
                    if (physical !== "") {
                      if (diff < 0) rowColor = "bg-danger/[0.06]";
                      else if (diff > 0) rowColor = "bg-success/[0.06]";
                    }
                    return (
                      <tr key={lv.variant_id} className={`border-b border-line ${rowColor}`}>
                        <td className="px-4 py-2.5 font-mono text-text-secondary">
                          {lv.sku ?? lv.variant_id.slice(0, 8)}
                        </td>
                        <td className="px-4 py-2.5 text-text-primary">
                          {lv.variant_name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-text-muted">
                          {lv.on_hand}
                        </td>
                        <td className="px-4 py-2.5 text-right w-[120px]">
                          <NumberField
                            value={physical}
                            onChange={(v) =>
                              setCounts((prev) => ({ ...prev, [lv.variant_id]: v }))
                            }
                            placeholder={String(lv.on_hand)}
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {/* Pagination for count page if levels are paginated */}
          {(levelsQ.data as any)?.meta && (
            <Pagination
              page={countPage}
              pageSize={PAGE_SIZE}
              total={(levelsQ.data as any).meta.total}
              onChange={setCountPage}
            />
          )}
        </div>
      )}

      {/* Step 3 — Review */}
      {step === 3 && (
        <div className="space-y-5 p-1">
          <div className="grid grid-cols-3 gap-4">
            <Card className="p-4 text-center">
              <p className="text-[11px] text-text-muted uppercase tracking-wider">Lines</p>
              <p className="text-[22px] font-bold tabular-nums text-text-primary">
                {summary.lineCount}
              </p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-[11px] text-text-muted uppercase tracking-wider">Surplus</p>
              <p className="text-[22px] font-bold tabular-nums text-success">+{summary.surplus}</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-[11px] text-text-muted uppercase tracking-wider">Write-down</p>
              <p className="text-[22px] font-bold tabular-nums text-danger">
                -{summary.writeDown}
              </p>
            </Card>
          </div>

          {summary.hasWriteDown && (
            <InfoBanner>
              Write-downs require CEO approval. This adjustment will be submitted for review before
              stock levels are updated.
            </InfoBanner>
          )}

          {summary.lineCount === 0 && (
            <InfoBanner>No differences detected. Go back and enter physical counts.</InfoBanner>
          )}
        </div>
      )}
    </Drawer>
  );
}

/* ═══════════════════════════════════════════
   Write-off Drawer
   ═══════════════════════════════════════════ */

function WriteoffDrawer({
  open,
  onClose,
  locations,
  mutations,
}: {
  open: boolean;
  onClose: () => void;
  locations: { location_id: string; display_name: string }[];
  mutations: ReturnType<typeof useStockMutations>;
}) {
  const [locationId, setLocationId] = useState("");
  const [reason, setReason] = useState<string>("");
  const [lines, setLines] = useState<WriteoffLineInput[]>([
    { variant_id: "", qty: "", notes: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const locationOptions = useMemo(
    () => [
      { value: "", label: "Select location" },
      ...locations.map((l) => ({ value: l.location_id, label: l.display_name })),
    ],
    [locations],
  );

  const reasonOptions = [
    { value: "", label: "Select reason" },
    ...WRITEOFF_REASONS.map((r) => ({ value: r.value, label: r.label })),
  ];

  const updateLine = (idx: number, patch: Partial<WriteoffLineInput>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addLine = () => {
    setLines((prev) => [...prev, { variant_id: "", qty: "", notes: "" }]);
  };

  const removeLine = (idx: number) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const reset = () => {
    setLocationId("");
    setReason("");
    setLines([{ variant_id: "", qty: "", notes: "" }]);
    setSubmitting(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const canSubmit =
    locationId &&
    reason &&
    lines.length > 0 &&
    lines.every((l) => l.variant_id && l.qty && Number(l.qty) > 0);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const adjLines = lines.map((l) => ({
        variant_id: l.variant_id,
        system_count: 0,
        physical_count: 0,
        delta: -Math.abs(Number(l.qty)),
        notes: l.notes || undefined,
      }));

      const adj = await mutations.createAdjustment.mutateAsync({
        location_id: locationId,
        adjustment_type: reason,
        reason: `Write-off: ${reason.replace(/_/g, " ")}`,
        lines: adjLines,
      });

      await mutations.submitAdjustment.mutateAsync(adj.adjustment_id);
      handleClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Log Write-off"
      footer={
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          Submit for Approval
        </Button>
      }
    >
      <div className="space-y-5 p-1">
        <InfoBanner>
          Write-offs cannot be posted without CEO approval. All items will be submitted for review.
        </InfoBanner>

        <div>
          <FieldLabel>Location</FieldLabel>
          <Select value={locationId} onChange={setLocationId} options={locationOptions} />
        </div>

        <div>
          <FieldLabel>Reason</FieldLabel>
          <Select value={reason} onChange={setReason} options={reasonOptions} />
        </div>

        <div className="space-y-3">
          <FieldLabel>Line Items</FieldLabel>
          {lines.map((line, idx) => (
            <div
              key={idx}
              className="flex items-start gap-3 p-3 rounded-[11px] bg-text-primary/[0.03] border border-line"
            >
              <div className="flex-1 space-y-2">
                <TextInput
                  value={line.variant_id}
                  onChange={(v) => updateLine(idx, { variant_id: v })}
                  placeholder="Variant ID"
                />
                <div className="flex gap-2">
                  <div className="w-[100px]">
                    <NumberField
                      value={line.qty}
                      onChange={(v) => updateLine(idx, { qty: v })}
                      placeholder="Qty"
                    />
                  </div>
                  <div className="flex-1">
                    <TextInput
                      value={line.notes}
                      onChange={(v) => updateLine(idx, { notes: v })}
                      placeholder="Notes (optional)"
                    />
                  </div>
                </div>
              </div>
              {lines.length > 1 && (
                <button
                  onClick={() => removeLine(idx)}
                  className="mt-1 p-1.5 rounded-lg text-text-faint hover:text-danger hover:bg-danger/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={addLine}>
            Add Line
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
