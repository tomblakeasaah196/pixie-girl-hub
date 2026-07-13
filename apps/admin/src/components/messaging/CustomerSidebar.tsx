import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  Mail,
  Package,
  Phone,
  PhoneMissed,
  Truck,
  User,
  FileText,
  Send,
  Loader2,
  Wallet,
  ShoppingCart,
} from "lucide-react";
import { useCustomer360 } from "@/hooks/useSmartcomm";
import { smartcommApi } from "@/lib/smartcomm-api";
import { callsApi, fmtCallDuration, OUTCOME_LABELS } from "@/lib/calls-api";
import { useBusinessStore } from "@/stores/business";
import type { Channel } from "@/lib/smartcomm-types";
import type { CallOutcome } from "@/lib/calls-api";
import { ContactInfoEditor } from "./ContactInfoEditor";

interface Props {
  channel: Channel;
}

const ngnShort = (n: number) => {
  if (n >= 1_000_000)
    return `₦${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(n % 1_000 ? 1 : 0)}k`;
  return `₦${n.toLocaleString()}`;
};

export function CustomerSidebar({ channel }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const activeBrand = useBusinessStore((s) => s.activeKey);
  const customer = channel.members?.find((m) => m.contact_id);
  const contactId = customer?.contact_id ?? undefined;
  const { data, isLoading } = useCustomer360(contactId);
  // WhatsApp call history for this contact (calls module).
  const { data: calls } = useQuery({
    queryKey: ["calls", activeBrand, "contact", contactId],
    queryFn: () => callsApi.list({ contact_id: contactId!, limit: 6 }),
    enabled: !!contactId && channel.external_platform === "whatsapp",
    staleTime: 30_000,
  });
  const [sendingInvoice, setSendingInvoice] = useState<string | null>(null);
  // Order links + live customer activity (opened / picking / ordered).
  // Polled lightly — the thread's system lines arrive instantly anyway;
  // this keeps the cart panel fresh while the customer is browsing.
  const { data: orderLinks } = useQuery({
    queryKey: ["smartcomm", "order-links", channel.channel_id],
    queryFn: () => smartcommApi.listOrderLinks(channel.channel_id),
    enabled: channel.channel_type === "customer_thread",
    refetchInterval: 20_000,
    select: (r) => r.data,
  });

  async function sendInvoice(invoiceId: string) {
    setSendingInvoice(invoiceId);
    try {
      await smartcommApi.sendInvoiceCard(channel.channel_id, invoiceId);
      qc.invalidateQueries({
        queryKey: ["smartcomm", "messages", channel.channel_id],
      });
    } catch {
      // surfaced by the thread error path; keep the sidebar quiet
    } finally {
      setSendingInvoice(null);
    }
  }

  if (channel.channel_type !== "customer_thread" || !contactId) {
    return (
      <div className="grid h-full place-items-center bg-panel/40 border-l hairline p-6">
        <div className="text-center">
          <User className="w-7 h-7 mx-auto mb-2 text-text-faint" />
          <p className="text-[12px] text-text-faint">
            Internal channel — no customer profile.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="bg-panel/40 border-l hairline p-4 space-y-3">
        <div className="h-20 rounded-2xl bg-panel-2 animate-pulse" />
        <div className="h-32 rounded-2xl bg-panel-2 animate-pulse" />
        <div className="h-32 rounded-2xl bg-panel-2 animate-pulse" />
      </div>
    );
  }

  const c = data.contact;
  return (
    <div className="flex h-full flex-col bg-panel/40 border-l hairline overflow-hidden">
      {/* Identity — editable (name/phone/WhatsApp always; "More" opens the
          rest of the online-form fields). Invalidate customer360 on save so
          the edited name/handle flow through to the header + thread. */}
      <ContactInfoEditor
        contact={c}
        handles={data.handles ?? []}
        onSaved={() => {
          qc.invalidateQueries({
            queryKey: ["smartcomm", "customer360", contactId],
          });
          qc.invalidateQueries({ queryKey: ["smartcomm", "channels"] });
          qc.invalidateQueries({
            queryKey: ["smartcomm", "channel", channel.channel_id],
          });
        }}
      />

      {/* Lifetime snapshot */}
      <div className="grid grid-cols-2 border-b hairline">
        <div className="px-4 py-3 border-r hairline">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-faint">
            <Wallet className="w-3 h-3" /> Recent value
          </div>
          <div className="mt-0.5 font-mono text-[15px] font-semibold text-text-primary">
            {ngnShort(
              data.orders.reduce((s, o) => s + Number(o.total || 0), 0),
            )}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-text-faint">
            <FileText className="w-3 h-3" /> Outstanding
          </div>
          <div
            className={`mt-0.5 font-mono text-[15px] font-semibold ${
              data.invoices.length ? "text-amber-300" : "text-text-primary"
            }`}
          >
            {ngnShort(
              data.invoices.reduce((s, i) => s + Number(i.amount_due || 0), 0),
            )}
          </div>
        </div>
      </div>

      {/* Everything below the snapshot scrolls on its own — identity + the
          value tiles above stay put so the rep never loses track of who
          they're looking at while digging through orders/invoices. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Recent orders */}
        <Section
          title="Recent orders"
          icon={<Package className="w-3.5 h-3.5" />}
          count={data.orders.length}
          onViewAll={() => navigate(`/sales?contact_id=${c.contact_id}`)}
        >
          {data.orders.length === 0 ? (
            <Empty>No orders yet</Empty>
          ) : (
            data.orders.slice(0, 4).map((o) => (
              <button
                key={o.order_id}
                onClick={() => navigate(`/sales/orders/${o.order_id}`)}
                className="w-full flex items-center justify-between rounded-lg px-3 py-1.5 hover:bg-panel-2/70 text-left"
              >
                <div>
                  <div className="text-[12px] font-medium text-text-primary">
                    {o.order_number}
                  </div>
                  <div className="text-[10.5px] text-text-faint">
                    {o.sales_channel ?? "—"}
                  </div>
                </div>
                <span className="text-[10.5px] uppercase tracking-widest text-text-muted">
                  {o.status?.replace(/_/g, " ")}
                </span>
              </button>
            ))
          )}
        </Section>

        {/* Open invoices */}
        <Section
          title="Open invoices"
          icon={<FileText className="w-3.5 h-3.5" />}
          count={data.invoices.length}
          onViewAll={() => navigate(`/invoicing?contact_id=${c.contact_id}`)}
        >
          {data.invoices.length === 0 ? (
            <Empty>No outstanding invoices</Empty>
          ) : (
            data.invoices.slice(0, 4).map((i) => (
              <div
                key={i.invoice_id}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5 group"
              >
                <div className="text-[12px] text-text-primary flex-1 truncate">
                  {i.invoice_number}
                </div>
                <div className="text-[11.5px] font-semibold text-amber-300 tabular-nums">
                  ₦{Number(i.amount_due).toLocaleString()}
                </div>
                <button
                  onClick={() => sendInvoice(i.invoice_id)}
                  disabled={sendingInvoice === i.invoice_id}
                  title="Send to chat"
                  className="text-text-faint hover:text-accent-glow disabled:opacity-50 shrink-0"
                >
                  {sendingInvoice === i.invoice_id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            ))
          )}
        </Section>

        {/* Deliveries */}
        <Section
          title="Deliveries"
          icon={<Truck className="w-3.5 h-3.5" />}
          count={data.deliveries.length}
        >
          {data.deliveries.length === 0 ? (
            <Empty>No deliveries</Empty>
          ) : (
            data.deliveries.slice(0, 4).map((d) => (
              <div
                key={d.delivery_id}
                className="flex items-center justify-between rounded-lg px-3 py-1.5 text-[12px]"
              >
                <span className="text-text-primary">{d.delivery_number}</span>
                <span className="text-[10.5px] uppercase tracking-widest text-text-muted">
                  {d.status?.replace(/_/g, " ")}
                </span>
              </div>
            ))
          )}
        </Section>

        {/* WhatsApp calls — who called, who answered, how it went */}
        {channel.external_platform === "whatsapp" && (
          <Section
            title="Calls"
            icon={<Phone className="w-3.5 h-3.5" />}
            count={calls?.length ?? 0}
          >
            {!calls || calls.length === 0 ? (
              <Empty>No WhatsApp calls yet</Empty>
            ) : (
              calls.map((c) => {
                const missed = c.status === "missed" || c.status === "rejected";
                return (
                  <div
                    key={c.call_id}
                    className="flex items-center gap-2 rounded-lg px-3 py-1.5"
                  >
                    <span
                      className={`grid place-items-center w-5 h-5 rounded-full shrink-0 ${
                        missed
                          ? "bg-danger/15 text-danger"
                          : "bg-success/15 text-success"
                      }`}
                    >
                      {missed ? (
                        <PhoneMissed className="w-3 h-3" />
                      ) : (
                        <Phone className="w-3 h-3" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] text-text-primary truncate">
                        {missed
                          ? "Missed call"
                          : `${fmtCallDuration(c.duration_seconds)}${
                              c.answered_by_name ? ` · ${c.answered_by_name}` : ""
                            }`}
                        {c.outcome && (
                          <span className="ml-1 text-[10.5px] text-accent-glow">
                            {OUTCOME_LABELS[c.outcome as CallOutcome] ??
                              c.outcome}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-text-faint">
                        {formatDateTime(c.started_at)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </Section>
        )}

        {/* Order links — what the customer is doing with them right now */}
        <Section
          title="Order links"
          icon={<ShoppingCart className="w-3.5 h-3.5" />}
          count={orderLinks?.length ?? 0}
        >
          {!orderLinks || orderLinks.length === 0 ? (
            <Empty>No order links sent yet</Empty>
          ) : (
            orderLinks.slice(0, 4).map((l) => (
              <div key={l.link_id} className="rounded-lg px-3 py-1.5">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-text-primary">
                    {l.mode === "shop" ? "Catalogue link" : "Order link"}
                  </span>
                  <span
                    className={`text-[10.5px] uppercase tracking-widest ${
                      l.status === "ordered"
                        ? "text-green-400"
                        : l.status === "active"
                          ? "text-accent-glow"
                          : "text-text-muted"
                    }`}
                  >
                    {l.status === "ordered" && l.order_number
                      ? l.order_number
                      : l.status}
                  </span>
                </div>
                <div className="text-[11px] text-text-faint mt-0.5">
                  {l.status === "ordered"
                    ? `Ordered ${formatDate(l.ordered_at, "")}`
                    : l.opened_at
                      ? l.cart && l.cart.length
                        ? `Picking now: ${l.cart
                            .slice(0, 3)
                            .map((c) => `${c.qty}× ${c.name || c.kind}`)
                            .join(", ")}${l.cart.length > 3 ? "…" : ""}`
                        : `Opened ${l.opened_count}× — nothing picked yet`
                      : "Sent — not opened yet"}
                  {l.booking_count > 0 &&
                    ` · ${l.booking_count} service booking${l.booking_count === 1 ? "" : "s"}`}
                </div>
              </div>
            ))
          )}
        </Section>

        {/* Comms log — "did she get her receipt?" */}
        <Section
          title="Comms log"
          icon={<Send className="w-3.5 h-3.5" />}
          count={data.comms?.length ?? 0}
        >
          {!data.comms || data.comms.length === 0 ? (
            <Empty>No emails or notifications sent yet</Empty>
          ) : (
            data.comms.slice(0, 6).map((m) => (
              <div
                key={m.log_id}
                className="flex items-center gap-2 rounded-lg px-3 py-1.5"
              >
                <span
                  className={`grid place-items-center w-5 h-5 rounded-full shrink-0 ${
                    m.status === "failed"
                      ? "bg-danger/15 text-danger"
                      : "bg-accent/15 text-accent-glow"
                  }`}
                >
                  {m.channel === "email" ? (
                    <Mail className="w-3 h-3" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] text-text-primary truncate">
                    {m.subject || m.event_key || m.channel}
                  </div>
                  <div className="text-[10px] text-text-faint">
                    {formatDate(m.created_at)}
                    {m.status === "failed" && " · failed"}
                  </div>
                </div>
              </div>
            ))
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  count,
  children,
  onViewAll,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
  onViewAll?: () => void;
}) {
  return (
    <div className="border-b hairline">
      <div className="flex items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-widest text-text-faint font-semibold">
          {icon}
          {title}
          {count > 0 && (
            <span className="rounded-full bg-panel-2 px-1.5 text-text-muted">
              {count}
            </span>
          )}
        </div>
        {count > 0 && onViewAll && (
          <button
            onClick={onViewAll}
            className="text-[10.5px] text-accent-glow hover:underline"
          >
            View all
          </button>
        )}
      </div>
      <div className="pb-2 px-1 space-y-0.5">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 pb-2 text-[11.5px] italic text-text-faint">{children}</p>
  );
}
