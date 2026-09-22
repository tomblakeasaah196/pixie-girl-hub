import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  Search,
  X,
  ChevronLeft,
  Link2,
  FileDown,
  Loader2,
  User,
  Package,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/primitives";
import { useInvoices } from "@/pages/invoicing/hooks";
import { INVOICE_STATUS } from "@/pages/invoicing/constants";
import type { Invoice } from "@/pages/invoicing/types";
import { money, formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

/** What's still owed on an invoice (list rows always carry the balance). */
const balanceOf = (inv: Invoice) => Number(inv.balance_due_ngn || 0);

/**
 * The messaging composer's invoice picker — "put this customer's invoice in
 * this chat". Step 1 greps invoices (customer name, invoice #, order #, or
 * the order's items) and lists them with everything a glance needs: invoice
 * number, customer, order number, order details, what's owed. Step 2 is the
 * one question that matters for the channel: share the LINK (a tappable
 * branded-invoice URL in any browser) or the PDF (the file, sent directly
 * into the chat — Instagram, which has no PDF bubble, delivers it as a
 * download link; the backend handles that translation).
 *
 * Mobile-first: 94vw sheet on phones (the Modal handles it), thumb-sized
 * rows, a two-step flow instead of a dense table.
 */
export function InvoicePickerModal({
  open,
  onClose,
  isInstagram,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** Thread platform — only the copy changes; both modes work on both. */
  isInstagram: boolean;
  onPick: (invoice: Invoice, mode: "link" | "pdf") => void;
}) {
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);

  const search = debouncedTerm.trim();
  const { data, isLoading, isFetching, isError, error } = useInvoices(
    search
      ? { search, page_size: 25 }
      : { page_size: 25 },
  );
  // Void and refunded invoices are never shareable — the invoice send flow
  // refuses them outright (409 INVALID_STATE), so offering them here would
  // just let an operator put a cancelled statement in front of a customer.
  const rows = useMemo(
    () =>
      (data?.data ?? []).filter(
        (inv) => inv.status !== "void" && inv.status !== "refunded",
      ),
    [data],
  );

  // Reset between chats so the previous customer's selection can't leak.
  useEffect(() => {
    if (!open) {
      setTerm("");
      setDebouncedTerm("");
      setSelected(null);
    }
  }, [open]);

  // Debounce the grep — the operator types, the query waits.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTerm(term), 220);
    return () => clearTimeout(t);
  }, [term]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-accent" />
          Share invoice
        </span>
      }
    >
      {selected ? (
        <SelectedStep
          invoice={selected}
          isInstagram={isInstagram}
          onBack={() => setSelected(null)}
          onPick={onPick}
        />
      ) : (
        <ListStep
          term={term}
          onTerm={setTerm}
          rows={rows}
          loading={isLoading || isFetching}
          searching={!!search}
          error={isError ? (error as Error | null) : null}
          onPick={setSelected}
        />
      )}
    </Modal>
  );
}

// ── Step 1 — find the invoice ─────────────────────────────

function ListStep({
  term,
  onTerm,
  rows,
  loading,
  searching,
  error,
  onPick,
}: {
  term: string;
  onTerm: (t: string) => void;
  rows: Invoice[];
  loading: boolean;
  searching: boolean;
  /** Set when the list request failed — say so rather than showing "none". */
  error: Error | null;
  onPick: (inv: Invoice) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border hairline bg-panel-2 px-2.5 focus-within:border-accent/50">
        <Search className="w-3.5 h-3.5 text-text-faint shrink-0" />
        <input
          autoFocus
          value={term}
          onChange={(e) => onTerm(e.target.value)}
          placeholder="Search customer, invoice #, order #, or item…"
          className="w-full bg-transparent py-2.5 text-[13px] focus:outline-none placeholder:text-text-faint"
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore=""
          data-form-type="other"
        />
        {term && (
          <button
            onClick={() => onTerm("")}
            className="text-text-faint hover:text-text-primary shrink-0"
            title="Clear"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {loading && (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-text-faint shrink-0" />
        )}
      </div>

      <div className="mt-3 max-h-[46vh] min-h-[120px] overflow-y-auto -mx-1 px-1 space-y-1.5">
        {error && rows.length === 0 ? (
          <div className="py-10 text-center text-[12.5px] text-danger">
            Couldn't load invoices
            <div className="mt-1 text-[11px] text-text-faint">
              {error.message || "Check your connection and try again."}
            </div>
          </div>
        ) : loading && rows.length === 0 ? (
          // Skeleton rows — the shape of the answer, so the layout never jumps.
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[62px] rounded-lg bg-text-primary/[0.04] animate-pulse"
            />
          ))
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-[12.5px] text-text-faint">
            {searching ? (
              <>
                No invoices match{" "}
                <span className="text-text-muted">“{term.trim()}”</span>
              </>
            ) : (
              "No invoices for this business yet"
            )}
          </div>
        ) : (
          rows.map((inv) => (
            <button
              key={inv.invoice_id}
              onClick={() => onPick(inv)}
              className="w-full text-left rounded-lg border hairline bg-panel-2 hover:border-accent/50 transition-colors px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[12.5px] font-semibold text-text-primary truncate">
                  {inv.invoice_number || "…"}
                </span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {balanceOf(inv) > 0 ? (
                    <span className="text-[11.5px] font-semibold text-warn tabular-nums">
                      {money(balanceOf(inv))}
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-success">
                      Paid in full
                    </span>
                  )}
                  <StatusPill status={inv.status} />
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-text-muted min-w-0">
                <User className="w-3 h-3 text-text-faint shrink-0" />
                <span className="truncate">
                  {inv.contact_name || "—"}
                </span>
                {inv.order_number && (
                  <>
                    <span className="text-text-faint shrink-0">·</span>
                    <span className="font-mono text-[11px] truncate">
                      {inv.order_number}
                    </span>
                  </>
                )}
              </div>
              {inv.line_summary && (
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-faint min-w-0">
                  <Package className="w-3 h-3 shrink-0" />
                  <span className="truncate">{inv.line_summary}</span>
                </div>
              )}
            </button>
          ))
        )}
      </div>

      {!searching && rows.length > 0 && (
        <div className="mt-2 text-[10.5px] text-text-faint text-center">
          {rows.length} most recent — start typing to search
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Invoice["status"] }) {
  const meta = INVOICE_STATUS[status];
  if (!meta) return null;
  return <Pill tone={meta.tone}>{meta.label}</Pill>;
}

// ── Step 2 — link or PDF ──────────────────────────────────

function SelectedStep({
  invoice,
  isInstagram,
  onBack,
  onPick,
}: {
  invoice: Invoice;
  isInstagram: boolean;
  onBack: () => void;
  onPick: (invoice: Invoice, mode: "link" | "pdf") => void;
}) {
  const due = Number(invoice.balance_due_ngn || 0);
  return (
    <div>
      <button
        onClick={onBack}
        className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-text-muted hover:text-text-primary"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
        All invoices
      </button>

      {/* The chosen invoice — enough to be sure it's the right one. */}
      <div className="rounded-lg border hairline bg-panel-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[13px] font-semibold text-text-primary">
            {invoice.invoice_number || "…"}
          </span>
          <StatusPill status={invoice.status} />
        </div>
        <div className="mt-1.5 text-[12.5px] text-text-muted">
          {invoice.contact_name || "—"}
        </div>
        {invoice.order_number && (
          <div className="text-[11.5px] text-text-faint font-mono">
            {invoice.order_number}
          </div>
        )}
        {invoice.line_summary && (
          <div className="mt-1 text-[11.5px] text-text-faint line-clamp-2">
            {invoice.line_summary}
          </div>
        )}
        <div className="mt-2 pt-2 border-t hairline flex items-center justify-between text-[12px]">
          <span className="text-text-faint">
            {due > 0 ? "Balance due" : "Balance"}
          </span>
          <span
            className={cn(
              "font-semibold tabular-nums",
              due > 0 ? "text-warn" : "text-success",
            )}
          >
            {money(due)}
          </span>
        </div>
        {invoice.due_date && due > 0 && (
          <div className="mt-1 text-right text-[10.5px] text-text-faint">
            due {formatDate(invoice.due_date)}
          </div>
        )}
      </div>

      {/* The choice — one tap each, thumb-height, no ambiguity. */}
      <div className="mt-3 space-y-2">
        <button
          onClick={() => onPick(invoice, "link")}
          className="w-full flex items-center gap-3 rounded-xl bg-accent text-bg px-4 py-3 text-left hover:bg-accent-glow transition-colors"
        >
          <Link2 className="w-[18px] h-[18px] shrink-0" />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">Share link</span>
            <span className="block text-[11px] opacity-80">
              A tappable link — opens the branded invoice in any browser.
            </span>
          </span>
        </button>
        <button
          onClick={() => onPick(invoice, "pdf")}
          className="w-full flex items-center gap-3 rounded-xl border hairline bg-panel-2 px-4 py-3 text-left hover:border-accent/50 transition-colors"
        >
          <FileDown className="w-[18px] h-[18px] shrink-0 text-accent-glow" />
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">Share PDF</span>
            <span className="block text-[11px] text-text-faint">
              {isInstagram
                ? "The PDF file — Instagram delivers it as a download link."
                : "The PDF file, sent straight into this chat."}
            </span>
          </span>
        </button>
      </div>

      <div className="mt-2.5 text-[10.5px] text-text-faint leading-relaxed">
        The customer's first open is tracked on the invoice's Delivery panel —
        you'll know she actually saw it.
      </div>
    </div>
  );
}
