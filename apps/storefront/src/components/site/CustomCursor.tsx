import { useEffect, useRef, useState } from "react";
import { clientBrand } from "@/lib/brand";

const RING_SIZE = 28;
const RING_HOVER = 44;
const DOT_SIZE = 6;
const LERP = 0.15;

type CursorState = "default" | "hover" | "action";

export function CustomCursor() {
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const mouse = useRef({ x: -100, y: -100 });
  const ring = useRef({ x: -100, y: -100 });
  const state = useRef<CursorState>("default");
  const label = useRef<string>("");
  const raf = useRef(0);
  const [hidden, setHidden] = useState(false);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mq = window.matchMedia("(pointer: coarse)");
    if (mq.matches) {
      setIsTouch(true);
      return;
    }
    const onMqChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    mq.addEventListener("change", onMqChange);

    const brand = clientBrand();
    const isFaitlyn = brand === "faitlynhair";

    const ringEl = ringRef.current;
    const dotEl = dotRef.current;
    if (!ringEl || !dotEl) return;

    const glowColor = isFaitlyn
      ? "oklch(0.78 0.11 75 / 0.45)"
      : "oklch(0.45 0.18 25 / 0.45)";
    const strokeColor = isFaitlyn
      ? "oklch(0.78 0.11 75 / 0.8)"
      : "oklch(0.45 0.18 25 / 0.8)";
    const dotColor = isFaitlyn
      ? "oklch(0.78 0.11 75)"
      : "oklch(0.45 0.18 25)";

    ringEl.style.borderColor = strokeColor;
    ringEl.style.boxShadow = `0 0 8px ${glowColor}, inset 0 0 4px ${glowColor}`;
    dotEl.style.background = dotColor;

    const onMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX, y: e.clientY };
    };

    const updateTarget = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.(
        "a, button, [role=button], input, textarea, select, [data-cursor-label], [data-cursor-action]",
      );
      if (el) {
        const lbl = (el as HTMLElement).dataset?.cursorLabel;
        label.current = lbl || "";
        state.current = (el as HTMLElement).dataset?.cursorAction
          ? "action"
          : "hover";
      } else {
        state.current = "default";
        label.current = "";
      }
    };

    const onEnter = () => setHidden(false);
    const onLeave = () => setHidden(true);

    const loop = () => {
      ring.current.x += (mouse.current.x - ring.current.x) * LERP;
      ring.current.y += (mouse.current.y - ring.current.y) * LERP;

      const isHover = state.current === "hover" || state.current === "action";
      const size = isHover ? RING_HOVER : RING_SIZE;
      const half = size / 2;

      ringEl.style.transform = `translate(${ring.current.x - half}px, ${ring.current.y - half}px)`;
      ringEl.style.width = `${size}px`;
      ringEl.style.height = `${size}px`;

      if (isHover) {
        ringEl.style.borderWidth = "2.5px";
        dotEl.style.opacity = "0";
      } else {
        ringEl.style.borderWidth = "1.5px";
        dotEl.style.opacity = "1";
      }

      const labelEl = ringEl.querySelector<HTMLSpanElement>("[data-label]");
      if (labelEl) {
        labelEl.textContent = label.current;
        labelEl.style.opacity = label.current ? "1" : "0";
      }

      dotEl.style.transform = `translate(${mouse.current.x - DOT_SIZE / 2}px, ${mouse.current.y - DOT_SIZE / 2}px)`;

      raf.current = requestAnimationFrame(loop);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseover", updateTarget);
    document.addEventListener("mouseenter", onEnter);
    document.addEventListener("mouseleave", onLeave);
    raf.current = requestAnimationFrame(loop);

    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseover", updateTarget);
      document.removeEventListener("mouseenter", onEnter);
      document.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf.current);
      mq.removeEventListener("change", onMqChange);
    };
  }, [isTouch]);

  if (isTouch) return null;

  return (
    <>
      <div
        ref={ringRef}
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: RING_SIZE,
          height: RING_SIZE,
          borderRadius: "50%",
          borderStyle: "solid",
          borderWidth: "1.5px",
          pointerEvents: "none",
          zIndex: 9999,
          transition: "width 0.3s ease, height 0.3s ease, border-width 0.3s ease, opacity 0.25s ease",
          opacity: hidden ? 0 : 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          data-label
          style={{
            fontSize: "0.45rem",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--cream)",
            opacity: 0,
            transition: "opacity 0.25s ease",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        />
      </div>
      <div
        ref={dotRef}
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: DOT_SIZE,
          height: DOT_SIZE,
          borderRadius: "50%",
          pointerEvents: "none",
          zIndex: 9999,
          transition: "opacity 0.25s ease",
          opacity: hidden ? 0 : 1,
        }}
      />
    </>
  );
}
