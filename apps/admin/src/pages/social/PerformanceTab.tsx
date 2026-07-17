import { useState } from "react";
import { TrendingUp, Star } from "lucide-react";
import { Card, Skeleton, Pill, type Tone } from "@/components/ui/primitives";
import {
  usePerformance,
  currentMonth,
  expectedPostsInMonth,
  PLATFORM_ORDER,
  PLATFORM_UI,
  type SocialPlatform,
} from "@/lib/social-api";
import { MonthPicker } from "./parts";

/** The permanent cadence, encoded once: Instagram must hit 6/week; the rest
 *  aim for 6 but 4/week is the acceptable floor. Sunday is always off, so the
 *  monthly goal is the month's non-Sunday count. */
function targets(year: number, monthIdx: number, platform: SocialPlatform) {
  const goal = expectedPostsInMonth(year, monthIdx); // 6/week
  const floor = platform === "instagram" ? goal : Math.round((goal * 4) / 6); // 4/week
  return { goal, floor };
}

function statusFor(received: number, goal: number, floor: number): { tone: Tone; label: string } {
  if (received >= goal) return { tone: "success", label: "On track" };
  if (received >= floor) return { tone: "warn", label: "Acceptable" };
  return { tone: "danger", label: "Behind" };
}

export function PerformanceTab() {
  const [month, setMonth] = useState(currentMonth());
  const [y, m] = month.split("-").map(Number);
  const year = y;
  const monthIdx = m - 1;

  const perfQ = usePerformance(month);
  const posted = new Map<string, number>();
  for (const r of perfQ.data ?? []) posted.set(r.platform, r.posted_count);

  const totalReceived = PLATFORM_ORDER.reduce((s, p) => s + (posted.get(p) ?? 0), 0);
  const totalGoal = PLATFORM_ORDER.reduce((s, p) => s + targets(year, monthIdx, p).goal, 0);
  const totalPct = Math.min(100, Math.round((totalReceived / Math.max(1, totalGoal)) * 100));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthPicker value={month} onChange={setMonth} />
        <span className="text-[11.5px] text-text-faint">6 posts / week · Sunday off</span>
      </div>

      {/* Month headline */}
      <Card className="p-4 sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="micro">Links received this month</div>
            <div className="mt-1 font-display text-[34px] font-medium leading-none tabular-nums">
              {perfQ.isLoading ? "—" : totalReceived}
              <span className="ml-1 text-[16px] text-text-faint">/ {totalGoal}</span>
            </div>
          </div>
          <div className={`text-right ${totalPct >= 100 ? "text-success" : totalPct >= 66 ? "text-warn" : "text-danger"}`}>
            <TrendingUp className="ml-auto h-5 w-5" />
            <div className="mt-1 font-display text-[20px] tabular-nums">{perfQ.isLoading ? "—" : `${totalPct}%`}</div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-text-primary/[0.07]">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${perfQ.isLoading ? 0 : totalPct}%` }}
          />
        </div>
      </Card>

      {/* Per-platform */}
      {perfQ.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton style={{ height: 76 }} />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PLATFORM_ORDER.map((p) => {
            const received = posted.get(p) ?? 0;
            const { goal, floor } = targets(year, monthIdx, p);
            const status = statusFor(received, goal, floor);
            const pct = Math.min(100, Math.round((received / Math.max(1, goal)) * 100));
            const ui = PLATFORM_UI[p];
            const isMain = p === "instagram";
            return (
              <Card key={p} className="p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="grid h-7 w-7 place-items-center rounded-lg font-display text-[11px] font-semibold text-white"
                      style={{ background: ui.color }}
                    >
                      {ui.glyph}
                    </span>
                    <span className="font-display text-[15px]">{ui.label}</span>
                    {isMain && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent/[0.12] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-accent-glow">
                        <Star className="h-2.5 w-2.5 fill-current" /> Main
                      </span>
                    )}
                  </div>
                  <Pill tone={status.tone}>{status.label}</Pill>
                </div>

                <div className="flex items-baseline gap-1.5">
                  <span className="font-display text-[26px] font-medium tabular-nums">{received}</span>
                  <span className="text-[12.5px] text-text-faint">of {goal} expected</span>
                </div>

                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-text-primary/[0.07]">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${pct}%`, background: status.tone === "danger" ? "rgb(var(--danger))" : status.tone === "warn" ? "rgb(var(--warn))" : "rgb(var(--success))" }}
                  />
                </div>

                <div className="mt-2 text-[11px] text-text-faint">
                  {isMain
                    ? "Must hit 6 posts / week"
                    : `Floor ${floor} (4 / week) · goal ${goal} (6 / week)`}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
