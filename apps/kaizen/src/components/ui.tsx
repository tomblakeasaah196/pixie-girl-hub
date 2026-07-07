import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "@/lib/cx";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("animate-spin", className)} />;
}

type Tone = "green" | "amber" | "red" | "blue" | "neutral";

const toneClasses: Record<Tone, string> = {
  green: "bg-signal-green/15 text-signal-green border-signal-green/30",
  amber: "bg-signal-amber/15 text-signal-amber border-signal-amber/30",
  red: "bg-signal-red/15 text-signal-red border-signal-red/30",
  blue: "bg-signal-blue/15 text-signal-blue border-signal-blue/30",
  neutral: "bg-ink-700/60 text-fog-300 border-line",
};

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        toneClasses[tone],
      )}
    >
      <span
        className={cx("h-1.5 w-1.5 rounded-full", {
          "bg-signal-green": tone === "green",
          "bg-signal-amber": tone === "amber",
          "bg-signal-red": tone === "red",
          "bg-signal-blue": tone === "blue",
          "bg-fog-400": tone === "neutral",
        })}
      />
      {children}
    </span>
  );
}

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("card", className)}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between">
          {title && (
            <h2 className="font-display text-lg font-semibold text-fog-100">
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      {icon && <div className="text-fog-400">{icon}</div>}
      <p className="font-display text-lg text-fog-100">{title}</p>
      {hint && <p className="max-w-md text-sm text-fog-300">{hint}</p>}
      {action}
    </div>
  );
}
