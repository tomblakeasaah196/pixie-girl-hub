/**
 * Device binding UI (migration 000304).
 *
 *   • LiveAttendanceStrip — today's punches, pushed in real time over
 *     Socket.io (no waiting for the nightly reconcile). An unrecognised device
 *     is shown with an unmissable red attention marker.
 *   • MyDevicesSection — self-service enrol/remove of the current device,
 *     each gated by an email OTP (no SMS).
 *   • DevicesTab — HR & Staff view of every employee's devices + a live
 *     change feed (the HR notification surface).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Smartphone,
  Laptop,
  Monitor,
  Tablet,
  HardDrive,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Plus,
  Wifi,
  Activity,
  LogIn,
  LogOut,
  MailCheck,
} from "lucide-react";
import { Card, Button, Pill, Skeleton, EmptyState } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/cn";
import { getDeviceFingerprint } from "@/lib/device-fingerprint";
import { getSocket, joinRoom, leaveRoom, rooms } from "@/lib/socket";
import { useActiveBusiness } from "@/stores/business";
import {
  getMyDevices,
  startDeviceEnroll,
  verifyDeviceEnroll,
  startDeviceRemove,
  verifyDeviceRemove,
  listAllDevices,
  listDeviceChanges,
  listLiveAttendance,
  type DeviceType,
  type StaffDevice,
  type LivePunch,
} from "@/lib/hr-api";
import { useNotify, errMsg, clockTime, SectionTitle } from "./hr-shared";
import { formatDate, formatDateTime } from "@/lib/format";

// ── device type presentation ───────────────────────────────
function DeviceIcon({ type, className }: { type: DeviceType; className?: string }) {
  const Icon =
    type === "laptop"
      ? Laptop
      : type === "desktop"
        ? Monitor
        : type === "tablet"
          ? Tablet
          : type === "other"
            ? HardDrive
            : Smartphone;
  return <Icon className={className} />;
}

const DEVICE_TYPES: { value: DeviceType; label: string }[] = [
  { value: "mobile", label: "Phone" },
  { value: "laptop", label: "Laptop" },
  { value: "desktop", label: "Desktop" },
  { value: "tablet", label: "Tablet" },
  { value: "other", label: "Other" },
];

/** The red, unmissable "unrecognised device" marker (device_recognized=false). */
export function UnknownDeviceFlag() {
  return (
    <span
      title="Clocked in from a device that isn't enrolled — flagged for review"
      className="inline-flex items-center gap-1 rounded-md border border-danger/50 bg-danger/15 px-1.5 py-0.5 text-[11px] font-bold text-danger"
    >
      <ShieldAlert className="h-3.5 w-3.5" />
      Unknown device
    </span>
  );
}

// ── Live attendance strip (real-time, seeded) ──────────────
export function LiveAttendanceStrip() {
  const brand = useActiveBusiness().key;
  const [live, setLive] = useState<LivePunch[]>([]);

  const { data: seed } = useQuery({
    queryKey: ["hr", "attendance", "live"],
    queryFn: listLiveAttendance,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  // Join the brand attendance room and merge pushed punches on top of the seed.
  useEffect(() => {
    getSocket();
    joinRoom(rooms.attendance(brand));
    const onPunch = (e: Event) => {
      const p = (e as CustomEvent<LivePunch>).detail;
      if (!p || !p.event_id) return;
      setLive((prev) => [p, ...prev.filter((x) => x.event_id !== p.event_id)].slice(0, 100));
    };
    window.addEventListener("pgh:attendance:punch", onPunch);
    return () => {
      window.removeEventListener("pgh:attendance:punch", onPunch);
      leaveRoom(rooms.attendance(brand));
    };
  }, [brand]);

  // Reset the socket overlay when the brand changes (the seed refetches).
  useEffect(() => setLive([]), [brand]);

  const rowsMerged = useMemo(() => {
    const byId = new Map<string, LivePunch>();
    for (const r of seed ?? []) byId.set(r.event_id, r);
    for (const r of live) byId.set(r.event_id, r);
    return Array.from(byId.values()).sort((a, b) =>
      a.occurred_at < b.occurred_at ? 1 : -1,
    );
  }, [seed, live]);

  const unknownCount = rowsMerged.filter(
    (r) => r.event_type === "clock_in" && r.device_recognized === false,
  ).length;

  return (
    <Card className="p-3">
      <SectionTitle
        icon={<Activity className="h-4 w-4 text-accent-glow" />}
        action={
          <span className="flex items-center gap-2">
            {unknownCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-danger">
                <ShieldAlert className="h-3.5 w-3.5" />
                {unknownCount} flagged
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] text-text-faint">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              Live
            </span>
          </span>
        }
      >
        Today — live
      </SectionTitle>

      {!rowsMerged.length ? (
        <p className="py-4 text-center text-xs text-text-faint">
          No punches yet today. Clock-ins and clock-outs appear here instantly.
        </p>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {rowsMerged.map((r) => {
            const unknown = r.event_type === "clock_in" && r.device_recognized === false;
            return (
              <div
                key={r.event_id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2",
                  unknown
                    ? "border-danger/50 bg-danger/[0.07]"
                    : "border-line bg-text-primary/[0.02]",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {r.event_type === "clock_in" ? (
                    <LogIn className="h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <LogOut className="h-4 w-4 shrink-0 text-text-muted" />
                  )}
                  <span className="truncate text-sm text-text-primary">
                    {r.display_name || "Staff"}
                  </span>
                  <span className="shrink-0 text-[11px] text-text-faint">
                    {clockTime(r.occurred_at)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {unknown && <UnknownDeviceFlag />}
                  {r.is_offsite && (
                    <span className="text-[11px] text-warn">
                      off-site{r.distance_m ? ` ${Math.round(Number(r.distance_m))}m` : ""}
                    </span>
                  )}
                  <Pill tone={r.event_type === "clock_in" ? "success" : "neutral"}>
                    {r.event_type === "clock_in" ? "in" : "out"}
                  </Pill>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Enrol current device (email OTP, 2 steps) ──────────────
function EnrollDeviceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const notify = useNotify("HR → My devices");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<DeviceType>("mobile");
  const [sentTo, setSentTo] = useState("");
  const [otp, setOtp] = useState("");

  useEffect(() => {
    if (open) {
      setStep("form");
      setLabel("");
      setType("mobile");
      setOtp("");
      setSentTo("");
    }
  }, [open]);

  const start = useMutation({
    mutationFn: () =>
      startDeviceEnroll({
        device_label: label.trim(),
        device_type: type,
        device_fingerprint: getDeviceFingerprint(),
      }),
    onSuccess: (r) => {
      setSentTo(r.sent_to);
      setStep("otp");
    },
    onError: (e) => notify("Couldn't send code", errMsg(e), "high"),
  });

  const verify = useMutation({
    mutationFn: () => verifyDeviceEnroll(otp.trim()),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["hr", "me", "devices"] });
      qc.invalidateQueries({ queryKey: ["hr", "devices"] });
      notify("Device enrolled", `${d.device_label} can now clock in.`);
      onClose();
    },
    onError: (e) => notify("Couldn't verify code", errMsg(e), "high"),
  });

  const inputCls =
    "w-full rounded-lg border border-line bg-text-primary/[0.04] p-2.5 text-sm text-text-primary";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Enrol this device"
      footer={
        step === "form" ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              icon={<MailCheck className="h-4 w-4" />}
              disabled={!label.trim() || start.isPending}
              onClick={() => start.mutate()}
            >
              {start.isPending ? "Sending code…" : "Send code"}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep("form")}>Back</Button>
            <Button
              variant="primary"
              disabled={otp.trim().length !== 6 || verify.isPending}
              onClick={() => verify.mutate()}
            >
              {verify.isPending ? "Verifying…" : "Enrol device"}
            </Button>
          </div>
        )
      }
    >
      {step === "form" ? (
        <div className="space-y-3">
          <p className="text-xs text-text-muted">
            Bind the device you're using now so only you can clock in from it. We'll
            email a 6-digit code to your registered address to confirm it's you.
          </p>
          <label className="block text-xs text-text-muted">
            Device name
            <input
              autoFocus
              value={label}
              maxLength={60}
              placeholder="e.g. My iPhone, Office laptop"
              onChange={(e) => setLabel(e.target.value)}
              className={cn("mt-1", inputCls)}
            />
          </label>
          <div className="block text-xs text-text-muted">
            Type
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DEVICE_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    type === t.value
                      ? "border-accent/40 bg-accent/15 text-accent-glow"
                      : "border-line text-text-muted hover:text-text-primary",
                  )}
                >
                  <DeviceIcon type={t.value} className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-text-muted">
            Enter the 6-digit code sent to <span className="text-text-primary">{sentTo}</span>.
          </p>
          <input
            autoFocus
            inputMode="numeric"
            value={otp}
            maxLength={6}
            placeholder="000000"
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
            className={cn("text-center font-mono text-lg tracking-[0.4em]", inputCls)}
          />
        </div>
      )}
    </Modal>
  );
}

// ── Remove a device (email OTP) ────────────────────────────
function RemoveDeviceModal({
  device,
  onClose,
}: {
  device: StaffDevice | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify("HR → My devices");
  const [sentTo, setSentTo] = useState("");
  const [otp, setOtp] = useState("");
  const startedFor = useRef<string | null>(null);

  const start = useMutation({
    mutationFn: (id: string) => startDeviceRemove(id),
    onSuccess: (r) => setSentTo(r.sent_to),
    onError: (e) => notify("Couldn't send code", errMsg(e), "high"),
  });

  // Kick off the OTP the moment the modal opens for a device.
  useEffect(() => {
    if (device && startedFor.current !== device.device_id) {
      startedFor.current = device.device_id;
      setOtp("");
      setSentTo("");
      start.mutate(device.device_id);
    }
    if (!device) startedFor.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  const verify = useMutation({
    mutationFn: () => verifyDeviceRemove(device!.device_id, otp.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hr", "me", "devices"] });
      qc.invalidateQueries({ queryKey: ["hr", "devices"] });
      notify("Device removed", `${device?.device_label} can no longer clock in.`);
      onClose();
    },
    onError: (e) => notify("Couldn't verify code", errMsg(e), "high"),
  });

  return (
    <Modal
      open={Boolean(device)}
      onClose={onClose}
      title="Remove device"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={otp.trim().length !== 6 || verify.isPending}
            onClick={() => verify.mutate()}
          >
            {verify.isPending ? "Removing…" : "Remove device"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-text-muted">
          Removing <span className="text-text-primary">{device?.device_label}</span> stops
          it clocking in. HR is notified of the change. Enter the 6-digit code we emailed
          {sentTo ? <> to <span className="text-text-primary">{sentTo}</span></> : null} to confirm.
        </p>
        <input
          autoFocus
          inputMode="numeric"
          value={otp}
          maxLength={6}
          placeholder="000000"
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
          className="w-full rounded-lg border border-line bg-text-primary/[0.04] p-2.5 text-center font-mono text-lg tracking-[0.4em] text-text-primary"
        />
      </div>
    </Modal>
  );
}

// ── My devices (self-service, in My HR) ────────────────────
export function MyDevicesSection() {
  const { data, isLoading } = useQuery({
    queryKey: ["hr", "me", "devices"],
    queryFn: getMyDevices,
  });
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [removing, setRemoving] = useState<StaffDevice | null>(null);
  const thisFp = getDeviceFingerprint();

  // Be tolerant of shape drift: earlier server builds returned a bare array
  // here, so `data.data` was undefined and `.length` blew up the whole page.
  const devices: StaffDevice[] = Array.isArray(data?.data) ? data.data : [];
  const cap = data?.max_devices;
  const canAdd = data?.can_add ?? true;

  return (
    <div>
      <SectionTitle
        icon={<Smartphone className="h-4 w-4 text-accent-glow" />}
        action={
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="h-3.5 w-3.5" />}
            disabled={!canAdd}
            title={canAdd ? "Enrol this device" : "Remove a device first — you're at the limit"}
            onClick={() => setEnrollOpen(true)}
          >
            Enrol this device
          </Button>
        }
      >
        My devices{cap != null ? ` (${devices.length}/${cap})` : ""}
      </SectionTitle>

      {isLoading ? (
        <Skeleton className="h-24 rounded-[var(--radius)]" />
      ) : !devices.length ? (
        <EmptyState
          icon={<Smartphone className="h-6 w-6" />}
          title="No devices enrolled yet"
          message="Enrol the phone or laptop you clock in with. Clock-ins from an un-enrolled device still work but are flagged for HR."
        />
      ) : (
        <div className="space-y-2">
          {devices.map((d) => {
            const isThis = d.device_fingerprint === thisFp;
            return (
              <Card key={d.device_id} className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <DeviceIcon type={d.device_type} className="h-5 w-5 shrink-0 text-text-muted" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm text-text-primary">{d.device_label}</span>
                      {isThis && <Pill tone="success">This device</Pill>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-text-faint">
                      <span>Enrolled {formatDate(d.enrolled_at)}</span>
                      {d.last_seen_at && <span>Last used {clockTime(d.last_seen_at)}</span>}
                      {d.last_ip && (
                        <span className="inline-flex items-center gap-1">
                          <Wifi className="h-3 w-3" />
                          <span className="font-mono">{d.last_ip}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  onClick={() => setRemoving(d)}
                >
                  Remove
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <EnrollDeviceModal open={enrollOpen} onClose={() => setEnrollOpen(false)} />
      <RemoveDeviceModal device={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}

// ── HR & Staff: every employee's devices + change feed ─────
export function DevicesTab() {
  const qc = useQueryClient();
  const brand = useActiveBusiness().key;

  const { data: employees, isLoading } = useQuery({
    queryKey: ["hr", "devices", "all"],
    queryFn: listAllDevices,
  });
  const { data: changes } = useQuery({
    queryKey: ["hr", "devices", "changes"],
    queryFn: () => listDeviceChanges(30),
  });

  // Live: refresh the grid + feed when any device changes anywhere.
  useEffect(() => {
    getSocket();
    joinRoom(rooms.hrDevices(brand));
    const onChange = () => {
      qc.invalidateQueries({ queryKey: ["hr", "devices"] });
    };
    window.addEventListener("pgh:device:changed", onChange);
    return () => {
      window.removeEventListener("pgh:device:changed", onChange);
      leaveRoom(rooms.hrDevices(brand));
    };
  }, [brand, qc]);

  const noDevice = (employees ?? []).filter((e) => e.active_count === 0).length;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <SectionTitle
          icon={<ShieldCheck className="h-4 w-4 text-accent-glow" />}
          action={
            noDevice > 0 ? (
              <span className="text-[11px] font-semibold text-warn">
                {noDevice} without a device
              </span>
            ) : undefined
          }
        >
          Enrolled devices
        </SectionTitle>
        {isLoading ? (
          <Skeleton className="h-40 rounded-[var(--radius)]" />
        ) : !employees?.length ? (
          <EmptyState icon={<Smartphone className="h-6 w-6" />} title="No employees" />
        ) : (
          <div className="space-y-2">
            {employees.map((e) => (
              <Card key={e.profile_id} className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="truncate text-sm text-text-primary">
                      {e.display_name || "Staff"}
                    </span>
                    {e.job_title && (
                      <span className="ml-2 text-[11px] text-text-faint">{e.job_title}</span>
                    )}
                  </div>
                  {e.active_count === 0 ? (
                    <Pill tone="warn">No device</Pill>
                  ) : (
                    <Pill tone="neutral">{e.active_count} enrolled</Pill>
                  )}
                </div>
                {e.devices.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {e.devices.map((d) => (
                      <span
                        key={d.device_id}
                        title={`${d.device_label}${d.last_seen_at ? ` · last used ${clockTime(d.last_seen_at)}` : ""}${d.last_ip ? ` · ${d.last_ip}` : ""}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-text-primary/[0.03] px-2 py-1 text-[11px] text-text-muted"
                      >
                        <DeviceIcon type={d.device_type} className="h-3.5 w-3.5" />
                        {d.device_label}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionTitle icon={<Activity className="h-4 w-4 text-accent-glow" />}>
          Recent changes
        </SectionTitle>
        {!changes?.length ? (
          <p className="py-4 text-center text-xs text-text-faint">No device changes yet.</p>
        ) : (
          <div className="space-y-1.5">
            {changes.map((c) => {
              const flagged = c.action === "flagged_unknown";
              return (
                <div
                  key={c.log_id}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-xs",
                    flagged ? "border-danger/40 bg-danger/[0.06]" : "border-line",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-text-primary">{c.display_name || "Staff"}</span>
                    <span className="text-[10px] text-text-faint">
                      {formatDateTime(c.created_at)}
                    </span>
                  </div>
                  <div className={cn("mt-0.5", flagged ? "text-danger" : "text-text-muted")}>
                    {flagged ? (
                      <span className="inline-flex items-center gap-1 font-semibold">
                        <ShieldAlert className="h-3 w-3" /> Unknown-device clock-in
                      </span>
                    ) : (
                      <>
                        {c.action === "enrolled" && "Enrolled "}
                        {c.action === "removed" && "Removed "}
                        {c.action === "replaced" && "Replaced "}
                        {c.device_label}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
