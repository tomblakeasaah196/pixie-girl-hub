/**
 * Referrals tab — config-driven referral programme: settings (friend discount,
 * default reward, qualifying order, anti-fraud), the tiered referrer ladder,
 * and a dashboard (top referrers + totals). All values render from config.
 */

import { useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, KpiTile, Pill, Skeleton } from "@/components/ui/primitives";
import { Select, Toggle, NumberField, ErrorState } from "@/components/ui/controls";
import { L } from "./_ui";
import {
  useReferralSettings,
  useSaveReferralSettings,
  useReferralTiers,
  useSaveReferralTier,
  useDeleteReferralTier,
  useReferralDashboard,
  type ReferralSettings,
  type ReferralTier,
} from "@/lib/retention-api";

export function ReferralsTab() {
  const { can } = useAuthStore();
  const canEdit = can("retention", "edit");
  const settingsQ = useReferralSettings();
  const saveSettings = useSaveReferralSettings();
  const tiersQ = useReferralTiers();
  const saveTier = useSaveReferralTier();
  const delTier = useDeleteReferralTier();
  const dashQ = useReferralDashboard();

  const [form, setForm] = useState<Partial<ReferralSettings>>({});
  const [synced, setSynced] = useState(false);
  if (settingsQ.data && !synced) {
    setForm(settingsQ.data);
    setSynced(true);
  }
  const set = <K extends keyof ReferralSettings>(k: K, v: ReferralSettings[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const tiers = tiersQ.data ?? [];
  const dash = dashQ.data;

  return (
    <div className="space-y-6">
      {/* Dashboard */}
      <section className="space-y-3">
        <h2 className="font-display text-lg">Referral performance</h2>
        {dashQ.isLoading ? (
          <Skeleton style={{ height: 80 }} />
        ) : dashQ.isError ? (
          <ErrorState onRetry={() => dashQ.refetch()} />
        ) : dash ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile label="Referrers" value={String(dash.totals.total_referrers)} />
            <KpiTile label="Conversions" value={String(dash.totals.total_conversions)} />
            <KpiTile label="Rewarded" value={String(dash.totals.total_rewarded)} />
            <KpiTile label="Flagged" value={String(dash.totals.flagged)} tone={dash.totals.flagged > 0 ? "warn" : "accent"} />
          </div>
        ) : null}
        {dash && dash.top_referrers.length > 0 && (
          <Card className="p-0 overflow-hidden">
            {dash.top_referrers.map((r, i) => (
              <div key={r.referral_id} className={`p-3.5 flex items-center gap-3 ${i < dash.top_referrers.length - 1 ? "border-b border-line" : ""}`}>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-[13.5px]">{r.first_name || r.display_name || "Customer"}</span>
                  <span className="text-[11px] text-text-faint ml-2 font-mono">{r.referral_code}</span>
                </div>
                <Pill tone="success" dot={false}>{r.successful_count} referred</Pill>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* Settings */}
      <section className="space-y-3">
        <h2 className="font-display text-lg">Programme settings</h2>
        {settingsQ.isLoading ? (
          <Skeleton style={{ height: 200 }} />
        ) : (
          <Card className="p-5 space-y-4">
            <Toggle checked={form.is_active ?? true} onChange={(v) => set("is_active", v)} label="Referral programme active" disabled={!canEdit} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <L label="Reward the referrer on">
                <Select
                  value={form.reward_on ?? "full_settlement"}
                  onChange={(v) => set("reward_on", v as ReferralSettings["reward_on"])}
                  options={[
                    { value: "full_settlement", label: "Full payment of the order" },
                    { value: "order_placed", label: "Order placed" },
                  ]}
                  disabled={!canEdit}
                />
              </L>
              <L label="Default referrer points">
                <NumberField value={String(form.default_referrer_points ?? "")} onChange={(v) => set("default_referrer_points", Number(v))} allowDecimal={false} disabled={!canEdit} />
              </L>
              <L label="Friend discount type">
                <Select
                  value={form.friend_discount_type ?? "percentage"}
                  onChange={(v) => set("friend_discount_type", v as ReferralSettings["friend_discount_type"])}
                  options={[
                    { value: "percentage", label: "% off" },
                    { value: "fixed_amount", label: "₦ off" },
                  ]}
                  disabled={!canEdit}
                />
              </L>
              <L label={form.friend_discount_type === "fixed_amount" ? "Friend discount (₦)" : "Friend discount (fraction, e.g. 0.10)"}>
                <NumberField value={String(form.friend_discount_value ?? "")} onChange={(v) => set("friend_discount_value", Number(v))} disabled={!canEdit} />
              </L>
              <L label="Minimum qualifying order (₦)">
                <NumberField value={String(form.min_qualifying_order_ngn ?? "")} onChange={(v) => set("min_qualifying_order_ngn", Number(v))} disabled={!canEdit} />
              </L>
            </div>
            {canEdit && (
              <div className="flex justify-end">
                <Button variant="primary" icon={<Save className="w-4 h-4" />} onClick={() => saveSettings.mutate(form)} disabled={saveSettings.isPending}>
                  {saveSettings.isPending ? "Saving…" : "Save settings"}
                </Button>
              </div>
            )}
          </Card>
        )}
      </section>

      {/* Ladder */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg">Reward ladder</h2>
            <p className="text-[12.5px] text-text-muted">Bigger rewards as a customer refers more friends.</p>
          </div>
          {canEdit && (
            <Button
              variant="secondary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => saveTier.mutate({ body: { min_successful_referrals: (tiers.at(-1)?.min_successful_referrals ?? 0) + 1, referrer_points: 500, is_active: true } })}
              disabled={saveTier.isPending}
            >
              Add rung
            </Button>
          )}
        </div>
        {tiersQ.isLoading ? (
          <Skeleton style={{ height: 100 }} />
        ) : tiers.length === 0 ? (
          <p className="text-[12.5px] text-text-faint">No ladder rungs — the default reward applies to everyone.</p>
        ) : (
          <Card className="p-0 overflow-hidden">
            {tiers.map((t, i) => (
              <LadderRow
                key={t.tier_id}
                tier={t}
                last={i === tiers.length - 1}
                canEdit={canEdit}
                onSave={(body) => saveTier.mutate({ id: t.tier_id, body })}
                onDelete={() => delTier.mutate(t.tier_id)}
              />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function LadderRow({
  tier,
  last,
  canEdit,
  onSave,
  onDelete,
}: {
  tier: ReferralTier;
  last: boolean;
  canEdit: boolean;
  onSave: (body: Partial<ReferralTier>) => void;
  onDelete: () => void;
}) {
  const [min, setMin] = useState(String(tier.min_successful_referrals));
  const [pts, setPts] = useState(String(tier.referrer_points));
  const dirty = min !== String(tier.min_successful_referrals) || pts !== String(tier.referrer_points);

  return (
    <div className={`p-3.5 flex items-center gap-3 ${last ? "" : "border-b border-line"}`}>
      <span className="text-[12px] text-text-muted">After</span>
      <div className="w-20"><NumberField value={min} onChange={setMin} allowDecimal={false} disabled={!canEdit} /></div>
      <span className="text-[12px] text-text-muted">referrals →</span>
      <div className="w-28"><NumberField value={pts} onChange={setPts} allowDecimal={false} suffix="pts" disabled={!canEdit} /></div>
      <div className="flex-1" />
      {canEdit && (
        <>
          {dirty && (
            <Button size="sm" variant="primary" onClick={() => onSave({ min_successful_referrals: Number(min), referrer_points: Number(pts) })}>
              Save
            </Button>
          )}
          <button onClick={onDelete} className="grid place-items-center w-9 h-9 rounded-[10px] text-text-faint hover:text-danger">
            <Trash2 className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}
