/**
 * Feature Flags & Access page (Q8).
 *
 * Every AI feature has:
 *   - a global on/off toggle
 *   - a per-brand toggle (Pixie Girl / Faitlyn Hair independently)
 *   - a per-user daily cap (staff features only — storefront features
 *     gate on device+IP quotas in Redis)
 *   - a custom "Praxis is resting" message (storefront features only —
 *     shown to shoppers instead of a generic 503)
 *
 * Every change writes an audit row (already done by the service via
 * middleware/audit.js), and the "Recent changes" strip at the bottom
 * of this page reads those rows back so "who turned it off, when"
 * always has an answer without a git blame.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ShieldCheck,
  ArrowLeft,
  Loader2,
  Sparkles,
  Store,
  Save,
  Users,
  MessageSquare,
  History,
  Check,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/primitives";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { toastReport } from "@/lib/error-report";
import { formatDateTime } from "@/lib/format";
import {
  aiGovernanceApi,
  type AiFeatureFlag,
  type AiFlagAuditRow,
} from "@/lib/ai-governance-api";

export function FeatureFlagsPage() {
  useBreadcrumbs([
    { label: "AI Control", href: "/ai-control" },
    { label: "Feature flags & access" },
  ]);
  const qc = useQueryClient();

  const flagsQ = useQuery({
    queryKey: ["ai", "flags"],
    queryFn: () => aiGovernanceApi.listFlags(),
  });
  const auditQ = useQuery({
    queryKey: ["ai", "flags", "audit"],
    queryFn: () => aiGovernanceApi.recentFlagAudit({ limit: 30 }),
    refetchInterval: 60_000,
  });

  const groups = useMemo(() => {
    const g: Record<"internal" | "storefront", AiFeatureFlag[]> = {
      internal: [],
      storefront: [],
    };
    for (const f of flagsQ.data ?? []) g[f.feature_scope].push(f);
    return g;
  }, [flagsQ.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ai", "flags"] });
    qc.invalidateQueries({ queryKey: ["ai", "flags", "audit"] });
  };

  return (
    <div className="max-w-[1080px] mx-auto space-y-7">
      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <ShieldCheck className="w-5 h-5" />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-[22px] font-medium">
            Feature flags & access
          </h2>
          <p className="text-text-muted text-[13px]">
            Toggle features per-brand, cap per-user daily usage, and set the
            "Praxis is resting" copy shoppers see when a feature is off. Every
            change is audit-logged.
          </p>
        </div>
        <Link
          to="/ai-control"
          className="text-[12px] text-text-muted hover:text-text-primary inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> AI Control
        </Link>
      </header>

      {flagsQ.isLoading ? (
        <Card className="p-6">
          <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
        </Card>
      ) : (
        <>
          <FlagGroup
            icon={Sparkles}
            title="Internal features"
            subtitle="Praxis chat, insights narration, training. Staff-facing."
            flags={groups.internal}
            onChange={invalidate}
          />
          <FlagGroup
            icon={Store}
            title="Storefront features"
            subtitle="Shopper-facing AI. When these are off, shoppers see the resting message."
            flags={groups.storefront}
            onChange={invalidate}
          />
        </>
      )}

      {/* Audit trail */}
      <section>
        <h3 className="font-display text-[16px] mb-2.5 inline-flex items-center gap-2">
          <History className="w-4 h-4" /> Recent changes
        </h3>
        <Card className="p-0 overflow-hidden">
          {auditQ.isLoading ? (
            <div className="p-4">
              <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
            </div>
          ) : (auditQ.data ?? []).length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">
              No flag changes yet.
            </p>
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              {(auditQ.data ?? []).map((a, i, arr) => (
                <AuditRow key={a.audit_id} row={a} divider={i !== arr.length - 1} />
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

// ── Flag group ─────────────────────────────────────────────

function FlagGroup({
  icon: Icon,
  title,
  subtitle,
  flags,
  onChange,
}: {
  icon: typeof Sparkles;
  title: string;
  subtitle: string;
  flags: AiFeatureFlag[];
  onChange: () => void;
}) {
  return (
    <section>
      <div className="mb-2.5">
        <h3 className="font-display text-[16px] inline-flex items-center gap-2">
          <Icon className="w-4 h-4 text-accent-glow" /> {title}
        </h3>
        <p className="text-[11.5px] text-text-faint">{subtitle}</p>
      </div>
      <Card className="p-0 overflow-hidden">
        {flags.length === 0 ? (
          <p className="p-5 text-center text-[12.5px] text-text-faint italic">
            No features in this scope yet.
          </p>
        ) : (
          flags.map((f, i, arr) => (
            <FlagRow
              key={f.flag_id}
              flag={f}
              divider={i !== arr.length - 1}
              onChange={onChange}
            />
          ))
        )}
      </Card>
    </section>
  );
}

// ── Flag row ───────────────────────────────────────────────

function FlagRow({
  flag,
  divider,
  onChange,
}: {
  flag: AiFeatureFlag;
  divider: boolean;
  onChange: () => void;
}) {
  const isStorefront = flag.feature_scope === "storefront";
  const [expandUserCap, setExpandUserCap] = useState(false);
  const [expandResting, setExpandResting] = useState(false);

  const toggleGlobal = useMutation({
    mutationFn: (is_enabled: boolean) =>
      aiGovernanceApi.toggleFlag(flag.feature_key, is_enabled),
    onSuccess: onChange,
    onError: (e) => toastReport("AI Control → Flags", `Toggle ${flag.feature_key}`, e),
  });
  const toggleBrand = useMutation({
    mutationFn: (input: { enabled_for_pxg?: boolean; enabled_for_flh?: boolean }) =>
      aiGovernanceApi.setFlagBrandScope(flag.feature_key, input),
    onSuccess: onChange,
    onError: (e) => toastReport("AI Control → Flags", `Brand scope ${flag.feature_key}`, e),
  });

  return (
    <div className={`p-4 ${divider ? "border-b hairline" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[13.5px]">{flag.display_name}</div>
          <p className="text-[11.5px] text-text-faint mt-0.5">
            <code className="font-mono text-[10.5px] bg-panel-2 px-1 rounded">
              {flag.feature_key}
            </code>
            {flag.description && <span> · {flag.description}</span>}
          </p>
        </div>
        <button
          onClick={() => toggleGlobal.mutate(!flag.is_enabled)}
          disabled={toggleGlobal.isPending}
          className={`shrink-0 relative inline-flex w-11 h-6 rounded-full transition-colors ${
            flag.is_enabled ? "bg-accent" : "bg-panel-2 border hairline"
          } disabled:opacity-50`}
          title={flag.is_enabled ? "Turn off globally" : "Turn on globally"}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              flag.is_enabled ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>

      {/* Per-brand toggles */}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <BrandChip
          label="Pixie Girl"
          enabled={flag.enabled_for_pxg}
          globallyOff={!flag.is_enabled}
          onToggle={() =>
            toggleBrand.mutate({ enabled_for_pxg: !flag.enabled_for_pxg })
          }
          pending={toggleBrand.isPending}
        />
        <BrandChip
          label="Faitlyn Hair"
          enabled={flag.enabled_for_flh}
          globallyOff={!flag.is_enabled}
          onToggle={() =>
            toggleBrand.mutate({ enabled_for_flh: !flag.enabled_for_flh })
          }
          pending={toggleBrand.isPending}
        />

        {!isStorefront && (
          <button
            onClick={() => setExpandUserCap((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 border hairline px-2.5 py-1 text-[11.5px] hover:border-accent/40"
          >
            <Users className="w-3 h-3" />
            {flag.daily_user_cap
              ? `Per-user cap · ${flag.daily_user_cap}/day`
              : "No per-user cap"}
          </button>
        )}
        {isStorefront && (
          <button
            onClick={() => setExpandResting((s) => !s)}
            className="inline-flex items-center gap-1.5 rounded-full bg-panel-2 border hairline px-2.5 py-1 text-[11.5px] hover:border-accent/40"
          >
            <MessageSquare className="w-3 h-3" />
            {flag.resting_message ? "Custom resting message" : "Default resting message"}
          </button>
        )}
      </div>

      {expandUserCap && !isStorefront && (
        <UserCapEditor flag={flag} onSaved={onChange} onClose={() => setExpandUserCap(false)} />
      )}
      {expandResting && isStorefront && (
        <RestingMessageEditor
          flag={flag}
          onSaved={onChange}
          onClose={() => setExpandResting(false)}
        />
      )}
    </div>
  );
}

function BrandChip({
  label,
  enabled,
  globallyOff,
  onToggle,
  pending,
}: {
  label: string;
  enabled: boolean;
  globallyOff: boolean;
  onToggle: () => void;
  pending: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={pending || globallyOff}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
        enabled
          ? "bg-accent/10 border-accent/30 text-accent-glow"
          : "bg-panel-2 border-text-faint/20 text-text-faint"
      } disabled:opacity-40 hover:border-accent/50`}
      title={
        globallyOff
          ? "Feature is off globally — enable it first"
          : enabled
            ? `Disable for ${label}`
            : `Enable for ${label}`
      }
    >
      {enabled ? <Check className="w-3 h-3" /> : <span className="w-3 h-3" />}
      {label}
    </button>
  );
}

function UserCapEditor({
  flag,
  onSaved,
  onClose,
}: {
  flag: AiFeatureFlag;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(
    flag.daily_user_cap == null ? "" : String(flag.daily_user_cap),
  );
  const save = useMutation({
    mutationFn: () =>
      aiGovernanceApi.setFlagUserCap(
        flag.feature_key,
        value.trim() === "" ? null : Math.max(0, Number(value) || 0),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) =>
      toastReport("AI Control → Flags", `User cap ${flag.feature_key}`, e),
  });
  return (
    <div className="mt-3 rounded-xl bg-panel-2 border hairline p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] text-text-muted">
          Max calls per staff user per day
        </span>
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Uncapped"
          className="w-24 rounded-lg bg-panel border hairline px-2 py-1 text-[13px] font-mono focus:outline-none focus:border-accent/40"
        />
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded-lg bg-accent text-bg px-3 py-1 text-[12px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {save.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Save className="w-3 h-3" />
          )}
          Save
        </button>
        <button
          onClick={onClose}
          className="text-[12px] text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
      <p className="mt-2 text-[10.5px] text-text-faint">
        Blank = uncapped. Storefront visitors are gated on Redis device+IP
        quotas separately, so this cap only affects staff.
      </p>
    </div>
  );
}

function RestingMessageEditor({
  flag,
  onSaved,
  onClose,
}: {
  flag: AiFeatureFlag;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(flag.resting_message ?? "");
  const save = useMutation({
    mutationFn: () =>
      aiGovernanceApi.setFlagRestingMessage(
        flag.feature_key,
        value.trim() === "" ? null : value.trim(),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) =>
      toastReport("AI Control → Flags", `Resting message ${flag.feature_key}`, e),
  });
  return (
    <div className="mt-3 rounded-xl bg-panel-2 border hairline p-3">
      <span className="text-[11.5px] text-text-muted block mb-1.5">
        Message shown to shoppers when this feature is off or over-cap
      </span>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder="Praxis is resting for now — plain search still works…"
        className="w-full rounded-lg bg-panel border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40 resize-none"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10.5px] text-text-faint">
          {value.length}/500 · Leave blank for the storefront default.
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-[12px] text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="rounded-lg bg-accent text-bg px-3 py-1 text-[12px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {save.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Save className="w-3 h-3" />
            )}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Audit row ──────────────────────────────────────────────

function AuditRow({ row, divider }: { row: AiFlagAuditRow; divider: boolean }) {
  const action = row.action_key.replace(/^ai_governance\.flag\./, "");
  const featureKey =
    (row.metadata && (row.metadata.feature_key as string)) ||
    (row.after_state && (row.after_state.feature_key as string)) ||
    "—";
  const summary = describeAction(action, row.after_state);
  return (
    <div className={`px-4 py-3 ${divider ? "border-b hairline" : ""}`}>
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="font-medium">{row.user_name || "system"}</span>
        <span className="text-text-muted">{summary}</span>
        <code className="font-mono text-[10.5px] bg-panel-2 px-1 rounded text-accent-glow">
          {featureKey}
        </code>
      </div>
      <div className="text-[11px] text-text-faint mt-0.5">
        {formatDateTime(row.occurred_at)}
      </div>
    </div>
  );
}

function describeAction(
  action: string,
  after: Record<string, unknown> | null,
): string {
  switch (action) {
    case "toggle":
      return after?.is_enabled ? "turned ON" : "turned OFF";
    case "brand_scope":
      return "updated brand scope for";
    case "user_cap":
      return "updated per-user cap for";
    case "resting_message":
      return "updated resting message for";
    case "upsert":
      return "created/updated";
    default:
      return action;
  }
}
