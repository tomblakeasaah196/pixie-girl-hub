import { Phone, PhoneOff } from "lucide-react";
import type { CallRing } from "@/lib/calls-api";
import { getAvatarColour, getInitials } from "@/lib/messaging-utils";

/**
 * One ringing call — glass card in the incoming stack (top-right on
 * desktop, top-center on mobile). Answer is deliberately the big,
 * obvious action; Decline runs the missed-call follow-ups server-side.
 */
export function IncomingCallToast({
  ring,
  answering,
  onAnswer,
  onDecline,
}: {
  ring: CallRing;
  answering: boolean;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  const name = ring.caller_name || ring.from_number || "Unknown caller";
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
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-faint">
            Incoming WhatsApp call
          </div>
          <div className="font-display text-[15px] text-text-primary truncate">
            {name}
          </div>
          {ring.from_number && ring.caller_name && (
            <div className="text-[11px] text-text-muted truncate">
              {ring.from_number}
            </div>
          )}
        </div>
      </div>
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
