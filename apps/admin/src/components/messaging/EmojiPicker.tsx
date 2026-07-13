import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Clock } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  EMOJI_CATEGORIES,
  searchEmojis,
  type EmojiEntry,
} from "@/lib/emoji-data";

interface Props {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

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
export function EmojiPicker({ onPick, onClose }: Props) {
  const [active, setActive] = useState<string>("recents");
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside-click / Escape.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
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
  }, [onClose]);

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

  return (
    <div
      ref={rootRef}
      className="absolute bottom-full mb-2 right-0 z-30 w-[300px] rounded-2xl border hairline bg-panel/95 backdrop-blur-xl shadow-2xl overflow-hidden"
      role="dialog"
      aria-label="Emoji picker"
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
        <div className="flex items-center gap-0.5 px-1.5 py-1 border-b hairline overflow-x-auto">
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
    </div>
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
