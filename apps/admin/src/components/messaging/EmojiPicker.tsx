import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Search, Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  EMOJI_CATEGORIES,
  searchEmojis,
  type EmojiEntry,
} from "@/lib/emoji-data";

interface Props {
  /** Trigger button the picker is anchored to; positioned via viewport rect, not CSS flow. */
  anchorRef: RefObject<HTMLElement | null>;
  /**
   * Which edge lines up with the trigger. `"end"` (default) hangs the panel
   * leftwards from a right-hand trigger; `"start"` opens rightwards, which
   * is what a left-hand trigger — the chat composer's emoji key, WhatsApp's
   * position — needs so the panel covers the thread, not the inbox list.
   */
  align?: "start" | "end";
  onPick: (emoji: string) => void;
  onClose: () => void;
}

const PICKER_WIDTH = 300;
const PICKER_HEIGHT = 360;
const VIEWPORT_MARGIN = 8;

const RECENTS_KEY = "smartcomm.emoji.recents";
const RECENTS_MAX = 24;

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(emoji: string): string[] {
  const next = [emoji, ...loadRecents().filter((e) => e !== emoji)].slice(
    0,
    RECENTS_MAX,
  );
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — recents are best-effort */
  }
  return next;
}

/**
 * WhatsApp-style native-emoji picker: recents, category tabs, and
 * keyword search. Glassmorphism popover per the design canon; renders
 * plain Unicode glyphs so nothing loads from a CDN.
 */
export function EmojiPicker({
  anchorRef,
  align = "end",
  onPick,
  onClose,
}: Props) {
  const [active, setActive] = useState<string>("recents");
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);

  // Position as a fixed-viewport rect anchored to the trigger button, clamped
  // so the popover always stays fully on-screen instead of clipping behind
  // sidebars/panels or running off the viewport edge.
  useLayoutEffect(() => {
    function reposition() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      let left = align === "start" ? rect.left : rect.right - PICKER_WIDTH;
      left = Math.min(left, window.innerWidth - PICKER_WIDTH - VIEWPORT_MARGIN);
      left = Math.max(left, VIEWPORT_MARGIN);

      let top = rect.top - PICKER_HEIGHT - 8;
      if (top < VIEWPORT_MARGIN) {
        // Not enough room above the trigger — drop it below instead.
        top = Math.min(
          rect.bottom + 8,
          window.innerHeight - PICKER_HEIGHT - VIEWPORT_MARGIN,
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
  }, [anchorRef, align]);

  // Close on outside-click / Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorRef]);

  // Keep the active category tab in view when tabs overflow the row.
  useEffect(() => {
    const row = tabsRef.current;
    if (!row) return;
    const activeEl = row.querySelector<HTMLElement>('[data-active="true"]');
    activeEl?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  function pick(emoji: string) {
    setRecents(pushRecent(emoji));
    onPick(emoji);
  }

  const searching = query.trim().length > 0;
  const searchResults = useMemo(
    () => (searching ? searchEmojis(query) : []),
    [searching, query],
  );

  // First tab shows recents when there are any, else the first category.
  const hasRecents = recents.length > 0;

  const activeCategory = EMOJI_CATEGORIES.find((c) => c.id === active);
  const gridEmojis: EmojiEntry[] = searching
    ? searchResults
    : active === "recents"
      ? recents.map((e) => ({ e, k: "" }))
      : (activeCategory?.emojis ?? EMOJI_CATEGORIES[0].emojis);

  if (!pos) return null;

  return createPortal(
    <div
      ref={rootRef}
      style={{ top: pos.top, left: pos.left, width: PICKER_WIDTH }}
      className="fixed z-[1000] rounded-2xl border hairline bg-panel/95 backdrop-blur-xl shadow-2xl overflow-hidden"
      role="dialog"
      aria-label="Emoji picker"
      /* Portalled to <body>, so it lives outside the chat dock's DOM. The
         marker tells the dock's outside-click / Escape guards that a click
         in here belongs to this popover — without it, picking an emoji in
         the dock closed the whole dock. */
      data-modal-root
      data-modal-open="true"
    >
      {/* Search */}
      <div className="p-2 border-b hairline">
        <div className="flex items-center gap-2 rounded-lg border hairline bg-panel-2 px-2.5 py-1.5">
          <Search className="w-3.5 h-3.5 text-text-faint shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji"
            className="w-full bg-transparent text-[12.5px] focus:outline-none placeholder:text-text-faint"
          />
        </div>
      </div>

      {/* Category tabs (hidden while searching) */}
      {!searching && (
        <div className="relative border-b hairline">
          <div
            ref={tabsRef}
            className="flex items-center gap-0.5 px-1.5 py-1 overflow-x-auto scrollbar-none scroll-smooth"
          >
            {hasRecents && (
              <TabButton
                active={active === "recents"}
                onClick={() => setActive("recents")}
                title="Recently used"
              >
                <Clock className="w-4 h-4" />
              </TabButton>
            )}
            {EMOJI_CATEGORIES.map((c) => (
              <TabButton
                key={c.id}
                active={active === c.id}
                onClick={() => setActive(c.id)}
                title={c.label}
              >
                <span className="text-[16px] leading-none">{c.icon}</span>
              </TabButton>
            ))}
          </div>
          {/* Edge fades hint that the tab row scrolls horizontally */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-4 bg-gradient-to-r from-panel/95 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-4 bg-gradient-to-l from-panel/95 to-transparent" />
        </div>
      )}

      {/* Grid */}
      <div className="max-h-[240px] overflow-y-auto p-1.5">
        {gridEmojis.length === 0 ? (
          <div className="grid place-items-center h-24 text-[12px] text-text-faint">
            {searching ? "No emoji found" : "No recents yet"}
          </div>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {gridEmojis.map((entry, i) => (
              <button
                key={`${entry.e}-${i}`}
                onClick={() => pick(entry.e)}
                className="grid place-items-center h-8 rounded-lg text-[20px] leading-none hover:bg-panel-2 transition-colors"
                title={entry.k.split(" ")[0] || undefined}
              >
                {entry.e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Section label */}
      {!searching && (
        <div className="px-3 py-1.5 border-t hairline text-[10px] uppercase tracking-widest text-text-faint">
          {active === "recents"
            ? "Recently used"
            : (activeCategory?.label ?? "")}
        </div>
      )}
    </div>,
    document.body,
  );
}

function TabButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      data-active={active}
      className={cn(
        "grid place-items-center w-8 h-8 rounded-lg shrink-0 transition-colors",
        active
          ? "bg-accent/15 text-accent-glow"
          : "text-text-muted hover:bg-panel-2",
      )}
    >
      {children}
    </button>
  );
}
