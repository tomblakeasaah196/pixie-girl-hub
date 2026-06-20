import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, CheckSquare, AlertTriangle, Globe } from "lucide-react";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Form";
import { Select, NumberField } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { useLedger, useAddLedgerEntry, useReconcileEntries } from "./hooks";
import { ENTRY_TYPE_META, PAYMENT_METHOD_LABELS } from "./constants";
import type { EntryType, PaymentMethod, FactoryAccount } from "./types";

const ENTRY_TYPES: { value: EntryType; label: string }[] = Object.entries(
  ENTRY_TYPE_META,
).map(([v, m]) => ({ value: v as EntryType, label: m.label }));

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] =
  Object.entries(PAYMENT_METHOD_LABELS).map(([v, m]) => ({
    value: v as PaymentMethod,
    label: m.label,
  }));

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

export function FactoryAccountLedger({ account }: { account: FactoryAccount }) {
  const { t, i18n } = useTranslation("factory");
  const isZh = i18n.language === "zh";

  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, refetch } = useLedger(account.account_id);
  const addEntry = useAddLedgerEntry(account.account_id);
  const reconcile = useReconcileEntries(account.account_id);

  const balance = account.current_balance_base;
  const isNearThreshold =
    account.credit_alert_threshold != null &&
    balance >= account.credit_alert_threshold * 0.9;
  const isOverThreshold =
    account.credit_alert_threshold != null &&
    balance >= account.credit_alert_threshold;

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
            <div className="micro mb-1">{t("currentBalance")}</div>
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
                {t("alertThreshold")}:{" "}
                <span className="font-mono">
                  {cny(account.credit_alert_threshold)}
                </span>
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
                {t("reconcile", { count: selected.size })}
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowAdd(true)}
            >
              {t("addEntry")}
            </Button>
          </div>
        </div>

        {isOverThreshold && (
          <div className="mt-3 flex items-center gap-2 text-[12px] text-danger bg-danger/10 border border-danger/25 rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {t("balanceExceeded")}
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
                  {t("date")}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-left">
                  {t("type")}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-left">
                  {t("description")}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-right">
                  {t("debit")}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-right">
                  {t("credit")}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-right">
                  {t("balance")}
                </th>
                <th className="micro p-[10px_14px] border-b hairline bg-text-primary/[0.02] text-center">
                  {t("reconCol")}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td
                        key={j}
                        className="p-[0_14px] h-[50px] border-b hairline"
                      >
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
                          {isZh ? meta.labelZh : meta.label}
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
            title={t("noEntries")}
            message={t("noEntriesMsg")}
          />
        )}
        {isError && (
          <EmptyState
            icon={<AlertTriangle className="w-6 h-6" />}
            title={t("failedToLoad")}
            message={t("couldNotLoadEntries")}
            action={
              <Button size="sm" variant="secondary" onClick={() => refetch()}>
                {t("retry")}
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
        onAdd={addEntry}
      />
    </div>
  );
}

function AddEntryDrawer({
  open,
  onClose,
  accountId: _accountId,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  onAdd: ReturnType<typeof useAddLedgerEntry>;
}) {
  const { t, i18n } = useTranslation("factory");
  const isZh = i18n.language === "zh";

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
      {
        onSuccess: () => {
          onClose();
          setForm((p) => ({
            ...p,
            amount_original: "",
            description: "",
            notes: "",
          }));
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={t("addLedgerEntry")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={onAdd.isPending || !form.amount_original}
            onClick={handleSubmit}
          >
            {onAdd.isPending ? t("saving") : t("saveEntry")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("entryType")}>
          <Select
            value={form.entry_type}
            onChange={handleTypeChange}
            options={ENTRY_TYPES.map((o) => ({
              value: o.value,
              label: isZh ? ENTRY_TYPE_META[o.value].labelZh : o.label,
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
                {d === "DR" ? t("debit") : t("credit")}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("amount")}>
            <NumberField
              value={form.amount_original}
              onChange={(v) => setField("amount_original", v)}
              placeholder="0.00"
            />
          </Field>
          <Field label={t("currency")}>
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

        <Field label={t("fxRate")}>
          <NumberField
            value={form.fx_rate_to_base}
            onChange={(v) => setField("fx_rate_to_base", v)}
            placeholder="1"
          />
        </Field>

        <Field label={t("date")}>
          <input
            type="date"
            value={form.entry_date}
            onChange={(e) => setField("entry_date", e.target.value)}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
          />
        </Field>

        <Field label={t("paymentMethod")}>
          <Select
            value={form.payment_method}
            onChange={(v) =>
              setField("payment_method", v as PaymentMethod | "")
            }
            options={[
              { value: "", label: t("selectPrompt") },
              ...PAYMENT_METHODS.map((o) => ({
                value: o.value,
                label: isZh ? PAYMENT_METHOD_LABELS[o.value].labelZh : o.label,
              })),
            ]}
          />
        </Field>

        <Field label={t("paidBy")}>
          <input
            type="text"
            value={form.paid_by}
            onChange={(e) => setField("paid_by", e.target.value)}
            placeholder={t("paidByPlaceholder")}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
          />
        </Field>

        <Field label={t("description")}>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
            placeholder={t("descriptionPlaceholder")}
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50"
          />
        </Field>
      </div>
    </Drawer>
  );
}
