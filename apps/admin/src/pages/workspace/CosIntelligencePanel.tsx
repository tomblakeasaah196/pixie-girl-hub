/**
 * Chief of Staff — Intelligence panel (PR5).
 *
 * The "wow" cognition surfaces, sitting behind an Insights toggle in the CoS
 * tab: the cross-brand portfolio (wow #6), smart scheduling — find focus time +
 * today's load (wow #5), and reusable playbooks (wow #9). Plans that come back
 * from booking a focus block or instantiating a playbook render inline through
 * the same BatchPlanCard approval gate as a chat-proposed plan.
 *
 * Design canon: glass surfaces, accent tokens only, four states on every query.
 */

import { useMemo, useState } from "react";
import {
  Building2,
  CalendarClock,
  Gauge,
  BookMarked,
  AlertCircle,
  RotateCw,
  Sparkles,
  Clock,
  Play,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { BatchPlanCard } from "./BatchPlanCard";
import {
  useCrossBrandOverview,
  useCosTemplates,
  useScheduleLoad,
  useFindFocus,
  useInstantiateTemplate,
  type Plan,
  type CrossBrandBrand,
  type GoalTemplate,
} from "@/lib/cos-api";

function SectionHeader({ icon: Icon, title, hint }: { icon: typeof Building2; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-accent-glow" />
      <h3 className="font-display text-[14px] font-medium">{title}</h3>
      {hint && <span className="text-[11px] text-text-faint">{hint}</span>}
    </div>
  );
}

function healthTint(b: CrossBrandBrand) {
  if (b.active_goals === 0) return "text-text-faint";
  if (b.behind > 0) return "text-danger";
  if (b.at_risk > 0) return "text-warn";
  return "text-success";
}

function BrandCard({ b }: { b: CrossBrandBrand }) {
  return (
    <div className="rounded-[14px] bg-text-primary/[0.03] border hairline p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-[14px] font-medium">{b.display_name}</span>
        <span className="font-mono text-[12px] text-text-muted">{b.avg_progress}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-text-primary/10 overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,rgb(var(--accent)),var(--biz-2))]"
          style={{ width: `${Math.min(100, Math.max(0, b.avg_progress))}%` }}
        />
      </div>
      <div className={cn("text-[12px] mb-2.5", healthTint(b))}>{b.headline}</div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { n: b.active_goals, l: "Active" },
          { n: b.behind + b.at_risk, l: "At risk" },
          { n: b.overdue_total, l: "Overdue" },
        ].map((s) => (
          <div key={s.l} className="rounded-[10px] bg-text-primary/[0.03] py-1.5">
            <div className="font-mono text-[15px] leading-none">{s.n}</div>
            <div className="text-[9.5px] uppercase tracking-[0.12em] text-text-faint mt-1">{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CrossBrandSection() {
  const q = useCrossBrandOverview();
  return (
    <section>
      <SectionHeader icon={Building2} title="Across your companies" hint="CEO view" />
      {q.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-[150px] rounded-[14px] bg-text-primary/[0.04] animate-pulse" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorRetry onRetry={() => q.refetch()} label="Couldn't load the portfolio." />
      ) : !q.data || q.data.brands.length === 0 ? (
        <Empty text="No brands to show yet." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {q.data.brands.map((b) => (
            <BrandCard key={b.business} b={b} />
          ))}
        </div>
      )}
    </section>
  );
}

function fmtSlot(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function SchedulingSection({ onPlan }: { onPlan: (p: Plan) => void }) {
  const [duration, setDuration] = useState(120);
  const focus = useFindFocus();
  const load = useScheduleLoad();
  const slots = focus.data?.slots ?? [];

  return (
    <section>
      <SectionHeader icon={CalendarClock} title="Protect your time" />
      <div className="rounded-[14px] bg-text-primary/[0.03] border hairline p-4 space-y-4">
        {/* Today's load */}
        <div className="flex items-center gap-2.5">
          <Gauge className="w-4 h-4 text-text-muted shrink-0" />
          {load.isLoading ? (
            <span className="text-[12px] text-text-faint">Reading today's load…</span>
          ) : load.data ? (
            <span className={cn("text-[12.5px]", load.data.overloaded ? "text-warn" : "text-text-muted")}>
              Today: {load.data.meeting_hours}h in meetings · {load.data.high_priority_tasks} high-priority task(s)
              {load.data.overloaded ? " — looks heavy." : "."}
            </span>
          ) : (
            <span className="text-[12px] text-text-faint">Load unavailable.</span>
          )}
        </div>

        {/* Focus finder */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-text-muted">Find</span>
          <select
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="rounded-lg border hairline bg-text-primary/[0.04] px-2 py-1.5 text-[12.5px]"
          >
            <option value={60}>1 hour</option>
            <option value={120}>2 hours</option>
            <option value={180}>3 hours</option>
          </select>
          <span className="text-[12.5px] text-text-muted">of focus time this week</span>
          <button
            type="button"
            onClick={() => focus.mutate({ duration, within: 7 })}
            disabled={focus.isPending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent-deep/90 text-[#F4E9D9] px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-60"
          >
            <Clock className="w-3.5 h-3.5" />
            {focus.isPending ? "Scanning…" : "Find slots"}
          </button>
        </div>

        {focus.data && slots.length === 0 && (
          <p className="text-[12px] text-text-faint">No free block that long in work hours this week — try a shorter block.</p>
        )}
        {slots.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {slots.slice(0, 6).map((s) => (
              <span
                key={s.start_at}
                className="rounded-full border hairline bg-text-primary/[0.03] px-2.5 py-1 text-[11.5px] text-text-muted"
              >
                {fmtSlot(s.start_at)}
              </span>
            ))}
            {focus.data?.plan && (
              <button
                type="button"
                onClick={() => onPlan(focus.data!.plan!)}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 text-accent-glow px-3 py-1 text-[11.5px] font-medium"
              >
                <Play className="w-3 h-3" /> Book the first slot
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TemplateRow({ t, onPlan }: { t: GoalTemplate; onPlan: (p: Plan) => void }) {
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10));
  const inst = useInstantiateTemplate();
  const milestones = t.structure?.milestones?.length ?? 0;

  return (
    <div className="rounded-[12px] bg-text-primary/[0.03] border hairline p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold truncate">{t.name}</div>
          <div className="text-[11.5px] text-text-muted mt-0.5">
            {milestones} milestone(s) · used {t.usage_count}×
          </div>
        </div>
        <BookMarked className="w-4 h-4 text-accent-glow shrink-0" />
      </div>
      <div className="flex items-center gap-2 mt-3">
        <input
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="rounded-lg border hairline bg-text-primary/[0.04] px-2 py-1.5 text-[12px]"
        />
        <button
          type="button"
          onClick={() =>
            inst.mutate(
              { templateId: t.template_id, start_date: start },
              { onSuccess: (p) => onPlan(p) },
            )
          }
          disabled={inst.isPending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent-deep/90 text-[#F4E9D9] px-3 py-1.5 text-[12px] font-medium disabled:opacity-60"
        >
          <Play className="w-3.5 h-3.5" />
          {inst.isPending ? "Building…" : "Use playbook"}
        </button>
      </div>
    </div>
  );
}

function PlaybooksSection({ onPlan }: { onPlan: (p: Plan) => void }) {
  const q = useCosTemplates();
  return (
    <section>
      <SectionHeader icon={BookMarked} title="Playbooks" hint="reuse a proven plan" />
      {q.isLoading ? (
        <div className="space-y-2.5">
          {[0, 1].map((i) => (
            <div key={i} className="h-[92px] rounded-[12px] bg-text-primary/[0.04] animate-pulse" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorRetry onRetry={() => q.refetch()} label="Couldn't load playbooks." />
      ) : !q.data || q.data.length === 0 ? (
        <Empty text="No playbooks yet. Save a goal as a playbook to reuse its plan with fresh dates." />
      ) : (
        <div className="space-y-2.5">
          {q.data.map((t) => (
            <TemplateRow key={t.template_id} t={t} onPlan={onPlan} />
          ))}
        </div>
      )}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-[12px] border hairline border-dashed p-5 text-center">
      <Sparkles className="w-5 h-5 text-text-faint mx-auto mb-2" />
      <p className="text-[12px] text-text-muted max-w-[360px] mx-auto">{text}</p>
    </div>
  );
}

function ErrorRetry({ onRetry, label }: { onRetry: () => void; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 py-6 text-center">
      <AlertCircle className="w-5 h-5 text-danger" />
      <p className="text-[12.5px] text-text-muted">{label}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-lg border hairline px-3 py-1.5 text-[12px] hover:text-text-primary"
      >
        <RotateCw className="w-3.5 h-3.5" /> Retry
      </button>
    </div>
  );
}

export function CosIntelligencePanel() {
  const [plan, setPlan] = useState<Plan | null>(null);

  const banner = useMemo(
    () =>
      plan
        ? "Review the plan below and approve it — I'll run it as you."
        : null,
    [plan],
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain w-full max-w-[760px] mx-auto space-y-7 py-4 px-4 md:px-0 md:pr-1 pb-[max(env(safe-area-inset-bottom,0px),16px)]">
      <CrossBrandSection />
      <SchedulingSection onPlan={setPlan} />
      <PlaybooksSection onPlan={setPlan} />

      {plan && (
        <section>
          <SectionHeader icon={Sparkles} title="Ready to approve" hint={banner ?? undefined} />
          <BatchPlanCard plan={plan} conversationId={plan.conversation_id} />
        </section>
      )}
    </div>
  );
}
