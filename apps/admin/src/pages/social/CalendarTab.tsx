import { useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, Skeleton } from "@/components/ui/primitives";
import {
  usePosts,
  useSocialAccounts,
  buildPlatformLooks,
  registeredPlatforms,
  lookFor,
  monthGrid,
  monthWindow,
  dayKey,
  sameDay,
  isSunday,
  expectedPostsInMonth,
  MONTH_NAMES,
  DAY_NAMES,
  type SocialPost,
} from "@/lib/social-api";
import { DaySheet } from "./DaySheet";

export function CalendarTab() {
  const [cursor, setCursor] = useState(() => new Date());
  const [openDay, setOpenDay] = useState<Date | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const { from, to } = useMemo(() => monthWindow(year, month), [year, month]);
  const postsQ = usePosts({ status: "posted", from, to, page_size: 500 });
  const accountsQ = useSocialAccounts();
  const looks = useMemo(
    () => buildPlatformLooks(accountsQ.data ?? []),
    [accountsQ.data],
  );
  // Expected count scales with how many handles are registered — the cadence
  // is per platform (6/week each), so 3 registered platforms in a 27-workday
  // month expect 81, not a hardcoded 4-platform number.
  const platformCount = Math.max(
    1,
    registeredPlatforms(accountsQ.data ?? []).length,
  );

  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  const byDay = useMemo(() => {
    const m = new Map<string, SocialPost[]>();
    for (const p of postsQ.data ?? []) {
      const when = p.published_at || p.scheduled_for;
      if (!when) continue;
      const k = dayKey(new Date(when));
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    return m;
  }, [postsQ.data]);

  const loggedThisMonth = useMemo(() => {
    let n = 0;
    for (const [k, arr] of byDay) if (k.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) n += arr.length;
    return n;
  }, [byDay, year, month]);
  const expected = expectedPostsInMonth(year, month) * platformCount;
  const pct = Math.min(100, Math.round((loggedThisMonth / Math.max(1, expected)) * 100));

  const shift = (n: number) => setCursor(new Date(year, month + n, 1));

  // Horizontal swipe → change month (ignore mostly-vertical drags so the page
  // can still scroll).
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.6) shift(dx < 0 ? 1 : -1);
    touch.current = null;
  };

  return (
    <>
      <Card className="p-3.5 sm:p-4">
        {/* Month header */}
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-[17px]">
            {MONTH_NAMES[month]} <span className="text-text-muted">{year}</span>
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => shift(-1)}
              className="grid h-9 w-9 place-items-center rounded-[10px] text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-[18px] w-[18px]" />
            </button>
            <button
              onClick={() => setCursor(new Date())}
              className="rounded-[10px] px-3 py-2 text-[12.5px] font-semibold text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary"
            >
              Today
            </button>
            <button
              onClick={() => shift(1)}
              className="grid h-9 w-9 place-items-center rounded-[10px] text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary"
              aria-label="Next month"
            >
              <ChevronRight className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        {/* Month progress vs the fixed 6/week cadence */}
        <div className="mb-3.5">
          <div className="mb-1 flex items-center justify-between text-[11.5px]">
            <span className="text-text-muted">
              <span className="font-display text-[14px] text-text-primary tabular-nums">{loggedThisMonth}</span>
              <span className="text-text-faint"> / {expected} expected</span>
            </span>
            <span className={pct >= 100 ? "text-success" : pct >= 66 ? "text-warn" : "text-text-faint"}>
              {pct}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-text-primary/[0.07]">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Weekday header */}
        <div className="mb-1 grid grid-cols-7">
          {DAY_NAMES.map((d, i) => (
            <div
              key={d}
              className={`py-1 text-center text-[10px] font-semibold uppercase tracking-wider ${
                i === 0 ? "text-text-faint/60" : "text-text-faint"
              }`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 gap-1" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {postsQ.isLoading
            ? Array.from({ length: 42 }).map((_, i) => (
                <Skeleton key={i} className="rounded-[10px]" style={{ aspectRatio: "1 / 1" }} />
              ))
            : weeks.flat().map((d, idx) => {
                const inMonth = d.getMonth() === month;
                const dayPosts = byDay.get(dayKey(d)) ?? [];
                const today = sameDay(d, new Date());
                const platforms = [...new Set(dayPosts.map((x) => x.platform))];
                return (
                  <button
                    key={idx}
                    onClick={() => setOpenDay(d)}
                    className={`relative flex aspect-square flex-col items-center justify-start rounded-[10px] border p-1 transition-colors ${
                      inMonth
                        ? "border-line bg-text-primary/[0.02] hover:border-accent/40 hover:bg-accent/[0.05]"
                        : "border-transparent opacity-35 hover:opacity-60"
                    } ${today ? "ring-1 ring-accent/60" : ""}`}
                  >
                    <span
                      className={`mt-0.5 text-[12px] tabular-nums ${
                        today
                          ? "font-semibold text-accent-glow"
                          : isSunday(d)
                            ? "text-text-faint/70"
                            : "text-text-muted"
                      }`}
                    >
                      {d.getDate()}
                    </span>

                    {/* platform dots + count */}
                    {dayPosts.length > 0 && (
                      <div className="mt-auto flex flex-col items-center gap-0.5 pb-0.5">
                        <div className="flex items-center gap-[3px]">
                          {platforms.slice(0, 4).map((p) => (
                            <span
                              key={p}
                              className="h-[5px] w-[5px] rounded-full"
                              style={{ background: lookFor(looks, p).color }}
                            />
                          ))}
                        </div>
                        <span className="text-[9.5px] font-semibold leading-none text-text-faint tabular-nums">
                          {dayPosts.length}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
        </div>
      </Card>

      <p className="mt-2.5 px-1 text-center text-[11px] text-text-faint sm:hidden">
        Swipe left or right to change month · tap a day to log links
      </p>

      {openDay && (
        <DaySheet
          date={openDay}
          posts={byDay.get(dayKey(openDay)) ?? []}
          onClose={() => setOpenDay(null)}
        />
      )}
    </>
  );
}
