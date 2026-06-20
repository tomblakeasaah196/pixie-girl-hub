import { FileText, CreditCard, Calendar } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Message } from "@/lib/smartcomm-types";

const ngn = (v: string | number | null | undefined) =>
  v == null ? "—" : `₦${Number(v).toLocaleString()}`;

const fmtDate = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/** Bubble renderer for `send_invoice` messages — a tappable card linking
 *  an invoice into the thread so the customer can view + pay. */
export function InvoiceCard({
  message,
  isOwn,
}: {
  message: Message;
  isOwn: boolean;
}) {
  const m = message.metadata ?? {};
  return (
    <div className="mb-1 min-w-[240px] max-w-[300px]">
      <div
        className={cn(
          "rounded-lg overflow-hidden border",
          isOwn ? "border-bg/25 bg-bg/10" : "hairline bg-panel",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2 px-3 py-2 border-b",
            isOwn ? "border-bg/15" : "hairline",
          )}
        >
          <FileText
            className={cn(
              "w-3.5 h-3.5",
              isOwn ? "text-bg/80" : "text-accent-glow",
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
              isOwn ? "text-bg" : "text-text-primary",
            )}
          >
            {ngn(m.amount_due)}
          </div>
          {m.due_date && (
            <div
              className={cn(
                "flex items-center gap-1 text-[11px]",
                isOwn ? "text-bg/70" : "text-text-faint",
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
              isOwn
                ? "bg-bg/25 text-bg hover:bg-bg/35"
                : "bg-accent text-bg hover:bg-accent-glow",
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
