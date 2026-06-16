import { useEffect, useState } from "react";
import { Clock, AlertTriangle } from "lucide-react";
import { fmtCountdown } from "@/lib/messaging-utils";

interface Props {
  expiresAt?: string | null;
  compact?: boolean;
}

/**
 * The live 24-hour WhatsApp service-window indicator (canon §6.17).
 * Green when open, amber under 4h, red when expired.
 *
 * If `expiresAt` is null and the thread is a WhatsApp customer thread,
 * we render nothing — the customer hasn't initiated yet, so there's no
 * window to track.
 */
export function WhatsAppWindowBadge({ expiresAt, compact }: Props) {
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
  const tone = expired
    ? { dot: "bg-danger", border: "border-danger/30", text: "text-danger" }
    : warn
      ? { dot: "bg-amber-400", border: "border-amber-400/30", text: "text-amber-300" }
      : { dot: "bg-green-400", border: "border-green-400/30", text: "text-green-300" };

  if (compact) {
    return (
      <span
        title={
          expired
            ? "WhatsApp 24-hour window expired — only templates allowed"
            : `WhatsApp window open · ${fmtCountdown(expiresAt)} left`
        }
        className={`inline-flex items-center gap-1 px-1.5 py-[1px] rounded-full text-[10px] font-medium border ${tone.border} ${tone.text}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
        {expired ? "Closed" : fmtCountdown(expiresAt)}
      </span>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[11px] border ${tone.border} ${tone.text} bg-panel/50`}
    >
      {expired ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
      <span>
        {expired
          ? "Window closed — template only"
          : `Window open · ${fmtCountdown(expiresAt)} left`}
      </span>
    </div>
  );
}
