import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ShoppingBag, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill, MoneyText } from "@/components/ui/primitives";
import { Select, ErrorState } from "@/components/ui/controls";
import { useOrders } from "./hooks";
import {
  ORDER_STATUS,
  ORDER_STATUS_OPTIONS,
  SALES_CHANNELS,
  FULFILMENT_LABELS,
} from "./constants";
import type { SalesOrder, OrderStatus, FulfilmentType } from "./types";

const LAST_OPENED_KEY = "sales-orders-last";

const columns: Column<SalesOrder>[] = [
  {
    key: "date",
    header: "Date & Time",
    width: "140px",
    render: (o) => {
      const d = new Date(o.created_at);
      return (
        <span className="text-[12px] text-text-muted">
          <span className="block">{d.toLocaleDateString()}</span>
          <span className="block text-[11px] opacity-70">
            {d.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </span>
      );
    },
  },
  {
    key: "number",
    header: "Order #",
    width: "130px",
    render: (o) => (
      <span className="font-mono text-[13px] font-semibold">
        {o.order_number}
      </span>
    ),
  },
  {
    key: "contact",
    header: "Customer",
    render: (o) => <span className="text-[13px]">{o.contact_name ?? "—"}</span>,
  },
  {
    key: "channel",
    header: "Channel",
    render: (o) => (
      <span className="text-[12px] text-text-muted">
        {o.sales_campaign_id
          ? `Sales Campaign${o.utm_campaign ? ` · ${o.utm_campaign}` : ""}`
          : (SALES_CHANNELS.find((c) => c.value === o.sales_channel)?.label ??
            o.sales_channel)}
      </span>
    ),
  },
  {
    key: "kind",
    header: "Kind",
    width: "110px",
    render: (o) => {
      const kinds = (o.line_kinds ?? []).filter(Boolean);
      if (!kinds.length)
        return <span className="text-[12px] text-text-faint">—</span>;
      // Show the "most operational" kind first — styled/service work drives
      // Studio, so it outranks a plain base product on the same order.
      const rank: Record<string, number> = {
        service: 0,
        styled: 1,
        bundle: 2,
        product: 3,
      };
      const sorted = [...kinds].sort((a, b) => (rank[a] ?? 9) - (rank[b] ?? 9));
      const meta: Record<
        string,
        {
          label: string;
          tone: "success" | "warn" | "danger" | "info" | "accent" | "neutral";
        }
      > = {
        styled: { label: "Styled", tone: "accent" },
        service: { label: "Service", tone: "info" },
        bundle: { label: "Bundle", tone: "success" },
        product: { label: "Base", tone: "neutral" },
      };
      const first = meta[sorted[0]] ?? {
        label: sorted[0],
        tone: "neutral" as const,
      };
      return (
        <span className="inline-flex items-center gap-1">
          <Pill tone={first.tone}>{first.label}</Pill>
          {sorted.length > 1 && (
            <span
              className="text-[10px] text-text-faint"
              title={sorted
                .slice(1)
                .map((k) => meta[k]?.label ?? k)
                .join(", ")}
            >
              +{sorted.length - 1}
            </span>
          )}
        </span>
      );
    },
  },
  {
    key: "fulfilment",
    header: "Fulfilment",
    render: (o) => {
      const f = FULFILMENT_LABELS[o.order_type as FulfilmentType];
      return f ? (
        <Pill tone={f.tone}>{f.label}</Pill>
      ) : (
        <span className="text-[12px] text-text-faint">—</span>
      );
    },
  },
  {
    key: "status",
    header: "Status",
    render: (o) => {
      const s = ORDER_STATUS[o.status as OrderStatus];
      return s ? <Pill tone={s.tone}>{s.label}</Pill> : <Pill>{o.status}</Pill>;
    },
  },
  {
    key: "discount",
    header: "Discount",
    align: "right",
    render: (o) => {
      const d = Number(o.discount_amount_ngn);
      return d > 0 ? (
        <span className="text-danger tabular-nums">
          −<MoneyText ngn={d} />
        </span>
      ) : (
        <span className="text-[12px] text-text-faint">—</span>
      );
    },
  },
  {
    key: "logistics",
    header: "Logistics",
    align: "right",
    render: (o) => {
      const s = Number(o.shipping_fee_ngn);
      return s > 0 ? (
        <span className="text-danger tabular-nums">
          <MoneyText ngn={s} />
        </span>
      ) : (
        <span className="text-[12px] text-text-faint">—</span>
      );
    },
  },
  {
    key: "usd",
    header: "$ Amount",
    align: "right",
    render: (o) =>
      o.display_currency && o.display_currency !== "NGN" && o.display_total ? (
        <span className="font-mono tabular-nums">
          ${Number(o.display_total).toLocaleString()}
        </span>
      ) : (
        <span className="text-[12px] text-text-faint">—</span>
      ),
  },
  {
    key: "fx",
    header: "Exchange Rate",
    align: "right",
    render: (o) =>
      o.display_currency &&
      o.display_currency !== "NGN" &&
      o.fx_rate_used &&
      Number(o.fx_rate_used) > 1 ? (
        <span className="text-[12px] text-text-muted tabular-nums">
          ₦{Number(o.fx_rate_used).toLocaleString()}/$
        </span>
      ) : (
        <span className="text-[12px] text-text-faint">—</span>
      ),
  },
  {
    key: "total",
    header: "Total (₦)",
    align: "right",
    render: (o) => <MoneyText ngn={Number(o.total_ngn)} />,
  },
  {
    key: "net",
    header: "Net (goods)",
    align: "right",
    render: (o) => (
      <MoneyText
        ngn={Number(o.total_ngn) - Number(o.shipping_fee_ngn)}
        className="text-success"
      />
    ),
  },
  {
    key: "balance",
    header: "Balance",
    align: "right",
    render: (o) => {
      const bal = Number(o.balance_due_ngn);
      return bal > 0 ? (
        <MoneyText ngn={bal} className="text-warn" />
      ) : (
        <span className="text-[12px] text-success">Paid</span>
      );
    },
  },
];

export function OrdersView() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [partPaid, setPartPaid] = useState(false);
  const [page, setPage] = useState(1);
  const [sp, setSp] = useSearchParams();

  // "Which row is highlighted right now?" — driven by three sources:
  //   1. ?order=<id> in the URL (deep link or return-from-detail)
  //   2. sessionStorage (the last order we opened this session; used when
  //      the user navigates back and the URL lost the param)
  //   3. keyboard arrow keys
  // Only one wins at a time; we sync the URL as the source of truth so
  // reloads + shares preserve the highlight.
  const urlOrderId = sp.get("order");
  const initialFocus =
    urlOrderId ??
    (typeof window !== "undefined"
      ? sessionStorage.getItem(LAST_OPENED_KEY)
      : null);
  const [focusedId, setFocusedId] = useState<string | null>(initialFocus);
  useEffect(() => {
    if (urlOrderId && urlOrderId !== focusedId) setFocusedId(urlOrderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlOrderId]);

  const focus = useCallback(
    (id: string | null) => {
      setFocusedId(id);
      setSp((p) => {
        const next = new URLSearchParams(p);
        if (id) next.set("order", id);
        else next.delete("order");
        return next;
      });
    },
    [setSp],
  );

  const openOrder = useCallback(
    (id: string) => {
      sessionStorage.setItem(LAST_OPENED_KEY, id);
      focus(id);
      navigate(`/sales/orders/${id}`);
    },
    [focus, navigate],
  );

  const { data, isLoading, isError, refetch } = useOrders({
    status: status || undefined,
    search: search || undefined,
    part_paid: partPaid || undefined,
    page,
    page_size: 25,
  });

  const orders = data?.data ?? [];
  const meta = data?.meta;

  // Keyboard nav: ↑/↓ move the highlight, Enter opens the focused order,
  // Escape clears focus. Ignore the shortcuts while the user is typing in
  // the toolbar's search input.
  const tableWrap = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      if (!orders.length) return;
      const idx = focusedId
        ? orders.findIndex((o) => o.order_id === focusedId)
        : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = orders[Math.min(orders.length - 1, idx + 1)];
        if (next) focus(next.order_id);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = orders[Math.max(0, idx <= 0 ? 0 : idx - 1)];
        if (next) focus(next.order_id);
      } else if (e.key === "Enter" && focusedId) {
        e.preventDefault();
        openOrder(focusedId);
      } else if (e.key === "Escape" && focusedId) {
        e.preventDefault();
        focus(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orders, focusedId, focus, openOrder]);

  // Scroll the highlighted row into view on mount + whenever focus changes
  // (esp. useful when returning from OrderDetailPage — the row that was
  // opened stays anchored where the user's eye is).
  useLayoutEffect(() => {
    if (!focusedId || !tableWrap.current) return;
    const row = tableWrap.current.querySelector<HTMLElement>(
      `tr[data-row-key="${focusedId}"]`,
    );
    if (row) row.scrollIntoView({ block: "nearest" });
  }, [focusedId, orders]);

  return (
    <>
      {isError ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <div ref={tableWrap}>
          <DataTable
            columns={columns}
            rows={orders}
            rowKey={(o) => o.order_id}
            onRowClick={(o) => openOrder(o.order_id)}
            activeKey={focusedId}
            loading={isLoading}
            empty={{
              icon: <ShoppingBag className="w-8 h-8" />,
              title: "No orders yet",
              message:
                "Orders from Quick Sale and other channels will appear here.",
            }}
            toolbar={
              <>
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
                  <input
                    placeholder="Search by order # or customer…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    className="w-full h-[38px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
                    autoComplete="off"
                    data-lpignore="true"
                    data-1p-ignore=""
                    data-form-type="other"
                  />
                </div>
                <Select
                  value={status}
                  onChange={(v) => {
                    setStatus(v);
                    setPage(1);
                  }}
                  options={
                    ORDER_STATUS_OPTIONS as { value: string; label: string }[]
                  }
                  className="w-[180px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPartPaid((v) => !v);
                    setPage(1);
                  }}
                  aria-pressed={partPaid}
                  className={`h-[38px] px-3.5 rounded-[10px] border text-[12px] font-semibold whitespace-nowrap transition-colors ${
                    partPaid
                      ? "border-accent/50 bg-accent/10 text-accent-readable"
                      : "border-line text-text-muted hover:text-text-primary"
                  }`}
                >
                  Part-paid
                </button>
              </>
            }
          />

          {meta && meta.total > meta.page_size && (
            <div className="flex items-center justify-between text-[12px] text-text-muted mt-3 px-1">
              <span>
                Showing {(meta.page - 1) * meta.page_size + 1}–
                {Math.min(meta.page * meta.page_size, meta.total)} of{" "}
                {meta.total}
              </span>
              <div className="flex gap-1">
                <button
                  disabled={meta.page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 h-8 rounded-[9px] border border-line text-[12px] font-semibold disabled:opacity-40 hover:bg-text-primary/[0.05]"
                >
                  Prev
                </button>
                <button
                  disabled={!meta.has_more}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 h-8 rounded-[9px] border border-line text-[12px] font-semibold disabled:opacity-40 hover:bg-text-primary/[0.05]"
                >
                  Next
                </button>
              </div>
            </div>
          )}
          <div className="mt-2 text-[11px] text-text-faint px-1">
            Tip: ↑/↓ to move · Enter to open · Esc to clear
          </div>
        </div>
      )}
    </>
  );
}
