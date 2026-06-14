import { useNavigate } from "react-router-dom";
import { Pin, PinOff } from "lucide-react";
import { cn } from "@/lib/cn";
import type { AppModule } from "@/lib/modules";

/**
 * App tile (canon §3.3) — frosted glass, CREAM title (legible, never
 * black-on-red), a SUBTLE accent-tinted icon medallion, a soft brand bloom.
 * Optional pin/unpin affordance on hover.
 */
export function AppTile({
  module,
  index = 0,
  badge,
  pin,
}: {
  module: AppModule;
  index?: number;
  badge?: number;
  pin?: { mode: "pin" | "unpin"; onClick: () => void };
}) {
  const navigate = useNavigate();
  const Icon = module.icon;
  return (
    <div className="relative group/slot">
      <button
        onClick={() => navigate(module.route)}
        style={{ animationDelay: `${index * 26}ms` }}
        className={cn(
          "group relative w-full flex flex-col items-center text-center gap-[13px] p-[24px_16px] rounded-[20px] overflow-hidden cursor-pointer animate-tile-in",
          "glass shadow-glass transition-[transform,box-shadow,border-color] duration-300",
          "hover:-translate-y-[5px] hover:border-accent/40 hover:shadow-[0_24px_56px_rgb(0_0_0/0.5)]",
        )}
      >
        <span className="pointer-events-none absolute -right-[34px] -top-[44px] w-[150px] h-[150px] rounded-full opacity-20 blur-[26px] transition-opacity group-hover:opacity-50"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--biz-2) 30%, transparent), transparent 70%)" }} />
        {badge ? (
          <span className="absolute top-3 right-3 z-[2] min-w-[22px] h-[22px] px-[7px] grid place-items-center rounded-full text-[10px] font-bold text-[#F4E9D9] bg-accent-deep shadow-[0_3px_10px_rgb(var(--accent-deep)/0.5)]">
            {badge}
          </span>
        ) : null}
        <span className="relative w-[54px] h-[54px] rounded-[16px] grid place-items-center text-accent-glow bg-accent/10 border border-accent/[0.18] transition-transform duration-300 group-hover:scale-[1.08] group-hover:-rotate-3">
          <Icon className="w-[25px] h-[25px]" strokeWidth={1.6} />
        </span>
        <span className="relative font-display font-medium text-base text-text-primary">{module.label}</span>
        <span className="relative text-[10.5px] text-text-faint leading-snug max-w-[150px]">{module.description}</span>
      </button>
      {pin && (
        <button
          onClick={pin.onClick}
          title={pin.mode === "pin" ? "Pin to top" : "Move to More"}
          className="absolute top-2.5 left-2.5 z-[3] w-7 h-7 rounded-[9px] grid place-items-center text-text-faint bg-bg/70 opacity-0 group-hover/slot:opacity-100 hover:text-accent-glow transition-all"
        >
          {pin.mode === "pin" ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}
