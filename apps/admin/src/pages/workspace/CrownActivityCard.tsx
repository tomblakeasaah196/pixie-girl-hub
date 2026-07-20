/**
 * Crown 👑 activity — a sales-facing Workspace card surfacing what needs a
 * human: Crown reward submissions awaiting approval (e.g. a UGC photo) and
 * streaks about to break, so sales can reach out. Gated on retention `view`;
 * renders nothing when there's no activity, so a quiet day stays uncluttered.
 */

import { useNavigate } from "react-router-dom";
import { Crown, ClipboardCheck, Flame, ChevronRight } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Card, Pill } from "@/components/ui/primitives";
import { useCrownSubmissions, useCrownAtRiskStreaks } from "@/lib/crown-api";

export function CrownActivityCard() {
  const { can } = useAuthStore();
  if (!can("retention", "view")) return null;
  return <CrownActivityInner />;
}

function CrownActivityInner() {
  const navigate = useNavigate();
  const subsQ = useCrownSubmissions();
  const atRiskQ = useCrownAtRiskStreaks();
  const subs = subsQ.data ?? [];
  const atRisk = atRiskQ.data ?? [];

  if (subsQ.isLoading || atRiskQ.isLoading) return null;
  if (subs.length === 0 && atRisk.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 p-4 border-b hairline">
        <Crown className="w-4 h-4 text-accent-glow" />
        <span className="text-[13px] font-semibold flex-1">Crown activity</span>
        <span className="text-[11px] text-text-faint">needs attention</span>
      </div>
      <div className="p-3 space-y-1">
        {subs.length > 0 && (
          <button
            onClick={() => navigate("/retention?tab=approvals")}
            className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl hover:bg-text-primary/[0.04] transition-colors"
          >
            <ClipboardCheck className="w-4 h-4 text-accent-glow shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-text-primary">
                {subs.length} submission{subs.length === 1 ? "" : "s"} to approve
              </div>
              <div className="text-[11.5px] text-text-muted truncate">
                {subs.slice(0, 2).map((s) => s.contact_name ?? "Pixie Queen").join(", ")}
                {subs.length > 2 ? " and more" : ""}
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-text-faint shrink-0" />
          </button>
        )}
        {atRisk.map((s) => (
          <button
            key={s.streak_id}
            onClick={() => navigate(`/crm/clients/${s.contact_id}`)}
            className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl hover:bg-text-primary/[0.04] transition-colors"
          >
            <Flame className="w-4 h-4 text-accent-glow shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-text-primary truncate">
                {s.contact_name ?? "A Pixie Queen"}&rsquo;s streak is at risk
              </div>
              <div className="text-[11.5px] text-text-muted">
                {s.streak_name ?? s.streak_type} · {s.current_length} in a row
              </div>
            </div>
            <Pill tone="warn">at risk</Pill>
          </button>
        ))}
      </div>
    </Card>
  );
}
