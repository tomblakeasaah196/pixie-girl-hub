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
import { useChatDockStore } from "@/stores/chat-dock";
import { usePraxisDockStore } from "@/stores/praxis-dock";
import { useUnreadMessages } from "@/hooks/useSmartcomm";

/**
 * Floating launcher (canon §3.4) — fans to Praxis · Messages · Help.
 * HOVER to expand on desktop; TAP on mobile. Carries the unread-messages badge.
 *
 * Draggable anywhere, on any device: press-and-move relocates it; a short tap
 * (movement under DRAG_THRESHOLD) still fires the fan / Praxis, so the fast path
 * is intact. There is no long-press gate — drag is instant, identical on touch
 * and mouse.
 *
 * The launcher is anchored to the *button*, not its container: the fan is
 * rendered as an absolutely-positioned overlay, so opening/closing it never
 * shifts the button. Combined with a fixed pointer→button offset captured on
 * press, the icon lands exactly where you drop it. Position is clamped to the
 * viewport and persisted per-device in localStorage; the default corner is used
 * until the user moves it, so nothing regresses for people who don't touch it.
 *
 * A small grip mark sits at the top of the icon and a one-time "dance" plays on
 * first loads to advertise that it can be moved.
 */

const POSITION_KEY = "pgh:floating-launcher:pos";
const HINT_KEY = "pgh:floating-launcher:hint-count";
const HINT_MAX = 3; // dance on the first few visits, then stop nagging
const DRAG_THRESHOLD = 6;
const BUTTON = 52;
const EDGE_PAD = 12;
const MOBILE_BOTTOM_RESERVE = 68;
const FAN_HEIGHT = 176; // three 44px minis + gaps

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
  const [dance, setDance] = useState(false);
  const { data: messagesUnread } = useUnreadMessages();
  const openDock = useChatDockStore((s) => s.openDock);
  const openPraxis = usePraxisDockStore((s) => s.openDock);
  const unread = messagesUnread?.unread_count ?? 0;
  const ref = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const drag = useRef<{
    startX: number;
    startY: number;
    grabX: number; // pointer offset inside the button, so the grab point is kept
    grabY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);
  const latestPos = useRef<Pos | null>(pos);

  // One-time "I can be dragged" dance on the first few visits — only while the
  // user hasn't already positioned it themselves.
  useEffect(() => {
    if (loadPos()) return;
    let shown = 0;
    try {
      shown = Number(localStorage.getItem(HINT_KEY) || "0");
    } catch {
      /* ignore */
    }
    if (shown >= HINT_MAX) return;
    const t = window.setTimeout(() => setDance(true), 900);
    try {
      localStorage.setItem(HINT_KEY, String(shown + 1));
    } catch {
      /* ignore */
    }
    return () => window.clearTimeout(t);
  }, []);

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
    setDance(false); // any interaction retires the hint
    suppressClick.current = false;
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startX: e.clientX,
      startY: e.clientY,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      moved: false,
      pointerId: e.pointerId,
    };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || e.pointerId !== state.pointerId) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    state.moved = true;
    if (!dragging) setDragging(true);
    if (open) setOpen(false);
    // Anchor the button so the exact point grabbed stays under the pointer.
    const next = clampPos(
      { left: e.clientX - state.grabX, top: e.clientY - state.grabY },
      isDesktop,
    );
    latestPos.current = next;
    setPos(next);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || e.pointerId !== state.pointerId) return;
    const moved = state.moved;
    drag.current = null;
    setDragging(false);
    if (moved) {
      suppressClick.current = true; // swallow the click this drag would emit
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
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
  }

  function onFabClick() {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (isDesktop) {
      // The badge on this button counts unread messages, not Praxis
      // activity — so when it's showing a number, clicking should land on
      // the thing the badge is about instead of opening Praxis underneath it.
      if (unread > 0) openDock();
      else openPraxis();
    } else setOpen((v) => !v);
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
    badge?: number,
  ) => (
    <button
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className={cn(
        "relative grid place-items-center w-11 h-11 rounded-full dropglass shadow-[0_8px_22px_rgb(0_0_0/0.4)] transition-all hover:scale-110 hover:border-accent/40",
        accent ? "text-accent-glow" : "text-text-primary",
      )}
    >
      <span className="absolute right-[54px] whitespace-nowrap dropglass px-2.5 py-1.5 rounded-[9px] text-[11px] font-semibold opacity-0 translate-x-1.5 transition-all peer-hover:opacity-100 group-hover/m:opacity-100 group-hover/m:translate-x-0">
        {label}
      </span>
      {icon}
      {!!badge && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-[8px] bg-danger text-white text-[9px] font-bold grid place-items-center border-2 border-bg">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </button>
  );

  return (
    <div
      ref={ref}
      style={{ width: BUTTON, height: BUTTON, ...containerStyle }}
      className={cn(
        "fixed z-[70]",
        !pos &&
          "right-6 bottom-6 max-lg:bottom-[calc(68px+max(env(safe-area-inset-bottom,0px),8px))]",
      )}
      onMouseEnter={isDesktop && !dragging ? () => setOpen(true) : undefined}
      onMouseLeave={isDesktop && !dragging ? () => setOpen(false) : undefined}
    >
      {/* Fan is an overlay anchored to the button so its open/close never moves
          the icon. Padding bridges the visual gap so desktop hover doesn't drop
          while the pointer travels between button and minis. */}
      {open && !dragging && (
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-2.5 animate-fade-in",
            fanBelow ? "top-full pt-2.5 flex-col-reverse" : "bottom-full pb-2.5",
          )}
        >
          <div className="group/m">
            {mini("Help", <HelpCircle className="w-5 h-5" />, () =>
              navigate("/help"),
            )}
          </div>
          <div className="group/m">
            {mini(
              "Messages",
              <MessageCircle className="w-5 h-5" />,
              () => (isDesktop ? openDock() : navigate("/smartcomm")),
              false,
              unread,
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
        title="Quick actions — drag to move"
        style={{ touchAction: "none", width: BUTTON, height: BUTTON }}
        className={cn(
          "relative grid place-items-center rounded-[18px] text-[#F4E9D9] border border-white/10 shadow-[0_12px_30px_rgb(var(--accent-deep)/0.5)] transition-transform",
          "bg-[linear-gradient(140deg,rgb(var(--accent)),var(--biz-2))]",
          !dragging && !dance && "hover:-translate-y-0.5 hover:scale-105",
          dragging
            ? "cursor-grabbing scale-110"
            : isDesktop
              ? "cursor-grab"
              : "",
          dance && !dragging && "animate-fab-dance",
          open && !dragging && "rotate-45",
        )}
        onAnimationEnd={() => setDance(false)}
      >
        {/* Grip affordance — signals the icon is draggable. Hidden while the fan
            is open (the icon becomes a close ✕) or during a drag. */}
        {!open && !dragging && (
          <span
            aria-hidden
            className="pointer-events-none absolute top-[5px] left-1/2 -translate-x-1/2 h-[3px] w-4 rounded-full bg-white/40"
          />
        )}
        {open && !dragging ? (
          <X className="w-5 h-5" />
        ) : (
          <Plus className="w-5 h-5" />
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
