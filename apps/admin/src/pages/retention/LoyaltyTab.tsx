/**
 * Loyalty tab — tiers (read-only; no write endpoint yet, D-1), the
 * config-driven earn rules (CRUD), and a points-economy note. Tier thresholds
 * are rendered from shared.loyalty_tiers (never hard-coded — canon #4).
 */

import { useState } from "react";
import { Crown, Plus, Pencil } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, EmptyState, Pill, Skeleton } from "@/components/ui/primitives";
import { Select, Toggle, NumberField, ErrorState } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { INPUT, L } from "./_ui";
import {
  useLoyaltyTiers,
  useEarnRules,
  useSaveEarnRule,
  type EarnRule,
} from "@/lib/retention-api";

const ACTION_LABELS: Record<string, string> = {
  earned_purchase: "Purchase",
  earned_review: "Review",
  earned_referral: "Referral",
  earned_milestone: "Milestone",
  earned_social_share: "Social share",
  earned_bonus: "Bonus",
};

export function LoyaltyTab() {
  const { can } = useAuthStore();
  const canEdit = can("retention", "edit");
  const tiersQ = useLoyaltyTiers();
  const rulesQ = useEarnRules();
  const save = useSaveEarnRule();
  const [editing, setEditing] = useState<Partial<EarnRule> | null>(null);

  const tiers = tiersQ.data ?? [];
  const rules = rulesQ.data ?? [];

  return (
    <div className="space-y-6">
      {/* Tiers */}
      <section className="space-y-3">
        <h2 className="font-display text-lg">Loyalty tiers</h2>
        {tiersQ.isLoading ? (
          <Skeleton style={{ height: 90 }} />
        ) : tiersQ.isError ? (
          <ErrorState onRetry={() => tiersQ.refetch()} />
        ) : tiers.length === 0 ? (
          <EmptyState icon={<Crown className="w-7 h-7" />} title="No tiers configured" />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {tiers.map((t) => (
              <div
                key={t.tier_id}
                className="glass rounded-[var(--radius)] shadow-glass p-4 border-l-[3px]"
                style={{ borderLeftColor: t.colour }}
              >
                <div className="font-medium text-[14px]">{t.tier_name}</div>
                <div className="text-[11.5px] text-text-muted mt-0.5">
                  {t.min_lifetime_points.toLocaleString()}
                  {t.max_lifetime_points ? `–${t.max_lifetime_points.toLocaleString()}` : "+"} pts
                </div>
                <div className="text-[11px] text-accent-glow mt-1.5 font-semibold">
                  ×{Number(t.earning_multiplier).toFixed(2)} earn
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11.5px] text-text-faint">
          Tier thresholds are read-only here (edited via Settings / DB). Values render from config, never hard-coded.
        </p>
      </section>

      {/* Earn rules */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg">How points are earned</h2>
            <p className="text-[12.5px] text-text-muted">Add or change earn rules — no code needed.</p>
          </div>
          {canEdit && (
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setEditing({ action_type: "earned_purchase", points_mode: "per_currency", apply_tier_multiplier: true, is_active: true })}
            >
              New rule
            </Button>
          )}
        </div>

        {rulesQ.isLoading ? (
          <Skeleton style={{ height: 120 }} />
        ) : rulesQ.isError ? (
          <ErrorState onRetry={() => rulesQ.refetch()} />
        ) : rules.length === 0 ? (
          <EmptyState icon={<Crown className="w-7 h-7" />} title="No earn rules" message="Add a rule so customers start earning points." />
        ) : (
          <Card className="p-0 overflow-hidden">
            {rules.map((r, i) => (
              <div key={r.rule_id} className={`p-4 flex items-center gap-3 ${i < rules.length - 1 ? "border-b border-line" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[14px]">{r.display_name}</span>
                    <Pill tone="neutral" dot={false}>{ACTION_LABELS[r.action_type] ?? r.action_type}</Pill>
                    {!r.is_active && <Pill tone="warn">paused</Pill>}
                  </div>
                  <p className="text-[12px] text-text-muted mt-0.5">
                    {r.points_mode === "per_currency"
                      ? `1 point per ₦${Number(r.currency_per_point).toLocaleString()}${r.apply_tier_multiplier ? " × tier" : ""}`
                      : `${r.points_value} points each`}
                  </p>
                </div>
                {canEdit && (
                  <Button size="sm" variant="secondary" icon={<Pencil className="w-4 h-4" />} onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>

      <EarnRuleDrawer
        rule={editing}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          await save.mutateAsync({ id: (editing as EarnRule)?.rule_id, body });
          setEditing(null);
        }}
        saving={save.isPending}
      />
    </div>
  );
}

function EarnRuleDrawer({
  rule,
  onClose,
  onSave,
  saving,
}: {
  rule: Partial<EarnRule> | null;
  onClose: () => void;
  onSave: (body: Partial<EarnRule>) => void;
  saving: boolean;
}) {
  const open = rule !== null;
  const isNew = !(rule as EarnRule)?.rule_id;
  const [form, setForm] = useState<Partial<EarnRule>>({});
  // Sync when the drawer opens for a different rule.
  const ruleId = (rule as EarnRule)?.rule_id ?? "new";
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (open && syncedFor !== ruleId) {
    setForm(rule ?? {});
    setSyncedFor(ruleId);
  }
  if (!open && syncedFor !== null) setSyncedFor(null);

  const set = <K extends keyof EarnRule>(k: K, v: EarnRule[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? "New earn rule" : "Edit earn rule"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(form)} disabled={saving || !form.display_name}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        {isNew && (
          <L label="Key (no spaces)">
            <input
              value={form.rule_key ?? ""}
              onChange={(e) => set("rule_key", e.target.value)}
              placeholder="review_points"
              className={INPUT}
            />
          </L>
        )}
        <L label="Name">
          <input value={form.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)} className={INPUT} />
        </L>
        <L label="Earn action">
          <Select
            value={form.action_type ?? "earned_purchase"}
            onChange={(v) => set("action_type", v)}
            options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </L>
        <L label="How are points calculated?">
          <Select
            value={form.points_mode ?? "per_currency"}
            onChange={(v) => set("points_mode", v as EarnRule["points_mode"])}
            options={[
              { value: "per_currency", label: "Per ₦ spent" },
              { value: "flat", label: "Flat amount" },
            ]}
          />
        </L>
        {form.points_mode === "flat" ? (
          <L label="Points awarded">
            <NumberField value={String(form.points_value ?? "")} onChange={(v) => set("points_value", Number(v) as EarnRule["points_value"])} allowDecimal={false} />
          </L>
        ) : (
          <L label="₦ per 1 point">
            <NumberField value={String(form.currency_per_point ?? "")} onChange={(v) => set("currency_per_point", Number(v) as EarnRule["currency_per_point"])} allowDecimal={false} />
          </L>
        )}
        <Toggle checked={form.apply_tier_multiplier ?? false} onChange={(v) => set("apply_tier_multiplier", v)} label="Scale by loyalty tier" />
        <Toggle checked={form.is_active ?? true} onChange={(v) => set("is_active", v)} label="Active" />
      </div>
    </Drawer>
  );
}
