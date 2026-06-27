import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Search, Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill, MoneyText, Button } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useInvoices } from "./hooks";
import { INVOICE_STATUS, INVOICE_STATUS_OPTIONS } from "./constants";
import { InvoiceDetail } from "./InvoiceDetail";
import { InvoiceCreateDrawer } from "./InvoiceCreateDrawer";
import type { Invoice, InvoiceStatus } from "./types";

const columns: Column<Invoice>[] = [
  {
    key: "number",
    header: "Invoice #",
    width: "140px",
    render: (i) => (
      <span className="font-mono text-[13px] font-semibold">{i.invoice_number}</span>
    ),
  },
  {
    key: "contact",
    header: "Customer",
    render: (i) => <span className="text-[13px]">{i.contact_name ?? i.contact_id.slice(0, 8)}</span>,
  },
  {
    key: "status",
    header: "Status",
    render: (i) => {
      const s = INVOICE_STATUS[i.status as InvoiceStatus];
      return s ? <Pill tone={s.tone}>{s.label}</Pill> : <Pill>{i.status}</Pill>;
    },
  },
  {
    key: "due",
    header: "Due",
    width: "110px",
    render: (i) => <span className="text-[12px] text-text-muted">{new Date(i.due_date).toLocaleDateString()}</span>,
  },
  {
    key: "total",
    header: "Total",
    align: "right",
    render: (i) => <MoneyText ngn={Number(i.total_ngn)} />,
  },
  {
    key: "balance",
    header: "Balance",
    align: "right",
    render: (i) => {
      const bal = Number(i.balance_due_ngn);
      return bal > 0 ? <MoneyText ngn={bal} className="text-warn" /> : <span className="text-[12px] text-success">Paid</span>;
    },
  },
];

export function InvoicesView() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  // The selected invoice lives in the URL (?invoice=<id>) so other screens —
  // e.g. an order's "View Invoice" button — can deep-link straight into it.
  const [sp, setSp] = useSearchParams();
  const selectedId = sp.get("invoice");
  const openInvoice = (id: string | null) => {
    const next = new URLSearchParams(sp);
    if (id) next.set("invoice", id);
    else next.delete("invoice");
    setSp(next, { replace: true });
  };

  const { data, isLoading } = useInvoices({
    status: status || undefined,
    search: search || undefined,
    page,
    page_size: 25,
  });

  const invoices = data?.data ?? [];
  const meta = data?.meta;

  return (
    <>
      <DataTable
        columns={columns}
        rows={invoices}
        rowKey={(i) => i.invoice_id}
        onRowClick={(i) => openInvoice(i.invoice_id)}
        loading={isLoading}
        empty={{
          icon: <FileText className="w-8 h-8" />,
          title: "No invoices yet",
          message: "Invoices you create or generate from orders will appear here.",
          action: (
            <Button variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowCreate(true)}>
              New Invoice
            </Button>
          ),
        }}
        toolbar={
          <>
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
              <input
                placeholder="Search invoices…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full h-[38px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
            </div>
            <Select
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={INVOICE_STATUS_OPTIONS as { value: string; label: string }[]}
              className="w-[180px]"
            />
            <Button variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowCreate(true)}>
              New Invoice
            </Button>
          </>
        }
      />

      {meta && meta.total > meta.page_size && (
        <div className="flex items-center justify-between text-[12px] text-text-muted mt-3 px-1">
          <span>
            Showing {(meta.page - 1) * meta.page_size + 1}–{Math.min(meta.page * meta.page_size, meta.total)} of {meta.total}
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

      <InvoiceDetail invoiceId={selectedId} onClose={() => openInvoice(null)} />
      <InvoiceCreateDrawer
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); openInvoice(id); }}
      />
    </>
  );
}
