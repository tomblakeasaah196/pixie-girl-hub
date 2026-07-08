/**
 * Employee 360 — the "click an employee, see everything" dossier (audit H4).
 *
 * One page for a single staff member: an insights header (earliest/latest
 * arrival, punctuality, tenure, target attainment, quality), then tabbed
 * detail — profile & employment terms, attendance history with map links,
 * pay (payslips + accruals), performance (targets + reviews), and queries &
 * leave. Permission-gated on hr_payroll; PII masking is inherited from the API.
 */

import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Clock,
  Sunrise,
  Sunset,
  Target,
  Wallet,
  Download,
  ShieldAlert,
  CalendarDays,
  FileText,
  MapPin,
  Phone,
  Mail,
  MessageSquare,
} from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState, KpiTile } from "@/components/ui/primitives";
import { DeniedState } from "@/components/ui/controls";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { money } from "@/lib/format";
import { getEmployee360, payslipPdf, updateStaff } from "@/lib/hr-api";
import { Modal } from "@/components/ui/Modal";
import { downloadDocument } from "@/lib/documents-api";
import {
  StatCard,
  SectionTitle,
  QueryStatusPill,
  TabBar,
  WeekScheduleView,
  ClockLocationLink,
  clockTime,
  minutesLabel,
  workDateLabel,
  useNotify,
  errMsg,
  statusTone,
} from "./hr-shared";

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="text-right text-text-primary">{value ?? "—"}</span>
    </div>
  );
}

export default function EmployeeProfilePage() {
  const { profileId = "" } = useParams();
  const navigate = useNavigate();
  const notify = useNotify("HR → Employee profile");
  const can = useAuthStore((s) => s.can);
  const [tab, setTab] = useState("overview");
  const [termsOpen, setTermsOpen] = useState(false);
  useBreadcrumbs([{ label: "HR & Staff", href: "/hr" }, { label: "Employee" }]);

  const allowed = can("hr_payroll", "view");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["hr", "employee-360", profileId],
    queryFn: () => getEmployee360(profileId),
    enabled: allowed && Boolean(profileId),
    retry: false,
  });

  const pdf = useMutation({
    mutationFn: (id: string) => payslipPdf(id),
    onSuccess: (doc) => downloadDocument(doc).catch(() => notify("Download failed", "", "high")),
    onError: (e) => notify("Couldn't generate PDF", errMsg(e), "high"),
  });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <DeniedState message="You don't have access to employee records." />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <EmptyState icon={<ShieldAlert className="h-7 w-7" />} title="Employee not found"
          message="This employee record isn't available for the current brand." />
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-8">
        <Skeleton className="h-24 rounded-[var(--radius)]" />
        <Skeleton className="h-64 rounded-[var(--radius)]" />
      </div>
    );
  }

  const p = data.profile;
  const ins = data.insights;
  const initials = (p.display_name || "?")
    .split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8">
      <button onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary">
        <ChevronLeft className="h-4 w-4" /> Back
      </button>

      {/* Identity header */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-accent/15 font-display text-xl text-accent-glow">
          {initials}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-text-primary">{p.display_name}</h1>
          <p className="text-sm text-text-muted">
            {p.job_title || "—"}{p.department ? ` · ${p.department}` : ""} · {p.employee_number}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-text-muted">
            {p.primary_phone && (
              <a href={`tel:${p.primary_phone}`} className="inline-flex items-center gap-1 hover:text-text-primary">
                <Phone className="h-3 w-3" /> {p.primary_phone}
              </a>
            )}
            {p.contact_email && (
              <a href={`mailto:${p.contact_email}`} className="inline-flex items-center gap-1 hover:text-text-primary">
                <Mail className="h-3 w-3" /> {p.contact_email}
              </a>
            )}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          {p.user_id && (
            <Button icon={<MessageSquare className="h-4 w-4" />}
              onClick={() => navigate(`/smartcomm?dm_user=${p.user_id}`)}>
              Message
            </Button>
          )}
          {p.contact_id && (
            <Button variant="ghost" onClick={() => navigate(`/contacts/${p.contact_id}`)}>
              Contact profile
            </Button>
          )}
        </div>
      </div>

      {/* Insights */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile label="Punctuality (MTD)" value={`${ins.punctuality_pct}%`}
          tone={ins.punctuality_pct >= 90 ? "accent" : "warn"} />
        <KpiTile label="Earned (MTD)" value={money(ins.earned_mtd_ngn)} />
        <StatCard label="Days at risk" value={ins.at_risk_days} tone={ins.at_risk_days ? "danger" : "neutral"} />
        <StatCard label="Late days" value={ins.late_days} tone={ins.late_days ? "warn" : "neutral"} />
        <StatCard label="Tenure (days)" value={ins.tenure_days ?? "—"} />
        <StatCard label="Quality" value={ins.quality_score != null ? ins.quality_score.toFixed(1) : "—"}
          tone="accent" />
        {data.onboarding && data.onboarding.total > 0 && (
          <StatCard label="Onboarding" value={`${data.onboarding.done}/${data.onboarding.total}`}
            tone={data.onboarding.done >= data.onboarding.total ? "success" : "warn"} />
        )}
      </div>

      {/* Earliest / latest — the boss's ask */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Sunrise className="h-4 w-4 text-accent-glow" /> Earliest arrival
          </div>
          <div className="mt-1 font-display text-lg text-text-primary">
            {minutesLabel(ins.earliest_arrival?.local_minutes ?? null)}
          </div>
          <div className="text-xs text-text-faint">{workDateLabel(ins.earliest_arrival?.work_date)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Clock className="h-4 w-4 text-warn" /> Latest arrival
          </div>
          <div className="mt-1 font-display text-lg text-text-primary">
            {minutesLabel(ins.latest_arrival?.local_minutes ?? null)}
          </div>
          <div className="text-xs text-text-faint">{workDateLabel(ins.latest_arrival?.work_date)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Sunset className="h-4 w-4 text-accent-glow" /> Latest departure
          </div>
          <div className="mt-1 font-display text-lg text-text-primary">
            {minutesLabel(ins.latest_departure?.local_minutes ?? null)}
          </div>
          <div className="text-xs text-text-faint">{workDateLabel(ins.latest_departure?.work_date)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Target className="h-4 w-4 text-accent-glow" /> Target attainment
          </div>
          <div className="mt-1 font-display text-lg text-text-primary">
            {ins.target_attainment_pct != null ? `${ins.target_attainment_pct}%` : "—"}
          </div>
          <div className="text-xs text-text-faint">this month</div>
        </Card>
      </div>

      <TabBar
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "overview", label: "Profile" },
          { key: "attendance", label: "Attendance" },
          { key: "pay", label: "Pay" },
          { key: "performance", label: "Performance" },
          { key: "queries", label: "Queries & Leave" },
        ]}
      />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <SectionTitle icon={<CalendarDays className="h-4 w-4 text-accent-glow" />}>Employment</SectionTitle>
            <InfoRow label="Employment type" value={p.employment_type} />
            <InfoRow label="Start date" value={p.start_date} />
            <InfoRow label="End date" value={p.end_date} />
            <InfoRow label="Base salary" value={money(Number(p.base_salary || 0))} />
            <InfoRow label="Bank" value={p.bank_name} />
            <InfoRow label="Account" value={p.bank_account_number} />
            <InfoRow label="Statutory tax" value={p.statutory_exempt ? "Exempt" : "Standard"} />
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <SectionTitle icon={<ShieldAlert className="h-4 w-4 text-accent-glow" />}>Terms & probation</SectionTitle>
              {can("hr_payroll", "edit") && (
                <Button size="sm" variant="ghost" onClick={() => setTermsOpen(true)}>Manage</Button>
              )}
            </div>
            <InfoRow
              label="Probation"
              value={
                <Pill tone={p.probation_status === "passed" ? "success" : p.probation_status === "active" ? "warn" : "neutral"}>
                  {p.probation_status?.replace("_", " ")}
                </Pill>
              }
            />
            <InfoRow label="Probation window" value={p.probation_start_date ? `${p.probation_start_date} → ${p.probation_end_date || "?"}` : "—"} />
            <InfoRow label="Annual leave left" value={`${p.annual_leave_days_remaining} / ${p.annual_leave_days_entitled} days`} />
            <InfoRow label="Non-solicit" value={p.non_solicit_until ? `until ${p.non_solicit_until}` : p.non_solicit_months ? `${p.non_solicit_months} months` : "—"} />
          </Card>
          <Card className="p-5 lg:col-span-2">
            <SectionTitle icon={<Clock className="h-4 w-4 text-accent-glow" />}>Schedule</SectionTitle>
            <WeekScheduleView schedule={data.schedule.work_schedule} />
            <div className="mt-3 text-xs text-text-muted">
              Expected {data.schedule.expected_start_time || "—"} → {data.schedule.expected_end_time || "—"}
            </div>
          </Card>
        </div>
      )}

      {tab === "attendance" && (
        <div className="space-y-2">
          {!data.attendance.length ? (
            <EmptyState icon={<CalendarDays className="h-6 w-6" />} title="No attendance this month yet" />
          ) : (
            data.attendance.map((d) => (
              <Card key={d.day_id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-primary">{workDateLabel(d.work_date)}</span>
                    <span className="text-xs text-text-faint">
                      In {clockTime(d.first_clock_in_at)}
                      {d.last_clock_out_at ? ` · Out ${clockTime(d.last_clock_out_at)}` : ""}
                    </span>
                  </div>
                  <ClockLocationLink day={d} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {d.is_late && <span className="text-xs text-warn">{d.minutes_late}m late</span>}
                  {d.early_leave_minutes > 0 && <span className="text-xs text-warn">{d.early_leave_minutes}m early</span>}
                  {d.deduction_ngn > 0 && !d.justified && (
                    <span className="text-xs text-warn">−{money(Number(d.deduction_ngn))}</span>
                  )}
                  <Pill tone={d.is_offsite ? "warn" : statusTone(d.status)}>{d.status.replace("_", " ")}</Pill>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {tab === "pay" && (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Commission pending" value={money(data.commissions.filter((c) => ["accrued", "approved"].includes(c.status)).reduce((s, c) => s + Number(c.commission_amount_ngn || 0), 0))} tone="accent" />
            <StatCard label="Bonus pending" value={money(data.bonuses.filter((b) => ["pending_approval", "approved"].includes(b.status)).reduce((s, b) => s + Number(b.amount_ngn || 0), 0))} tone="accent" />
          </div>
          <div>
            <SectionTitle icon={<Wallet className="h-4 w-4 text-accent-glow" />}>Payslips</SectionTitle>
            {!data.payslips.length ? (
              <Card className="p-4 text-sm text-text-muted">No payslips yet.</Card>
            ) : (
              <div className="space-y-2">
                {data.payslips.map((s) => (
                  <Card key={s.payslip_id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <span className="text-sm text-text-primary">{s.payslip_number}</span>
                      <div className="text-xs text-text-muted">
                        Net {money(Number(s.net_pay_ngn))}
                        {Number(s.attendance_deduction_ngn) > 0 ? ` · −${money(Number(s.attendance_deduction_ngn))} attendance` : ""}
                      </div>
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
            )}
          </div>
        </div>
      )}

      {tab === "performance" && (
        <div className="space-y-5">
          <div>
            <SectionTitle icon={<Target className="h-4 w-4 text-accent-glow" />}>Targets</SectionTitle>
            {!data.targets.length ? (
              <Card className="p-4 text-sm text-text-muted">No targets this month.</Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.targets.map((t) => (
                  <Card key={t.target_id} className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-text-primary">{t.metric_label}</span>
                      <Pill tone={t.status === "achieved" ? "success" : "accent"}>{t.progress_pct}%</Pill>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-text-primary/[0.06]">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${t.progress_pct}%` }} />
                    </div>
                    <div className="mt-1.5 text-xs text-text-muted">{t.current_value} / {t.target_value} · {t.remaining} to go</div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <div>
            <SectionTitle icon={<FileText className="h-4 w-4 text-accent-glow" />}>Appraisals</SectionTitle>
            {!data.reviews.length ? (
              <Card className="p-4 text-sm text-text-muted">No appraisals yet.</Card>
            ) : (
              <div className="space-y-2">
                {data.reviews.map((r) => (
                  <Card key={r.review_id} className="flex items-center justify-between gap-3 p-3">
                    <span className="text-sm text-text-primary">{r.overall_rating_band?.replace("_", " ") || "—"}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm text-text-primary">{Number(r.overall_weighted_score).toFixed(1)}</span>
                      <Pill tone={statusTone(r.status)}>{r.status}</Pill>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "queries" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <SectionTitle icon={<MapPin className="h-4 w-4 text-warn" />}>Queries</SectionTitle>
            {!data.queries.length ? (
              <Card className="p-4 text-sm text-text-muted">No queries.</Card>
            ) : (
              <div className="space-y-2">
                {data.queries.map((q) => (
                  <Card key={q.query_id} className="p-3">
                    <div className="flex items-center gap-2">
                      <Pill tone={q.source === "auto" ? "warn" : "neutral"}>{q.query_type}</Pill>
                      <QueryStatusPill status={q.status} />
                    </div>
                    <div className="mt-1 text-sm text-text-primary">{q.subject}</div>
                    {q.deduction_ngn ? (
                      <div className="mt-0.5 text-xs text-warn">{money(Number(q.deduction_ngn))} impact</div>
                    ) : null}
                  </Card>
                ))}
              </div>
            )}
          </div>
          <div>
            <SectionTitle icon={<CalendarDays className="h-4 w-4 text-accent-glow" />}>Leave</SectionTitle>
            {!data.leave_requests.length ? (
              <Card className="p-4 text-sm text-text-muted">No leave requests.</Card>
            ) : (
              <div className="space-y-2">
                {data.leave_requests.map((l) => (
                  <Card key={l.leave_id} className="flex items-center justify-between gap-3 p-3">
                    <div>
                      <span className="text-sm capitalize text-text-primary">{l.leave_type}</span>
                      <div className="text-xs text-text-muted">{l.start_date} – {l.end_date} · {l.days_requested}d</div>
                    </div>
                    <Pill tone={statusTone(l.status)}>{l.status}</Pill>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "overview" && data.contracts.length > 0 && (
        <Card className="p-5">
          <SectionTitle icon={<FileText className="h-4 w-4 text-accent-glow" />}>Contracts</SectionTitle>
          <div className="space-y-2">
            {data.contracts.map((c) => (
              <div key={c.contract_id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-text-primary/[0.03] px-3 py-2">
                <span className="text-sm capitalize text-text-primary">{c.contract_type.replace("_", " ")}</span>
                <span className="text-xs text-text-muted">
                  From {c.effective_from}{c.effective_to ? ` to ${c.effective_to}` : " · current"}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-center text-[11px] text-text-faint">
        Attendance figures are month-to-date. <Link to="/hr" className="hover:underline">Back to HR &amp; Staff</Link>
      </p>

      {termsOpen && (
        <TermsEditModal profileId={profileId} profile={p} onClose={() => setTermsOpen(false)} />
      )}
    </div>
  );
}

interface TermsProfile {
  probation_status?: string;
  probation_start_date?: string | null;
  probation_end_date?: string | null;
  probation_outcome?: string | null;
  non_solicit_months?: number | null;
  annual_leave_days_entitled?: number;
  annual_leave_days_remaining?: number;
}

function TermsEditModal({
  profileId,
  profile,
  onClose,
}: {
  profileId: string;
  profile: TermsProfile;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify("HR → Employee: terms");
  const [form, setForm] = useState({
    probation_status: profile.probation_status ?? "not_applicable",
    probation_start_date: profile.probation_start_date ?? "",
    probation_end_date: profile.probation_end_date ?? "",
    non_solicit_months: profile.non_solicit_months != null ? String(profile.non_solicit_months) : "",
    annual_leave_days_entitled: profile.annual_leave_days_entitled != null ? String(profile.annual_leave_days_entitled) : "",
    annual_leave_days_remaining: profile.annual_leave_days_remaining != null ? String(profile.annual_leave_days_remaining) : "",
  });

  const save = useMutation({
    mutationFn: () => {
      const patch: Record<string, unknown> = {
        probation_status: form.probation_status,
        probation_start_date: form.probation_start_date || null,
        probation_end_date: form.probation_end_date || null,
      };
      if (form.non_solicit_months !== "") patch.non_solicit_months = Number(form.non_solicit_months);
      if (form.annual_leave_days_entitled !== "") patch.annual_leave_days_entitled = Number(form.annual_leave_days_entitled);
      if (form.annual_leave_days_remaining !== "") patch.annual_leave_days_remaining = Number(form.annual_leave_days_remaining);
      return updateStaff(profileId, patch);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "employee-360", profileId] });
      notify("Terms updated");
      onClose();
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  const cls = "w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary";
  return (
    <Modal open onClose={onClose} title="Manage terms & probation"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }>
      <div className="space-y-3">
        <label className="block text-xs text-text-muted">Probation status
          <select value={form.probation_status} className={cls}
            onChange={(e) => setForm({ ...form, probation_status: e.target.value })}>
            {["not_applicable", "pending", "active", "passed", "failed", "extended"].map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-text-muted">Probation start
            <input type="date" value={form.probation_start_date} className={cls}
              onChange={(e) => setForm({ ...form, probation_start_date: e.target.value })} />
          </label>
          <label className="block text-xs text-text-muted">Probation end
            <input type="date" value={form.probation_end_date} className={cls}
              onChange={(e) => setForm({ ...form, probation_end_date: e.target.value })} />
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-xs text-text-muted">Non-solicit (months)
            <input type="number" value={form.non_solicit_months} className={cls}
              onChange={(e) => setForm({ ...form, non_solicit_months: e.target.value })} />
          </label>
          <label className="block text-xs text-text-muted">Leave entitled
            <input type="number" value={form.annual_leave_days_entitled} className={cls}
              onChange={(e) => setForm({ ...form, annual_leave_days_entitled: e.target.value })} />
          </label>
          <label className="block text-xs text-text-muted">Leave remaining
            <input type="number" value={form.annual_leave_days_remaining} className={cls}
              onChange={(e) => setForm({ ...form, annual_leave_days_remaining: e.target.value })} />
          </label>
        </div>
      </div>
    </Modal>
  );
}
