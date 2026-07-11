import { useEffect, useState } from "react";
import { Mic, MicOff, MessageSquare, PhoneOff } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ActiveCall } from "@/stores/call";

function fmtTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/**
 * Floating glass bar while a call is live — caller, ticking timer
 * (tabular mono per canon typography), mute, open-chat, hang up.
 * Sits above the App-Menu pill so neither obstructs the other.
 */
export function ActiveCallBar({
  call,
  onToggleMute,
  onOpenChat,
  onHangup,
}: {
  call: ActiveCall;
  onToggleMute: () => void;
  onOpenChat: () => void;
  onHangup: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const name = call.caller_name || call.from_number || "Unknown caller";
  const connecting = call.phase === "connecting";

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[86px] md:bottom-[74px] z-[80] pointer-events-none">
      <div className="dropglass rounded-full border hairline shadow-2xl px-4 py-2 flex items-center gap-3 pointer-events-auto">
        <span
          className={cn(
            "w-2 h-2 rounded-full shrink-0",
            connecting ? "bg-warn animate-pulse" : "bg-success",
          )}
        />
        <div className="min-w-0 max-w-[180px]">
          <div className="text-[12.5px] font-semibold text-text-primary truncate">
            {name}
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
            {connecting ? "Connecting…" : "WhatsApp call"}
          </div>
        </div>
        <span className="font-mono text-[13px] tabular-nums text-text-primary min-w-[46px] text-center">
          {connecting ? "--:--" : fmtTimer(now - call.answered_at)}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onToggleMute}
            title={call.muted ? "Unmute" : "Mute"}
            aria-label={call.muted ? "Unmute microphone" : "Mute microphone"}
            className={cn(
              "grid place-items-center w-9 h-9 rounded-full border transition-colors",
              call.muted
                ? "bg-warn/15 border-warn/40 text-warn"
                : "bg-text-primary/[0.05] border-line text-text-muted hover:text-text-primary",
            )}
          >
            {call.muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          {call.channel_id && (
            <button
              onClick={onOpenChat}
              title="Open conversation"
              aria-label="Open conversation"
              className="grid place-items-center w-9 h-9 rounded-full border border-line bg-text-primary/[0.05] text-text-muted hover:text-text-primary transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onHangup}
            title="Hang up"
            aria-label="Hang up"
            className="grid place-items-center w-9 h-9 rounded-full border border-danger/40 bg-danger/15 text-danger hover:bg-danger/25 transition-colors"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
