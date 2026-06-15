import { useState } from "react";
import { Trophy, XCircle, PauseCircle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useSetDealStatus } from "../hooks";
import type { Deal } from "@/pages/contacts/types";

type Intent = "won" | "lost" | "on_hold";

interface Props {
  deal: Deal;
  onClose: () => void;
}

export function WonLostModal({ deal, onClose }: Props) {
  const [intent, setIntent] = useState<Intent | null>(null);
  const [lostReason, setLostReason] = useState("");
  const setStatus = useSetDealStatus();

  const handleConfirm = () => {
    if (!intent) return;
    setStatus.mutate(
      {
        id: deal.deal_id,
        status: intent === "on_hold" ? "cancelled" : intent,
        lostReason: intent === "lost" ? lostReason : undefined,
      },
      { onSuccess: onClose },
    );
  };

  const INTENTS: { key: Intent; label: string; icon: typeof Trophy; color: string; bg: string }[] =
    [
      { key: "won", label: "Mark Won", icon: Trophy, color: "text-success", bg: "bg-success/[0.08] border-success/25 hover:bg-success/[0.14]" },
      { key: "lost", label: "Mark Lost", icon: XCircle, color: "text-danger", bg: "bg-danger/[0.08] border-danger/25 hover:bg-danger/[0.14]" },
      { key: "on_hold", label: "Put On Hold", icon: PauseCircle, color: "text-warn", bg: "bg-warn/[0.08] border-warn/25 hover:bg-warn/[0.14]" },
    ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm glass rounded-[22px] p-5 shadow-glass">
        <div className="text-[14px] font-semibold text-text-primary mb-0.5">Update deal status</div>
        <div className="text-[12px] text-text-faint mb-4 truncate">{deal.title}</div>

        {!intent ? (
          <div className="flex flex-col gap-2">
            {INTENTS.map(({ key, label, icon: Icon, color, bg }) => (
              <button
                key={key}
                type="button"
                onClick={() => setIntent(key)}
                className={`flex items-center gap-3 p-3 rounded-[13px] border transition-colors ${bg}`}
              >
                <Icon className={`w-4 h-4 ${color}`} />
                <span className={`text-[13px] font-semibold ${color}`}>{label}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 p-2.5 rounded-[10px] bg-text-primary/[0.04] border hairline">
              {intent === "won" && <Trophy className="w-4 h-4 text-success" />}
              {intent === "lost" && <XCircle className="w-4 h-4 text-danger" />}
              {intent === "on_hold" && <PauseCircle className="w-4 h-4 text-warn" />}
              <span className="text-[13px] font-medium text-text-primary capitalize">
                {intent === "on_hold" ? "Put On Hold" : `Mark ${intent}`}
              </span>
            </div>

            {intent === "won" && (
              <p className="text-[12px] text-text-muted">
                This deal will be marked as won. You can then link it to a sales order from the
                deal detail page.
              </p>
            )}

            {intent === "lost" && (
              <>
                <div>
                  <label className="micro mb-1.5 block">Lost reason <span className="text-danger">*</span></label>
                  <textarea
                    autoFocus
                    value={lostReason}
                    onChange={(e) => setLostReason(e.target.value)}
                    placeholder="What led to losing this deal?"
                    rows={3}
                    className="w-full px-3 py-2 rounded-[11px] bg-text-primary/[0.06] border border-line text-[12.5px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/40 transition-colors resize-none"
                  />
                </div>
                <div className="flex items-center gap-2 p-2 rounded-[9px] bg-accent/[0.05] border border-accent/15">
                  <Sparkles className="w-3 h-3 text-accent flex-shrink-0" />
                  <p className="text-[11px] text-accent/80">
                    Praxis will use this to help improve future deal strategies.
                  </p>
                </div>
              </>
            )}

            {intent === "on_hold" && (
              <p className="text-[12px] text-text-muted">
                The deal will be cancelled/paused. You can reopen it at any time from the deal
                detail page.
              </p>
            )}

            <div className="flex gap-2 mt-1">
              <Button variant="ghost" size="sm" className="flex-1" onClick={() => setIntent(null)}>
                Back
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="flex-1"
                disabled={
                  setStatus.isPending || (intent === "lost" && !lostReason.trim())
                }
                onClick={handleConfirm}
                icon={setStatus.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
              >
                Confirm
              </Button>
            </div>

            {setStatus.isError && (
              <p className="text-[11.5px] text-danger text-center">Update failed. Try again.</p>
            )}
          </div>
        )}

        {!intent && (
          <Button variant="ghost" size="sm" className="w-full mt-3" onClick={onClose}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
