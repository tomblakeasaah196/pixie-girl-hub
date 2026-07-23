import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  title: string;
  subtitle?: string;
  /** Uncontrolled initial state. Ignored once the user has toggled it. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/** A titled section that expands/collapses — shortens a long form at rest. */
export function Collapsible({ title, subtitle, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border hairline bg-panel-2/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-[13px] font-medium text-text-primary">
            {title}
          </span>
          {subtitle && (
            <span className="block text-[11px] text-text-faint mt-0.5">
              {subtitle}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-text-faint shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <div className="px-4 pb-4 space-y-2">{children}</div>}
    </div>
  );
}
