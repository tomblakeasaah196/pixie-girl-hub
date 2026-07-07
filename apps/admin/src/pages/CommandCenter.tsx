/**
 * Command Center — the home screen (canon §3.3).
 *
 * Sections (top → bottom):
 *   1. Hero: greeting + "craft today" headline + live clock card (business chip)
 *   2. Role KPI strip (3 cards, configurable via /dashboards/configs; role-default fallback)
 *   3. Quick Actions bar (permission-gated shortcuts)
 *   4. Praxis Insights card — the single AI surface: shows urgent + open counts
 *      with top module offenders; two deep links: "Open in Praxis" (prefills
 *      composer asking for detail on the specific insights) and "View" (→ /insights)
 *   5. App grid (drag/pin — from AppGrid component)
 *   6. My activity (my-feed audit trail, paginated 10/page, up to 30 rows — lets
 *      the user spot activity that wasn't theirs and rotate password fast)
 *
 * Notifications live in the bell + dedicated module; they are deliberately not
 * duplicated on the home page.
 *
 * Live data from:
 *   GET /dashboards/overview
 *   GET /insights/summary
 *   GET /audit/my-feed?page=1..3
 *
 * Follows canon §6 Definition of Done: 4 states, permission-aware, entity scope,
 * MoneyText, tokens only, mobile-first.
 */

import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Sparkles,
  ShoppingBag,
  FileText,
  Boxes,
  Truck,
  Receipt,
  ArrowRight,
  CheckCircle2,
  Bell,
  X,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  Clock,
  PackageCheck,
  Star,
} from "lucide-react";
import { useGreeting } from "@/hooks/useGreeting";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useAuthStore } from "@/stores/auth";
import { useActiveBusiness } from "@/stores/business";
import { AppGrid } from "@/components/hub/AppGrid";
import {
  Card,
  KpiTile,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import {
  useDashboardOverview,
  useInsightSummary,
  useMyAuditFeed,
  urgentCount,
  openCount,
  type AuditFeedEntry,
  type InsightSummary,
} from "@/hooks/useCommandCenter";
import { money } from "@/lib/format";
import {
  requestPushPermission,
  hasPushBeenPrompted,
  markPushPrompted,
  ensurePushSubscription,
} from "@/lib/push";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function humaniseAudit(e: AuditFeedEntry): string {
  const mod = (e.module ?? "").replace(/_/g, " ");
  const act = e.action ?? "updated";
  const tbl = (e.table_name ?? "").replace(/_/g, " ");
  return `${act.charAt(0).toUpperCase()}${act.slice(1)} ${tbl || mod}`;
}

const AUDIT_ICON: Record<string, typeof CheckCircle2> = {
  create: CheckCircle2,
  update: Star,
  delete: AlertTriangle,
  approve: PackageCheck,
  export: FileText,
};

const AUDIT_TONE: Record<string, string> = {
  create: "bg-success/[0.14] text-success",
  update: "bg-info/[0.14] text-info",
  delete: "bg-danger/[0.14] text-danger",
  approve: "bg-accent/[0.14] text-accent-glow",
  export: "bg-warn/[0.14] text-warn",
};

/** Insight module → nav module key, where the two differ (identity otherwise).
 *  Feeds the App Grid urgent badges. Modules with no nav home (storefront,
 *  customer_onboarding, intercompany) are deliberately absent — their findings
 *  count toward the Insights tile only. */
const INSIGHT_NAV_KEY: Record<string, string> = {
  approvals: "orgworkflow",
  sales_campaigns: "campaigns",
  social_media: "social",
  tasks: "workspace",
  retail_partners: "retail",
  stylist_programme: "stylists",
  hr_attendance: "hr",
  storefront: "insights",
  customer_onboarding: "insights",
  intercompany: "insights",
};

/** "hr_attendance" → "Hr attendance" → readable label for the alert bar. */
function moduleLabel(key: string): string {
  const s = key.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHead({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 mt-8 mb-4">
      <h3 className="font-display text-xl font-medium">{title}</h3>
      <span className="flex-1 h-px bg-line/20" />
      {action}
    </div>
  );
}

function KpiSkeletons() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-md:gap-2.5 mb-6">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`glass rounded-[var(--radius)] p-[17px_18px] max-md:p-[12px_14px] space-y-3${i === 2 ? " col-span-2 sm:col-span-1" : ""}`}
        >
          <Skeleton className="w-24 h-3" />
          <Skeleton className="w-36 h-7 max-md:h-5" />
          <Skeleton className="w-16 h-3" />
        </div>
      ))}
    </div>
  );
}

/** Role-default KPI trios (CEO-level). Configurable via /dashboards/configs. */
function KpiStrip({
  overview,
  isCeo,
}: {
  overview: ReturnType<typeof useDashboardOverview>;
  isCeo: boolean;
}) {
  if (overview.isLoading) return <KpiSkeletons />;

  if (overview.isError) {
    // Permission denied or network error — show contained error, not full-page crash.
    return (
      <div className="glass rounded-[var(--radius)] p-4 mb-6 text-danger/80 text-sm flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        Could not load KPIs —{" "}
        {overview.error instanceof Error
          ? overview.error.message
          : "check your connection"}
        .
        <button
          onClick={() => overview.refetch()}
          className="ml-auto text-accent-glow underline underline-offset-2 text-xs"
        >
          Retry
        </button>
      </div>
    );
  }

  const d = overview.data;

  // CEO / Manager → revenue / outstanding / pending
  // Cashier / Staff → pending orders / deliveries / a lighter metric
  const tiles: {
    label: string;
    value: string;
    delta?: { up: boolean; text: string };
    tone: "accent" | "warn";
  }[] = isCeo
    ? [
        {
          label: "Revenue MTD",
          value: money(parseFloat(d?.sales.revenue_ngn ?? "0"), "NGN"),
          tone: "accent" as const,
        },
        {
          label: "Outstanding",
          value: money(parseFloat(d?.sales.outstanding_ngn ?? "0"), "NGN"),
          tone: "warn" as const,
        },
        {
          label: "Pending orders",
          value: String(d?.sales.pending_orders ?? 0),
          tone: "accent" as const,
        },
      ]
    : [
        {
          label: "Today's revenue",
          value: money(parseFloat(d?.sales.revenue_ngn ?? "0"), "NGN"),
          tone: "accent" as const,
        },
        {
          label: "Active deliveries",
          value: String(d?.operations.deliveries_active ?? 0),
          tone: "accent" as const,
        },
        {
          label: "Pending orders",
          value: String(d?.sales.pending_orders ?? 0),
          tone:
            (d?.sales.pending_orders ?? 0) > 0
              ? ("warn" as const)
              : ("accent" as const),
        },
      ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-md:gap-2.5 mb-6">
      {tiles.map((t, i) => (
        <div
          key={t.label}
          className={
            i === tiles.length - 1 ? "col-span-2 sm:col-span-1" : undefined
          }
        >
          <KpiTile
            label={t.label}
            value={t.value}
            delta={t.delta}
            tone={t.tone}
          />
        </div>
      ))}
    </div>
  );
}

/** Permission-gated quick actions strip. */
function QuickActions({ can }: { can: (m: string, a: string) => boolean }) {
  const navigate = useNavigate();
  const actions = [
    {
      label: "New Sale",
      icon: ShoppingBag,
      route: "/sales",
      module: "sales",
      action: "create",
    },
    {
      label: "New Invoice",
      icon: FileText,
      route: "/invoicing",
      module: "invoicing",
      action: "create",
    },
    {
      label: "Check Stock",
      icon: Boxes,
      route: "/stock",
      module: "stock",
      action: "view",
    },
    {
      label: "View Deliveries",
      icon: Truck,
      route: "/logistics",
      module: "logistics",
      action: "view",
    },
    {
      label: "Approve Expenses",
      icon: Receipt,
      route: "/expenses",
      module: "expenses",
      action: "approve",
    },
  ].filter((a) => can(a.module, a.action));

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 mb-6 max-md:overflow-x-auto max-md:flex-nowrap max-md:pb-2 max-md:-mx-4 max-md:px-4 hide-scrollbar">
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={() => navigate(a.route)}
          className="no-min-h inline-flex items-center gap-1.5 px-3 h-10 max-md:h-11 shrink-0 max-md:whitespace-nowrap rounded-[10px] text-[12.5px] font-semibold
            bg-text-primary/[0.05] border border-line text-text-muted
            hover:bg-accent/10 hover:border-accent/35 hover:text-accent-glow transition-all duration-200"
        >
          <a.icon className="w-3.5 h-3.5" />
          {a.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Consolidated Praxis card — replaces the twin briefing + insights bars. Shows
 * urgent + open counts with the top-3 module offenders, and offers two deep
 * links:
 *   • Open in Praxis → prefills the composer with a specific "tell me more
 *     about these urgent insights" prompt (via router state initialText).
 *   • View → jumps to the /insights list.
 * Dismissible; stacks vertically on mobile so both CTAs stay hit-target-sized.
 */
function PraxisInsightsCard({
  summary,
}: {
  summary: ReturnType<typeof useInsightSummary>;
}) {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || summary.isLoading || summary.isError) return null;

  const urgent = urgentCount(summary.data);
  const open = openCount(summary.data);
  if (urgent === 0 && open === 0) return null;

  const topModules = Object.entries(summary.data ?? {})
    .filter(([, c]) => (c?.urgent ?? 0) > 0)
    .sort((a, b) => b[1].urgent - a[1].urgent)
    .slice(0, 3);

  const otherOpen = Math.max(0, open - urgent);
  const prefill = buildPraxisPrefill(summary.data, urgent, open);

  return (
    <div className="glass rounded-[var(--radius)] p-4 md:p-[18px_20px] mb-5 border border-warn/25 bg-warn/[0.06] animate-rise-in relative overflow-hidden">
      <span
        aria-hidden
        className="pointer-events-none absolute -right-6 -top-8 w-[120px] h-[120px] rounded-full opacity-25 blur-[26px]"
        style={{
          background:
            "radial-gradient(circle, rgb(var(--warn)/0.55), transparent 70%)",
        }}
      />
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="no-min-h absolute top-2.5 right-2.5 p-1 rounded-md text-warn/60 hover:text-warn transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>

      <div className="relative flex flex-col gap-3 md:flex-row md:items-center md:gap-4 pr-6 md:pr-0">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-[13.5px] text-warn leading-snug">
              {urgent > 0 ? (
                <>
                  <b>{urgent} urgent</b> insight{urgent !== 1 ? "s" : ""} need
                  {urgent === 1 ? "s" : ""} attention
                </>
              ) : (
                <>
                  <b>{open}</b> open insight{open !== 1 ? "s" : ""}
                </>
              )}
              {urgent > 0 && otherOpen > 0 && (
                <span className="opacity-75"> · {otherOpen} other open</span>
              )}
            </div>
            {topModules.length > 0 && (
              <div className="text-[11.5px] text-warn/70 mt-1 truncate">
                {topModules
                  .map(([m, c]) => `${moduleLabel(m)} ${c.urgent}`)
                  .join(" · ")}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 md:ml-auto">
          <button
            onClick={() =>
              navigate("/praxis", { state: { initialText: prefill } })
            }
            className="no-min-h inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] text-[12px] font-semibold
              bg-accent-deep text-[#F4E9D9] hover:bg-accent transition-colors shadow-[0_4px_14px_rgb(var(--accent-deep)/0.4)]"
          >
            <Sparkles className="w-3.5 h-3.5" /> Open in Praxis
          </button>
          <button
            onClick={() => navigate("/insights")}
            className="no-min-h inline-flex items-center gap-1 h-9 px-3 rounded-[10px] text-[12px] font-semibold
              border border-warn/40 text-warn hover:bg-warn/10 transition-colors"
          >
            View <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Builds the "tell me more" prompt sent as initialText to /praxis. */
function buildPraxisPrefill(
  summary: InsightSummary | undefined,
  urgent: number,
  open: number,
): string {
  if (!summary) return "Tell me more about my open insights.";
  const top = Object.entries(summary)
    .filter(([, c]) => (c?.urgent ?? 0) > 0)
    .sort((a, b) => b[1].urgent - a[1].urgent)
    .slice(0, 3)
    .map(([m, c]) => `${moduleLabel(m)} (${c.urgent})`);
  const focus = top.length ? ` — focus on ${top.join(", ")}` : "";
  const scope =
    urgent > 0
      ? `the ${urgent} urgent insight${urgent !== 1 ? "s" : ""}`
      : `my ${open} open insight${open !== 1 ? "s" : ""}`;
  return `Give me more detail on ${scope}${focus}. What are the root causes, which records are affected, and what should I do first?`;
}


/**
 * Recent activity — the caller's own audit trail, paginated 10/page. Up to 3
 * pages (30 rows total) so the user can spot activity that wasn't theirs and
 * change their password immediately if something looks off.
 */
function ActivityFeed({
  feed,
  page,
  setPage,
}: {
  feed: ReturnType<typeof useMyAuditFeed>;
  page: number;
  setPage: (p: number) => void;
}) {
  if (feed.isLoading && !feed.data) {
    return (
      <Card className="overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3.5 p-[14px_18px] border-b hairline last:border-0"
          >
            <Skeleton
              className="w-[38px] h-[38px] rounded-[11px] shrink-0"
              style={{ height: 38 }}
            />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="w-2/3 h-3" />
              <Skeleton className="w-1/2 h-2.5" />
            </div>
          </div>
        ))}
      </Card>
    );
  }

  if (feed.isError) {
    return (
      <Card className="p-5 text-sm text-text-muted flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-warn" />
        Could not load your activity.
        <button
          onClick={() => feed.refetch()}
          className="ml-auto text-accent-glow underline text-xs"
        >
          Retry
        </button>
      </Card>
    );
  }

  const entries = feed.data?.data ?? [];
  const total = feed.data?.total ?? entries.length;
  const pageSize = feed.data?.page_size ?? 10;
  const pageCount = Math.max(1, Math.min(3, Math.ceil(total / pageSize)));

  if (entries.length === 0 && page === 1) {
    return (
      <EmptyState
        icon={<Clock className="w-7 h-7" />}
        title="No activity yet"
        message="Actions you take on the Hub will appear here."
      />
    );
  }

  return (
    <Card className="overflow-hidden">
      {entries.map((e) => {
        const Icon = AUDIT_ICON[e.action] ?? TrendingUp;
        const tone =
          AUDIT_TONE[e.action] ?? "bg-text-primary/[0.06] text-text-muted";
        return (
          <div
            key={e.log_id}
            className="flex items-center gap-3.5 p-[14px_18px] border-b hairline last:border-0 hover:bg-text-primary/[0.03] transition-colors"
          >
            <span
              className={`w-[38px] h-[38px] rounded-[11px] grid place-items-center shrink-0 ${tone}`}
            >
              <Icon className="w-[17px] h-[17px]" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-text-primary truncate">
                {humaniseAudit(e)}
              </div>
              <div className="text-[11px] text-text-faint capitalize">
                {e.module?.replace(/_/g, " ")}
              </div>
            </div>
            <div className="text-[11px] text-text-faint tabular-nums whitespace-nowrap">
              {fmtRelative(e.occurred_at)}
            </div>
          </div>
        );
      })}
      {pageCount > 1 && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t hairline bg-text-primary/[0.02]">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1 || feed.isFetching}
            className="no-min-h inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <div className="text-[11px] text-text-faint tabular-nums">
            Page {page} of {pageCount}
          </div>
          <button
            onClick={() => setPage(Math.min(pageCount, page + 1))}
            disabled={page >= pageCount || feed.isFetching}
            className="no-min-h inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[12px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </Card>
  );
}

// ── Push permission banner ────────────────────────────────────────────────────

function PushBanner() {
  const [show, setShow] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Show only once, only if the user hasn't been prompted and hasn't granted yet.
    if (
      !hasPushBeenPrompted() &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default" &&
      "serviceWorker" in navigator &&
      "PushManager" in window
    ) {
      setShow(true);
    }
  }, []);

  if (!show || done) return null;

  async function handleEnable() {
    markPushPrompted();
    const perm = await requestPushPermission();
    if (perm === "granted") await ensurePushSubscription();
    setDone(true);
    setShow(false);
  }

  function handleDismiss() {
    markPushPrompted();
    setShow(false);
  }

  return (
    <div className="glass rounded-[14px] px-4 py-3 mb-5 flex items-center gap-2.5 border border-accent/20 animate-[slide-up_0.22s_ease-out]">
      <Bell className="w-4 h-4 text-accent shrink-0" />
      <p className="flex-1 min-w-0 text-[12px] text-text-muted truncate">
        <span className="font-semibold text-text-primary">
          Enable push notifications
        </span>
        <span className="max-md:hidden"> — approvals, payments &amp; more</span>
      </p>
      <button
        onClick={handleEnable}
        className="no-min-h h-7 px-3 rounded-lg bg-accent-deep text-[#F4E9D9] text-[11px] font-semibold hover:bg-accent transition-colors shrink-0"
      >
        Enable
      </button>
      <button
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="no-min-h shrink-0 p-1 rounded-md text-text-faint hover:text-text-primary transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function CommandCenter() {
  const { time, greeting } = useGreeting();
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.can);
  const biz = useActiveBusiness();
  const isDesktop = useIsDesktop();

  // Data
  const overview = useDashboardOverview();
  const insights = useInsightSummary();
  const [activityPage, setActivityPage] = useState(1);
  const myFeed = useMyAuditFeed(activityPage);

  // Urgent-insight badges for the App Grid: one per module tile (mapped to its
  // nav key) plus the total on the Insights tile itself.
  const insightBadges = useMemo(() => {
    const out: Record<string, number> = {};
    let totalUrgent = 0;
    for (const [mod, c] of Object.entries(insights.data ?? {})) {
      const u = c?.urgent ?? 0;
      if (!u) continue;
      totalUrgent += u;
      const nav = INSIGHT_NAV_KEY[mod] ?? mod;
      if (nav !== "insights") out[nav] = (out[nav] ?? 0) + u;
    }
    if (totalUrgent > 0) out.insights = totalUrgent;
    return out;
  }, [insights.data]);

  const hh = time.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const dd = time.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  // Whether this user has access to dashboard KPIs
  const canSeeDashboard = user?.isCeo || can("dashboards", "view");
  const firstName = user?.name?.split(" ")[0] ?? user?.name ?? "";

  return (
    <div>
      {/* ── Push permission banner (first-login) ──────────────────────── */}
      <PushBanner />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      {isDesktop ? (
        <div className="flex gap-6 items-start flex-wrap mb-6">
          <div className="flex-1 min-w-[280px]">
            <div className="text-[13px] text-text-muted">
              {greeting.primary},{" "}
              <b className="text-accent-glow font-semibold">{firstName}</b>
            </div>
            <h2 className="font-display font-medium leading-[1.04] my-2.5 max-w-[14ch] text-[clamp(26px,4.2vw,44px)]">
              What would you like to{" "}
              <em className="italic text-accent-glow">craft</em> today?
            </h2>
            <div className="text-text-muted text-sm max-w-[46ch]">
              {greeting.secondary}
            </div>
          </div>
          <Card className="relative overflow-hidden w-[min(250px,100%)] p-[18px_20px] text-right">
            <span
              className="pointer-events-none absolute -right-[30px] -top-[40px] w-[140px] h-[140px] rounded-full opacity-50 blur-[22px]"
              style={{
                background: `radial-gradient(circle, color-mix(in srgb, ${biz.grad2} 40%, transparent), transparent 70%)`,
              }}
            />
            <div className="relative font-display font-medium text-[42px] leading-none tabular-nums">
              {hh}
            </div>
            <div className="relative text-text-muted text-[12.5px] mt-1.5">
              {dd}
            </div>
            <div className="relative mt-3 pt-3 border-t hairline flex items-center gap-2.5 justify-end">
              <span
                className="w-6 h-6 rounded-[7px] grid place-items-center text-white font-display font-semibold text-xs overflow-hidden"
                style={{
                  background: `linear-gradient(140deg, ${biz.grad1}, ${biz.grad2})`,
                }}
              >
                {biz.logoUrl ? (
                  <img
                    src={biz.logoUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  biz.monogram
                )}
              </span>
              <span className="font-semibold text-[12.5px]">{biz.name}</span>
            </div>
          </Card>
        </div>
      ) : (
        <div className="mb-5">
          <div className="text-[13px] text-text-muted">
            {greeting.primary},{" "}
            <b className="text-accent-glow font-semibold">{firstName}</b>
          </div>
          <h2 className="font-display font-medium leading-[1.08] my-1.5 text-[22px]">
            What would you like to{" "}
            <em className="italic text-accent-glow">craft</em> today?
          </h2>
          <div className="flex items-center gap-1.5 mt-1 text-text-muted text-[12px]">
            <span
              className="w-[18px] h-[18px] rounded-[5px] grid place-items-center text-white font-display font-semibold text-[8px] overflow-hidden shrink-0"
              style={{
                background: `linear-gradient(140deg, ${biz.grad1}, ${biz.grad2})`,
              }}
            >
              {biz.logoUrl ? (
                <img
                  src={biz.logoUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                biz.monogram
              )}
            </span>
            <span className="font-semibold text-text-primary">{biz.name}</span>
            <span className="text-text-faint">&middot;</span>
            <span className="tabular-nums">{hh}</span>
          </div>
        </div>
      )}

      {/* ── KPI strip (role-adaptive) ──────────────────────────────────── */}
      {canSeeDashboard && (
        <KpiStrip overview={overview} isCeo={user?.isCeo ?? false} />
      )}

      {/* ── Quick Actions ──────────────────────────────────────────────── */}
      <QuickActions can={can} />

      {/* ── Reordered sections: on mobile App Grid moves above the AI card ─ */}
      <div className="flex flex-col">
        {/* Single Praxis Insights card (replaces the twin briefing + alert) */}
        <div className="max-md:order-2">
          {canSeeDashboard && <PraxisInsightsCard summary={insights} />}
        </div>

        {/* App grid — promoted to first on mobile */}
        <div className="max-md:order-1">
          <SectionHead title="Your apps" />
          <AppGrid badges={insightBadges} />
        </div>

        {/* My activity — paginated (10/page, up to 3 pages). Notifications live
            in the bell + dedicated module, so they no longer show here. */}
        <div className="max-md:order-3">
          <SectionHead
            title="My activity"
            action={
              myFeed.data?.window === "24h" ? (
                <span className="micro text-text-faint">Last 24 hours</span>
              ) : (
                <span className="micro text-text-faint">Latest actions</span>
              )
            }
          />
          <ActivityFeed
            feed={myFeed}
            page={activityPage}
            setPage={setActivityPage}
          />
        </div>
      </div>
    </div>
  );
}
