/**
 * Performance — appraisal cycles, weighted-KPI balance, and reviews.
 * Surfaces the existing appraisal backend (cycles → scores → reviews) with the
 * quarterly weighted KPIs (Customer Feedback 40 / Sales 25 / Quality 20 /
 * Cleanliness 15). Permission-gated on hr_payroll; CEO bypasses.
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gauge,
  Plus,
  ScrollText,
  CheckCircle2,
  ClipboardCheck,
  Sparkles,
  Table2,
  Pencil,
  Trash2,
  FileDown,
  SlidersHorizontal,
  Trophy,
  Download,
  Megaphone,
  TrendingUp,
  TrendingDown,
  Clock,
  UsersRound,
  Send,
} from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState, MoneyText } from "@/components/ui/primitives";
import { DeniedState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import {
  listPerfCycles,
  createPerfCycle,
  updatePerfCycle,
  kpiWeightSummary,
  listPerfReviews,
  advancePerfReview,
  listKpiDefinitions,
  createKpiDefinition,
  updateKpiDefinition,
  deleteKpiDefinition,
  exportReviewPdf,
  scoreStaff,
  generatePerfReview,
  autoScoreCycle,
  listPerfScores,
  calibratePerfScore,
  listStaff,
  insightsSalesReport,
  insightsAttendance,
  downloadInsightsExcel,
  insightsWinnerPdf,
  announceWinner,
  type PerfCycle,
  type PerfScore,
  type KpiDef,
  type ScoreSource,
  type SalesExecRep,
  type ChannelMixRow,
  type AttendanceStaffRow,
} from "@/lib/hr-api";
import { downloadDocumentById } from "@/lib/documents-api";
import { TabBar, statusTone, useNotify, errMsg } from "./hr-shared";

const SCORE_SOURCE_OPTIONS: { value: ScoreSource; label: string; hint: string }[] = [
  { value: "manual", label: "Manual", hint: "Scored by hand each cycle." },
  { value: "clock_in_data", label: "Attendance / punctuality", hint: "On-time % → banded 1–5." },
  { value: "sales_data", label: "Sales target attainment", hint: "Attainment % → banded 1–5." },
  { value: "service_job_ratings", label: "Work quality", hint: "Avg quality rating, used directly." },
  { value: "customer_ratings", label: "Customer feedback", hint: "Avg customer rating, used directly." },
  { value: "crm_data", label: "CRM data", hint: "Not auto-wired yet — scored manually." },
  { value: "custom", label: "Custom", hint: "Scored manually." },
];
const BANDED: ScoreSource[] = ["clock_in_data", "sales_data"];

const SCORABLE = ["open", "scoring", "calibration"];

// The cycle lifecycle: a cycle must be moved off 'upcoming' before it accepts
// scores. Each step exposes the next transition.
const CYCLE_NEXT: Record<string, { status: string; label: string } | undefined> = {
  upcoming: { status: "open", label: "Open for scoring" },
  open: { status: "scoring", label: "Move to scoring" },
  scoring: { status: "calibration", label: "Move to calibration" },
  calibration: { status: "closed", label: "Close cycle" },
};

/** How a score was arrived at — badge label + tone. */
function sourceInfo(s: PerfScore): { label: string; tone: "success" | "info" | "warn" | "neutral" } {
  if (s.is_calibrated) return { label: "Calibrated", tone: "info" };
  if (s.score_source === "manual") return { label: "Manual", tone: "neutral" };
  return { label: "Auto", tone: "success" };
}

/** One-line human summary of the evidence behind an auto score. */
function evidenceSummary(s: PerfScore): string | null {
  const e = s.evidence as Record<string, number | string> | null;
  if (!e) return null;
  if (e.metric === "on_time_pct")
    return `On-time ${e.on_time_pct}% (${e.punctual_days}/${e.present_days} days)`;
  if (e.metric === "attainment_pct")
    return `Target attainment ${e.attainment_pct}% (${e.targets} target${e.targets === 1 ? "" : "s"})`;
  if (e.metric === "quality_rating_avg")
    return `Avg quality ${e.average} from ${e.sample_size} job${e.sample_size === 1 ? "" : "s"}`;
  if (e.metric === "customer_rating_avg")
    return `Avg customer rating ${e.average} from ${e.sample_size} rating${e.sample_size === 1 ? "" : "s"}`;
  return null;
}

const NEXT_STATUS: Record<string, string | undefined> = {
  draft: "submitted",
  submitted: "reviewed",
  reviewed: "approved",
  approved: "finalised",
};

function CreateCycleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify("HR → Performance: new cycle");
  const now = new Date();
  const [form, setForm] = useState({
    cycle_name: `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`,
    cycle_type: "quarterly",
    starts_on: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString().slice(0, 10),
    ends_on: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 3, 0).toISOString().slice(0, 10),
  });
  const mut = useMutation({
    mutationFn: () => createPerfCycle(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["perf"] }); notify("Cycle created"); onClose(); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  return (
    <Modal open={open} onClose={onClose} title="New appraisal cycle"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!form.cycle_name || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Creating…" : "Create cycle"}
          </Button>
        </>
      }>
      <div className="space-y-3">
        <input value={form.cycle_name} onChange={(e) => setForm({ ...form, cycle_name: e.target.value })}
          placeholder="Cycle name"
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
        <select value={form.cycle_type} onChange={(e) => setForm({ ...form, cycle_type: e.target.value })}
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
          {["monthly", "quarterly", "semi_annual", "annual", "ad_hoc"].map((t) => (
            <option key={t} value={t}>{t.replace("_", " ")}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })}
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
          <input type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })}
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        </div>
      </div>
    </Modal>
  );
}

function ScoreStaffModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify("HR → Performance: score staff");
  const { data: cycles } = useQuery({ queryKey: ["perf", "cycles"], queryFn: listPerfCycles, enabled: open });
  const { data: kpis } = useQuery({ queryKey: ["perf", "kpis"], queryFn: listKpiDefinitions, enabled: open });
  const { data: staff } = useQuery({
    queryKey: ["hr", "staff", "for-score"],
    queryFn: () => listStaff({ page_size: "200" }),
    enabled: open,
  });
  const [cycleId, setCycleId] = useState("");
  const [userId, setUserId] = useState("");
  const [scores, setScores] = useState<Record<string, number>>({});

  const openCycles = (cycles || []).filter((c) => SCORABLE.includes(c.status));
  const staffWithUser = (staff?.data || []).filter((s) => (s as { user_id?: string }).user_id);

  const submit = useMutation({
    mutationFn: async () => {
      const payload = (kpis || []).map((k) => ({
        kpi_id: k.kpi_id,
        raw_score: scores[k.kpi_id] ?? k.min_score,
      }));
      await scoreStaff(cycleId, { user_id: userId, scores: payload });
      return generatePerfReview(cycleId, userId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["perf"] });
      notify("Scored & review generated", "Find it under the Reviews tab.");
      onClose();
      setScores({});
      setUserId("");
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  return (
    <Modal open={open} onClose={onClose} title="Score a staff member"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary"
            disabled={!cycleId || !userId || !(kpis || []).length || submit.isPending}
            onClick={() => submit.mutate()}>
            {submit.isPending ? "Saving…" : "Save scores & generate review"}
          </Button>
        </>
      }>
      <div className="space-y-3">
        <select value={cycleId} onChange={(e) => setCycleId(e.target.value)}
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
          <option value="">— select cycle —</option>
          {openCycles.map((c) => (<option key={c.cycle_id} value={c.cycle_id}>{c.cycle_name}</option>))}
        </select>
        {!openCycles.length && (
          <p className="text-xs text-warn">
            No cycle is open for scoring. On the Cycles tab, use “Open for scoring” on a cycle first.
          </p>
        )}
        <select value={userId} onChange={(e) => setUserId(e.target.value)}
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
          <option value="">— select staff —</option>
          {staffWithUser.map((s) => (
            <option key={s.profile_id} value={(s as { user_id?: string }).user_id}>{s.display_name}</option>
          ))}
        </select>
        <div className="space-y-2">
          {(kpis || []).map((k) => (
            <div key={k.kpi_id} className="flex items-center justify-between gap-3">
              <span className="text-sm text-text-primary">
                {k.display_name} <span className="text-xs text-text-faint">({k.weight_pct}%)</span>
              </span>
              <input type="number" min={k.min_score} max={k.max_score} step="0.1"
                value={scores[k.kpi_id] ?? ""}
                placeholder={`${k.min_score}–${k.max_score}`}
                onChange={(e) => setScores({ ...scores, [k.kpi_id]: Number(e.target.value) })}
                className="w-24 rounded-xl border border-line bg-text-primary/[0.04] p-2 text-sm text-text-primary" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
            </div>
          ))}
          {!(kpis || []).length && (
            <p className="text-xs text-text-faint">No KPI definitions configured yet.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CyclesTab({ onCreate, onScore }: { onCreate: () => void; onScore: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify("HR → Performance: cycles");
  const can = useAuthStore((s) => s.can);
  const { data, isLoading } = useQuery({ queryKey: ["perf", "cycles"], queryFn: listPerfCycles });
  const { data: kpi } = useQuery({ queryKey: ["perf", "kpi-weights"], queryFn: kpiWeightSummary });
  const [scoresCycle, setScoresCycle] = useState<PerfCycle | null>(null);

  const auto = useMutation({
    mutationFn: (cycleId: string) => autoScoreCycle(cycleId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["perf"] });
      notify(
        "Auto-scored from data",
        `${r.scored} scored · ${r.no_data} no data · ${r.skipped} manager scores kept`,
      );
    },
    onError: (e) => notify("Auto-score failed", errMsg(e), "high"),
  });
  const advance = useMutation({
    mutationFn: (v: { id: string; status: string }) => updatePerfCycle(v.id, { status: v.status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["perf"] }); notify("Cycle updated"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  const canEdit = can("hr_payroll", "edit");

  return (
    <div className="space-y-4">
      {kpi && (
        <Card className="flex items-center justify-between gap-3 p-4">
          <div>
            <div className="text-sm font-semibold text-text-primary">KPI weighting</div>
            <div className="text-xs text-text-muted">Weights must total {kpi.target}%.</div>
          </div>
          <Pill tone={kpi.balanced ? "success" : "warn"}>{kpi.total}% {kpi.balanced ? "balanced" : "off-balance"}</Pill>
        </Card>
      )}
      <div className="flex justify-end gap-2">
        <Button icon={<ClipboardCheck className="h-4 w-4" />} onClick={onScore}>Score staff</Button>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={onCreate}>New cycle</Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-32 rounded-[var(--radius)]" />
      ) : !data?.length ? (
        <EmptyState icon={<Gauge className="h-6 w-6" />} title="No appraisal cycles yet"
          message="Create a quarterly cycle to score staff against the weighted KPIs." />
      ) : (
        <div className="space-y-2">
          {data.map((c: PerfCycle) => {
            const scorable = SCORABLE.includes(c.status);
            const nextStep = CYCLE_NEXT[c.status];
            return (
              <Card key={c.cycle_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-primary">{c.cycle_name}</span>
                    <Pill tone={statusTone(c.status === "closed" ? "approved" : "pending")}>{c.status}</Pill>
                    {c.status === "upcoming" && (
                      <span className="text-[11px] text-text-faint">— open it before scoring</span>
                    )}
                  </div>
                  <div className="text-xs text-text-muted">{c.starts_on} – {c.ends_on} · {c.cycle_type.replace("_", " ")}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" icon={<Table2 className="h-3.5 w-3.5" />}
                    onClick={() => setScoresCycle(c)}>
                    Scores
                  </Button>
                  {scorable && canEdit && (
                    <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />}
                      disabled={auto.isPending}
                      onClick={() => auto.mutate(c.cycle_id)}>
                      {auto.isPending ? "Scoring…" : "Auto-score"}
                    </Button>
                  )}
                  {nextStep && canEdit && (
                    <Button size="sm" variant={c.status === "upcoming" ? "primary" : "ghost"}
                      disabled={advance.isPending}
                      onClick={() => advance.mutate({ id: c.cycle_id, status: nextStep.status })}>
                      {nextStep.label}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <ScoresModal cycle={scoresCycle} onClose={() => setScoresCycle(null)} canEdit={canEdit} />
    </div>
  );
}

function ScoresModal({
  cycle,
  onClose,
  canEdit,
}: {
  cycle: PerfCycle | null;
  onClose: () => void;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const notify = useNotify("HR → Performance: scores");
  const open = !!cycle;
  const { data: staff } = useQuery({
    queryKey: ["hr", "staff", "for-scores"],
    queryFn: () => listStaff({ page_size: "200" }),
    enabled: open,
  });
  const [userId, setUserId] = useState("");
  const staffWithUser = (staff?.data || []).filter((s) => (s as { user_id?: string }).user_id);
  const { data: scores, isLoading } = useQuery({
    queryKey: ["perf", "scores", cycle?.cycle_id, userId],
    queryFn: () => listPerfScores(cycle!.cycle_id, userId),
    enabled: open && !!userId,
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const calib = useMutation({
    mutationFn: (v: { score_id: string; raw_score: number }) =>
      calibratePerfScore(cycle!.cycle_id, v.score_id, { raw_score: v.raw_score }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["perf", "scores", cycle?.cycle_id, userId] });
      notify("Score calibrated");
      setEditing(null);
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  return (
    <Modal open={open} onClose={onClose} title={`Scores — ${cycle?.cycle_name ?? ""}`}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="space-y-3">
        <select value={userId} onChange={(e) => setUserId(e.target.value)}
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
          <option value="">— select staff —</option>
          {staffWithUser.map((s) => (
            <option key={s.profile_id} value={(s as { user_id?: string }).user_id}>{s.display_name}</option>
          ))}
        </select>
        {!userId ? (
          <p className="text-xs text-text-faint">Pick a staff member to see their KPI scores and the evidence behind each auto score.</p>
        ) : isLoading ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : !scores?.length ? (
          <p className="text-xs text-text-faint">No scores yet. Use “Auto-score” on the cycle, or score manually.</p>
        ) : (
          <div className="space-y-2">
            {scores.map((sc) => {
              const src = sourceInfo(sc);
              const ev = evidenceSummary(sc);
              return (
                <div key={sc.score_id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-text-primary">
                      {sc.kpi_name} <span className="text-xs text-text-faint">({sc.weight_pct_snapshot}%)</span>
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-text-primary">{Number(sc.raw_score).toFixed(1)}</span>
                      <Pill tone={src.tone}>{src.label}</Pill>
                    </div>
                  </div>
                  {ev && <div className="mt-1 text-xs text-text-muted">{ev}</div>}
                  {sc.last_auto_score_status === "no_data" && !ev && (
                    <div className="mt-1 text-xs text-warn">No data in this period — score manually.</div>
                  )}
                  {sc.is_calibrated && sc.pre_calibration_score != null && (
                    <div className="mt-1 text-[11px] text-text-faint">
                      Was {Number(sc.pre_calibration_score).toFixed(1)} before calibration
                    </div>
                  )}
                  {canEdit && (
                    editing === sc.score_id ? (
                      <div className="mt-2 flex items-center gap-2">
                        <input type="number" step="0.1" value={editVal}
                          onChange={(e) => setEditVal(e.target.value)}
                          className="w-20 rounded-lg border border-line bg-text-primary/[0.04] p-1.5 text-sm text-text-primary" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
                        <Button size="sm" variant="primary" disabled={calib.isPending || editVal === ""}
                          onClick={() => calib.mutate({ score_id: sc.score_id, raw_score: Number(editVal) })}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <button
                        className="mt-2 inline-flex items-center gap-1 text-xs text-accent-glow hover:underline"
                        onClick={() => { setEditing(sc.score_id); setEditVal(String(sc.raw_score)); }}>
                        <Pencil className="h-3 w-3" /> Calibrate
                      </button>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ReviewsTab() {
  const qc = useQueryClient();
  const notify = useNotify("HR → Performance: reviews");
  const can = useAuthStore((s) => s.can);
  const { data, isLoading } = useQuery({ queryKey: ["perf", "reviews"], queryFn: () => listPerfReviews() });
  const advance = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => advancePerfReview(id, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["perf", "reviews"] }); notify("Review advanced"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  const [pdfId, setPdfId] = useState<string | null>(null);
  const pdf = useMutation({
    mutationFn: (id: string) => exportReviewPdf(id),
    onSuccess: async (r) => {
      await downloadDocumentById(r.document_id, r.title);
      notify("PDF ready", "The appraisal has been downloaded.");
      setPdfId(null);
    },
    onError: (e) => { notify("Failed", errMsg(e), "high"); setPdfId(null); },
  });
  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius)]" />;
  if (!data?.length)
    return <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No reviews yet"
      message="Reviews are generated from scored cycles." />;
  return (
    <div className="space-y-2">
      {data.map((r) => {
        const next = NEXT_STATUS[r.status];
        return (
          <Card key={r.review_id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-primary">{r.staff_name || "Staff"}</span>
                <Pill tone={statusTone(r.status === "finalised" || r.status === "approved" ? "approved" : "pending")}>{r.status}</Pill>
                {r.acknowledged_by_employee && <Pill tone="success">acknowledged</Pill>}
              </div>
              <div className="text-xs text-text-muted">
                Score {Number(r.overall_weighted_score).toFixed(2)} · {r.overall_rating_band.replace("_", " ")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {can("hr_payroll", "edit") && (
                <Button size="sm" variant="ghost" icon={<FileDown className="h-3.5 w-3.5" />}
                  disabled={pdf.isPending && pdfId === r.review_id}
                  onClick={() => { setPdfId(r.review_id); pdf.mutate(r.review_id); }}>
                  {pdf.isPending && pdfId === r.review_id ? "Preparing…" : "PDF"}
                </Button>
              )}
              {next && can("hr_payroll", "approve") && (
                <Button size="sm" variant="primary" icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  disabled={advance.isPending} onClick={() => advance.mutate({ id: r.review_id, status: next })}>
                  Mark {next}
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function KpisTab() {
  const can = useAuthStore((s) => s.can);
  const notify = useNotify();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["perf", "kpis"], queryFn: listKpiDefinitions });
  const [editor, setEditor] = useState<{ open: boolean; kpi: KpiDef | null }>({ open: false, kpi: null });
  const canEdit = can("hr_payroll", "edit");

  const del = useMutation({
    mutationFn: (id: string) => deleteKpiDefinition(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["perf"] }); notify("KPI removed"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          Configure the weighted KPIs and pick where each score comes from. Weights should total 100%.
        </p>
        {canEdit && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />}
            onClick={() => setEditor({ open: true, kpi: null })}>
            Add KPI
          </Button>
        )}
      </div>
      {isLoading ? (
        <Skeleton className="h-32 rounded-[var(--radius)]" />
      ) : !data?.length ? (
        <EmptyState icon={<SlidersHorizontal className="h-6 w-6" />} title="No KPIs yet"
          message="Add the weighted KPIs staff are appraised against." />
      ) : (
        <div className="space-y-2">
          {data.map((k) => {
            const src = SCORE_SOURCE_OPTIONS.find((o) => o.value === (k.score_source ?? "manual"));
            const auto = (k.score_source ?? "manual") !== "manual" && k.score_source !== "crm_data" && k.score_source !== "custom";
            return (
              <Card key={k.kpi_id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-primary">{k.display_name}</span>
                    <Pill tone="neutral">{k.weight_pct}%</Pill>
                    {auto ? <Pill tone="success">Auto</Pill> : <Pill tone="neutral">Manual</Pill>}
                  </div>
                  <div className="text-xs text-text-muted">{src?.label ?? k.score_source} · scale {k.min_score}–{k.max_score}</div>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />}
                      onClick={() => setEditor({ open: true, kpi: k })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />}
                      disabled={del.isPending} onClick={() => del.mutate(k.kpi_id)}>
                      Remove
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {editor.open && (
        <KpiEditorModal kpi={editor.kpi} onClose={() => setEditor({ open: false, kpi: null })} />
      )}
    </div>
  );
}

function KpiEditorModal({ kpi, onClose }: { kpi: KpiDef | null; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const editing = !!kpi;
  const [form, setForm] = useState({
    kpi_key: "",
    display_name: "",
    weight_pct: "20",
    min_score: "1",
    max_score: "5",
    score_source: "manual" as ScoreSource,
  });
  const [bands, setBands] = useState<{ gte: string; score: string }[]>([]);

  useEffect(() => {
    if (kpi) {
      setForm({
        kpi_key: kpi.kpi_key,
        display_name: kpi.display_name,
        weight_pct: String(kpi.weight_pct),
        min_score: String(kpi.min_score ?? 1),
        max_score: String(kpi.max_score ?? 5),
        score_source: kpi.score_source ?? "manual",
      });
      const b = (kpi.auto_score_config as { bands?: { gte: number; score: number }[] } | null)?.bands;
      setBands(b ? b.map((x) => ({ gte: String(x.gte), score: String(x.score) })) : []);
    }
  }, [kpi]);

  const showBands = BANDED.includes(form.score_source);
  const currentHint = SCORE_SOURCE_OPTIONS.find((o) => o.value === form.score_source)?.hint;

  const save = useMutation({
    mutationFn: () => {
      const auto_score_config =
        showBands && bands.length
          ? { bands: bands.filter((b) => b.gte !== "" && b.score !== "").map((b) => ({ gte: Number(b.gte), score: Number(b.score) })) }
          : null;
      const body = {
        kpi_key: form.kpi_key || form.display_name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        display_name: form.display_name,
        weight_pct: Number(form.weight_pct),
        min_score: Number(form.min_score),
        max_score: Number(form.max_score),
        score_source: form.score_source,
        auto_score_config,
      };
      return editing ? updateKpiDefinition(kpi!.kpi_id, body) : createKpiDefinition(body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["perf"] }); notify(editing ? "KPI updated" : "KPI added"); onClose(); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  const inputCls = "w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary";
  return (
    <Modal open onClose={onClose} title={editing ? "Edit KPI" : "Add KPI"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!form.display_name || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save KPI"}
          </Button>
        </>
      }>
      <div className="space-y-3">
        <input value={form.display_name} placeholder="KPI name (e.g. Punctuality)"
          onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={inputCls} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-xs text-text-muted">Weight %
            <input type="number" min={0} max={100} value={form.weight_pct}
              onChange={(e) => setForm({ ...form, weight_pct: e.target.value })} className={inputCls} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
          </label>
          <label className="text-xs text-text-muted">Min
            <input type="number" value={form.min_score}
              onChange={(e) => setForm({ ...form, min_score: e.target.value })} className={inputCls} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
          </label>
          <label className="text-xs text-text-muted">Max
            <input type="number" value={form.max_score}
              onChange={(e) => setForm({ ...form, max_score: e.target.value })} className={inputCls} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
          </label>
        </div>
        <label className="block text-xs text-text-muted">Score source
          <select value={form.score_source}
            onChange={(e) => setForm({ ...form, score_source: e.target.value as ScoreSource })} className={inputCls}>
            {SCORE_SOURCE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
        </label>
        {currentHint && <p className="text-[11px] text-text-faint">{currentHint}</p>}

        {showBands && (
          <div className="rounded-xl border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-text-primary">Auto-score bands (optional)</span>
              <button className="text-xs text-accent-glow hover:underline"
                onClick={() => setBands([...bands, { gte: "", score: "" }])}>+ Add band</button>
            </div>
            <p className="mb-2 text-[11px] text-text-faint">
              Metric ≥ value → score. Leave empty to use the sensible defaults.
            </p>
            {bands.map((b, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <span className="text-xs text-text-muted">≥</span>
                <input type="number" value={b.gte} placeholder="%"
                  onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, gte: e.target.value } : x)))}
                  className="w-20 rounded-lg border border-line bg-text-primary/[0.04] p-1.5 text-sm text-text-primary" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
                <span className="text-xs text-text-muted">→ score</span>
                <input type="number" step="0.1" value={b.score}
                  onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, score: e.target.value } : x)))}
                  className="w-16 rounded-lg border border-line bg-text-primary/[0.04] p-1.5 text-sm text-text-primary" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other" />
                <button className="text-text-faint hover:text-danger" onClick={() => setBands(bands.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Insights tab (Sales exec of the month + Attendance + AI ask) ──

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** First..last day of the month containing `d`. */
function monthBounds(d = new Date()): { from: string; to: string } {
  return {
    from: iso(new Date(d.getFullYear(), d.getMonth(), 1)),
    to: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  };
}

// Plain-language starters — tap to open Praxis pre-filled (option 8: Praxis box
// + quick chips). Praxis answers from the same numbers this tab shows.
const QUICK_QUESTIONS = [
  "Who is sales exec of the month?",
  "Who closed the most sales this month?",
  "How was attendance this month?",
  "Who was late the most this month?",
  "Which channel drives our sales?",
];

const MEDALS = ["🥇", "🥈", "🥉"];

/** Thin horizontal share bar (no chart lib — a token-styled meter). */
function ShareBar({ pct, muted = false }: { pct: number; muted?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-text-primary/[0.08]">
      <div
        className={`h-full rounded-full ${muted ? "bg-text-faint" : "bg-accent-glow"}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

function AskBar({ onAsk }: { onAsk: (q: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Card className="space-y-3 border-accent-glow/30 bg-accent-glow/[0.05] p-4 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-glow" />
        <span className="text-sm font-semibold text-text-primary">Ask Praxis</span>
        <span className="text-xs text-text-muted">— plain-language questions about sales &amp; attendance</span>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            onAsk(text.trim());
            setText("");
          }
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. who closed the most sales this month?"
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary placeholder:text-text-faint"
          autoComplete="off"
          data-lpignore="true"
        />
        <Button type="submit" variant="primary" icon={<Send className="h-4 w-4" />} disabled={!text.trim()}>
          Ask
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {QUICK_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onAsk(q)}
            className="rounded-full border border-line bg-text-primary/[0.03] px-3 py-1 text-xs text-text-muted transition hover:border-accent-glow/40 hover:text-text-primary"
          >
            {q}
          </button>
        ))}
      </div>
    </Card>
  );
}

function WinnerCard({ winner, period }: { winner: SalesExecRep | null; period: { from: string; to: string } }) {
  if (!winner) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Trophy className="h-4 w-4" /> No staff-closed sales in this period yet.
        </div>
      </Card>
    );
  }
  return (
    <Card className="relative overflow-hidden border-accent-glow/40 bg-accent-glow/[0.06] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-text-muted">
            <Trophy className="h-3.5 w-3.5 text-accent-glow" /> Sales Exec of the Month
          </div>
          <div className="mt-1 font-display text-2xl text-text-primary">{winner.staff_name}</div>
          <div className="text-xs text-text-faint">
            {period.from} → {period.to}
          </div>
        </div>
        <div className="text-5xl leading-none">🏆</div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <div className="font-display text-2xl text-accent-glow tabular-nums">{winner.closed_count}</div>
          <div className="text-[11px] uppercase tracking-wide text-text-muted">Sales closed</div>
        </div>
        <div>
          <div className="font-display text-2xl text-accent-glow tabular-nums">{winner.share_pct}%</div>
          <div className="text-[11px] uppercase tracking-wide text-text-muted">Of all sales</div>
        </div>
        <div>
          <MoneyText ngn={Number(winner.total_ngn)} className="text-2xl text-accent-glow" />
          <div className="text-[11px] uppercase tracking-wide text-text-muted">Value closed</div>
        </div>
      </div>
    </Card>
  );
}

function LeaderRow({ rep, total }: { rep: SalesExecRep; total: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line p-3">
      <span className="w-7 text-center text-sm">{MEDALS[rep.rank - 1] || rep.rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-text-primary">{rep.staff_name}</span>
          <span className="shrink-0 text-xs text-text-muted">
            <span className="font-mono text-text-primary">{rep.closed_count}</span> of {total} · {rep.share_pct}%
          </span>
        </div>
        <div className="mt-1.5">
          <ShareBar pct={rep.share_pct} />
        </div>
      </div>
      <MoneyText ngn={Number(rep.total_ngn)} className="shrink-0 text-sm" />
    </div>
  );
}

function ChannelMix({ rows }: { rows: ChannelMixRow[] }) {
  if (!rows.length) return null;
  return (
    <Card className="p-4">
      <div className="mb-3 text-sm font-semibold text-text-primary">Sales by channel</div>
      <div className="space-y-2.5">
        {rows.map((c) => (
          <div key={c.channel} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-text-primary">
                {c.label}
                {c.self_service && (
                  <span className="rounded-full bg-text-primary/[0.06] px-1.5 py-0.5 text-[10px] text-text-faint">
                    self-service
                  </span>
                )}
              </span>
              <span className="text-text-muted">
                <span className="font-mono text-text-primary">{c.closed_count}</span> · {c.share_pct}%
              </span>
            </div>
            <ShareBar pct={c.share_pct} muted={c.self_service} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function AttendanceTable({ staff }: { staff: AttendanceStaffRow[] }) {
  if (!staff.length)
    return (
      <EmptyState
        icon={<Clock className="h-6 w-6" />}
        title="No attendance yet"
        message="Reconciled attendance for this period will appear here."
      />
    );
  const otTone = (p: number | null) =>
    p === null ? "neutral" : p >= 90 ? "success" : p >= 75 ? "warn" : "danger";
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-text-muted">
            <th className="py-2 pr-3 font-medium">Staff</th>
            <th className="px-2 py-2 text-right font-medium">Present</th>
            <th className="px-2 py-2 text-right font-medium">Late</th>
            <th className="px-2 py-2 text-right font-medium">Absent</th>
            <th className="px-2 py-2 text-right font-medium">Off-site</th>
            <th className="px-2 py-2 text-right font-medium">Hours</th>
            <th className="px-2 py-2 text-right font-medium">On-time</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.profile_id} className="border-b border-line/60">
              <td className="py-2 pr-3 text-text-primary">{s.staff_name}</td>
              <td className="px-2 py-2 text-right font-mono text-text-primary">{s.present_days}</td>
              <td className="px-2 py-2 text-right font-mono text-text-muted">{s.late_days}</td>
              <td className="px-2 py-2 text-right font-mono text-text-muted">{s.absent_days}</td>
              <td className="px-2 py-2 text-right font-mono text-text-muted">{s.offsite_days}</td>
              <td className="px-2 py-2 text-right font-mono text-text-muted">{s.hours_worked.toFixed(1)}</td>
              <td className="px-2 py-2 text-right">
                {s.on_time_pct === null ? (
                  <span className="text-text-faint">—</span>
                ) : (
                  <Pill tone={otTone(s.on_time_pct)}>{s.on_time_pct}%</Pill>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InsightsTab() {
  const navigate = useNavigate();
  const notify = useNotify("HR → Performance: insights");
  const can = useAuthStore((s) => s.can);
  const canEdit = can("performance", "edit");
  const [{ from, to }, setPeriod] = useState(() => monthBounds());
  const params = { from, to };

  const sales = useQuery({
    queryKey: ["perf", "insights", "sales", from, to],
    queryFn: () => insightsSalesReport(params),
  });
  const attendance = useQuery({
    queryKey: ["perf", "insights", "attendance", from, to],
    queryFn: () => insightsAttendance(params),
  });

  const goAsk = (q: string) => {
    if (q.trim()) navigate("/praxis", { state: { initialText: q.trim() } });
  };

  const xlsx = useMutation({
    mutationFn: () => downloadInsightsExcel(params),
    onError: (e) => notify("Export failed", errMsg(e), "high"),
  });
  const pdf = useMutation({
    mutationFn: () => insightsWinnerPdf(params),
    onSuccess: async (r) => {
      await downloadDocumentById(r.document_id, r.title);
      notify("Winner certificate ready", "The PDF has been downloaded.");
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  const announce = useMutation({
    mutationFn: () => announceWinner(params),
    onSuccess: (r) =>
      notify(
        r.winner ? "Winner announced" : "Nothing to announce",
        r.winner
          ? `${r.winner.staff_name} — notified ${r.notified} staff.`
          : "No staff-closed sales in this period.",
      ),
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  const s = sales.data;
  const compare = s?.compare;

  return (
    <div className="space-y-4">
      <AskBar onAsk={goAsk} />

      {/* Period + actions toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 rounded-xl border border-line bg-text-primary/[0.03] px-3 py-1.5">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
            className="bg-transparent text-sm text-text-primary"
          />
          <span className="text-text-faint">→</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
            className="bg-transparent text-sm text-text-primary"
          />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPeriod(monthBounds())}>
          This month
        </Button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />}
            disabled={xlsx.isPending} onClick={() => xlsx.mutate()}>
            {xlsx.isPending ? "Preparing…" : "Excel"}
          </Button>
          <Button size="sm" variant="ghost" icon={<FileDown className="h-3.5 w-3.5" />}
            disabled={pdf.isPending} onClick={() => pdf.mutate()}>
            {pdf.isPending ? "Preparing…" : "Winner PDF"}
          </Button>
          {canEdit && (
            <Button size="sm" icon={<Megaphone className="h-3.5 w-3.5" />}
              disabled={announce.isPending || !s?.winner} onClick={() => announce.mutate()}>
              {announce.isPending ? "Announcing…" : "Announce winner"}
            </Button>
          )}
        </div>
      </div>

      {/* Sales exec of the month */}
      {sales.isLoading ? (
        <Skeleton className="h-40 rounded-[var(--radius)]" />
      ) : sales.isError ? (
        <Card className="flex items-center justify-between gap-3 p-4">
          <span className="text-sm text-danger">Couldn't load the sales leaderboard.</span>
          <Button size="sm" variant="ghost" onClick={() => sales.refetch()}>Retry</Button>
        </Card>
      ) : s ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <WinnerCard winner={s.winner} period={s.period} />
            {compare && (
              <div className="flex items-center gap-2 px-1 text-xs text-text-muted">
                {compare.closed_delta >= 0 ? (
                  <TrendingUp className="h-3.5 w-3.5 text-success" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5 text-danger" />
                )}
                {s.totals.total_closed} sales this period ·{" "}
                {compare.closed_delta >= 0 ? "+" : ""}
                {compare.closed_delta} vs previous ({compare.total_closed})
              </div>
            )}
            <Card className="p-4">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-text-primary">
                <UsersRound className="h-4 w-4" /> Leaderboard
              </div>
              <div className="mb-3 text-xs text-text-muted">
                {s.totals.attributed_closed} of {s.totals.total_closed} sales credited to{" "}
                {s.totals.rep_count} rep{s.totals.rep_count === 1 ? "" : "s"}.
              </div>
              {s.leaderboard.length ? (
                <div className="space-y-2">
                  {s.leaderboard.map((rep) => (
                    <LeaderRow key={rep.user_id} rep={rep} total={s.totals.total_closed} />
                  ))}
                  {s.unattributed.closed_count > 0 && (
                    <div className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3">
                      <span className="w-7 text-center text-text-faint">🌐</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm text-text-muted">{s.unattributed.label}</span>
                          <span className="shrink-0 text-xs text-text-muted">
                            <span className="font-mono">{s.unattributed.closed_count}</span> · {s.unattributed.share_pct}%
                          </span>
                        </div>
                        <div className="mt-1.5"><ShareBar pct={s.unattributed.share_pct} muted /></div>
                      </div>
                      <MoneyText ngn={Number(s.unattributed.total_ngn)} className="shrink-0 text-sm text-text-muted" />
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState icon={<Trophy className="h-6 w-6" />} title="No sales credited yet"
                  message="Staff-closed sales (Quick Sale, WhatsApp/Instagram, shared catalogue links) appear here." />
              )}
            </Card>
          </div>
          <ChannelMix rows={s.channel_mix} />
        </div>
      ) : null}

      {/* Attendance */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Clock className="h-4 w-4" /> Attendance summary
        </div>
        {attendance.isLoading ? (
          <Skeleton className="h-32 rounded-xl" />
        ) : attendance.isError ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-danger">Couldn't load attendance.</span>
            <Button size="sm" variant="ghost" onClick={() => attendance.refetch()}>Retry</Button>
          </div>
        ) : attendance.data ? (
          <>
            <div className="mb-3 flex flex-wrap gap-4 text-xs text-text-muted">
              <span>Present <span className="font-mono text-text-primary">{attendance.data.totals.present_days}</span></span>
              <span>Late <span className="font-mono text-text-primary">{attendance.data.totals.late_days}</span></span>
              <span>Absent <span className="font-mono text-text-primary">{attendance.data.totals.absent_days}</span></span>
              <span>Off-site <span className="font-mono text-text-primary">{attendance.data.totals.offsite_days}</span></span>
              {attendance.data.totals.on_time_pct !== null && (
                <span>Team on-time <span className="font-mono text-text-primary">{attendance.data.totals.on_time_pct}%</span></span>
              )}
            </div>
            <AttendanceTable staff={attendance.data.staff} />
          </>
        ) : null}
      </Card>
    </div>
  );
}

export default function PerformancePage() {
  useBreadcrumbs([{ label: "Performance" }]);
  const can = useAuthStore((s) => s.can);
  const [tab, setTab] = useState("cycles");
  const [createOpen, setCreateOpen] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);

  if (!can("hr_payroll", "view")) {
    return <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8"><DeniedState message="You don't have access to Performance." /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8">
      <div>
        <h1 className="font-display text-2xl text-text-primary">Performance</h1>
        <p className="text-sm text-text-muted">Appraisal cycles, weighted KPIs and reviews.</p>
      </div>

      <TabBar active={tab} onChange={setTab}
        tabs={[
          { key: "cycles", label: "Cycles" },
          { key: "kpis", label: "KPIs" },
          { key: "reviews", label: "Reviews" },
          { key: "insights", label: "Insights" },
        ]} />

      {tab === "cycles" && (
        <CyclesTab onCreate={() => setCreateOpen(true)} onScore={() => setScoreOpen(true)} />
      )}
      {tab === "kpis" && <KpisTab />}
      {tab === "reviews" && <ReviewsTab />}
      {tab === "insights" && <InsightsTab />}

      <CreateCycleModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ScoreStaffModal open={scoreOpen} onClose={() => setScoreOpen(false)} />
    </div>
  );
}
