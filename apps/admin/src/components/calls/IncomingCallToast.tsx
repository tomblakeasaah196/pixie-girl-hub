import { useEffect, useState } from "react";
import { Phone, PhoneOff, Volume2, Users } from "lucide-react";
import type { CallRing } from "@/lib/calls-api";
import { getAvatarColour, getInitials } from "@/lib/messaging-utils";

/**
 * One ringing call — glass card in the incoming stack (top-right on
 * desktop, top-center on mobile). Answer is deliberately the big,
 * obvious action; Decline runs the missed-call follow-ups server-side.
 *
 * Extras that make the ring readable at a glance under pressure:
 *   - a live "ringing 0:07" counter, so an agent knows how long the customer
 *     has been waiting before they pick up;
 *   - the brand, whenever the agent covers more than one (answering a Faitlyn
 *     call thinking it's Pixie Girl is a bad first sentence);
 *   - "assigned to you" vs "unclaimed" — owner-first routing made visible;
 *   - a one-tap sound enable, for the case where the browser refused to make
 *     any noise because the page had never been clicked.
 */
export function IncomingCallToast({
  ring,
  answering,
  brandLabel,
  soundBlocked,
  onEnableSound,
  onAnswer,
  onDecline,
}: {
  ring: CallRing;
  answering: boolean;
  brandLabel?: string | null;
  soundBlocked?: boolean;
  onEnableSound?: () => void;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  const name = ring.caller_name || ring.from_number || "Unknown caller";
  const elapsed = useRingElapsed(ring.started_at);

  return (
    <div
      role="alertdialog"
      aria-label={`Incoming WhatsApp call from ${name}`}
      className="dropglass rounded-[18px] border hairline shadow-2xl p-4 w-[320px] max-w-[94vw] pointer-events-auto"
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <div
            className="grid place-items-center w-11 h-11 rounded-full text-[13px] font-semibold text-white"
            style={{ backgroundColor: getAvatarColour(name) }}
          >
            {getInitials(name)}
          </div>
          {/* ring pulse */}
          <span className="absolute inset-0 rounded-full border-2 border-success/70 animate-ping motion-reduce:hidden" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-text-faint">
            <span className="truncate">Incoming WhatsApp call</span>
            {elapsed && (
              <span className="font-mono text-text-muted normal-case tracking-normal">
                {elapsed}
              </span>
            )}
          </div>
          <div className="font-display text-[15px] text-text-primary truncate">
            {name}
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            {ring.from_number && ring.caller_name && (
              <span className="text-[11px] text-text-muted truncate">
                {ring.from_number}
              </span>
            )}
            {brandLabel && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-accent/15 text-accent text-[10px] font-semibold">
                {brandLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-text-faint">
        {ring.scope === "owner" ? (
          <>
            <Phone className="w-3 h-3 shrink-0" />
            <span className="truncate">Assigned to you</span>
          </>
        ) : (
          <>
            <Users className="w-3 h-3 shrink-0" />
            <span className="truncate">Unclaimed — first to answer wins</span>
          </>
        )}
      </div>

      {soundBlocked && onEnableSound && (
        <button
          onClick={onEnableSound}
          className="mt-2 w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-lg text-[11px] font-semibold border border-warn/40 bg-warn/10 text-warn hover:bg-warn/20 transition-colors"
        >
          <Volume2 className="w-3.5 h-3.5" /> Tap to enable ring sound
        </button>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={onDecline}
          disabled={answering}
          className="inline-flex items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-semibold border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20 transition-colors disabled:opacity-50"
        >
          <PhoneOff className="w-4 h-4" /> Decline
        </button>
        <button
          onClick={onAnswer}
          disabled={answering}
          className="inline-flex items-center justify-center gap-2 h-10 rounded-xl text-[13px] font-semibold border border-success/40 bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50"
        >
          <Phone className="w-4 h-4" /> {answering ? "Connecting…" : "Answer"}
        </button>
      </div>
    </div>
  );
}

/** "0:07" since the call started ringing, or null if we don't know when. */
function useRingElapsed(startedAt?: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
