/**
 * Rewards tab — the loyalty redemption catalogue (what points buy). CRUD over
 * shared.loyalty_rewards. Discount values shown via MoneyText (NGN truth).
 */

import { useState } from "react";
import { Gift, Plus, Pencil } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, EmptyState, MoneyText, Pill, Skeleton } from "@/components/ui/primitives";
import { Select, Toggle, NumberField, ErrorState } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { INPUT, L } from "./_ui";
import { useRewards, useSaveReward, type Reward } from "@/lib/retention-api";

const TYPE_LABELS: Record<Reward["reward_type"], string> = {
  order_discount: "Order discount",
  free_shipping: "Free shipping",
  free_product: "Free product",
  gift: "Gift",
};

export function RewardsTab() {
  const { can } = useAuthStore();
  const canEdit = can("retention", "edit");
  const q = useRewards();
  const save = useSaveReward();
  const [editing, setEditing] = useState<Partial<Reward> | null>(null);
  const rewards = q.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg">Rewards catalogue</h2>
          <p className="text-[12.5px] text-text-muted">What customers can redeem their points for.</p>
        </div>
        {canEdit && (
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setEditing({ reward_type: "order_discount", discount_type: "fixed_amount", points_cost: 1000, is_active: true })}
          >
            New reward
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <Skeleton style={{ height: 120 }} />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : rewards.length === 0 ? (
        <EmptyState icon={<Gift className="w-7 h-7" />} title="No rewards yet" message="Create a reward so points become redeemable." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {rewards.map((r) => (
            <Card key={r.reward_id} className="p-4 flex items-start gap-3">
              <span className="grid place-items-center w-9 h-9 rounded-[11px] bg-accent/10 text-accent-glow border border-accent/20 shrink-0">
                <Gift className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-[14px]">{r.display_name}</span>
                  {!r.is_active && <Pill tone="warn">paused</Pill>}
                </div>
                <div className="text-[12px] text-text-muted mt-0.5">
                  {TYPE_LABELS[r.reward_type]}
                  {r.reward_type === "order_discount" && r.discount_value != null && (
                    <>
                      {" · "}
                      {r.discount_type === "percentage" ? `${r.discount_value}% off` : <MoneyText ngn={Number(r.discount_value)} className="text-[12px]" />}
                    </>
                  )}
                </div>
                <div className="text-[11px] text-accent-glow font-semibold mt-1.5">
                  {r.points_cost.toLocaleString()} pts · {r.total_redeemed} redeemed
                </div>
              </div>
              {canEdit && (
                <button onClick={() => setEditing(r)} className="grid place-items-center w-8 h-8 rounded-[9px] text-text-faint hover:text-text-primary">
                  <Pencil className="w-4 h-4" />
                </button>
              )}
            </Card>
          ))}
        </div>
      )}

      <RewardDrawer
        reward={editing}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          await save.mutateAsync({ id: (editing as Reward)?.reward_id, body });
          setEditing(null);
        }}
        saving={save.isPending}
      />
    </div>
  );
}

function RewardDrawer({
  reward,
  onClose,
  onSave,
  saving,
}: {
  reward: Partial<Reward> | null;
  onClose: () => void;
  onSave: (body: Partial<Reward>) => void;
  saving: boolean;
}) {
  const open = reward !== null;
  const isNew = !(reward as Reward)?.reward_id;
  const [form, setForm] = useState<Partial<Reward>>({});
  const rewardId = (reward as Reward)?.reward_id ?? "new";
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (open && syncedFor !== rewardId) {
    setForm(reward ?? {});
    setSyncedFor(rewardId);
  }
  if (!open && syncedFor !== null) setSyncedFor(null);

  const set = <K extends keyof Reward>(k: K, v: Reward[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? "New reward" : "Edit reward"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(form)} disabled={saving || !form.display_name || !form.points_cost}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        {isNew && (
          <L label="Key (no spaces)">
            <input value={form.reward_key ?? ""} onChange={(e) => set("reward_key", e.target.value)} placeholder="discount_2000" className={INPUT} />
          </L>
        )}
        <L label="Name"><input value={form.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)} className={INPUT} /></L>
        <L label="Type">
          <Select
            value={form.reward_type ?? "order_discount"}
            onChange={(v) => set("reward_type", v as Reward["reward_type"])}
            options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </L>
        <L label="Points cost">
          <NumberField value={String(form.points_cost ?? "")} onChange={(v) => set("points_cost", Number(v) as Reward["points_cost"])} allowDecimal={false} suffix="pts" />
        </L>
        {form.reward_type === "order_discount" && (
          <>
            <L label="Discount type">
              <Select
                value={form.discount_type ?? "fixed_amount"}
                onChange={(v) => set("discount_type", v as Reward["discount_type"])}
                options={[
                  { value: "fixed_amount", label: "₦ off" },
                  { value: "percentage", label: "% off" },
                ]}
              />
            </L>
            <L label="Value">
              <NumberField value={String(form.discount_value ?? "")} onChange={(v) => set("discount_value", Number(v) as Reward["discount_value"])} />
            </L>
          </>
        )}
        <Toggle checked={form.is_active ?? true} onChange={(v) => set("is_active", v)} label="Active" />
      </div>
    </Drawer>
  );
}
