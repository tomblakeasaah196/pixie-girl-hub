import { useState } from "react";
import { FileText, Plus, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill, MoneyText, Button } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useQuotations } from "./hooks";
import { QUOTE_STATUS, QUOTE_STATUS_OPTIONS } from "./constants";
import { QuoteDetail } from "./QuoteDetail";
import { QuoteFormModal } from "./QuoteFormModal";
import type { Quotation, QuoteStatus } from "./types";

const columns: Column<Quotation>[] = [
  {
    key: "number",
    header: "Quote #",
    width: "130px",
    render: (q) => (
      <span className="font-mono text-[13px] font-semibold">
        {q.quotation_number}
      </span>
    ),
  },
  {
    key: "contact",
    header: "Customer",
    render: (q) => (
      <span className="text-[13px]">
        {q.contact_name ?? q.contact_id.slice(0, 8)}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (q) => {
      const s = QUOTE_STATUS[q.status as QuoteStatus];
      return s ? <Pill tone={s.tone}>{s.label}</Pill> : <Pill>{q.status}</Pill>;
    },
  },
  {
    key: "total",
    header: "Total",
    align: "right",
    render: (q) => <MoneyText ngn={Number(q.total_ngn)} />,
  },
  {
    key: "valid",
    header: "Valid Until",
    width: "110px",
    render: (q) =>
      q.valid_until ? (
        <span className="text-[12px] text-text-muted">
          {new Date(q.valid_until).toLocaleDateString()}
        </span>
      ) : (
        <span className="text-[12px] text-text-faint">—</span>
      ),
  },
  {
    key: "date",
    header: "Created",
    width: "110px",
    render: (q) => (
      <span className="text-[12px] text-text-muted">
        {new Date(q.created_at).toLocaleDateString()}
      </span>
    ),
  },
];

export function QuotationsView() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useQuotations({
    status: status || undefined,
    page,
    page_size: 25,
  });

  const allQuotes = data?.data ?? [];
  const meta = data?.meta;
  const quotes = search
    ? allQuotes.filter((q) => {
        const term = search.toLowerCase();
        return (
          q.quotation_number.toLowerCase().includes(term) ||
          (q.contact_name ?? "").toLowerCase().includes(term)
        );
      })
    : allQuotes;

  return (
    <>
      <DataTable
        columns={columns}
        rows={quotes}
        rowKey={(q) => q.quotation_id}
        onRowClick={(q) => setSelectedId(q.quotation_id)}
        loading={isLoading}
        empty={{
          icon: <FileText className="w-8 h-8" />,
          title: "No quotations",
          message: "Create a quotation to start the B2B sales flow.",
          action: (
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setShowCreate(true)}
            >
              New Quotation
            </Button>
          ),
        }}
        toolbar={
          <>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
              <input
                placeholder="Search quotations…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full h-[38px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
            </div>
            <Select
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={
                QUOTE_STATUS_OPTIONS as { value: string; label: string }[]
              }
              className="w-[180px]"
            />
            <Button
              variant="primary"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowCreate(true)}
            >
              New Quote
            </Button>
          </>
        }
      />

      {meta && meta.total > meta.page_size && (
        <div className="flex items-center justify-between text-[12px] text-text-muted mt-3 px-1">
          <span>
            Showing {(meta.page - 1) * meta.page_size + 1}–
            {Math.min(meta.page * meta.page_size, meta.total)} of {meta.total}
          </span>
          <div className="flex gap-1">
            <button
              disabled={meta.page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="px-3 h-8 rounded-[9px] border border-line text-[12px] font-semibold disabled:opacity-40 hover:bg-text-primary/[0.05]"
            >
              Prev
            </button>
            <button
              disabled={!meta.has_more}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 h-8 rounded-[9px] border border-line text-[12px] font-semibold disabled:opacity-40 hover:bg-text-primary/[0.05]"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <QuoteDetail quoteId={selectedId} onClose={() => setSelectedId(null)} />
      <QuoteFormModal open={showCreate} onClose={() => setShowCreate(false)} />
    </>
  );
}
