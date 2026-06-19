import { useState } from "react";
import { Calendar, Cake, Heart, Star, ChevronRight, Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useBusinessStore } from "@/stores/business";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button, Pill, Skeleton, type Tone } from "@/components/ui/primitives";
import * as contactsApi from "./api";

// ── Types ────────────────────────────────────────────────────────────────

export interface Milestone {
  contact_id: string;
  display_name: string;
  priority_level: "vip" | "regular" | "new";
  event_type:
    | "birthday"
    | "wedding_anniversary"
    | "business_anniversary"
    | "graduation"
    | "other";
  event_date: string;
  days_until: number;
  primary_phone: string | null;
  whatsapp_number: string | null;
}

type DaysWindow = 7 | 30 | 60 | 90;

const EVENT_ICONS: Record<string, typeof Cake> = {
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

const PRIORITY_TONE: Record<string, Tone> = {
  vip: "accent",
  regular: "neutral",
  new: "info",
};

function daysLabel(days: number): { text: string; tone: Tone } {
  if (days === 0) return { text: "Today! 🎉", tone: "success" };
  if (days === 1) return { text: "Tomorrow", tone: "warn" };
  if (days <= 7) return { text: `In ${days} days`, tone: "warn" };
  return { text: `In ${days} days`, tone: "neutral" };
}

function groupByMonth(milestones: Milestone[]) {
  const groups: Record<string, Milestone[]> = {};
  for (const m of milestones) {
    const d = new Date(m.event_date);
    const key = d.toLocaleDateString("en-NG", {
      month: "long",
      year: "numeric",
    });
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }
  return groups;
}

const AVATAR_COLORS = [
  "#8b9d77",
  "#7a8fa8",
  "#b76e79",
  "#9c7ad9",
  "#5aa0a8",
  "#a8785a",
];

function nameInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

// ── Main page ─────────────────────────────────────────────────────────────

export function MilestonesPage() {
  useBreadcrumbs([
    { label: "Contacts", href: "/contacts" },
    { label: "Milestones" },
  ]);
  const navigate = useNavigate();
  const biz = useBusinessStore((s) => s.activeKey);
  const [daysWindow, setDaysWindow] = useState<DaysWindow>(30);
  const [filter, setFilter] = useState<"all" | "birthday" | "vip">("all");

  const { data: milestones = [], isLoading } = useQuery({
    queryKey: ["contacts", biz, "milestones", daysWindow],
    queryFn: () => contactsApi.listUpcomingMilestones({ days: daysWindow }),
  });

  const filtered = milestones.filter((m) => {
    if (filter === "birthday") return m.event_type === "birthday";
    if (filter === "vip") return m.priority_level === "vip";
    return true;
  });

  const grouped = groupByMonth(filtered);
  const total = filtered.length;
  const today = filtered.filter((m) => m.days_until === 0).length;
  const thisWeek = filtered.filter(
    (m) => m.days_until > 0 && m.days_until <= 7,
  ).length;
  const vipCount = filtered.filter((m) => m.priority_level === "vip").length;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1">
          <h1 className="font-display text-2xl text-text-primary">
            Milestones
          </h1>
          <p className="text-[12px] text-text-faint mt-0.5">
            Upcoming birthdays & anniversaries across all contacts
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<Bell className="w-3.5 h-3.5" />}
          onClick={() => navigate("/settings/notifications")}
        >
          Reminder settings
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total upcoming", value: total, tone: "accent" as Tone },
          { label: "Today", value: today, tone: "danger" as Tone },
          { label: "This week", value: thisWeek, tone: "warn" as Tone },
          { label: "VIP", value: vipCount, tone: "accent" as Tone },
        ].map(({ label, value, tone }) => (
          <div
            key={label}
            className="p-3 rounded-[13px] bg-text-primary/[0.04] border hairline"
          >
            <div className="micro mb-1">{label}</div>
            <div className={`font-display text-2xl tabular-nums text-${tone}`}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-5">
        {/* Days window */}
        <div className="flex gap-1 p-1 rounded-[10px] bg-text-primary/[0.04] border hairline">
          {([7, 30, 60, 90] as DaysWindow[]).map((d) => (
            <button
              key={d}
              onClick={() => setDaysWindow(d)}
              className={[
                "px-3 h-[28px] rounded-[8px] text-[12px] font-semibold transition-all",
                daysWindow === d
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {d}d
            </button>
          ))}
        </div>

        {/* Type filter */}
        <div className="flex gap-1 p-1 rounded-[10px] bg-text-primary/[0.04] border hairline">
          {(
            [
              { key: "all", label: "All" },
              { key: "birthday", label: "Birthdays" },
              { key: "vip", label: "VIP only" },
            ] as { key: typeof filter; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={[
                "px-3 h-[28px] rounded-[8px] text-[12px] font-semibold transition-all",
                filter === key
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-[12px]" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && (
        <div className="py-16 text-center">
          <Calendar className="w-10 h-10 text-text-faint mx-auto mb-3" />
          <div className="text-[14px] font-semibold text-text-primary mb-1">
            No milestones in the next {daysWindow} days
          </div>
          <p className="text-[12px] text-text-faint">
            Add birthdays to contact profiles to see them here.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => navigate("/contacts")}
          >
            Back to Contacts
          </Button>
        </div>
      )}

      {/* Grouped list */}
      {!isLoading && filtered.length > 0 && (
        <div className="flex flex-col gap-6">
          {Object.entries(grouped).map(([month, items]) => (
            <div key={month}>
              <div className="micro mb-3">{month}</div>
              <div className="flex flex-col gap-2">
                {items.map((m) => {
                  const { text: daysText, tone: daysTone } = daysLabel(
                    m.days_until,
                  );
                  const EventIcon = EVENT_ICONS[m.event_type] ?? Calendar;
                  const colorIdx =
                    Math.abs(
                      m.display_name
                        .split("")
                        .reduce((a, c) => a + c.charCodeAt(0), 0),
                    ) % AVATAR_COLORS.length;

                  return (
                    <div
                      key={`${m.contact_id}-${m.event_date}`}
                      className="flex items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.03] border hairline hover:bg-text-primary/[0.06] transition-colors cursor-pointer group"
                      onClick={() => navigate(`/contacts?open=${m.contact_id}`)}
                    >
                      {/* Avatar */}
                      <div
                        className="w-10 h-10 rounded-full grid place-items-center text-sm font-semibold text-white font-display flex-shrink-0"
                        style={{ background: AVATAR_COLORS[colorIdx] }}
                      >
                        {nameInitials(m.display_name)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-text-primary truncate">
                            {m.display_name}
                          </span>
                          {m.priority_level === "vip" && (
                            <Pill
                              tone={PRIORITY_TONE[m.priority_level]}
                              dot={false}
                            >
                              VIP
                            </Pill>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <EventIcon className="w-3 h-3 text-text-faint" />
                          <span className="text-[11.5px] text-text-muted">
                            {EVENT_LABELS[m.event_type] ?? m.event_type}
                          </span>
                          <span className="text-text-faint">·</span>
                          <span className="text-[11px] text-text-faint">
                            {new Date(m.event_date).toLocaleDateString(
                              "en-NG",
                              {
                                day: "numeric",
                                month: "short",
                              },
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Days badge + quick actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Pill tone={daysTone} dot={false}>
                          {daysText}
                        </Pill>

                        {/* WhatsApp quick reach */}
                        {m.whatsapp_number && (
                          <a
                            href={`https://wa.me/${m.whatsapp_number.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="w-8 h-8 grid place-items-center rounded-[8px] bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            <svg
                              className="w-4 h-4"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                          </a>
                        )}

                        <ChevronRight className="w-4 h-4 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
