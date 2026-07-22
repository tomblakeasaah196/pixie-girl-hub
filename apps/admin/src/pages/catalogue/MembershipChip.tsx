import { X, EyeOff } from "lucide-react";

/**
 * A removable "already belongs to X" pill, shared by the collection / bundle /
 * shade pickers on the styled-product detail. Shows where the listing lives and
 * gives a one-click way to take it out — the piece the pickers were missing.
 */
export function MembershipChip({
  label,
  hidden,
  busy,
  onRemove,
  removeLabel = "Remove from",
}: {
  label: string;
  /** True when the parent (collection/bundle) is not visible on the storefront. */
  hidden?: boolean;
  busy?: boolean;
  onRemove: () => void;
  removeLabel?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 h-[26px] pl-2.5 pr-1 rounded-full bg-accent/[0.1] border border-accent/25 text-[12px] text-text-primary max-w-full">
      {hidden && (
        <EyeOff
          className="w-3 h-3 text-text-faint shrink-0"
          aria-label="Not visible on storefront"
        />
      )}
      <span className="truncate">{label}</span>
      <button
        type="button"
        disabled={busy}
        onClick={onRemove}
        aria-label={`${removeLabel} ${label}`}
        title={`${removeLabel} ${label}`}
        className="shrink-0 grid place-items-center w-[18px] h-[18px] rounded-full text-text-faint hover:text-danger hover:bg-danger/[0.12] disabled:opacity-50 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </span>
  );
}
