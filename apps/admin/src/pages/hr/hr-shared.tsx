/**
 * Shared building blocks for the HR pages (My HR + HR & Staff).
 * Keeps the two pages thin and consistent with the Maroon Noir kit.
 */

import type { ReactNode } from "react";
import { MapPin, Wifi } from "lucide-react";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { Card, Pill, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { toastReport } from "@/lib/error-report";
import type { AttendanceDay, WorkSchedule } from "@/lib/hr-api";

/**
 * Minimal toast helper — the store wants a full notification shape.
 * "high"/"urgent" priority (the module's convention for a failure) routes to
 * the reportable toast instead, so HR failures carry the one-tap "Contact
 * System Admin" (screenshot + pre-filled WhatsApp/email) action.
 */
export function useNotify(area = "HR") {
  const toast = useToastStore();
  return (
    title: string,
    body = "",
    priority: "low" | "normal" | "high" | "urgent" = "normal",
  ) => {
    if (priority === "high" || priority === "urgent") {
      toastReport(area, title, body || "Something went wrong.");
      return;
    }
    toast.add({
      notification_id: crypto.randomUUID(),
      user_id: "",
      business: null,
      type: "hr",
      priority,
      title,
      body,
      reference_type: null,
      reference_id: null,
      action_url: null,
      is_read: false,
      read_at: null,
      created_at: new Date().toISOString(),
    });
  };
}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return "Something went wrong";
}

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "M" },
  { key: "tue", label: "T" },
  { key: "wed", label: "W" },
  { key: "thu", label: "T" },
  { key: "fri", label: "F" },
  { key: "sat", label: "S" },
  { key: "sun", label: "S" },
];

/** Week strip showing on-site / remote / off per weekday. */
export function WeekScheduleView({ schedule }: { schedule: WorkSchedule }) {
  return (
    <div className="flex gap-1.5">
      {DAYS.map((d) => {
        const mode = schedule?.[d.key] || "off";
        const tone =
          mode === "on_site"
            ? "bg-accent/20 text-accent-glow border-accent/30"
            : mode === "remote"
              ? "bg-info/15 text-info border-info/30"
              : "bg-text-primary/[0.04] text-text-faint border-line";
        return (
          <div
            key={d.key}
            title={`${d.key}: ${mode.replace("_", " ")}`}
            className={cn(
              "flex-1 grid place-items-center h-9 rounded-lg border text-xs font-semibold",
              tone,
            )}
          >
            {d.label}
          </div>
        );
      })}
    </div>
  );
}

/** Short local-time label from an ISO timestamp (e.g. "8:57 AM"). */
export function clockTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "8:10 AM" from minutes-since-midnight (workplace-local, from insights). */
export function minutesLabel(local: number | null | undefined): string {
  if (local == null) return "—";
  const h24 = Math.floor(local / 60);
  const m = local % 60;
  const period = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** One "In/Out" map link: stored address → map, coords fallback, offsite tint. */
function ClockPointLink({
  label,
  lat,
  lng,
  address,
  offsite,
}: {
  label: string;
  lat: number;
  lng: number;
  address: string | null;
  offsite: boolean;
}) {
  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lng}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open the exact clock-${label.toLowerCase()} location on a map`}
      className={cn(
        "inline-flex items-center gap-1 text-xs hover:underline",
        offsite ? "text-warn" : "text-text-muted",
      )}
    >
      <MapPin className="h-3 w-3 shrink-0" />
      <span className="max-w-[14rem] truncate">
        <span className="text-text-faint">{label} </span>
        {address || "View on map"}
      </span>
    </a>
  );
}

/**
 * Clock location + network cell shared by the HR/manager attendance list and
 * the My-HR self view. Shows the stored (Geoapify) clock-IN and clock-OUT
 * addresses (each links its exact coordinates to a map), plus the clock-in/out
 * IP addresses as audit evidence. Falls back to "View on map" when only coords
 * exist and "—" when there's nothing. The UI never geocodes on render.
 */
export function ClockLocationLink({
  day,
  className,
}: {
  day: Pick<
    AttendanceDay,
    | "clock_in_lat"
    | "clock_in_lng"
    | "clock_in_address"
    | "is_offsite"
    | "clock_out_lat"
    | "clock_out_lng"
    | "clock_out_address"
    | "clock_out_is_offsite"
    | "clock_in_ip"
    | "clock_out_ip"
  >;
  className?: string;
}) {
  const hasIn = day.clock_in_lat != null && day.clock_in_lng != null;
  const hasOut = day.clock_out_lat != null && day.clock_out_lng != null;
  const hasIp = Boolean(day.clock_in_ip || day.clock_out_ip);
  if (!hasIn && !hasOut && !hasIp) {
    return <span className="text-xs text-text-faint">—</span>;
  }
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {hasIn && (
        <ClockPointLink
          label="In"
          lat={day.clock_in_lat as number}
          lng={day.clock_in_lng as number}
          address={day.clock_in_address}
          offsite={day.is_offsite}
        />
      )}
      {hasOut && (
        <ClockPointLink
          label="Out"
          lat={day.clock_out_lat as number}
          lng={day.clock_out_lng as number}
          address={day.clock_out_address}
          offsite={day.clock_out_is_offsite}
        />
      )}
      {hasIp && (
        <span
          className="inline-flex items-center gap-1 text-[11px] text-text-faint"
          title="IP address each punch was recorded from (audit evidence, not identity proof)"
        >
          <Wifi className="h-3 w-3 shrink-0" />
          <span className="font-mono">
            {day.clock_in_ip || "—"}
            {" → "}
            {day.clock_out_ip || "—"}
          </span>
        </span>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : tone === "accent"
            ? "text-accent-glow"
            : "text-text-primary";
  return (
    <Card className="p-4">
      <div className={cn("font-display text-3xl tabular-nums", color)}>{value}</div>
      <div className="mt-0.5 text-xs text-text-muted">{label}</div>
    </Card>
  );
}

export function SectionTitle({
  icon,
  children,
  action,
}: {
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        {icon}
        {children}
      </h3>
      {action}
    </div>
  );
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "present":
    case "approved":
    case "achieved":
    case "waived":
      return "success";
    case "late":
    case "responded":
    case "pending":
      return "warn";
    case "absent":
    case "rejected":
    case "upheld":
    case "missed":
      return "danger";
    case "on_leave":
      return "info";
    default:
      return "neutral";
  }
}

export function QueryStatusPill({ status }: { status: string }) {
  return <Pill tone={statusTone(status)}>{status.replace("_", " ")}</Pill>;
}

/** Lightweight tab bar matching the kit (no external Tabs component). */
export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; badge?: number }[];
  active: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "relative whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors",
            active === t.key
              ? "text-text-primary"
              : "text-text-muted hover:text-text-primary",
          )}
        >
          {t.label}
          {t.badge ? (
            <span className="ml-1.5 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent-glow">
              {t.badge}
            </span>
          ) : null}
          {active === t.key && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
          )}
        </button>
      ))}
    </div>
  );
}
