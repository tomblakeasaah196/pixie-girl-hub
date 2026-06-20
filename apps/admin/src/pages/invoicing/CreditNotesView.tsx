import { useState } from "react";
import { Undo2, Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill, MoneyText, Button } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useCreditNotes } from "./hooks";
import { CREDIT_NOTE_STATUS, CREDIT_NOTE_STATUS_OPTIONS } from "./constants";
import { CreditNoteDetail } from "./CreditNoteDetail";
import { CreditNoteCreateDrawer } from "./CreditNoteCreateDrawer";
import type { CreditNote } from "./types";

const columns: Column<CreditNote>[] = [
  {
    key: "number",
    header: "Credit Note #",
    width: "150px",
    render: (cn) => (
      <span className="font-mono text-[13px] font-semibold">{cn.credit_note_number}</span>
    ),
  },
  {
    key: "invoice",
    header: "Invoice",
    width: "140px",
    render: (cn) => (
      <span className="font-mono text-[12px] text-text-muted">{cn.invoice_number ?? cn.invoice_id.slice(0, 8)}</span>
    ),
  },
  {
    key: "contact",
    header: "Customer",
    render: (cn) => <span className="text-[13px]">{cn.contact_name ?? "—"}</span>,
  },
  {
    key: "status",
    header: "Status",
    render: (cn) => {
      const s = CREDIT_NOTE_STATUS[cn.status];
      return s ? <Pill tone={s.tone}>{s.label}</Pill> : <Pill>{cn.status}</Pill>;
    },
  },
  {
    key: "total",
    header: "Total Credit",
    align: "right",
    render: (cn) => <MoneyText ngn={Number(cn.total_ngn)} />,
  },
];

export function CreditNotesView() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading } = useCreditNotes({
    status: status || undefined,
    page,
    page_size: 25,
  });

  const notes = data?.data ?? [];
  const meta = data?.meta;

  return (
    <>
      <DataTable
        columns={columns}
        rows={notes}
        rowKey={(cn) => cn.credit_note_id}
        onRowClick={(cn) => setSelectedId(cn.credit_note_id)}
        loading={isLoading}
        empty={{
          icon: <Undo2 className="w-8 h-8" />,
          title: "No credit notes yet",
          message: "Credit notes you issue against invoices will appear here.",
          action: (
            <Button variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowCreate(true)}>
              New Credit Note
            </Button>
          ),
        }}
        toolbar={
          <>
            <Select
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
              options={CREDIT_NOTE_STATUS_OPTIONS as { value: string; label: string }[]}
              className="w-[180px]"
            />
            <Button variant="primary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setShowCreate(true)}>
              New Credit Note
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

      <CreditNoteDetail creditNoteId={selectedId} onClose={() => setSelectedId(null)} />
      <CreditNoteCreateDrawer
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => { setShowCreate(false); setSelectedId(id); }}
      />
    </>
  );
}
