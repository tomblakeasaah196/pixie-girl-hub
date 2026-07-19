import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Check, ChevronUp, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  GROUP_LABELS,
  GROUP_ORDER,
  MODULE_BY_KEY,
  TOP_LIMIT,
  type AppModule,
} from "@/lib/modules";
import { useNavStore, moreKeys } from "@/stores/nav";
import { usePermittedModuleKeys } from "@/hooks/useModuleAccess";
import { haptic } from "@/hooks/useHaptic";
import { toast } from "@/stores/toast";
import { AppTile } from "./AppTile";

const GRID =
  "grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5";

/** Hold-to-arrange duration (requirement: 2–3s press enters Edit Mode). */
const LONG_PRESS_MS = 2000;
/** Finger/cursor drift allowed during the hold before it cancels. Generous
 *  on purpose: a real thumb wobbles well past 12px over a 2s hold, and an
 *  aborted activation looks like "nothing happened". A scroll flick travels
 *  far beyond this within the first frames, so scrolling still cancels. */
const LONG_PRESS_TOLERANCE = 24;

const ANCHOR = "dashboard";

/**
 * Command Center app grid (canon §3.3) — iOS-style arrange mode.
 *
 * - Hold any tile ~2s (or press "Arrange") to enter edit mode: tiles jiggle,
 *   "−" badges appear, and drag-to-reorder is live (dnd-kit sortable grid —
 *   pointer, touch and keyboard — replacing the old native-HTML5 drag that
 *   was mouse-only and janky). Neighbours displace smoothly via
 *   rectSortingStrategy; the lifted tile follows in a DragOverlay.
 * - "More" apps carry an always-visible "+" that pins straight to the grid.
 * - Exit via Done, Esc, or tapping anywhere outside the grid.
 *
 * Mirrors the sidebar Priority list via the shared nav store. Dashboard is
 * anchored: always first, never draggable, never displaced.
 */
export function AppGrid({
  badges = {},
  title = "Your apps",
}: {
  badges?: Record<string, number>;
  title?: string;
}) {
  const { top, reorder, pin, unpin } = useNavStore();
  const permitted = usePermittedModuleKeys();
  // Reorder/pin logic still operates on the raw `top` (by key); we only filter
  // what's rendered, so users never see a tile for a module they can't access.
  const visibleTop = top.filter((k) => permitted.has(k));
  const more = moreKeys(top).filter((k) => permitted.has(k));
  const sortableKeys = visibleTop.filter((k) => k !== ANCHOR);

  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Long-press is the primary trigger: outside edit mode the sensors only
  // activate after a ~2s hold (drift-tolerant), which starts edit mode AND
  // lifts that tile in one gesture — exactly the iOS choreography. Once in
  // edit mode, drags start near-instantly; a quick touch-swipe still scrolls.
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: editing
        ? { distance: 6 }
        : { delay: LONG_PRESS_MS, tolerance: LONG_PRESS_TOLERANCE },
    }),
    useSensor(TouchSensor, {
      activationConstraint: editing
        ? { delay: 150, tolerance: 8 }
        : { delay: LONG_PRESS_MS, tolerance: LONG_PRESS_TOLERANCE },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function enterEdit() {
    if (!editing) {
      setEditing(true);
      haptic("medium");
    }
  }

  function exitEdit() {
    setEditing(false);
  }

  // Exit mechanisms: tap/click anywhere outside the grid, or Esc.
  useEffect(() => {
    if (!editing) return;
    function onDocPointerDown(e: PointerEvent) {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        setEditing(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setEditing(false);
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editing]);

  // Manual long-press for the anchored Dashboard tile — it can't drag, but
  // holding it should still open edit mode (any-tile trigger, like iOS).
  const anchorTimer = useRef<number | null>(null);
  const anchorOrigin = useRef<{ x: number; y: number } | null>(null);
  const anchorPending = useRef(false);
  function clearAnchorPress() {
    if (anchorTimer.current !== null) window.clearTimeout(anchorTimer.current);
    anchorTimer.current = null;
    anchorOrigin.current = null;
    anchorPending.current = false;
  }
  useEffect(() => clearAnchorPress, []);
  const anchorPressHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (editing || (e.pointerType === "mouse" && e.button !== 0)) return;
      anchorOrigin.current = { x: e.clientX, y: e.clientY };
      anchorPending.current = true;
      anchorTimer.current = window.setTimeout(() => {
        clearAnchorPress();
        enterEdit();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const o = anchorOrigin.current;
      if (!o) return;
      if (
        Math.abs(e.clientX - o.x) > LONG_PRESS_TOLERANCE ||
        Math.abs(e.clientY - o.y) > LONG_PRESS_TOLERANCE
      ) {
        clearAnchorPress();
      }
    },
    onPointerUp: clearAnchorPress,
    onPointerCancel: clearAnchorPress,
    onPointerLeave: clearAnchorPress,
  };

  function onDragStart(e: DragStartEvent) {
    setActiveKey(String(e.active.id));
    enterEdit();
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveKey(null);
    if (!over || active.id === over.id) return;
    const keys = top.slice();
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    // Index 0 is the anchored Dashboard — never a source nor a target.
    if (from <= 0 || to <= 0) return;
    keys.splice(from, 1);
    keys.splice(to, 0, String(active.id));
    reorder(keys);
    haptic("light");
  }

  function handlePin(key: string) {
    const dropped = pin(key);
    haptic("light");
    if (dropped) {
      toast.info(`${MODULE_BY_KEY[key]!.label} pinned`, {
        description: `${
          MODULE_BY_KEY[dropped]?.label ?? dropped
        } moved to More — the grid holds ${TOP_LIMIT} apps.`,
      });
    }
  }

  const activeModule = activeKey ? MODULE_BY_KEY[activeKey] : null;

  return (
    <div
      ref={rootRef}
      onContextMenu={(e) => {
        // A touch long-press fires contextmenu on Android; never let it
        // interrupt hold-to-arrange or the arrange session itself.
        if (editing || anchorPending.current) e.preventDefault();
      }}
    >
      {/* Section head — swaps to hint + Done while arranging. */}
      <div className="flex items-center gap-3 mt-8 mb-4">
        <h3 className="font-display text-xl font-medium">{title}</h3>
        {editing ? (
          <>
            <span className="micro text-text-faint flex-1 text-right max-sm:hidden">
              drag to arrange · − moves to More · + pins
            </span>
            <span className="flex-1 h-px bg-line/20 sm:hidden" />
            <button
              onClick={() => {
                exitEdit();
                haptic("light");
              }}
              className="inline-flex items-center gap-1.5 h-10 px-5 rounded-full bg-accent-deep text-[#F4E9D9] text-[13px] font-semibold shadow-[0_6px_18px_rgb(var(--accent-deep)/0.4)] hover:brightness-110 transition animate-fade-in"
            >
              <Check className="w-4 h-4" strokeWidth={2.4} />
              Done
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 h-px bg-line/20" />
            <button
              onClick={() => {
                enterEdit();
                setMoreOpen(true);
              }}
              title="Or press & hold any tile"
              className="micro text-text-faint hover:text-accent-glow transition-colors p-2 -m-2"
            >
              Arrange
            </button>
          </>
        )}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveKey(null)}
      >
        <SortableContext items={sortableKeys} strategy={rectSortingStrategy}>
          <div className={GRID}>
            {visibleTop.map((key, i) => {
              const m = MODULE_BY_KEY[key]!;
              const badge = badges[m.badgeKey ?? m.key];
              if (key === ANCHOR) {
                return (
                  <div
                    key={key}
                    {...anchorPressHandlers}
                    className="touch-manipulation"
                  >
                    <AppTile
                      module={m}
                      index={i}
                      badge={badge}
                      editing={editing}
                    />
                  </div>
                );
              }
              return (
                <SortableTile
                  key={key}
                  module={m}
                  index={i}
                  badge={badge}
                  editing={editing}
                  onUnpin={() => {
                    unpin(key);
                    haptic("light");
                  }}
                />
              );
            })}

            {more.length > 0 && (
              <button
                onClick={() => setMoreOpen((o) => !o)}
                className="group flex flex-col items-center text-center gap-[13px] p-[24px_16px] rounded-[20px] border border-dashed hairline bg-surface/[0.28] transition-all hover:-translate-y-1 hover:border-accent/40 animate-tile-in select-none [-webkit-touch-callout:none]"
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
        </SortableContext>

        {/* The lifted tile — rendered in a portal so it rides above
            everything and settles into its slot with a soft drop. */}
        <DragOverlay
          zIndex={60}
          dropAnimation={{
            duration: 240,
            easing: "cubic-bezier(.2,.75,.3,1.1)",
          }}
        >
          {activeModule ? (
            <div className="scale-[1.06] rotate-1 rounded-[20px] shadow-[0_28px_60px_rgb(0_0_0/0.55)] cursor-grabbing">
              <AppTile
                module={activeModule}
                badge={badges[activeModule.badgeKey ?? activeModule.key]}
                editing
                overlay
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
                    badge={badges[MODULE_BY_KEY[key]!.badgeKey ?? key]}
                    editing={editing}
                    pin={{ mode: "pin", onClick: () => handlePin(key) }}
                  />
                ))}
              </div>
            </div>
          );
        })}
    </div>
  );
}

/**
 * One draggable slot. Three layers, outermost first:
 * dnd-kit translate (inline transform) → jiggle (CSS animation — kept on its
 * own node so the animation's transform never overrides dnd-kit's) → tile.
 */
function SortableTile({
  module,
  index,
  badge,
  editing,
  onUnpin,
}: {
  module: AppModule;
  index: number;
  badge?: number;
  editing: boolean;
  onUnpin: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: module.key });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("touch-manipulation", isDragging && "z-20")}
      {...attributes}
      tabIndex={editing ? 0 : -1}
      {...listeners}
    >
      <div
        className={cn(
          editing &&
            !isDragging &&
            "animate-jiggle motion-reduce:animate-none",
          // The original stays as a faint placeholder while its clone rides
          // the DragOverlay under the pointer.
          isDragging && "opacity-30",
        )}
        style={
          editing && !isDragging
            ? { animationDelay: `-${(index * 137) % 330}ms` }
            : undefined
        }
      >
        <AppTile
          module={module}
          index={index}
          badge={badge}
          editing={editing}
          pin={{ mode: "unpin", onClick: onUnpin }}
        />
      </div>
    </div>
  );
}
