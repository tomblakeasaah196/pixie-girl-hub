import { useEffect, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Volume2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useCallStore } from "@/stores/call";
import { callActions } from "@/lib/call-actions";
import { getAvatarColour, getInitials } from "@/lib/messaging-utils";

/**
 * The ring, INSIDE the conversation it belongs to (state 1).
 *
 * When an agent is already reading the caller's chat, a small toast in the
 * corner is the wrong shape: their eyes are on the thread, the context they
 * need is right there, and the Answer button should be too. This banner takes
 * over the top of the message thread, and once the call is live it becomes the
 * in-conversation call strip — so the whole call happens in one place and the
 * timeline card lands underneath it when it ends.
 *
 * Self-contained on purpose: it reads the ring from the call store and calls
 * the shared verbs (lib/call-actions), so the SmartComm screen and the chat
 * dock can both drop it in with nothing but a channel id. Registering that
 * channel in the store is what tells CallLayer to hold back its corner toast
 * for these calls, so the agent is never offered two Answer buttons for one
 * caller.
 */
export function InThreadCallBanner({ channelId }: { channelId?: string | null }) {
  const registerInlineChannel = useCallStore((s) => s.registerInlineChannel);
  const unregisterInlineChannel = useCallStore((s) => s.unregisterInlineChannel);
  const answeringId = useCallStore((s) => s.answeringId);
  const soundBlocked = useCallStore((s) => s.soundBlocked);
  const ring = useCallStore(
    (s) => s.incoming.find((r) => r.channel_id === channelId) ?? null,
  );
  const active = useCallStore((s) =>
    channelId && s.active?.channel_id === channelId ? s.active : null,
  );

  // Claim the inline slot for as long as this thread is on screen.
  useEffect(() => {
    if (!channelId) return;
    registerInlineChannel(channelId);
    return () => unregisterInlineChannel(channelId);
  }, [channelId, registerInlineChannel, unregisterInlineChannel]);

  const ticking = !!ring || !!active;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  if (!channelId) return null;

  if (active) {
    const name = active.caller_name || active.from_number || "Unknown caller";
    const connecting = active.phase === "connecting";
    return (
      <div className="px-3 py-2 border-b hairline bg-success/[0.07]">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "w-2 h-2 rounded-full shrink-0",
              connecting ? "bg-warn animate-pulse" : "bg-success animate-pulse",
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold text-text-primary truncate">
              {connecting ? "Connecting to" : "On a call with"} {name}
            </div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-faint">
              WhatsApp call
            </div>
          </div>
          <span className="font-mono text-[13px] tabular-nums text-text-primary shrink-0">
            {connecting ? "--:--" : fmtTimer(now - active.answered_at)}
          </span>
          <button
            onClick={() => callActions().toggleMute()}
            aria-label={active.muted ? "Unmute microphone" : "Mute microphone"}
            className={cn(
              "no-min-h grid place-items-center w-8 h-8 rounded-full border transition-colors shrink-0",
              active.muted
                ? "bg-warn/15 border-warn/40 text-warn"
                : "bg-text-primary/[0.05] border-line text-text-muted hover:text-text-primary",
            )}
          >
            {active.muted ? (
              <MicOff className="w-3.5 h-3.5" />
            ) : (
              <Mic className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={() => void callActions().hangup()}
            aria-label="Hang up"
            className="no-min-h grid place-items-center w-8 h-8 rounded-full border border-danger/40 bg-danger/15 text-danger hover:bg-danger/25 transition-colors shrink-0"
          >
            <PhoneOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  if (!ring) return null;

  const name = ring.caller_name || ring.from_number || "Unknown caller";
  const started = ring.started_at ? Date.parse(ring.started_at) : NaN;
  const elapsed = Number.isFinite(started) ? fmtTimer(now - started) : null;
  const answering = answeringId === ring.call_id;

  return (
    <div
      role="alertdialog"
      aria-label={`Incoming WhatsApp call from ${name}`}
      className="px-3 py-2.5 border-b hairline bg-accent/[0.09] animate-[slide-up_0.18s_ease-out]"
    >
      <div className="flex items-center gap-2.5">
        <div className="relative shrink-0">
          <div
            className="grid place-items-center w-9 h-9 rounded-full text-[12px] font-semibold text-white"
            style={{ backgroundColor: getAvatarColour(name) }}
          >
            {getInitials(name)}
          </div>
          <span className="absolute inset-0 rounded-full border-2 border-success/70 animate-ping motion-reduce:hidden" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-faint">
            Incoming WhatsApp call{elapsed ? ` · ${elapsed}` : ""}
          </div>
          <div className="font-display text-[14px] text-text-primary truncate">
            {name} is calling
          </div>
        </div>
        <button
          onClick={() => void callActions().decline(ring)}
          disabled={answering}
          className="no-min-h inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-xl text-[12.5px] font-semibold border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 transition-colors disabled:opacity-50 shrink-0"
        >
          <PhoneOff className="w-3.5 h-3.5" />
          <span className="max-sm:hidden">Decline</span>
        </button>
        <button
          onClick={() => void callActions().answer(ring)}
          disabled={answering}
          className="no-min-h inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-xl text-[12.5px] font-semibold border border-success/40 bg-success/20 text-success hover:bg-success/30 transition-colors disabled:opacity-50 shrink-0"
        >
          <Phone className="w-3.5 h-3.5" />
          {answering ? "Connecting…" : "Answer"}
        </button>
      </div>
      {soundBlocked && (
        <button
          onClick={() => callActions().enableSound()}
          className="mt-2 w-full no-min-h inline-flex items-center justify-center gap-1.5 h-7 rounded-lg text-[11px] font-semibold border border-warn/40 bg-warn/10 text-warn hover:bg-warn/20 transition-colors"
        >
          <Volume2 className="w-3.5 h-3.5" /> Tap to enable ring sound
        </button>
      )}
    </div>
  );
}

function fmtTimer(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
