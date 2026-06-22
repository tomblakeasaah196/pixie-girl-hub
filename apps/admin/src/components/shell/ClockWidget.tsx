import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, MapPin, LogOut, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { getMyToday, clock as clockApi } from "@/lib/hr-api";
import { captureGeo } from "@/lib/geo-capture";
import { useToastStore } from "@/components/notifications/NotificationToast";

/**
 * Top-bar clock in/out (canon §3.2). Captures the device location + reverse-
 * geocoded address at punch and sends it to the server, which compares the
 * point to the office geofences and flags off-site clock-ins. Hidden for
 * accounts not linked to a staff profile.
 */
export function ClockWidget({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient();
  const toast = useToastStore();
  const [elapsed, setElapsed] = useState(0);

  const { data, isError } = useQuery({
    queryKey: ["hr", "me", "today"],
    queryFn: getMyToday,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const startRef = useRef(0);
  useEffect(() => {
    if (!data?.clocked_in || !data.clocked_in_at) return;
    startRef.current = new Date(data.clocked_in_at).getTime();
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data?.clocked_in, data?.clocked_in_at]);

  const notify = (title: string, body = "", priority: "low" | "normal" | "high" = "normal") =>
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

  const punch = useMutation({
    mutationFn: async (event_type: "clock_in" | "clock_out") => {
      const geo = await captureGeo();
      if (geo.denied && data?.geofence_required && event_type === "clock_in") {
        throw new Error(
          "Location is required to clock in on an on-site day. Enable location access and try again.",
        );
      }
      return clockApi({
        event_type,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy_m: geo.accuracy_m,
        address: geo.address,
      });
    },
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["hr", "me"] });
      if (rec.event_type === "clock_out") {
        notify("Clocked out", "Have a good one.");
      } else if (rec.is_offsite) {
        notify(
          "Clocked in — off-site",
          "You're outside the office perimeter; this will need an explanation.",
          "high",
        );
      } else if (rec.status === "late") {
        notify("Clocked in — late", `${rec.late_minutes} min late.`, "high");
      } else {
        notify("Clocked in", rec.address || "Have a great day.");
      }
    },
    onError: (e) => notify("Clock-in failed", e instanceof Error ? e.message : "", "high"),
  });

  // Not a staff member (or endpoint unavailable) — render nothing.
  if (isError || !data) return null;
  // Day off and not currently clocked in — no control needed.
  if (data.expected_mode === "off" && !data.clocked_in) return null;

  const hhmmss = [elapsed / 3600, (elapsed % 3600) / 60, elapsed % 60]
    .map((n) => String(Math.floor(n)).padStart(2, "0"))
    .join(":");

  const busy = punch.isPending;

  if (data.clocked_in) {
    return (
      <button
        onClick={() => !busy && punch.mutate("clock_out")}
        disabled={busy}
        title={data.is_offsite ? "Clocked in (off-site) — clock out" : "Clock out"}
        className={cn(
          "inline-flex items-center gap-2 h-[38px] px-[13px] rounded-[11px] border font-semibold text-xs transition-all",
          data.is_offsite
            ? "text-warn border-warn/40 bg-warn/10"
            : "text-success border-success/40 bg-success/10",
        )}
      >
        {busy ? (
          <Loader2 className="w-[15px] animate-spin" />
        ) : data.is_offsite ? (
          <AlertTriangle className="w-[15px]" />
        ) : (
          <LogOut className="w-[15px]" />
        )}
        <span className="font-mono tabular-nums">{hhmmss}</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => !busy && punch.mutate("clock_in")}
      disabled={busy}
      title="Clock in"
      className={cn(
        "inline-flex items-center gap-2 h-[38px] px-[13px] rounded-[11px] border border-line bg-text-primary/[0.04] font-semibold text-xs text-text-muted transition-all hover:text-text-primary",
      )}
    >
      {busy ? (
        <Loader2 className="w-[15px] animate-spin" />
      ) : data.geofence_required ? (
        <MapPin className="w-[15px]" />
      ) : (
        <Clock className="w-[15px]" />
      )}
      {!compact && <span>{busy ? "Locating…" : "Clock in"}</span>}
    </button>
  );
}
