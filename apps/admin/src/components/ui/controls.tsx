import { useId, useState, useRef, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Lock, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Modal } from "./Modal";
import { AnchoredDropdown } from "./AnchoredDropdown";

/**
 * Extra form + state controls shared across the Settings module.
 * Visual language matches the existing primitives (glass, hairline,
 * accent-deep filled buttons).
 */

/* ── NumberField — RAW numeric input, NO spinner ──────────────────────────
   Per house rule: number inputs never show the browser spinner/stepper.
   We render a text input with numeric inputMode and filter keystrokes to
   digits (+ optional single decimal point / leading minus). Empty is a
   valid value — callers decide what an empty string means. */
export function NumberField({
  value,
  onChange,
  onBlur,
  allowDecimal = true,
  allowNegative = false,
  placeholder,
  suffix,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  allowDecimal?: boolean;
  allowNegative?: boolean;
  placeholder?: string;
  suffix?: string;
  className?: string;
  disabled?: boolean;
}) {
  const sanitize = (raw: string) => {
    let s = raw.replace(allowDecimal ? /[^0-9.-]/g : /[^0-9-]/g, "");
    if (!allowNegative) s = s.replace(/-/g, "");
    else s = s.replace(/(?!^)-/g, ""); // minus only at start
    if (allowDecimal) {
      const firstDot = s.indexOf(".");
      if (firstDot !== -1) {
        s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
      }
    }
    return s;
  };
  return (
    <div className={cn("relative flex items-center", className)}>
      <input
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(sanitize(e.target.value))}
        onBlur={onBlur}
        className={cn(
          "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50 tabular-nums",
          suffix && "pr-12",
          disabled && "opacity-50",
        )} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
      />
      {suffix && (
        <span className="absolute right-3 text-[12px] text-text-faint pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
}

/* ── Toggle ── */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  /** Accessible name when no visible label is rendered. */
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex items-center gap-2.5 group disabled:opacity-50",
      )}
    >
      <span
        className={cn(
          "relative w-[38px] h-[22px] rounded-full transition-colors shrink-0",
          checked ? "bg-accent-deep" : "bg-text-primary/15",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform shadow",
            checked && "translate-x-[16px]",
          )}
        />
      </span>
      {label && <span className="text-[13px] text-text-primary">{label}</span>}
    </button>
  );
}

/* ── Select ── custom listbox so dark-mode glass styles actually render
   (native <select>/<option> ignore CSS in most browsers) */
export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  disabled,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  disabled?: boolean;
  /** Accessible name for the listbox trigger. */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value);
  const listboxId = useId();
  const optionId = (v: T) => `${listboxId}-opt-${v}`;

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      close();
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      const idx = options.findIndex((o) => o.value === value);
      const next = options[Math.min(idx + 1, options.length - 1)];
      if (next) onChange(next.value);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      const idx = options.findIndex((o) => o.value === value);
      const prev = options[Math.max(idx - 1, 0)];
      if (prev) onChange(prev.value);
    }
    if (e.key === "Home") {
      e.preventDefault();
      const first = options[0];
      if (first) onChange(first.value);
    }
    if (e.key === "End") {
      e.preventDefault();
      const last = options[options.length - 1];
      if (last) onChange(last.value);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={selected ? optionId(selected.value) : undefined}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={handleKey}
        className="w-full h-[42px] px-[11px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none focus-visible:border-accent/50 disabled:opacity-50 flex items-center justify-between gap-2 text-left transition-colors"
      >
        <span className="truncate text-[13px]">{selected?.label ?? ""}</span>
        <ChevronDown
          className={cn(
            "w-4 h-4 shrink-0 text-text-faint transition-transform duration-150",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      <AnchoredDropdown
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        id={listboxId}
        role="listbox"
        aria-label={ariaLabel}
      >
        {options.map((o) => (
          <button
            key={o.value}
            id={optionId(o.value)}
            type="button"
            role="option"
            aria-selected={o.value === value}
            onClick={() => {
              onChange(o.value);
              close();
            }}
            className={cn(
              "w-full px-[11px] py-[9px] text-[13px] text-left transition-colors hover:bg-text-primary/[0.06]",
              o.value === value
                ? "text-accent-glow font-semibold"
                : "text-text-primary",
            )}
          >
            {o.label}
          </button>
        ))}
      </AnchoredDropdown>
    </div>
  );
}

/* ── MultiSelect — chips toggle ── */
export function MultiSelect<T extends string>({
  values,
  onChange,
  options,
}: {
  values: T[];
  onChange: (v: T[]) => void;
  options: { value: T; label: string }[];
}) {
  const toggle = (v: T) =>
    onChange(
      values.includes(v) ? values.filter((x) => x !== v) : [...values, v],
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={cn(
              "px-2.5 py-1.5 rounded-[9px] text-[12px] font-semibold border transition-colors",
              on
                ? "border-accent/45 text-accent-glow bg-accent/[0.1]"
                : "border-line text-text-muted hover:text-text-primary",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── ConfirmDialog ── */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  tone = "danger",
  busy,
  disabled,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "accent";
  busy?: boolean;
  /** Blocks confirming without claiming to be working — e.g. a dialog whose
      message asks for an input the operator hasn't filled in yet. */
  disabled?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-[13px] text-text-muted leading-relaxed">
        {message}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button
          onClick={onClose}
          className="text-[13px] font-semibold text-text-muted px-3 h-9 rounded-[10px] hover:bg-text-primary/[0.06]"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy || disabled}
          className={cn(
            "h-9 px-4 rounded-[10px] text-[13px] font-semibold text-white disabled:opacity-50",
            tone === "danger"
              ? "bg-danger hover:brightness-110"
              : "bg-accent-deep hover:bg-accent",
          )}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ── ReauthDialog — re-enter password before a sensitive edit ──────────────
   Used on reveal/edit of sensitive fields (canon: "on edit it requires the
   user's password again"). The caller decides what to do with the password
   (verify against /auth, or pass to a mutation). */
export function ReauthDialog({
  open,
  onClose,
  onConfirm,
  action = "continue",
  busy,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void;
  action?: string;
  busy?: boolean;
  error?: string | null;
}) {
  const [pw, setPw] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Confirm your password">
      <p className="text-[13px] text-text-muted mb-3 flex items-center gap-2">
        <Lock className="w-4 h-4 text-accent-glow" />
        For your security, re-enter your password to {action}.
      </p>
      <input
        type="password"
        autoFocus
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && pw && onConfirm(pw)}
        placeholder="Password"
        className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50"
      />
      {error && <p className="text-[12px] text-danger mt-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-5">
        <button
          onClick={onClose}
          className="text-[13px] font-semibold text-text-muted px-3 h-9 rounded-[10px] hover:bg-text-primary/[0.06]"
        >
          Cancel
        </button>
        <button
          onClick={() => pw && onConfirm(pw)}
          disabled={!pw || busy}
          className="h-9 px-4 rounded-[10px] text-[13px] font-semibold bg-accent-deep text-[#F4E9D9] disabled:opacity-50 hover:bg-accent"
        >
          {busy ? "Verifying…" : "Confirm"}
        </button>
      </div>
    </Modal>
  );
}

/* ── ErrorState ── */
export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <span className="grid place-items-center w-12 h-12 rounded-xl bg-danger/10 text-danger mb-3">
        <AlertTriangle className="w-6 h-6" />
      </span>
      <div className="font-display text-[16px] mb-1">Something went wrong</div>
      <div className="text-[13px] text-text-muted max-w-[360px]">
        {message ?? "We couldn't load this. Please try again."}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 h-9 px-4 rounded-[10px] text-[13px] font-semibold border border-line hover:border-accent/40"
        >
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      )}
    </div>
  );
}

/* ── DeniedState ── */
export function DeniedState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <span className="grid place-items-center w-12 h-12 rounded-xl bg-warn/10 text-warn mb-3">
        <Lock className="w-6 h-6" />
      </span>
      <div className="font-display text-[16px] mb-1">No access</div>
      <div className="text-[13px] text-text-muted max-w-[360px]">
        {message ??
          "You don't have permission to view this. Ask an admin to grant access in Org & Workflow."}
      </div>
    </div>
  );
}

/* ── Re-export X for convenience in drawers ── */
export { X };
