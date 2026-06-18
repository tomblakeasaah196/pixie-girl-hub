import { useState } from "react";
import { Receipt, CheckCircle, XCircle } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button, Card, Pill, MoneyText } from "@/components/ui/primitives";
import { useAuthStore } from "@/stores/auth";
import { useExpense, useExpenseMutations } from "./hooks";
import { EXPENSE_STATUS_META } from "./constants";
import type { Expense } from "./types";

interface Props {
  expense: Expense;
  onClose: () => void;
}

/* ── Shared hook: detail data + approve/reject state ───────────────────────
   Drives both the drawer (phone/tablet) and the inline panel (desktop
   master-detail). Keeps the body + actions identical across surfaces. */
function useExpenseDetail(initial: Expense, onDone: () => void) {
  const can = useAuthStore((s) => s.can);
  const { data: ex } = useExpense(initial.expense_id);
  const mutations = useExpenseMutations();
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const e = ex ?? initial;
  const canApprove = can("expenses", "approve");
  const isBusy = mutations.approve.isPending || mutations.reject.isPending;

  function handleApprove() {
    mutations.approve.mutate(e.expense_id, { onSuccess: onDone });
  }
  function handleReject() {
    if (!rejectReason.trim()) return;
    mutations.reject.mutate({ id: e.expense_id, reason: rejectReason }, { onSuccess: onDone });
  }

  const showActions = e.status === "pending" && canApprove;

  return {
    e,
    canApprove,
    isBusy,
    rejectReason,
    setRejectReason,
    showReject,
    setShowReject,
    showActions,
    handleApprove,
    handleReject,
  };
}

type ExpenseDetail = ReturnType<typeof useExpenseDetail>;

/** Scrollable detail content — shared between drawer + inline panel. */
function ExpenseDetailContent({ d }: { d: ExpenseDetail }) {
  const { e, rejectReason, setRejectReason, showReject, setShowReject, isBusy, handleReject } = d;
  const meta = EXPENSE_STATUS_META[e.status];

  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="flex items-center gap-2">
        <Pill tone={meta.tone}>{meta.label}</Pill>
        <span className="text-xs text-text-faint capitalize">{e.expense_type.replace(/_/g, " ")}</span>
      </div>

      {/* Financial ribbon */}
      <div className="grid grid-cols-3 gap-3">
        <MiniCard label="Total">
          <MoneyText ngn={Number(e.total_amount_ngn)} className="text-lg" />
        </MiniCard>
        <MiniCard label="VAT">
          <span className="font-mono text-sm">{e.vat_amount_ngn ? `₦${Number(e.vat_amount_ngn).toLocaleString("en-NG")}` : "—"}</span>
        </MiniCard>
        <MiniCard label="Paid">
          <span className="font-mono text-sm">{e.amount_paid_ngn ? `₦${Number(e.amount_paid_ngn).toLocaleString("en-NG")}` : "—"}</span>
        </MiniCard>
      </div>

      {/* Details */}
      <Card className="p-4 space-y-3">
        <div className="micro mb-2">Details</div>
        <DetailRow label="Category" value={e.category_display || e.category_key} />
        <DetailRow label="Type" value={e.expense_type.replace(/_/g, " ")} />
        <DetailRow label="Date" value={new Date(e.expense_date).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })} />
        {e.description && <DetailRow label="Description" value={e.description} />}
        {e.vendor_name && <DetailRow label="Vendor" value={e.vendor_name} />}
        {e.submitted_by_name && <DetailRow label="Submitted By" value={e.submitted_by_name} />}
        {e.approved_by && <DetailRow label="Approved By" value={e.approved_by} />}
        {e.approved_at && (
          <DetailRow label="Approved At" value={new Date(e.approved_at).toLocaleDateString("en-NG")} />
        )}
      </Card>

      {/* Balance */}
      {e.balance_ngn && Number(e.balance_ngn) > 0 && (
        <Card className="p-4 border-l-[3px] border-l-warn">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">Outstanding Balance</span>
            <MoneyText ngn={Number(e.balance_ngn)} className="text-warn" />
          </div>
        </Card>
      )}

      {/* Reject form */}
      {showReject && (
        <Card className="p-4 border-danger/30">
          <div className="micro text-danger mb-2">Rejection Reason</div>
          <textarea
            value={rejectReason}
            onChange={(ev) => setRejectReason(ev.target.value)}
            placeholder="Explain why this expense is being rejected"
            className="w-full h-20 px-3 py-2 rounded-xl bg-danger/5 border border-danger/20 text-text-primary text-sm resize-none outline-none focus:border-danger/40"
            autoFocus
          />
          <div className="flex gap-2 mt-3 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowReject(false)}>Cancel</Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!rejectReason.trim() || isBusy}
              onClick={handleReject}
            >
              Confirm Reject
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Approve / reject footer buttons — shared between drawer footer + inline bar. */
function ExpenseDetailActions({ d }: { d: ExpenseDetail }) {
  const { isBusy, setShowReject, handleApprove } = d;
  return (
    <>
      <Button variant="danger" size="sm" disabled={isBusy} onClick={() => setShowReject(true)} icon={<XCircle className="w-3.5 h-3.5" />}>
        Reject
      </Button>
      <Button variant="primary" size="sm" disabled={isBusy} onClick={handleApprove} icon={<CheckCircle className="w-3.5 h-3.5" />}>
        Approve
      </Button>
    </>
  );
}

/**
 * Inline detail panel for the desktop master-detail layout. Renders the same
 * body as the drawer, with the action buttons in a sticky bottom bar instead
 * of the drawer footer. Phone/tablet never see this — they use the Drawer.
 */
export function ExpenseDetailPanel({ expense, onClose }: Props) {
  const d = useExpenseDetail(expense, onClose);
  return (
    <Card className="overflow-hidden flex flex-col max-h-[calc(100dvh-220px)] sticky top-4">
      <div className="flex items-center gap-3 p-5 border-b hairline shrink-0">
        <Receipt className="w-5 h-5 text-accent shrink-0" />
        <div className="min-w-0">
          <h2 className="font-display text-xl font-medium leading-tight truncate">{d.e.expense_number}</h2>
          <div className="micro mt-0.5 truncate">{d.e.title}</div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-[22px]">
        <ExpenseDetailContent d={d} />
      </div>
      {d.showActions && (
        <div className="p-[15px_20px] border-t hairline flex gap-2 justify-end shrink-0">
          <ExpenseDetailActions d={d} />
        </div>
      )}
    </Card>
  );
}

export default function ExpenseDetailDrawer({ expense: initial, onClose }: Props) {
  const d = useExpenseDetail(initial, onClose);
  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title={d.e.expense_number}
      subtitle={d.e.title}
      leading={<Receipt className="w-5 h-5 text-accent" />}
      footer={d.showActions ? <ExpenseDetailActions d={d} /> : undefined}
    >
      <ExpenseDetailContent d={d} />
    </Drawer>
  );
}

function MiniCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-xl p-3 text-center">
      <div className="micro mb-1">{label}</div>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-text-muted shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
