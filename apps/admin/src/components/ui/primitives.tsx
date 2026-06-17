import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { money as fmtMoney } from "@/lib/format";

/* ── Button ──────────────────────────────────────────────────────────────
   Primary = filled #690909 (accent-deep) + cream text — Pixie "Scheme 5".
   Accent is used sparingly; secondary/ghost are neutral glass. */
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "secondary", size = "md", icon, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold rounded-xl border transition-all duration-300 active:translate-y-px disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-[33px] px-3 text-xs rounded-[10px]" : "h-10 px-4 text-[13px]",
        variant === "primary" &&
          "bg-accent-deep border-accent-deep text-[#F4E9D9] hover:bg-accent hover:shadow-[0_8px_26px_rgb(var(--accent-deep)/0.5)]",
        variant === "secondary" &&
          "bg-text-primary/[0.04] border-line text-text-primary hover:bg-text-primary/[0.09]",
        variant === "ghost" &&
          "bg-transparent border-transparent text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary",
        variant === "danger" &&
          "bg-danger/10 border-danger/40 text-danger hover:bg-danger/20",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

/* ── IconButton ── */
export const IconButton = forwardRef<HTMLButtonElement, BtnProps & { dot?: boolean }>(
  function IconButton({ className, children, dot, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cn(
          "relative grid place-items-center w-[38px] h-[38px] rounded-[11px] border-0 bg-text-primary/[0.05] text-text-muted cursor-pointer transition-all duration-300 hover:bg-text-primary/10 hover:text-text-primary",
          className,
        )}
        {...rest}
      >
        {children}
        {dot && (
          <span className="absolute top-2 right-[9px] w-[7px] h-[7px] rounded-full bg-accent border-2 border-surface" />
        )}
      </button>
    );
  },
);

/* ── Card / Section ── */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("glass rounded-[var(--radius)] shadow-glass", className)}>{children}</div>;
}

/* ── Pill / StatusPill ── */
export type Tone = "success" | "warn" | "danger" | "info" | "accent" | "neutral";
const TONE: Record<Tone, string> = {
  success: "text-success bg-success/[0.13]",
  warn: "text-warn bg-warn/[0.14]",
  danger: "text-danger bg-danger/[0.13]",
  info: "text-info bg-info/[0.16]",
  accent: "text-accent-glow bg-accent/[0.12]",
  neutral: "text-text-muted bg-text-primary/[0.06]",
};
export function Pill({ tone = "neutral", children, dot = true }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide px-[11px] py-1 rounded-full", TONE[tone])}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/* ── Skeleton ── */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("rounded-md animate-shimmer", className)}
      style={{
        height: 13,
        background:
          "linear-gradient(90deg, rgb(var(--text)/.05) 25%, rgb(var(--text)/.1) 37%, rgb(var(--text)/.05) 63%)",
        backgroundSize: "400% 100%",
        ...style,
      }}
    />
  );
}

/* ── EmptyState ── */
export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-14 px-5">
      <div className="w-[78px] h-[78px] rounded-[22px] mx-auto mb-[18px] grid place-items-center text-accent-glow bg-accent/10 border border-accent/20">
        {icon}
      </div>
      <h3 className="font-display text-xl font-medium mb-1.5">{title}</h3>
      {message && <p className="text-text-muted max-w-[360px] mx-auto mb-4">{message}</p>}
      {action}
    </div>
  );
}

/* ── KpiTile — value in cream serif; accent only on the left edge ── */
export function KpiTile({
  label,
  value,
  delta,
  tone = "accent",
}: {
  label: string;
  value: string;
  delta?: { up: boolean; text: string };
  tone?: Tone;
}) {
  const edge = tone === "warn" ? "rgb(var(--warn))" : "rgb(var(--accent))";
  return (
    <div
      className="glass rounded-[var(--radius)] shadow-glass p-[17px_18px] max-md:p-[12px_14px] border-l-[3px]"
      style={{ borderLeftColor: edge }}
    >
      <div className="micro">{label}</div>
      <div className="font-display font-medium text-[28px] max-md:text-[22px] mt-2 max-md:mt-1.5 tabular-nums">{value}</div>
      {delta && (
        <div className={cn("text-[11px] font-bold mt-1.5", delta.up ? "text-success" : "text-danger")}>
          {delta.up ? "▲" : "▼"} {delta.text}
        </div>
      )}
    </div>
  );
}

/* ── MoneyText — NGN truth + display currency (canon §4.6) ── */
export function MoneyText({
  ngn,
  display,
  currency = "NGN",
  className,
}: {
  ngn: number;
  display?: number;
  currency?: string;
  className?: string;
}) {
  const primary = display != null && currency !== "NGN" ? fmtMoney(display, currency) : fmtMoney(ngn, "NGN");
  const secondary = display != null && currency !== "NGN" ? fmtMoney(ngn, "NGN") : null;
  return (
    <span className={cn("font-display font-medium tabular-nums", className)}>
      {primary}
      {secondary && <span className="block font-mono text-text-faint text-[10px]">{secondary}</span>}
    </span>
  );
}

/* ── MaskedField — keys/PINs/account numbers never render raw ── */
export function MaskedField({ value, visibleTail = 4 }: { value: string; visibleTail?: number }) {
  const masked = "•".repeat(Math.max(0, value.length - visibleTail)) + value.slice(-visibleTail);
  return <span className="font-mono text-text-muted">{masked}</span>;
}
