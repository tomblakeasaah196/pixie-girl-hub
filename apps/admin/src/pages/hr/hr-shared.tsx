/**
 * Shared building blocks for the HR pages (My HR + HR & Staff).
 * Keeps the two pages thin and consistent with the Maroon Noir kit.
 */

import type { ReactNode } from "react";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { Card, Pill, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { WorkSchedule } from "@/lib/hr-api";

/** Minimal toast helper — the store wants a full notification shape. */
export function useNotify() {
  const toast = useToastStore();
  return (
    title: string,
    body = "",
    priority: "low" | "normal" | "high" | "urgent" = "normal",
  ) =>
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
