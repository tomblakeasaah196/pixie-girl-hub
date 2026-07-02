import { useMemo, useState } from "react";
import { Landmark, ReceiptText } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import {
  Button,
  Card,
  EmptyState,
  MoneyText,
  Pill,
  Skeleton,
  type Tone,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Select } from "@/components/ui/controls";
import {
  usePeriods,
  useTaxComputation,
  useTaxFilingActions,
  useTaxFilings,
} from "./hooks";
import type { TaxComputationLine, TaxFiling, TaxType } from "./types";

const FILING_TONE: Record<string, Tone> = {
  draft: "neutral",
  reviewed: "info",
  filed: "warn",
  paid: "success",
  overdue: "danger",
  disputed: "danger",
  closed: "neutral",
};

const num = (v: string | undefined | null) => Number(v || 0);

export default function TaxCenterTab() {
  const can = useAuthStore((s) => s.can);
  const [taxType, setTaxType] = useState<TaxType>("VAT");
  const [periodId, setPeriodId] = useState("");
  const { data: periods } = usePeriods();
  const actions = useTaxFilingActions();

  const periodOptions = useMemo(() => {
    const opts = (periods ?? [])
      .filter((p) => p.status !== "future")
      .map((p) => ({ value: p.period_id, label: p.period_name }));
    return [{ value: "", label: "Select period…" }, ...opts];
  }, [periods]);

  const comp = useTaxComputation(taxType, periodId || null);

  return (
    <div className="space-y-5">
      {/* ── Computation from the GL ── */}
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="font-display text-lg">Compute from the ledger</h3>
          <div className="ml-auto flex gap-2 items-center">
            <div className="w-28">
              <Select
                value={taxType}
                onChange={(v) => setTaxType(v as TaxType)}
                options={["VAT", "PAYE", "WHT"].map((t) => ({ value: t as TaxType, label: t }))}
              />
            </div>
            <div className="w-48">
              <Select value={periodId} onChange={setPeriodId} options={periodOptions} />
            </div>
          </div>
        </div>

        {!periodId && (
          <EmptyState
            icon={<Landmark className="w-8 h-8" />}
            title="Pick a fiscal period"
            message="Figures are computed from posted journals only — nothing is typed in."
          />
        )}
        {periodId && comp.isLoading && (
          <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="w-full h-5" />)}</div>
        )}
        {periodId && comp.error != null && (
          <EmptyState
            icon={<Landmark className="w-8 h-8" />}
            title="Computation failed"
            action={<Button variant="secondary" onClick={() => comp.refetch()}>Retry</Button>}
          />
        )}
        {periodId && comp.data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {taxType === "VAT" && (
                <>
                  <Stat label="Output VAT (2100)" value={num(comp.data.output_vat_ngn)} />
                  <Stat label="Input VAT (2110)" value={num(comp.data.input_vat_ngn)} />
                </>
              )}
              {taxType === "PAYE" && (
                <Stat label="Gross payroll base" value={num(comp.data.taxable_amount_ngn)} />
              )}
              <Stat label={`${taxType} due`} value={num(comp.data.tax_amount_ngn)} highlight />
              <div>
                <p className="micro text-text-muted">Remit by</p>
                <p className="font-display font-medium">{comp.data.due_date}</p>
              </div>
            </div>
            {can("accounting", "create") && (
              <Button
                variant="primary"
                disabled={actions.draft.isPending}
                onClick={() =>
                  actions.draft.mutate({ tax_type: taxType, fiscal_period_id: periodId })
                }
              >
                {actions.draft.isPending ? "Drafting…" : "Create draft filing"}
              </Button>
            )}
            <DrillDown lines={comp.data.lines} />
          </>
        )}
      </Card>

      {/* ── Filings pipeline ── */}
      <FilingsTable />
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <p className="micro text-text-muted">{label}</p>
      <MoneyText ngn={value} className={highlight ? "text-lg text-accent" : undefined} />
    </div>
  );
}

function DrillDown({ lines }: { lines: TaxComputationLine[] }) {
  const [open, setOpen] = useState(false);
  if (lines.length === 0)
    return <p className="text-text-faint text-xs">No contributing journals in this period.</p>;
  return (
    <div>
      <button className="text-accent text-sm underline-offset-2 hover:underline" onClick={() => setOpen(!open)}>
        {open ? "Hide" : "Show"} {lines.length} contributing journal line{lines.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-line">
          <table className="w-full text-xs">
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-b hairline last:border-0">
                  <td className="p-2 font-mono">{l.entry_number}</td>
                  <td className="p-2">{String(l.posting_date).slice(0, 10)}</td>
                  <td className="p-2">{l.source_type}</td>
                  <td className="p-2 text-text-muted">{l.line_description || l.entry_description}</td>
                  <td className="p-2 text-right font-mono">
                    {num(l.debit_ngn) > 0 ? `DR ${l.debit_ngn}` : `CR ${l.credit_ngn}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilingsTable() {
  const can = useAuthStore((s) => s.can);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useTaxFilings({ page });
  const actions = useTaxFilingActions();

  const cols: Column<TaxFiling>[] = [
    { key: "no", header: "Filing", width: "130px", render: (r) => <span className="font-mono text-xs">{r.filing_number}</span> },
    { key: "type", header: "Tax", width: "70px", render: (r) => <Pill tone="neutral">{r.tax_type}</Pill> },
    { key: "tax", header: "Tax due", align: "right", render: (r) => <MoneyText ngn={num(r.tax_amount_ngn)} /> },
    { key: "due", header: "Due date", width: "105px", render: (r) => String(r.due_date).slice(0, 10) },
    { key: "status", header: "Status", width: "95px", render: (r) => <Pill tone={FILING_TONE[r.status] ?? "neutral"}>{r.status}</Pill> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) =>
        can("accounting", "approve") ? (
          <span className="flex gap-1.5 justify-end">
            {r.status === "draft" && (
              <Button variant="ghost" onClick={() => actions.review.mutate(r.filing_id)}>Review</Button>
            )}
            {(r.status === "draft" || r.status === "reviewed") && (
              <Button variant="ghost" onClick={() => actions.file.mutate({ id: r.filing_id })}>File</Button>
            )}
            {r.status === "filed" && (
              <Button variant="secondary" onClick={() => actions.pay.mutate({ id: r.filing_id })}>
                Pay &amp; post
              </Button>
            )}
          </span>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <h3 className="font-display text-lg">Filings</h3>
      <DataTable
        columns={cols}
        rows={data?.data ?? []}
        rowKey={(r) => r.filing_id}
        loading={isLoading}
        empty={{
          icon: <ReceiptText className="w-8 h-8" />,
          title: "No filings yet",
          message: "Compute a period above and create its draft filing.",
        }}
      />
      {data && data.meta.total > data.meta.page_size && (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button variant="ghost" disabled={!data.meta.has_more} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
