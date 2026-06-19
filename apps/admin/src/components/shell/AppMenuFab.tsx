import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useUiStore } from "@/stores/ui";

/**
 * Floating "Back" pill → Command Center (canon §3.4). Shown on every app
 * except the Command Center ("/"), desktop only (mobile uses the bottom nav).
 * Blends in: glass + brand/deep-red gradient. Slim (~75% height). Draggable
 * (pointer-drag, clamped, offset persisted) so it never obstructs a module.
 */
const DRAG_THRESHOLD = 4;

export function AppMenuFab() {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const offset = useUiStore((s) => s.appMenuOffset);
  const setOffset = useUiStore((s) => s.setAppMenuOffset);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    id: number;
    sx: number;
    sy: number;
    bx: number;
    by: number;
    moved: boolean;
  } | null>(null);

  if (!isDesktop || pathname === "/") return null;

  function clamp(x: number, y: number, el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const baseLeft = window.innerWidth / 2 - r.width / 2;
    const baseTop = window.innerHeight - 26 - r.height;
    const m = 8;
    return {
      x: Math.min(
        Math.max(x, m - baseLeft),
        window.innerWidth - m - r.width - baseLeft,
      ),
      y: Math.min(
        Math.max(y, m - baseTop),
        window.innerHeight - m - r.height - baseTop,
      ),
    };
  }

  return (
    <button
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = {
          id: e.pointerId,
          sx: e.clientX,
          sy: e.clientY,
          bx: offset.x,
          by: offset.y,
          moved: false,
        };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.sx,
          dy = e.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        d.moved = true;
        setOffset(clamp(d.bx + dx, d.by + dy, e.currentTarget));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        setDragging(false);
        if (d && !d.moved) navigate("/");
      }}
      style={{
        transform: `translate3d(calc(-50% + ${offset.x}px), ${offset.y}px, 0)`,
      }}
      className={cn(
        "fixed left-1/2 bottom-[26px] z-[60] inline-flex items-center gap-2 h-[30px] pl-3 pr-[15px] rounded-full select-none touch-none",
        "text-[10.5px] font-bold uppercase tracking-[0.18em] text-[#F4E9D9]",
        "dropglass !border-accent/30 bg-[linear-gradient(140deg,color-mix(in_srgb,rgb(var(--accent))_55%,transparent),color-mix(in_srgb,var(--biz-2)_75%,transparent))]",
        "shadow-[0_12px_30px_rgb(var(--accent-deep)/0.45)] transition-shadow",
        dragging
          ? "cursor-grabbing shadow-glow"
          : "cursor-grab hover:shadow-glow",
      )}
      aria-label="Back to App Menu (drag to reposition)"
    >
      <LayoutGrid className="w-3.5 h-3.5" />
      Back
    </button>
  );
}
