import { useEffect, useState } from "react";
import { fmtCountdown } from "@/lib/messaging-utils";

interface Props {
  expiresAt?: string | null;
  /** Platform name in the tooltip — WhatsApp (default) or Instagram. */
  label?: string;
}

/**
 * The live 24-hour Meta service-window indicator (canon §6.17) — used by
 * both WhatsApp and Instagram threads (same 24h rule, different escape
 * hatch: templates for WA, HUMAN_AGENT tag for IG).
 * Green/amber/red dot when open/closing-soon/expired.
 *
 * Deliberately tiny and boxless (no border, no fill) — this rides right
 * next to the contact name in the thread header, and the name must never
 * lose the space contest to a status pill. Text stays muted regardless of
 * urgency; the dot alone carries the colour signal.
 *
 * If `expiresAt` is null and the thread is a WhatsApp/IG customer thread,
 * we render nothing — the customer hasn't initiated yet, so there's no
 * window to track.
 */
export function WhatsAppWindowBadge({ expiresAt, label = "WhatsApp" }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const i = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(i);
  }, [expiresAt]);

  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - now;
  const expired = ms <= 0;
  const warn = !expired && ms < 4 * 3_600_000;
  const dot = expired ? "bg-danger" : warn ? "bg-amber-400" : "bg-green-400";

  return (
    <span
      title={
        expired
          ? label === "Instagram"
            ? "Instagram 24-hour window expired — replies go out HUMAN_AGENT-tagged"
            : "WhatsApp 24-hour window expired — only templates allowed"
          : `${label} window open · ${fmtCountdown(expiresAt)} left`
      }
      className="inline-flex items-center gap-1 min-w-0 shrink-0 text-[10px] text-text-faint"
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span className="truncate">
        {expired ? "Window closed" : `${fmtCountdown(expiresAt)} left`}
      </span>
    </span>
  );
}
