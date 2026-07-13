import { FileText, CreditCard, Calendar } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import type { Message } from "@/lib/smartcomm-types";

const ngn = (v: string | number | null | undefined) =>
  v == null ? "—" : `₦${Number(v).toLocaleString()}`;

const fmtDate = (iso?: string | null) => formatDate(iso, "");

/** Bubble renderer for `send_invoice` messages — a tappable card linking
 *  an invoice into the thread so the customer can view + pay. */
export function InvoiceCard({
  message,
}: {
  message: Message;
}) {
  const m = message.metadata ?? {};
  return (
    <div className="mb-1 min-w-[240px] max-w-[300px]">
      <div
        className={cn(
          "rounded-lg overflow-hidden border",
          "hairline bg-panel",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 border-b",
            "hairline",
          )}
        >
          <FileText
            className={cn(
              "w-3.5 h-3.5",
              "text-accent-glow",
            )}
          />
          <span className="text-[11.5px] font-medium">
            Invoice {m.invoice_number ?? ""}
          </span>
        </div>
        <div className="px-3 py-2 space-y-1">
          <div
            className={cn(
              "font-mono text-[15px] font-semibold",
              "text-text-primary",
            )}
          >
            {ngn(m.amount_due)}
          </div>
          {m.due_date && (
            <div
              className={cn(
                "flex items-center gap-1 text-[11px]",
                "text-text-faint",
              )}
            >
              <Calendar className="w-3 h-3" />
              Due {fmtDate(m.due_date)}
            </div>
          )}
        </div>
        {m.url && (
          <a
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium transition-colors",
              "bg-accent text-bg hover:bg-accent-glow",
            )}
          >
            <CreditCard className="w-3.5 h-3.5" />
            View & pay
          </a>
        )}
      </div>
    </div>
  );
}
