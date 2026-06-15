import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useMemo, useState } from "react";
import { Info, Loader2, Percent, Plus } from "lucide-react";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState, MultiSelect, NumberField, Select, Toggle } from "@/components/ui/controls";
import { Field, TextInput } from "@/components/ui/Form";
import { useActiveBusiness } from "@/stores/business";
import {
  useCreateTaxRate,
  useTaxRates,
  useUpdateTaxRate,
  type TaxRate,
} from "@/lib/settings";

/**
 * Settings → Tax rates. Taxes are defined once and used across the whole
 * system; rows are grouped by type and can be excluded per-module.
 */

const TAX_TYPES: { value: TaxRate["tax_type"]; label: string }[] = [
  { value: "sales", label: "Sales" },
  { value: "purchases", label: "Purchases" },
  { value: "payroll", label: "Payroll" },
];

const MODULE_OPTIONS = [
  "sales",
  "invoicing",
  "pos",
  "storefront",
  "purchasing",
  "accounting",
] as const;
type ModuleKey = (typeof MODULE_OPTIONS)[number];
const MODULE_SELECT = MODULE_OPTIONS.map((m) => ({ value: m, label: m }));

export function TaxRatesPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Tax Rates" }]);
  const active = useActiveBusiness();
  const query = useTaxRates();
  const [adding, setAdding] = useState(false);

  const grouped = useMemo(() => {
    const rows = query.data ?? [];
    return TAX_TYPES.map((t) => ({
      ...t,
      rows: rows.filter((r) => r.tax_type === t.value),
    }));
  }, [query.data]);

  return (
    <div className="max-w-[1000px] space-y-7 pb-24">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1.5">
            <h1 className="font-display text-[22px] font-medium">Tax rates</h1>
            <Pill tone="accent" dot={false}>
              Editing for: {active.name}
            </Pill>
          </div>
          <p className="text-xs text-text-muted">
            Define taxes once; they apply across every module unless excluded.
          </p>
        </div>
        <Button size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => setAdding(true)}>
          Add tax
        </Button>
      </header>

      <div className="flex items-start gap-2.5 rounded-[12px] border border-info/40 bg-info/10 text-info px-3.5 py-3 text-[12.5px] leading-relaxed">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <span>
          Taxes are defined here and used across the whole system. Disable a tax
          to remove it everywhere; or keep it on and exclude specific modules.
        </span>
      </div>

      {query.isError ? (
        <Card>
          <ErrorState onRetry={() => query.refetch()} />
        </Card>
      ) : (
        grouped.map((g) => (
          <TaxGroup key={g.value} title={g.label} rows={g.rows} loading={query.isLoading} onAdd={() => setAdding(true)} />
        ))
      )}

      <AddTaxDrawer open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function TaxGroup({
  title,
  rows,
  loading,
  onAdd,
}: {
  title: string;
  rows: TaxRate[];
  loading: boolean;
  onAdd: () => void;
}) {
  const update = useUpdateTaxRate();

  const columns: Column<TaxRate>[] = [
    { key: "name", header: "Tax", render: (r) => <span className="font-semibold">{r.tax_name}</span> },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      render: (r) => <span className="tabular-nums">{(Number(r.rate) * 100).toLocaleString(undefined, { maximumFractionDigits: 4 })}%</span>,
    },
    { key: "applies_to", header: "Applies to", render: (r) => <span className="text-text-muted">{r.applies_to || "—"}</span> },
    {
      key: "effective_from",
      header: "Effective from",
      render: (r) => <span className="text-text-muted">{r.effective_from}</span>,
    },
    {
      key: "active",
      header: "Active",
      render: (r) => (
        <Toggle
          checked={r.is_active}
          disabled={update.isPending}
          onChange={(v) => update.mutate({ id: r.tax_id, patch: { is_active: v } })}
        />
      ),
    },
    {
      key: "excluded",
      header: "Excluded modules",
      width: "300px",
      render: (r) => (
        <MultiSelect<ModuleKey>
          values={(r.excluded_modules ?? []) as ModuleKey[]}
          options={MODULE_SELECT}
          onChange={(v) => update.mutate({ id: r.tax_id, patch: { excluded_modules: v } })}
        />
      ),
    },
  ];

  return (
    <section>
      <div className="micro mb-3">{title}</div>
      <DataTable<TaxRate>
        columns={columns}
        rows={rows}
        rowKey={(r) => r.tax_id}
        loading={loading}
        empty={{
          icon: <Percent className="w-8 h-8" />,
          title: `No ${title.toLowerCase()} taxes`,
          message: "Add a tax to apply it across the system.",
          action: (
            <Button icon={<Plus className="w-4 h-4" />} onClick={onAdd}>
              Add tax
            </Button>
          ),
        }}
      />
    </section>
  );
}

function AddTaxDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateTaxRate();
  const [name, setName] = useState("");
  const [type, setType] = useState<TaxRate["tax_type"]>("sales");
  const [ratePct, setRatePct] = useState("");
  const [appliesTo, setAppliesTo] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const reset = () => {
    setName("");
    setType("sales");
    setRatePct("");
    setAppliesTo("");
    setEffectiveFrom("");
  };

  const submit = () => {
    create.mutate(
      {
        tax_name: name.trim(),
        tax_type: type,
        rate: String((Number(ratePct) || 0) / 100),
        applies_to: appliesTo.trim(),
        effective_from: effectiveFrom || undefined,
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
      title="Add tax"
      subtitle="Define a new tax rate"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim() || !ratePct || create.isPending}
            onClick={submit}
            icon={create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            Save tax
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tax name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="VAT" />
        </Field>
        <Field label="Tax type">
          <Select value={type} onChange={setType} options={TAX_TYPES} />
        </Field>
        <Field label="Rate" hint="entered as a percent">
          <NumberField value={ratePct} onChange={setRatePct} suffix="%" placeholder="7.5" />
        </Field>
        <Field label="Applies to">
          <TextInput value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} placeholder="All goods & services" />
        </Field>
        <Field label="Effective from">
          <TextInput type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
        {create.isError && (
          <p className="text-[12px] text-danger">
            {create.error instanceof Error ? create.error.message : "Could not save tax."}
          </p>
        )}
      </div>
    </Drawer>
  );
}
