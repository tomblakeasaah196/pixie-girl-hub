/**
 * Payroll — runs, payslips and the meeting's pay flow (§3.4):
 * calculate → review → CEO approve → enter PIN → pay to bank (Nomba) → payslips.
 * Permission-gated on hr_payroll; CEO bypasses.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wallet,
  Plus,
  Calculator,
  ClipboardCheck,
  CheckCircle2,
  Banknote,
  ChevronLeft,
} from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { DeniedState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { money } from "@/lib/format";
import {
  listPayrollRuns,
  createPayrollRun,
  getPayrollRun,
  calculatePayrollRun,
  reviewPayrollRun,
  approvePayrollRun,
  payPayrollRun,
  listPayslips,
  type PayrollRun,
} from "@/lib/hr-api";
import { TabBar, StatCard, SectionTitle, useNotify, errMsg, statusTone } from "./hr-shared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function PayPinModal({
  run,
  onClose,
}: {
  run: PayrollRun | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [pin, setPin] = useState("");
  const mut = useMutation({
    mutationFn: () => payPayrollRun(run!.run_id, pin),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      const d = r.disbursement;
      notify(
        "Payroll paid",
        d ? `${d.paid} paid · ${d.queued} queued · ${d.failed} failed (${d.provider})` : "",
      );
      onClose();
      setPin("");
    },
    onError: (e) => notify("Payment failed", errMsg(e), "high"),
  });
  return (
    <Modal
      open={Boolean(run)}
      onClose={onClose}
      title="Authorise payout"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pin.length < 4 || mut.isPending}
            icon={<Banknote className="h-4 w-4" />} onClick={() => mut.mutate()}>
            {mut.isPending ? "Paying…" : "Pay now"}
          </Button>
        </>
      }
    >
      {run && (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">
            You're about to pay <span className="text-text-primary">{run.run_number}</span> —{" "}
            {money(Number(run.total_net_ngn))} net to {run.total_staff} staff. Enter your payout PIN
            to authorise. Each employee is paid to their registered bank account.
          </p>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="Payout PIN"
            maxLength={8}
            className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary"
          />
        </div>
      )}
    </Modal>
  );
}

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const can = useAuthStore((s) => s.can);
  const [payRun, setPayRun] = useState<PayrollRun | null>(null);

  const { data: run, isLoading } = useQuery({
    queryKey: ["payroll", "run", runId],
    queryFn: () => getPayrollRun(runId),
  });
  const { data: slips } = useQuery({
    queryKey: ["payroll", "slips", runId],
    queryFn: () => listPayslips(runId),
  });

  const calc = useMutation({
    mutationFn: () => calculatePayrollRun(runId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll"] }); notify("Calculated"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  const review = useMutation({
    mutationFn: () => reviewPayrollRun(runId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll"] }); notify("Sent for approval"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  const approve = useMutation({
    mutationFn: () => approvePayrollRun(runId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll"] }); notify("Approved"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  if (isLoading || !run) return <Skeleton className="h-64 rounded-[var(--radius)]" />;

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-text-primary">
        <ChevronLeft className="h-4 w-4" /> All runs
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-text-primary">{run.run_number}</h2>
          <p className="text-sm text-text-muted">
            {MONTHS[run.pay_month - 1]} {run.pay_year} · pay date {run.pay_date}
          </p>
        </div>
        <Pill tone={statusTone(run.status)}>{run.status}</Pill>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Staff" value={run.total_staff} />
        <StatCard label="Gross" value={money(Number(run.total_gross_ngn))} />
        <StatCard label="PAYE" value={money(Number(run.total_paye_ngn))} tone="warn" />
        <StatCard label="Net pay" value={money(Number(run.total_net_ngn))} tone="accent" />
      </div>

      {/* Stepper actions */}
      <div className="flex flex-wrap gap-2">
        {run.status === "draft" && (
          <Button variant="primary" icon={<Calculator className="h-4 w-4" />}
            disabled={calc.isPending} onClick={() => calc.mutate()}>Calculate</Button>
        )}
        {run.status === "calculated" && (
          <>
            <Button icon={<Calculator className="h-4 w-4" />} disabled={calc.isPending}
              onClick={() => calc.mutate()}>Re-calculate</Button>
            <Button variant="primary" icon={<ClipboardCheck className="h-4 w-4" />}
              disabled={review.isPending} onClick={() => review.mutate()}>Send for approval</Button>
          </>
        )}
        {run.status === "reviewed" && can("hr_payroll", "approve") && (
          <Button variant="primary" icon={<CheckCircle2 className="h-4 w-4" />}
            disabled={approve.isPending} onClick={() => approve.mutate()}>Approve</Button>
        )}
        {run.status === "approved" && can("hr_payroll", "approve") && (
          <Button variant="primary" icon={<Banknote className="h-4 w-4" />}
            onClick={() => setPayRun(run)}>Pay (enter PIN)</Button>
        )}
      </div>

      {/* Payslips */}
      <div>
        <SectionTitle icon={<Wallet className="h-4 w-4 text-accent-glow" />}>Payslips</SectionTitle>
        {!slips?.length ? (
          <Card className="p-4 text-sm text-text-muted">
            No payslips yet — calculate the run to generate them.
          </Card>
        ) : (
          <div className="space-y-2">
            {slips.map((s) => (
              <Card key={s.payslip_id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <span className="text-sm text-text-primary">{s.payslip_number}</span>
                  <div className="text-xs text-text-muted">
                    Gross {money(Number(s.gross_pay_ngn))} · Net {money(Number(s.net_pay_ngn))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {s.failure_reason && <span className="text-xs text-danger">{s.failure_reason}</span>}
                  <Pill tone={statusTone(s.payment_status === "paid" ? "approved" : s.payment_status === "failed" ? "rejected" : "pending")}>
                    {s.payment_status}
                  </Pill>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <PayPinModal run={payRun} onClose={() => setPayRun(null)} />
    </div>
  );
}

function CreateRunModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const now = new Date();
  const [form, setForm] = useState({
    pay_month: now.getMonth() + 1,
    pay_year: now.getFullYear(),
    pay_date: now.toISOString().slice(0, 10),
    period_start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    period_end: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
  });
  const mut = useMutation({
    mutationFn: () => createPayrollRun(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll"] }); notify("Run created"); onClose(); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  return (
    <Modal open={open} onClose={onClose} title="New payroll run"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Creating…" : "Create run"}
          </Button>
        </>
      }>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-text-muted">Month
          <select value={form.pay_month} onChange={(e) => setForm({ ...form, pay_month: Number(e.target.value) })}
            className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="text-xs text-text-muted">Year
          <input type="number" value={form.pay_year} onChange={(e) => setForm({ ...form, pay_year: Number(e.target.value) })}
            className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        </label>
        <label className="text-xs text-text-muted">Period start
          <input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })}
            className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        </label>
        <label className="text-xs text-text-muted">Period end
          <input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })}
            className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        </label>
        <label className="col-span-2 text-xs text-text-muted">Pay date
          <input type="date" value={form.pay_date} onChange={(e) => setForm({ ...form, pay_date: e.target.value })}
            className="mt-1 w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        </label>
      </div>
    </Modal>
  );
}

export default function PayrollPage() {
  useBreadcrumbs([{ label: "Payroll" }]);
  const can = useAuthStore((s) => s.can);
  const [tab] = useState("runs");
  const [createOpen, setCreateOpen] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);

  const allowed = can("hr_payroll", "view");
  const { data: runs, isLoading } = useQuery({
    queryKey: ["payroll", "runs"],
    queryFn: listPayrollRuns,
    enabled: allowed,
  });

  if (!allowed) {
    return <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8"><DeniedState message="You don't have access to Payroll." /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">Payroll</h1>
          <p className="text-sm text-text-muted">Monthly runs, payslips and disbursement.</p>
        </div>
        {!openRun && can("hr_payroll", "create") && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            New run
          </Button>
        )}
      </div>

      {openRun ? (
        <RunDetail runId={openRun} onBack={() => setOpenRun(null)} />
      ) : (
        <>
          <TabBar active={tab} onChange={() => {}} tabs={[{ key: "runs", label: "Runs" }]} />
          {isLoading ? (
            <Skeleton className="h-40 rounded-[var(--radius)]" />
          ) : !runs?.length ? (
            <EmptyState icon={<Wallet className="h-6 w-6" />} title="No payroll runs yet"
              message="Create your first monthly run to calculate salaries, commissions and bonuses." />
          ) : (
            <div className="space-y-2">
              {runs.map((r) => (
                <Card key={r.run_id}
                  className="flex cursor-pointer items-center justify-between gap-3 p-4 transition-colors hover:bg-text-primary/[0.03]"
                  >
                  <button className="flex-1 text-left" onClick={() => setOpenRun(r.run_id)}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-primary">{r.run_number}</span>
                      <Pill tone={statusTone(r.status)}>{r.status}</Pill>
                    </div>
                    <div className="text-xs text-text-muted">
                      {MONTHS[r.pay_month - 1]} {r.pay_year} · {r.total_staff} staff · Net {money(Number(r.total_net_ngn))}
                    </div>
                  </button>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <CreateRunModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
