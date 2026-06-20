import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useState } from "react";
import { Coins, Loader2, Plus, RefreshCw } from "lucide-react";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import {
  ErrorState,
  NumberField,
  Select,
  Toggle,
} from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/Form";
import { useActiveBusiness } from "@/stores/business";
import {
  useCurrencies,
  useFxRates,
  useSaveCurrency,
  useSetFxRate,
  useUpdateCurrency,
  type Currency,
  type FxRate,
} from "@/lib/settings";

/**
 * Settings → Currencies & FX. Two sections: the currency registry
 * (per-platform) and the FX rate ledger with a manual-override form.
 */
export function CurrenciesPage() {
  useBreadcrumbs([
    { label: "Settings", href: "/settings" },
    { label: "Currencies & FX" },
  ]);
  const active = useActiveBusiness();

  return (
    <div className="max-w-[920px] mx-auto space-y-9 pb-24">
      <header>
        <div className="flex items-center gap-2.5 mb-1.5">
          <h1 className="font-display text-[22px] font-medium">
            Currencies &amp; FX
          </h1>
          <Pill tone="accent" dot={false}>
            Editing for: {active.name}
          </Pill>
        </div>
        <p className="text-xs text-text-muted">
          The currency registry and the foreign-exchange rate ledger used across
          pricing, invoicing and settlement.
        </p>
      </header>

      <CurrenciesSection />
      <div className="h-px bg-text-primary/10" />
      <FxSection />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Currencies
// ──────────────────────────────────────────────────────────────

function CurrenciesSection() {
  const query = useCurrencies();
  const update = useUpdateCurrency();
  const [adding, setAdding] = useState(false);

  const columns: Column<Currency>[] = [
    {
      key: "code",
      header: "Code",
      render: (r) => (
        <span className="font-mono font-semibold">{r.currency_code}</span>
      ),
    },
    { key: "name", header: "Name", render: (r) => r.display_name },
    {
      key: "symbol",
      header: "Symbol",
      render: (r) => <span className="font-mono">{r.symbol}</span>,
    },
    {
      key: "decimals",
      header: "Decimals",
      align: "right",
      render: (r) => <span className="tabular-nums">{r.decimal_places}</span>,
    },
    {
      key: "settlement",
      header: "Settlement",
      render: (r) =>
        r.is_settlement ? (
          <Pill tone="info">Settlement</Pill>
        ) : (
          <span className="text-text-faint">—</span>
        ),
    },
    {
      key: "active",
      header: "Active",
      render: (r) => (
        <Toggle
          checked={r.is_active}
          disabled={update.isPending}
          onChange={(v) =>
            update.mutate({ code: r.currency_code, patch: { is_active: v } })
          }
        />
      ),
    },
  ];

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="micro">Currencies</div>
        <Button
          size="sm"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setAdding(true)}
        >
          Add currency
        </Button>
      </div>

      {query.isError ? (
        <Card>
          <ErrorState onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <DataTable<Currency>
          columns={columns}
          rows={query.data ?? []}
          rowKey={(r) => r.currency_code}
          loading={query.isLoading}
          empty={{
            icon: <Coins className="w-8 h-8" />,
            title: "No currencies yet",
            message: "Add a currency to start pricing and settling in it.",
            action: (
              <Button
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setAdding(true)}
              >
                Add currency
              </Button>
            ),
          }}
        />
      )}

      <AddCurrencyDrawer open={adding} onClose={() => setAdding(false)} />
    </section>
  );
}

function AddCurrencyDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const save = useSaveCurrency();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [decimals, setDecimals] = useState("2");
  const [rounding, setRounding] = useState("0.01");
  const [isSettlement, setIsSettlement] = useState(false);
  const [isActive, setIsActive] = useState(true);

  const reset = () => {
    setCode("");
    setName("");
    setSymbol("");
    setDecimals("2");
    setRounding("0.01");
    setIsSettlement(false);
    setIsActive(true);
  };

  const submit = () => {
    save.mutate(
      {
        currency_code: code.trim().toUpperCase(),
        display_name: name.trim(),
        symbol: symbol.trim(),
        decimal_places: Number(decimals) || 0,
        rounding_unit: rounding.trim() || "0.01",
        is_settlement: isSettlement,
        is_active: isActive,
      },
      {
        onSuccess: () => {
          reset();
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add currency"
      subtitle="New currency registry entry"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!code.trim() || !name.trim() || save.isPending}
            onClick={submit}
            icon={
              save.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : undefined
            }
          >
            Save currency
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Code" hint="ISO 4217, e.g. NGN">
          <TextInput
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="NGN"
            maxLength={3}
          />
        </Field>
        <Field label="Display name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nigerian Naira"
          />
        </Field>
        <Field label="Symbol">
          <TextInput
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="₦"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Decimal places">
            <NumberField
              value={decimals}
              onChange={setDecimals}
              allowDecimal={false}
              placeholder="2"
            />
          </Field>
          <Field label="Rounding unit">
            <NumberField
              value={rounding}
              onChange={setRounding}
              placeholder="0.01"
            />
          </Field>
        </div>
        <div className="flex items-center gap-6 pt-1">
          <Toggle
            checked={isSettlement}
            onChange={setIsSettlement}
            label="Settlement currency"
          />
          <Toggle checked={isActive} onChange={setIsActive} label="Active" />
        </div>
        {save.isError && (
          <p className="text-[12px] text-danger">
            {save.error instanceof Error
              ? save.error.message
              : "Could not save currency."}
          </p>
        )}
      </div>
    </Drawer>
  );
}

// ──────────────────────────────────────────────────────────────
// FX rates
// ──────────────────────────────────────────────────────────────

function FxSection() {
  const query = useFxRates();
  const currencies = useCurrencies();
  const setRate = useSetFxRate();

  const codes = (currencies.data ?? []).map((c) => c.currency_code);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rate, setRate2] = useState("");
  const [validAt, setValidAt] = useState("");

  // Default the selects once codes load.
  const fromValue = from || codes[0] || "";
  const toValue = to || codes[1] || codes[0] || "";

  const submit = () => {
    setRate.mutate(
      {
        from_currency: fromValue,
        to_currency: toValue,
        rate: Number(rate),
        valid_at: validAt || undefined,
        source: "manual",
      },
      {
        onSuccess: () => {
          setRate2("");
          setValidAt("");
        },
      },
    );
  };

  const columns: Column<FxRate>[] = [
    {
      key: "pair",
      header: "Pair",
      render: (r) => (
        <span className="font-mono font-semibold">
          {r.from_currency} → {r.to_currency}
        </span>
      ),
    },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      render: (r) => (
        <span className="tabular-nums">
          {Number(r.rate).toLocaleString(undefined, {
            maximumFractionDigits: 8,
          })}
        </span>
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (r) => r.source ?? <span className="text-text-faint">—</span>,
    },
    {
      key: "override",
      header: "Type",
      render: (r) =>
        r.is_manual_override ? (
          <Pill tone="warn">Manual</Pill>
        ) : (
          <Pill tone="neutral">Auto</Pill>
        ),
    },
    {
      key: "valid_at",
      header: "Valid at",
      render: (r) => (
        <span className="text-text-muted">
          {new Date(r.valid_at).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div className="micro">FX rates</div>
        <span className="text-[11px] text-text-faint">
          Provider: exchangerate.host · auto-refresh 02:00 UTC
        </span>
      </div>

      {/* Add manual override */}
      <Card className="p-4 mb-3">
        <div className="micro mb-3">Add manual override</div>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
          <Field label="From">
            <Select
              value={fromValue}
              onChange={setFrom}
              options={codes.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="To">
            <Select
              value={toValue}
              onChange={setTo}
              options={codes.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="Rate">
            <NumberField value={rate} onChange={setRate2} placeholder="0.00" />
          </Field>
          <Field label="Valid at" hint="optional">
            <TextInput
              type="datetime-local"
              value={validAt}
              onChange={(e) => setValidAt(e.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            disabled={!fromValue || !toValue || !rate || setRate.isPending}
            onClick={submit}
            icon={
              setRate.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )
            }
          >
            Set rate
          </Button>
        </div>
        {setRate.isError && (
          <p className="text-[12px] text-danger mt-2">
            {setRate.error instanceof Error
              ? setRate.error.message
              : "Could not set rate."}
          </p>
        )}
      </Card>

      {query.isError ? (
        <Card>
          <ErrorState onRetry={() => query.refetch()} />
        </Card>
      ) : (
        <DataTable<FxRate>
          columns={columns}
          rows={query.data ?? []}
          rowKey={(r) => r.rate_id}
          loading={query.isLoading}
          empty={{
            icon: <RefreshCw className="w-8 h-8" />,
            title: "No FX rates yet",
            message:
              "Rates appear once the auto-refresh runs or you add a manual override above.",
          }}
        />
      )}
    </section>
  );
}
