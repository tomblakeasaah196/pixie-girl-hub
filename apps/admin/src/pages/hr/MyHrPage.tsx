/**
 * My HR — the employee self-service dashboard (meeting §3.1, answer #13).
 *
 * Clones the reference hub-system's MyHr and upgrades it with the meeting's
 * real-time pieces: a live pro-rated earnings tracker, lateness deductions
 * shown the same day, the monthly target countdown ("20 styles away"), plus
 * leave, queries (with respond), assigned tasks and contracts/SOPs — all on
 * the Maroon Noir kit.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock,
  Plane,
  Wallet,
  Target,
  ListTodo,
  FileText,
  MessageSquareWarning,
  TriangleAlert,
  Sunrise,
  Sunset,
  Download,
  Award,
} from "lucide-react";
import {
  Card,
  Button,
  Pill,
  Skeleton,
  EmptyState,
  KpiTile,
} from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { money } from "@/lib/format";
import {
  getMyHr,
  requestLeave,
  respondToQuery,
  payslipPdf,
  type HrQuery,
  type PerformanceTarget,
} from "@/lib/hr-api";
import { downloadDocument } from "@/lib/documents-api";
import {
  WeekScheduleView,
  SectionTitle,
  QueryStatusPill,
  ClockLocationLink,
  clockTime,
  minutesLabel,
  useNotify,
  errMsg,
  statusTone,
} from "./hr-shared";
import { OnboardingCard } from "./OnboardingCard";
import { MyDevicesSection } from "./devices";

function TargetCountdown({ t }: { t: PerformanceTarget }) {
  const done = t.status === "achieved";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary">{t.metric_label}</span>
        <Pill tone={done ? "success" : "accent"}>{done ? "Achieved" : `${t.progress_pct}%`}</Pill>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-text-primary/[0.06]">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${t.progress_pct}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-text-muted">
        {done ? (
          <span className="text-success">Target hit — bonus unlocked 🎉</span>
        ) : (
          <>
            <span className="font-display text-base text-text-primary">{t.remaining}</span>{" "}
            {t.metric_label.toLowerCase()} away from your{" "}
            {t.reward_type === "pct_salary"
              ? `${t.reward_value}% bonus`
              : t.reward_type === "fixed_ngn"
                ? `${money(t.reward_value)} bonus`
                : "target"}
          </>
        )}
      </div>
    </Card>
  );
}

function RespondModal({
  query,
  onClose,
}: {
  query: HrQuery | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify("HR → My HR: respond to query");
  const [text, setText] = useState("");
  const mut = useMutation({
    mutationFn: () => respondToQuery(query!.query_id, text),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-hr"] });
      notify("Response sent", "HR will review and decide on the deduction.");
      onClose();
      setText("");
    },
    onError: (e) => notify("Could not send", errMsg(e), "high"),
  });
  return (
    <Modal
      open={Boolean(query)}
      onClose={onClose}
      title="Respond to query"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!text.trim() || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Sending…" : "Send response"}
          </Button>
        </>
      }
    >
      {query && (
        <div className="space-y-3">
          <div className="rounded-xl border border-line bg-text-primary/[0.03] p-3">
            <div className="text-sm font-medium text-text-primary">{query.subject}</div>
            {query.details && (
              <p className="mt-1 text-xs text-text-muted">{query.details}</p>
            )}
            {query.deduction_ngn ? (
              <p className="mt-2 text-xs text-warn">
                At stake: {money(Number(query.deduction_ngn))} ({query.deduction_pct}% of the day)
              </p>
            ) : null}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Explain what happened…"
            className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-3 text-sm text-text-primary outline-none focus-visible:border-accent/50"
          />
        </div>
      )}
    </Modal>
  );
}

function RequestLeaveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify("HR → My HR: request leave");
  const [form, setForm] = useState({
    leave_type: "annual",
    start_date: "",
    end_date: "",
    reason: "",
  });
  const days = (() => {
    if (!form.start_date || !form.end_date) return 0;
    const a = new Date(form.start_date).getTime();
    const b = new Date(form.end_date).getTime();
    return b >= a ? Math.floor((b - a) / 86400000) + 1 : 0;
  })();
  const mut = useMutation({
    mutationFn: () =>
      requestLeave({
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: form.end_date,
        days_requested: days,
        reason: form.reason || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-hr"] });
      notify("Leave requested", "HR has been notified for approval.");
      onClose();
    },
    onError: (e) => notify("Could not request leave", errMsg(e), "high"),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request leave"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!form.start_date || !form.end_date || days < 1 || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Submitting…" : `Request ${days || ""} day${days === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-xs font-medium text-text-muted">
          Type
          <select
            value={form.leave_type}
            onChange={(e) => setForm({ ...form, leave_type: e.target.value })}
            className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary"
          >
            {["annual", "sick", "maternity", "paternity", "compassionate", "bereavement", "unpaid"].map(
              (t) => (
                <option key={t} value={t}>{t}</option>
              ),
            )}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-text-muted">
            From
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary"
            />
          </label>
          <label className="block text-xs font-medium text-text-muted">
            To
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary"
            />
          </label>
        </div>
        <label className="block text-xs font-medium text-text-muted">
          Reason (optional)
          <textarea
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            rows={3}
            className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary"
          />
        </label>
      </div>
    </Modal>
  );
}

export default function MyHrPage() {
  useBreadcrumbs([{ label: "My HR" }]);
  const notify = useNotify("HR → My HR");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [respondQuery, setRespondQuery] = useState<HrQuery | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["my-hr"],
    queryFn: getMyHr,
    retry: false,
  });

  const pdf = useMutation({
    mutationFn: (id: string) => payslipPdf(id),
    onSuccess: (doc) => downloadDocument(doc).catch(() => notify("Download failed", "", "high")),
    onError: (e) => notify("Couldn't generate PDF", errMsg(e), "high"),
  });

  if (isError) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
        <EmptyState
          icon={<CalendarDays className="h-7 w-7" />}
          title="No staff profile linked"
          message="Your account isn't linked to an employee profile yet. Ask HR to link it so you can see your earnings, clock in, request leave and track your targets."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">My HR</h1>
          <p className="text-sm text-text-muted">
            Your earnings, attendance, leave, queries and targets — all in one place.
          </p>
        </div>
        <Button variant="primary" icon={<Plane className="h-4 w-4" />} onClick={() => setLeaveOpen(true)}>
          Request leave
        </Button>
      </div>

      {isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-[var(--radius)]" />
          ))}
        </div>
      ) : (
        <>
          {/* Getting started (onboarding pack — always available) */}
          <OnboardingCard onboarding={data.onboarding} contracts={data.contracts} />

          {/* Earnings tracker hero */}
          {data.earnings.tracker_enabled && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile
                label="Earned this month"
                value={money(data.earnings.month_to_date_earned_ngn)}
              />
              <KpiTile
                label="Projected (full month)"
                value={money(data.earnings.projected_month_ngn)}
              />
              <KpiTile
                label="Deductions"
                value={money(data.earnings.deductions_ngn)}
                tone="warn"
              />
              <KpiTile
                label="At risk (open queries)"
                value={money(data.earnings.at_risk_ngn)}
                tone="warn"
              />
            </div>
          )}

          {/* Accruals building toward this month's pay */}
          {(data.accruals.commission_pending_ngn > 0 || data.accruals.bonus_pending_ngn > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <KpiTile label="Commission accruing" value={money(data.accruals.commission_pending_ngn)} tone="accent" />
              <KpiTile label="Bonus accruing" value={money(data.accruals.bonus_pending_ngn)} tone="accent" />
            </div>
          )}

          {/* Attendance insights — earliest/latest, punctuality, at-risk days */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Sunrise className="h-4 w-4 text-accent-glow" /> Earliest in
              </div>
              <div className="mt-1 font-display text-lg text-text-primary">
                {minutesLabel(data.insights.earliest_arrival?.local_minutes ?? null)}
              </div>
              <div className="text-xs text-text-faint">{data.insights.earliest_arrival?.work_date || "—"}</div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <Sunset className="h-4 w-4 text-accent-glow" /> Latest out
              </div>
              <div className="mt-1 font-display text-lg text-text-primary">
                {minutesLabel(data.insights.latest_departure?.local_minutes ?? null)}
              </div>
              <div className="text-xs text-text-faint">{data.insights.latest_departure?.work_date || "—"}</div>
            </Card>
            <KpiTile label="Punctuality" value={`${data.insights.punctuality_pct}%`}
              tone={data.insights.punctuality_pct >= 90 ? "accent" : "warn"} />
            <KpiTile label="Days at risk of query" value={String(data.insights.at_risk_days)}
              tone={data.insights.at_risk_days ? "danger" : "accent"} />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {/* Schedule */}
            <Card className="p-5 md:col-span-2">
              <SectionTitle icon={<CalendarDays className="h-4 w-4 text-accent-glow" />}>
                My week
              </SectionTitle>
              <WeekScheduleView schedule={data.schedule.work_schedule} />
              <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
                <Clock className="h-3.5 w-3.5" />
                {data.schedule.expected_start_time
                  ? `Expected start ${data.schedule.expected_start_time} · ${data.schedule.grace_minutes}m grace`
                  : "No fixed start time"}
                <span className="ml-auto inline-flex items-center gap-1">
                  <Wallet className="h-3.5 w-3.5" />
                  Daily rate {money(data.earnings.daily_rate_ngn)}
                </span>
              </div>
            </Card>

            {/* Leave balance */}
            <Card className="p-5">
              <SectionTitle icon={<Plane className="h-4 w-4 text-accent-glow" />}>
                Leave
              </SectionTitle>
              <div className="text-xs text-text-muted">
                Annual remaining:{" "}
                <span className="font-display text-base text-text-primary">
                  {data.annual_leave_days_remaining}
                </span>{" "}
                days
              </div>
              {data.leave_balance.length ? (
                <div className="mt-2 space-y-1">
                  {data.leave_balance.map((b) => (
                    <div key={b.leave_type} className="flex justify-between text-xs">
                      <span className="capitalize text-text-muted">{b.leave_type}</span>
                      <span className="text-text-primary">{b.days_taken} taken</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-text-faint">No leave taken this year.</p>
              )}
            </Card>
          </div>

          {/* Target countdowns */}
          <div>
            <SectionTitle icon={<Target className="h-4 w-4 text-accent-glow" />}>
              My targets this month
            </SectionTitle>
            {data.targets.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.targets.map((t) => (
                  <TargetCountdown key={t.target_id} t={t} />
                ))}
              </div>
            ) : (
              <Card className="p-4 text-sm text-text-muted">
                No targets set for this month yet.
              </Card>
            )}
          </div>

          {/* Open queries */}
          {data.open_queries.length > 0 && (
            <div>
              <SectionTitle icon={<MessageSquareWarning className="h-4 w-4 text-warn" />}>
                Queries needing your response
              </SectionTitle>
              <div className="space-y-2">
                {data.open_queries.map((q) => (
                  <Card key={q.query_id} className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm text-text-primary">{q.subject}</span>
                        <QueryStatusPill status={q.status} />
                      </div>
                      {q.deduction_ngn ? (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-warn">
                          <TriangleAlert className="h-3 w-3" />
                          {money(Number(q.deduction_ngn))} at stake until waived
                        </div>
                      ) : null}
                    </div>
                    {q.status === "open" && (
                      <Button size="sm" onClick={() => setRespondQuery(q)}>
                        Respond
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {/* Tasks */}
            <div>
              <SectionTitle icon={<ListTodo className="h-4 w-4 text-accent-glow" />}>
                My tasks
              </SectionTitle>
              {data.tasks.length ? (
                <div className="space-y-2">
                  {data.tasks.map((t) => (
                    <Card key={t.task_id} className="flex items-center justify-between gap-3 p-3">
                      <span className="truncate text-sm text-text-primary">{t.title}</span>
                      <Pill tone={t.status === "done" ? "success" : "neutral"}>{t.status}</Pill>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="p-4 text-sm text-text-muted">No tasks assigned.</Card>
              )}
            </div>

            {/* Contracts / documents */}
            <div>
              <SectionTitle icon={<FileText className="h-4 w-4 text-accent-glow" />}>
                Contracts & documents
              </SectionTitle>
              {data.contracts.length ? (
                <div className="space-y-2">
                  {data.contracts.map((c) => (
                    <Card key={c.contract_id} className="flex items-center justify-between gap-3 p-3">
                      <div>
                        <span className="text-sm capitalize text-text-primary">
                          {c.contract_type.replace("_", " ")}
                        </span>
                        <div className="text-xs text-text-muted">
                          From {c.effective_from}
                          {c.effective_to ? ` to ${c.effective_to}` : " · current"}
                        </div>
                      </div>
                      {c.document_id && <Pill tone="info">PDF</Pill>}
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="p-4 text-sm text-text-muted">
                  No contracts on file yet.
                </Card>
              )}
            </div>
          </div>

          {/* My devices — enrol the phone/laptop you clock in with */}
          <MyDevicesSection />

          {/* Attendance this month */}
          <div>
            <SectionTitle icon={<CalendarDays className="h-4 w-4 text-accent-glow" />}>
              This month's attendance
            </SectionTitle>
            {data.attendance.length ? (
              <div className="space-y-2">
                {data.attendance.slice(0, 31).map((d) => (
                  <Card key={d.day_id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-text-primary">{d.work_date}</span>
                        <span className="text-xs text-text-faint">
                          In {clockTime(d.first_clock_in_at)}
                          {d.last_clock_out_at ? ` · Out ${clockTime(d.last_clock_out_at)}` : ""}
                        </span>
                      </div>
                      <ClockLocationLink day={d} />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {d.is_late && <span className="text-xs text-warn">{d.minutes_late}m late</span>}
                      {d.early_leave_minutes > 0 && (
                        <span className="text-xs text-warn">{d.early_leave_minutes}m early</span>
                      )}
                      <Pill tone={d.is_offsite ? "warn" : statusTone(d.status)}>
                        {d.status.replace("_", " ")}
                      </Pill>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-4 text-sm text-text-muted">No attendance recorded yet this month.</Card>
            )}
          </div>

          {/* My rewards */}
          {data.rewards.length > 0 && (
            <div>
              <SectionTitle icon={<Award className="h-4 w-4 text-accent-glow" />}>My rewards</SectionTitle>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.rewards.map((r) => (
                  <Card key={r.reward_grant_id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <span className="text-sm text-text-primary">{r.rule_name || r.metric}</span>
                      <div className="text-xs text-text-muted">
                        {r.period_month}/{r.period_year}
                        {r.amount_ngn ? ` · ${money(Number(r.amount_ngn))}` : ""}
                        {r.proposed_salary_ngn ? ` · new salary ${money(Number(r.proposed_salary_ngn))}` : ""}
                      </div>
                    </div>
                    <Pill tone={r.status === "applied" || r.status === "awarded" ? "success" : r.status === "rejected" ? "danger" : "neutral"}>
                      {r.status === "awarded" ? "🎉 won" : r.status}
                    </Pill>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* My payslips */}
          <div>
            <SectionTitle icon={<Wallet className="h-4 w-4 text-accent-glow" />}>My payslips</SectionTitle>
            {data.payslips.length ? (
              <div className="space-y-2">
                {data.payslips.map((s) => (
                  <Card key={s.payslip_id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <span className="text-sm text-text-primary">{s.payslip_number}</span>
                      <div className="text-xs text-text-muted">Net {money(Number(s.net_pay_ngn))}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Pill tone={statusTone(s.payment_status === "paid" ? "approved" : s.payment_status === "failed" ? "rejected" : "pending")}>
                        {s.payment_status}
                      </Pill>
                      <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />}
                        disabled={pdf.isPending} onClick={() => pdf.mutate(s.payslip_id)}>PDF</Button>
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="p-4 text-sm text-text-muted">No payslips yet.</Card>
            )}
          </div>
        </>
      )}

      <RequestLeaveModal open={leaveOpen} onClose={() => setLeaveOpen(false)} />
      <RespondModal query={respondQuery} onClose={() => setRespondQuery(null)} />
    </div>
  );
}
