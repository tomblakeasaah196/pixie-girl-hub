/**
 * AuditDetailModal — the "click an activity row → small popup with details"
 * surface (canon §5 Modal). Renders a friendly headline (via the shared audit
 * humaniser) plus the plain-English facts a non-technical owner cares about:
 * who, when, what changed. The raw before/after/metadata JSON stays available
 * for power users, tucked into collapsible sections.
 *
 * Accepts a loose entry shape so it can serve BOTH the full Audit Log page
 * (every column present) and the Command Center "My activity" feed (only a
 * handful of columns). Missing fields are simply omitted.
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Globe,
  MapPin,
  ShieldAlert,
  User,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { friendlyModule, humanizeAudit } from "@/lib/audit-humanize";

export interface AuditDetailEntry {
  action: string;
  module?: string | null;
  table_name?: string | null;
  record_id?: string | null;
  metadata?: Record<string, unknown> | null;
  occurred_at?: string | null;
  user_name?: string | null;
  ip_address?: string | null;
  session_id?: string | null;
  business?: string | null;
  is_sensitive?: boolean;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
}

function Fact({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-text-faint shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-[10.5px] uppercase tracking-wide font-bold text-text-faint">
          {label}
        </div>
        <div className="text-[13px] text-text-primary break-words">{value}</div>
      </div>
    </div>
  );
}

function JsonBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: Record<string, unknown>;
  tone: "danger" | "success" | "neutral";
}) {
  const [open, setOpen] = useState(false);
  const ring =
    tone === "danger"
      ? "bg-danger/5 border-danger/20"
      : tone === "success"
        ? "bg-success/5 border-success/20"
        : "bg-text-primary/[0.03] border-line";
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] font-bold text-text-muted hover:text-text-primary transition-colors"
      >
        {open ? (
          <ChevronUp className="w-3.5 h-3.5" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5" />
        )}
        {label}
      </button>
      {open && (
        <pre
          className={`mt-1.5 text-[11px] font-mono p-3 rounded-xl border overflow-x-auto max-h-[200px] text-text-muted ${ring}`}
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditDetailModal({
  entry,
  onClose,
}: {
  entry: AuditDetailEntry | null;
  onClose: () => void;
}) {
  if (!entry) return null;
  const h = humanizeAudit(entry, { self: !entry.user_name });

  const hasBefore =
    entry.before_state && Object.keys(entry.before_state).length > 0;
  const hasAfter =
    entry.after_state && Object.keys(entry.after_state).length > 0;
  const hasMeta =
    entry.metadata && Object.keys(entry.metadata).length > 0;

  return (
    <Modal open={!!entry} onClose={onClose} title="Activity details" size="md">
      <div className="space-y-5">
        {/* Friendly headline */}
        <div className="flex items-start gap-2.5">
          <p className="text-[16px] font-display font-medium leading-snug flex-1">
            {h.text}
          </p>
          {entry.is_sensitive && (
            <Pill tone="warn" dot={false}>
              <ShieldAlert className="w-3 h-3 mr-1" /> Sensitive
            </Pill>
          )}
        </div>

        {/* Facts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-text-primary/[0.02] border border-line">
          {entry.user_name && (
            <Fact
              icon={<User className="w-3.5 h-3.5" />}
              label="Who"
              value={entry.user_name}
            />
          )}
          {entry.occurred_at && (
            <Fact
              icon={<Clock className="w-3.5 h-3.5" />}
              label="When"
              value={formatDateTime(entry.occurred_at)}
            />
          )}
          <Fact
            icon={<MapPin className="w-3.5 h-3.5" />}
            label="Area"
            value={friendlyModule(entry.module)}
          />
          {entry.ip_address && (
            <Fact
              icon={<Globe className="w-3.5 h-3.5" />}
              label="From (IP)"
              value={entry.ip_address}
            />
          )}
        </div>

        {/* Raw detail (power users) */}
        {(hasBefore || hasAfter || hasMeta) && (
          <div className="space-y-3">
            <div className="text-[11px] text-text-faint">
              Technical detail
            </div>
            {hasBefore && (
              <JsonBlock
                label="Before"
                value={entry.before_state as Record<string, unknown>}
                tone="danger"
              />
            )}
            {hasAfter && (
              <JsonBlock
                label="After"
                value={entry.after_state as Record<string, unknown>}
                tone="success"
              />
            )}
            {hasMeta && (
              <JsonBlock
                label="Extra info"
                value={entry.metadata as Record<string, unknown>}
                tone="neutral"
              />
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
