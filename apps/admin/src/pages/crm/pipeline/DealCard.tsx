import { useNavigate } from "react-router-dom";
import {
  Calendar,
  User,
  MoreVertical,
  Trophy,
  XCircle,
  PauseCircle,
} from "lucide-react";
import { MoneyText, Pill } from "@/components/ui/primitives";
import type { Deal } from "@/pages/contacts/types";

const AVATAR_COLORS = ["#8b9d77", "#7a8fa8", "#b76e79", "#9c7ad9", "#5aa0a8"];

function avatarColor(name: string) {
  const idx =
    Math.abs(name.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) %
    AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function daysSince(iso: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

interface DealCardProps {
  deal: Deal;
  /** When true, the card is being dragged — rendered in a portal */
  isDragging?: boolean;
  onWonLost?: (deal: Deal) => void;
}

export function DealCard({
  deal,
  isDragging = false,
  onWonLost,
}: DealCardProps) {
  const navigate = useNavigate();
  const stale = daysSince(deal.last_activity_at);
  const isStale = stale !== null && stale > 14;
  const closeSoon =
    deal.expected_close_date &&
    daysSince(deal.expected_close_date) !== null &&
    daysSince(deal.expected_close_date)! > -7 &&
    daysSince(deal.expected_close_date)! < 0;

  return (
    <div
      className={[
        "p-3 rounded-[13px] bg-surface border hairline cursor-pointer select-none",
        "hover:border-accent/40 hover:bg-text-primary/[0.04] transition-all",
        isDragging
          ? "shadow-glass rotate-1 scale-[1.02] opacity-90"
          : "shadow-sm",
        isStale ? "border-warn/30" : "",
      ].join(" ")}
      onClick={() => navigate(`/crm/deals/${deal.deal_id}`)}
    >
      {/* Contact avatar + title */}
      <div className="flex items-start gap-2 mb-2">
        {deal.contact_name && (
          <div
            className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-semibold text-white font-display flex-shrink-0 mt-0.5"
            style={{ background: avatarColor(deal.contact_name) }}
          >
            {initials(deal.contact_name)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-semibold text-text-primary leading-snug truncate">
            {deal.title}
          </div>
          {deal.contact_name && (
            <div className="text-[10.5px] text-text-faint truncate">
              {deal.contact_name}
            </div>
          )}
        </div>
        {/* Context menu trigger */}
        {onWonLost && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onWonLost(deal);
            }}
            className="w-5 h-5 grid place-items-center rounded-[5px] text-text-faint hover:text-text-primary hover:bg-text-primary/[0.08] transition-colors flex-shrink-0 -mr-0.5 -mt-0.5"
          >
            <MoreVertical className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Value */}
      {deal.expected_value_ngn && (
        <div className="text-[13px] font-display tabular-nums text-text-primary mb-2">
          <MoneyText ngn={parseFloat(deal.expected_value_ngn)} />
        </div>
      )}

      {/* Footer row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {deal.expected_close_date && (
          <span
            className={[
              "flex items-center gap-1 text-[10.5px]",
              closeSoon ? "text-warn" : "text-text-faint",
            ].join(" ")}
          >
            <Calendar className="w-3 h-3" />
            {new Date(deal.expected_close_date).toLocaleDateString("en-NG", {
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
        {deal.assigned_to_name && (
          <span className="flex items-center gap-1 text-[10.5px] text-text-faint ml-auto">
            <User className="w-3 h-3" />
            {deal.assigned_to_name.split(" ")[0]}
          </span>
        )}
        {isStale && (
          <Pill tone="warn" dot={false}>
            {stale}d idle
          </Pill>
        )}
        {deal.source_channel && (
          <span className="text-[10px] text-text-faint capitalize">
            {deal.source_channel.replace(/_/g, " ")}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Won/Lost mini indicator for non-open deals ────────────────────────────

export function DealStatusBadge({ status }: { status: Deal["status"] }) {
  if (status === "won")
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] text-success font-semibold">
        <Trophy className="w-3 h-3" /> Won
      </span>
    );
  if (status === "lost")
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] text-danger font-semibold">
        <XCircle className="w-3 h-3" /> Lost
      </span>
    );
  if (status === "on_hold")
    return (
      <span className="inline-flex items-center gap-1 text-[10.5px] text-warn font-semibold">
        <PauseCircle className="w-3 h-3" /> On hold
      </span>
    );
  return null;
}
