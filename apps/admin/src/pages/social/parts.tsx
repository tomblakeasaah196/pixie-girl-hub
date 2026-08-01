/**
 * Social Studio — small shared UI bits used across the Calendar / Performance /
 * Account tabs and the day drawer.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

// ── Month picker (Performance tab) ────────────────────────────
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

// ── Form bits (used by the Account tab's add-handle drawer) ────
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
