import { useState } from "react";
import {
  FileText,
  Plus,
  ArrowRight,
  ArrowLeft,
  Check,
  Trash2,
} from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button, Card, MoneyText } from "@/components/ui/primitives";
import { FormSection, Field, TextInput } from "@/components/ui/Form";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { useCashRequestMutations } from "./hooks";
import type { CashRequest } from "./types";

interface Props {
  request: CashRequest;
  onClose: () => void;
}

interface ReceiptEntry {
  id: string;
  amount: string;
  paid_to: string;
  paid_on: string;
  description: string;
}

type Step = 1 | 2 | 3;

export default function SettlementWizardDrawer({ request: r, onClose }: Props) {
  const mutations = useCashRequestMutations();
  const [step, setStep] = useState<Step>(1);

  // Step 1: Receipts
  const [receipts, setReceipts] = useState<ReceiptEntry[]>([]);

  // Step 2: Cash returned
  const [cashReturned, setCashReturned] = useState("");
  const [returnMethod, setReturnMethod] = useState<
    "cash" | "bank_transfer" | "offset_advance"
  >("cash");
  const [returnTxnId, setReturnTxnId] = useState("");

  const disbursed = Number(r.amount_disbursed_ngn || r.amount_requested_ngn);
  const receiptsTotal = receipts.reduce(
    (sum, e) => sum + (Number(e.amount) || 0),
    0,
  );
  const returned = Number(cashReturned) || 0;
  const accounted = receiptsTotal + returned;
  const shortfall = disbursed - accounted;

  function addReceipt() {
    setReceipts((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        amount: "",
        paid_to: "",
        paid_on: "",
        description: "",
      },
    ]);
  }

  function updateReceipt(id: string, field: keyof ReceiptEntry, value: string) {
    setReceipts((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
    );
  }

  function removeReceipt(id: string) {
    setReceipts((prev) => prev.filter((e) => e.id !== id));
  }

  function handleConfirm() {
    mutations.settle.mutate(
      {
        id: r.cash_request_id,
        input: {
          settled_total_receipts_ngn: receiptsTotal,
          notes:
            returned > 0
              ? `Cash returned: ${money(returned)} via ${returnMethod}`
              : undefined,
        },
      },
      { onSuccess: onClose },
    );
  }

  const isBusy = mutations.settle.isPending;

  const stepLabels = ["Add Receipts", "Cash Returned", "Review & Confirm"];

  return (
    <Drawer
      open
      onClose={onClose}
      wide
      title="Settle Advance"
      subtitle={`${r.request_number} · ${r.purpose}`}
      leading={<FileText className="w-5 h-5 text-accent" />}
      footer={
        <div className="flex gap-2 w-full justify-between">
          <div>
            {step > 1 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep((s) => (s - 1) as Step)}
                icon={<ArrowLeft className="w-3.5 h-3.5" />}
              >
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {step < 3 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setStep((s) => (s + 1) as Step)}
                icon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                Next
              </Button>
            )}
            {step === 3 && (
              <Button
                variant="primary"
                size="sm"
                disabled={isBusy}
                onClick={handleConfirm}
                icon={<Check className="w-3.5 h-3.5" />}
              >
                {isBusy ? "Settling…" : "Confirm Settlement"}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {stepLabels.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              {i > 0 && <div className="w-8 h-px bg-line" />}
              <div
                className={cn(
                  "flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-full transition-all",
                  step === i + 1
                    ? "bg-accent/20 text-accent-glow border border-accent/30"
                    : step > i + 1
                      ? "bg-success/15 text-success"
                      : "bg-text-primary/[0.04] text-text-faint",
                )}
              >
                <span className="w-4 h-4 rounded-full grid place-items-center text-[9px] bg-current/20">
                  {i + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Running total bar */}
        <Card className="p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Disbursed</span>
            <MoneyText ngn={disbursed} className="text-base" />
          </div>
          <div className="w-full h-2 rounded-full bg-text-primary/[0.06] mt-2 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                accounted >= disbursed
                  ? "bg-success"
                  : accounted > 0
                    ? "bg-warn"
                    : "bg-text-primary/10",
              )}
              style={{
                width: `${Math.min(100, (accounted / disbursed) * 100)}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] mt-1.5">
            <span className="text-text-faint">
              Receipts: {money(receiptsTotal)}
            </span>
            <span className="text-text-faint">Returned: {money(returned)}</span>
            <span
              className={cn(
                "font-bold",
                shortfall > 0
                  ? "text-warn"
                  : shortfall < 0
                    ? "text-info"
                    : "text-success",
              )}
            >
              {shortfall > 0
                ? `Shortfall: ${money(shortfall)}`
                : shortfall < 0
                  ? `Over: ${money(Math.abs(shortfall))}`
                  : "Balanced"}
            </span>
          </div>
        </Card>

        {/* Step 1: Receipts */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="micro">Receipt Items</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={addReceipt}
                icon={<Plus className="w-3.5 h-3.5" />}
              >
                Add Receipt
              </Button>
            </div>
            {receipts.length === 0 && (
              <Card className="p-6 text-center">
                <p className="text-text-muted text-sm mb-3">
                  No receipts added yet. Add receipts to account for how the
                  advance was spent.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={addReceipt}
                  icon={<Plus className="w-3.5 h-3.5" />}
                >
                  Add First Receipt
                </Button>
              </Card>
            )}
            {receipts.map((entry, idx) => (
              <Card key={entry.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="micro">Receipt {idx + 1}</span>
                  <button
                    onClick={() => removeReceipt(entry.id)}
                    className="text-danger hover:text-danger/80 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amount (₦)">
                    <TextInput
                      type="number"
                      step="0.01"
                      min="0"
                      value={entry.amount}
                      onChange={(e) =>
                        updateReceipt(entry.id, "amount", e.target.value)
                      }
                      placeholder="0.00"
                      className="font-mono"
                    />
                  </Field>
                  <Field label="Paid To">
                    <TextInput
                      value={entry.paid_to}
                      onChange={(e) =>
                        updateReceipt(entry.id, "paid_to", e.target.value)
                      }
                      placeholder="Vendor name"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date">
                    <TextInput
                      type="date"
                      value={entry.paid_on}
                      onChange={(e) =>
                        updateReceipt(entry.id, "paid_on", e.target.value)
                      }
                    />
                  </Field>
                  <Field label="Description">
                    <TextInput
                      value={entry.description}
                      onChange={(e) =>
                        updateReceipt(entry.id, "description", e.target.value)
                      }
                      placeholder="What was purchased"
                    />
                  </Field>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Step 2: Cash Returned */}
        {step === 2 && (
          <FormSection title="Cash Returned">
            <Field
              label="Amount Returned (₦)"
              hint="how much cash are you returning?"
            >
              <TextInput
                type="number"
                step="0.01"
                min="0"
                value={cashReturned}
                onChange={(e) => setCashReturned(e.target.value)}
                placeholder="0.00"
                className="font-mono"
              />
            </Field>
            {returned > 0 && (
              <>
                <Field label="Return Method">
                  <div className="flex gap-2">
                    {(["cash", "bank_transfer", "offset_advance"] as const).map(
                      (m) => (
                        <button
                          key={m}
                          onClick={() => setReturnMethod(m)}
                          className={cn(
                            "px-3 py-2 rounded-xl text-xs font-semibold border transition-all",
                            returnMethod === m
                              ? "bg-accent/20 border-accent/30 text-accent-glow"
                              : "bg-text-primary/[0.04] border-transparent text-text-muted hover:bg-text-primary/[0.08]",
                          )}
                        >
                          {m === "cash"
                            ? "Cash"
                            : m === "bank_transfer"
                              ? "Bank Transfer"
                              : "Offset Next Advance"}
                        </button>
                      ),
                    )}
                  </div>
                </Field>
                {returnMethod === "bank_transfer" && (
                  <Field label="Bank Transaction ID">
                    <TextInput
                      value={returnTxnId}
                      onChange={(e) => setReturnTxnId(e.target.value)}
                      placeholder="e.g. TRF-2026061500002"
                    />
                  </Field>
                )}
              </>
            )}
          </FormSection>
        )}

        {/* Step 3: Review & Confirm */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="micro">Settlement Summary</div>

            {receipts.length > 0 && (
              <Card className="p-4">
                <div className="micro mb-3">Receipts ({receipts.length})</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-text-faint text-[10px] uppercase tracking-wide">
                      <th className="text-left pb-2">Vendor</th>
                      <th className="text-left pb-2">Description</th>
                      <th className="text-right pb-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {receipts.map((e) => (
                      <tr key={e.id} className="border-t hairline">
                        <td className="py-2">{e.paid_to || "—"}</td>
                        <td className="py-2 text-text-muted">
                          {e.description || "—"}
                        </td>
                        <td className="py-2 text-right font-mono">
                          {money(Number(e.amount) || 0)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-line font-bold">
                      <td colSpan={2} className="py-2">
                        Total Receipts
                      </td>
                      <td className="py-2 text-right font-mono">
                        {money(receiptsTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </Card>
            )}

            {returned > 0 && (
              <Card className="p-4">
                <div className="flex justify-between text-sm">
                  <span>Cash Returned ({returnMethod.replace("_", " ")})</span>
                  <span className="font-mono font-bold">{money(returned)}</span>
                </div>
              </Card>
            )}

            <Card
              className={cn(
                "p-4 border-l-[3px]",
                shortfall > 0
                  ? "border-l-warn"
                  : shortfall < 0
                    ? "border-l-info"
                    : "border-l-success",
              )}
            >
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-text-muted">Disbursed</span>
                  <span className="font-mono">{money(disbursed)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Accounted For</span>
                  <span className="font-mono">{money(accounted)}</span>
                </div>
                <div className="flex justify-between font-bold border-t hairline pt-2">
                  <span>
                    {shortfall > 0
                      ? "Shortfall (payroll deduction)"
                      : shortfall < 0
                        ? "Overspend"
                        : "Balanced"}
                  </span>
                  <span
                    className={cn(
                      "font-mono",
                      shortfall > 0
                        ? "text-warn"
                        : shortfall < 0
                          ? "text-info"
                          : "text-success",
                    )}
                  >
                    {money(Math.abs(shortfall))}
                  </span>
                </div>
              </div>
            </Card>

            {shortfall > 0 && (
              <div className="p-3 rounded-xl bg-warn/10 border border-warn/20 text-xs text-warn">
                The shortfall of {money(shortfall)} will be flagged for payroll
                deduction per company policy.
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}
