import { useRef, useState } from "react";
import {
  Receipt,
  CheckCircle,
  XCircle,
  Send,
  Banknote,
  Paperclip,
  Download,
} from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button, Card, Pill, MoneyText } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { formatDate, money } from "@/lib/format";
import { downloadDocumentById } from "@/lib/documents-api";
import { useAuthStore } from "@/stores/auth";
import { useExpense, useExpenseMutations, useExpenseReceipts } from "./hooks";
import { EXPENSE_STATUS_META } from "./constants";
import type { Expense } from "./types";
import type { PaymentMethod } from "./api";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cash", label: "Cash" },
  { value: "pos_card", label: "POS / Card" },
  { value: "payslip_addition", label: "Payslip Addition" },
  { value: "wallet", label: "Wallet" },
];
const paymentMethodLabel = (v: string) =>
  PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v;

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
  const [showPay, setShowPay] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | "">("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentReceipt, setPaymentReceipt] = useState<File | null>(null);

  const e = ex ?? initial;
  const canApprove = can("expenses", "approve");
  const canEdit = can("expenses", "edit");
  const isBusy =
    mutations.submitExpense.isPending ||
    mutations.approve.isPending ||
    mutations.reject.isPending ||
    mutations.pay.isPending;

  function handleSubmit() {
    mutations.submitExpense.mutate(e.expense_id, { onSuccess: onDone });
  }
  function handleApprove() {
    mutations.approve.mutate(e.expense_id, { onSuccess: onDone });
  }
  function handleReject() {
    if (!rejectReason.trim()) return;
    mutations.reject.mutate(
      { id: e.expense_id, reason: rejectReason },
      { onSuccess: onDone },
    );
  }
  function handlePay() {
    if (!paymentMethod) return;
    const receipt = paymentReceipt;
    mutations.pay.mutate(
      {
        id: e.expense_id,
        input: {
          payment_method: paymentMethod,
          payment_reference: paymentReference.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          if (receipt)
            mutations.addReceipt.mutate({ id: e.expense_id, file: receipt });
          onDone();
        },
      },
    );
  }

  const canSubmit = e.status === "draft" && canEdit;
  const canPay = e.status === "approved" && canApprove;
  const showActions =
    (e.status === "pending" && canApprove) || canSubmit || canPay;

  return {
    e,
    canApprove,
    canSubmit,
    canPay,
    isBusy,
    rejectReason,
    setRejectReason,
    showReject,
    setShowReject,
    showPay,
    setShowPay,
    paymentMethod,
    setPaymentMethod,
    paymentReference,
    setPaymentReference,
    paymentReceipt,
    setPaymentReceipt,
    showActions,
    handleSubmit,
    handleApprove,
    handleReject,
    handlePay,
  };
}

type ExpenseDetail = ReturnType<typeof useExpenseDetail>;

/** Scrollable detail content — shared between drawer + inline panel. */
function ExpenseDetailContent({ d }: { d: ExpenseDetail }) {
  const {
    e,
    rejectReason,
    setRejectReason,
    showReject,
    setShowReject,
    showPay,
    setShowPay,
    paymentMethod,
    setPaymentMethod,
    paymentReference,
    setPaymentReference,
    paymentReceipt,
    setPaymentReceipt,
    isBusy,
    handleReject,
    handlePay,
  } = d;
  const meta = EXPENSE_STATUS_META[e.status];
  const paidAmount =
    (e.status === "paid" || e.status === "partially_paid") &&
    e.amount_paid_ngn
      ? Number(e.amount_paid_ngn)
      : null;
  const { data: receipts } = useExpenseReceipts(e.expense_id);

  return (
    <div className="space-y-5">
      {/* Status */}
      <div className="flex items-center gap-2">
        <Pill tone={meta.tone}>
          {meta.label}
          {paidAmount != null && (
            <span className="font-mono normal-case font-normal">
              {" "}
              · {money(paidAmount)}
            </span>
          )}
        </Pill>
        <span className="text-xs text-text-faint capitalize">
          {e.expense_type.replace(/_/g, " ")}
        </span>
      </div>

      {/* Financial ribbon */}
      <div className="grid grid-cols-3 gap-3">
        <MiniCard label="Total">
          <MoneyText ngn={Number(e.total_amount_ngn)} className="text-lg" />
        </MiniCard>
        <MiniCard label="VAT">
          <span className="font-mono text-sm">
            {e.vat_amount_ngn
              ? `₦${Number(e.vat_amount_ngn).toLocaleString("en-NG")}`
              : "—"}
          </span>
        </MiniCard>
        <MiniCard label="Paid">
          <span className="font-mono text-sm">
            {e.amount_paid_ngn
              ? `₦${Number(e.amount_paid_ngn).toLocaleString("en-NG")}`
              : "—"}
          </span>
        </MiniCard>
      </div>

      {/* Details */}
      <Card className="p-4 space-y-3">
        <div className="micro mb-2">Details</div>
        <DetailRow
          label="Category"
          value={e.category_display || e.category_key}
        />
        <DetailRow label="Type" value={e.expense_type.replace(/_/g, " ")} />
        <DetailRow
          label="Date"
          value={formatDate(e.expense_date)}
        />
        {e.description && (
          <DetailRow label="Description" value={e.description} />
        )}
        {e.vendor_name && <DetailRow label="Vendor" value={e.vendor_name} />}
        {e.submitted_by_name && (
          <DetailRow label="Submitted By" value={e.submitted_by_name} />
        )}
        {e.approved_by && (
          <DetailRow
            label="Approved By"
            value={e.approved_by_name || e.approved_by}
          />
        )}
        {e.approved_at && (
          <DetailRow
            label="Approved At"
            value={formatDate(e.approved_at)}
          />
        )}
        {e.paid_by && (
          <DetailRow label="Paid By" value={e.paid_by_name || e.paid_by} />
        )}
        {e.paid_at && (
          <DetailRow label="Paid At" value={formatDate(e.paid_at)} />
        )}
        {e.payment_method && (
          <DetailRow
            label="Payment Method"
            value={paymentMethodLabel(e.payment_method)}
          />
        )}
        {e.payment_reference && (
          <DetailRow label="Reference" value={e.payment_reference} />
        )}
        {!!receipts?.length && (
          <div className="pt-1">
            <span className="block text-[11.5px] text-text-muted mb-1.5">
              Receipts
            </span>
            <div className="space-y-1.5">
              {receipts.map((r) => (
                <button
                  key={r.receipt_id}
                  type="button"
                  onClick={() =>
                    downloadDocumentById(r.document_id, r.document_title)
                  }
                  className="w-full flex items-center gap-2 text-left text-[13px] text-accent hover:underline"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {r.document_title || "Receipt"}
                  </span>
                </button>
              ))}
            </div>
          </div>
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowReject(false)}
            >
              Cancel
            </Button>
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

      {/* Mark as paid form */}
      {showPay && (
        <Card className="p-4">
          <div className="micro mb-3">Payment Details</div>
          <div className="space-y-3">
            <div>
              <span className="block text-[11.5px] text-text-muted mb-1.5">
                Payment Method
              </span>
              <Select
                value={paymentMethod}
                onChange={(v) => setPaymentMethod(v as PaymentMethod)}
                options={[
                  { value: "", label: "Choose a payment method…" },
                  ...PAYMENT_METHODS,
                ]}
              />
            </div>
            <div>
              <span className="block text-[11.5px] text-text-muted mb-1.5">
                Reference (optional)
              </span>
              <input
                value={paymentReference}
                onChange={(ev) => setPaymentReference(ev.target.value)}
                placeholder="e.g. transaction ID"
                className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <span className="block text-[11.5px] text-text-muted mb-1.5">
                Or attach receipt (optional)
              </span>
              <ReceiptPicker
                file={paymentReceipt}
                onChange={setPaymentReceipt}
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setShowPay(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!paymentMethod || isBusy}
              onClick={handlePay}
            >
              Confirm Payment
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Submit / approve / reject / pay footer buttons — shared between drawer footer + inline bar. */
function ExpenseDetailActions({ d }: { d: ExpenseDetail }) {
  const {
    e,
    canApprove,
    canSubmit,
    canPay,
    isBusy,
    setShowReject,
    setShowPay,
    handleSubmit,
    handleApprove,
  } = d;
  return (
    <>
      {/* Submit for approval — moves the draft into the workflow's approval
          queue (manager/CEO threshold, configured server-side). */}
      {canSubmit && (
        <Button
          variant="primary"
          size="sm"
          disabled={isBusy}
          onClick={handleSubmit}
          icon={<Send className="w-3.5 h-3.5" />}
        >
          Submit for Approval
        </Button>
      )}
      {e.status === "pending" && canApprove && (
        <>
          <Button
            variant="danger"
            size="sm"
            disabled={isBusy}
            onClick={() => setShowReject(true)}
            icon={<XCircle className="w-3.5 h-3.5" />}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={isBusy}
            onClick={handleApprove}
            icon={<CheckCircle className="w-3.5 h-3.5" />}
          >
            Approve
          </Button>
        </>
      )}
      {/* Mark as paid — settles the accrual (DR accrued expenses / CR bank)
          once an approved expense has actually been disbursed. */}
      {canPay && (
        <Button
          variant="primary"
          size="sm"
          disabled={isBusy}
          onClick={() => setShowPay(true)}
          icon={<Banknote className="w-3.5 h-3.5" />}
        >
          Mark as Paid
        </Button>
      )}
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
          <h2 className="font-display text-xl font-medium leading-tight truncate">
            {d.e.expense_number}
          </h2>
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

export default function ExpenseDetailDrawer({
  expense: initial,
  onClose,
}: Props) {
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

function MiniCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="glass rounded-xl p-3 text-center">
      <div className="micro mb-1">{label}</div>
      {children}
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-text-muted shrink-0">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** File picker for attaching a receipt photo/PDF in place of typing a full
    transaction ID — the reference field stays optional either way. */
function ReceiptPicker({
  file,
  onChange,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(ev) => onChange(ev.target.files?.[0] ?? null)}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={<Paperclip className="w-3.5 h-3.5" />}
        onClick={() => inputRef.current?.click()}
      >
        {file ? "Change file" : "Choose file"}
      </Button>
      {file && (
        <>
          <span className="text-[13px] text-text-muted truncate min-w-0">
            {file.name}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-text-faint hover:text-danger shrink-0"
            aria-label="Remove attached receipt"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
