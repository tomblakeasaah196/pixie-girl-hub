import { useState } from "react";
import { Plus, CheckCircle, XCircle, AlertTriangle, RotateCcw } from "lucide-react";
import { Button, Pill, MoneyText, EmptyState } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Drawer } from "@/components/ui/Drawer";
import { Field } from "@/components/ui/Form";
import { NumberField } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { useProposals, useProposalMutations } from "./hooks";
import { PROPOSAL_STATUS_META } from "./constants";
import type { Proposal } from "./types";

function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

export function ProposalsTable({ isCeo }: { isCeo: boolean }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, isError, refetch } = useProposals({
    status: statusFilter || undefined,
    page,
  });
  const { approve, reject, revert, create } = useProposalMutations();

  const [rejectReason, setRejectReason] = useState("");
  const [showRejectBox, setShowRejectBox] = useState(false);

  const proposals = data?.data ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 25;
  const pages = Math.ceil(total / pageSize);

  const cols: Column<Proposal>[] = [
    {
      key: "no",
      header: "Proposal #",
      width: "120px",
      render: (r) => <span className="font-mono text-xs">{r.proposal_number}</span>,
    },
    {
      key: "product",
      header: "Product / SKU",
      render: (r) => (
        <div>
          <div className="font-semibold text-[13px] truncate max-w-[180px]">
            {r.product_name ?? "—"}
          </div>
          {r.sku && <div className="font-mono text-[10px] text-text-faint">{r.sku}</div>}
        </div>
      ),
    },
    {
      key: "current",
      header: "Current",
      align: "right",
      width: "120px",
      render: (r) =>
        r.current_price_ngn ? (
          <MoneyText ngn={parseFloat(r.current_price_ngn)} className="text-[13px] text-text-muted" />
        ) : (
          <span className="text-text-faint text-xs">—</span>
        ),
    },
    {
      key: "proposed",
      header: "Proposed",
      align: "right",
      width: "130px",
      render: (r) => <MoneyText ngn={parseFloat(r.proposed_price_ngn)} className="text-[13px]" />,
    },
    {
      key: "change",
      header: "Change",
      align: "right",
      width: "90px",
      render: (r) => {
        if (!r.price_change_pct) return <span className="text-text-faint text-xs">—</span>;
        const pct = parseFloat(r.price_change_pct);
        return (
          <span className={cn("font-mono text-[12px] font-bold", pct >= 0 ? "text-success" : "text-danger")}>
            {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      width: "130px",
      render: (r) => {
        const meta = PROPOSAL_STATUS_META[r.status];
        return <Pill tone={meta.tone}>{meta.label}</Pill>;
      },
    },
    {
      key: "date",
      header: "Requested",
      width: "100px",
      render: (r) => <span className="text-text-muted text-xs">{fmt(r.created_at)}</span>,
    },
    ...(isCeo
      ? [
          {
            key: "actions",
            header: "",
            width: "100px",
            render: (r: Proposal) =>
              r.status === "pending" ? (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <button
                    title="Approve"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate(r.pricing_proposal_id)}
                    className="w-7 h-7 rounded-lg bg-success/15 text-success hover:bg-success/25 grid place-items-center transition-colors disabled:opacity-50"
                  >
                    <CheckCircle className="w-4 h-4" />
                  </button>
                  <button
                    title="Reject"
                    disabled={reject.isPending}
                    onClick={() => { setSelected(r); setShowRejectBox(true); }}
                    className="w-7 h-7 rounded-lg bg-danger/15 text-danger hover:bg-danger/25 grid place-items-center transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              ) : r.status === "approved" ? (
                <button
                  title="Revert"
                  disabled={revert.isPending}
                  onClick={(e) => { e.stopPropagation(); revert.mutate(r.pricing_proposal_id); }}
                  className="w-7 h-7 rounded-lg bg-warn/15 text-warn hover:bg-warn/25 grid place-items-center transition-colors disabled:opacity-50"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              ) : null,
          } satisfies Column<Proposal>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {[
            { value: "", label: "All" },
            { value: "pending", label: "Pending" },
            { value: "approved", label: "Approved" },
            { value: "rejected", label: "Rejected" },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => { setStatusFilter(f.value); setPage(1); }}
              className={cn(
                "px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide border transition-all",
                statusFilter === f.value
                  ? "bg-accent/20 text-accent-glow border-accent/30"
                  : "bg-text-primary/[0.04] text-text-muted border-transparent hover:bg-text-primary/[0.08]",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="primary"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => setShowCreate(true)}
        >
          New Proposal
        </Button>
      </div>

      {isError && (
        <EmptyState
          icon={<AlertTriangle className="w-7 h-7" />}
          title="Failed to load"
          action={<Button size="sm" onClick={() => refetch()}>Retry</Button>}
        />
      )}

      <DataTable
        columns={cols}
        rows={proposals}
        rowKey={(r) => r.pricing_proposal_id}
        onRowClick={(r) => { setSelected(r); setShowRejectBox(false); }}
        loading={isLoading}
        empty={{
          icon: <CheckCircle className="w-7 h-7" />,
          title: "No pricing proposals",
          message: isCeo
            ? "Price change requests from the team will appear here for your approval."
            : "Submit a proposal to request a price change.",
          action: (
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
              New Proposal
            </Button>
          ),
        }}
      />

      {pages > 1 && (
        <div className="flex items-center justify-between px-1 pt-2">
          <span className="text-text-faint text-xs">{total} total · Page {page} of {pages}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Proposal detail drawer */}
      {selected && !showRejectBox && (
        <ProposalDetailDrawer
          proposal={selected}
          isCeo={isCeo}
          onClose={() => setSelected(null)}
          onApprove={() => { approve.mutate(selected.pricing_proposal_id, { onSuccess: () => setSelected(null) }); }}
          onReject={() => setShowRejectBox(true)}
          onRevert={() => { revert.mutate(selected.pricing_proposal_id, { onSuccess: () => setSelected(null) }); }}
          approving={approve.isPending}
          reverting={revert.isPending}
        />
      )}

      {/* Reject drawer */}
      {selected && showRejectBox && (
        <Drawer
          open
          onClose={() => { setSelected(null); setShowRejectBox(false); }}
          title="Reject Proposal"
          subtitle={<span className="font-mono text-xs">{selected.proposal_number}</span>}
          footer={
            <>
              <Button variant="ghost" onClick={() => { setSelected(null); setShowRejectBox(false); }}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={reject.isPending || !rejectReason}
                onClick={() =>
                  reject.mutate(
                    { id: selected.pricing_proposal_id, reason: rejectReason },
                    { onSuccess: () => { setSelected(null); setShowRejectBox(false); setRejectReason(""); } },
                  )
                }
              >
                {reject.isPending ? "Rejecting…" : "Reject"}
              </Button>
            </>
          }
        >
          <Field label="Rejection Reason">
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain why this proposal is rejected…"
              rows={4}
              className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 resize-none text-[13px]"
            />
          </Field>
        </Drawer>
      )}

      {/* Create drawer */}
      <CreateProposalDrawer
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={create}
      />
    </div>
  );
}

function ProposalDetailDrawer({
  proposal,
  isCeo,
  onClose,
  onApprove,
  onReject,
  onRevert,
  approving,
  reverting,
}: {
  proposal: Proposal;
  isCeo: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRevert: () => void;
  approving: boolean;
  reverting: boolean;
}) {
  const meta = PROPOSAL_STATUS_META[proposal.status];
  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="font-mono">{proposal.proposal_number}</span>}
      subtitle={<Pill tone={meta.tone}>{meta.label}</Pill>}
      footer={
        isCeo && proposal.status === "pending" ? (
          <>
            <Button variant="danger" disabled={approving} onClick={onReject}>
              Reject
            </Button>
            <Button variant="primary" disabled={approving} onClick={onApprove}>
              {approving ? "Approving…" : "Approve"}
            </Button>
          </>
        ) : isCeo && proposal.status === "approved" ? (
          <Button variant="secondary" disabled={reverting} onClick={onRevert}>
            <RotateCcw className="w-4 h-4 mr-1" />
            {reverting ? "Reverting…" : "Revert Price"}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div>
          <div className="font-semibold text-[15px]">{proposal.product_name ?? "Unnamed product"}</div>
          {proposal.sku && <div className="font-mono text-[12px] text-text-faint">{proposal.sku}</div>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {proposal.current_price_ngn && (
            <div>
              <div className="micro mb-1">Current Price</div>
              <MoneyText ngn={parseFloat(proposal.current_price_ngn)} className="text-[20px]" />
            </div>
          )}
          <div>
            <div className="micro mb-1">Proposed Price</div>
            <MoneyText ngn={parseFloat(proposal.proposed_price_ngn)} className="text-[20px] text-accent-glow" />
          </div>
          {proposal.cost_ngn && (
            <div>
              <div className="micro mb-1">Cost</div>
              <MoneyText ngn={parseFloat(proposal.cost_ngn)} className="text-[16px]" />
            </div>
          )}
          {proposal.target_margin_pct && (
            <div>
              <div className="micro mb-1">Target Margin</div>
              <div className="font-mono text-[16px]">{parseFloat(proposal.target_margin_pct).toFixed(1)}%</div>
            </div>
          )}
        </div>

        {proposal.justification && (
          <div>
            <div className="micro mb-1">Justification</div>
            <p className="text-[13px] text-text-muted leading-relaxed">{proposal.justification}</p>
          </div>
        )}

        {proposal.rejection_reason && (
          <div className="bg-danger/10 border border-danger/25 rounded-xl p-3">
            <div className="flex items-center gap-2 text-danger text-[12px] font-semibold mb-1">
              <XCircle className="w-3.5 h-3.5" />
              Rejected
            </div>
            <p className="text-[13px] text-text-muted">{proposal.rejection_reason}</p>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function CreateProposalDrawer({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: ReturnType<typeof useProposalMutations>["create"];
}) {
  const [form, setForm] = useState({
    product_name: "",
    sku: "",
    proposed_price_ngn: "",
    current_price_ngn: "",
    cost_ngn: "",
    target_margin_pct: "",
    justification: "",
  });
  const setF = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = () => {
    if (!form.proposed_price_ngn) return;
    onCreate.mutate(
      {
        product_name: form.product_name || undefined,
        sku: form.sku || undefined,
        proposed_price_ngn: parseFloat(form.proposed_price_ngn),
        current_price_ngn: form.current_price_ngn ? parseFloat(form.current_price_ngn) : undefined,
        cost_ngn: form.cost_ngn ? parseFloat(form.cost_ngn) : undefined,
        target_margin_pct: form.target_margin_pct ? parseFloat(form.target_margin_pct) : undefined,
        justification: form.justification || undefined,
      },
      {
        onSuccess: () => {
          setForm({ product_name: "", sku: "", proposed_price_ngn: "", current_price_ngn: "", cost_ngn: "", target_margin_pct: "", justification: "" });
          onClose();
        },
      },
    );
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Price Proposal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={onCreate.isPending || !form.proposed_price_ngn} onClick={handleSubmit}>
            {onCreate.isPending ? "Submitting…" : "Submit Proposal"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Product Name">
            <input type="text" value={form.product_name} onChange={(e) => setF("product_name", e.target.value)} placeholder="Product name"
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50" />
          </Field>
          <Field label="SKU">
            <input type="text" value={form.sku} onChange={(e) => setF("sku", e.target.value)} placeholder="SKU code"
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 font-mono" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Current Price (₦)">
            <NumberField value={form.current_price_ngn} onChange={(v) => setF("current_price_ngn", v)} suffix="₦" placeholder="0.00" />
          </Field>
          <Field label="Proposed Price (₦)">
            <NumberField value={form.proposed_price_ngn} onChange={(v) => setF("proposed_price_ngn", v)} suffix="₦" placeholder="0.00" />
          </Field>
          <Field label="Cost (₦)">
            <NumberField value={form.cost_ngn} onChange={(v) => setF("cost_ngn", v)} suffix="₦" placeholder="0.00" />
          </Field>
          <Field label="Target Margin %">
            <NumberField value={form.target_margin_pct} onChange={(v) => setF("target_margin_pct", v)} suffix="%" placeholder="0.0" />
          </Field>
        </div>

        <Field label="Justification">
          <textarea value={form.justification} onChange={(e) => setF("justification", e.target.value)}
            placeholder="Why is this price change needed?" rows={3}
            className="w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus:border-accent/50 resize-none text-[13px]" />
        </Field>
      </div>
    </Drawer>
  );
}
