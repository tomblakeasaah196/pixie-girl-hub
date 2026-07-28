import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUrlTab } from "@/hooks/useUrlTab";
import { useDeepLinkedRecord } from "@/hooks/useDeepLinkedRecord";
import {
  ShoppingCart,
  Building2,
  FileText,
  TrendingUp,
  Plus,
  ListPlus,
  Lock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Package,
  PackageCheck,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { formatDate } from "@/lib/format";
import {
  Button,
  Card,
  EmptyState,
  KpiTile,
  MoneyText,
  Pill,
  Skeleton,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Form";
import { Select } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import {
  usePos,
  usePo,
  useCreatePo,
  usePoActions,
  useSuppliers,
  useCreateSupplier,
  useGrns,
  useSupplierInvoices,
  useStockLocationOptions,
} from "./hooks";
import { ProductPicker } from "@/components/catalogue/ProductPicker";
import {
  PO_STATUS_META,
  PO_NEXT_STATES,
  FACTORY_TRACKING_STEPS,
  CURRENCIES,
  MANUFACTURING_LOCATIONS,
  LACE_TYPES,
  HAIR_TEXTURES,
  DENSITIES,
  CAP_SIZES,
} from "./constants";
import type {
  PurchaseOrder,
  GoodsReceivedNote,
  SupplierInvoice,
  PoStatus,
} from "./types";

type Tab = "overview" | "purchase-orders" | "suppliers" | "grn-invoices";
type GrnTab = "grns" | "invoices";

function fmt(d: string) {
  return formatDate(d);
}

export function PurchasingPage() {
  useBreadcrumbs([{ label: "Purchasing" }]);
  const can = useAuthStore((s) => s.can);

  const [tab, setTab] = useUrlTab<Tab>("overview", [
    "overview",
    "purchase-orders",
    "suppliers",
    "grn-invoices",
  ]);
  const [selectedPo, setSelectedPo] = useState<PurchaseOrder | null>(null);
  const [showCreatePo, setShowCreatePo] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  if (!can("purchasing", "view")) {
    return (
      <div className="py-20">
        <EmptyState
          icon={<Lock className="w-8 h-8" />}
          title="Access restricted"
          message="You don't have permission to view Purchasing."
        />
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    {
      key: "overview",
      label: "Overview",
      icon: <TrendingUp className="w-4 h-4" />,
    },
    {
      key: "purchase-orders",
      label: "Purchase Orders",
      icon: <ShoppingCart className="w-4 h-4" />,
    },
    {
      key: "suppliers",
      label: "Suppliers",
      icon: <Building2 className="w-4 h-4" />,
    },
    {
      key: "grn-invoices",
      label: "GRN & Invoices",
      icon: <FileText className="w-4 h-4" />,
    },
  ];

  return (
    <div className="space-y-5">
      <ModuleInsights module="purchasing" />
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-medium">Purchasing</h1>
          <p className="text-text-muted text-sm mt-0.5">
            Suppliers · purchase orders · GRN · invoices
          </p>
        </div>
        {tab === "purchase-orders" && can("purchasing", "create") && (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setShowCreatePo(true)}
          >
            New PO
          </Button>
        )}
      </div>

      <div className="flex gap-1 p-1 glass rounded-2xl overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all",
              tab === t.key
                ? "bg-accent-deep text-[#F4E9D9] shadow-md"
                : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05]",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <PurchasingOverview />}
      {tab === "purchase-orders" && (
        <PoTab
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          onSelect={setSelectedPo}
          onCreate={() => setShowCreatePo(true)}
          canCreate={can("purchasing", "create")}
        />
      )}
      {tab === "suppliers" && (
        <SuppliersTab canCreate={can("purchasing", "create")} />
      )}
      {tab === "grn-invoices" && <GrnInvoicesTab />}

      {selectedPo && (
        <PoDetailDrawer
          po={selectedPo}
          onClose={() => setSelectedPo(null)}
          canApprove={can("purchasing", "approve")}
          canEdit={can("purchasing", "edit")}
        />
      )}

      <CreatePoDrawer
        open={showCreatePo}
        onClose={() => setShowCreatePo(false)}
      />
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────

function PurchasingOverview() {
  const { data: pos, isLoading } = usePos();
  const { data: grns } = useGrns();
  const { data: invoices } = useSupplierInvoices();

  const posData = pos?.data ?? [];
  const grnsData = grns?.data ?? [];
  const invoicesData = invoices?.data ?? [];

  const openPos = posData.filter(
    (p) => !["closed", "cancelled"].includes(p.status),
  ).length;
  const inTransit = posData.filter((p) => p.status === "in_transit").length;
  const pendingGrns = grnsData.filter((g) => g.status === "draft").length;
  const unpaidTotal = invoicesData
    .filter((i) => i.payment_status !== "paid")
    .reduce((sum, i) => sum + parseFloat(i.total_ngn ?? "0"), 0);

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-16" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiTile label="Open POs" value={String(openPos)} tone="accent" />
      <KpiTile label="POs in Transit" value={String(inTransit)} tone="info" />
      <KpiTile label="Pending GRNs" value={String(pendingGrns)} tone="warn" />
      <KpiTile
        label="Unpaid Invoices"
        value={`₦${unpaidTotal.toLocaleString("en", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
        tone={unpaidTotal > 0 ? "danger" : "neutral"}
      />
    </div>
  );
}

// ── PO Tab ────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "in_transit", label: "In Transit" },
  { value: "received", label: "Received" },
];

function PoTab({
  statusFilter,
  onStatusFilter,
  onSelect,
  onCreate,
  canCreate,
}: {
  statusFilter: string;
  onStatusFilter: (v: string) => void;
  onSelect: (p: PurchaseOrder) => void;
  onCreate: () => void;
  canCreate: boolean;
}) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = usePos({
    status: statusFilter || undefined,
    page,
  });
  const pos = data?.data ?? [];

  /* An approver or buyer arriving from a task, a notification, or the
     approvals queue (/purchasing?tab=purchase-orders&order=<id>) lands on
     that PO rather than on a list to search. */
  useDeepLinkedRecord<PurchaseOrder>(
    "order",
    pos,
    (p) => p.po_id,
    onSelect,
  );
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 25;

  const cols: Column<PurchaseOrder>[] = [
    {
      key: "no",
      header: "PO #",
      width: "110px",
      render: (r) => <span className="font-mono text-xs">{r.po_number}</span>,
    },
    {
      key: "supplier",
      header: "Supplier",
      render: (r) => (
        <span className="font-semibold text-[13px]">
          {r.supplier_name ?? "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "160px",
      render: (r) => {
        const meta = PO_STATUS_META[r.status];
        return <Pill tone={meta.tone}>{meta.label}</Pill>;
      },
    },
    {
      key: "factory",
      header: "",
      width: "80px",
      render: (r) =>
        r.is_factory_order ? (
          <Pill tone="info" dot={false}>
            Factory
          </Pill>
        ) : null,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      width: "140px",
      render: (r) =>
        r.total_ngn ? (
          <MoneyText ngn={parseFloat(r.total_ngn)} className="text-[13px]" />
        ) : (
          <span className="text-text-faint text-xs">—</span>
        ),
    },
    {
      key: "date",
      header: "Created",
      width: "100px",
      render: (r) => (
        <span className="text-text-muted text-xs">{fmt(r.created_at)}</span>
      ),
    },
  ];

  if (isError) {
    return (
      <EmptyState
        icon={<AlertTriangle className="w-7 h-7" />}
        title="Failed to load"
        action={
          <Button size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <DataTable
        columns={cols}
        rows={pos}
        rowKey={(r) => r.po_id}
        onRowClick={onSelect}
        loading={isLoading}
        toolbar={
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => {
                  onStatusFilter(f.value);
                  setPage(1);
                }}
                className={cn(
                  "px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide border transition-all",
                  statusFilter === f.value
                    ? "bg-accent/20 text-accent-glow border-accent/30"
                    : "bg-text-primary/[0.04] text-text-muted border-transparent hover:bg-text-primary/[0.08]",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
        empty={{
          icon: <ShoppingCart className="w-7 h-7" />,
          title: "No purchase orders",
          message: "Purchase orders from suppliers will appear here.",
          action: canCreate ? (
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={onCreate}
            >
              New PO
            </Button>
          ) : undefined,
        }}
      />
      {total > pageSize && (
        <div className="flex justify-between items-center px-1">
          <span className="text-xs text-text-faint">
            {total} total · Page {page}
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={page >= Math.ceil(total / pageSize)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PO Detail Drawer ──────────────────────────────────────

function PoDetailDrawer({
  po: initialPo,
  onClose,
  canApprove,
  canEdit,
}: {
  po: PurchaseOrder;
  onClose: () => void;
  canApprove: boolean;
  canEdit: boolean;
}) {
  const navigate = useNavigate();
  const { data: po } = usePo(initialPo.po_id);
  const current = po ?? initialPo;
  const actions = usePoActions(current.po_id);
  const [nextStatus, setNextStatus] = useState<PoStatus | "">("");
  const meta = PO_STATUS_META[current.status];
  const nextStates = PO_NEXT_STATES[current.status] ?? [];

  // Factory tracking stepper
  const factoryIdx = FACTORY_TRACKING_STEPS.indexOf(current.status);

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={<span className="font-mono">{current.po_number}</span>}
      subtitle={<Pill tone={meta.tone}>{meta.label}</Pill>}
      footer={
        <div className="flex gap-2 flex-wrap w-full">
          {current.status === "draft" && canEdit && (
            <Button
              size="sm"
              variant="secondary"
              disabled={actions.submit.isPending}
              onClick={() =>
                actions.submit.mutate(undefined, { onSuccess: onClose })
              }
            >
              {actions.submit.isPending ? "Submitting…" : "Submit for Approval"}
            </Button>
          )}
          {current.status === "submitted" && canApprove && (
            <Button
              size="sm"
              variant="primary"
              disabled={actions.approve.isPending}
              onClick={() =>
                actions.approve.mutate(undefined, { onSuccess: onClose })
              }
            >
              {actions.approve.isPending ? "Approving…" : "Approve PO"}
            </Button>
          )}
          {/* The hand-off into the warehouse. Everything the receiver needs
              travels in the link, so Goods Reception opens prefilled with this
              PO's outstanding lines — no re-keying, and the receipt books
              itself back against the order. Available from the moment the PO
              exists (POs are not approval-gated here) until it is fully
              received or closed. */}
          {!["closed", "cancelled", "received"].includes(current.status) && (
            <Button
              size="sm"
              variant="primary"
              icon={<PackageCheck className="w-3.5 h-3.5" />}
              onClick={() =>
                navigate(`/stock?tab=receive&po=${current.po_id}`)
              }
            >
              Receive goods
            </Button>
          )}
          {!["draft", "submitted", "closed", "cancelled"].includes(
            current.status,
          ) &&
            nextStates.length > 0 &&
            canEdit && (
              <div className="flex gap-2 items-center">
                <select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as PoStatus)}
                  className="h-[33px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-[12px] text-text-primary outline-none"
                >
                  <option value="">Advance status…</option>
                  {nextStates.map((s) => (
                    <option key={s} value={s}>
                      {PO_STATUS_META[s].label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!nextStatus || actions.advance.isPending}
                  onClick={() =>
                    actions.advance.mutate(
                      { status: nextStatus },
                      {
                        onSuccess: () => {
                          setNextStatus("");
                          onClose();
                        },
                      },
                    )
                  }
                >
                  {actions.advance.isPending ? "Updating…" : "Advance →"}
                </Button>
              </div>
            )}
          {!["closed", "cancelled"].includes(current.status) && canEdit && (
            <Button
              size="sm"
              variant="danger"
              className="ml-auto"
              disabled={actions.cancel.isPending}
              onClick={() =>
                actions.cancel.mutate(undefined, { onSuccess: onClose })
              }
            >
              Cancel
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex justify-between gap-3">
          <div>
            <div className="micro mb-0.5">Supplier</div>
            <div className="font-semibold">{current.supplier_name ?? "—"}</div>
          </div>
          {current.total_ngn && (
            <div className="text-right">
              <div className="micro mb-0.5">Total</div>
              <MoneyText
                ngn={parseFloat(current.total_ngn)}
                className="text-[20px]"
              />
            </div>
          )}
        </div>

        {/* Factory tracking stepper */}
        {factoryIdx >= 0 && (
          <div>
            <div className="micro mb-2">Factory Tracking</div>
            <div className="flex items-center gap-0 overflow-x-auto pb-1">
              {FACTORY_TRACKING_STEPS.map((step, i) => {
                const done = i <= factoryIdx;
                const isCurrent = step === current.status;
                const stepMeta = PO_STATUS_META[step];
                return (
                  <div key={step} className="flex items-center">
                    <div className="flex flex-col items-center min-w-[56px]">
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full border-2 grid place-items-center text-[10px] font-bold transition-colors",
                          isCurrent
                            ? "border-accent bg-accent text-[#F4E9D9]"
                            : done
                              ? "border-success bg-success/20 text-success"
                              : "border-line bg-transparent text-text-faint",
                        )}
                      >
                        {done && !isCurrent ? "✓" : i + 1}
                      </div>
                      <div
                        className={cn(
                          "text-[9px] text-center mt-1 leading-tight max-w-[50px]",
                          isCurrent
                            ? "text-accent-glow font-bold"
                            : "text-text-faint",
                        )}
                      >
                        {stepMeta.label.replace(" ", "\n")}
                      </div>
                    </div>
                    {i < FACTORY_TRACKING_STEPS.length - 1 && (
                      <div
                        className={cn(
                          "h-px w-4 mb-4 shrink-0",
                          done && i < factoryIdx ? "bg-success" : "bg-line",
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Lines */}
        {current.lines && current.lines.length > 0 && (
          <div>
            <div className="micro mb-2">Line Items</div>
            <div className="space-y-2">
              {current.lines.map((line) => (
                <PoLineCard key={line.line_id} line={line} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function PoLineCard({ line }: { line: import("./types").PoLine }) {
  const [expanded, setExpanded] = useState(false);
  const hasWigAttrs =
    line.lace_type || line.hair_color || line.hair_texture || line.cap_size;

  return (
    <div className="glass rounded-xl p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-[13px] truncate">
            {line.description}
          </div>
          {line.factory_order_ref && (
            <div className="font-mono text-[10px] text-text-faint mt-0.5">
              Ref: {line.factory_order_ref}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-[13px]">×{line.quantity}</div>
          {line.line_total_ngn && (
            <MoneyText
              ngn={parseFloat(line.line_total_ngn)}
              className="text-[12px]"
            />
          )}
        </div>
      </div>

      {hasWigAttrs && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-1 text-[11px] text-accent-glow mt-2"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          Wig attributes
        </button>
      )}

      {expanded && hasWigAttrs && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-[12px]">
          {line.lace_type && (
            <div>
              <span className="text-text-faint">Lace:</span> {line.lace_type}
            </div>
          )}
          {line.hair_color && (
            <div>
              <span className="text-text-faint">Color:</span> {line.hair_color}
            </div>
          )}
          {line.hair_texture && (
            <div>
              <span className="text-text-faint">Texture:</span>{" "}
              {line.hair_texture}
            </div>
          )}
          {line.cap_size && (
            <div>
              <span className="text-text-faint">Cap:</span> {line.cap_size}
            </div>
          )}
          {line.hair_length && (
            <div>
              <span className="text-text-faint">Length:</span>{" "}
              {line.hair_length}
            </div>
          )}
          {line.density && (
            <div>
              <span className="text-text-faint">Density:</span> {line.density}%
            </div>
          )}
          {line.baby_hair && (
            <div>
              <span className="text-text-faint">Baby hair:</span>{" "}
              {line.baby_hair}
            </div>
          )}
          {line.manufacturing_location && (
            <div>
              <span className="text-text-faint">Origin:</span>{" "}
              {line.manufacturing_location}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Create PO Drawer ──────────────────────────────────────
//
// Creating a PO used to fail every time: the form posted
// {description, quantity, unit_price_original, currency} per line while the
// API's strict schema wants a PO-level title + currency and lines of
// {qty_ordered, unit_price} — so every submit 400'd on an unknown key.
//
// It also had no way to say WHAT was being bought. Factory orders are for base
// products, and a typed description can't be received into stock: nothing ties
// "Black Straight HD13x4 — Medium" the text to the SKU on the shelf. Lines now
// pick a base product (the same picker the rest of the ERP uses), so the PO
// knows the SKU and Goods Reception can prefill and book the delivery back
// against the order. Free text still works for anything not in the catalogue —
// freight, samples, a style being introduced — it just isn't stock-linked.

const PO_CURRENCIES = ["CNY", "USD", "NGN", "GBP", "EUR"];

interface PoLineDraft {
  product_id?: string;
  product_label?: string;
  description: string;
  qty: string;
  unit_price: string;
  lace_type: string;
  hair_color: string;
  hair_texture: string;
  cap_size: string;
  hair_length: string;
  density: string;
  manufacturing_location: string;
  expanded: boolean;
}

const EMPTY_LINE: PoLineDraft = {
  description: "",
  qty: "1",
  unit_price: "",
  lace_type: "",
  hair_color: "",
  hair_texture: "",
  cap_size: "",
  hair_length: "",
  density: "",
  manufacturing_location: "China",
  expanded: false,
};

/** Wig attributes ride along as line notes — the PO schema has no columns for
 *  them, and losing what was specified to the factory would be worse than
 *  putting it in text the supplier can read on the printed PO. */
function attributeNote(l: PoLineDraft): string | undefined {
  const bits = [
    l.lace_type && `Lace: ${l.lace_type}`,
    l.hair_texture && `Texture: ${l.hair_texture}`,
    l.hair_color && `Colour: ${l.hair_color}`,
    l.cap_size && `Cap: ${l.cap_size}`,
    l.hair_length && `Length: ${l.hair_length}`,
    l.density && `Density: ${l.density}`,
    l.manufacturing_location && `Origin: ${l.manufacturing_location}`,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : undefined;
}

function CreatePoDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { data: suppliers } = useSuppliers();
  const { data: locations } = useStockLocationOptions();
  const create = useCreatePo();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [supplierId, setSupplierId] = useState("");
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [fxRate, setFxRate] = useState("");
  const [locationId, setLocationId] = useState("");
  const [expected, setExpected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<PoLineDraft[]>([{ ...EMPTY_LINE }]);

  const [bulkOpen, setBulkOpen] = useState(false);

  const addLine = () => setLines((p) => [...p, { ...EMPTY_LINE }]);
  /** Bulk add — one line per ticked product. Untouched placeholder lines are
   *  swallowed rather than left dangling above the batch, so ticking 12 wigs
   *  on a fresh PO gives exactly 12 lines. */
  const addLinesFromHits = (hits: { id: string; label: string }[]) => {
    if (!hits.length) return;
    const fresh = hits.map((h) => ({
      ...EMPTY_LINE,
      product_id: h.id,
      product_label: h.label,
      description: h.label,
    }));
    setLines((p) => {
      const kept = p.filter(
        (l) =>
          l.product_id ||
          l.description.trim() ||
          l.unit_price.trim() ||
          l.qty !== "1",
      );
      return [...kept, ...fresh];
    });
    setBulkOpen(false);
  };
  const removeLine = (i: number) =>
    setLines((p) => p.filter((_, j) => j !== i));
  const setLineF = (i: number, k: keyof PoLineDraft, v: string | boolean) =>
    setLines((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const toggleLineExpand = (i: number) =>
    setLines((p) =>
      p.map((l, j) => (j === i ? { ...l, expanded: !l.expanded } : l)),
    );

  const supplier = suppliers?.find((s) => s.supplier_id === supplierId);
  const linesValid = lines.every(
    (l) => l.description.trim() && Number(l.qty) > 0,
  );
  const total = lines.reduce(
    (sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unit_price) || 0),
    0,
  );

  const reset = () => {
    setStep(1);
    setSupplierId("");
    setTitle("");
    setCurrency("CNY");
    setFxRate("");
    setLocationId("");
    setExpected("");
    setError(null);
    setLines([{ ...EMPTY_LINE }]);
    setBulkOpen(false);
  };

  const handleCreate = () => {
    if (!supplierId || !linesValid) return;
    setError(null);
    create.mutate(
      {
        supplier_id: supplierId,
        // The API requires a title; default it to something the buyer will
        // recognise rather than making them type one.
        title:
          title.trim() ||
          `${supplier?.supplier_name ?? "Supplier"} order — ${new Date().toLocaleDateString("en-NG")}`,
        po_currency: currency,
        // FX is captured now and locked onto the PO, so a later rate move
        // never rewrites what this order cost.
        ...(fxRate ? { fx_rate: Number(fxRate) } : {}),
        ...(locationId ? { delivery_location_id: locationId } : {}),
        ...(expected ? { expected_delivery: expected } : {}),
        lines: lines.map((l) => ({
          ...(l.product_id ? { product_id: l.product_id } : {}),
          description: l.description.trim(),
          qty_ordered: Number(l.qty) || 1,
          unit_price: Number(l.unit_price) || 0,
          ...(attributeNote(l) ? { notes: attributeNote(l) } : {}),
        })),
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
        onError: (e: unknown) =>
          setError(
            e instanceof Error ? e.message : "Could not create the order.",
          ),
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide
      title="New Purchase Order"
      subtitle={`Step ${step} of 3`}
      footer={
        <>
          {step > 1 && (
            <Button
              variant="ghost"
              onClick={() => setStep((s) => (s - 1) as typeof step)}
            >
              Back
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {step < 3 ? (
            <Button
              variant="primary"
              disabled={
                (step === 1 && !supplierId) || (step === 2 && !linesValid)
              }
              onClick={() => setStep((s) => (s + 1) as typeof step)}
            >
              Next →
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={create.isPending || !supplierId || !linesValid}
              onClick={handleCreate}
            >
              {create.isPending ? "Creating…" : "Create PO"}
            </Button>
          )}
        </>
      }
    >
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-[13px] text-text-muted">
            Who are you buying from, and in what currency?
          </p>
          {suppliers?.map((s) => (
            <button
              key={s.supplier_id}
              onClick={() => {
                setSupplierId(s.supplier_id);
                if (s.currency) setCurrency(s.currency);
              }}
              className={cn(
                "w-full text-left p-4 glass rounded-xl border transition-all",
                supplierId === s.supplier_id
                  ? "border-accent/40 bg-accent/[0.06]"
                  : "border-transparent hover:border-line",
              )}
            >
              <div className="font-semibold text-[14px]">{s.supplier_name}</div>
              <div className="text-[12px] text-text-faint mt-0.5">
                {s.country} · {s.currency}
              </div>
            </button>
          ))}

          {supplierId && (
            <div className="glass rounded-xl p-4 space-y-3">
              <Field label="Order title">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. July restock — HD lace bodies"
                  className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
                  autoComplete="off"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Currency">
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
                  >
                    {PO_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={`FX to NGN (1 ${currency} = ?)`}>
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                    placeholder={currency === "NGN" ? "1" : "e.g. 230"}
                    className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 font-mono text-[13px]"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Deliver to">
                  <select
                    value={locationId}
                    onChange={(e) => setLocationId(e.target.value)}
                    className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
                  >
                    <option value="">— Select location —</option>
                    {(locations ?? []).map((l) => (
                      <option key={l.location_id} value={l.location_id}>
                        {l.display_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Expected delivery">
                  <input
                    type="date"
                    value={expected}
                    onChange={(e) => setExpected(e.target.value)}
                    className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
                  />
                </Field>
              </div>
              <p className="text-[11px] text-text-faint">
                The delivery location is prefilled when you receive this order
                in Stock → Goods Reception.
              </p>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <span className="text-[13px] text-text-muted">
              {lines.length} line{lines.length !== 1 ? "s" : ""} · prices in{" "}
              {currency}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={bulkOpen ? "primary" : "ghost"}
                icon={<ListPlus className="w-3.5 h-3.5" />}
                onClick={() => setBulkOpen((v) => !v)}
              >
                Bulk Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={addLine}
              >
                Add Line
              </Button>
            </div>
          </div>

          {/* Tick several products in one pass instead of one line at a time —
              a factory restock is twenty near-identical wigs. */}
          {bulkOpen && (
            <div className="glass rounded-xl p-4 space-y-2.5">
              <p className="text-[12px] text-text-muted">
                Pick a product type, search, and tick everything you're ordering
                — each one becomes its own line with quantity 1.
              </p>
              <ProductPicker
                multi
                autoFocus
                addLabel="Add lines ·"
                onPickMany={addLinesFromHits}
              />
            </div>
          )}
          {lines.map((line, i) => (
            <div key={i} className="glass rounded-xl p-4 space-y-3">
              <div className="flex justify-between items-start gap-2">
                <span className="text-[11px] font-bold text-text-faint uppercase tracking-wide">
                  Line {i + 1}
                </span>
                {lines.length > 1 && (
                  <button
                    onClick={() => removeLine(i)}
                    className="text-danger text-sm hover:bg-danger/10 px-2 py-0.5 rounded"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Pick the base product being bought — this is what makes the
                  line receivable into stock without re-keying. */}
              <Field label="Base product">
                {line.product_id ? (
                  <div className="flex items-center justify-between gap-2 h-[38px] px-[11px] rounded-[10px] bg-accent/[0.07] border border-accent/30">
                    <span className="text-[13px] text-text-primary truncate">
                      {line.product_label}
                    </span>
                    <button
                      onClick={() => {
                        setLineF(i, "product_id", "");
                        setLineF(i, "product_label", "");
                      }}
                      className="text-[11px] text-text-muted hover:text-danger shrink-0"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <ProductPicker
                    onPick={(hit) => {
                      setLines((p) =>
                        p.map((l, j) =>
                          j === i
                            ? {
                                ...l,
                                product_id: hit.id,
                                product_label: hit.label,
                                description: l.description || hit.label,
                              }
                            : l,
                        ),
                      );
                    }}
                  />
                )}
              </Field>

              <Field label="Description (what the supplier sees)">
                <input
                  type="text"
                  value={line.description}
                  onChange={(e) => setLineF(i, "description", e.target.value)}
                  placeholder="Product / item description"
                  className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
                  autoComplete="off"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Quantity">
                  <input
                    type="number"
                    min="1"
                    value={line.qty}
                    onChange={(e) => setLineF(i, "qty", e.target.value)}
                    className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 font-mono text-[13px]"
                    autoComplete="off"
                  />
                </Field>
                <Field label={`Unit price (${currency})`}>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.unit_price}
                    onChange={(e) => setLineF(i, "unit_price", e.target.value)}
                    placeholder="0.00"
                    className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 font-mono text-[13px]"
                    autoComplete="off"
                  />
                </Field>
              </div>

              <button
                onClick={() => toggleLineExpand(i)}
                className="flex items-center gap-1.5 text-[11px] text-accent-glow font-semibold"
              >
                {line.expanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                Wig attributes (optional)
              </button>

              {line.expanded && (
                <div className="grid grid-cols-2 gap-3 pt-1 border-t hairline">
                  {[
                    {
                      key: "lace_type" as const,
                      label: "Lace Type",
                      options: [{ value: "", label: "— Select —" }, ...LACE_TYPES],
                    },
                    {
                      key: "hair_texture" as const,
                      label: "Texture",
                      options: [
                        { value: "", label: "— Select —" },
                        ...HAIR_TEXTURES,
                      ],
                    },
                    {
                      key: "cap_size" as const,
                      label: "Cap Size",
                      options: [{ value: "", label: "— Select —" }, ...CAP_SIZES],
                    },
                    {
                      key: "density" as const,
                      label: "Density",
                      options: [{ value: "", label: "— Select —" }, ...DENSITIES],
                    },
                    {
                      key: "manufacturing_location" as const,
                      label: "Origin",
                      options: [
                        { value: "", label: "— Select —" },
                        ...MANUFACTURING_LOCATIONS,
                      ],
                    },
                  ].map(({ key, label, options }) => (
                    <Field key={key} label={label}>
                      <select
                        value={line[key] as string}
                        onChange={(e) => setLineF(i, key, e.target.value)}
                        className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ))}
                  <Field label="Hair Color">
                    <input
                      type="text"
                      value={line.hair_color}
                      onChange={(e) => setLineF(i, "hair_color", e.target.value)}
                      placeholder="e.g. Natural Black, #1B"
                      className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Length (inches)">
                    <input
                      type="text"
                      value={line.hair_length}
                      onChange={(e) =>
                        setLineF(i, "hair_length", e.target.value)
                      }
                      placeholder='e.g. 18"'
                      className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
                      autoComplete="off"
                    />
                  </Field>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-[13px] text-text-muted mb-4">
            Review and confirm your purchase order.
          </p>
          <div className="glass rounded-xl p-4">
            <div className="micro mb-1">Supplier</div>
            <div className="font-semibold">{supplier?.supplier_name}</div>
            <div className="text-[12px] text-text-faint mt-1">
              {currency}
              {fxRate ? ` · locked at ₦${Number(fxRate).toLocaleString()}/${currency}` : " · no FX rate set"}
              {locationId
                ? ` · deliver to ${(locations ?? []).find((l) => l.location_id === locationId)?.display_name}`
                : ""}
            </div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="micro mb-2">
              {lines.length} Line Item{lines.length !== 1 ? "s" : ""}
            </div>
            {lines.map((l, i) => (
              <div
                key={i}
                className="flex justify-between text-[13px] py-1.5 border-b hairline last:border-0"
              >
                <span className="text-text-muted truncate mr-3">
                  {l.description}
                  {!l.product_id && (
                    <span className="text-[11px] text-warn ml-2">
                      not stock-linked
                    </span>
                  )}
                </span>
                <span className="font-mono shrink-0">
                  ×{l.qty} · {currency}{" "}
                  {(Number(l.unit_price) || 0).toFixed(2)}
                </span>
              </div>
            ))}
            <div className="flex justify-between text-[13px] pt-2 mt-1 border-t hairline font-semibold">
              <span>Total</span>
              <span className="font-mono">
                {currency} {total.toFixed(2)}
              </span>
            </div>
          </div>
          {lines.some((l) => !l.product_id) && (
            <p className="text-[12px] text-text-muted">
              Lines without a base product can&rsquo;t be received straight into
              stock — you&rsquo;ll pick the product when the goods arrive.
            </p>
          )}
          {error && <p className="text-[12px] text-danger">{error}</p>}
        </div>
      )}
    </Drawer>
  );
}

// ── Suppliers Tab ─────────────────────────────────────────

function SuppliersTab({ canCreate }: { canCreate: boolean }) {
  const { data: suppliers, isLoading, isError, refetch } = useSuppliers();
  const create = useCreateSupplier();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    supplier_name: "",
    country: "",
    email: "",
    currency: "CNY",
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError)
    return (
      <EmptyState
        icon={<AlertTriangle className="w-7 h-7" />}
        title="Failed to load"
        action={
          <Button size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        }
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {canCreate && (
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowCreate(true)}
          >
            New Supplier
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {suppliers?.map((s) => (
          <Card key={s.supplier_id} className="p-4">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-semibold text-[14px]">
                  {s.supplier_name}
                </div>
                <div className="text-[12px] text-text-muted mt-0.5">
                  {s.country ?? "—"} · {s.currency}
                </div>
              </div>
              <Pill tone={s.is_active ? "success" : "neutral"} dot={false}>
                {s.is_active ? "Active" : "Inactive"}
              </Pill>
            </div>
            {(s.email || s.phone) && (
              <div className="mt-2 text-[12px] text-text-faint">
                {s.email && <div>{s.email}</div>}
                {s.phone && <div>{s.phone}</div>}
              </div>
            )}
          </Card>
        ))}
        {(!suppliers || suppliers.length === 0) && (
          <div className="col-span-3">
            <EmptyState
              icon={<Building2 className="w-7 h-7" />}
              title="No suppliers"
              message="Add your China factory and local suppliers here."
              action={
                canCreate ? (
                  <Button
                    variant="primary"
                    icon={<Plus className="w-4 h-4" />}
                    onClick={() => setShowCreate(true)}
                  >
                    New Supplier
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
      </div>

      <Drawer
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Supplier"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={create.isPending || !form.supplier_name}
              onClick={() =>
                create.mutate(form, {
                  onSuccess: () => {
                    setShowCreate(false);
                    setForm({
                      supplier_name: "",
                      country: "",
                      email: "",
                      currency: "CNY",
                    });
                  },
                })
              }
            >
              {create.isPending ? "Creating…" : "Create Supplier"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Supplier Name">
            <input
              type="text"
              value={form.supplier_name}
              onChange={(e) =>
                setForm((p) => ({ ...p, supplier_name: e.target.value }))
              }
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </Field>
          <Field label="Country">
            <input
              type="text"
              value={form.country}
              onChange={(e) =>
                setForm((p) => ({ ...p, country: e.target.value }))
              }
              placeholder="e.g. China, Vietnam"
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm((p) => ({ ...p, email: e.target.value }))
              }
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
            />
          </Field>
          <Field label="Trading Currency">
            <Select
              value={form.currency}
              onChange={(v) => setForm((p) => ({ ...p, currency: v }))}
              options={CURRENCIES}
            />
          </Field>
        </div>
      </Drawer>
    </div>
  );
}

// ── GRN & Invoices Tab ────────────────────────────────────

function GrnInvoicesTab() {
  const [subTab, setSubTab] = useState<GrnTab>("grns");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 glass rounded-[14px]">
        {[
          { key: "grns" as const, label: "GRNs" },
          { key: "invoices" as const, label: "Supplier Invoices" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={cn(
              "flex-1 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all",
              subTab === t.key
                ? "bg-accent-deep text-[#F4E9D9]"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {subTab === "grns" && <GrnsPanel />}
      {subTab === "invoices" && <InvoicesPanel />}
    </div>
  );
}

function GrnsPanel() {
  const { data, isLoading } = useGrns();
  const grns = data?.data ?? [];

  const cols: Column<GoodsReceivedNote>[] = [
    {
      key: "no",
      header: "GRN #",
      width: "120px",
      render: (r) => <span className="font-mono text-xs">{r.grn_number}</span>,
    },
    {
      key: "po",
      header: "PO Ref",
      width: "120px",
      render: (r) => (
        <span className="font-mono text-xs">{r.po_number ?? "—"}</span>
      ),
    },
    {
      key: "date",
      header: "Received",
      width: "110px",
      render: (r) => (
        <span className="text-text-muted text-xs">{fmt(r.received_at)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "100px",
      render: (r) => (
        <Pill tone={r.status === "posted" ? "success" : "warn"}>
          {r.status}
        </Pill>
      ),
    },
    {
      key: "notes",
      header: "Notes",
      render: (r) => (
        <span className="text-text-faint text-xs truncate max-w-[180px] block">
          {r.notes ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={cols}
      rows={grns}
      rowKey={(r) => r.grn_id}
      loading={isLoading}
      empty={{
        icon: <Package className="w-7 h-7" />,
        title: "No goods received notes",
        message: "GRNs are created when stock is received from a supplier.",
      }}
    />
  );
}

function InvoicesPanel() {
  const { data, isLoading } = useSupplierInvoices();
  const invoices = data?.data ?? [];

  const MATCH_TONE: Record<string, import("@/components/ui/primitives").Tone> =
    {
      matched: "success",
      unmatched: "neutral",
      mismatch: "danger",
      manual_review: "warn",
    };
  const PAY_TONE: Record<string, import("@/components/ui/primitives").Tone> = {
    paid: "success",
    partial: "warn",
    unpaid: "danger",
  };

  const cols: Column<SupplierInvoice>[] = [
    {
      key: "no",
      header: "Invoice #",
      width: "130px",
      render: (r) => (
        <span className="font-mono text-xs">{r.invoice_number}</span>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      render: (r) => (
        <span className="text-[13px]">{r.supplier_name ?? "—"}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      width: "130px",
      render: (r) =>
        r.total_ngn ? (
          <MoneyText ngn={parseFloat(r.total_ngn)} className="text-[13px]" />
        ) : (
          <span className="text-text-faint">—</span>
        ),
    },
    {
      key: "match",
      header: "Match",
      width: "110px",
      render: (r) => (
        <Pill tone={MATCH_TONE[r.match_status] ?? "neutral"} dot={false}>
          {r.match_status.replace("_", " ")}
        </Pill>
      ),
    },
    {
      key: "payment",
      header: "Payment",
      width: "90px",
      render: (r) => (
        <Pill tone={PAY_TONE[r.payment_status] ?? "neutral"} dot={false}>
          {r.payment_status}
        </Pill>
      ),
    },
    {
      key: "date",
      header: "Date",
      width: "100px",
      render: (r) => (
        <span className="text-text-muted text-xs">{fmt(r.invoice_date)}</span>
      ),
    },
  ];

  return (
    <DataTable
      columns={cols}
      rows={invoices}
      rowKey={(r) => r.invoice_id}
      loading={isLoading}
      empty={{
        icon: <FileText className="w-7 h-7" />,
        title: "No supplier invoices",
        message:
          "Invoices from suppliers will appear here for three-way matching.",
      }}
    />
  );
}
