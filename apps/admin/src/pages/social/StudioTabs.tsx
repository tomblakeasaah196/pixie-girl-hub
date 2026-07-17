import type { ComponentType } from "react";

export interface StudioTab<K extends string> {
  key: K;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

/**
 * Native-app segmented control — a sticky, equal-width bar with a sliding
 * accent pill. This is the Studio's whole navigation now: three segments,
 * thumb-sized, no overflow. (Kept local to Social Studio so its app-like feel
 * doesn't leak into the rest of the admin's tab styling.)
 */
export function StudioTabs<K extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: StudioTab<K>[];
  active: K;
  onChange: (key: K) => void;
}) {
  const index = Math.max(0, tabs.findIndex((t) => t.key === active));
  const n = tabs.length;

  return (
    <div className="sticky top-0 z-20 -mx-4 max-md:-mx-4 px-4 pb-2 pt-1 max-md:px-4">
      <div
        className="relative grid rounded-[15px] glass p-1 shadow-glass"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        role="tablist"
      >
        {/* Sliding pill */}
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-1 top-1 rounded-[11px] bg-accent-deep shadow-[0_6px_18px_rgb(var(--accent-deep)/0.45)] transition-transform duration-300 ease-brand"
          style={{
            width: `calc((100% - 8px) / ${n})`,
            left: 4,
            transform: `translateX(calc(${index} * 100%))`,
          }}
        />
        {tabs.map((t) => {
          const on = t.key === active;
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(t.key)}
              className={`relative z-10 flex h-11 items-center justify-center gap-2 rounded-[11px] text-[13px] font-semibold transition-colors ${
                on ? "text-[#F4E9D9]" : "text-text-muted hover:text-text-primary"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
