import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMyToday, clock as clockApi } from "@/lib/hr-api";
import { captureGeo } from "@/lib/geo-capture";
import { getDeviceFingerprint } from "@/lib/device-fingerprint";
import { useToastStore } from "@/components/notifications/NotificationToast";
import { toastReport } from "@/lib/error-report";

/**
 * The clock in/out state machine (canon §3.2), extracted so both the desktop
 * top-bar pill (`ClockWidget`) and the mobile floating-launcher item
 * (`ClockFanItem`) share ONE implementation of the punch flow: geo capture at
 * the point of punching, mandatory-location refusal, device-fingerprint
 * enrolment check, off-site / late / unrecognised-device toasts, and the live
 * elapsed timer. Renderers only decide how to skin the result.
 *
 * `view` is the single derived status the skins switch on:
 *   hidden  → not linked to a staff profile (404) — render nothing
 *   loading → first fetch in flight, no data yet
 *   error   → transient failure (500 / network) — offer a retry
 *   idle    → not yet punched in — can clock in (incl. an off day, see `offDay`)
 *   in      → clocked in — running timer, can clock out
 *   done    → clocked in AND out today — locked (one cycle per day)
 */
export type ClockView = "hidden" | "loading" | "error" | "idle" | "in" | "done";

export interface ClockPunch {
  view: ClockView;
  /** HH:MM:SS since clock-in, live once `view === "in"`. */
  hhmmss: string;
  /** Today is scheduled off — clocking in is optional (extra / weekend hours). */
  offDay: boolean;
  isOffsite: boolean;
  geofenceRequired: boolean;
  /** A punch (or retry) is in flight — locating the device / awaiting the API. */
  busy: boolean;
  isFetching: boolean;
  clockIn: () => void;
  clockOut: () => void;
  retry: () => void;
}

export function useClockPunch(): ClockPunch {
  const qc = useQueryClient();
  const toast = useToastStore();
  const [elapsed, setElapsed] = useState(0);

  const { data, isError, error, refetch, isFetching } = useQuery({
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

  const notify = (
    title: string,
    body = "",
    priority: "low" | "normal" | "high" = "normal",
  ) => {
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

  const punch = useMutation({
    mutationFn: async (event_type: "clock_in" | "clock_out") => {
      const geo = await captureGeo();
      // Location is mandatory for BOTH clock-in and clock-out — a punch is
      // never recorded without it. Refusing on clock-in means the day is
      // marked absent (no clock-in exists to reconcile).
      const noFix = geo.denied || geo.latitude == null || geo.longitude == null;
      if (noFix) {
        throw new Error(
          event_type === "clock_out"
            ? "Confirm your location to clock out. Enable location access on your device and try again."
            : "Confirm your location to clock in. Enable location access on your device and try again — without it you'll be marked absent for the day.",
        );
      }
      return clockApi({
        event_type,
        latitude: geo.latitude,
        longitude: geo.longitude,
        accuracy_m: geo.accuracy_m,
        address: geo.address,
        device_fingerprint: getDeviceFingerprint(),
      });
    },
    onSuccess: (rec) => {
      qc.invalidateQueries({ queryKey: ["hr", "me"] });
      // The "My HR" workspace tab keeps its own attendance history query
      // (["my-hr", "attendance", ...] — see MyHrPage.tsx's AttendanceSection),
      // a different cache namespace than this widget's ["hr", "me"] status
      // query. Without this, a punch here updates the top-bar pill but the
      // My HR list a user checks right after clocking in keeps showing
      // yesterday's data until it goes stale on its own.
      qc.invalidateQueries({ queryKey: ["my-hr", "attendance"] });
      if (rec.device_recognized === false) {
        notify(
          "Clocked in — unrecognised device",
          "This device isn't enrolled for attendance, so this clock-in is flagged for HR. Enrol it in My HR → My devices.",
          "high",
        );
      } else if (rec.event_type === "clock_out") {
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
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "";
      // Location prompts and "already clocked" conflicts are expected user
      // states — surface them as a normal toast, not the report-to-admin path.
      const benign = /location|already clocked/i.test(msg);
      if (benign) {
        notify("Confirm your location", msg, "normal");
      } else {
        // A genuine unexpected failure (API/network) — this is the one case
        // that should reach JBS Praxis, unlike the device/offsite/late
        // confirmations above which are expected clock-in outcomes, not bugs.
        toastReport("HR → Clock in/out", "Clock in/out failed", msg || "Something went wrong.");
      }
    },
  });

  // Derive the single status the skins switch on. A 404 means the account isn't
  // linked to a staff profile; any other failure is transient so we keep a
  // retry affordance rather than silently dropping the clock (audit M9).
  let view: ClockView;
  if (isError) {
    const status = (error as { status?: number } | null)?.status;
    view = status === 404 ? "hidden" : "error";
  } else if (!data) {
    view = "loading";
  } else if (data.clocked_in) {
    view = "in";
  } else if (data.clocked_out) {
    view = "done";
  } else {
    // Idle even on a day off: the server records AND pays an off-day punch
    // (lateness.calc), so someone working a weekend / extra hours must be able
    // to clock in. We surface it as an optional "off day" clock-in (see
    // `offDay`) rather than hiding the control and silently losing the hours.
    view = "idle";
  }

  const hhmmss = [elapsed / 3600, (elapsed % 3600) / 60, elapsed % 60]
    .map((n) => String(Math.floor(n)).padStart(2, "0"))
    .join(":");

  return {
    view,
    hhmmss,
    offDay: data?.expected_mode === "off",
    isOffsite: !!data?.is_offsite,
    geofenceRequired: !!data?.geofence_required,
    busy: punch.isPending,
    isFetching,
    clockIn: () => punch.mutate("clock_in"),
    clockOut: () => punch.mutate("clock_out"),
    retry: () => void refetch(),
  };
}
