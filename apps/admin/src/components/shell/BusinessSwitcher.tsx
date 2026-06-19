import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useBusinesses,
  useBusinessStore,
  useActiveBusiness,
} from "@/stores/business";
import { useUiStore } from "@/stores/ui";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Business switcher — logo + name only (canon §3.1). Glass dropdown.
 * NO "all businesses": entities have separate data; only the Dashboard
 * aggregates. With ≤2 businesses a click could simply toggle; we use the
 * dropdown so the pattern scales to 3+.
 */
export function BusinessSwitcher({ collapsed }: { collapsed: boolean }) {
  const active = useActiveBusiness();
  const businesses = useBusinesses();
  const setActive = useBusinessStore((s) => s.setActive);
  const setSwitchingToBiz = useUiStore((s) => s.setSwitchingToBiz);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) =>
      !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const Logo = ({ b, size = 30 }: { b: typeof active; size?: number }) => (
    <span
      className="rounded-[9px] grid place-items-center text-white font-display font-semibold shrink-0 shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]"
      style={{
        width: size,
        height: size,
        fontSize: size / 2,
        background: `linear-gradient(140deg, ${b.grad1}, ${b.grad2})`,
      }}
    >
      {b.logoUrl ? (
        <img
          src={b.logoUrl}
          alt=""
          className="w-full h-full rounded-[9px] object-cover"
        />
      ) : (
        b.monogram
      )}
    </span>
  );

  return (
    <div className="relative px-[14px] pt-[14px] pb-1.5" ref={ref}>
      {!collapsed && <div className="micro mb-2 ml-0.5">Business</div>}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-[11px] p-[10px_11px] rounded-[13px] bg-text-primary/[0.04] border border-line transition-all hover:bg-text-primary/[0.07] hover:border-accent/35 text-left",
          collapsed && "justify-center p-[9px]",
        )}
      >
        <Logo b={active} />
        {!collapsed && (
          <>
            <span className="flex-1 min-w-0 font-semibold text-sm truncate">
              {active.name}
            </span>
            <ChevronDown
              className={cn(
                "w-[15px] text-text-faint transition-transform",
                open && "rotate-180",
              )}
            />
          </>
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-[60] mt-1.5 p-1.5 rounded-[14px] dropglass animate-fade-in",
            collapsed ? "left-[10px] w-[210px]" : "left-[14px] right-[14px]",
          )}
        >
          {businesses.map((b) => (
            <div
              key={b.key}
              onClick={() => {
                if (b.key === active.key) {
                  setOpen(false);
                  return;
                }
                setOpen(false);
                setSwitchingToBiz(b.key);
                // Transition: set new entity, invalidate all entity-keyed queries,
                // then dismiss the overlay after 5-7s (ThemeProvider updates --biz-* immediately).
                setTimeout(() => {
                  setActive(b.key);
                  queryClient.invalidateQueries();
                }, 400); // slight delay so overlay animates in first
                setTimeout(() => setSwitchingToBiz(null), 5800);
              }}
              className="flex items-center gap-2.5 p-[9px_10px] rounded-[10px] cursor-pointer hover:bg-text-primary/[0.06]"
            >
              <Logo b={b} size={26} />
              <span className="flex-1 font-semibold text-[13.5px]">
                {b.name}
              </span>
              {b.key === active.key && (
                <Check className="w-4 h-4 text-accent-glow" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
