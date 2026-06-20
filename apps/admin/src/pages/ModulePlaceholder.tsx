import { useLocation } from "react-router-dom";
import { Wrench } from "lucide-react";
import { MODULES } from "@/lib/modules";
import { useBreadcrumbs } from "@/stores/breadcrumbs";

/**
 * Generic module screen scaffold. Each real module replaces this with its
 * screens (built via the canon's question gate). Demonstrates the shell:
 * top-bar title, sidebar highlight, and the floating App-Menu "Back" pill.
 */
export function ModulePlaceholder() {
  const { pathname } = useLocation();
  const mod = MODULES.find((m) => pathname.startsWith(m.route));
  const Icon = mod?.icon ?? Wrench;
  const label = mod?.label ?? pathname.replace("/", "");
  useBreadcrumbs([{ label }]);

  return (
    <div className="text-center py-16 px-5">
      <div className="w-[84px] h-[84px] rounded-[24px] mx-auto mb-[18px] grid place-items-center text-accent-glow bg-accent/10 border border-accent/20">
        <Icon className="w-[38px] h-[38px]" />
      </div>
      <h3 className="font-display text-2xl font-medium mb-1.5 capitalize">
        {label}
      </h3>
      <p className="text-text-muted max-w-[440px] mx-auto">
        The {label} module renders here, built to{" "}
        <code>docs/Frontend_Engineering_Guide_v2.2.md</code> via the canon's
        question gate. Use the floating <b>Back</b> pill to return to the
        Command Center.
      </p>
    </div>
  );
}
