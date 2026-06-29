/**
 * Catalogue tabs — Coupons (CRUD), Subscriptions (plans), Bundles (offers) and
 * Maintenance. These wrap the existing retention sub-resources; Maintenance has
 * no backend yet (§2.19) so it renders an honest "coming soon" rather than
 * faking data (canon §0: never paper over a backend gap).
 */

import { useState } from "react";
import { Ticket, Repeat, Boxes, Wrench, Plus, Pencil } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, EmptyState, MoneyText, Pill, Skeleton } from "@/components/ui/primitives";
import { Select, Toggle, NumberField, ErrorState } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { INPUT, L } from "./_ui";
import {
  useCoupons,
  useSaveCoupon,
  useSubscriptionPlans,
  useBundles,
  useMaintenancePlans,
  useMaintenanceSubscriptions,
  useSaveMaintenancePlan,
  type MaintenancePlan,
} from "@/lib/retention-api";

// ── Coupons ─────────────────────────────────────────────────
export function CouponsTab() {
  const { can } = useAuthStore();
  const canEdit = can("retention", "edit");
  const q = useCoupons();
  const save = useSaveCoupon();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ discount_type: "percentage" });
  const coupons = q.data ?? [];

  const submit = async () => {
    const body: Record<string, unknown> = {
      coupon_code: form.coupon_code,
      display_name: form.display_name,
      discount_type: form.discount_type,
      discount_value: Number(form.discount_value || 0),
      is_active: true,
    };
    await save.mutateAsync({ body });
    setOpen(false);
    setForm({ discount_type: "percentage" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg">Coupons</h2>
        {canEdit && (
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setOpen(true)}>
            New coupon
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <Skeleton style={{ height: 120 }} />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : coupons.length === 0 ? (
        <EmptyState icon={<Ticket className="w-7 h-7" />} title="No coupons" message="Create a coupon code customers can redeem at checkout." />
      ) : (
        <Card className="p-0 overflow-hidden">
          {coupons.map((c, i) => (
            <div key={c.coupon_id} className={`p-4 flex items-center gap-3 ${i < coupons.length - 1 ? "border-b border-line" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-semibold text-[13px] text-accent-glow">{c.coupon_code}</span>
                  <span className="text-[13px]">{c.display_name}</span>
                  {!c.is_active && <Pill tone="warn">inactive</Pill>}
                </div>
                <p className="text-[11.5px] text-text-faint mt-0.5">
                  {c.discount_type === "percentage"
                    ? `${Math.round(Number(c.discount_value) * 100)}% off`
                    : c.discount_type === "fixed_amount"
                      ? <MoneyText ngn={Number(c.discount_value)} className="text-[11.5px]" />
                      : c.discount_type}
                  {" · "}{c.total_redeemed} redeemed
                </p>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New coupon"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={save.isPending || !form.coupon_code || !form.display_name}>
              {save.isPending ? "Saving…" : "Create"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3.5">
          <L label="Code"><input value={form.coupon_code ?? ""} onChange={(e) => setForm((f) => ({ ...f, coupon_code: e.target.value.toUpperCase() }))} placeholder="WELCOME10" className={INPUT} /></L>
          <L label="Name"><input value={form.display_name ?? ""} onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))} className={INPUT} /></L>
          <L label="Discount type">
            <Select
              value={form.discount_type}
              onChange={(v) => setForm((f) => ({ ...f, discount_type: v }))}
              options={[
                { value: "percentage", label: "% off (enter a fraction, e.g. 0.10)" },
                { value: "fixed_amount", label: "₦ off" },
                { value: "free_shipping", label: "Free shipping" },
              ]}
            />
          </L>
          {form.discount_type !== "free_shipping" && (
            <L label="Value">
              <NumberField value={form.discount_value ?? ""} onChange={(v) => setForm((f) => ({ ...f, discount_value: v }))} />
            </L>
          )}
        </div>
      </Drawer>
    </div>
  );
}

// ── Subscriptions ───────────────────────────────────────────
export function SubscriptionsTab() {
  const q = useSubscriptionPlans();
  const plans = q.data ?? [];
  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg">Subscription plans</h2>
      {q.isLoading ? (
        <Skeleton style={{ height: 120 }} />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : plans.length === 0 ? (
        <EmptyState icon={<Repeat className="w-7 h-7" />} title="No subscription plans" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {plans.map((p) => (
            <Card key={p.plan_id} className="p-4">
              <div className="flex items-center gap-2">
                <span className="font-medium text-[14px]">{p.display_name}</span>
                {!p.is_active && <Pill tone="warn">inactive</Pill>}
              </div>
              <div className="mt-1.5"><MoneyText ngn={Number(p.price_ngn)} /></div>
              <div className="text-[11.5px] text-text-faint mt-1 capitalize">
                {p.billing_cycle} · {p.units_per_cycle} / cycle
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bundles ─────────────────────────────────────────────────
export function BundlesTab() {
  const q = useBundles();
  const bundles = q.data ?? [];
  return (
    <div className="space-y-4">
      <h2 className="font-display text-lg">Bundle offers</h2>
      {q.isLoading ? (
        <Skeleton style={{ height: 120 }} />
      ) : q.isError ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : bundles.length === 0 ? (
        <EmptyState icon={<Boxes className="w-7 h-7" />} title="No bundles" />
      ) : (
        <Card className="p-0 overflow-hidden">
          {bundles.map((b, i) => (
            <div key={b.bundle_id} className={`p-4 flex items-center gap-3 ${i < bundles.length - 1 ? "border-b border-line" : ""}`}>
              <div className="flex-1 min-w-0">
                <span className="font-medium text-[14px]">{b.display_name}</span>
                <span className="text-[11px] text-text-faint ml-2 font-mono">{b.bundle_code}</span>
                <p className="text-[11.5px] text-text-faint mt-0.5 capitalize">{b.pricing_model.replace(/_/g, " ")}</p>
              </div>
              {b.is_active ? <Pill tone="success">active</Pill> : <Pill tone="warn">inactive</Pill>}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── Maintenance plans ───────────────────────────────────────
const CYCLE_LABELS: Record<MaintenancePlan["billing_cycle"], string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  semi_annual: "Semi-annual",
  annual: "Annual",
};

export function MaintenanceTab() {
  const { can } = useAuthStore();
  const canEdit = can("retention", "edit");
  const plansQ = useMaintenancePlans();
  const subsQ = useMaintenanceSubscriptions();
  const save = useSaveMaintenancePlan();
  const [editing, setEditing] = useState<Partial<MaintenancePlan> | null>(null);
  const plans = plansQ.data ?? [];
  const subs = subsQ.data ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg">Maintenance plans</h2>
            <p className="text-[12.5px] text-text-muted">Salon maintenance subscriptions (wash, recondition, restyle).</p>
          </div>
          {canEdit && (
            <Button
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => setEditing({ billing_cycle: "monthly", is_active: true })}
            >
              New plan
            </Button>
          )}
        </div>

        {plansQ.isLoading ? (
          <Skeleton style={{ height: 120 }} />
        ) : plansQ.isError ? (
          <ErrorState onRetry={() => plansQ.refetch()} />
        ) : plans.length === 0 ? (
          <EmptyState icon={<Wrench className="w-7 h-7" />} title="No maintenance plans" message="Create a plan customers can subscribe to." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {plans.map((p) => (
              <Card key={p.plan_id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[14px]">{p.display_name}</span>
                      {!p.is_active && <Pill tone="warn">inactive</Pill>}
                    </div>
                    <div className="mt-1.5"><MoneyText ngn={Number(p.price_ngn)} /></div>
                    <div className="text-[11.5px] text-text-faint mt-1">{CYCLE_LABELS[p.billing_cycle]}</div>
                  </div>
                  {canEdit && (
                    <button onClick={() => setEditing(p)} className="grid place-items-center w-8 h-8 rounded-[9px] text-text-faint hover:text-text-primary">
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg">Active subscriptions</h2>
        {subsQ.isLoading ? (
          <Skeleton style={{ height: 80 }} />
        ) : subs.length === 0 ? (
          <p className="text-[12.5px] text-text-faint">No maintenance subscriptions yet.</p>
        ) : (
          <Card className="p-0 overflow-hidden">
            {subs.map((s, i) => (
              <div key={s.subscription_id} className={`p-3.5 flex items-center gap-3 ${i < subs.length - 1 ? "border-b border-line" : ""}`}>
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-[11px] text-text-faint">{s.subscription_number}</span>
                  <span className="text-[13px] ml-2">{s.first_name || s.contact_name || "Customer"}</span>
                  <span className="text-[11.5px] text-text-faint ml-2">{s.plan_name}</span>
                </div>
                <Pill tone={s.status === "active" ? "success" : "warn"}>{s.status}</Pill>
              </div>
            ))}
          </Card>
        )}
      </section>

      <MaintenanceDrawer
        plan={editing}
        onClose={() => setEditing(null)}
        onSave={async (body) => {
          await save.mutateAsync({ id: (editing as MaintenancePlan)?.plan_id, body });
          setEditing(null);
        }}
        saving={save.isPending}
      />
    </div>
  );
}

function MaintenanceDrawer({
  plan,
  onClose,
  onSave,
  saving,
}: {
  plan: Partial<MaintenancePlan> | null;
  onClose: () => void;
  onSave: (body: Partial<MaintenancePlan>) => void;
  saving: boolean;
}) {
  const open = plan !== null;
  const isNew = !(plan as MaintenancePlan)?.plan_id;
  const [form, setForm] = useState<Partial<MaintenancePlan>>({});
  const planId = (plan as MaintenancePlan)?.plan_id ?? "new";
  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  if (open && syncedFor !== planId) {
    setForm(plan ?? {});
    setSyncedFor(planId);
  }
  if (!open && syncedFor !== null) setSyncedFor(null);
  const set = <K extends keyof MaintenancePlan>(k: K, v: MaintenancePlan[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isNew ? "New maintenance plan" : "Edit maintenance plan"}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(form)} disabled={saving || !form.display_name || !form.price_ngn}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        {isNew && (
          <L label="Key (no spaces)"><input value={form.plan_key ?? ""} onChange={(e) => set("plan_key", e.target.value)} placeholder="basic_monthly" className={INPUT} /></L>
        )}
        <L label="Name"><input value={form.display_name ?? ""} onChange={(e) => set("display_name", e.target.value)} className={INPUT} /></L>
        <L label="Billing cycle">
          <Select
            value={form.billing_cycle ?? "monthly"}
            onChange={(v) => set("billing_cycle", v as MaintenancePlan["billing_cycle"])}
            options={Object.entries(CYCLE_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </L>
        <L label="Price (₦)"><NumberField value={String(form.price_ngn ?? "")} onChange={(v) => set("price_ngn", Number(v) as MaintenancePlan["price_ngn"])} /></L>
        <Toggle checked={form.is_active ?? true} onChange={(v) => set("is_active", v)} label="Active" />
      </div>
    </Drawer>
  );
}
