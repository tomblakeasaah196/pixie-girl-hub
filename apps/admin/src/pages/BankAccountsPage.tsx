import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useEffect, useState } from "react";
import { Landmark, Loader2, Plus, Star } from "lucide-react";
import { Button, Card, MaskedField, Pill } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState, Select, Toggle } from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/Form";
import { useActiveBusiness } from "@/stores/business";
import {
  useBankAccounts,
  useCreateBankAccount,
  useCurrencies,
  useUpdateBankAccount,
  type BankAccount,
} from "@/lib/settings";

/**
 * Settings → Bank accounts. Per-brand settlement accounts with gateway
 * links and a primary flag. Add via Drawer; click a row to edit.
 */
export function BankAccountsPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Bank Accounts" }]);
  const active = useActiveBusiness();
  const query = useBankAccounts();
  const update = useUpdateBankAccount();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<BankAccount | null>(null);

  const columns: Column<BankAccount>[] = [
    { key: "bank", header: "Bank", render: (r) => <span className="font-semibold">{r.bank_name}</span> },
    { key: "account_name", header: "Account name", render: (r) => r.account_name },
    {
      key: "number",
      header: "Account no.",
      render: (r) =>
        r.account_number_masked ? (
          <span className="font-mono text-text-muted">{r.account_number_masked}</span>
        ) : (
          <MaskedField value={r.account_number} />
        ),
    },
    { key: "currency", header: "Currency", render: (r) => <span className="font-mono">{r.currency}</span> },
    {
      key: "primary",
      header: "Primary",
      render: (r) =>
        r.is_primary ? (
          <Star className="w-4 h-4 text-accent-glow fill-current" />
        ) : (
          <span className="text-text-faint">—</span>
        ),
    },
    {
      key: "gateways",
      header: "Gateway links",
      render: (r) => (
        <div className="flex gap-1.5">
          <Pill tone={r.paystack_recipient_code ? "success" : "neutral"} dot={false}>
            Paystack {r.paystack_recipient_code ? "Linked" : "—"}
          </Pill>
          <Pill tone={r.opay_account_id ? "success" : "neutral"} dot={false}>
            OPay {r.opay_account_id ? "Linked" : "—"}
          </Pill>
        </div>
      ),
    },
    {
      key: "active",
      header: "Active",
      render: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle
            checked={r.is_active}
            disabled={update.isPending}
            onChange={(v) => update.mutate({ id: r.account_id, patch: { is_active: v } })}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-[1000px] mx-auto space-y-6 pb-24">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <h1 className="font-display text-[22px] font-medium">Bank accounts</h1>
            <Pill tone="accent" dot={false}>
              Editing for: {active.name}
            </Pill>
          </div>
          <p className="text-xs text-text-muted">Settlement accounts and their gateway links.</p>
        </div>
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)}>
          Add bank account
        </Button>
      </header>

      {query.isError ? (
        <Card>
          <ErrorState onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <DataTable<BankAccount>
          columns={columns}
          rows={query.data ?? []}
          rowKey={(r) => r.account_id}
          loading={query.isLoading}
          onRowClick={(r) => setEditing(r)}
          empty={{
            icon: <Landmark className="w-8 h-8" />,
            title: "No bank accounts yet",
            message: "Add an account to receive settlements for this brand.",
            action: (
              <Button icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)}>
                Add bank account
              </Button>
            ),
          }}
        />
      )}

      <BankAccountDrawer open={adding} onClose={() => setAdding(false)} />
      <BankAccountDrawer
        open={!!editing}
        account={editing ?? undefined}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function BankAccountDrawer({
  open,
  account,
  onClose,
}: {
  open: boolean;
  account?: BankAccount;
  onClose: () => void;
}) {
  const create = useCreateBankAccount();
  const update = useUpdateBankAccount();
  const currencies = useCurrencies();
  const codes = (currencies.data ?? []).map((c) => c.currency_code);
  const isEdit = !!account;

  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [sortCode, setSortCode] = useState("");
  const [currency, setCurrency] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);

  // Hydrate from the row when opening the edit drawer.
  useEffect(() => {
    if (!open) return;
    setBankName(account?.bank_name ?? "");
    setAccountName(account?.account_name ?? "");
    setAccountNumber(account?.account_number ?? "");
    setSortCode(account?.sort_code ?? "");
    setCurrency(account?.currency ?? "");
    setIsPrimary(account?.is_primary ?? false);
  }, [open, account]);

  const currencyValue = currency || codes[0] || "";
  const busy = create.isPending || update.isPending;
  const err = create.error ?? update.error;

  const submit = () => {
    const patch = {
      bank_name: bankName.trim(),
      account_name: accountName.trim(),
      account_number: accountNumber.trim(),
      sort_code: sortCode.trim() || null,
      currency: currencyValue,
      is_primary: isPrimary,
    };
    const onSuccess = () => onClose();
    if (isEdit && account) {
      update.mutate({ id: account.account_id, patch }, { onSuccess });
    } else {
      create.mutate(patch, { onSuccess });
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit bank account" : "Add bank account"}
      subtitle={isEdit ? account?.bank_name : "New settlement account"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!bankName.trim() || !accountName.trim() || !accountNumber.trim() || busy}
            onClick={submit}
            icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            {isEdit ? "Save changes" : "Save account"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Bank name">
          <TextInput value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Guaranty Trust Bank" />
        </Field>
        <Field label="Account name">
          <TextInput value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="Pixie Girl Ltd" />
        </Field>
        <Field label="Account number">
          <TextInput value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="0123456789" />
        </Field>
        <Field label="Sort code" hint="optional">
          <TextInput value={sortCode} onChange={(e) => setSortCode(e.target.value)} placeholder="058" />
        </Field>
        <Field label="Currency">
          <Select value={currencyValue} onChange={setCurrency} options={codes.map((c) => ({ value: c, label: c }))} />
        </Field>
        <div className="pt-1">
          <Toggle checked={isPrimary} onChange={setIsPrimary} label="Primary account" />
        </div>
        {err && (
          <p className="text-[12px] text-danger">
            {err instanceof Error ? err.message : "Could not save bank account."}
          </p>
        )}
      </div>
    </Drawer>
  );
}
