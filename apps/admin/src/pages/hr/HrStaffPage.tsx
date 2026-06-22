/**
 * HR & Staff — the manager/HR surface (meeting §3, answer #13).
 *
 * Clones the reference HrHub and extends it: overview, leave inbox, the
 * lateness-query waiver loop (answer #3), attendance reconcile, the monthly
 * target setter (answer #4), and an HR Settings/Config tab (answer #2/#8 —
 * lateness tiers, working days, CEO payout PIN). Permission-gated on
 * hr_payroll; CEO bypasses.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Users,
  UserPlus,
  Plane,
  CalendarCheck,
  MessageSquareWarning,
  RefreshCw,
  Check,
  X,
  Target,
  Settings as SettingsIcon,
  ShieldCheck,
  MapPin,
  FileText,
} from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState, KpiTile } from "@/components/ui/primitives";
import { DeniedState } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { money } from "@/lib/format";
import {
  getOverview,
  getAnalytics,
  reconcileDay,
  listLeave,
  approveLeave,
  rejectLeave,
  listQueries,
  raiseQuery,
  resolveQuery,
  listAttendanceDays,
  listTargets,
  setTarget,
  getSettings,
  updateSettings,
  setPayoutPin,
  applyLapsedOffsite,
  listStaff,
  generateContract,
  type HrSettings,
} from "@/lib/hr-api";
import { OfficeGeofenceSettings } from "./OfficeGeofenceSettings";
import {
  StatCard,
  SectionTitle,
  QueryStatusPill,
  TabBar,
  useNotify,
  errMsg,
  statusTone,
} from "./hr-shared";

// ── Leave inbox ────────────────────────────────────────────
function LeaveInbox() {
  const qc = useQueryClient();
  const notify = useNotify();
  const { data, isLoading } = useQuery({
    queryKey: ["hr", "leave", "pending"],
    queryFn: () => listLeave({ status: "pending" }),
  });
  const inval = () => {
    qc.invalidateQueries({ queryKey: ["hr"] });
  };
  const approve = useMutation({
    mutationFn: (id: string) => approveLeave(id),
    onSuccess: () => { inval(); notify("Leave approved"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectLeave(id),
    onSuccess: () => { inval(); notify("Leave rejected"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  if (isLoading) return <Skeleton className="h-32 rounded-[var(--radius)]" />;
  if (!data?.length)
    return <EmptyState icon={<Plane className="h-6 w-6" />} title="No pending leave requests" />;

  return (
    <div className="space-y-2">
      {data.map((l) => (
        <Card key={l.leave_id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-primary">{l.staff_name || "Staff"}</span>
              <Pill tone={l.leave_type === "unpaid" ? "danger" : "neutral"}>{l.leave_type}</Pill>
            </div>
            <div className="text-xs text-text-muted">
              {l.start_date} – {l.end_date} · {l.days_requested} day{l.days_requested > 1 ? "s" : ""}
              {l.reason ? ` · ${l.reason}` : ""}
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button size="sm" variant="primary" icon={<Check className="h-3.5 w-3.5" />}
              onClick={() => approve.mutate(l.leave_id)}>Approve</Button>
            <Button size="sm" icon={<X className="h-3.5 w-3.5" />}
              onClick={() => reject.mutate(l.leave_id)}>Reject</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Queries panel (with waive/uphold) ──────────────────────
function QueriesPanel() {
  const qc = useQueryClient();
  const notify = useNotify();
  const { data, isLoading } = useQuery({
    queryKey: ["hr", "queries", "open"],
    queryFn: () => listQueries({ open: "true" }),
  });
  const resolve = useMutation({
    mutationFn: ({ id, res }: { id: string; res: "waived" | "upheld" }) => resolveQuery(id, res),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["hr"] });
      notify(v.res === "waived" ? "Lateness waived" : "Deduction upheld",
        v.res === "waived" ? "Salary restored for that day." : "It will roll into net pay.");
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  if (isLoading) return <Skeleton className="h-32 rounded-[var(--radius)]" />;
  if (!data?.length)
    return <EmptyState icon={<MessageSquareWarning className="h-6 w-6" />} title="No open queries" />;

  return (
    <div className="space-y-2">
      {data.map((q) => (
        <Card key={q.query_id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-primary">{q.staff_name || "Staff"}</span>
                <Pill tone={q.source === "auto" ? "warn" : "neutral"}>{q.query_type}</Pill>
                <QueryStatusPill status={q.status} />
              </div>
              <div className="mt-0.5 text-xs text-text-muted">{q.subject}</div>
              {q.employee_response && (
                <div className="mt-2 rounded-lg border border-line bg-text-primary/[0.03] p-2 text-xs text-text-muted">
                  <span className="text-text-faint">Response: </span>{q.employee_response}
                </div>
              )}
              {q.deduction_ngn ? (
                <div className="mt-1 text-xs text-warn">{money(Number(q.deduction_ngn))} at stake</div>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" variant="primary"
                onClick={() => resolve.mutate({ id: q.query_id, res: "waived" })}>Waive</Button>
              <Button size="sm"
                onClick={() => resolve.mutate({ id: q.query_id, res: "upheld" })}>Uphold</Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Raise-query modal ──────────────────────────────────────
function RaiseQueryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const { data: staff } = useQuery({
    queryKey: ["hr", "staff", "for-query"],
    queryFn: () => listStaff({ page_size: "200" }),
    enabled: open,
  });
  const [form, setForm] = useState({ profile_id: "", query_type: "conduct", severity: "normal", subject: "", details: "" });
  const mut = useMutation({
    mutationFn: () => raiseQuery(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr"] });
      notify("Query sent to employee");
      onClose();
      setForm({ profile_id: "", query_type: "conduct", severity: "normal", subject: "", details: "" });
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  return (
    <Modal open={open} onClose={onClose} title="Query an employee"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!form.profile_id || !form.subject.trim() || mut.isPending}
            onClick={() => mut.mutate()}>{mut.isPending ? "Sending…" : "Send query"}</Button>
        </>
      }>
      <div className="space-y-3">
        <select value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
          <option value="">— select employee —</option>
          {staff?.data?.map((s) => (
            <option key={s.profile_id} value={s.profile_id}>{s.display_name}</option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <select value={form.query_type} onChange={(e) => setForm({ ...form, query_type: e.target.value })}
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
            {["lateness", "absence", "offsite_clockin", "conduct", "performance", "other"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
            {["low", "normal", "high"].map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
        </div>
        <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}
          placeholder="Subject"
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        <textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })}
          rows={4} placeholder="Describe what needs explaining…"
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
      </div>
    </Modal>
  );
}

// ── Set-target modal ───────────────────────────────────────
function SetTargetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify();
  const now = new Date();
  const { data: staff } = useQuery({
    queryKey: ["hr", "staff", "for-target"],
    queryFn: () => listStaff({ page_size: "200" }),
    enabled: open,
  });
  const [form, setForm] = useState({
    profile_id: "", metric: "styles_completed", metric_label: "Styles completed",
    target_value: 100, reward_type: "pct_salary", reward_value: 20, source: "operations",
  });
  const mut = useMutation({
    mutationFn: () => setTarget({
      profile_id: form.profile_id,
      period_month: now.getMonth() + 1,
      period_year: now.getFullYear(),
      metric: form.metric,
      metric_label: form.metric_label,
      target_value: Number(form.target_value),
      reward_type: form.reward_type,
      reward_value: Number(form.reward_value),
      source: form.source,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr"] });
      notify("Target set", "The employee will see a live countdown.");
      onClose();
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  return (
    <Modal open={open} onClose={onClose} title="Set monthly target"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!form.profile_id || !form.target_value || mut.isPending}
            onClick={() => mut.mutate()}>{mut.isPending ? "Saving…" : "Set target"}</Button>
        </>
      }>
      <div className="space-y-3">
        <select value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
          <option value="">— select employee —</option>
          {staff?.data?.map((s) => (<option key={s.profile_id} value={s.profile_id}>{s.display_name}</option>))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <select value={form.metric}
            onChange={(e) => setForm({ ...form, metric: e.target.value, source: e.target.value.startsWith("sales") ? "sales" : "operations" })}
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
            <option value="styles_completed">Styles completed</option>
            <option value="services_completed">Services completed</option>
            <option value="sales_count">Sales count</option>
            <option value="sales_revenue">Sales revenue</option>
            <option value="custom">Custom</option>
          </select>
          <input type="number" value={form.target_value}
            onChange={(e) => setForm({ ...form, target_value: Number(e.target.value) })}
            placeholder="Target"
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        </div>
        <input value={form.metric_label} onChange={(e) => setForm({ ...form, metric_label: e.target.value })}
          placeholder="Label shown to employee"
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        <div className="grid grid-cols-2 gap-3">
          <select value={form.reward_type} onChange={(e) => setForm({ ...form, reward_type: e.target.value })}
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
            <option value="pct_salary">% of salary bonus</option>
            <option value="fixed_ngn">Fixed ₦ bonus</option>
            <option value="none">No reward</option>
          </select>
          <input type="number" value={form.reward_value}
            onChange={(e) => setForm({ ...form, reward_value: Number(e.target.value) })}
            placeholder="Reward"
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        </div>
        <p className="text-xs text-text-faint">
          Progress is auto-counted from {form.source === "sales" ? "Sales" : "Operations"} as work
          completes. (Operations module wires in later — see code seam.)
        </p>
      </div>
    </Modal>
  );
}

// ── Generate-contract modal ────────────────────────────────
function GenerateContractModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notify = useNotify();
  const { data: staff } = useQuery({
    queryKey: ["hr", "staff", "for-contract"],
    queryFn: () => listStaff({ page_size: "200" }),
    enabled: open,
  });
  const [form, setForm] = useState({ profile_id: "", contract_type: "full_time", effective_from: "", notes: "" });
  const mut = useMutation({
    mutationFn: () =>
      generateContract(form.profile_id, {
        contract_type: form.contract_type,
        effective_from: form.effective_from || undefined,
        notes: form.notes || undefined,
      }),
    onSuccess: () => {
      notify("Contract generated", "Saved as a PDF on the employee. Send for e-signature from Documents.");
      onClose();
      setForm({ profile_id: "", contract_type: "full_time", effective_from: "", notes: "" });
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  return (
    <Modal open={open} onClose={onClose} title="Generate contract"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!form.profile_id || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Generating…" : "Generate PDF"}
          </Button>
        </>
      }>
      <div className="space-y-3">
        <select value={form.profile_id} onChange={(e) => setForm({ ...form, profile_id: e.target.value })}
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
          <option value="">— select employee —</option>
          {staff?.data?.map((s) => (<option key={s.profile_id} value={s.profile_id}>{s.display_name}</option>))}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <select value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary">
            {["full_time", "part_time", "contract", "amendment", "termination"].map((t) => (
              <option key={t} value={t}>{t.replace("_", " ")}</option>
            ))}
          </select>
          <input type="date" value={form.effective_from}
            onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
            className="rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        </div>
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          rows={3} placeholder="Additional terms (optional)"
          className="w-full rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
        <p className="text-xs text-text-faint">
          Salary defaults to the employee's base salary. The PDF is stored on the employee and can be
          routed for e-signature from Documents.
        </p>
      </div>
    </Modal>
  );
}

// ── Settings tab ───────────────────────────────────────────
function SettingsTab() {
  const qc = useQueryClient();
  const notify = useNotify();
  const { data, isLoading } = useQuery({ queryKey: ["hr", "settings"], queryFn: getSettings });
  const [pin, setPin] = useState("");
  const save = useMutation({
    mutationFn: (patch: Partial<HrSettings>) => updateSettings(patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr", "settings"] }); notify("Settings saved"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  const savePin = useMutation({
    mutationFn: () => setPayoutPin(pin),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["hr", "settings"] }); setPin(""); notify("Payout PIN set"); },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  if (isLoading || !data) return <Skeleton className="h-64 rounded-[var(--radius)]" />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <SectionTitle>Lateness deductions</SectionTitle>
        <p className="mb-3 text-xs text-text-muted">
          Tiers applied to the day's pay. Every late clock-in auto-raises a query the employee must
          answer; you waive or uphold it.
        </p>
        <div className="space-y-2">
          {data.lateness_tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-text-muted">After</span>
              <span className="font-display text-text-primary">{t.after_minutes}m</span>
              <span className="text-text-muted">→ deduct</span>
              <span className="font-display text-warn">{t.deduction_pct}%</span>
            </div>
          ))}
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={data.lateness_enabled}
            onChange={(e) => save.mutate({ lateness_enabled: e.target.checked })} />
          Lateness deductions enabled
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={data.lateness_auto_query}
            onChange={(e) => save.mutate({ lateness_auto_query: e.target.checked })} />
          Auto-raise a query for every lateness
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={data.earnings_tracker_enabled}
            onChange={(e) => save.mutate({ earnings_tracker_enabled: e.target.checked })} />
          Real-time earnings tracker enabled
        </label>
      </Card>

      <Card className="p-5">
        <SectionTitle icon={<MapPin className="h-4 w-4 text-accent-glow" />}>
          Geofenced clock-in
        </SectionTitle>
        <p className="mb-3 text-xs text-text-muted">
          On on-site days, clock-ins are checked against your office perimeters.
          Off-site clock-ins are flagged and auto-queried.
        </p>
        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={data.geofence_enabled}
            onChange={(e) => save.mutate({ geofence_enabled: e.target.checked })} />
          Enforce office geofence
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={data.geofence_required_on_site}
            onChange={(e) => save.mutate({ geofence_required_on_site: e.target.checked })} />
          Require location to clock in (on-site days)
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={data.offsite_auto_query}
            onChange={(e) => save.mutate({ offsite_auto_query: e.target.checked })} />
          Auto-raise a query for off-site clock-ins
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-text-primary">
          <input type="checkbox" checked={data.offsite_marks_absent}
            onChange={(e) => save.mutate({ offsite_marks_absent: e.target.checked })} />
          Mark absent if an off-site query is upheld or lapses
        </label>
        <label className="mt-3 block text-xs font-medium text-text-muted">
          Max GPS accuracy to trust: <span className="text-text-primary">{data.geofence_accuracy_max_m} m</span>
          <input type="range" min={20} max={500} step={10} value={data.geofence_accuracy_max_m}
            onChange={(e) => save.mutate({ geofence_accuracy_max_m: Number(e.target.value) })}
            className="mt-1 w-full accent-[#690909]" />
        </label>
      </Card>

      <div className="lg:col-span-2">
        <OfficeGeofenceSettings />
      </div>

      <Card className="p-5">
        <SectionTitle icon={<ShieldCheck className="h-4 w-4 text-accent-glow" />}>
          Payout authorisation
        </SectionTitle>
        <p className="mb-3 text-xs text-text-muted">
          The CEO enters this PIN to authorise salary payouts at the end of the month.
          Provider: <span className="text-text-primary">{data.payout_provider}</span>.
        </p>
        <div className="flex items-center gap-2">
          <Pill tone={data.payout_pin_set ? "success" : "warn"}>
            {data.payout_pin_set ? "PIN set" : "No PIN yet"}
          </Pill>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input type="password" inputMode="numeric" value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="4–8 digit PIN" maxLength={8}
            className="w-40 rounded-xl border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary" />
          <Button variant="primary" disabled={pin.length < 4 || savePin.isPending}
            onClick={() => savePin.mutate()}>{data.payout_pin_set ? "Replace PIN" : "Set PIN"}</Button>
        </div>
      </Card>

      <Card className="p-5 lg:col-span-2">
        <SectionTitle>Working week</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => {
            const on = data.working_days.includes(d);
            return (
              <button key={d}
                onClick={() => save.mutate({
                  working_days: on ? data.working_days.filter((x) => x !== d) : [...data.working_days, d],
                })}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase ${
                  on ? "border-accent/30 bg-accent/15 text-accent-glow" : "border-line text-text-muted"
                }`}>
                {d}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ── Attendance tab ─────────────────────────────────────────
function AttendanceTab() {
  const qc = useQueryClient();
  const notify = useNotify();
  const today = new Date().toISOString().slice(0, 10);
  const { data, isLoading } = useQuery({
    queryKey: ["hr", "attendance-days", today],
    queryFn: () => listAttendanceDays({ from: today, to: today }),
  });
  const lapse = useMutation({
    mutationFn: () => applyLapsedOffsite(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["hr"] });
      notify("Lapsed off-site penalties applied", `${r.marked_absent} day(s) marked absent`);
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });
  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius)]" />;
  if (!data?.length)
    return <EmptyState icon={<CalendarCheck className="h-6 w-6" />} title="Nothing reconciled for today yet"
      message="Run “Reconcile today” to compute attendance, lateness, off-site flags and deductions." />;
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" icon={<MapPin className="h-3.5 w-3.5" />} disabled={lapse.isPending}
          onClick={() => lapse.mutate()}>
          Apply lapsed off-site penalties
        </Button>
      </div>
      {data.map((d) => (
        <Card key={d.day_id} className="flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <span className="text-sm text-text-primary">{d.staff_name || "Staff"}</span>
            {d.clock_in_address && (
              <div className="flex items-center gap-1 text-xs text-text-muted">
                <MapPin className="h-3 w-3" /> {d.clock_in_address}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {d.is_offsite && (
              <span className="text-xs text-warn">
                off-site{d.offsite_distance_m ? ` ${Math.round(Number(d.offsite_distance_m))}m` : ""}
              </span>
            )}
            {d.is_late && <span className="text-xs text-warn">{d.minutes_late}m late</span>}
            {d.deduction_ngn > 0 && !d.justified && (
              <span className="text-xs text-warn">−{money(Number(d.deduction_ngn))}</span>
            )}
            <Pill tone={d.is_offsite ? "warn" : statusTone(d.status)}>
              {d.status.replace("_", " ")}
            </Pill>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Targets tab ────────────────────────────────────────────
function TargetsTab({ onAdd }: { onAdd: () => void }) {
  const now = new Date();
  const { data, isLoading } = useQuery({
    queryKey: ["hr", "targets", now.getMonth()],
    queryFn: () => listTargets({
      status: "active",
      period_year: String(now.getFullYear()),
      period_month: String(now.getMonth() + 1),
    }),
  });
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Target className="h-4 w-4" />} onClick={onAdd}>Set target</Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-32 rounded-[var(--radius)]" />
      ) : !data?.length ? (
        <EmptyState icon={<Target className="h-6 w-6" />} title="No targets set this month" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((t) => (
            <Card key={t.target_id} className="p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-text-primary">{t.staff_name}</span>
                <Pill tone={t.status === "achieved" ? "success" : "accent"}>{t.progress_pct}%</Pill>
              </div>
              <div className="mt-1 text-xs text-text-muted">{t.metric_label}</div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-text-primary/[0.06]">
                <div className="h-full rounded-full bg-accent" style={{ width: `${t.progress_pct}%` }} />
              </div>
              <div className="mt-1.5 text-xs text-text-muted">
                {t.current_value} / {t.target_value} · {t.remaining} to go
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Analytics tab ──────────────────────────────────────────
function AnalyticsTab() {
  const { data, isLoading } = useQuery({ queryKey: ["hr", "analytics"], queryFn: getAnalytics });
  if (isLoading || !data) return <Skeleton className="h-48 rounded-[var(--radius)]" />;
  const a = data.attendance;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiTile label="Headcount" value={String(data.headcount)} />
        <KpiTile label="Punctuality (MTD)" value={`${a.punctuality_pct}%`}
          tone={a.punctuality_pct >= 90 ? "accent" : "warn"} />
        <KpiTile label="Earned (MTD)" value={money(data.earned_mtd_ngn)} />
        <KpiTile label="Lateness deductions" value={money(data.lateness_deductions_ngn)} tone="warn" />
        <KpiTile label="Late days" value={String(a.late_days)} tone="warn" />
        <KpiTile label="Absent days" value={String(a.absent_days)} tone="warn" />
        <KpiTile label="Off-site days" value={String(a.offsite_days)} tone="warn" />
        <KpiTile label="On leave (days)" value={String(a.leave_days)} tone="info" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Open queries" value={data.open_queries} tone="danger" />
        <StatCard label="Pending leave" value={data.pending_leave} tone="accent" />
        <StatCard label="Active targets" value={data.targets.active} />
        <StatCard label="Targets achieved" value={data.targets.achieved} tone="success" />
      </div>
      <p className="text-xs text-text-faint">
        Month-to-date for the current brand. Run “Reconcile today” (or the nightly sweep)
        to keep attendance figures current.
      </p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────
export default function HrStaffPage() {
  useBreadcrumbs([{ label: "HR & Staff" }]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const notify = useNotify();
  const can = useAuthStore((s) => s.can);
  const [tab, setTab] = useState("overview");
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);

  const allowed = can("hr_payroll", "view");
  const { data: overview, isLoading } = useQuery({
    queryKey: ["hr", "overview"],
    queryFn: getOverview,
    enabled: allowed,
  });

  const reconcile = useMutation({
    mutationFn: () => reconcileDay(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["hr"] });
      notify("Reconciled today", `${r.records_created} records · ${r.late_count} late`);
    },
    onError: (e) => notify("Failed", errMsg(e), "high"),
  });

  if (!allowed) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8">
        <DeniedState message="You don't have access to HR & Staff." />
      </div>
    );
  }

  const c = overview?.counts;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">HR & Staff</h1>
          <p className="text-sm text-text-muted">
            People · attendance · leave · queries · performance.
          </p>
        </div>
        <div className="flex gap-2">
          <Button icon={<Users className="h-4 w-4" />} onClick={() => navigate("/contacts?tab=staff")}>
            Directory
          </Button>
          {can("hr_payroll", "edit") && (
            <Button icon={<FileText className="h-4 w-4" />} onClick={() => setContractOpen(true)}>
              Generate contract
            </Button>
          )}
          <Button variant="primary" icon={<UserPlus className="h-4 w-4" />}
            onClick={() => navigate("/contacts/staff/new")}>
            Onboard employee
          </Button>
        </div>
      </div>

      <TabBar
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "leave", label: "Leave", badge: c?.pending_leave || undefined },
          { key: "attendance", label: "Attendance" },
          { key: "queries", label: "Queries", badge: c?.open_queries || undefined },
          { key: "targets", label: "Targets" },
          { key: "analytics", label: "Analytics" },
          { key: "settings", label: "Settings" },
        ]}
      />

      {tab === "overview" &&
        (isLoading || !c ? (
          <Skeleton className="h-40 rounded-[var(--radius)]" />
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Total staff" value={c.total_staff} />
              <StatCard label="Present today" value={c.present_today} tone="success" />
              <StatCard label="Late today" value={c.late_today} tone="warn" />
              <StatCard label="On leave" value={c.on_leave_today} tone="info" />
              <StatCard label="Pending leave" value={c.pending_leave} tone="accent" />
              <StatCard label="Open queries" value={c.open_queries} tone="danger" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icon={<MessageSquareWarning className="h-4 w-4" />} onClick={() => setRaiseOpen(true)}>
                Query an employee
              </Button>
              <Button icon={<RefreshCw className="h-4 w-4" />} disabled={reconcile.isPending}
                onClick={() => reconcile.mutate()}>
                {reconcile.isPending ? "Reconciling…" : "Reconcile today's attendance"}
              </Button>
            </div>
            <div>
              <SectionTitle icon={<Plane className="h-4 w-4 text-accent-glow" />}>Pending leave</SectionTitle>
              <LeaveInbox />
            </div>
          </div>
        ))}

      {tab === "leave" && <LeaveInbox />}
      {tab === "attendance" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={reconcile.isPending}
              onClick={() => reconcile.mutate()}>Reconcile today</Button>
          </div>
          <AttendanceTab />
        </div>
      )}
      {tab === "queries" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" icon={<MessageSquareWarning className="h-3.5 w-3.5" />}
              onClick={() => setRaiseOpen(true)}>Query an employee</Button>
          </div>
          <QueriesPanel />
        </div>
      )}
      {tab === "targets" && <TargetsTab onAdd={() => setTargetOpen(true)} />}
      {tab === "analytics" && <AnalyticsTab />}
      {tab === "settings" && (
        can("hr_payroll", "edit")
          ? <SettingsTab />
          : <div className="flex items-center gap-2 text-sm text-text-muted">
              <SettingsIcon className="h-4 w-4" /> You need edit access to change HR settings.
            </div>
      )}

      <RaiseQueryModal open={raiseOpen} onClose={() => setRaiseOpen(false)} />
      <SetTargetModal open={targetOpen} onClose={() => setTargetOpen(false)} />
      <GenerateContractModal open={contractOpen} onClose={() => setContractOpen(false)} />
    </div>
  );
}
