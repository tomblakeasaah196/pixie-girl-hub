/**
 * Crowns 👑 tab — the unified loyalty + streak console (replaces Loyalty).
 *
 * Three sections: the tier ladder (thresholds, next-purchase voucher, lifetime
 * discount, benefits), the config-driven earn rules (with auto/honor/manual
 * verification), and the streak definitions (read-only — seeded config). Every
 * threshold/value renders from config, never hard-coded (canon §4 #4), and
 * write controls hide unless the user has the grant (canon §4 #3).
 */

import { useState } from "react";
import { Crown, Plus, Pencil, Sparkles, Flame } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, EmptyState, Pill, Skeleton } from "@/components/ui/primitives";
import { Select, Toggle, NumberField, ErrorState } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { INPUT, L } from "./_ui";
import {
  useCrownTiers,
  useSaveCrownTier,
  useCrownEarnRules,
  useSaveCrownRule,
  useCrownStreakConfig,
  type CrownAction,
  type CrownVerification,
  type CrownTier,
  type CrownEarnRule,
} from "@/lib/crown-api";

const ACTION_LABELS: Record<CrownAction, string> = {
  create_account: "Create account",
  complete_purchase: "Complete a purchase",
  money_spent: "Money spent",
  refer_friend_purchase: "Refer a friend",
  newsletter_subscribe: "Newsletter",
  add_birthday: "Birthday",
  leave_review: "Review",
  social_follow: "Social follow",
  social_tag: "Social tag",
  ugc_upload: "UGC upload",
  hair_quiz_complete: "Hair quiz",
  order_milestone: "Order milestone",
  manual: "Manual",
};

const VERIFY: Record<CrownVerification, { label: string; tone: "success" | "info" | "warn" }> = {
  auto: { label: "Automatic", tone: "success" },
  honor: { label: "One-tap", tone: "info" },
  manual: { label: "Needs approval", tone: "warn" },
};

const BENEFIT_KEYS: { key: string; label: string }[] = [
  { key: "early_access", label: "Early access to drops" },
  { key: "exclusive_products", label: "Members-only products" },
  { key: "birthday_bonus", label: "Birthday bonus Crowns" },
  { key: "priority_support", label: "Priority support" },
  { key: "vip_sales", label: "VIP-only sales" },
  { key: "extra_streak_freeze", label: "Extra streak freeze" },
];

export function CrownsTab() {
  const { can } = useAuthStore();
  const canEdit = can("retention", "edit");
  const canCreate = can("retention", "create");
  const tiersQ = useCrownTiers();
  const saveTier = useSaveCrownTier();
  const rulesQ = useCrownEarnRules();
  const saveRule = useSaveCrownRule();
  const streakQ = useCrownStreakConfig();
  const [tierEdit, setTierEdit] = useState<Partial<CrownTier> | null>(null);
  const [ruleEdit, setRuleEdit] = useState<Partial<CrownEarnRule> | null>(null);

  const tiers = tiersQ.data ?? [];
  const rules = rulesQ.data ?? [];
  const streaks = streakQ.data ?? [];

  return (
    <div className="space-y-6">
      {/* Tier ladder */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-display text-lg">The Crown ladder</h2>
            <p className="text-[12.5px] text-text-muted">
              Reach a tier to unlock its reward. Crowns are earned, never spent.
            </p>
          </div>
          {canCreate && (
            <Button
              variant="secondary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() =>
                setTierEdit({
                  min_crowns: 0,
                  display_order: (tiers.at(-1)?.display_order ?? 0) + 1,
                  next_purchase_discount_pct: 0,
                  lifetime_discount_pct: 0,
                  earning_multiplier: 1,
                  grants_free_shipping_next: false,
                  benefits: {},
                  is_active: true,
                  badge_colour_hex: "#690909",
                })
              }
            >
              New tier
            </Button>
          )}
        </div>
        {tiersQ.isLoading ? (
          <Skeleton style={{ height: 96 }} />
        ) : tiersQ.isError ? (
          <ErrorState onRetry={() => tiersQ.refetch()} />
        ) : tiers.length === 0 ? (
          <EmptyState icon={<Crown className="w-7 h-7" />} title="No tiers configured" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {tiers.map((t) => (
              <button
                key={t.tier_id}
                onClick={() => canEdit && setTierEdit(t)}
                disabled={!canEdit}
                className="glass rounded-[var(--radius)] shadow-glass p-4 border-l-[3px] text-left transition-all hover:bg-text-primary/[0.03] disabled:cursor-default"
                style={{ borderLeftColor: t.badge_colour_hex ?? "#690909" }}
              >
                <div className="flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5 text-accent-glow" />
                  <span className="font-medium text-[14px]">{t.tier_name}</span>
                </div>
                <div className="text-[11.5px] text-text-muted mt-0.5">
                  {t.min_crowns.toLocaleString()}👑+
                </div>
                <div className="mt-2 space-y-0.5 text-[11.5px]">
                  {Number(t.next_purchase_discount_pct) > 0 && (
                    <div className="text-text-primary">
                      {Number(t.next_purchase_discount_pct)}% off next purchase
                    </div>
                  )}
                  {Number(t.lifetime_discount_pct) > 0 && (
                    <div className="text-accent-glow font-semibold">
                      {Number(t.lifetime_discount_pct)}% lifetime
                    </div>
                  )}
                  {t.grants_free_shipping_next && (
                    <div className="text-text-muted">+ free shipping</div>
                  )}
                </div>
                {!t.is_active && (
                  <div className="mt-2">
                    <Pill tone="warn">paused</Pill>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
        <p className="text-[11.5px] text-text-faint">
          Thresholds + rewards render from config (never hard-coded).{" "}
          {canEdit ? "Tap a tier to edit." : ""}
        </p>
      </section>

      {/* Earn rules */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-display text-lg">Ways to earn Crowns</h2>
            <p className="text-[12.5px] text-text-muted">
              Add or change how Pixie Queens earn — no code needed.
            </p>
          </div>
          {canCreate && (
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() =>
                setRuleEdit({
                  action_type: "leave_review",
                  crowns_mode: "flat",
                  verification_mode: "auto",
                  is_active: true,
                })
              }
            >
              New rule
            </Button>
          )}
        </div>

        {rulesQ.isLoading ? (
          <Skeleton style={{ height: 140 }} />
        ) : rulesQ.isError ? (
          <ErrorState onRetry={() => rulesQ.refetch()} />
        ) : rules.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="w-7 h-7" />}
            title="No earn rules"
            message="Add a rule so Pixie Queens start earning Crowns."
          />
        ) : (
          <Card className="p-0 overflow-hidden">
            {rules.map((r, i) => (
              <div
                key={r.rule_id}
                className={`p-4 flex items-center gap-2.5 sm:gap-3 ${i < rules.length - 1 ? "border-b border-line" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[14px]">{r.display_name}</span>
                    <Pill tone="neutral" dot={false}>
                      {ACTION_LABELS[r.action_type] ?? r.action_type}
                    </Pill>
                    <Pill tone={VERIFY[r.verification_mode].tone}>
                      {VERIFY[r.verification_mode].label}
                    </Pill>
                    {!r.is_active && <Pill tone="warn">paused</Pill>}
                  </div>
                  <p className="text-[12px] text-text-muted mt-0.5">
                    {r.crowns_mode === "per_currency"
                      ? `1👑 per ₦${Number(r.unit_currency_per_crown).toLocaleString()}`
                      : `${r.crown_value}👑 each`}
                    {r.social_platform ? ` · ${r.social_platform}` : ""}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Pencil className="w-4 h-4" />}
                    onClick={() => setRuleEdit(r)}
                  >
                    Edit
                  </Button>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* Streaks (read-only config) */}
      <section className="space-y-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg">Streaks</h2>
          <p className="text-[12.5px] text-text-muted">
            Keep Pixie Queens coming back. A break is nudged by email + in-app so
            sales can reach out.
          </p>
        </div>
        {streakQ.isLoading ? (
          <Skeleton style={{ height: 80 }} />
        ) : streakQ.isError ? (
          <ErrorState onRetry={() => streakQ.refetch()} />
        ) : streaks.length === 0 ? (
          <EmptyState icon={<Flame className="w-7 h-7" />} title="No streaks configured" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {streaks.map((s) => (
              <div key={s.config_id} className="glass rounded-[var(--radius)] shadow-glass p-4">
                <div className="flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-accent-glow" />
                  <span className="font-medium text-[14px]">{s.display_name}</span>
                </div>
                <p className="text-[12px] text-text-muted mt-1">{s.description}</p>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  <Pill tone="neutral" dot={false}>
                    every {s.period_length} {s.period_unit}
                  </Pill>
                  <Pill tone="neutral" dot={false}>{s.freeze_allowance} freeze</Pill>
                  <Pill tone="neutral" dot={false}>nudge −{s.nudge_lead_days}d</Pill>
                  {s.awards_crowns_on_extend > 0 && (
                    <Pill tone="info">+{s.awards_crowns_on_extend}👑 / period</Pill>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <TierDrawer
        tier={tierEdit}
        onClose={() => setTierEdit(null)}
        onSave={async (body) => {
          await saveTier.mutateAsync({ id: (tierEdit as CrownTier)?.tier_id, body });
          setTierEdit(null);
        }}
        saving={saveTier.isPending}
      />
      <RuleDrawer
        rule={ruleEdit}
        onClose={() => setRuleEdit(null)}
        onSave={async (body) => {
          await saveRule.mutateAsync({ id: (ruleEdit as CrownEarnRule)?.rule_id, body });
          setRuleEdit(null);
        }}
        saving={saveRule.isPending}
      />
    </div>
  );
}

function TierDrawer({
  tier,
  onClose,
  onSave,
  saving,
}: {
  tier: Partial<CrownTier> | null;
  onClose: () => void;
  onSave: (body: Partial<CrownTier>) => void;
  saving: boolean;
}) {
  const open = tier !== null;
  const isNew = !(tier as CrownTier)?.tier_id;
  const [form, setForm] = useState<Partial<CrownTier>>({});
  const tierId = (tier as CrownTier)?.tier_id ?? "new";
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (open && syncedFor !== tierId) {
    setForm(tier ?? {});
    setSyncedFor(tierId);
  }
  if (!open && syncedFor !== null) setSyncedFor(null);
  const set = <K extends keyof CrownTier>(k: K, v: CrownTier[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const benefits = form.benefits ?? {};

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? "New Crown tier" : "Edit Crown tier"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => onSave(form)}
            disabled={saving || !form.tier_name || form.min_crowns == null}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        {isNew && (
          <L label="Key (no spaces)">
            <input value={form.tier_key ?? ""} onChange={(e) => set("tier_key", e.target.value)} placeholder="tiara" className={INPUT} autoComplete="off" data-1p-ignore="" />
          </L>
        )}
        <L label="Name">
          <input value={form.tier_name ?? ""} onChange={(e) => set("tier_name", e.target.value)} placeholder="The Tiara" className={INPUT} autoComplete="off" data-1p-ignore="" />
        </L>
        <div className="grid grid-cols-2 gap-3">
          <L label="Reach at (👑)">
            <NumberField value={String(form.min_crowns ?? "")} onChange={(v) => set("min_crowns", Number(v) as CrownTier["min_crowns"])} allowDecimal={false} />
          </L>
          <L label="Display order">
            <NumberField value={String(form.display_order ?? "")} onChange={(v) => set("display_order", Number(v) as CrownTier["display_order"])} allowDecimal={false} />
          </L>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <L label="% off next purchase">
            <NumberField value={String(form.next_purchase_discount_pct ?? "")} onChange={(v) => set("next_purchase_discount_pct", Number(v) as CrownTier["next_purchase_discount_pct"])} />
          </L>
          <L label="% lifetime discount">
            <NumberField value={String(form.lifetime_discount_pct ?? "")} onChange={(v) => set("lifetime_discount_pct", Number(v) as CrownTier["lifetime_discount_pct"])} />
          </L>
        </div>
        <L label="Earning multiplier">
          <NumberField value={String(form.earning_multiplier ?? "")} onChange={(v) => set("earning_multiplier", Number(v) as CrownTier["earning_multiplier"])} />
        </L>
        <L label="Badge colour (hex)">
          <input value={form.badge_colour_hex ?? ""} onChange={(e) => set("badge_colour_hex", e.target.value)} placeholder="#690909" className={INPUT} autoComplete="off" data-1p-ignore="" />
        </L>
        <Toggle checked={form.grants_free_shipping_next ?? false} onChange={(v) => set("grants_free_shipping_next", v)} label="Free shipping on next purchase" />
        <div className="pt-1">
          <div className="text-[11px] uppercase tracking-[0.14em] text-text-faint mb-2">Standing benefits</div>
          <div className="space-y-2">
            {BENEFIT_KEYS.map((b) => (
              <Toggle
                key={b.key}
                checked={!!benefits[b.key]}
                onChange={(v) => set("benefits", { ...benefits, [b.key]: v })}
                label={b.label}
              />
            ))}
          </div>
        </div>
        <Toggle checked={form.is_active ?? true} onChange={(v) => set("is_active", v)} label="Active" />
      </div>
    </Drawer>
  );
}

function RuleDrawer({
  rule,
  onClose,
  onSave,
  saving,
}: {
  rule: Partial<CrownEarnRule> | null;
  onClose: () => void;
  onSave: (body: Partial<CrownEarnRule>) => void;
  saving: boolean;
}) {
  const open = rule !== null;
  const isNew = !(rule as CrownEarnRule)?.rule_id;
  const [form, setForm] = useState<Partial<CrownEarnRule>>({});
  const ruleId = (rule as CrownEarnRule)?.rule_id ?? "new";
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (open && syncedFor !== ruleId) {
    setForm(rule ?? {});
    setSyncedFor(ruleId);
  }
  if (!open && syncedFor !== null) setSyncedFor(null);
  const set = <K extends keyof CrownEarnRule>(k: K, v: CrownEarnRule[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const isSocial = form.action_type === "social_follow" || form.action_type === "social_tag";

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
            <input value={form.rule_key ?? ""} onChange={(e) => set("rule_key", e.target.value)} placeholder="follow_instagram" className={INPUT} autoComplete="off" data-1p-ignore="" />
          </L>
        )}
        <L label="Name">
          <input value={form.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)} className={INPUT} autoComplete="off" data-1p-ignore="" />
        </L>
        <L label="Earn action">
          <Select
            value={form.action_type ?? "leave_review"}
            onChange={(v) => set("action_type", v as CrownAction)}
            options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </L>
        <L label="How verified?">
          <Select
            value={form.verification_mode ?? "auto"}
            onChange={(v) => set("verification_mode", v as CrownVerification)}
            options={[
              { value: "auto", label: "Automatic (a system event proves it)" },
              { value: "honor", label: "One-tap (self-report, capped)" },
              { value: "manual", label: "Needs staff approval (proof)" },
            ]}
          />
        </L>
        {isSocial && (
          <L label="Platform">
            <Select
              value={form.social_platform ?? "instagram"}
              onChange={(v) => set("social_platform", v)}
              options={["instagram", "tiktok", "x", "facebook", "youtube"].map((p) => ({ value: p, label: p }))}
            />
          </L>
        )}
        <L label="How are Crowns calculated?">
          <Select
            value={form.crowns_mode ?? "flat"}
            onChange={(v) => set("crowns_mode", v as CrownEarnRule["crowns_mode"])}
            options={[
              { value: "flat", label: "Flat amount" },
              { value: "per_currency", label: "Per ₦ spent" },
            ]}
          />
        </L>
        {form.crowns_mode === "per_currency" ? (
          <L label="₦ per 1👑">
            <NumberField value={String(form.unit_currency_per_crown ?? "")} onChange={(v) => set("unit_currency_per_crown", Number(v) as CrownEarnRule["unit_currency_per_crown"])} allowDecimal={false} />
          </L>
        ) : (
          <L label="Crowns awarded">
            <NumberField value={String(form.crown_value ?? "")} onChange={(v) => set("crown_value", Number(v) as CrownEarnRule["crown_value"])} allowDecimal={false} />
          </L>
        )}
        <div className="grid grid-cols-3 gap-2">
          <L label="Cap / life">
            <NumberField value={String(form.max_awards_per_customer_lifetime ?? "")} onChange={(v) => set("max_awards_per_customer_lifetime", (v ? Number(v) : null) as CrownEarnRule["max_awards_per_customer_lifetime"])} allowDecimal={false} />
          </L>
          <L label="Cap / mo">
            <NumberField value={String(form.max_awards_per_customer_per_month ?? "")} onChange={(v) => set("max_awards_per_customer_per_month", (v ? Number(v) : null) as CrownEarnRule["max_awards_per_customer_per_month"])} allowDecimal={false} />
          </L>
          <L label="Cap / yr">
            <NumberField value={String(form.max_awards_per_customer_per_year ?? "")} onChange={(v) => set("max_awards_per_customer_per_year", (v ? Number(v) : null) as CrownEarnRule["max_awards_per_customer_per_year"])} allowDecimal={false} />
          </L>
        </div>
        <Toggle checked={form.is_active ?? true} onChange={(v) => set("is_active", v)} label="Active" />
      </div>
    </Drawer>
  );
}
