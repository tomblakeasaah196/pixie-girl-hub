import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PlatformPill } from "./PlatformPill";
import { COST_INFO } from "@/lib/messaging-utils";

interface Props {
  open: boolean;
  onClose: () => void;
  platform: string;
  windowOpen: boolean;
  windowExpiresAt?: string | null;
}

/**
 * The small "i"-icon modal in the thread header.
 *
 * Tells the user — in 3 sentences — whether their next reply costs
 * anything, why, and where to go for the full picture. Avoids
 * recreating the help article here; this is a glance, not a course.
 */
export function CostInfoModal({
  open,
  onClose,
  platform,
  windowOpen,
}: Props) {
  const primary =
    platform === "whatsapp"
      ? windowOpen
        ? COST_INFO.whatsapp_window_open
        : COST_INFO.whatsapp_window_closed
      : platform === "instagram"
        ? windowOpen
          ? COST_INFO.instagram_window_open
          : COST_INFO.instagram_window_closed
        : platform === "email"
          ? COST_INFO.email_free
          : "Internal channel — free, unlimited, all messages stay inside the Hub.";

  const isCharged =
    platform === "whatsapp" && !windowOpen
      ? "yes"
      : platform === "instagram" && !windowOpen
        ? "limited"
        : "free";

  return (
    <Modal open={open} onClose={onClose} title="Why this matters">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <PlatformPill platform={platform} showLabel />
          <span
            className={`text-[11px] uppercase tracking-widest font-semibold ${
              isCharged === "yes"
                ? "text-amber-300"
                : isCharged === "limited"
                  ? "text-text-muted"
                  : "text-green-300"
            }`}
          >
            {isCharged === "yes"
              ? "Per-message billed"
              : isCharged === "limited"
                ? "Restricted by Meta"
                : "Free at any volume"}
          </span>
        </div>

        <p className="text-[14px] text-text-primary leading-relaxed">
          {primary}
        </p>

        {platform === "whatsapp" && (
          <div className="rounded-xl bg-panel-2 border hairline p-3.5 text-[12.5px] text-text-muted">
            <div className="text-text-primary font-medium mb-1">
              Quick reference
            </div>
            <ul className="space-y-1">
              <li>
                <span className="font-mono text-accent-glow">Service</span> —
                customer DMed first, free for 24h.
              </li>
              <li>
                <span className="font-mono text-accent-glow">Utility</span> —
                shipped, tracking, payment reminder. ~₦11 each.
              </li>
              <li>
                <span className="font-mono text-accent-glow">Marketing</span> —
                promo template. ~₦88 each. Blocked by default.
              </li>
            </ul>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 pt-1">
          <Link
            to="/help/how-our-messaging-works"
            onClick={onClose}
            className="flex-1 inline-flex items-center justify-between rounded-xl bg-panel-2 border hairline px-3.5 py-2.5 text-[13px] hover:border-accent/40 transition-colors"
          >
            <span>How messaging really works</span>
            <ArrowRight className="w-4 h-4 text-text-faint" />
          </Link>
          <Link
            to="/help/the-24-hour-window"
            onClick={onClose}
            className="flex-1 inline-flex items-center justify-between rounded-xl bg-panel-2 border hairline px-3.5 py-2.5 text-[13px] hover:border-accent/40 transition-colors"
          >
            <span>The 24-hour window</span>
            <ArrowRight className="w-4 h-4 text-text-faint" />
          </Link>
        </div>

        <div className="flex items-start gap-2 pt-1 text-[12px] text-text-faint">
          <Sparkles className="w-3.5 h-3.5 mt-[2px] text-accent-glow shrink-0" />
          <span>
            Or ask Praxis directly — &ldquo;is this reply going to cost
            us?&rdquo;
          </span>
        </div>
      </div>
    </Modal>
  );
}
