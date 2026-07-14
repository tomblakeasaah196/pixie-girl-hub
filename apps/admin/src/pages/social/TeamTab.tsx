import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { Card, Skeleton, EmptyState, Pill } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import {
  useTeam,
  useCreatorDrilldown,
  currentMonth,
  PLATFORM_META,
  STATUS_TONE,
  STATUS_LABEL,
  type TeamRow,
} from "@/lib/social-api";
import { formatDate } from "@/lib/format";
import { MonthPicker } from "./parts";

interface PersonSummary {
  user_id: string;
  display_name: string;
  posted: number;
  flagged: number;
  onTimeTotal: number;
  onTimeCount: number;
  attainmentSum: number;
  attainmentN: number;
  rows: TeamRow[];
}

function aggregate(rows: TeamRow[]): PersonSummary[] {
  const byUser = new Map<string, PersonSummary>();
  for (const r of rows) {
    const cur = byUser.get(r.user_id) ?? {
      user_id: r.user_id,
      display_name: r.display_name,
      posted: 0,
      flagged: 0,
      onTimeTotal: 0,
      onTimeCount: 0,
      attainmentSum: 0,
      attainmentN: 0,
      rows: [],
    };
    cur.posted += r.posted_count;
    cur.flagged += r.flagged_count;
    cur.onTimeTotal += r.on_time_count;
    cur.onTimeCount += r.posted_count;
    if (r.attainment_pct !== null) {
      cur.attainmentSum += r.attainment_pct;
      cur.attainmentN += 1;
    }
    cur.rows.push(r);
    byUser.set(r.user_id, cur);
  }
  return [...byUser.values()].sort((a, b) => b.posted - a.posted);
}

export function TeamTab() {
  const [month, setMonth] = useState(currentMonth());
  const teamQ = useTeam(month);
  const people = useMemo(() => aggregate(teamQ.data ?? []), [teamQ.data]);
  const [focused, setFocused] = useState<PersonSummary | null>(null);

  return (
    <div className="space-y-4">
      <MonthPicker value={month} onChange={setMonth} />

      {teamQ.isLoading ? (
        <Card className="p-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} style={{ height: 44 }} />
          ))}
        </Card>
      ) : people.length === 0 ? (
        <EmptyState icon={<Users className="w-7 h-7" />} title="No activity yet" message="Once posts are planned this month, the team leaderboard fills in here." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="grid grid-cols-[1fr_70px_70px_90px_70px] gap-2 px-4 py-2 text-[10.5px] uppercase tracking-widest text-text-faint border-b border-line">
            <div>Creator</div>
            <div className="text-right">Posted</div>
            <div className="text-right">On-time</div>
            <div className="text-right">Attainment</div>
            <div className="text-right">Flagged</div>
          </div>
          {people.map((p, i) => {
            const onTimePct = p.onTimeCount ? Math.round((p.onTimeTotal / p.onTimeCount) * 100) : null;
            const attainmentPct = p.attainmentN ? Math.round(p.attainmentSum / p.attainmentN) : null;
            return (
              <button
                key={p.user_id}
                onClick={() => setFocused(p)}
                className={`w-full grid grid-cols-[1fr_70px_70px_90px_70px] gap-2 px-4 py-3 items-center text-left hover:bg-text-primary/[0.03] ${
                  i < people.length - 1 ? "border-b border-line" : ""
                }`}
              >
                <span className="text-[13px] font-medium truncate">{p.display_name}</span>
                <span className="text-[13px] text-right tabular-nums">{p.posted}</span>
                <span className="text-[13px] text-right tabular-nums">{onTimePct !== null ? `${onTimePct}%` : "—"}</span>
                <span className="text-[13px] text-right tabular-nums">{attainmentPct !== null ? `${attainmentPct}%` : "—"}</span>
                <span className={`text-[13px] text-right tabular-nums ${p.flagged > 0 ? "text-danger" : ""}`}>
                  {p.flagged}
                </span>
              </button>
            );
          })}
        </Card>
      )}

      {focused && <PersonDrilldown person={focused} month={month} onClose={() => setFocused(null)} />}
    </div>
  );
}

function PersonDrilldown({
  person,
  month,
  onClose,
}: {
  person: PersonSummary;
  month: string;
  onClose: () => void;
}) {
  const postsQ = useCreatorDrilldown(person.user_id, month);
  const posts = postsQ.data ?? [];

  return (
    <Drawer open onClose={onClose} title={person.display_name} subtitle={`${person.posted} posted this month`}>
      <div className="space-y-4 p-1">
        <div className="flex flex-wrap gap-1.5">
          {person.rows.map((r) => (
            <Pill key={r.platform} tone="neutral">
              {PLATFORM_META[r.platform]?.label}: {r.posted_count}
              {r.target_count !== null ? `/${r.target_count}` : ""}
            </Pill>
          ))}
        </div>
        {postsQ.isLoading ? (
          <Skeleton style={{ height: 120 }} />
        ) : posts.length === 0 ? (
          <p className="text-[12.5px] text-text-faint italic">Nothing this month.</p>
        ) : (
          <div className="rounded-[11px] border border-line divide-y divide-line overflow-hidden">
            {posts.map((p) => (
              <div key={p.post_id} className="px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12.5px] truncate">
                    {PLATFORM_META[p.platform]?.label} · {p.caption?.slice(0, 36) || p.post_type}
                  </div>
                  {p.scheduled_for && (
                    <div className="text-[11px] text-text-faint">{formatDate(p.scheduled_for)}</div>
                  )}
                </div>
                <Pill tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Pill>
              </div>
            ))}
          </div>
        )}
      </div>
    </Drawer>
  );
}
