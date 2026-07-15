import { useState } from "react";
import { Target, Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, Skeleton, EmptyState, Pill } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  usePerformance,
  useSetTarget,
  usePosts,
  currentMonth,
  PLATFORM_META,
  ALL_PLATFORMS,
  STATUS_TONE,
  STATUS_LABEL,
  type SocialPlatform,
  type PerformanceRow,
} from "@/lib/social-api";
import { formatDate } from "@/lib/format";
import { MonthPicker } from "./parts";

function Pct({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-faint">—</span>;
  const tone = value >= 100 ? "text-success" : value >= 60 ? "text-warn" : "text-danger";
  return <span className={tone}>{value}%</span>;
}

export function PerformanceTab() {
  const { can } = useAuthStore();
  const [month, setMonth] = useState(currentMonth());
  const perfQ = usePerformance(month);
  const rows = perfQ.data ?? [];
  const [focused, setFocused] = useState<SocialPlatform | null>(null);
  const [targeting, setTargeting] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <MonthPicker value={month} onChange={setMonth} />
        {can("social", "approve") && (
          <Button size="sm" variant="secondary" icon={<Target className="w-4 h-4" />} onClick={() => setTargeting(true)}>
            Set targets
          </Button>
        )}
      </div>

      {perfQ.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton style={{ height: 90 }} />
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Target className="w-7 h-7" />}
          title="Nothing to show yet"
          message="Once posts are planned for this month, their KPIs land here."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map((r) => (
            <button key={r.platform} onClick={() => setFocused(r.platform)} className="text-left">
              <Card className="p-4 hover:border-accent/30 border border-transparent transition-colors">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-display text-[15px]">{PLATFORM_META[r.platform]?.label}</span>
                  {r.flagged_count > 0 && <Pill tone="danger">{r.flagged_count} flagged</Pill>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Kpi label="Posted / Target">
                    {r.posted_count}
                    {r.target_count !== null ? ` / ${r.target_count}` : ""}
                  </Kpi>
                  <Kpi label="Attainment"><Pct value={r.attainment_pct} /></Kpi>
                  <Kpi label="On-time"><Pct value={r.on_time_pct} /></Kpi>
                  <Kpi label="Avg. score">
                    {r.avg_performance_score !== null ? Math.round(Number(r.avg_performance_score)) : "—"}
                  </Kpi>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      {focused && (
        <PlatformDrilldown
          platform={focused}
          month={month}
          row={rows.find((r) => r.platform === focused)}
          onClose={() => setFocused(null)}
        />
      )}
      {targeting && <TargetDrawer month={month} onClose={() => setTargeting(false)} />}
    </div>
  );
}

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-widest text-text-faint">{label}</div>
      <div className="font-display text-[16px] tabular-nums mt-0.5">{children}</div>
    </div>
  );
}

function PlatformDrilldown({
  platform,
  month,
  row,
  onClose,
}: {
  platform: SocialPlatform;
  month: string;
  row?: PerformanceRow;
  onClose: () => void;
}) {
  const from = `${month}-01T00:00:00.000Z`;
  const [y, m] = month.split("-").map(Number);
  const to = new Date(y, m, 1).toISOString();
  const postsQ = usePosts({ platform, from, to });
  const posts = postsQ.data ?? [];

  return (
    <Drawer
      open
      onClose={onClose}
      title={PLATFORM_META[platform]?.label ?? platform}
      subtitle={`${row?.posted_count ?? 0} posted this month`}
    >
      <div className="space-y-3 p-1">
        {postsQ.isLoading ? (
          <Skeleton style={{ height: 120 }} />
        ) : posts.length === 0 ? (
          <p className="text-[12.5px] text-text-faint italic">Nothing scheduled this month yet.</p>
        ) : (
          <div className="rounded-[11px] border border-line divide-y divide-line overflow-hidden">
            {posts.map((p) => (
              <div key={p.post_id} className="px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[12.5px] truncate">{p.caption?.slice(0, 40) || p.post_type}</div>
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

function TargetDrawer({ month, onClose }: { month: string; onClose: () => void }) {
  const setTarget = useSetTarget();
  const [platform, setPlatform] = useState<SocialPlatform>("instagram");
  const [count, setCount] = useState("8");

  return (
    <Drawer open onClose={onClose} title="Set a monthly target" subtitle={month}>
      <div className="space-y-4 p-1">
        <div>
          <span className="block text-[11.5px] text-text-muted mb-1.5">Platform</span>
          <Select
            value={platform}
            onChange={setPlatform}
            options={ALL_PLATFORMS.map((p) => ({ value: p, label: PLATFORM_META[p].label }))}
          />
        </div>
        <div>
          <span className="block text-[11.5px] text-text-muted mb-1.5">Posts this month (team-wide)</span>
          <input
            type="number"
            min={1}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50"
          />
        </div>
        {setTarget.isError && <p className="text-[12px] text-danger">Couldn&rsquo;t save that target.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!count || Number(count) < 1 || setTarget.isPending}
            icon={setTarget.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
            onClick={() =>
              setTarget.mutate(
                { platform, period_month: month, target_count: Number(count) },
                { onSuccess: onClose },
              )
            }
          >
            Save target
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
