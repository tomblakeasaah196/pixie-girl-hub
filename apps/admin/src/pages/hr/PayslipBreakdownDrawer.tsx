/**
 * Payslip breakdown drawer — the per-employee review sheet HR settles pay from.
 *
 * Opened from a payslip row in a payroll run. Shows, for one employee and one
 * period: what they earned, every flagged attendance day with the query the
 * system raised and whatever they wrote back, every commission and bonus being
 * added, and every deduction being taken. Each attendance line can be waived or
 * upheld in place (approval rights only), the projected net updates as decisions
 * are made, and one button commits it to the payslip.
 *
 * The point is that HR never leaves payroll to decide whether a deduction is
 * fair — the evidence and the decision live in the same panel as the money.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Check,
  Download,
  MapPin,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Undo2,
} from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/Drawer";
import { useAuthStore } from "@/stores/auth";
import { money, formatDate, formatTime } from "@/lib/format";
import { downloadDocument } from "@/lib/documents-api";
import {
  payslipBreakdown,
  resolvePayslipAttendance,
  recalculatePayslip,
  payslipPdf,
  type PayslipBreakdown,
  type BreakdownAttendanceLine,
  type BreakdownAddition,
} from "@/lib/hr-api";
import { useNotify, errMsg, statusTone } from "./hr-shared";

const num = (v: unknown) => Number(v ?? 0) || 0;

/** A labelled money row; `tone` colours additions green and deductions warn. */
function LedgerRow({
  label,
  hint,
  amount,
  tone,
  strong,
}: {
  label: string;
  hint?: string | null;
  amount: number;
  tone?: "add" | "deduct";
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className={strong ? "text-sm text-text-primary" : "text-sm text-text-muted"}>
          {label}
        </div>
        {hint && <div className="text-xs text-text-muted/70">{hint}</div>}
      </div>
      <div
        className={[
          "shrink-0 font-mono text-sm tabular-nums",
          strong ? "text-text-primary" : "",
          tone === "deduct" ? "text-warn" : tone === "add" ? "text-success" : "text-text-primary",
        ].join(" ")}
      >
        {tone === "deduct" ? "−" : ""}
        {money(Math.abs(amount))}
      </div>
    </div>
  );
}

function SubHead({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="font-display text-sm text-text-primary">{children}</h3>
      {right}
    </div>
  );
}

/**
 * One attendance line: what happened, what it costs, what the employee said,
 * and — for approvers, while the run is still open — the decision buttons.
 */
function AttendanceCard({
  line,
  editable,
  canApprove,
  pending,
  onDecide,
}: {
  line: BreakdownAttendanceLine;
  editable: boolean;
  canApprove: boolean;
  pending: boolean;
  onDecide: (resolution: "waived" | "upheld") => void;
}) {
  const q = line.query;
  const waived = line.decision === "waived";
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-text-primary">{formatDate(line.work_date)}</span>
            <Pill tone={waived ? "success" : line.decision === "upheld" ? "warn" : "neutral"}>
              {waived ? "waived" : line.decision === "upheld" ? "upheld" : "undecided"}
            </Pill>
            {q?.source === "auto" && <Pill tone="neutral">auto query</Pill>}
          </div>
          <div className="mt-0.5 text-xs text-text-muted">{line.reason}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-muted/70">
            {line.expected_start_time && <span>Due {line.expected_start_time}</span>}
            {line.first_clock_in_at && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                In {formatTime(line.first_clock_in_at)}
              </span>
            )}
            {line.is_offsite && line.clock_in_address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {line.clock_in_address}
              </span>
            )}
            {line.deduction_pct > 0 && <span>{line.deduction_pct}% of the day</span>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={[
              "font-mono text-sm tabular-nums",
              waived ? "text-text-muted line-through" : "text-warn",
            ].join(" ")}
          >
            −{money(line.at_stake_ngn)}
          </div>
          {waived && <div className="text-xs text-success">not deducted</div>}
        </div>
      </div>

      {q && (
        <div className="mt-2.5 rounded-xl border border-line bg-text-primary/[0.03] p-2.5">
          <div className="text-xs text-text-primary">{q.subject}</div>
          {q.details && <div className="mt-0.5 text-xs text-text-muted">{q.details}</div>}
          <div className="mt-2">
            {q.employee_response ? (
              <div className="flex gap-2">
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-glow" />
                <div className="min-w-0">
                  <div className="text-xs text-text-primary">“{q.employee_response}”</div>
                  {q.responded_at && (
                    <div className="text-xs text-text-muted/70">
                      Answered {formatDate(q.responded_at)}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-xs text-text-muted/70">
                No response from the employee yet.
              </div>
            )}
          </div>
          {q.resolution && (
            <div className="mt-2 text-xs text-text-muted/70">
              {q.resolution === "waived" ? "Waived" : "Upheld"}
              {q.resolved_by_name ? ` by ${q.resolved_by_name}` : ""}
              {q.resolved_at ? ` · ${formatDate(q.resolved_at)}` : ""}
              {q.resolution_note ? ` — ${q.resolution_note}` : ""}
            </div>
          )}
        </div>
      )}

      {editable && canApprove && (
        <div className="mt-2.5 flex gap-2">
          <Button
            size="sm"
            variant={waived ? "ghost" : "primary"}
            disabled={pending || waived}
            icon={<Check className="h-3.5 w-3.5" />}
            onClick={() => onDecide("waived")}
          >
            Waive
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || line.decision === "upheld"}
            icon={waived ? <Undo2 className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            onClick={() => onDecide("upheld")}
          >
            {waived ? "Reverse waiver" : "Uphold"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function AdditionCard({ a }: { a: BreakdownAddition }) {
  return (
    <Card className="flex items-start justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm capitalize text-text-primary">{a.label}</span>
          <Pill tone={statusTone(a.status)}>{a.status}</Pill>
        </div>
        <div className="mt-0.5 text-xs text-text-muted">
          {a.reference}
          {a.detail ? ` · ${a.detail}` : ""}
          {a.dated ? ` · ${formatDate(a.dated)}` : ""}
        </div>
      </div>
      <div className="shrink-0 font-mono text-sm tabular-nums text-success">
        +{money(a.amount_ngn)}
      </div>
    </Card>
  );
}

/** The earnings and deductions the slip currently carries, from its own lines. */
function SlipLedger({ data }: { data: PayslipBreakdown }) {
  const p = data.payslip;
  const earnings: [string, number][] = [
    ["Basic salary", num(p.base_salary_ngn)],
    ["Allowances", num(p.allowances_ngn)],
    ["Commission", num(p.commission_ngn)],
    ["Bonuses & rewards", num(p.bonus_ngn)],
  ].filter(([, v]) => (v as number) > 0) as [string, number][];
  const deductions: [string, number][] = [
    ["PAYE", num(p.paye_ngn)],
    ["Pension (employee)", num(p.pension_employee_ngn)],
    ["NHF", num(p.nhf_ngn)],
    ["Attendance", num(p.attendance_deduction_ngn)],
    ["Loan repayment", num(p.loan_repayment_ngn)],
    ["Cash advance recovery", num(p.advance_recovery_ngn)],
    ["Other", num(p.other_deductions_ngn)],
  ].filter(([, v]) => (v as number) > 0) as [string, number][];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Card className="p-3">
        <SubHead>
          <span className="inline-flex items-center gap-1.5">
            <ArrowUpRight className="h-3.5 w-3.5 text-success" /> Earnings
          </span>
        </SubHead>
        {earnings.length ? (
          earnings.map(([l, v]) => <LedgerRow key={l} label={l} amount={v} />)
        ) : (
          <div className="py-1.5 text-sm text-text-muted">Nothing earned this period</div>
        )}
        <div className="mt-1 border-t border-line pt-1.5">
          <LedgerRow label="Gross pay" amount={num(p.gross_pay_ngn)} strong />
        </div>
      </Card>

      <Card className="p-3">
        <SubHead>
          <span className="inline-flex items-center gap-1.5">
            <ArrowDownRight className="h-3.5 w-3.5 text-warn" /> Deductions
          </span>
        </SubHead>
        {deductions.length ? (
          deductions.map(([l, v]) => <LedgerRow key={l} label={l} amount={v} tone="deduct" />)
        ) : (
          <div className="py-1.5 text-sm text-text-muted">No deductions this period</div>
        )}
        <div className="mt-1 border-t border-line pt-1.5">
          <LedgerRow
            label="Total deductions"
            amount={num(p.total_deductions_ngn)}
            tone="deduct"
            strong
          />
        </div>
      </Card>
    </div>
  );
}

export function PayslipBreakdownDrawer({
  payslipId,
  onClose,
}: {
  payslipId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify("HR → Payroll: breakdown");
  const can = useAuthStore((s) => s.can);
  const canApprove = can("hr_payroll", "approve");
  const canEdit = can("hr_payroll", "edit");
  const [busyDay, setBusyDay] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["payroll", "breakdown", payslipId],
    queryFn: () => payslipBreakdown(payslipId!),
    enabled: Boolean(payslipId),
  });

  /** A decision writes through and returns the refreshed sheet — no optimism. */
  const decide = useMutation({
    mutationFn: ({ dayId, resolution }: { dayId: string; resolution: "waived" | "upheld" }) =>
      resolvePayslipAttendance(payslipId!, dayId, { resolution }),
    onSuccess: (fresh, vars) => {
      qc.setQueryData(["payroll", "breakdown", payslipId], fresh);
      notify(vars.resolution === "waived" ? "Deduction waived" : "Deduction upheld");
    },
    onError: (e) => notify("Couldn't apply the decision", errMsg(e), "high"),
    onSettled: () => setBusyDay(null),
  });

  const recalc = useMutation({
    mutationFn: () => recalculatePayslip(payslipId!),
    onSuccess: (fresh) => {
      qc.setQueryData(["payroll", "breakdown", payslipId], fresh);
      // The run's totals and every slip row moved with it.
      qc.invalidateQueries({ queryKey: ["payroll"] });
      notify("Payslip updated", `Net pay is now ${money(num(fresh.totals.net_pay_ngn))}`);
    },
    onError: (e) => notify("Couldn't recalculate", errMsg(e), "high"),
  });

  const pdf = useMutation({
    mutationFn: () => payslipPdf(payslipId!),
    onSuccess: (doc) => downloadDocument(doc).catch(() => notify("Download failed", "", "high")),
    onError: (e) => notify("Couldn't generate PDF", errMsg(e), "high"),
  });

  const p = data?.payslip;
  const t = data?.totals;

  return (
    <Drawer
      open={Boolean(payslipId)}
      onClose={onClose}
      wide
      title={p?.staff_name || p?.payslip_number || "Payslip"}
      subtitle={
        p ? (
          <span>
            {p.payslip_number}
            {p.job_title_snapshot ? ` · ${p.job_title_snapshot}` : ""}
            {p.period_start && p.period_end
              ? ` · ${formatDate(p.period_start)} – ${formatDate(p.period_end)}`
              : ""}
          </span>
        ) : undefined
      }
      footer={
        data ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-text-muted">
                {t?.stale ? "Net pay after recalculation" : "Net pay"}
              </div>
              <div className="font-display text-xl text-accent-glow">
                {money(num(t?.stale ? t?.projected_net_pay_ngn : t?.net_pay_ngn))}
              </div>
              {t?.stale && (
                <div className="text-xs text-text-muted">
                  Currently {money(num(t.net_pay_ngn))} — decisions move it{" "}
                  {t.drift_ngn > 0 ? "up" : "down"} by {money(Math.abs(num(t.drift_ngn)))}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                icon={<Download className="h-4 w-4" />}
                disabled={pdf.isPending}
                onClick={() => pdf.mutate()}
              >
                PDF
              </Button>
              {data.editable && canEdit && (
                <Button
                  variant="primary"
                  icon={<RefreshCw className="h-4 w-4" />}
                  disabled={recalc.isPending}
                  onClick={() => recalc.mutate()}
                >
                  {recalc.isPending ? "Applying…" : "Apply & recalculate"}
                </Button>
              )}
            </div>
          </div>
        ) : undefined
      }
    >
      {isLoading && <Skeleton className="h-72 rounded-[var(--radius)]" />}

      {isError && (
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          title="Couldn't load this payslip"
          message="The breakdown didn't come back."
          action={<Button onClick={() => refetch()}>Retry</Button>}
        />
      )}

      {data && p && t && (
        <div className="space-y-5">
          {/* Where the money stands */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Gross", value: money(num(t.gross_pay_ngn)) },
              { label: "Additions", value: `+${money(num(data.additions_total_ngn))}` },
              { label: "Deductions", value: `−${money(num(t.total_deductions_ngn))}` },
              { label: "Net", value: money(num(t.net_pay_ngn)) },
            ].map((s) => (
              <Card key={s.label} className="p-2.5">
                <div className="text-xs uppercase tracking-wider text-text-muted">{s.label}</div>
                <div className="font-mono text-sm tabular-nums text-text-primary">{s.value}</div>
              </Card>
            ))}
          </div>

          {t.stale && (
            <Card className="flex items-start gap-2.5 border-warn/40 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
              <div className="text-sm text-text-muted">
                This payslip was calculated before the current attendance decisions. Recalculating
                changes net pay from{" "}
                <span className="text-text-primary">{money(num(t.net_pay_ngn))}</span> to{" "}
                <span className="text-text-primary">{money(num(t.projected_net_pay_ngn))}</span>.
                {data.editable && canEdit ? " Use “Apply & recalculate” below." : ""}
              </div>
            </Card>
          )}

          {!data.editable && (
            <Card className="p-3 text-sm text-text-muted">
              This run is <span className="text-text-primary">{data.run_status}</span> — attendance
              decisions are locked. Reverse the run to change them.
            </Card>
          )}

          <SlipLedger data={data} />

          {/* Attendance — the waive/uphold loop */}
          <div>
            <SubHead
              right={
                <span className="text-xs text-text-muted">
                  {money(num(t.attendance_live_ngn))} standing
                  {num(t.attendance_waived_ngn) > 0
                    ? ` · ${money(num(t.attendance_waived_ngn))} waived`
                    : ""}
                </span>
              }
            >
              Lateness &amp; attendance
            </SubHead>
            {!data.attendance.length ? (
              <Card className="p-3 text-sm text-text-muted">
                Nothing flagged this period — full attendance.
              </Card>
            ) : (
              <div className="space-y-2">
                {data.attendance.map((line) => (
                  <AttendanceCard
                    key={line.day_id}
                    line={line}
                    editable={data.editable}
                    canApprove={canApprove}
                    pending={busyDay === line.day_id && decide.isPending}
                    onDecide={(resolution) => {
                      setBusyDay(line.day_id);
                      decide.mutate({ dayId: line.day_id, resolution });
                    }}
                  />
                ))}
                {!canApprove && data.editable && (
                  <p className="text-xs text-text-muted/70">
                    Waiving or upholding a deduction needs payroll approval rights.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Additions — commissions, bonuses, rewards */}
          <div>
            <SubHead
              right={
                <span className="text-xs text-success">+{money(num(data.additions_total_ngn))}</span>
              }
            >
              Additions — commission, bonuses &amp; rewards
            </SubHead>
            {!data.additions.length ? (
              <Card className="p-3 text-sm text-text-muted">
                No commission or bonuses for this period.
              </Card>
            ) : (
              <div className="space-y-2">
                {data.additions.map((a) => (
                  <AdditionCard key={`${a.kind}:${a.id}`} a={a} />
                ))}
              </div>
            )}
          </div>

          {/* Period context */}
          <Card className="p-3">
            <SubHead>Period</SubHead>
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {[
                ["Payroll run", p.run_number],
                ["Employee no.", p.employee_number],
                ["Department", p.department_snapshot],
                [
                  "Days worked",
                  p.days_worked != null && p.working_days_in_period != null
                    ? `${p.days_worked} of ${p.working_days_in_period}`
                    : null,
                ],
              ]
                .filter(([, v]) => Boolean(v))
                .map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between gap-3">
                    <span className="text-text-muted">{k}</span>
                    <span className="text-text-primary">{v}</span>
                  </div>
                ))}
            </div>
          </Card>
        </div>
      )}
    </Drawer>
  );
}
