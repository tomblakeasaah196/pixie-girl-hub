import { useState, useRef, useEffect, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, Lock, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Modal } from "./Modal";

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
  allowDecimal = true,
  allowNegative = false,
  placeholder,
  suffix,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
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
        className={cn(
          "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary outline-none transition-colors focus:border-accent/50 tabular-nums",
          suffix && "pr-12",
          disabled && "opacity-50",
        )}
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
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
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
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    }
    if (e.key === "Escape") setOpen(false);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = options.findIndex((o) => o.value === value);
      const next = options[Math.min(idx + 1, options.length - 1)];
      if (next) onChange(next.value);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = options.findIndex((o) => o.value === value);
      const prev = options[Math.max(idx - 1, 0)];
      if (prev) onChange(prev.value);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
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
        />
      </button>
      {open && (
        <div className="select-dropdown-list absolute z-50 top-[calc(100%+4px)] left-0 right-0 rounded-[11px] overflow-hidden py-1">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value);
                setOpen(false);
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
        </div>
      )}
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
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "accent";
  busy?: boolean;
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
          disabled={busy}
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
