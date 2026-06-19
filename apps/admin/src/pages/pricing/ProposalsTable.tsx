import { useState } from "react";
import { CheckCircle, XCircle, AlertTriangle, RotateCcw } from "lucide-react";
import { Button, Pill, EmptyState } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Form";
import { cn } from "@/lib/cn";
import { useProposals, useProposalMutations } from "./hooks";
import { PROPOSAL_STATUS_META } from "./constants";
import type { Proposal } from "./types";

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "2-digit" });
}

export function ProposalsTable({ isCeo }: { isCeo: boolean }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Proposal | null>(null);

  // Modal States
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [showRevertBox, setShowRevertBox] = useState(false);
  const [actionReason, setActionReason] = useState("");

  const { data, isLoading, isError, refetch } = useProposals({
    status: statusFilter || undefined,
    page,
  });
  const { approve, reject, revert } = useProposalMutations();

  const proposals = data?.data ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 25;
  const pages = Math.ceil(total / pageSize);

  const resetModals = () => {
    setSelected(null);
    setShowRejectBox(false);
    setShowRevertBox(false);
    setActionReason("");
  };

  const cols: Column<Proposal>[] = [
    { key: "no", header: "Proposal #", width: "120px", render: (r) => <span className="font-mono text-xs">{r.proposal_number}</span> },
    { key: "title", header: "Title", render: (r) => <span className="font-semibold text-[13px]">{r.title}</span> },
    { key: "variants", header: "Variants", width: "90px", align: "right", render: (r) => <span className="font-mono text-[12px]">{r.variants_count}</span> },
    { key: "status", header: "Status", width: "130px", render: (r) => { const meta = PROPOSAL_STATUS_META[r.status]; return <Pill tone={meta.tone}>{meta.label}</Pill>; } },
    { key: "date", header: "Requested", width: "100px", render: (r) => <span className="text-text-muted text-xs">{fmt(r.created_at)}</span> },
    ...(isCeo ? [
      {
        key: "actions",
        header: "",
        width: "100px",
        render: (r: Proposal) =>
          r.status === "pending_approval" ? (
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <button title="Approve" disabled={approve.isPending} onClick={() => approve.mutate(r.proposal_id)} className="w-7 h-7 rounded-lg bg-success/15 text-success hover:bg-success/25 grid place-items-center transition-colors disabled:opacity-50"><CheckCircle className="w-4 h-4" /></button>
              <button title="Reject" disabled={reject.isPending} onClick={() => { setSelected(r); setShowRejectBox(true); }} className="w-7 h-7 rounded-lg bg-danger/15 text-danger hover:bg-danger/25 grid place-items-center transition-colors disabled:opacity-50"><XCircle className="w-4 h-4" /></button>
            </div>
          ) : r.status === "applied" ? (
            <button title="Revert" disabled={revert.isPending} onClick={(e) => { e.stopPropagation(); setSelected(r); setShowRevertBox(true); }} className="w-7 h-7 rounded-lg bg-warn/15 text-warn hover:bg-warn/25 grid place-items-center transition-colors disabled:opacity-50"><RotateCcw className="w-4 h-4" /></button>
          ) : null,
      } satisfies Column<Proposal>,
    ] : []),
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {[{ value: "", label: "All" }, { value: "pending_approval", label: "Pending" }, { value: "applied", label: "Applied" }, { value: "rejected", label: "Rejected" }].map((f) => (
            <button key={f.value} onClick={() => { setStatusFilter(f.value); setPage(1); }} className={cn("px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide border transition-all", statusFilter === f.value ? "bg-accent/20 text-accent-glow border-accent/30" : "bg-text-primary/[0.04] text-text-muted border-transparent hover:bg-text-primary/[0.08]")}>{f.label}</button>
          ))}
        </div>
      </div>

      {isError && <EmptyState icon={<AlertTriangle className="w-7 h-7" />} title="Failed to load" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>} />}

      <DataTable columns={cols} rows={proposals} rowKey={(r) => r.proposal_id} onRowClick={(r) => { setSelected(r); setShowRejectBox(false); setShowRevertBox(false); }} loading={isLoading} empty={{ icon: <CheckCircle className="w-7 h-7" />, title: "No pricing proposals", message: isCeo ? "Price change requests from the team will appear here for your approval." : "Compute a scenario in the Workbench to submit a proposal." }} />

      {pages > 1 && (
        <div className="flex items-center justify-between px-1 pt-2">
          <span className="text-text-faint text-xs">{total} total · Page {page} of {pages}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Reject Drawer */}
      {selected && showRejectBox && (
        <Drawer open onClose={resetModals} title="Reject Proposal" subtitle={<span className="font-mono text-xs">{selected.proposal_number}</span>} footer={<><Button variant="ghost" onClick={resetModals}>Cancel</Button><Button variant="danger" disabled={reject.isPending || !actionReason} onClick={() => reject.mutate({ id: selected.proposal_id, reason: actionReason }, { onSuccess: resetModals })}>{reject.isPending ? "Rejecting…" : "Reject"}</Button></>}>
          <Field label="Rejection Reason"><textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="Explain why this proposal is rejected..." rows={4} className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 resize-none text-[13px]" /></Field>
        </Drawer>
      )}

      {/* Revert Drawer */}
      {selected && showRevertBox && (
        <Drawer open onClose={resetModals} title="Revert Applied Prices" subtitle={<span className="font-mono text-xs">{selected.proposal_number}</span>} footer={<><Button variant="ghost" onClick={resetModals}>Cancel</Button><Button variant="secondary" disabled={revert.isPending || !actionReason} onClick={() => revert.mutate({ id: selected.proposal_id, reason: actionReason }, { onSuccess: resetModals })}>{revert.isPending ? "Reverting…" : "Revert Prices"}</Button></>}>
          <div className="bg-warn/10 text-warn border border-warn/20 p-3 rounded-xl text-[13px] mb-4">
            Warning: This will restore the original prices for all {selected.variants_count} variants affected by this proposal.
          </div>
          <Field label="Reason for Reversion"><textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} placeholder="Why are we rolling back these prices?" rows={4} className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 resize-none text-[13px]" /></Field>
        </Drawer>
      )}

      {/* Detail Drawer */}
      {selected && !showRejectBox && !showRevertBox && (
        <Drawer open onClose={resetModals} title={<span className="font-mono">{selected.proposal_number}</span>} subtitle={<Pill tone={PROPOSAL_STATUS_META[selected.status].tone}>{PROPOSAL_STATUS_META[selected.status].label}</Pill>}>
          <div className="space-y-5">
            <div><div className="font-semibold text-[15px]">{selected.title}</div></div>
            {selected.description && <div><div className="micro mb-1">Description</div><p className="text-[13px] text-text-muted leading-relaxed">{selected.description}</p></div>}
            {selected.rejection_reason && <div className="bg-danger/10 border border-danger/25 rounded-xl p-3"><div className="flex items-center gap-2 text-danger text-[12px] font-semibold mb-1"><XCircle className="w-3.5 h-3.5" /> Rejected</div><p className="text-[13px] text-text-muted">{selected.rejection_reason}</p></div>}
            {selected.reversion_reason && <div className="bg-warn/10 border border-warn/25 rounded-xl p-3"><div className="flex items-center gap-2 text-warn text-[12px] font-semibold mb-1"><RotateCcw className="w-3.5 h-3.5" /> Reverted</div><p className="text-[13px] text-text-muted">{selected.reversion_reason}</p></div>}
          </div>
        </Drawer>
      )}
    </div>
  );
}
