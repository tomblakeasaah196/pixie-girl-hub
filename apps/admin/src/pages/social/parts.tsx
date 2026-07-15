/**
 * Social Studio — small shared UI bits used across Board/Calendar/Performance/
 * Team tabs and the post/plan detail drawers.
 */

import { useState } from "react";
import { Star, Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useStyledProducts } from "@/lib/catalogue";

// ── Month picker (Performance / Team tabs) ────────────────────
export function MonthPicker({
  value,
  onChange,
}: {
  /** YYYY-MM */
  value: string;
  onChange: (v: string) => void;
}) {
  const shift = (n: number) => {
    const [y, m] = value.split("-").map(Number);
    const d = new Date(y, m - 1 + n, 1);
    onChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const [y, m] = value.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  return (
    <div className="inline-flex items-center gap-1 rounded-[11px] glass shadow-glass px-1 py-1">
      <button
        onClick={() => shift(-1)}
        className="w-7 h-7 grid place-items-center rounded-[8px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]"
        aria-label="Previous month"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="text-[13px] font-semibold px-2 min-w-[120px] text-center">{label}</span>
      <button
        onClick={() => shift(1)}
        className="w-7 h-7 grid place-items-center rounded-[8px] text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]"
        aria-label="Next month"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ── Form bits (ported from the old composer) ─────────────────
export function Labelled({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  prefix,
  mono,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
  mono?: boolean;
  type?: string;
}) {
  return (
    <div className="flex items-center rounded-[11px] bg-text-primary/[0.04] border border-line focus-within:border-accent/50">
      {prefix && <span className="pl-3 text-text-faint text-[13px]">{prefix}</span>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-transparent px-3 h-[42px] text-[13px] outline-none ${mono ? "font-mono text-[12px]" : ""}`}
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore=""
        data-form-type="other"
      />
    </div>
  );
}

/** Format a date as a `datetime-local` value (YYYY-MM-DDTHH:mm). When `hour`
 *  is given the time is pinned to that hour; otherwise the date's own time is
 *  kept. */
export function toLocalInput(date: Date, hour?: number): string {
  const d = new Date(date);
  if (hour !== undefined) d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Star rating (creative_rating: manager's subjective grade) ───
export function StarRating({
  value,
  onChange,
  readOnly,
  size = "md",
}: {
  value: number | null;
  onChange?: (v: number) => void;
  readOnly?: boolean;
  size?: "sm" | "md";
}) {
  const dim = size === "sm" ? "w-3.5 h-3.5" : "w-5 h-5";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(n)}
          className={readOnly ? "cursor-default" : "cursor-pointer"}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
        >
          <Star
            className={`${dim} ${
              value !== null && n <= value
                ? "fill-warn text-warn"
                : "fill-transparent text-text-faint"
            }`}
          />
        </button>
      ))}
    </div>
  );
}

/** Post Grade: performance_score (objective) + creative_rating (subjective),
 *  always shown side by side — never blended into one number. */
export function PostGrade({
  performanceScore,
  creativeRating,
}: {
  performanceScore: string | null;
  creativeRating: number | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <div>
        <div className="text-[9.5px] uppercase tracking-widest text-text-faint">Performance</div>
        <div className="font-display text-[15px] tabular-nums">
          {performanceScore !== null ? `${Math.round(Number(performanceScore))}/100` : "—"}
        </div>
      </div>
      <div className="w-px h-7 bg-line" />
      <div>
        <div className="text-[9.5px] uppercase tracking-widest text-text-faint">Creative</div>
        <StarRating value={creativeRating} readOnly size="sm" />
      </div>
    </div>
  );
}

// ── Product tag picker (tagged_product_ids -> storefront "as seen on" badge) ──
export function ProductTagPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState("");
  // Tags reference the *styled* (published, purchasable) product — the same
  // id the storefront's product page resolves — not the underlying base product.
  const searchQ = useStyledProducts({ q: q.trim(), status: "live" });
  const results = q.trim().length > 1 ? (searchQ.data ?? []).slice(0, 8) : [];

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 text-[11px] bg-accent/[0.1] text-accent-glow rounded-full pl-2.5 pr-1.5 py-1"
            >
              {id.slice(0, 8)}…
              <button
                type="button"
                onClick={() => onChange(value.filter((v) => v !== id))}
                aria-label="Remove product tag"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search products to tag…"
          className="w-full h-[38px] pl-8 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[12.5px] outline-none focus:border-accent/50"
        />
      </div>
      {q.trim().length > 1 && results.length > 0 && (
        <div className="rounded-[10px] border border-line divide-y divide-line overflow-hidden">
          {results
            .filter((p) => !value.includes(p.styled_id))
            .map((p) => (
              <button
                key={p.styled_id}
                type="button"
                onClick={() => {
                  onChange([...value, p.styled_id]);
                  setQ("");
                }}
                className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-text-primary/[0.04]"
              >
                {p.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
