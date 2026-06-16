import { useState } from "react";
import { Plus, CheckSquare, AlertTriangle, Globe } from "lucide-react";
import { Button, Card, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Form";
import { Select, NumberField } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { useLedger, useAddLedgerEntry, useReconcileEntries } from "./hooks";
import { ENTRY_TYPE_META, PAYMENT_METHOD_LABELS } from "./constants";
import type { EntryType, PaymentMethod, FactoryAccount } from "./types";

const ENTRY_TYPES: { value: EntryType; label: string }[] = Object.entries(ENTRY_TYPE_META).map(
  ([v, m]) => ({ value: v as EntryType, label: m.label }),
);

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = Object.entries(
  PAYMENT_METHOD_LABELS,
).map(([v, m]) => ({ value: v as PaymentMethod, label: m.label }));

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

function cny(n: number) {
  return `¥${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function FactoryAccountLedger({
  account,
  lang,
}: {
  account: FactoryAccount;
  lang: "en" | "zh";
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, refetch } = useLedger(account.account_id);
  const addEntry = useAddLedgerEntry(account.account_id);
  const reconcile = useReconcileEntries(account.account_id);

  const balance = account.current_balance_base;
  const isNearThreshold =
    account.credit_alert_threshold != null && balance >= account.credit_alert_threshold * 0.9;
  const isOverThreshold =
    account.credit_alert_threshold != null && balance >= account.credit_alert_threshold;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleReconcile = () => {
    reconcile.mutate(Array.from(selected), {
      onSuccess: () => setSelected(new Set()),
    });
  };

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-4">
      {/* Balance header */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="micro mb-1">{lang === "zh" ? "当前余额" : "Current Balance"}</div>
            <div
              className={cn(
                "font-mono text-[32px] font-bold tabular-nums",
                isOverThreshold
                  ? "text-danger"
                  : isNearThreshold
                    ? "text-warn"
                    : "text-success",
              )}
            >
              {cny(balance)}
            </div>
            {account.credit_alert_threshold != null && (
              <div className="text-[12px] text-text-faint mt-1">
                {lang === "zh" ? "预警阈值" : "Alert threshold"}:{" "}
                <span className="font-mono">{cny(account.credit_alert_threshold)}</span>
              </div>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {selected.size > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon={<CheckSquare className="w-4 h-4" />}
                disabled={reconcile.isPending}
                onClick={handleReconcile}
              >
                {lang === "zh" ? `对账 (${selected.size})` : `Reconcile (${selected.size})`}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowAdd(true)}
            >
              {lang === "zh" ? "添加记录" : "Add Entry"}
            </Button>
          </div>
        </div>

        {isOverThreshold && (
          <div className="mt-3 flex items-center gap-2 text-[12px] text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {lang === "zh"
              ? "余额已超过预警阈值，请及时付款。"
              : "Balance has exceeded the alert threshold. Please arrange payment."}
          </div>
        )}
      </Card>

      {/* Ledger table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="micro p-[10px_12px] border-b hairline bg-text-primary/[0.02] w-8" />
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-left">
                  {lang === "zh" ? "日期" : "Date"}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-left">
                  {lang === "zh" ? "类型" : "Type"}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-left">
                  {lang === "zh" ? "描述" : "Description"}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-right">
                  {lang === "zh" ? "借方" : "Debit"}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-right">
                  {lang === "zh" ? "贷方" : "Credit"}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-right">
                  {lang === "zh" ? "余额" : "Balance"}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-center">
                  {lang === "zh" ? "对账" : "Recon."}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="p-[0_14px] h-[50px] border-b hairline">
                        <Skeleton className="w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))}
              {!isLoading &&
                entries.map((e) => {
                  const meta = ENTRY_TYPE_META[e.entry_type] ?? {
                    label: e.entry_type,
                    labelZh: e.entry_type,
                    tone: "neutral" as const,
                  };
                  return (
                    <tr
                      key={e.entry_id}
                      className={cn(
                        "border-b hairline last:border-0 transition-colors",
                        e.is_reconciled && "opacity-50",
                        selected.has(e.entry_id) && "bg-accent/[0.06]",
                      )}
                    >
                      <td className="p-[0_12px] h-[48px] align-middle">
                        {!e.is_reconciled && (
                          <input
                            type="checkbox"
                            checked={selected.has(e.entry_id)}
                            onChange={() => toggleSelect(e.entry_id)}
                            className="accent-accent-deep w-4 h-4 cursor-pointer"
                          />
                        )}
                      </td>
                      <td className="p-[0_14px] h-[48px] align-middle text-text-muted text-xs">
                        {fmt(e.entry_date)}
                      </td>
                      <td className="p-[0_14px] h-[48px] align-middle">
                        <Pill tone={meta.tone} dot={false}>
                          {lang === "zh" ? meta.labelZh : meta.label}
                        </Pill>
                      </td>
                      <td className="p-[0_14px] h-[48px] align-middle text-text-muted truncate max-w-[180px]">
                        {e.description ?? "—"}
                      </td>
                      <td className="p-[0_14px] h-[48px] align-middle text-right font-mono text-danger">
                        {e.direction === "DR" ? cny(e.amount_base) : "—"}
                      </td>
                      <td className="p-[0_14px] h-[48px] align-middle text-right font-mono text-success">
                        {e.direction === "CR" ? cny(e.amount_base) : "—"}
                      </td>
                      <td className="p-[0_14px] h-[48px] align-middle text-right font-mono font-semibold">
                        {cny(e.running_balance)}
                      </td>
                      <td className="p-[0_14px] h-[48px] align-middle text-center">
                        {e.is_reconciled ? (
                          <span className="text-success text-xs">✓</span>
                        ) : (
                          <span className="text-text-faint text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!isLoading && entries.length === 0 && (
          <EmptyState
            icon={<Globe className="w-6 h-6" />}
            title={lang === "zh" ? "暂无记录" : "No ledger entries yet"}
            message={
              lang === "zh"
                ? "订单收费和付款将显示在这里。"
                : "Order charges and payments will appear here."
            }
          />
        )}
        {isError && (
          <EmptyState
            icon={<AlertTriangle className="w-6 h-6" />}
            title="Failed to load"
            message="Could not load ledger entries."
            action={
              <Button size="sm" variant="secondary" onClick={() => refetch()}>
                Retry
              </Button>
            }
          />
        )}
      </Card>

      {/* Add entry drawer */}
      <AddEntryDrawer
        open={showAdd}
        onClose={() => setShowAdd(false)}
        accountId={account.account_id}
        lang={lang}
        onAdd={addEntry}
      />
    </div>
  );
}

function AddEntryDrawer({
  open,
  onClose,
  accountId: _accountId,
  lang,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  lang: "en" | "zh";
  onAdd: ReturnType<typeof useAddLedgerEntry>;
}) {
  const [form, setForm] = useState({
    entry_type: "payment" as EntryType,
    direction: "CR" as "DR" | "CR",
    amount_original: "",
    original_currency: "CNY",
    fx_rate_to_base: "1",
    description: "",
    entry_date: new Date().toISOString().split("T")[0],
    payment_method: "" as PaymentMethod | "",
    paid_by: "",
    notes: "",
  });

  const setField = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleTypeChange = (type: EntryType) => {
    const meta = ENTRY_TYPE_META[type];
    setField("entry_type", type);
    setField("direction", meta.direction);
  };

  const handleSubmit = () => {
    if (!form.amount_original || parseFloat(form.amount_original) <= 0) return;
    onAdd.mutate(
      {
        entry_type: form.entry_type,
        direction: form.direction,
        amount_original: parseFloat(form.amount_original),
        original_currency: form.original_currency,
        fx_rate_to_base: parseFloat(form.fx_rate_to_base) || 1,
        description: form.description || undefined,
        entry_date: form.entry_date || undefined,
        payment_method: form.payment_method || undefined,
        paid_by: form.paid_by || undefined,
        notes: form.notes || undefined,
      },
      { onSuccess: () => { onClose(); setForm((p) => ({ ...p, amount_original: "", description: "", notes: "" })); } },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={lang === "zh" ? "添加账户记录" : "Add Ledger Entry"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {lang === "zh" ? "取消" : "Cancel"}
          </Button>
          <Button
            variant="primary"
            disabled={onAdd.isPending || !form.amount_original}
            onClick={handleSubmit}
          >
            {onAdd.isPending ? (lang === "zh" ? "保存中…" : "Saving…") : (lang === "zh" ? "保存" : "Save Entry")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={lang === "zh" ? "类型" : "Entry Type"}>
          <Select
            value={form.entry_type}
            onChange={handleTypeChange}
            options={ENTRY_TYPES.map((o) => ({
              value: o.value,
              label: lang === "zh" ? ENTRY_TYPE_META[o.value].labelZh : o.label,
            }))}
          />
        </Field>

        <div className="flex gap-3">
          <div className="flex gap-2">
            {(["DR", "CR"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setField("direction", d)}
                className={cn(
                  "px-4 py-2 rounded-[10px] text-[13px] font-semibold border transition-all",
                  form.direction === d
                    ? d === "DR"
                      ? "bg-danger/15 border-danger/40 text-danger"
                      : "bg-success/15 border-success/40 text-success"
                    : "border-line text-text-muted",
                )}
              >
                {d === "DR" ? (lang === "zh" ? "借方" : "Debit") : (lang === "zh" ? "贷方" : "Credit")}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={lang === "zh" ? "金额" : "Amount"}>
            <NumberField
              value={form.amount_original}
              onChange={(v) => setField("amount_original", v)}
              placeholder="0.00"
            />
          </Field>
          <Field label={lang === "zh" ? "货币" : "Currency"}>
            <Select
              value={form.original_currency}
              onChange={(v) => setField("original_currency", v)}
              options={[
                { value: "CNY", label: "CNY ¥" },
                { value: "NGN", label: "NGN ₦" },
                { value: "USD", label: "USD $" },
              ]}
            />
          </Field>
        </div>

        <Field label={lang === "zh" ? "汇率（转换为CNY）" : "FX Rate to CNY"}>
          <NumberField
            value={form.fx_rate_to_base}
            onChange={(v) => setField("fx_rate_to_base", v)}
            placeholder="1"
          />
        </Field>

        <Field label={lang === "zh" ? "日期" : "Date"}>
          <input
            type="date"
            value={form.entry_date}
            onChange={(e) => setField("entry_date", e.target.value)}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
          />
        </Field>

        <Field label={lang === "zh" ? "付款方式" : "Payment Method"}>
          <Select
            value={form.payment_method}
            onChange={(v) => setField("payment_method", v as PaymentMethod | "")}
            options={[
              { value: "", label: lang === "zh" ? "— 选择 —" : "— Select —" },
              ...PAYMENT_METHODS.map((o) => ({
                value: o.value,
                label: lang === "zh" ? PAYMENT_METHOD_LABELS[o.value].labelZh : o.label,
              })),
            ]}
          />
        </Field>

        <Field label={lang === "zh" ? "付款人" : "Paid By"}>
          <input
            type="text"
            value={form.paid_by}
            onChange={(e) => setField("paid_by", e.target.value)}
            placeholder={lang === "zh" ? "付款人姓名" : "Person / entity name"}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
          />
        </Field>

        <Field label={lang === "zh" ? "描述" : "Description"}>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            placeholder={lang === "zh" ? "备注（选填）" : "Short description (optional)"}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
          />
        </Field>
      </div>
    </Drawer>
  );
}
