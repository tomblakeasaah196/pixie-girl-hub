import { PLATFORM_META } from "@/lib/messaging-utils";

interface Props {
  platform: string;
  size?: "xs" | "sm";
  showLabel?: boolean;
}

export function PlatformPill({ platform, size = "xs", showLabel = false }: Props) {
  const m = PLATFORM_META[platform] ?? PLATFORM_META.internal;
  const dim = size === "xs" ? "text-[10px] px-1.5 py-[1px]" : "text-[11px] px-2 py-0.5";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${dim}`}
      style={{ background: m.bg, color: m.color }}
      title={m.label}
    >
      <span>{m.icon}</span>
      {showLabel && <span>{m.label}</span>}
    </span>
  );
}
