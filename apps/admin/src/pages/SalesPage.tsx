import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useState } from "react";
import { Plus, ShoppingBag, Send } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button, Pill, MoneyText, KpiTile, type Tone } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { Timeline } from "@/components/ui/Timeline";

/**
 * Sales Orders — example module screen showing the canon's list + detail
 * pattern: KPI strip, server-driven DataTable, and a Drawer with the
 * Payment Workbench (balance ribbon + order timeline). Data is mocked here;
 * wire to /sales with the entity-scope header on integration.
 */
interface Order {
  no: string;
  customer: string;
  channel: string;
  status: [Tone, string];
  payment: [Tone, string];
  total: number;
}

const ORDERS: Order[] = [
  { no: "PXG-SO-10428", customer: "Amara O.", channel: "instagram", status: ["warn", "Awaiting bal"], payment: ["warn", "Layaway"], total: 620000 },
  { no: "PXG-SO-10427", customer: "Blessing A.", channel: "website", status: ["success", "Confirmed"], payment: ["success", "Paid"], total: 340000 },
  { no: "PXG-SO-10426", customer: "Chidinma E.", channel: "whatsapp", status: ["info", "Production"], payment: ["success", "Deposit"], total: 1200000 },
  { no: "PXG-SO-10425", customer: "Damilola K.", channel: "pos", status: ["success", "Delivered"], payment: ["success", "Paid"], total: 185000 },
  { no: "PXG-SO-10424", customer: "Esohe I.", channel: "public form", status: ["danger", "Overdue"], payment: ["danger", "70d"], total: 455000 },
];

const AVATARS = ["#8b9d77", "#7a8fa8", "#b76e79", "#9c7ad9", "#5aa0a8"];

export function SalesPage() {
  useBreadcrumbs([{ label: "Sales" }]);
  const [selected, setSelected] = useState<Order | null>(null);

  const columns: Column<Order>[] = [
    { key: "no", header: "Order", render: (o) => <span className="font-mono text-xs text-accent-glow">{o.no}</span> },
    {
      key: "customer",
      header: "Customer",
      render: (o, i = ORDERS.indexOf(o)) => (
        <span className="flex items-center gap-2.5">
          <span className="w-[30px] h-[30px] rounded-full grid place-items-center text-[11px] font-semibold text-white font-display" style={{ background: AVATARS[i % AVATARS.length] }}>
            {o.customer[0]}
          </span>
          {o.customer}
        </span>
      ),
    },
    { key: "channel", header: "Channel", render: (o) => <span className="text-[11px] text-text-faint capitalize">{o.channel}</span> },
    { key: "status", header: "Status", render: (o) => <Pill tone={o.status[0]}>{o.status[1]}</Pill> },
    { key: "payment", header: "Payment", render: (o) => <Pill tone={o.payment[0]}>{o.payment[1]}</Pill> },
    { key: "total", header: "Total", align: "right", render: (o) => <MoneyText ngn={o.total} /> },
  ];

  return (
    <div>
      <div className="flex items-center mb-4">
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} className="ml-auto">New Order</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiTile label="Revenue · MTD" value="₦18.4M" delta={{ up: true, text: "12.4%" }} />
        <KpiTile label="Orders today" value="37" delta={{ up: true, text: "6 vs yest." }} />
        <KpiTile label="Outstanding" value="₦2.9M" tone="warn" />
        <KpiTile label="Avg order value" value="₦497k" delta={{ up: true, text: "3.1%" }} />
      </div>

      <DataTable
        columns={columns}
        rows={ORDERS}
        rowKey={(o) => o.no}
        onRowClick={setSelected}
        empty={{ icon: <ShoppingBag className="w-8 h-8" />, title: "No orders yet", message: "Create the first order for this business." }}
      />

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.no ?? ""}
        subtitle="Created 13 Jun · by Tom-Blake"
        footer={
          <>
            <Button size="sm" icon={<Send className="w-3.5 h-3.5" />}>Pay-link</Button>
            <Button size="sm" variant="primary">Record payment</Button>
          </>
        }
      >
        {selected && (
          <>
            <div className="micro mb-3">Payment Workbench</div>
            <div className="grid grid-cols-3 gap-2.5 mb-4">
              {[["Total", selected.total, ""], ["Paid", selected.total / 2, "text-success"], ["Balance", selected.total / 2, "text-warn"]].map(([k, v, c]) => (
                <div key={k as string} className="p-3 rounded-[13px] bg-text-primary/[0.04] border hairline">
                  <div className="micro">{k as string}</div>
                  <div className={`font-display text-xl mt-1 tabular-nums ${c as string}`}><MoneyText ngn={v as number} /></div>
                </div>
              ))}
            </div>
            <Pill tone="warn">Layaway · ships when paid in full</Pill>
            <div className="micro mt-5 mb-3">Order timeline</div>
            <Timeline
              steps={[
                { state: "done", title: "Order placed", detail: "13 Jun, 09:14 · Instagram" },
                { state: "done", title: "Deposit received", detail: "13 Jun, 09:20 · ₦310k via Paystack" },
                { state: "current", title: "Awaiting balance", detail: "Reminder: WhatsApp in 3 days" },
                { state: "todo", title: "Production", detail: "Unlocks at full payment" },
                { state: "todo", title: "Dispatch", detail: "Curated letter auto-prints at packing" },
              ]}
            />
          </>
        )}
      </Drawer>
    </div>
  );
}
