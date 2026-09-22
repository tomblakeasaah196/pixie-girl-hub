import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useIsPhone } from "@/hooks/useMediaQuery";

/** Icon tint. Semantic tokens only — the accent is never a loud fill. */
type Tone = "accent" | "info" | "sage" | "gold" | "whatsapp" | "muted";

export interface ComposerAction {
  key: string;
  /** Tile label — always visible. Icon-only rows are how the old composer
   *  became unreadable; a word costs one line and saves a guess. */
  label: string;
  /** Second line: what it does, or the keyboard trigger. */
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  busy?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface Props {
  /** Trigger button — the sheet is anchored to its viewport rect. */
  anchorRef: RefObject<HTMLElement | null>;
  actions: ComposerAction[];
  onClose: () => void;
}

const SHEET_WIDTH = 316;
const VIEWPORT_MARGIN = 8;

const TONE_CLASS: Record<Tone, string> = {
  accent: "text-accent-glow bg-accent/10",
  info: "text-info bg-info/10",
  sage: "text-sage bg-sage/10",
  gold: "text-warn bg-warn/10",
  // Platform brand green — WhatsApp's own colour, the one place a
  // non-palette hue is correct (it identifies the channel, not us).
  whatsapp: "text-[#25D366] bg-[#25D366]/10",
  muted: "text-text-muted bg-panel-2",
};

/**
 * The composer's attachment sheet — one paperclip opens everything the
 * operator can put in a message: files, the catalogue, and the stock
 * answers (address, working hours, welcome form, WhatsApp handoff).
 *
 * WhatsApp's ergonomics (one entry point, a grid of labelled tiles, a
 * bottom sheet on phones) in our materials (glass, hairline, brand
 * medallions). Unlike WhatsApp's icon grid every tile carries a word and
 * a hint, because these actions are business actions, not universal ones.
 */
export function ComposerActionSheet({ anchorRef, actions, onClose }: Props) {
  const isPhone = useIsPhone();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Desktop: a fixed-viewport popover anchored to the paperclip and clamped
  // on-screen, so the 420px chat dock never clips it. Phones use the bottom
  // sheet below and skip positioning entirely.
  useLayoutEffect(() => {
    if (isPhone) return;
    function reposition() {
      const anchor = anchorRef.current;
      const sheet = rootRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const height = sheet?.offsetHeight ?? 280;

      let left = rect.right - SHEET_WIDTH;
      left = Math.min(left, window.innerWidth - SHEET_WIDTH - VIEWPORT_MARGIN);
      left = Math.max(left, VIEWPORT_MARGIN);

      let top = rect.top - height - 10;
      if (top < VIEWPORT_MARGIN) {
        top = Math.min(
          rect.bottom + 10,
          window.innerHeight - height - VIEWPORT_MARGIN,
        );
      }
      top = Math.max(top, VIEWPORT_MARGIN);

      setPos({ top, left });
    }
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
    // actions.length changes the sheet height → re-measure.
  }, [anchorRef, isPhone, actions.length]);

  // Outside click / Escape close.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorRef]);

  const grid = (
    <div className="grid grid-cols-3 gap-1 p-2">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <button
            key={a.key}
            type="button"
            disabled={a.disabled || a.busy}
            onClick={() => {
              onClose();
              a.onSelect();
            }}
            className={cn(
              "group flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5",
              "transition-colors hover:bg-panel-2 disabled:opacity-40",
              "disabled:hover:bg-transparent",
            )}
            title={a.hint ? `${a.label} — ${a.hint}` : a.label}
          >
            <span
              className={cn(
                "grid place-items-center w-10 h-10 rounded-full",
                "transition-transform group-hover:scale-105",
                TONE_CLASS[a.tone ?? "accent"],
              )}
            >
              {a.busy ? (
                <Loader2 className="w-[18px] h-[18px] animate-spin" />
              ) : (
                <Icon className="w-[18px] h-[18px]" />
              )}
            </span>
            <span className="w-full text-center leading-tight">
              <span className="block text-[11.5px] text-text-primary">
                {a.label}
              </span>
              {a.hint && (
                <span className="block text-[9.5px] text-text-faint truncate">
                  {a.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (isPhone) {
    return createPortal(
      <>
        <div
          data-modal-root
          data-modal-open="true"
          className="fixed inset-0 z-[999] bg-black/40 animate-fade-in"
          aria-hidden
        />
        <div
          ref={rootRef}
          role="dialog"
          aria-label="Attach or send a quick answer"
          data-modal-root
          data-modal-open="true"
          className={cn(
            "fixed inset-x-0 bottom-0 z-[1000] rounded-t-3xl border-t hairline",
            "dropglass pb-safe animate-sheet-slide-up",
          )}
        >
          <div className="grid place-items-center pt-2 pb-1">
            <span className="h-1 w-10 rounded-full bg-text-faint/40" />
          </div>
          {/* The tile list grows as actions are added (Invoices, quick
              replies…). Cap it and let it scroll so the top row can never be
              pushed off a short viewport. */}
          <div className="max-h-[68vh] overflow-y-auto overscroll-contain">
            {grid}
          </div>
        </div>
      </>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Attach or send a quick answer"
      /* The sheet is portalled to <body>, so it sits OUTSIDE the chat dock's
         DOM. Without this marker the dock's outside-click guard reads a tap
         on a tile as "clicked away" and closes itself mid-interaction. */
      data-modal-root
      data-modal-open="true"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: SHEET_WIDTH,
      }}
      className={cn(
        "fixed z-[1000] rounded-2xl dropglass overflow-hidden",
        pos ? "animate-fade-in" : "opacity-0",
      )}
    >
      {grid}
    </div>,
    document.body,
  );
}
