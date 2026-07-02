import { useMemo, useState } from "react";
import { Boxes, Truck } from "lucide-react";
import { Button, MoneyText } from "@/components/ui/primitives";
import type { Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/controls";
import { useAuthStore } from "@/stores/auth";
import { useConsignmentStock, usePartners } from "./hooks";
import { MovementModal } from "./MovementModal";
import { SearchBox, ResponsiveTable, VariantCell } from "./parts";
import { fmtDateTime } from "./format";
import type { ConsignmentStockRow } from "./types";
import { num } from "./types";

export default function StockTab() {
  const can = useAuthStore((s) => s.can);
  const canCreate = can("retail_partners", "create");

  const [partnerFilter, setPartnerFilter] = useState("");
  const [search, setSearch] = useState("");
  const [dispatchOpen, setDispatchOpen] = useState(false);

  const { data: partners = [] } = usePartners();
  const { data: stock = [], isLoading, isError, error, refetch } =
    useConsignmentStock(partnerFilter ? { partner_id: partnerFilter } : {});

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stock;
    return stock.filter((r) =>
      [r.sku, r.variant_name, r.location_name, r.partner_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [stock, search]);

  const partnerOpts = useMemo(
    () => [
      { value: "", label: "All partners" },
      ...partners.map((p) => ({ value: p.partner_id, label: p.display_name })),
    ],
    [partners],
  );

  const columns: Column<ConsignmentStockRow>[] = useMemo(
    () => [
      {
        key: "item",
        header: "Item",
        render: (r) => (
          <VariantCell sku={r.sku} name={r.variant_name} fallbackId={r.variant_id} />
        ),
      },
      {
        key: "partner",
        header: "Partner",
        width: "170px",
        render: (r) => (
          <span className="text-[12.5px] text-text-muted truncate block max-w-[160px]">
            {r.partner_name ?? "—"}
          </span>
        ),
      },
      {
        key: "location",
        header: "Location",
        width: "160px",
        render: (r) => (
          <span className="text-[12.5px] text-text-muted truncate block max-w-[150px]">
            {r.location_name ?? "—"}
          </span>
        ),
      },
      {
        key: "on_hand",
        header: "On hand",
        width: "90px",
        align: "right",
        render: (r) => (
          <span className="tabular-nums font-semibold">{r.qty_on_hand}</span>
        ),
      },
      {
        key: "sold",
        header: "Sold*",
        width: "80px",
        align: "right",
        render: (r) => (
          <span className="tabular-nums text-success">
            {r.qty_sold_since_last_settlement}
          </span>
        ),
      },
      {
        key: "returned",
        header: "Returned*",
        width: "95px",
        align: "right",
        render: (r) => (
          <span className="tabular-nums text-text-muted">
            {r.qty_returned_since_last_settlement}
          </span>
        ),
      },
      {
        key: "price",
        header: "Agreed price",
        width: "130px",
        align: "right",
        render: (r) =>
          r.agreed_retail_price_ngn ? (
            <MoneyText ngn={num(r.agreed_retail_price_ngn)} className="text-[13px]" />
          ) : (
            <span className="text-text-faint">—</span>
          ),
      },
      {
        key: "moved",
        header: "Last movement",
        width: "150px",
        render: (r) => (
          <span className="text-[12px] text-text-muted">
            {fmtDateTime(r.last_movement_at)}
          </span>
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
          className="w-[220px]"
        />
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search item, partner, location…"
        />
        <div className="flex-1" />
        {canCreate && (
          <Button
            variant="primary"
            size="sm"
            icon={<Truck className="w-4 h-4" />}
            onClick={() => setDispatchOpen(true)}
          >
            Dispatch stock
          </Button>
        )}
      </div>

      <ResponsiveTable<ConsignmentStockRow>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.consignment_stock_id}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => refetch()}
        empty={{
          icon: <Boxes className="w-6 h-6" />,
          title: "Nothing on consignment",
          message:
            "Dispatch stock to a partner location and the live count shows up here.",
          action: canCreate ? (
            <Button variant="primary" onClick={() => setDispatchOpen(true)}>
              Dispatch stock
            </Button>
          ) : undefined,
        }}
        card={(r) => (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold truncate">
                {r.variant_name || r.sku || `${r.variant_id.slice(0, 8)}…`}
              </div>
              <div className="text-[11.5px] text-text-muted truncate">
                {[r.partner_name, r.location_name].filter(Boolean).join(" · ")}
              </div>
              {r.agreed_retail_price_ngn && (
                <div className="text-[12px] mt-0.5">
                  <MoneyText
                    ngn={num(r.agreed_retail_price_ngn)}
                    className="text-[12px]"
                  />
                </div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="text-[17px] font-display font-medium tabular-nums">
                {r.qty_on_hand}
              </div>
              <div className="text-[10.5px] uppercase tracking-wide text-text-faint">
                on hand
              </div>
            </div>
          </div>
        )}
      />

      <MovementModal
        open={dispatchOpen}
        onClose={() => setDispatchOpen(false)}
        intent="dispatch_to_partner"
      />
    </div>
  );
}
