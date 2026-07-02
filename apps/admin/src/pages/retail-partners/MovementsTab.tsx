import { useMemo, useState } from "react";
import { ArrowUpDown, Download, Plus } from "lucide-react";
import { Button, MoneyText, Pill } from "@/components/ui/primitives";
import type { Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { useConsignmentMovements, usePartners } from "./hooks";
import { MovementModal } from "./MovementModal";
import {
  SearchBox,
  ResponsiveTable,
  MovementTypePill,
  VariantCell,
} from "./parts";
import { fmtDateTime } from "./format";
import type { ConsignmentMovement, MovementType } from "./types";
import { MOVEMENT_TYPE_LABEL, num } from "./types";

const TYPE_OPTS = [
  { value: "", label: "All types" },
  ...(Object.entries(MOVEMENT_TYPE_LABEL) as [MovementType, string][]).map(
    ([value, label]) => ({ value: value as string, label }),
  ),
];

const SETTLED_OPTS = [
  { value: "", label: "Settled + unsettled" },
  { value: "false", label: "Unsettled only" },
  { value: "true", label: "Settled only" },
];

function exportCsv(rows: ConsignmentMovement[]) {
  const header = [
    "Number",
    "Date",
    "Type",
    "Partner",
    "Location",
    "SKU",
    "Item",
    "Qty",
    "Unit price NGN",
    "Partner share NGN",
    "Settled",
    "Notes",
  ];
  const lines = rows.map((r) => [
    r.movement_number,
    r.recorded_at,
    r.movement_type,
    r.partner_name ?? "",
    r.location_name ?? "",
    r.sku ?? "",
    r.variant_name ?? "",
    String(r.quantity),
    r.unit_retail_price_ngn ?? "",
    r.partner_share_ngn ?? "",
    r.settlement_id ? "yes" : "no",
    r.notes ?? "",
  ]);
  const csv = [header, ...lines]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `consignment-movements-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MovementsTab() {
  const can = useAuthStore((s) => s.can);
  const canCreate = can("retail_partners", "create");

  const [partnerFilter, setPartnerFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [settledFilter, setSettledFilter] = useState("");
  const [search, setSearch] = useState("");
  const [recordOpen, setRecordOpen] = useState(false);

  const { data: partners = [] } = usePartners();
  const { data: movements = [], isLoading, isError, error, refetch } =
    useConsignmentMovements({
      ...(partnerFilter ? { partner_id: partnerFilter } : {}),
      ...(settledFilter ? { settled: settledFilter === "true" } : {}),
    });

  const rows = useMemo(() => {
    let list = movements;
    if (typeFilter) list = list.filter((m) => m.movement_type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((m) =>
        [m.movement_number, m.sku, m.variant_name, m.partner_name, m.location_name, m.notes, m.reported_customer_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return list;
  }, [movements, typeFilter, search]);

  const partnerOpts = useMemo(
    () => [
      { value: "", label: "All partners" },
      ...partners.map((p) => ({ value: p.partner_id, label: p.display_name })),
    ],
    [partners],
  );

  const columns: Column<ConsignmentMovement>[] = useMemo(
    () => [
      {
        key: "number",
        header: "Number",
        width: "140px",
        render: (m) => (
          <div>
            <div className="font-mono text-[12px] text-accent-glow">
              {m.movement_number}
            </div>
            <div className="text-[11px] text-text-faint">
              {fmtDateTime(m.recorded_at)}
            </div>
          </div>
        ),
      },
      {
        key: "type",
        header: "Type",
        width: "170px",
        render: (m) => <MovementTypePill type={m.movement_type} />,
      },
      {
        key: "item",
        header: "Item",
        render: (m) => (
          <VariantCell sku={m.sku} name={m.variant_name} fallbackId={m.variant_id} />
        ),
      },
      {
        key: "where",
        header: "Partner / location",
        width: "190px",
        render: (m) => (
          <div className="min-w-0">
            <div className="text-[12.5px] truncate max-w-[180px]">
              {m.partner_name ?? "—"}
            </div>
            <div className="text-[11px] text-text-faint truncate max-w-[180px]">
              {m.location_name ?? ""}
            </div>
          </div>
        ),
      },
      {
        key: "qty",
        header: "Qty",
        width: "70px",
        align: "right",
        render: (m) => (
          <span
            className={`font-mono tabular-nums font-semibold ${
              m.quantity > 0 ? "text-success" : "text-danger"
            }`}
          >
            {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
          </span>
        ),
      },
      {
        key: "price",
        header: "Unit price",
        width: "115px",
        align: "right",
        render: (m) =>
          m.unit_retail_price_ngn ? (
            <MoneyText ngn={num(m.unit_retail_price_ngn)} className="text-[13px]" />
          ) : (
            <span className="text-text-faint">—</span>
          ),
      },
      {
        key: "share",
        header: "Partner share",
        width: "125px",
        align: "right",
        render: (m) =>
          m.partner_share_ngn ? (
            <MoneyText ngn={num(m.partner_share_ngn)} className="text-[13px]" />
          ) : (
            <span className="text-text-faint">—</span>
          ),
      },
      {
        key: "settled",
        header: "Settled",
        width: "110px",
        render: (m) =>
          m.settlement_id ? (
            <Pill tone="accent">Settled</Pill>
          ) : (
            <Pill tone="neutral">Unsettled</Pill>
          ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={partnerFilter}
          onChange={setPartnerFilter}
          options={partnerOpts}
          className="w-[200px]"
        />
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          options={TYPE_OPTS}
          className="w-[190px]"
        />
        <Select
          value={settledFilter}
          onChange={setSettledFilter}
          options={SETTLED_OPTS}
          className="w-[180px]"
        />
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search number, item, partner…"
        />
        <div className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          icon={<Download className="w-4 h-4" />}
          onClick={() => exportCsv(rows)}
          disabled={rows.length === 0}
        >
          Export CSV
        </Button>
        {canCreate && (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setRecordOpen(true)}
          >
            Record movement
          </Button>
        )}
      </div>

      <ResponsiveTable<ConsignmentMovement>
        columns={columns}
        rows={rows}
        rowKey={(m) => m.movement_id}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => refetch()}
        empty={{
          icon: <ArrowUpDown className="w-6 h-6" />,
          title: "No consignment movements",
          message:
            "Dispatches, partner sales, returns and recalls all land in this append-only ledger.",
          action: canCreate ? (
            <Button variant="primary" onClick={() => setRecordOpen(true)}>
              Record a movement
            </Button>
          ) : undefined,
        }}
        card={(m) => (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <MovementTypePill type={m.movement_type} />
                <span
                  className={`font-mono tabular-nums text-[13px] font-semibold ${
                    m.quantity > 0 ? "text-success" : "text-danger"
                  }`}
                >
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                </span>
              </div>
              <div className="text-[13px] font-medium truncate mt-1.5">
                {m.variant_name || m.sku || `${m.variant_id.slice(0, 8)}…`}
              </div>
              <div className="text-[11.5px] text-text-muted truncate">
                {[m.partner_name, m.location_name].filter(Boolean).join(" · ")}
              </div>
              <div className="text-[11px] text-text-faint mt-0.5">
                {m.movement_number} · {fmtDateTime(m.recorded_at)}
              </div>
            </div>
            {m.unit_retail_price_ngn && (
              <MoneyText
                ngn={num(m.unit_retail_price_ngn)}
                className="text-[13px] shrink-0"
              />
            )}
          </div>
        )}
      />

      <MovementModal open={recordOpen} onClose={() => setRecordOpen(false)} />
    </div>
  );
}
