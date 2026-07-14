import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { useAuthStore } from "@/stores/auth";
import {
  usePosts,
  PLATFORM_META,
  MONTH_NAMES,
  DAY_NAMES,
  monthGrid,
  sameDay,
  type SocialPost,
} from "@/lib/social-api";
import { Composer } from "./Composer";
import { PostDetail } from "./PostDetail";

const CHIP_TONE: Record<SocialPost["status"], string> = {
  draft: "bg-text-primary/[0.07] text-text-muted hover:bg-text-primary/[0.12]",
  assigned: "bg-info/[0.12] text-info hover:bg-info/20",
  scheduled: "bg-accent/[0.1] text-accent-glow hover:bg-accent/20",
  posted: "bg-success/[0.12] text-success hover:bg-success/20",
  flagged: "bg-danger/[0.12] text-danger hover:bg-danger/20",
  archived: "bg-text-primary/[0.05] text-text-faint hover:bg-text-primary/[0.1]",
};

export function CalendarTab() {
  const { can } = useAuthStore();
  const canCreate = can("social", "create");
  const postsQ = usePosts();
  const [cursor, setCursor] = useState(() => new Date());
  const [composerDate, setComposerDate] = useState<Date | null>(null);
  const [detail, setDetail] = useState<SocialPost | null>(null);

  const weeks = useMemo(() => monthGrid(cursor.getFullYear(), cursor.getMonth()), [cursor]);
  const byDay = useMemo(() => {
    const m = new Map<string, SocialPost[]>();
    for (const p of postsQ.data ?? []) {
      const when = p.scheduled_for || p.published_at;
      if (!when) continue;
      const k = new Date(when).toDateString();
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    return m;
  }, [postsQ.data]);

  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-[16px]">
            {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
          </h3>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => shift(-1)} icon={<ChevronLeft className="w-4 h-4" />}>
              {""}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCursor(new Date())}>
              Today
            </Button>
            <Button size="sm" variant="ghost" onClick={() => shift(1)} icon={<ChevronRight className="w-4 h-4" />}>
              {""}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-px mb-1">
          {DAY_NAMES.map((d) => (
            <div key={d} className="text-center text-[10.5px] uppercase tracking-widest text-text-faint py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {weeks.flat().map((d, idx) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const dayPosts = byDay.get(d.toDateString()) ?? [];
            const clickable = inMonth && canCreate && d >= startToday;
            return (
              <div
                key={idx}
                onClick={clickable ? () => setComposerDate(d) : undefined}
                role={clickable ? "button" : undefined}
                title={clickable ? "Add a post on this day" : undefined}
                className={`group min-h-[84px] rounded-lg border p-1.5 transition-colors ${
                  inMonth ? "border-line bg-text-primary/[0.02]" : "border-transparent opacity-40"
                } ${clickable ? "cursor-pointer hover:border-accent/40 hover:bg-accent/[0.04]" : ""} ${
                  sameDay(d, new Date()) ? "ring-1 ring-accent/40" : ""
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-text-faint">{d.getDate()}</span>
                  {clickable && (
                    <Plus className="w-3 h-3 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
                <div className="space-y-1">
                  {dayPosts.slice(0, 3).map((p) => (
                    <button
                      key={p.post_id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetail(p);
                      }}
                      className={`w-full text-left text-[10.5px] px-1.5 py-1 rounded-md truncate ${CHIP_TONE[p.status]}`}
                      title={p.caption ?? ""}
                    >
                      {PLATFORM_META[p.platform]?.label?.slice(0, 2)} · {p.caption?.slice(0, 16) || p.post_type}
                    </button>
                  ))}
                  {dayPosts.length > 3 && (
                    <div className="text-[10px] text-text-faint pl-1">+{dayPosts.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {composerDate && <Composer initialDate={composerDate} onClose={() => setComposerDate(null)} />}
      {detail && <PostDetail post={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
