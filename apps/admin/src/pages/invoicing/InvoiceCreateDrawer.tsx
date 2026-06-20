import { useCallback, useMemo, useState } from "react";
import { Search, Plus, Trash2 } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Button, Card, MoneyText } from "@/components/ui/primitives";
import { NumberField } from "@/components/ui/controls";
import { FormGrid, Field, TextInput, FormSection } from "@/components/ui/Form";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { useCreateInvoice } from "./hooks";
import { searchContacts } from "./api";
import type { InvoiceLineInput } from "./types";

interface ContactResult {
  id: string;
  label: string;
  sub: string;
}

interface DraftLine {
  id: string;
  description: string;
  quantity: string;
  unit_price_ngn: string;
  line_discount_ngn: string;
  tax_rate_pct: string;
}

function emptyLine(): DraftLine {
  return {
    id: crypto.randomUUID(),
    description: "",
    quantity: "1",
    unit_price_ngn: "",
    line_discount_ngn: "",
    tax_rate_pct: "",
  };
}

export function InvoiceCreateDrawer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (invoiceId: string) => void;
}) {
  const createInvoice = useCreateInvoice();
  const toast = useToastStore();

  const [contactSearch, setContactSearch] = useState("");
  const [contactId, setContactId] = useState<string | null>(null);
  const [contactName, setContactName] = useState("");
  const [contactResults, setContactResults] = useState<ContactResult[]>([]);

  const [dueDate, setDueDate] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [shippingFee, setShippingFee] = useState("");
  const [whtRatePct, setWhtRatePct] = useState("");
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
    setContactSearch("");
    setContactId(null);
    setContactName("");
    setContactResults([]);
    setDueDate("");
    setIssueDate("");
    setPaymentTerms("");
    setShippingFee("");
    setWhtRatePct("");
    setLines([emptyLine()]);
  };

  const handleSearchContacts = useCallback(async (q: string) => {
    setContactSearch(q);
    if (q.length < 2) { setContactResults([]); return; }
    try {
      const res = await searchContacts(q);
      setContactResults(res.data.map((c) => ({ id: c.contact_id, label: c.display_name, sub: c.email ?? "" })));
    } catch { setContactResults([]); }
  }, []);

  const pickContact = (r: ContactResult) => {
    setContactId(r.id);
    setContactName(r.label);
    setContactSearch(r.label);
    setContactResults([]);
  };

  const updateLine = (id: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) => setLines((prev) => prev.filter((l) => l.id !== id));

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, tax = 0;
    for (const l of lines) {
      const qty = Number(l.quantity) || 0;
      const price = Number(l.unit_price_ngn) || 0;
      const disc = Number(l.line_discount_ngn) || 0;
      const rate = (Number(l.tax_rate_pct) || 0) / 100;
      const base = qty * price - disc;
      subtotal += qty * price;
      discount += disc;
      tax += base * rate;
    }
    const shipping = Number(shippingFee) || 0;
    const total = subtotal - discount + tax + shipping;
    return { subtotal, discount, tax, shipping, total };
  }, [lines, shippingFee]);

  const canSubmit =
    !!contactId &&
    !!dueDate &&
    lines.length > 0 &&
    lines.every((l) => l.description.trim() && Number(l.quantity) > 0 && l.unit_price_ngn !== "");

  const handleSubmit = async () => {
    if (!contactId || !dueDate) return;
    const inputLines: InvoiceLineInput[] = lines.map((l) => ({
      description: l.description.trim(),
      quantity: Number(l.quantity),
      unit_price_ngn: Number(l.unit_price_ngn),
      line_discount_ngn: l.line_discount_ngn ? Number(l.line_discount_ngn) : undefined,
      tax_rate: l.tax_rate_pct ? Number(l.tax_rate_pct) / 100 : undefined,
    }));
    try {
      const invoice = await createInvoice.mutateAsync({
        contact_id: contactId,
        due_date: dueDate,
        issue_date: issueDate || undefined,
        payment_terms: paymentTerms || undefined,
        shipping_fee_ngn: shippingFee ? Number(shippingFee) : undefined,
        wht_rate: whtRatePct ? Number(whtRatePct) / 100 : undefined,
        lines: inputLines,
      });
      fireToast("Invoice Created", `${invoice.invoice_number} was created as a draft.`);
      reset();
      onCreated(invoice.invoice_id);
    } catch (err) {
      fireToast(
        "Create Failed",
        err instanceof Error
          ? err.message
          : "Failed to create the invoice. Check the form and try again.",
        "high",
      );
    }
  };

  return (
    <Drawer
      open={open}
      onClose={() => { onClose(); }}
      title="New Invoice"
      subtitle="Created as a draft — send it to the customer when ready"
      wide
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!canSubmit || createInvoice.isPending}>
            {createInvoice.isPending ? "Creating…" : "Create Invoice"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormSection title="Customer">
          {contactId ? (
            <div className="flex items-center justify-between p-3 rounded-[11px] bg-text-primary/[0.04] border border-line">
              <div className="text-[14px] font-semibold truncate">{contactName}</div>
              <Button variant="ghost" size="sm" onClick={() => { setContactId(null); setContactName(""); setContactSearch(""); }}>
                Change
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
              <input
                placeholder="Search by name, email, or phone…"
                value={contactSearch}
                onChange={(e) => handleSearchContacts(e.target.value)}
                className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
              {contactResults.length > 0 && (
                <div className="absolute z-40 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] dropglass overflow-hidden py-1 max-h-[240px] overflow-y-auto">
                  {contactResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => pickContact(r)}
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

        <FormSection title="Terms">
          <FormGrid cols={3}>
            <Field label="Due Date">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
            </Field>
            <Field label="Issue Date" hint="defaults to today">
              <input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
              />
            </Field>
            <Field label="Payment Terms" hint="optional">
              <TextInput value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="e.g. Net 14" />
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
                    <div className="grid grid-cols-4 gap-2">
                      <NumberField value={l.quantity} onChange={(v) => updateLine(l.id, { quantity: v })} placeholder="Qty" />
                      <NumberField value={l.unit_price_ngn} onChange={(v) => updateLine(l.id, { unit_price_ngn: v })} placeholder="Unit Price" suffix="NGN" />
                      <NumberField value={l.line_discount_ngn} onChange={(v) => updateLine(l.id, { line_discount_ngn: v })} placeholder="Discount" suffix="NGN" />
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

        <FormSection title="Additional Charges">
          <FormGrid>
            <Field label="Shipping Fee" hint="optional">
              <NumberField value={shippingFee} onChange={setShippingFee} placeholder="0.00" suffix="NGN" />
            </Field>
            <Field label="Withholding Tax" hint="optional">
              <NumberField value={whtRatePct} onChange={setWhtRatePct} placeholder="0" suffix="%" />
            </Field>
          </FormGrid>
        </FormSection>

        <Card className="p-4">
          <div className="space-y-1.5 text-[13px]">
            <div className="flex justify-between"><span className="text-text-muted">Subtotal</span><MoneyText ngn={totals.subtotal} /></div>
            {totals.discount > 0 && <div className="flex justify-between"><span className="text-text-muted">Discount</span><span className="text-success">−<MoneyText ngn={totals.discount} /></span></div>}
            {totals.tax > 0 && <div className="flex justify-between"><span className="text-text-muted">Tax</span><MoneyText ngn={totals.tax} /></div>}
            {totals.shipping > 0 && <div className="flex justify-between"><span className="text-text-muted">Shipping</span><MoneyText ngn={totals.shipping} /></div>}
            <div className="flex justify-between text-[15px] font-semibold pt-1"><span>Total</span><MoneyText ngn={totals.total} /></div>
          </div>
        </Card>
      </div>
    </Drawer>
  );
}
