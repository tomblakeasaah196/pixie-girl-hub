/**
 * Highlight a substring match inside a result title/subtitle. Case-insensitive.
 * Returns a JSX fragment; safe for null/empty inputs.
 */

import type { ReactNode } from "react";

export function highlight(text: string | null | undefined, q: string): ReactNode {
  if (!text) return null;
  const needle = q.trim();
  if (!needle) return text;
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const hit = text.slice(idx, idx + needle.length);
  const after = text.slice(idx + needle.length);
  return (
    <>
      {before}
      <mark className="bg-accent/25 text-text-primary rounded-[3px] px-[1px]">
        {hit}
      </mark>
      {after}
    </>
  );
}
