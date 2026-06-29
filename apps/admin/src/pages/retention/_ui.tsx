/**
 * Tiny shared building blocks for the Retention tabs — keeps inputs/labels
 * consistent with the design canon (glass, hairline, accent focus) without
 * repeating the class string in every screen.
 */

import type { ReactNode } from "react";

export const INPUT =
  "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50 text-[13px]";

export function L({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="micro block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-md animate-shimmer"
          style={{
            height: 56,
            background:
              "linear-gradient(90deg, rgb(var(--text)/.05) 25%, rgb(var(--text)/.1) 37%, rgb(var(--text)/.05) 63%)",
            backgroundSize: "400% 100%",
          }}
        />
      ))}
    </div>
  );
}
