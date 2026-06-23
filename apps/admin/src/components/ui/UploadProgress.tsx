import { cn } from "@/lib/cn";

/**
 * Thin determinate upload-progress bar, shown while a file is uploading so the
 * user always sees that something is happening (canon: every screen reports
 * its busy state). Render it conditionally on a 0–100 value; pass null/undefined
 * when idle and it renders nothing.
 *
 * Once the body is fully sent (100%) the server may still be processing
 * (compression, HEIC conversion, transcode) — the full bar pulses to read as
 * "finishing" until the caller hides it on completion.
 */
export function UploadProgress({
  value,
  label = "Uploading…",
  doneLabel = "Finishing…",
  className,
}: {
  /** 0–100, or null/undefined when idle (renders nothing). */
  value: number | null | undefined;
  label?: string;
  doneLabel?: string;
  className?: string;
}) {
  if (value === null || value === undefined) return null;
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const done = pct >= 100;
  return (
    <div
      className={cn("space-y-1", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="flex items-center justify-between text-[11px] text-text-faint">
        <span>{done ? doneLabel : label}</span>
        <span className="font-mono tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-text-primary/10">
        <div
          className={cn(
            "h-full rounded-full bg-accent transition-[width] duration-200 ease-out",
            done && "animate-pulse",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
