import { useCallback, useMemo, useState } from "react";
import { Search, Plus, Trash2 } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button, Card, MoneyText } from "@/components/ui/primitives";
import { NumberField, Select } from "@/components/ui/controls";
import { FormGrid, Field, TextInput, FormSection } from "@/components/ui/Form";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { useCreateCreditNote } from "./hooks";
import { listInvoices } from "./api";
import { CREDIT_NOTE_REASON_OPTIONS } from "./constants";
import type { CreditNoteLineInput, CreditNoteReasonCategory } from "./types";

interface InvoiceResult {
  id: string;
  label: string;
  sub: string;
}

interface DraftLine {
  id: string;
  description: string;
  quantity: string;
  unit_price_ngn: string;
  tax_rate_pct: string;
}

function emptyLine(): DraftLine {
  return { id: crypto.randomUUID(), description: "", quantity: "1", unit_price_ngn: "", tax_rate_pct: "" };
}

export function CreditNoteCreateDrawer({
  open,
  onClose,
  onCreated,
  invoiceId,
  invoiceNumber,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (creditNoteId: string) => void;
  invoiceId?: string | null;
  invoiceNumber?: string | null;
}) {
  const createCreditNote = useCreateCreditNote();
  const toast = useToastStore();

  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(invoiceId ?? null);
  const [selectedInvoiceLabel, setSelectedInvoiceLabel] = useState(invoiceNumber ?? "");
  const [invoiceResults, setInvoiceResults] = useState<InvoiceResult[]>([]);

  const [reason, setReason] = useState("");
  const [reasonCategory, setReasonCategory] = useState<Exclude<CreditNoteReasonCategory, null> | "">("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  const fireToast = (title: string, body: string, priority: "normal" | "high" = "normal") => {
    toast.add({
      notification_id: crypto.randomUUID(),
      user_id: "",
      business: null,
      type: "invoicing",
      priority,
      title,
      body,
      reference_type: null,
      reference_id: null,
      action_url: null,
      is_read: false,
      read_at: null,
      created_at: new Date().toISOString(),
    });
  };

  const reset = () => {
    setInvoiceSearch("");
    setSelectedInvoiceId(invoiceId ?? null);
    setSelectedInvoiceLabel(invoiceNumber ?? "");
    setInvoiceResults([]);
    setReason("");
    setReasonCategory("");
    setLines([emptyLine()]);
  };

  const searchInvoices = useCallback(async (q: string) => {
    setInvoiceSearch(q);
    if (q.length < 2) { setInvoiceResults([]); return; }
    try {
      const res = await listInvoices({ search: q, page_size: 6 });
      setInvoiceResults(res.data.map((i) => ({
        id: i.invoice_id,
        label: i.invoice_number,
        sub: i.contact_name ?? "",
      })));
    } catch { setInvoiceResults([]); }
  }, []);

  const pickInvoice = (r: InvoiceResult) => {
    setSelectedInvoiceId(r.id);
    setSelectedInvoiceLabel(r.label);
    setInvoiceSearch(r.label);
    setInvoiceResults([]);
  };

  const updateLine = (id: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const qty = Number(l.quantity) || 0;
        const price = Number(l.unit_price_ngn) || 0;
        const rate = (Number(l.tax_rate_pct) || 0) / 100;
        return sum + qty * price * (1 + rate);
      }, 0),
    [lines],
  );

  const canSubmit =
    !!selectedInvoiceId &&
    reason.trim().length > 0 &&
    lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && l.unit_price_ngn !== "");

  const handleSubmit = async () => {
    if (!selectedInvoiceId) return;
    const inputLines: CreditNoteLineInput[] = lines.map((l) => ({
      description: l.description.trim(),
      quantity: Number(l.quantity),
      unit_price_ngn: Number(l.unit_price_ngn),
      tax_rate: l.tax_rate_pct ? Number(l.tax_rate_pct) / 100 : undefined,
    }));
    try {
      const note = await createCreditNote.mutateAsync({
        invoice_id: selectedInvoiceId,
        reason: reason.trim(),
        reason_category: reasonCategory || undefined,
        lines: inputLines,
      });
      fireToast("Credit Note Created", `${note.credit_note_number} was created as a draft.`);
      reset();
      onCreated(note.credit_note_id);
    } catch (err) {
      fireToast(
        "Create Failed",
        err instanceof Error
          ? err.message
          : "Failed to create the credit note. Check the form and try again.",
        "high",
      );
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="New Credit Note"
      subtitle="Created as a draft — issue it once reviewed"
      wide
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!canSubmit || createCreditNote.isPending}>
            {createCreditNote.isPending ? "Creating…" : "Create Credit Note"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormSection title="Invoice">
          {selectedInvoiceId && invoiceId ? (
            <div className="p-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[14px] font-semibold">
              {selectedInvoiceLabel}
            </div>
          ) : selectedInvoiceId ? (
            <div className="flex items-center justify-between p-3 rounded-[11px] bg-text-primary/[0.04] border border-line">
              <div className="text-[14px] font-semibold truncate">{selectedInvoiceLabel}</div>
              <Button variant="ghost" size="sm" onClick={() => { setSelectedInvoiceId(null); setSelectedInvoiceLabel(""); setInvoiceSearch(""); }}>
                Change
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
              <input
                placeholder="Search by invoice number…"
                value={invoiceSearch}
                onChange={(e) => searchInvoices(e.target.value)}
                className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
              {invoiceResults.length > 0 && (
                <div className="absolute z-40 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] dropglass overflow-hidden py-1 max-h-[240px] overflow-y-auto">
                  {invoiceResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pickInvoice(r)}
                      className="w-full px-4 py-2.5 text-left hover:bg-text-primary/[0.06] transition-colors"
                    >
                      <div className="text-[13px] font-semibold">{r.label}</div>
                      {r.sub && <div className="text-[11px] text-text-faint">{r.sub}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </FormSection>

        <FormSection title="Reason">
          <FormGrid>
            <Field label="Category" hint="optional">
              <Select
                value={reasonCategory}
                onChange={(v) => setReasonCategory(v as Exclude<CreditNoteReasonCategory, null> | "")}
                options={[{ value: "", label: "None" }, ...CREDIT_NOTE_REASON_OPTIONS]}
              />
            </Field>
            <Field label="Reason">
              <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this credit note is being issued" />
            </Field>
          </FormGrid>
        </FormSection>

        <FormSection title="Line Items">
          <div className="space-y-3">
            {lines.map((l) => (
              <Card key={l.id} className="p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <TextInput
                      value={l.description}
                      onChange={(e) => updateLine(l.id, { description: e.target.value })}
                      placeholder="Description"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <NumberField value={l.quantity} onChange={(v) => updateLine(l.id, { quantity: v })} placeholder="Qty" />
                      <NumberField value={l.unit_price_ngn} onChange={(v) => updateLine(l.id, { unit_price_ngn: v })} placeholder="Unit Price" suffix="NGN" />
                      <NumberField value={l.tax_rate_pct} onChange={(v) => updateLine(l.id, { tax_rate_pct: v })} placeholder="Tax" suffix="%" />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(l.id)}
                    disabled={lines.length === 1}
                    className="p-2 rounded-lg text-text-faint hover:text-danger hover:bg-danger/10 disabled:opacity-30 disabled:pointer-events-none"
                    aria-label="Remove line"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
            <Button variant="secondary" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={addLine}>
              Add Line
            </Button>
          </div>
        </FormSection>

        <Card className="p-4">
          <div className="flex justify-between text-[15px] font-semibold">
            <span>Total Credit</span>
            <MoneyText ngn={total} />
          </div>
        </Card>
      </div>
    </Drawer>
  );
}
