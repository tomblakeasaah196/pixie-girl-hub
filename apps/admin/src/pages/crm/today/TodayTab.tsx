import { useNavigate } from "react-router-dom";
import {
  Cake,
  Heart,
  Star,
  Calendar,
  Sparkles,
  UserPlus,
  RotateCcw,
  Crown,
  BellRing,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button, Pill, Skeleton, MoneyText } from "@/components/ui/primitives";
import { toast } from "@/stores/toast";
import { toastReport } from "@/lib/error-report";
import {
  useTodayMilestones,
  useCrmToday,
  useCrmKpis,
  useTriggerWinBack,
} from "../hooks";
import type {
  TodayBuckets,
  TodayCelebrateItem,
  TodayWelcomeItem,
  TodayWinBackItem,
  TodayTopItem,
  TodayFollowUpItem,
} from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#8b9d77",
  "#7a8fa8",
  "#b76e79",
  "#9c7ad9",
  "#5aa0a8",
  "#a8785a",
];

function nameOf(item: { display_name: string | null; first_name: string | null }) {
  return item.display_name || item.first_name || "Client";
}

function nameInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function avatarColor(name: string) {
  const idx =
    Math.abs(name.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) %
    AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

function relTime(iso: string | null) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// ── KPI strip ─────────────────────────────────────────────────────────────

function KpiStrip() {
  const { data: kpis, isLoading } = useCrmKpis();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[72px] rounded-[13px]" />
        ))}
      </div>
    );
  }

  const tiles = kpis
    ? [
        {
          label: "Open pipeline",
          value: <MoneyText ngn={kpis.total_pipeline_value_ngn} />,
          sub: `${kpis.open_deals} open deals`,
        },
        {
          label: "Won this month",
          value: kpis.deals_won_this_month,
          sub: <MoneyText ngn={kpis.revenue_this_month_ngn} />,
        },
        {
          label: "Win rate",
          value: `${Math.round(kpis.win_rate_pct)}%`,
          sub: `avg ${Math.round(kpis.avg_deal_value_ngn / 1000)}k/deal`,
        },
        {
          label: "Avg close time",
          value: kpis.avg_days_to_close ? `${kpis.avg_days_to_close}d` : "—",
          sub: "to close",
        },
      ]
    : [];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="p-3 rounded-[13px] bg-text-primary/[0.04] border hairline"
        >
          <div className="micro mb-1">{t.label}</div>
          <div className="font-display text-xl tabular-nums text-text-primary">
            {t.value}
          </div>
          <div className="text-[10.5px] text-text-faint mt-0.5">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Outreach bucket card ──────────────────────────────────────────────────

function BucketCard({
  icon: Icon,
  title,
  subtitle,
  count,
  iconColor,
  isEmpty,
  children,
}: {
  icon: typeof Cake;
  title: string;
  subtitle: string;
  count: number;
  iconColor: string;
  isEmpty: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="p-3.5 rounded-[14px] bg-text-primary/[0.03] border hairline flex flex-col min-h-[150px]">
      <div className="flex items-start gap-2.5 mb-3">
        <div
          className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0"
          style={{ backgroundColor: `${iconColor}1e`, color: iconColor }}
        >
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="micro text-text-muted">{title}</div>
          <div className="text-[10.5px] text-text-faint truncate">
            {subtitle}
          </div>
        </div>
        <span className="font-display text-xl tabular-nums text-text-primary leading-none">
          {count}
        </span>
      </div>
      {isEmpty ? (
        <div className="flex-1 grid place-items-center text-[11.5px] italic text-text-faint py-3">
          Nothing waiting — all caught up.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">{children}</div>
      )}
    </div>
  );
}

function BucketRow({
  name,
  meta,
  trailing,
  onClick,
}: {
  name: string;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2.5 p-2 rounded-[10px] hover:bg-text-primary/[0.05] transition-colors cursor-pointer group"
    >
      <div
        className="w-7 h-7 rounded-full grid place-items-center text-[10px] font-semibold text-white font-display flex-shrink-0"
        style={{ background: avatarColor(name) }}
      >
        {nameInitials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-text-primary truncate">
          {name}
        </div>
        {meta && (
          <div className="text-[10.5px] text-text-faint truncate">{meta}</div>
        )}
      </div>
      {trailing}
      <ChevronRight className="w-3.5 h-3.5 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </div>
  );
}

// ── Bucket grid (the Orika-style "who to reach out to" row) ──────────────

const PREVIEW = 3;

function BucketGrid({ data }: { data: TodayBuckets }) {
  const navigate = useNavigate();
  const winBack = useTriggerWinBack();

  const openClient = (id: string) => navigate(`/crm/clients/${id}`);

  function fireWinBack(item: TodayWinBackItem) {
    winBack.mutate(item.contact_id, {
      onSuccess: ({ enrolled }) => {
        if (enrolled > 0) {
          toast.success(
            `${nameOf(item)} enrolled in ${enrolled} win-back ${enrolled === 1 ? "journey" : "journeys"}.`,
          );
        } else {
          toast.error("No active win-back strategy", {
            description:
              "Activate one in Retention → Strategies, then try again.",
          });
        }
      },
      onError: (err) => toastReport("CRM → Today", "Trigger win-back", err),
    });
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
      <BucketCard
        icon={Cake}
        title="To celebrate"
        subtitle="Birthdays this week"
        count={data.to_celebrate.total}
        iconColor="#d4a853"
        isEmpty={data.to_celebrate.items.length === 0}
      >
        {data.to_celebrate.items.slice(0, PREVIEW).map((c: TodayCelebrateItem) => (
          <BucketRow
            key={c.contact_id}
            name={nameOf(c)}
            meta={
              <>
                🎂{" "}
                {new Date(c.date_of_birth).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                })}
              </>
            }
            onClick={() => openClient(c.contact_id)}
          />
        ))}
      </BucketCard>

      <BucketCard
        icon={UserPlus}
        title="To welcome"
        subtitle="New clients, every source"
        count={data.to_welcome.total}
        iconColor="#8b9d77"
        isEmpty={data.to_welcome.items.length === 0}
      >
        {data.to_welcome.items.slice(0, PREVIEW).map((c: TodayWelcomeItem) => (
          <BucketRow
            key={c.contact_id}
            name={nameOf(c)}
            meta={
              <>
                joined {relTime(c.created_at)}
                {c.source && ` · via ${c.source.replace(/_/g, " ")}`}
              </>
            }
            onClick={() => openClient(c.contact_id)}
          />
        ))}
      </BucketCard>

      <BucketCard
        icon={RotateCcw}
        title="To win back"
        subtitle="Gone quiet — call them"
        count={data.to_win_back.total}
        iconColor="#e5544e"
        isEmpty={data.to_win_back.items.length === 0}
      >
        {data.to_win_back.items.slice(0, PREVIEW).map((c: TodayWinBackItem) => (
          <BucketRow
            key={c.contact_id}
            name={nameOf(c)}
            meta={
              c.days_since_last_order != null
                ? `${c.days_since_last_order}d silent`
                : "at risk"
            }
            trailing={
              <button
                type="button"
                title="Trigger win-back journey"
                disabled={winBack.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  fireWinBack(c);
                }}
                className="px-2 h-[24px] rounded-[7px] text-[10px] font-semibold bg-accent/10 text-accent hover:bg-accent/20 transition-colors flex-shrink-0 disabled:opacity-50"
              >
                {winBack.isPending ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  "Win back"
                )}
              </button>
            }
            onClick={() => openClient(c.contact_id)}
          />
        ))}
      </BucketCard>

      <BucketCard
        icon={Crown}
        title="Top this month"
        subtitle="Deserve extra attention"
        count={data.top_this_month.total}
        iconColor="#9c7ad9"
        isEmpty={data.top_this_month.items.length === 0}
      >
        {data.top_this_month.items.slice(0, PREVIEW).map((c: TodayTopItem) => (
          <BucketRow
            key={c.contact_id}
            name={nameOf(c)}
            meta={
              <span className="font-mono">
                <MoneyText ngn={parseFloat(c.spend_this_month_ngn)} /> ·{" "}
                {c.orders_this_month} order{c.orders_this_month === 1 ? "" : "s"}
              </span>
            }
            onClick={() => openClient(c.contact_id)}
          />
        ))}
      </BucketCard>

      <BucketCard
        icon={BellRing}
        title="Follow-ups"
        subtitle="Quiet deals need a nudge"
        count={data.follow_ups.total}
        iconColor="#c9a24b"
        isEmpty={data.follow_ups.items.length === 0}
      >
        {data.follow_ups.items.slice(0, PREVIEW).map((d: TodayFollowUpItem) => (
          <BucketRow
            key={d.deal_id}
            name={d.title}
            meta={
              <>
                {d.display_name ?? d.deal_number} · quiet since{" "}
                {relTime(d.quiet_since)}
              </>
            }
            onClick={() => navigate(`/crm/deals/${d.deal_id}`)}
          />
        ))}
      </BucketCard>
    </div>
  );
}

// ── Main Today tab ────────────────────────────────────────────────────────

const EVENT_ICONS = {
  birthday: Cake,
  wedding_anniversary: Heart,
  business_anniversary: Star,
  graduation: Star,
  other: Calendar,
};

const EVENT_LABELS: Record<string, string> = {
  birthday: "Birthday",
  wedding_anniversary: "Wedding Anniversary",
  business_anniversary: "Business Anniversary",
  graduation: "Graduation",
  other: "Milestone",
};

export function TodayTab() {
  const navigate = useNavigate();
  const { data: today, isLoading, isError, refetch } = useCrmToday();
  const { data: milestones = [] } = useTodayMilestones();

  const todayMs = milestones.filter((m) => m.days_until === 0);

  return (
    <div className="animate-fade-in">
      <KpiStrip />

      {/* Who to reach out to */}
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span className="micro text-text-muted">
          Today — who to reach out to
        </span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[150px] rounded-[14px]" />
          ))}
        </div>
      ) : isError ? (
        <div className="p-6 rounded-[14px] bg-text-primary/[0.03] border hairline text-center mb-6">
          <p className="text-[12.5px] text-text-muted mb-3">
            Couldn't load today's outreach buckets.
          </p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : today ? (
        <BucketGrid data={today} />
      ) : null}

      {/* Today's milestones (richer event types than birthdays) */}
      {todayMs.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full grid place-items-center bg-warn/15 text-warn">
              <Cake className="w-3 h-3" />
            </div>
            <span className="text-[13px] font-semibold text-text-primary">
              Today 🎉
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {todayMs.map((m) => {
              const EventIcon = EVENT_ICONS[m.event_type] ?? Calendar;
              return (
                <div
                  key={`${m.contact_id}-${m.event_date}`}
                  onClick={() => navigate(`/crm/clients/${m.contact_id}`)}
                  className="flex items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.03] border hairline hover:bg-text-primary/[0.06] transition-colors cursor-pointer"
                >
                  <div
                    className="w-9 h-9 rounded-full grid place-items-center text-[12px] font-semibold text-white font-display flex-shrink-0"
                    style={{ background: avatarColor(m.display_name) }}
                  >
                    {nameInitials(m.display_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-text-primary truncate">
                        {m.display_name}
                      </span>
                      {m.priority_level === "vip" && (
                        <Pill tone="accent" dot={false}>
                          VIP
                        </Pill>
                      )}
                    </div>
                    <div className="text-[11px] text-text-faint mt-0.5 flex items-center gap-1">
                      <EventIcon className="w-3 h-3" />
                      {EVENT_LABELS[m.event_type] ?? m.event_type}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-text-faint" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AI tip */}
      <div className="flex items-start gap-2 p-3 rounded-[12px] bg-accent/[0.05] border border-accent/15 mt-2">
        <Sparkles className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
        <p className="text-[11.5px] text-accent/80 leading-relaxed">
          Open any client to see their full 360 — purchases, loyalty, churn
          risk — or any deal for Praxis AI summaries and next-action
          suggestions.
        </p>
      </div>
    </div>
  );
}
