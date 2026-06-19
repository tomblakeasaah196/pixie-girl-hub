import type { PipelineStage } from "@/pages/contacts/types";

interface StagePillProps {
  stage?: PipelineStage | null;
  stageName?: string;
  stageColour?: string | null;
  size?: "sm" | "md";
}

export function StagePill({
  stage,
  stageName,
  stageColour,
  size = "sm",
}: StagePillProps) {
  const name = stage?.display_name ?? stageName ?? "Unknown";
  const colour = stage?.colour ?? stageColour ?? "#690909";

  const sizeClasses =
    size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-1 text-[12px]";

  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${sizeClasses}`}
      style={{
        backgroundColor: `${colour}22`,
        color: colour,
        border: `1px solid ${colour}44`,
      }}
    >
      {name}
    </span>
  );
}

export function ProbabilityBar({
  probability,
  colour,
}: {
  probability: number;
  colour?: string | null;
}) {
  const pct = Math.min(100, Math.max(0, probability));
  const c = colour ?? "#690909";
  return (
    <div className="w-full h-1 rounded-full bg-text-primary/[0.08] overflow-hidden">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, backgroundColor: c }}
      />
    </div>
  );
}
