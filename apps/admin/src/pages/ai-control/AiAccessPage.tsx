/**
 * AI Access page — who may use Praxis & the AI features.
 *
 * Praxis launched CEO-only; this screen is how the CEO opens it up. Pick any
 * staff member (search-as-you-type), choose the features (defaults to the
 * whole AI), grant — it applies on their very next AI call, no re-login.
 *
 * Two layers gate a staff member's AI:
 *   1. Module permission (Praxis AI / Insights) from their role — the
 *      permissions tab in Users & access. That's what shows the screens.
 *   2. An access grant here (shared.ai_access_grants) — that's what lets
 *      the AI actually answer them. The CEO bypasses grants entirely.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  ArrowLeft,
  Search,
  Sparkles,
  Crown,
  Check,
  X,
  Loader2,
  UserPlus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, Pill, Skeleton } from "@/components/ui/primitives";
import { ConfirmDialog, ErrorState } from "@/components/ui/controls";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { toastReport } from "@/lib/error-report";
import { formatDate } from "@/lib/format";
import {
  aiGovernanceApi,
  type AiAccessGrant,
  type AiFeatureFlag,
  type AiGrantUser,
} from "@/lib/ai-governance-api";

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function AiAccessPage() {
  useBreadcrumbs([
    { label: "AI Control", href: "/ai-control" },
    { label: "AI access" },
  ]);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<AiGrantUser | null>(null);

  const flagsQ = useQuery({
    queryKey: ["ai", "flags"],
    queryFn: () => aiGovernanceApi.listFlags(),
  });
  const grantsQ = useQuery({
    queryKey: ["ai", "grants"],
    queryFn: () => aiGovernanceApi.listGrants(),
  });

  // Grants only gate staff features — storefront AI rides on shopper quotas.
  const internalFlags = useMemo(
    () => (flagsQ.data ?? []).filter((f) => f.feature_scope === "internal"),
    [flagsQ.data],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["ai", "grants"] });
    qc.invalidateQueries({ queryKey: ["ai", "grant-users"] });
  };

  return (
    <div className="max-w-[1080px] mx-auto space-y-7">
      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Users className="w-5 h-5" />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-[22px] font-medium">AI access</h2>
          <p className="text-text-muted text-[13px]">
            Praxis started CEO-only. Grant any staff member the AI here — it
            works on their very next request, no re-login. The CEO always has
            full access.
          </p>
        </div>
        <Link
          to="/ai-control"
          className="text-[12px] text-text-muted hover:text-text-primary inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> AI Control
        </Link>
      </header>

      <GrantPanel
        flags={internalFlags}
        flagsLoading={flagsQ.isLoading}
        selected={selected}
        onSelect={setSelected}
        onGranted={() => {
          setSelected(null);
          invalidate();
        }}
      />

      <AccessList
        grantsQ={grantsQ}
        internalFlags={internalFlags}
        onChanged={invalidate}
      />

      <p className="text-[11.5px] text-text-faint leading-relaxed">
        <ShieldCheck className="w-3.5 h-3.5 inline-block mr-1 align-[-2px]" />
        A grant switches the AI on for that person. Which screens they see
        (Praxis AI, Insights) still comes from their role's module permissions
        in Settings → Users &amp; access — both layers apply, and every grant
        or revoke here is audit-logged.
      </p>
    </div>
  );
}

// ── Grant panel: employee picker + feature selection ───────

function GrantPanel({
  flags,
  flagsLoading,
  selected,
  onSelect,
  onGranted,
}: {
  flags: AiFeatureFlag[];
  flagsLoading: boolean;
  selected: AiGrantUser | null;
  onSelect: (u: AiGrantUser | null) => void;
  onGranted: () => void;
}) {
  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);

  const usersQ = useQuery({
    queryKey: ["ai", "grant-users", debounced],
    queryFn: () =>
      aiGovernanceApi.searchGrantUsers({ search: debounced, limit: 20 }),
  });

  return (
    <section>
      <h3 className="font-display text-[16px] mb-2.5 inline-flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-accent-glow" /> Grant access
      </h3>
      <Card className="p-4">
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff by name or email…"
            className="w-full rounded-xl bg-panel-2 border hairline pl-9 pr-3 py-2.5 text-[13.5px] focus:outline-none focus:border-accent/40"
          />
        </label>

        {/* Results */}
        <div className="mt-3">
          {usersQ.isLoading ? (
            <div className="space-y-2 py-1">
              <Skeleton className="w-2/3" />
              <Skeleton className="w-1/2" />
              <Skeleton className="w-3/5" />
            </div>
          ) : usersQ.isError ? (
            <ErrorState
              message="Couldn't search staff."
              onRetry={() => usersQ.refetch()}
            />
          ) : (usersQ.data ?? []).length === 0 ? (
            <p className="py-4 text-center text-[12.5px] text-text-faint italic">
              No staff match “{debounced}”.
            </p>
          ) : (
            <div className="max-h-[300px] overflow-y-auto -mx-1 px-1">
              {(usersQ.data ?? []).map((u) => (
                <UserRow
                  key={u.user_id}
                  user={u}
                  featureTotal={flags.length}
                  active={selected?.user_id === u.user_id}
                  onClick={() =>
                    onSelect(selected?.user_id === u.user_id ? null : u)
                  }
                />
              ))}
            </div>
          )}
        </div>

        {selected && (
          <FeaturePicker
            key={selected.user_id}
            user={selected}
            flags={flags}
            flagsLoading={flagsLoading}
            onCancel={() => onSelect(null)}
            onGranted={onGranted}
          />
        )}
      </Card>
    </section>
  );
}

function UserRow({
  user,
  featureTotal,
  active,
  onClick,
}: {
  user: AiGrantUser;
  featureTotal: number;
  active: boolean;
  onClick: () => void;
}) {
  const grantedCount = user.granted_feature_keys.length;
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
        active ? "bg-accent/10 border border-accent/30" : "hover:bg-panel-2"
      }`}
    >
      <span className="grid place-items-center w-9 h-9 rounded-full bg-accent/10 text-accent-glow text-[12px] font-semibold shrink-0">
        {initials(user.display_name) || "?"}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13.5px] font-medium truncate">
          {user.display_name}
        </span>
        <span className="block text-[11.5px] text-text-faint truncate">
          {user.email}
        </span>
      </span>
      {user.is_ceo ? (
        <Pill tone="accent" dot={false}>
          <Crown className="w-3 h-3" /> CEO · full access
        </Pill>
      ) : grantedCount > 0 ? (
        <Pill
          tone={grantedCount >= featureTotal ? "success" : "info"}
          dot={false}
        >
          {grantedCount >= featureTotal
            ? "Full AI access"
            : `${grantedCount} feature${grantedCount === 1 ? "" : "s"}`}
        </Pill>
      ) : user.status === "invited" ? (
        <Pill tone="info" dot={false}>
          Invited
        </Pill>
      ) : null}
    </button>
  );
}

// ── Feature picker for the selected user ───────────────────

function FeaturePicker({
  user,
  flags,
  flagsLoading,
  onCancel,
  onGranted,
}: {
  user: AiGrantUser;
  flags: AiFeatureFlag[];
  flagsLoading: boolean;
  onCancel: () => void;
  onGranted: () => void;
}) {
  // Default to the whole AI — the common case is "give them everything".
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(flags.map((f) => f.feature_key)),
  );
  // Flags can land after the user was selected (slow first load) — fill the
  // default selection in once they arrive rather than leaving it empty.
  useEffect(() => {
    setPicked((prev) =>
      prev.size === 0 ? new Set(flags.map((f) => f.feature_key)) : prev,
    );
  }, [flags]);
  const [cap, setCap] = useState("");
  const allPicked = picked.size === flags.length && flags.length > 0;

  const grantMut = useMutation({
    mutationFn: () =>
      aiGovernanceApi.grantAccess({
        user_id: user.user_id,
        feature_keys: [...picked],
        monthly_cap_ngn:
          cap.trim() === "" ? undefined : Math.max(0, Number(cap) || 0),
      }),
    onSuccess: onGranted,
    onError: (e) =>
      toastReport("AI Control → AI access", `Grant to ${user.display_name}`, e),
  });

  if (user.is_ceo) {
    return (
      <div className="mt-4 rounded-xl bg-panel-2 border hairline p-4 flex items-center gap-3">
        <Crown className="w-4 h-4 text-accent-glow shrink-0" />
        <p className="text-[12.5px] text-text-muted">
          <span className="font-medium text-text-primary">
            {user.display_name}
          </span>{" "}
          is the CEO — full AI access is built in, there's nothing to grant.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl bg-panel-2 border hairline p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[13px]">
          Granting to{" "}
          <span className="font-medium">{user.display_name}</span>
        </div>
        <button
          onClick={() =>
            setPicked(
              allPicked ? new Set() : new Set(flags.map((f) => f.feature_key)),
            )
          }
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors hover:border-accent/50 ${
            allPicked
              ? "bg-accent/10 border-accent/30 text-accent-glow"
              : "bg-panel border-text-faint/20 text-text-muted"
          }`}
        >
          <Sparkles className="w-3 h-3" /> Entire AI (all features)
        </button>
      </div>

      {flagsLoading ? (
        <div className="mt-3">
          <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {flags.map((f) => {
            const on = picked.has(f.feature_key);
            const already = user.granted_feature_keys.includes(f.feature_key);
            return (
              <button
                key={f.feature_key}
                onClick={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(f.feature_key)) next.delete(f.feature_key);
                    else next.add(f.feature_key);
                    return next;
                  })
                }
                title={
                  f.description ||
                  (already ? "Already granted — re-granting is harmless" : "")
                }
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] transition-colors hover:border-accent/50 ${
                  on
                    ? "bg-accent/10 border-accent/30 text-accent-glow"
                    : "bg-panel border-text-faint/20 text-text-faint"
                }`}
              >
                {on ? <Check className="w-3 h-3" /> : <span className="w-3 h-3" />}
                {f.display_name}
                {already && (
                  <span className="text-[9.5px] uppercase tracking-wider opacity-70">
                    granted
                  </span>
                )}
                {!f.is_enabled && (
                  <span className="text-[9.5px] uppercase tracking-wider opacity-70">
                    off
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] text-text-muted">
          Monthly cap (₦, optional)
        </span>
        <input
          type="number"
          min={0}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          placeholder="Uncapped"
          className="w-28 rounded-lg bg-panel border hairline px-2 py-1 text-[13px] font-mono focus:outline-none focus:border-accent/40"
        />
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="text-[12px] text-text-muted hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          onClick={() => grantMut.mutate()}
          disabled={grantMut.isPending || picked.size === 0}
          className="rounded-lg bg-accent text-bg px-4 py-1.5 text-[12.5px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {grantMut.isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <UserPlus className="w-3.5 h-3.5" />
          )}
          Grant access
        </button>
      </div>
      <p className="mt-2 text-[10.5px] text-text-faint">
        Applies immediately — their next Praxis or Insights request goes
        through. Features marked “off” are globally disabled right now; the
        grant still sticks for when they're switched back on.
      </p>
    </div>
  );
}

// ── Who has access ─────────────────────────────────────────

interface UserGrants {
  user_id: string;
  user_name: string;
  user_email: string;
  grants: AiAccessGrant[];
}

function AccessList({
  grantsQ,
  internalFlags,
  onChanged,
}: {
  grantsQ: {
    data?: AiAccessGrant[];
    isLoading: boolean;
    isError: boolean;
    refetch: () => void;
  };
  internalFlags: AiFeatureFlag[];
  onChanged: () => void;
}) {
  const grouped = useMemo<UserGrants[]>(() => {
    const byUser = new Map<string, UserGrants>();
    for (const g of grantsQ.data ?? []) {
      let entry = byUser.get(g.user_id);
      if (!entry) {
        entry = {
          user_id: g.user_id,
          user_name: g.user_name,
          user_email: g.user_email,
          grants: [],
        };
        byUser.set(g.user_id, entry);
      }
      entry.grants.push(g);
    }
    return [...byUser.values()];
  }, [grantsQ.data]);

  return (
    <section>
      <h3 className="font-display text-[16px] mb-2.5 inline-flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent-glow" /> Who has AI access
      </h3>
      <Card className="p-0 overflow-hidden">
        {grantsQ.isLoading ? (
          <div className="p-5 space-y-3">
            <Skeleton className="w-2/3" />
            <Skeleton className="w-1/2" />
            <Skeleton className="w-3/5" />
          </div>
        ) : grantsQ.isError ? (
          <ErrorState
            message="Couldn't load the access list."
            onRetry={() => grantsQ.refetch()}
          />
        ) : grouped.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-[13px] text-text-muted">
              No staff have AI access yet — only the CEO (always on).
            </p>
            <p className="text-[11.5px] text-text-faint mt-1">
              Search an employee above to grant their first access.
            </p>
          </div>
        ) : (
          grouped.map((u, i) => (
            <UserGrantsRow
              key={u.user_id}
              entry={u}
              featureTotal={internalFlags.length}
              divider={i !== grouped.length - 1}
              onChanged={onChanged}
            />
          ))
        )}
      </Card>
    </section>
  );
}

function UserGrantsRow({
  entry,
  featureTotal,
  divider,
  onChanged,
}: {
  entry: UserGrants;
  featureTotal: number;
  divider: boolean;
  onChanged: () => void;
}) {
  const [confirmAll, setConfirmAll] = useState(false);

  const revokeOne = useMutation({
    mutationFn: (grant_id: string) => aiGovernanceApi.revokeGrant(grant_id),
    onSuccess: onChanged,
    onError: (e) =>
      toastReport("AI Control → AI access", `Revoke for ${entry.user_name}`, e),
  });
  const revokeAll = useMutation({
    mutationFn: async () => {
      for (const g of entry.grants) {
        await aiGovernanceApi.revokeGrant(g.grant_id);
      }
    },
    onSuccess: () => {
      setConfirmAll(false);
      onChanged();
    },
    onError: (e) => {
      toastReport(
        "AI Control → AI access",
        `Revoke all for ${entry.user_name}`,
        e,
      );
      // Some grants may already be gone — refresh either way.
      onChanged();
    },
  });

  const full = featureTotal > 0 && entry.grants.length >= featureTotal;
  const first = entry.grants[0]!;

  return (
    <div className={`p-4 ${divider ? "border-b hairline" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-9 h-9 rounded-full bg-accent/10 text-accent-glow text-[12px] font-semibold shrink-0">
          {initials(entry.user_name) || "?"}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-[13.5px]">
              {entry.user_name}
            </span>
            {full ? (
              <Pill tone="success" dot={false}>
                Full AI access
              </Pill>
            ) : (
              <Pill tone="info" dot={false}>
                {entry.grants.length} of {featureTotal} features
              </Pill>
            )}
          </div>
          <p className="text-[11.5px] text-text-faint mt-0.5 truncate">
            {entry.user_email} · granted{" "}
            {first.granted_by_name ? `by ${first.granted_by_name} ` : ""}
            {formatDate(first.granted_at)}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {entry.grants.map((g) => (
              <span
                key={g.grant_id}
                className="inline-flex items-center gap-1 rounded-full bg-panel-2 border hairline pl-2.5 pr-1 py-0.5 text-[11px]"
              >
                {g.feature_name}
                {g.monthly_cap_ngn != null && (
                  <span className="font-mono text-[10px] text-text-faint">
                    ₦{Number(g.monthly_cap_ngn).toLocaleString()}/mo
                  </span>
                )}
                <button
                  onClick={() => revokeOne.mutate(g.grant_id)}
                  disabled={revokeOne.isPending || revokeAll.isPending}
                  title={`Revoke ${g.feature_name}`}
                  className="grid place-items-center w-5 h-5 rounded-full text-text-faint hover:text-danger hover:bg-danger/10 disabled:opacity-40"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={() => setConfirmAll(true)}
          disabled={revokeAll.isPending}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-[11.5px] text-text-muted hover:text-danger hover:border-danger/40 disabled:opacity-50"
        >
          {revokeAll.isPending ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Trash2 className="w-3 h-3" />
          )}
          Revoke all
        </button>
      </div>

      <ConfirmDialog
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={() => revokeAll.mutate()}
        busy={revokeAll.isPending}
        title="Revoke all AI access?"
        confirmLabel="Revoke all"
        message={
          <>
            <span className="font-medium text-text-primary">
              {entry.user_name}
            </span>{" "}
            will lose all {entry.grants.length} AI feature
            {entry.grants.length === 1 ? "" : "s"} immediately. Their module
            permissions are untouched — you can re-grant at any time.
          </>
        }
      />
    </div>
  );
}
