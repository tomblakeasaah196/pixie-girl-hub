import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Sparkles, MessageCircle, HelpCircle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useUnreadCount } from "@/hooks/useCommandCenter";
import { useChatDockStore } from "@/stores/chat-dock";
import { usePraxisDockStore } from "@/stores/praxis-dock";
import { useUnreadMessages } from "@/hooks/useSmartcomm";

/**
 * Floating launcher (canon §3.4) — fans to Praxis · Messages · Help.
 * HOVER to expand on desktop; TAP on mobile. Carries the unread badge.
 *
 * Draggable: click-and-drag on desktop, or long-press ~2s then drag on mobile.
 * A short tap (or click without drag) still triggers the fan / Praxis, so we
 * don't lose the fast path. Position is clamped to the viewport and persisted
 * per-device in localStorage; the default corner is used until the user moves
 * it, so nothing regresses for people who don't touch it.
 */

const POSITION_KEY = "pgh:floating-launcher:pos";
const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 2000;
const BUTTON = 58;
const EDGE_PAD = 12;
const MOBILE_BOTTOM_RESERVE = 68;
const FAN_HEIGHT = 190; // three 48px minis + gaps

interface Pos {
  left: number;
  top: number;
}

function loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (typeof p?.left === "number" && typeof p?.top === "number") return p;
    return null;
  } catch {
    return null;
  }
}

function clampPos(p: Pos, isDesktop: boolean): Pos {
  if (typeof window === "undefined") return p;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const bottomReserved = isDesktop ? EDGE_PAD : MOBILE_BOTTOM_RESERVE + EDGE_PAD;
  const maxLeft = Math.max(EDGE_PAD, w - BUTTON - EDGE_PAD);
  const maxTop = Math.max(EDGE_PAD, h - BUTTON - bottomReserved);
  return {
    left: Math.max(EDGE_PAD, Math.min(p.left, maxLeft)),
    top: Math.max(EDGE_PAD, Math.min(p.top, maxTop)),
  };
}

export function FloatingLauncher() {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(() => loadPos());
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false); // mobile long-press satisfied
  const { data } = useUnreadCount();
  const { data: messagesUnread } = useUnreadMessages();
  const openDock = useChatDockStore((s) => s.openDock);
  const openPraxis = usePraxisDockStore((s) => s.openDock);
  const unread = (data?.unread ?? 0) + (messagesUnread?.unread_count ?? 0);
  const ref = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const drag = useRef<{
    startX: number;
    startY: number;
    baseLeft: number;
    baseTop: number;
    moved: boolean;
    pointerId: number;
    longPressTimer: number | null;
  } | null>(null);
  const latestPos = useRef<Pos | null>(pos);

  // Close the fan when tapping outside on mobile.
  useEffect(() => {
    if (!open || isDesktop) return;
    const onDown = (e: PointerEvent) =>
      !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, isDesktop]);

  // Re-clamp after rotation / resize so the FAB stays reachable.
  useEffect(() => {
    function onResize() {
      setPos((p) => {
        if (!p) return p;
        const next = clampPos(p, isDesktop);
        latestPos.current = next;
        return next;
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isDesktop]);

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const container = ref.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseLeft: rect.left,
      baseTop: rect.top,
      moved: false,
      pointerId: e.pointerId,
      longPressTimer: null,
    };
    if (!isDesktop) {
      const state = drag.current;
      state.longPressTimer = window.setTimeout(() => {
        setArmed(true);
        try {
          navigator.vibrate?.(40);
        } catch {
          /* no-op */
        }
      }, LONG_PRESS_MS);
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || e.pointerId !== state.pointerId) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    const dist = Math.hypot(dx, dy);
    if (!state.moved && dist < DRAG_THRESHOLD) return;
    if (!isDesktop && !armed) {
      // Finger moved before the 2s hold — cancel long-press, let the tap pass.
      if (state.longPressTimer != null) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
      }
      return;
    }
    state.moved = true;
    if (!dragging) setDragging(true);
    if (open) setOpen(false);
    const next = clampPos(
      { left: state.baseLeft + dx, top: state.baseTop + dy },
      isDesktop,
    );
    latestPos.current = next;
    setPos(next);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || e.pointerId !== state.pointerId) return;
    if (state.longPressTimer != null) clearTimeout(state.longPressTimer);
    const moved = state.moved;
    drag.current = null;
    setArmed(false);
    setDragging(false);
    if (moved) {
      suppressClick.current = true;
      if (latestPos.current) {
        try {
          localStorage.setItem(
            POSITION_KEY,
            JSON.stringify(latestPos.current),
          );
        } catch {
          /* quota / private mode — ignore */
        }
      }
    }
  }

  function onPointerCancel() {
    const state = drag.current;
    if (!state) return;
    if (state.longPressTimer != null) clearTimeout(state.longPressTimer);
    drag.current = null;
    setArmed(false);
    setDragging(false);
  }

  function onFabClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (isDesktop) openPraxis();
    else setOpen((v) => !v);
  }

  const fanBelow = pos != null && pos.top < FAN_HEIGHT + EDGE_PAD;
  const containerStyle: CSSProperties = pos
    ? { left: pos.left, top: pos.top, right: "auto", bottom: "auto" }
    : {};

  const mini = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    accent?: boolean,
  ) => (
    <button
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className={cn(
        "relative grid place-items-center w-12 h-12 rounded-full dropglass shadow-[0_8px_22px_rgb(0_0_0/0.4)] transition-all hover:scale-110 hover:border-accent/40",
        accent ? "text-accent-glow" : "text-text-primary",
      )}
    >
      <span className="absolute right-[60px] whitespace-nowrap dropglass px-2.5 py-1.5 rounded-[9px] text-[11px] font-semibold opacity-0 translate-x-1.5 transition-all peer-hover:opacity-100 group-hover/m:opacity-100 group-hover/m:translate-x-0">
        {label}
      </span>
      {icon}
    </button>
  );

  return (
    <div
      ref={ref}
      style={containerStyle}
      className={cn(
        "fixed z-[70] flex items-center gap-2.5",
        !pos &&
          "right-6 bottom-6 max-lg:bottom-[calc(68px+max(env(safe-area-inset-bottom,0px),8px))]",
        fanBelow ? "flex-col-reverse" : "flex-col",
      )}
      onMouseEnter={
        isDesktop && !dragging ? () => setOpen(true) : undefined
      }
      onMouseLeave={
        isDesktop && !dragging ? () => setOpen(false) : undefined
      }
    >
      {open && !dragging && (
        <div
          className={cn(
            "flex items-center gap-2.5 animate-fade-in",
            fanBelow ? "flex-col-reverse" : "flex-col",
          )}
        >
          <div className="group/m">
            {mini("Help", <HelpCircle className="w-5 h-5" />, () =>
              navigate("/help"),
            )}
          </div>
          <div className="group/m">
            {mini("Messages", <MessageCircle className="w-5 h-5" />, () =>
              isDesktop ? openDock() : navigate("/smartcomm"),
            )}
          </div>
          <div className="group/m">
            {mini(
              "Praxis AI",
              <Sparkles className="w-5 h-5" />,
              () => openPraxis(),
              true,
            )}
          </div>
        </div>
      )}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onFabClick}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Quick actions (drag to move)"
        title={
          isDesktop
            ? "Quick actions — drag to move"
            : "Quick actions — hold 2s to drag"
        }
        style={{ touchAction: "none" }}
        className={cn(
          "relative grid place-items-center w-[58px] h-[58px] rounded-[20px] text-[#F4E9D9] border border-white/10 shadow-[0_12px_30px_rgb(var(--accent-deep)/0.5)] transition-transform",
          "bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))]",
          !dragging && "hover:-translate-y-0.5 hover:scale-105",
          dragging
            ? "cursor-grabbing scale-110"
            : isDesktop
              ? "cursor-grab"
              : "",
          armed && !dragging && "ring-2 ring-accent-glow ring-offset-2 ring-offset-bg",
          open && !dragging && "rotate-45",
        )}
      >
        {open && !dragging ? (
          <X className="w-6 h-6" />
        ) : (
          <Plus className="w-6 h-6" />
        )}
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1.5 rounded-[10px] bg-danger text-white text-[10px] font-bold grid place-items-center border-2 border-bg">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
