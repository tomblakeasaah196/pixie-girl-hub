import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface TimelineStep {
  title: string;
  detail?: string;
  state: "done" | "current" | "todo";
}

/** Vertical step timeline — order/state-machine history, audit chains (canon §5). */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div>
      {steps.map((s, i) => (
        <div key={i} className="flex gap-[13px] relative pb-5 last:pb-0">
          {i < steps.length - 1 && (
            <span className="absolute left-[11px] top-6 -bottom-0.5 w-[1.5px] bg-line/30" />
          )}
          <span
            className={cn(
              "w-6 h-6 rounded-full border-[1.5px] grid place-items-center shrink-0 text-[11px] bg-bg/50",
              s.state === "done" && "bg-success border-success text-white",
              s.state === "current" && "border-accent text-accent shadow-[0_0_0_4px_rgb(var(--accent)/0.12)]",
              s.state === "todo" && "border-line/40 text-text-faint",
            )}
          >
            {s.state === "done" ? <Check className="w-3 h-3" /> : s.state === "current" ? "●" : ""}
          </span>
          <div>
            <div className="font-semibold text-[13px]">{s.title}</div>
            {s.detail && <div className="text-[11.5px] text-text-muted mt-px">{s.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
