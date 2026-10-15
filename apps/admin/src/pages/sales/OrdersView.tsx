import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ShoppingBag, Search, Archive } from "lucide-react";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Pill, MoneyText } from "@/components/ui/primitives";
import { formatDate, formatTime } from "@/lib/format";
import { Select, ErrorState } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import { useOrders, useCollectionsSummary } from "./hooks";
import { OrdersArchiveModal } from "./OrdersArchiveModal";
import {
  ORDER_STATUS,
  ORDER_STATUS_OPTIONS,
  COLLECTION_VIEW_OPTIONS,
  collectionViewHint,
  SALES_CHANNELS,
  FULFILMENT_LABELS,
} from "./constants";
import type { CollectionView } from "./constants";
import type { SalesOrder, OrderStatus, FulfilmentType } from "./types";

const LAST_OPENED_KEY = "sales-orders-last";
// Opening an order navigates to a separate page, which unmounts this list and
// drops its filter state. Persisting the toolbar filters (status / search /
// page) for the browsing session means "Back" returns the register exactly as
// the user left it — including the balance-based Partially Paid view.
const FILTERS_KEY = "sales-orders-filters";
interface PersistedFilters {
  status: string;
  /** Collections money view (see COLLECTION_VIEWS) — "" means no money filter. */
  collections: CollectionView;
  search: string;
  page: number;
}
function loadFilters(): PersistedFilters {
  const empty: PersistedFilters = {
    status: "",
    collections: "",
    search: "",
    page: 1,
  };
  if (typeof window === "undefined") return empty;
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}

// The stage dropdown drops `partially_paid`: in this list that value has always
// driven the collections money filter, not the literal lifecycle status, and it
// now lives in the Collections control where the two money views (Outstanding
// Balance / Partially Paid) are named for what they actually count.
const STAGE_OPTIONS = ORDER_STATUS_OPTIONS.filter(
  (o) => o.value !== "partially_paid",
) as { value: string; label: string }[];

const buildColumns = (navigate: (to: string) => void): Column<SalesOrder>[] => [
  {
    key: "date",
    header: "Date & Time",
    width: "140px",
    render: (o) => (
      <span className="text-[12px] text-text-muted">
        <span className="block">{formatDate(o.created_at)}</span>
        <span className="block text-[11px] opacity-70">
          {formatTime(o.created_at)}
        </span>
      </span>
    ),
  },
  {
    key: "number",
    header: "Order #",
    width: "130px",
    render: (o) => (
      <span className="inline-flex flex-col gap-1">
        <span className="font-mono text-[13px] font-semibold">
          {o.order_number}
        </span>
        {o.is_preorder && <Pill tone="warn">Pre-order</Pill>}
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
    key: "products",
    header: "Products",
    width: "230px",
    render: (o) => {
      const items = (o.line_items ?? []).filter((it) => it && it.name);
      if (!items.length)
        return <span className="text-[12px] text-text-faint">—</span>;
      // Show the first few names + qty inline; long orders collapse the tail
      // into a "+N more" hint (full list on hover) so the row stays compact.
      const shown = items.slice(0, 3);
      const extra = items.length - shown.length;
      return (
        <div className="flex flex-col gap-0.5 max-w-[230px]">
          {shown.map((it, idx) => (
            <span
              key={idx}
              className="text-[12px] leading-tight truncate"
              title={`${it.name}${it.variant ? ` · ${it.variant}` : ""} ×${it.quantity}`}
            >
              <span className="text-text-primary">{it.name}</span>
              <span className="text-text-faint"> ×{it.quantity}</span>
            </span>
          ))}
          {extra > 0 && (
            <span
              className="text-[10px] text-text-faint"
              title={items
                .slice(3)
                .map((it) => `${it.name} ×${it.quantity}`)
                .join(", ")}
            >
              +{extra} more
            </span>
          )}
        </div>
      );
    },
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
  {
    // Deep-link to this order's invoice, so Sales and Invoicing are one hop
    // apart in both directions.
    key: "invoice",
    header: "Invoice",
    width: "130px",
    render: (o) =>
      o.invoice_id ? (
        <button
          type="button"
          className="font-mono text-[12px] text-accent hover:underline"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/invoicing?tab=invoices&invoice=${o.invoice_id}`);
          }}
        >
          {o.invoice_number ?? "View invoice"}
        </button>
      ) : (
        <span className="text-[12px] text-text-faint">—</span>
      ),
  },
];

export function OrdersView() {
  const navigate = useNavigate();
  const columns = useMemo(() => buildColumns(navigate), [navigate]);
  // Seed from the persisted filters so a return from an order detail restores
  // the register exactly (see FILTERS_KEY). `useState(loadFilters)` reads
  // sessionStorage once, on mount.
  const [persisted] = useState(loadFilters);
  // A session persisted before the Collections control existed can still carry
  // `status: "partially_paid"`. That value always meant the money filter, so
  // migrate it into the new control instead of sending it as a literal status.
  const legacyPartPaid = persisted.status === "partially_paid";
  const [status, setStatus] = useState(legacyPartPaid ? "" : persisted.status);
  const [collections, setCollections] = useState<CollectionView>(
    legacyPartPaid ? "partially_paid" : persisted.collections ?? "",
  );
  const [search, setSearch] = useState(persisted.search);
  // Archive drawer (cancelled orders). Deliberately NOT persisted — it's a
  // look-up, not a filter the list should reopen into.
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [page, setPage] = useState(persisted.page);
  const [sp, setSp] = useSearchParams();

  // Keep the persisted copy in step with the live filters so the next
  // remount (after opening an order) picks them up.
  useEffect(() => {
    try {
      sessionStorage.setItem(
        FILTERS_KEY,
        JSON.stringify({ status, collections, search, page }),
      );
    } catch {
      /* sessionStorage unavailable — filters just won't persist */
    }
  }, [status, collections, search, page]);

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

  // Two independent filters, deliberately:
  //   • `status`  — the literal lifecycle stage (Assigned, Dispatched, …).
  //   • `collections` — a MONEY view derived from amount_paid_ngn /
  //     balance_due_ngn, because a part-paid order can legitimately sit at
  //     assigned, order_ready, dispatched or completed. They combine, so
  //     "Outstanding Balance + Dispatched" is the parcels that left with a
  //     balance still open.
  const { data, isLoading, isError, refetch } = useOrders({
    status: status || undefined,
    // Cancelled orders live in the Archive drawer, not the working list. An
    // explicit lifecycle status still wins; both collections views independently
    // exclude draft/cancel/refund/failure rows server-side.
    exclude_status: !status ? "cancelled" : undefined,
    search: search || undefined,
    part_paid: collections === "partially_paid" || undefined,
    outstanding_balance: collections === "outstanding_balance" || undefined,
    page,
    page_size: 25,
  });

  // The collections headline ("which active customers owe us money?") — one
  // number for the whole book, so nobody has to page through the list to see
  // the size of the queue they are looking at.
  const { data: collectionsSummary } = useCollectionsSummary();

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
          {/* Collections headline — the answer to "which active customers owe
              us money?" without paging the list. Live receivables only: the
              muted tail is the balance stranded on draft / cancel-requested /
              cancelled / refunded / failed orders, which stays on those rows as
              history but is not money anyone can still collect. */}
          {collectionsSummary && (
            <div
              className="glass rounded-[13px] shadow-glass px-4 py-2.5 mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]"
              data-testid="collections-summary"
            >
              <span className="micro text-text-faint">Collections</span>
              <button
                type="button"
                onClick={() => {
                  setCollections(
                    collections === "outstanding_balance"
                      ? ""
                      : "outstanding_balance",
                  );
                  setPage(1);
                }}
                title={collectionViewHint("outstanding_balance")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 -mx-2 transition-colors hover:bg-text-primary/[0.06]",
                  collections === "outstanding_balance" &&
                    "bg-warn/15 text-text-primary",
                )}
              >
                <span className="text-text-muted">Outstanding balance</span>
                <span className="font-semibold text-text-primary tabular-nums">
                  {collectionsSummary.outstanding_orders}
                </span>
                <MoneyText
                  ngn={Number(collectionsSummary.outstanding_balance_ngn)}
                  className="text-text-primary"
                />
              </button>
              <button
                type="button"
                onClick={() => {
                  setCollections(
                    collections === "partially_paid" ? "" : "partially_paid",
                  );
                  setPage(1);
                }}
                title={collectionViewHint("partially_paid")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 transition-colors hover:bg-text-primary/[0.06]",
                  collections === "partially_paid" &&
                    "bg-warn/15 text-text-primary",
                )}
              >
                <span className="text-text-muted">Part-paid</span>
                <span className="tabular-nums text-text-primary">
                  {collectionsSummary.partially_paid_orders}
                </span>
                ·
                <MoneyText
                  ngn={Number(collectionsSummary.partially_paid_balance_ngn)}
                  className="text-text-primary"
                />
              </button>
              {/* Not a filter of its own: the ₦0-paid slow lane is already
                  inside Outstanding Balance, and the WhatsApp/staff-negotiated
                  expiry policy is deliberately unchanged — these orders are
                  surfaced, never cancelled sooner. */}
              <span
                className="text-text-muted"
                title="Active orders with no payment at all — inside Outstanding Balance. Left to the normal unpaid-order expiry policy."
              >
                ₦0 paid{" "}
                <span className="tabular-nums text-text-primary">
                  {collectionsSummary.unpaid_orders}
                </span>{" "}
                ·{" "}
                <MoneyText
                  ngn={Number(collectionsSummary.unpaid_balance_ngn)}
                  className="text-text-primary"
                />
              </span>
              {Number(collectionsSummary.excluded_balance_ngn) > 0 && (
                <span
                  className="text-[11px] text-text-faint ml-auto"
                  title="Cancelled, refunded, failed, draft and cancel-requested orders keep their balances as history; they are not live receivables."
                >
                  Not collectable: {collectionsSummary.excluded_orders} closed
                  orders ·{" "}
                  <MoneyText
                    ngn={Number(collectionsSummary.excluded_balance_ngn)}
                    className="text-text-faint"
                  />
                </span>
              )}
            </div>
          )}
          <DataTable
            columns={columns}
            rows={orders}
            rowKey={(o) => o.order_id}
            onRowClick={(o) => openOrder(o.order_id)}
            activeKey={focusedId}
            loading={isLoading}
            empty={
              collections
                ? {
                    icon: <ShoppingBag className="w-8 h-8" />,
                    title:
                      collections === "outstanding_balance"
                        ? "Nothing outstanding"
                        : "No part-paid orders",
                    message:
                      collections === "outstanding_balance"
                        ? "Every active order is settled — no customer owes a balance right now."
                        : "No active order has money received with a balance still due.",
                  }
                : {
                    icon: <ShoppingBag className="w-8 h-8" />,
                    title: "No orders yet",
                    message:
                      "Orders from Quick Sale and other channels will appear here.",
                  }
            }
            toolbar={
              <>
                <div className="relative min-w-0 w-full sm:flex-1 sm:min-w-[180px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
                  <input
                    placeholder="Search by order #, customer, or product…"
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
                {/* Collections — the money views. The tooltip spells out what
                    each one counts, because "who owes us" is the question the
                    stage dropdown cannot answer. */}
                <div className="shrink-0" title={collectionViewHint(collections)}>
                  <Select<CollectionView>
                    value={collections}
                    onChange={(v) => {
                      setCollections(v);
                      setPage(1);
                    }}
                    options={COLLECTION_VIEW_OPTIONS}
                    ariaLabel="Collections view"
                    className="w-[190px]"
                  />
                </div>
                <Select
                  value={status}
                  onChange={(v) => {
                    setStatus(v);
                    setPage(1);
                  }}
                  options={STAGE_OPTIONS}
                  ariaLabel="Order stage"
                  className="w-[170px]"
                />
                <button
                  type="button"
                  onClick={() => setArchiveOpen(true)}
                  title="Archived (cancelled) orders"
                  aria-label="Archived orders"
                  className="h-[38px] w-[38px] shrink-0 grid place-items-center rounded-[10px] border border-line text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-colors"
                >
                  <Archive className="h-4 w-4" />
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

      <OrdersArchiveModal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onRestored={refetch}
      />
    </>
  );
}
