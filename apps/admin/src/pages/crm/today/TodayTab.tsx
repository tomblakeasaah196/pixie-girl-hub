import { useNavigate } from "react-router-dom";
import {
  Cake,
  Heart,
  Star,
  Calendar,
  Users,
  AlertTriangle,
  Sparkles,
  MessageCircle,
  Phone,
  ChevronRight,
  Clock,
} from "lucide-react";
import { Button, Pill, Skeleton, MoneyText } from "@/components/ui/primitives";
import {
  useTodayMilestones,
  useTodayNewContacts,
  useTodayStaleDeals,
  useCrmKpis,
} from "../hooks";

// ── Helpers ───────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#8b9d77", "#7a8fa8", "#b76e79", "#9c7ad9", "#5aa0a8", "#a8785a"];

function nameInitials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function avatarColor(name: string) {
  const idx = Math.abs(name.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % AVATAR_COLORS.length;
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
        <div key={t.label} className="p-3 rounded-[13px] bg-text-primary/[0.04] border hairline">
          <div className="micro mb-1">{t.label}</div>
          <div className="font-display text-xl tabular-nums text-text-primary">{t.value}</div>
          <div className="text-[10.5px] text-text-faint mt-0.5">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Section container ─────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  count,
  iconColor,
  children,
  isEmpty,
  emptyText,
}: {
  icon: typeof Cake;
  title: string;
  count?: number;
  iconColor: string;
  children: React.ReactNode;
  isEmpty?: boolean;
  emptyText?: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-6 h-6 rounded-full grid place-items-center flex-shrink-0"
          style={{ backgroundColor: `${iconColor}22`, color: iconColor }}
        >
          <Icon className="w-3 h-3" />
        </div>
        <span className="text-[13px] font-semibold text-text-primary">{title}</span>
        {count !== undefined && (
          <span className="ml-auto text-[11px] text-text-faint">{count} total</span>
        )}
      </div>
      {isEmpty ? (
        <div className="py-4 text-center text-[12px] text-text-faint">{emptyText}</div>
      ) : (
        children
      )}
    </div>
  );
}

// ── Contact row (reusable) ────────────────────────────────────────────────

function ContactRow({
  contactId: _contactId,
  name,
  priority,
  phone,
  whatsapp,
  meta,
  onClick,
}: {
  contactId: string;
  name: string;
  priority: string;
  phone?: string | null;
  whatsapp?: string | null;
  meta?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.03] border hairline hover:bg-text-primary/[0.06] transition-colors cursor-pointer group"
    >
      <div
        className="w-9 h-9 rounded-full grid place-items-center text-[12px] font-semibold text-white font-display flex-shrink-0"
        style={{ background: avatarColor(name) }}
      >
        {nameInitials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-text-primary truncate">{name}</span>
          {priority === "vip" && <Pill tone="accent" dot={false}>VIP</Pill>}
        </div>
        {meta && <div className="text-[11px] text-text-faint mt-0.5">{meta}</div>}
      </div>
      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {whatsapp && (
          <a
            href={`https://wa.me/${whatsapp.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="w-7 h-7 grid place-items-center rounded-[8px] bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </a>
        )}
        {phone && !whatsapp && (
          <a
            href={`tel:${phone}`}
            onClick={(e) => e.stopPropagation()}
            className="w-7 h-7 grid place-items-center rounded-[8px] bg-text-primary/[0.08] text-text-muted hover:text-text-primary transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
          </a>
        )}
        <ChevronRight className="w-4 h-4 text-text-faint" />
      </div>
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
  const { data: milestones = [], isLoading: loadMilestones } = useTodayMilestones();
  const { data: newContacts = [], isLoading: loadNew } = useTodayNewContacts();
  const { data: staleDeals = [], isLoading: loadStale } = useTodayStaleDeals(14);

  const todayMs = milestones.filter((m) => m.days_until === 0);
  const upcomingMs = milestones.filter((m) => m.days_until > 0);

  function openContact(id: string) { navigate(`/contacts?open=${id}`); }

  return (
    <div className="animate-fade-in">
      <KpiStrip />

      {/* Today's milestones */}
      {todayMs.length > 0 && (
        <Section icon={Cake} title="Today 🎉" iconColor="#d4a853" count={todayMs.length}>
          <div className="flex flex-col gap-2">
            {todayMs.map((m) => {
              const EventIcon = EVENT_ICONS[m.event_type] ?? Calendar;
              return (
                <ContactRow
                  key={`${m.contact_id}-${m.event_date}`}
                  contactId={m.contact_id}
                  name={m.display_name}
                  priority={m.priority_level}
                  whatsapp={m.whatsapp_number}
                  phone={m.primary_phone}
                  meta={
                    <span className="flex items-center gap-1">
                      <EventIcon className="w-3 h-3" />
                      {EVENT_LABELS[m.event_type] ?? m.event_type}
                    </span>
                  }
                  onClick={() => openContact(m.contact_id)}
                />
              );
            })}
          </div>
        </Section>
      )}

      {/* Upcoming milestones */}
      <Section
        icon={Calendar}
        title="Upcoming milestones"
        iconColor="#9c7ad9"
        count={upcomingMs.length}
        isEmpty={!loadMilestones && upcomingMs.length === 0}
        emptyText="No milestones in the next 7 days"
      >
        {loadMilestones ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[54px] rounded-[12px] mb-2" />
          ))
        ) : (
          <div className="flex flex-col gap-2">
            {upcomingMs.slice(0, 8).map((m) => {
              const EventIcon = EVENT_ICONS[m.event_type] ?? Calendar;
              const daysLabel = m.days_until === 1 ? "Tomorrow" : `In ${m.days_until} days`;
              return (
                <ContactRow
                  key={`${m.contact_id}-${m.event_date}`}
                  contactId={m.contact_id}
                  name={m.display_name}
                  priority={m.priority_level}
                  whatsapp={m.whatsapp_number}
                  phone={m.primary_phone}
                  meta={
                    <span className="flex items-center gap-1">
                      <EventIcon className="w-3 h-3" />
                      {EVENT_LABELS[m.event_type]} · {daysLabel}
                    </span>
                  }
                  onClick={() => openContact(m.contact_id)}
                />
              );
            })}
          </div>
        )}
        {upcomingMs.length > 8 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full justify-center"
            onClick={() => navigate("/contacts/milestones")}
          >
            View all {upcomingMs.length} milestones
          </Button>
        )}
      </Section>

      {/* New contacts to welcome */}
      <Section
        icon={Users}
        title="New contacts to welcome"
        iconColor="#8b9d77"
        count={newContacts.length}
        isEmpty={!loadNew && newContacts.length === 0}
        emptyText="No new contacts in the last 7 days"
      >
        {loadNew ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[54px] rounded-[12px] mb-2" />
          ))
        ) : (
          <div className="flex flex-col gap-2">
            {newContacts.slice(0, 8).map((c) => (
              <ContactRow
                key={c.contact_id}
                contactId={c.contact_id}
                name={c.display_name}
                priority={c.priority_level}
                whatsapp={c.whatsapp_number}
                phone={c.primary_phone}
                meta={
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Joined {relTime(c.created_at)}
                    {c.source && ` · ${c.source.replace(/_/g, " ")}`}
                  </span>
                }
                onClick={() => openContact(c.contact_id)}
              />
            ))}
          </div>
        )}
      </Section>

      {/* Stale deals */}
      <Section
        icon={AlertTriangle}
        title="Stale deals — needs attention"
        iconColor="#d4a853"
        count={staleDeals.length}
        isEmpty={!loadStale && staleDeals.length === 0}
        emptyText="No stale deals — all deals have recent activity!"
      >
        {loadStale ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[60px] rounded-[12px] mb-2" />
          ))
        ) : (
          <div className="flex flex-col gap-2">
            {staleDeals.slice(0, 8).map((d) => {
              const daysSince = d.last_activity_at
                ? Math.floor((Date.now() - new Date(d.last_activity_at).getTime()) / 86_400_000)
                : null;
              return (
                <div
                  key={d.deal_id}
                  onClick={() => navigate(`/crm/deals/${d.deal_id}`)}
                  className="flex items-center gap-3 p-3 rounded-[12px] bg-warn/[0.04] border border-warn/20 hover:bg-warn/[0.08] transition-colors cursor-pointer group"
                >
                  <AlertTriangle className="w-4 h-4 text-warn flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-text-primary truncate">
                      {d.title}
                    </div>
                    <div className="text-[11px] text-text-faint mt-0.5">
                      {d.deal_number}
                      {d.contact_name && ` · ${d.contact_name}`}
                      {d.current_stage_name && ` · ${d.current_stage_name}`}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {d.expected_value_ngn && (
                      <span className="text-[11px] font-mono text-text-muted">
                        <MoneyText ngn={parseFloat(d.expected_value_ngn)} />
                      </span>
                    )}
                    {daysSince !== null && (
                      <Pill tone="warn" dot={false}>{daysSince}d idle</Pill>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* AI tip */}
      <div className="flex items-start gap-2 p-3 rounded-[12px] bg-accent/[0.05] border border-accent/15 mt-2">
        <Sparkles className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
        <p className="text-[11.5px] text-accent/80 leading-relaxed">
          Open any deal to get Praxis AI deal summaries, next-action suggestions, and win-back
          message drafts.
        </p>
      </div>
    </div>
  );
}
