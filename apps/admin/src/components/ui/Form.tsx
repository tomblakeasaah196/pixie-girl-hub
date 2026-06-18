import { type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Schema-driven form atoms (canon §5). Real forms mirror the endpoint
 *  payload_schema and map server errors back onto fields. */

export function FormSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      {title && <div className="micro mb-3">{title}</div>}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/**
 * Responsive field grid. Single column on phones (base `grid-cols-1`), then
 * 2 (or 3) columns from `md:` up — so wide modals/pages lay fields out side by
 * side on desktop while phones are completely unchanged. Use this instead of a
 * bare `grid grid-cols-2` so fields don't stay cramped two-up on small screens.
 */
export function FormGrid({
  cols = 2,
  className,
  children,
}: {
  cols?: 2 | 3;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 grid-cols-1",
        cols === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.1em] font-bold text-text-muted mb-2">
        {label}
        {hint && <span className="normal-case tracking-normal font-normal text-text-faint">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50",
        className,
      )}
      {...rest}
    />
  );
}

/** Sticky, dirty-aware action bar for edit surfaces. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onCancel,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="sticky bottom-0 flex items-center justify-end gap-2 p-3 dropglass rounded-b-[var(--radius)]">
      {onCancel && (
        <button className="text-[13px] font-semibold text-text-muted px-3 h-9 rounded-[10px] hover:bg-text-primary/[0.06]" onClick={onCancel}>
          Cancel
        </button>
      )}
      <button
        disabled={!dirty || saving}
        onClick={onSave}
        className="h-9 px-4 rounded-[10px] text-[13px] font-semibold bg-accent-deep text-[#F4E9D9] disabled:opacity-50 hover:bg-accent"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
