import { useState } from "react";
import { Plus, Truck, Package, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { Button, Card, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Form";
import { NumberField } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { useShipments, useCreateShipment, useShipment, useAdvanceShipment } from "./hooks";
import { SHIPMENT_STATUS_META } from "./constants";
import type { Shipment, ShipmentStatus } from "./types";

const STATUS_ORDER: ShipmentStatus[] = [
  "dispatched",
  "in_transit",
  "arrived_lagos",
  "cleared_customs",
  "received",
];

function fmt(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

function cny(n: number | null) {
  if (n == null) return "—";
  return `¥${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function FactoryShipmentsPanel({
  accountId,
  supplierId,
  lang,
}: {
  accountId: string;
  supplierId: string;
  lang: "en" | "zh";
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus | "">("");

  const { data, isLoading, isError, refetch } = useShipments({
    account_id: accountId,
    status: statusFilter || undefined,
  });

  const shipments = data?.shipments ?? [];

  const filterBtns: Array<{ value: ShipmentStatus | ""; label: string; labelZh: string }> = [
    { value: "", label: "All", labelZh: "全部" },
    ...STATUS_ORDER.map((s) => ({
      value: s,
      label: SHIPMENT_STATUS_META[s].label,
      labelZh: SHIPMENT_STATUS_META[s].labelZh,
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {filterBtns.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value as ShipmentStatus | "")}
              className={cn(
                "px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide border transition-all",
                statusFilter === f.value
                  ? "bg-accent/20 text-accent-glow border-accent/30"
                  : "bg-text-primary/[0.04] text-text-muted border-transparent hover:bg-text-primary/[0.08]",
              )}
            >
              {lang === "zh" ? f.labelZh : f.label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => setShowCreate(true)}
        >
          {lang === "zh" ? "新建发货单" : "New Shipment"}
        </Button>
      </div>

      {isLoading && (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="w-32 mb-3 h-5" />
              <Skeleton className="w-48 mb-2" />
              <Skeleton className="w-24" />
            </Card>
          ))}
        </div>
      )}

      {isError && (
        <EmptyState
          icon={<AlertTriangle className="w-7 h-7" />}
          title="Failed to load"
          message="Could not load shipments."
          action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}
        />
      )}

      {!isLoading && !isError && shipments.length === 0 && (
        <EmptyState
          icon={<Truck className="w-8 h-8" />}
          title={lang === "zh" ? "暂无发货记录" : "No shipments yet"}
          message={
            lang === "zh"
              ? "工厂发货后，记录在这里。"
              : "When the factory dispatches goods, log the shipment here."
          }
          action={
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setShowCreate(true)}
            >
              {lang === "zh" ? "新建发货单" : "New Shipment"}
            </Button>
          }
        />
      )}

      <div className="grid gap-3">
        {shipments.map((s) => (
          <ShipmentCard key={s.shipment_id} shipment={s} lang={lang} onSelect={setSelected} />
        ))}
      </div>

      <CreateShipmentDrawer
        open={showCreate}
        onClose={() => setShowCreate(false)}
        accountId={accountId}
        supplierId={supplierId}
        lang={lang}
      />

      {selected && (
        <ShipmentDetailDrawer
          shipmentId={selected}
          lang={lang}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ShipmentCard({
  shipment,
  lang,
  onSelect,
}: {
  shipment: Shipment;
  lang: "en" | "zh";
  onSelect: (id: string) => void;
}) {
  const meta = SHIPMENT_STATUS_META[shipment.status];
  return (
    <div
      className="glass rounded-[var(--radius)] shadow-glass p-5 cursor-pointer hover:bg-text-primary/[0.02] transition-colors"
      onClick={() => onSelect(shipment.shipment_id)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-sm font-semibold">{shipment.shipment_ref}</span>
            <Pill tone={meta.tone}>{lang === "zh" ? meta.labelZh : meta.label}</Pill>
          </div>
          <div className="text-[13px] text-text-muted flex items-center gap-2">
            <Truck className="w-3.5 h-3.5 shrink-0" />
            {shipment.courier}
            {shipment.tracking_number && (
              <span className="font-mono text-xs text-text-faint">{shipment.tracking_number}</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[12px] text-text-faint">
            {shipment.items.length} {lang === "zh" ? "件" : "items"}
          </div>
          {shipment.courier_fee_base != null && (
            <div className="font-mono text-sm">{cny(shipment.courier_fee_base)}</div>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-4 text-[12px] text-text-faint">
        <span>
          {lang === "zh" ? "发货" : "Shipped"}: {fmt(shipment.shipped_at)}
        </span>
        <span>
          {lang === "zh" ? "预计到达" : "Est. arrival"}: {fmt(shipment.estimated_arrival)}
        </span>
      </div>
      {/* Status stepper */}
      <div className="mt-3 flex items-center gap-0.5">
        {STATUS_ORDER.map((s, i) => {
          const idx = STATUS_ORDER.indexOf(shipment.status as ShipmentStatus);
          const done = i <= idx && shipment.status !== "cancelled";
          return (
            <div key={s} className="flex items-center flex-1">
              <div
                className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  done ? "bg-accent" : "bg-text-primary/20",
                )}
              />
              {i < STATUS_ORDER.length - 1 && (
                <div className={cn("h-px flex-1", done ? "bg-accent/50" : "bg-text-primary/10")} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShipmentDetailDrawer({
  shipmentId,
  lang,
  onClose,
}: {
  shipmentId: string;
  lang: "en" | "zh";
  onClose: () => void;
}) {
  const { data: shipment, isLoading } = useShipment(shipmentId);
  const advance = useAdvanceShipment(shipmentId);
  const [showAdvance, setShowAdvance] = useState(false);
  const [nextStatus, setNextStatus] = useState<ShipmentStatus>("in_transit");

  if (!shipment && !isLoading) return null;
  const meta = shipment ? SHIPMENT_STATUS_META[shipment.status] : null;

  const nextStatuses: ShipmentStatus[] = shipment
    ? STATUS_ORDER.slice(STATUS_ORDER.indexOf(shipment.status as ShipmentStatus) + 1)
    : [];

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={
        shipment ? (
          <span className="font-mono">{shipment.shipment_ref}</span>
        ) : (
          "Shipment"
        )
      }
      subtitle={meta ? <Pill tone={meta.tone}>{lang === "zh" ? meta.labelZh : meta.label}</Pill> : undefined}
    >
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : shipment ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            <div>
              <div className="micro mb-1">{lang === "zh" ? "快递公司" : "Courier"}</div>
              <div className="font-semibold">{shipment.courier}</div>
            </div>
            {shipment.tracking_number && (
              <div>
                <div className="micro mb-1">{lang === "zh" ? "追踪号" : "Tracking"}</div>
                <div className="font-mono text-sm">{shipment.tracking_number}</div>
              </div>
            )}
            <div>
              <div className="micro mb-1">{lang === "zh" ? "发货日期" : "Shipped"}</div>
              <div>{fmt(shipment.shipped_at)}</div>
            </div>
            <div>
              <div className="micro mb-1">{lang === "zh" ? "预计到达" : "Est. Arrival"}</div>
              <div>{fmt(shipment.estimated_arrival)}</div>
            </div>
            {shipment.courier_fee_original != null && (
              <div>
                <div className="micro mb-1">{lang === "zh" ? "运费" : "Shipping Fee"}</div>
                <div className="font-mono">
                  {shipment.courier_fee_currency}{" "}
                  {shipment.courier_fee_original.toLocaleString("en", { minimumFractionDigits: 2 })}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="micro mb-3">{lang === "zh" ? "货物明细" : "Items"}</div>
            <div className="space-y-2">
              {shipment.items.map((item) => (
                <div key={item.item_id} className="flex items-center justify-between gap-3 glass rounded-xl p-3 text-[13px]">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-text-faint shrink-0" />
                    <span className="text-text-muted">{item.sku_description ?? "—"}</span>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 font-mono text-xs">
                    <span>×{item.quantity_shipped}</span>
                    {item.unit_price_base != null && <span>{cny(item.unit_price_base)}/pc</span>}
                    {item.total_price_base != null && (
                      <span className="font-semibold">{cny(item.total_price_base)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {nextStatuses.length > 0 && shipment.status !== "cancelled" && (
            <div>
              {!showAdvance ? (
                <Button
                  variant="secondary"
                  icon={<ChevronDown className="w-4 h-4" />}
                  onClick={() => { setShowAdvance(true); setNextStatus(nextStatuses[0]); }}
                >
                  {lang === "zh" ? "更新状态" : "Advance Status"}
                </Button>
              ) : (
                <Card className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold">
                      {lang === "zh" ? "更新为" : "Advance to"}
                    </span>
                    <button onClick={() => setShowAdvance(false)}>
                      <ChevronUp className="w-4 h-4 text-text-faint" />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {nextStatuses.map((s) => (
                      <button
                        key={s}
                        onClick={() => setNextStatus(s)}
                        className={cn(
                          "px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide border transition-all",
                          nextStatus === s
                            ? "bg-accent/20 text-accent-glow border-accent/30"
                            : "border-line text-text-muted",
                        )}
                      >
                        {lang === "zh" ? SHIPMENT_STATUS_META[s].labelZh : SHIPMENT_STATUS_META[s].label}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={advance.isPending}
                    onClick={() =>
                      advance.mutate(
                        { status: nextStatus },
                        {
                          onSuccess: () => {
                            setShowAdvance(false);
                            onClose();
                          },
                        },
                      )
                    }
                  >
                    {advance.isPending
                      ? (lang === "zh" ? "更新中…" : "Updating…")
                      : (lang === "zh" ? "确认" : "Confirm")}
                  </Button>
                </Card>
              )}
            </div>
          )}
        </div>
      ) : null}
    </Drawer>
  );
}

function CreateShipmentDrawer({
  open,
  onClose,
  accountId,
  supplierId,
  lang,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  supplierId: string;
  lang: "en" | "zh";
}) {
  const create = useCreateShipment();
  const [form, setForm] = useState({
    courier: "",
    tracking_number: "",
    courier_fee_original: "",
    courier_fee_currency: "CNY",
    shipped_at: new Date().toISOString().split("T")[0],
    estimated_arrival: "",
    notes: "",
  });
  const [items, setItems] = useState([
    { sku_description: "", quantity_shipped: "1", unit_price_base: "" },
  ]);

  const setF = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const addItem = () =>
    setItems((p) => [...p, { sku_description: "", quantity_shipped: "1", unit_price_base: "" }]);

  const removeItem = (i: number) => setItems((p) => p.filter((_, j) => j !== i));

  const setItem = (i: number, k: string, v: string) =>
    setItems((p) => p.map((item, j) => (j === i ? { ...item, [k]: v } : item)));

  const handleSubmit = () => {
    if (!form.courier || items.some((it) => !it.quantity_shipped)) return;
    create.mutate(
      {
        account_id: accountId,
        supplier_id: supplierId,
        courier: form.courier,
        tracking_number: form.tracking_number || undefined,
        courier_fee_original: form.courier_fee_original ? parseFloat(form.courier_fee_original) : undefined,
        courier_fee_currency: form.courier_fee_currency,
        shipped_at: form.shipped_at || undefined,
        estimated_arrival: form.estimated_arrival || undefined,
        notes: form.notes || undefined,
        items: items.map((it) => ({
          sku_description: it.sku_description || undefined,
          quantity_shipped: parseInt(it.quantity_shipped) || 1,
          unit_price_base: it.unit_price_base ? parseFloat(it.unit_price_base) : undefined,
        })),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide
      title={lang === "zh" ? "新建发货单" : "New Shipment"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{lang === "zh" ? "取消" : "Cancel"}</Button>
          <Button
            variant="primary"
            disabled={create.isPending || !form.courier}
            onClick={handleSubmit}
          >
            {create.isPending ? (lang === "zh" ? "保存中…" : "Saving…") : (lang === "zh" ? "创建发货单" : "Create Shipment")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={lang === "zh" ? "快递公司" : "Courier"}>
          <input
            type="text"
            value={form.courier}
            onChange={(e) => setF("courier", e.target.value)}
            placeholder={lang === "zh" ? "如：DHL、FedEx" : "e.g. DHL, FedEx, Yanwen"}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
          />
        </Field>

        <Field label={lang === "zh" ? "追踪号" : "Tracking Number"}>
          <input
            type="text"
            value={form.tracking_number}
            onChange={(e) => setF("tracking_number", e.target.value)}
            placeholder={lang === "zh" ? "追踪号（选填）" : "Optional"}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 font-mono"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={lang === "zh" ? "运费金额" : "Shipping Fee"}>
            <NumberField
              value={form.courier_fee_original}
              onChange={(v) => setF("courier_fee_original", v)}
              placeholder="0.00"
            />
          </Field>
          <Field label={lang === "zh" ? "货币" : "Currency"}>
            <select
              value={form.courier_fee_currency}
              onChange={(e) => setF("courier_fee_currency", e.target.value)}
              className="w-full h-[42px] px-[11px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
            >
              {["CNY", "USD", "NGN"].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={lang === "zh" ? "发货日期" : "Shipped Date"}>
            <input
              type="date"
              value={form.shipped_at}
              onChange={(e) => setF("shipped_at", e.target.value)}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
            />
          </Field>
          <Field label={lang === "zh" ? "预计到达" : "Est. Arrival"}>
            <input
              type="date"
              value={form.estimated_arrival}
              onChange={(e) => setF("estimated_arrival", e.target.value)}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
            />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="micro">{lang === "zh" ? "货物明细" : "Items"}</span>
            <Button size="sm" variant="ghost" icon={<Plus className="w-3.5 h-3.5" />} onClick={addItem}>
              {lang === "zh" ? "添加" : "Add"}
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="glass rounded-xl p-3">
                <div className="grid grid-cols-[1fr_80px_100px_28px] gap-2 items-end">
                  <Field label={lang === "zh" ? "描述" : "Description"}>
                    <input
                      type="text"
                      value={item.sku_description}
                      onChange={(e) => setItem(i, "sku_description", e.target.value)}
                      placeholder={lang === "zh" ? "产品描述" : "SKU / description"}
                      className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 text-[13px]"
                    />
                  </Field>
                  <Field label={lang === "zh" ? "数量" : "Qty"}>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity_shipped}
                      onChange={(e) => setItem(i, "quantity_shipped", e.target.value)}
                      className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 font-mono text-[13px]"
                    />
                  </Field>
                  <Field label={lang === "zh" ? "单价(CNY)" : "Unit Price ¥"}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_price_base}
                      onChange={(e) => setItem(i, "unit_price_base", e.target.value)}
                      placeholder="0.00"
                      className="w-full h-[38px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 font-mono text-[13px]"
                    />
                  </Field>
                  {items.length > 1 && (
                    <button
                      onClick={() => removeItem(i)}
                      className="h-[38px] mt-[22px] text-danger hover:bg-danger/10 rounded-[10px] px-2 text-[18px] leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Drawer>
  );
}
