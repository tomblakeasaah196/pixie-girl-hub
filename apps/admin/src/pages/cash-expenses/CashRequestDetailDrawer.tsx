import { useState } from "react";
import {
  Banknote,
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Send,
  AlertTriangle,
  CreditCard,
} from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button, Card, Pill, MoneyText, MaskedField, Skeleton } from "@/components/ui/primitives";
import { Timeline } from "@/components/ui/Timeline";
import { FormSection, Field, TextInput } from "@/components/ui/Form";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/cn";
import { useCashRequest, useCashRequestHistory, useCashRequestMutations } from "./hooks";
import { CR_STATUS_META, URGENCY_META, RECIPIENT_TYPE_LABELS } from "./constants";
import type { CashRequest, CashRequestStatus, Decision, StateHistoryEntry } from "./types";

interface Props {
  request: CashRequest;
  onClose: () => void;
  onSettle: (cr: CashRequest) => void;
}

export default function CashRequestDetailDrawer({ request: initial, onClose, onSettle }: Props) {
  const can = useAuthStore((s) => s.can);
  const user = useAuthStore((s) => s.user);
  const { data: cr } = useCashRequest(initial.cash_request_id);
  const { data: history, isLoading: historyLoading } = useCashRequestHistory(initial.cash_request_id);
  const mutations = useCashRequestMutations();

  const r = cr ?? initial;
  const meta = CR_STATUS_META[r.status];
  const urgMeta = URGENCY_META[r.urgency];

  const [decisionNotes, setDecisionNotes] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [disburseForm, setDisburseForm] = useState({ bank_transaction_id: "", bank_name: "", notes: "" });
  const [showDisburse, setShowDisburse] = useState(false);

  const canApprove = can("expenses", "approve");
  const isBusy = mutations.finance.isPending || mutations.ceo.isPending || mutations.disburse.isPending || mutations.cancel.isPending;

  function handleDecision(decision: Decision, stage: "finance" | "ceo") {
    const id = r.cash_request_id;
    const payload = { id, decision, notes: decisionNotes || undefined };
    if (stage === "finance") {
      mutations.finance.mutate(payload, { onSuccess: () => { setDecisionNotes(""); onClose(); } });
    } else {
      mutations.ceo.mutate(payload, { onSuccess: () => { setDecisionNotes(""); onClose(); } });
    }
  }

  function handleDisburse() {
    mutations.disburse.mutate(
      { id: r.cash_request_id, input: { bank_transaction_id: disburseForm.bank_transaction_id, bank_name: disburseForm.bank_name || undefined, disbursement_notes: disburseForm.notes || undefined } },
      { onSuccess: onClose },
    );
  }

  function handleCancel() {
    mutations.cancel.mutate({ id: r.cash_request_id }, { onSuccess: onClose });
  }

  const activeStage = r.status === "pending_finance" ? "finance" : r.status === "pending_ceo" ? "ceo" : null;

  return (
    <Drawer open onClose={onClose} wide title={r.request_number} subtitle={r.purpose} leading={<Banknote className="w-5 h-5 text-accent" />}
      footer={
        <DrawerActions
          status={r.status}
          canApprove={canApprove}
          isBusy={isBusy}
          activeStage={activeStage}
          requiresSettlement={r.requires_settlement}
          onApprove={(stage) => handleDecision("approve", stage)}
          onSendBack={(stage) => handleDecision("send_back", stage)}
          onReject={() => setShowRejectModal(true)}
          onDisburse={() => setShowDisburse(true)}
          onSettle={() => onSettle(r)}
          onCancel={handleCancel}
        />
      }
    >
      <div className="space-y-6">
        {/* Status + urgency */}
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={meta.tone}>{meta.label}</Pill>
          {r.urgency !== "normal" && <Pill tone={urgMeta.tone}>{urgMeta.label}</Pill>}
          {r.requires_settlement && <Pill tone="info" dot={false}>Cash Advance</Pill>}
        </div>

        {/* Financial ribbon */}
        <div className="grid grid-cols-3 gap-3">
          <MiniCard label="Requested">
            <MoneyText ngn={Number(r.amount_requested_ngn)} className="text-lg" />
          </MiniCard>
          <MiniCard label="Disbursed">
            {r.amount_disbursed_ngn ? (
              <MoneyText ngn={Number(r.amount_disbursed_ngn)} className="text-lg" />
            ) : (
              <span className="text-text-faint text-sm">—</span>
            )}
          </MiniCard>
          <MiniCard label={r.requires_settlement ? "Unsettled" : "Status"}>
            {r.requires_settlement ? (
              r.unsettled_balance_ngn ? (
                <MoneyText ngn={Number(r.unsettled_balance_ngn)} className="text-lg text-warn" />
              ) : r.status === "settled" ? (
                <span className="text-success text-sm font-bold">Settled</span>
              ) : (
                <span className="text-text-faint text-sm">Pending</span>
              )
            ) : (
              <span className={cn("text-sm font-bold", meta.tone === "success" ? "text-success" : "text-text-muted")}>
                {meta.label}
              </span>
            )}
          </MiniCard>
        </div>

        {/* Details */}
        <Card className="p-4 space-y-3">
          <div className="micro mb-2">Details</div>
          <DetailRow label="Category" value={r.category_display} />
          <DetailRow label="Purpose" value={r.purpose} />
          {r.needed_by_date && <DetailRow label="Needed By" value={new Date(r.needed_by_date).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })} />}
          <DetailRow label="Recipient" value={RECIPIENT_TYPE_LABELS[r.recipient_type]} />
          {r.recipient_name && <DetailRow label="Recipient Name" value={r.recipient_name} />}
          {r.recipient_bank_name && <DetailRow label="Bank" value={r.recipient_bank_name} />}
          {r.recipient_account_number && (
            <DetailRow label="Account #" value={<MaskedField value={r.recipient_account_number} />} />
          )}
          {r.recipient_account_name && <DetailRow label="Account Name" value={r.recipient_account_name} />}
        </Card>

        {/* Disbursement info */}
        {r.bank_transaction_id && (
          <Card className="p-4 space-y-3">
            <div className="micro mb-2">Disbursement</div>
            <DetailRow label="Transaction ID" value={r.bank_transaction_id} />
            {r.bank_name && <DetailRow label="Bank" value={r.bank_name} />}
            {r.bank_transaction_date && <DetailRow label="Date" value={new Date(r.bank_transaction_date).toLocaleDateString("en-NG")} />}
            {r.disbursement_notes && <DetailRow label="Notes" value={r.disbursement_notes} />}
          </Card>
        )}

        {/* Timeline */}
        <Card className="p-4">
          <div className="micro mb-3">Timeline</div>
          {historyLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="w-full h-10" />)}</div>
          ) : history && history.length > 0 ? (
            <Timeline
              steps={history.map((h, i) => ({
                title: statusLabel(h.to_status),
                detail: [
                  h.changed_by_name,
                  h.decision_snapshot ? `(${h.decision_snapshot})` : null,
                  h.notes,
                  formatRelative(h.changed_at),
                ].filter(Boolean).join(" · "),
                state: i === history.length - 1 ? "current" : "done",
              }))}
            />
          ) : (
            <p className="text-text-faint text-sm">No history available.</p>
          )}
        </Card>

        {/* Decision notes (for approvers) */}
        {activeStage && canApprove && (
          <Card className="p-4">
            <div className="micro mb-2">Decision Notes</div>
            <textarea
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              placeholder="Add notes for your decision (optional)"
              className="w-full h-20 px-3 py-2 rounded-xl bg-text-primary/[0.04] border border-line text-text-primary text-sm resize-none outline-none focus:border-accent/50"
            />
          </Card>
        )}

        {/* Reject reason modal (inline) */}
        {showRejectModal && activeStage && (
          <Card className="p-4 border-danger/30">
            <div className="micro text-danger mb-2">Rejection Reason</div>
            <textarea
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              placeholder="Explain why this request is being rejected"
              className="w-full h-20 px-3 py-2 rounded-xl bg-danger/5 border border-danger/20 text-text-primary text-sm resize-none outline-none focus:border-danger/40"
              autoFocus
            />
            <div className="flex gap-2 mt-3 justify-end">
              <Button size="sm" variant="ghost" onClick={() => setShowRejectModal(false)}>Cancel</Button>
              <Button
                size="sm"
                variant="danger"
                disabled={!decisionNotes.trim() || isBusy}
                onClick={() => { handleDecision("reject", activeStage); setShowRejectModal(false); }}
              >
                Confirm Reject
              </Button>
            </div>
          </Card>
        )}

        {/* Disburse form (inline) */}
        {showDisburse && (
          <Card className="p-4">
            <div className="micro mb-3">Disbursement Details</div>
            <div className="space-y-3">
              <Field label="Bank Transaction ID" hint="required">
                <TextInput
                  value={disburseForm.bank_transaction_id}
                  onChange={(e) => setDisburseForm((p) => ({ ...p, bank_transaction_id: e.target.value }))}
                  placeholder="e.g. TRF-2026061500001"
                />
              </Field>
              <Field label="Bank Name">
                <TextInput
                  value={disburseForm.bank_name}
                  onChange={(e) => setDisburseForm((p) => ({ ...p, bank_name: e.target.value }))}
                  placeholder="e.g. GTBank"
                />
              </Field>
              <Field label="Notes">
                <TextInput
                  value={disburseForm.notes}
                  onChange={(e) => setDisburseForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional disbursement notes"
                />
              </Field>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setShowDisburse(false)}>Cancel</Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!disburseForm.bank_transaction_id.trim() || isBusy}
                  onClick={handleDisburse}
                  icon={<CreditCard className="w-3.5 h-3.5" />}
                >
                  Confirm Disbursement
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </Drawer>
  );
}

// ── Sub-components ───────────────────────────────────────

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

function DrawerActions({
  status,
  canApprove,
  isBusy,
  activeStage,
  requiresSettlement,
  onApprove,
  onSendBack,
  onReject,
  onDisburse,
  onSettle,
  onCancel,
}: {
  status: CashRequestStatus;
  canApprove: boolean;
  isBusy: boolean;
  activeStage: "finance" | "ceo" | null;
  requiresSettlement: boolean;
  onApprove: (stage: "finance" | "ceo") => void;
  onSendBack: (stage: "finance" | "ceo") => void;
  onReject: () => void;
  onDisburse: () => void;
  onSettle: () => void;
  onCancel: () => void;
}) {
  if (!canApprove && !["draft", "sent_back", "disbursed"].includes(status)) return null;

  return (
    <>
      {/* Approval actions */}
      {activeStage && canApprove && (
        <>
          <Button variant="danger" size="sm" disabled={isBusy} onClick={onReject} icon={<XCircle className="w-3.5 h-3.5" />}>
            Reject
          </Button>
          <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => onSendBack(activeStage)} icon={<ArrowLeft className="w-3.5 h-3.5" />}>
            Send Back
          </Button>
          <Button variant="primary" size="sm" disabled={isBusy} onClick={() => onApprove(activeStage)} icon={<CheckCircle className="w-3.5 h-3.5" />}>
            Approve
          </Button>
        </>
      )}

      {/* Disbursement action */}
      {status === "approved" && canApprove && (
        <Button variant="primary" size="sm" disabled={isBusy} onClick={onDisburse} icon={<Send className="w-3.5 h-3.5" />}>
          Disburse
        </Button>
      )}

      {/* Settlement action */}
      {status === "disbursed" && requiresSettlement && (
        <Button variant="primary" size="sm" onClick={onSettle} icon={<FileText className="w-3.5 h-3.5" />}>
          Settle Advance
        </Button>
      )}

      {/* Cancel action (pre-disbursement) */}
      {["draft", "pending_finance", "pending_ceo", "approved", "sent_back"].includes(status) && (
        <Button variant="ghost" size="sm" disabled={isBusy} onClick={onCancel}>
          Cancel Request
        </Button>
      )}
    </>
  );
}

function statusLabel(status: CashRequestStatus): string {
  return CR_STATUS_META[status]?.label ?? status;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
