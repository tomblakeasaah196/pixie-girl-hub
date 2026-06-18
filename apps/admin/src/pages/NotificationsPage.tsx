/**
 * /notifications — Full notification inbox.
 *
 * Layout: left sidebar (filter chips) + right list (priority-tinted rows,
 * inline mark-read, delete). Bulk select + mark-read / delete. Infinite
 * scroll via page param. Four states (loading / empty / error / content).
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CheckCheck,
  Trash2,
  Package,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Info,
  Clock,
  Cog,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useNotifications,
  useMarkRead,
  useMarkAllRead,
  useDeleteNotif,
  useBulkDelete,
  useBulkMarkRead,
  type AppNotification,
  NOTIF_META,
} from "@/lib/notifications-api";
import { Card, Button, EmptyState } from "@/components/ui/primitives";
import { useBreadcrumbs } from "@/stores/breadcrumbs";

// ── Filter categories ─────────────────────────────────────────────────────────

type FilterKey = "all" | "unread" | "approvals" | "sales" | "stock" | "ops" | "system";

const FILTERS: { key: FilterKey; label: string; icon: React.ReactNode }[] = [
  { key: "all",       label: "All",       icon: <Bell className="w-4 h-4" /> },
  { key: "unread",    label: "Unread",    icon: <Clock className="w-4 h-4" /> },
  { key: "approvals", label: "Approvals", icon: <AlertTriangle className="w-4 h-4" /> },
  { key: "sales",     label: "Sales",     icon: <DollarSign className="w-4 h-4" /> },
  { key: "stock",     label: "Stock",     icon: <Package className="w-4 h-4" /> },
  { key: "ops",       label: "Operations",icon: <CheckCircle className="w-4 h-4" /> },
  { key: "system",    label: "System",    icon: <Cog className="w-4 h-4" /> },
];

function filterMatches(n: AppNotification, key: FilterKey): boolean {
  if (key === "all") return true;
  if (key === "unread") return !n.is_read;
  const meta = NOTIF_META[n.type];
  return meta?.category === key;
}

// ── Priority display helpers ─────────────────────────────────────────────────

function priorityBorder(p: string) {
  if (p === "urgent") return "border-l-[3px] border-l-danger";
  if (p === "high")   return "border-l-[3px] border-l-warn";
  return "";
}

function priorityDot(p: string) {
  if (p === "urgent") return "bg-danger";
  if (p === "high")   return "bg-warn";
  if (p === "normal") return "bg-accent";
  return "bg-text-faint";
}

function NotifIcon({ type, size = 16 }: { type: string; size?: number }) {
  const cls = `shrink-0 mt-0.5`;
  const s = { width: size, height: size };
  if (type.includes("approval") || type.includes("leave"))
    return <AlertTriangle style={s} className={cn(cls, "text-warn")} />;
  if (type.includes("payment") || type.includes("billing") || type.includes("order"))
    return <DollarSign style={s} className={cn(cls, "text-success")} />;
  if (type.includes("stock") || type.includes("production"))
    return <Package style={s} className={cn(cls, "text-accent-glow")} />;
  if (type.includes("complete") || type.includes("accepted"))
    return <CheckCircle style={s} className={cn(cls, "text-success")} />;
  return <Info style={s} className={cn(cls, "text-accent")} />;
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ── Row ───────────────────────────────────────────────────────────────────────

function NotifRow({
  n,
  selected,
  onSelect,
  onNavigate,
}: {
  n: AppNotification;
  selected: boolean;
  onSelect: (id: string) => void;
  onNavigate: (url: string | null) => void;
}) {
  const markRead = useMarkRead();
  const deleteOne = useDeleteNotif();

  function handleClick() {
    if (!n.is_read) markRead.mutate(n.notification_id);
    onNavigate(n.action_url);
  }

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-5 py-4 border-b hairline last:border-0 transition-colors group",
        priorityBorder(n.priority),
        n.is_read ? "hover:bg-text-primary/[0.02]" : "bg-accent/[0.03] hover:bg-accent/[0.06]",
        selected && "bg-accent/[0.08]",
      )}
    >
      {/* Checkbox */}
      <label className="flex items-center mt-1 cursor-pointer shrink-0" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(n.notification_id)}
          className="w-4 h-4 rounded border-line accent-accent cursor-pointer"
          aria-label={`Select notification: ${n.title}`}
        />
      </label>

      {/* Unread dot */}
      <span
        className={cn(
          "mt-[9px] w-2 h-2 rounded-full shrink-0 transition-colors",
          n.is_read ? "bg-transparent" : priorityDot(n.priority),
        )}
      />

      {/* Icon */}
      <span className="mt-0.5">
        <NotifIcon type={n.type} size={15} />
      </span>

      {/* Content */}
      <button
        onClick={handleClick}
        className="flex-1 min-w-0 text-left"
      >
        <div className="flex items-start justify-between gap-4">
          <p
            className={cn(
              "text-[13px] leading-snug line-clamp-2",
              n.is_read ? "text-text-muted" : "font-semibold text-text-primary",
            )}
          >
            {n.title}
          </p>
          <span className="text-[10.5px] text-text-faint shrink-0 mt-0.5">{relTime(n.created_at)}</span>
        </div>
        {n.body && (
          <p className="text-[11.5px] text-text-faint mt-0.5 line-clamp-2 leading-relaxed">
            {n.body}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          {n.priority !== "normal" && n.priority !== "low" && (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                n.priority === "urgent" ? "bg-danger/15 text-danger" : "bg-warn/15 text-warn",
              )}
            >
              {n.priority}
            </span>
          )}
          {n.type && (
            <span className="text-[10px] text-text-faint capitalize">
              {NOTIF_META[n.type]?.label ?? n.type.replace(/_/g, " ")}
            </span>
          )}
        </div>
      </button>

      {/* Row actions (visible on hover) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {!n.is_read && (
          <button
            onClick={() => markRead.mutate(n.notification_id)}
            disabled={markRead.isPending}
            aria-label="Mark as read"
            className="p-1.5 rounded-lg text-text-faint hover:text-accent hover:bg-accent/10 transition-colors"
            title="Mark read"
          >
            <CheckCheck className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => deleteOne.mutate(n.notification_id)}
          disabled={deleteOne.isPending}
          aria-label="Delete"
          className="p-1.5 rounded-lg text-text-faint hover:text-danger hover:bg-danger/10 transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 25;

export function NotificationsPage() {
  useBreadcrumbs([{ label: "Notifications" }]);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useNotifications({
    unread: filter === "unread",
    page,
    page_size: PAGE_SIZE,
  });
  const markAll = useMarkAllRead();
  const bulkDelete = useBulkDelete();
  const bulkMarkRead = useBulkMarkRead();

  const all = query.data?.data ?? [];
  const visible = filter === "all" || filter === "unread"
    ? all
    : all.filter((n) => filterMatches(n, filter));

  const totalPages = Math.ceil((query.data?.total ?? 0) / PAGE_SIZE);
  const unreadCount = (query.data?.data ?? []).filter((n) => !n.is_read).length;
  const selAll = visible.length > 0 && visible.every((n) => selected.has(n.notification_id));

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selAll) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map((n) => n.notification_id)));
    }
  }

  const handleNavigate = useCallback((url: string | null) => {
    navigate(url ?? "/notifications");
  }, [navigate]);

  return (
    <div className="flex gap-5 max-lg:flex-col max-w-[1100px] mx-auto">
      {/* Sidebar filters */}
      <aside className="w-[200px] shrink-0 max-lg:w-full">
        <Card className="overflow-hidden">
          <div className="py-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setPage(1); setSelected(new Set()); }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-4 py-2.5 text-[13px] transition-colors text-left",
                  filter === f.key
                    ? "bg-accent/10 text-accent font-semibold border-l-[3px] border-l-accent"
                    : "text-text-muted hover:bg-text-primary/[0.04] hover:text-text-primary",
                )}
                aria-current={filter === f.key ? "page" : undefined}
              >
                <span className={cn("shrink-0", filter === f.key ? "text-accent" : "text-text-faint")}>
                  {f.icon}
                </span>
                {f.label}
              </button>
            ))}
          </div>
        </Card>
      </aside>

      {/* Main list */}
      <div className="flex-1 min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 mb-3">
          {/* Select all */}
          <label className="flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={selAll}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-line accent-accent cursor-pointer"
              aria-label="Select all visible notifications"
            />
          </label>

          {selected.size > 0 ? (
            <div className="flex items-center gap-2 animate-[fade-in_0.15s_ease-out]">
              <span className="text-[12px] text-text-muted">{selected.size} selected</span>
              <Button
                size="sm"
                variant="secondary"
                icon={<CheckCheck className="w-3.5 h-3.5" />}
                onClick={() => { bulkMarkRead.mutate(Array.from(selected)); setSelected(new Set()); }}
                disabled={bulkMarkRead.isPending}
              >
                Mark read
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => {
                  bulkDelete.mutate(Array.from(selected));
                  setSelected(new Set());
                }}
                disabled={bulkDelete.isPending}
              >
                Delete
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 ml-auto">
              {unreadCount > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<CheckCheck className="w-3.5 h-3.5" />}
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                >
                  Mark all read
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw className={cn("w-3.5 h-3.5", query.isFetching && "animate-spin")} />}
                onClick={() => query.refetch()}
                aria-label="Refresh"
              />
            </div>
          )}
        </div>

        <Card className="overflow-hidden">
          {query.isError ? (
            <div className="p-8 text-center">
              <p className="text-[13px] text-text-muted mb-3">Couldn't load notifications.</p>
              <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          ) : query.isLoading ? (
            <div className="divide-y hairline">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 px-5 py-4 animate-pulse">
                  <div className="w-4 h-4 rounded bg-text-primary/[0.08] mt-1" />
                  <div className="w-2 h-2 rounded-full bg-text-primary/[0.08] mt-2" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-text-primary/[0.08] rounded w-2/3" />
                    <div className="h-2 bg-text-primary/[0.05] rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="py-20">
              <EmptyState
                icon={<Bell className="w-8 h-8" />}
                title={filter === "unread" ? "No unread notifications" : "No notifications"}
                message={
                  filter !== "all" && filter !== "unread"
                    ? `No ${filter} notifications yet.`
                    : "You're all caught up — check back later."
                }
              />
            </div>
          ) : (
            <>
              {visible.map((n) => (
                <NotifRow
                  key={n.notification_id}
                  n={n}
                  selected={selected.has(n.notification_id)}
                  onSelect={toggleSelect}
                  onNavigate={handleNavigate}
                />
              ))}
            </>
          )}
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 text-[12px] text-text-muted">
            <span>
              Page {page} of {totalPages} · {query.data?.total ?? 0} notifications
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="p-1.5 rounded-lg hover:bg-text-primary/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded-lg hover:bg-text-primary/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
