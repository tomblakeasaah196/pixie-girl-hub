import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A compact, one-line label that can reveal its full text on demand. The
 * control stops the click/keyboard event so it still works inside clickable
 * list rows and cards without opening the surrounding record.
 */
export function ExpandableText({
  text,
  expandedText = text,
  className,
}: {
  text: string;
  /** Optional full value when the collapsed label is a summary. */
  expandedText?: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      type="button"
      aria-expanded={expanded}
      title={expanded ? "Show less" : "Show full name"}
      onClick={(event) => {
        event.stopPropagation();
        setExpanded((current) => !current);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={cn(
        "inline-flex w-full min-w-0 max-w-full items-start gap-1.5 rounded-[3px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        className,
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1",
          expanded ? "whitespace-normal break-words" : "truncate",
        )}
      >
        {expanded ? expandedText : text}
      </span>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint transition-transform",
          expanded && "rotate-180",
        )}
      />
    </button>
  );
}
