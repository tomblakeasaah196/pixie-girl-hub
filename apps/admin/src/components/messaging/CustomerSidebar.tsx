import { useNavigate } from "react-router-dom";
import {
  ExternalLink,
  Mail,
  Package,
  Phone,
  Truck,
  User,
  FileText,
} from "lucide-react";
import { useCustomer360 } from "@/hooks/useSmartcomm";
import type { Channel } from "@/lib/smartcomm-types";
import { PlatformPill } from "./PlatformPill";

interface Props {
  channel: Channel;
}

export function CustomerSidebar({ channel }: Props) {
  const navigate = useNavigate();
  const customer = channel.members?.find((m) => m.contact_id);
  const contactId = customer?.contact_id ?? undefined;
  const { data, isLoading } = useCustomer360(contactId);

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
    <div className="flex h-full flex-col bg-panel/40 border-l hairline overflow-y-auto">
      {/* Identity */}
      <div className="p-4 border-b hairline space-y-3">
        <div className="flex items-start gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-full bg-panel-2 border hairline text-[13px] font-semibold text-text-primary shrink-0">
            {(c.display_name?.[0] ?? "?").toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[14.5px] truncate">
              {c.display_name}
            </p>
            {c.company_name && (
              <p className="text-[11.5px] text-text-muted truncate">
                {c.company_name}
              </p>
            )}
          </div>
          <button
            onClick={() => navigate(`/contacts/${c.contact_id}`)}
            className="text-text-muted hover:text-accent-glow"
            title="Open full contact"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1.5 text-[12px] text-text-muted">
          {c.primary_phone && (
            <div className="flex items-center gap-2">
              <Phone className="w-3.5 h-3.5 text-text-faint" />
              {c.primary_phone}
            </div>
          )}
          {c.email && (
            <div className="flex items-center gap-2 truncate">
              <Mail className="w-3.5 h-3.5 text-text-faint shrink-0" />
              <span className="truncate">{c.email}</span>
            </div>
          )}
        </div>
        {data.handles?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.handles.map((h) => (
              <PlatformPill key={h.platform} platform={h.platform} showLabel />
            ))}
          </div>
        )}
      </div>

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
              onClick={() => navigate(`/sales/${o.order_id}`)}
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
              className="flex items-center justify-between rounded-lg px-3 py-1.5"
            >
              <div className="text-[12px] text-text-primary">
                {i.invoice_number}
              </div>
              <div className="text-[11.5px] font-semibold text-amber-300 tabular-nums">
                ₦{Number(i.amount_due).toLocaleString()}
              </div>
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
