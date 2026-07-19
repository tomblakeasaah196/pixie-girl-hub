import { useNavigate } from "react-router-dom";
import { Minus, PinOff, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AppModule } from "@/lib/modules";

/**
 * App tile (canon §3.3) — frosted glass, CREAM title (legible, never
 * black-on-red), a SUBTLE accent-tinted icon medallion, a soft brand bloom.
 *
 * Pin affordances:
 * - `mode: "pin"` (More list) — an always-visible "+" chip that sends the
 *   app to the top grid immediately (touch users can't hover).
 * - `mode: "unpin"` (top grid) — hover-revealed when idle; in edit mode it
 *   becomes the always-visible iOS-style "−" badge.
 *
 * `editing` puts the tile in arrange mode: taps no longer navigate, the
 * hover lift is off (the tile is jiggling), and the cursor reads as grab.
 * `overlay` renders the lifted drag-ghost clone: entrance animation and
 * pin affordance are skipped so the clone appears instantly and clean.
 */
export function AppTile({
  module,
  index = 0,
  badge,
  pin,
  editing = false,
  overlay = false,
}: {
  module: AppModule;
  index?: number;
  badge?: number;
  pin?: { mode: "pin" | "unpin"; onClick: () => void };
  editing?: boolean;
  overlay?: boolean;
}) {
  const navigate = useNavigate();
  const Icon = module.icon;
  const pinAlwaysVisible = pin?.mode === "pin" || editing;
  return (
    <div className="relative group/slot">
      <button
        onClick={() => {
          // Edit mode: taps arrange, they never launch (iOS jiggle behaviour).
          if (editing || overlay) return;
          navigate(module.route);
        }}
        tabIndex={editing || overlay ? -1 : 0}
        style={overlay ? undefined : { animationDelay: `${index * 26}ms` }}
        className={cn(
          "group relative w-full flex flex-col items-center text-center gap-[13px] p-[24px_16px] rounded-[20px] overflow-hidden",
          "select-none [-webkit-touch-callout:none]",
          "glass shadow-glass transition-[transform,box-shadow,border-color] duration-300",
          !overlay && "animate-tile-in",
          editing
            ? "cursor-grab active:cursor-grabbing"
            : // The active: sink is hold-to-arrange feedback: pressing slowly
              // shrinks the tile (delayed, so quick taps never flash) to show
              // the hold is registering; release springs it straight back.
              "cursor-pointer hover:-translate-y-[5px] hover:border-accent/40 hover:shadow-[0_24px_56px_rgb(0_0_0/0.5)] active:scale-[.96] active:delay-150 active:duration-[1200ms]",
        )}
      >
        <span
          className="pointer-events-none absolute -right-[34px] -top-[44px] w-[150px] h-[150px] rounded-full opacity-20 blur-[26px] transition-opacity group-hover:opacity-50"
          style={{
            background:
              "radial-gradient(circle, color-mix(in srgb, var(--biz-2) 30%, transparent), transparent 70%)",
          }}
        />
        {badge ? (
          <span className="absolute top-3 right-3 z-[2] min-w-[22px] h-[22px] px-[7px] grid place-items-center rounded-full text-[10px] font-bold text-[#F4E9D9] bg-accent-deep shadow-[0_3px_10px_rgb(var(--accent-deep)/0.5)]">
            {badge}
          </span>
        ) : null}
        <span className="relative w-[54px] h-[54px] rounded-[16px] grid place-items-center text-accent-glow bg-accent/10 border border-accent/[0.18] transition-transform duration-300 group-hover:scale-[1.08] group-hover:-rotate-3">
          <Icon className="w-[25px] h-[25px]" strokeWidth={1.6} />
        </span>
        <span className="relative font-display font-medium text-base text-text-primary">
          {module.label}
        </span>
        <span className="relative text-[10.5px] text-text-faint leading-snug max-w-[150px]">
          {module.description}
        </span>
      </button>
      {pin && !overlay && (
        <button
          onClick={pin.onClick}
          // The drag listeners live on the sortable wrapper around this tile;
          // a press on the pin badge must never start (or be eaten by) a drag.
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          title={
            pin.mode === "pin" ? "Pin to your apps" : "Move to More"
          }
          aria-label={
            pin.mode === "pin"
              ? `Pin ${module.label} to your apps`
              : `Move ${module.label} to More`
          }
          className={cn(
            "absolute top-2.5 left-2.5 z-[3] w-7 h-7 grid place-items-center transition-all",
            pinAlwaysVisible
              ? "opacity-100"
              : "opacity-0 group-hover/slot:opacity-100 focus-visible:opacity-100",
            pin.mode === "pin"
              ? "rounded-full text-[#F4E9D9] bg-accent-deep shadow-[0_3px_10px_rgb(var(--accent-deep)/0.5)] hover:brightness-125"
              : editing
                ? "rounded-full text-text-primary bg-bg/85 border hairline shadow-[0_4px_12px_rgb(0_0_0/0.45)] hover:text-danger hover:border-danger/40"
                : "rounded-[9px] text-text-faint bg-bg/70 hover:text-accent-glow",
          )}
        >
          {pin.mode === "pin" ? (
            <Plus className="w-4 h-4" strokeWidth={2.4} />
          ) : editing ? (
            <Minus className="w-4 h-4" strokeWidth={2.4} />
          ) : (
            <PinOff className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
