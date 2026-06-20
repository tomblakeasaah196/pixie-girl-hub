import { useState } from "react";
import { LayoutGrid, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { MODULE_BY_KEY, GROUP_ORDER, GROUP_LABELS } from "@/lib/modules";
import { useNavStore, moreKeys } from "@/stores/nav";
import { AppTile } from "./AppTile";

const GRID =
  "grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5";

/**
 * Command Center app grid (canon §3.3): top-10 with drag-to-reorder + pin-off,
 * plus a "More" tile that inline-expands the rest grouped, each pin-to-top.
 * Mirrors the sidebar Priority list via the shared nav store. Dashboard anchored.
 */
export function AppGrid({ badges = {} }: { badges?: Record<string, number> }) {
  const { top, reorder, pin, unpin } = useNavStore();
  const more = moreKeys(top);
  const [moreOpen, setMoreOpen] = useState(false);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  function onDrop(target: string) {
    if (!dragKey || dragKey === target) return;
    const keys = top.slice();
    const from = keys.indexOf(dragKey);
    const to = keys.indexOf(target);
    if (from < 0 || to < 0) return;
    keys.splice(from, 1);
    keys.splice(to, 0, dragKey);
    reorder(keys);
  }

  return (
    <div>
      <div className={GRID}>
        {top.map((key, i) => {
          const m = MODULE_BY_KEY[key]!;
          const anchor = key === "dashboard";
          return (
            <div
              key={key}
              draggable={!anchor}
              onDragStart={() => setDragKey(key)}
              onDragEnd={() => {
                setDragKey(null);
                setOverKey(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOverKey(key);
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(key);
                setDragKey(null);
                setOverKey(null);
              }}
              className={cn(
                "transition-transform",
                dragKey === key && "opacity-40",
                overKey === key && dragKey !== key && "scale-[1.04]",
              )}
            >
              <AppTile
                module={m}
                index={i}
                badge={m.badgeKey ? badges[m.badgeKey] : undefined}
                pin={
                  anchor
                    ? undefined
                    : { mode: "unpin", onClick: () => unpin(key) }
                }
              />
            </div>
          );
        })}

        {more.length > 0 && (
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className="group flex flex-col items-center text-center gap-[13px] p-[24px_16px] rounded-[20px] border border-dashed hairline bg-surface/[0.28] transition-all hover:-translate-y-1 hover:border-accent/40 animate-tile-in"
          >
            <span className="w-[54px] h-[54px] rounded-[16px] grid place-items-center text-text-muted group-hover:text-accent-glow transition-colors">
              {moreOpen ? (
                <ChevronUp className="w-6 h-6" />
              ) : (
                <LayoutGrid className="w-6 h-6" />
              )}
            </span>
            <span className="font-display font-medium text-base">
              {moreOpen ? "Less" : "More"}
            </span>
            <span className="text-[10.5px] text-text-faint">
              {more.length} more apps
            </span>
          </button>
        )}
      </div>

      {moreOpen &&
        GROUP_ORDER.map((g) => {
          const items = more.filter((k) => MODULE_BY_KEY[k]!.group === g);
          if (!items.length) return null;
          return (
            <div key={g} className="mt-6">
              <div className="flex items-center gap-3 mb-3">
                <span className="micro">{GROUP_LABELS[g]}</span>
                <span className="flex-1 h-px bg-line/20" />
              </div>
              <div className={GRID}>
                {items.map((key, i) => (
                  <AppTile
                    key={key}
                    module={MODULE_BY_KEY[key]!}
                    index={i}
                    badge={
                      MODULE_BY_KEY[key]!.badgeKey
                        ? badges[MODULE_BY_KEY[key]!.badgeKey!]
                        : undefined
                    }
                    pin={{ mode: "pin", onClick: () => pin(key) }}
                  />
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}
