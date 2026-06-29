/**
 * Catalogue tabs — Coupons (CRUD), Subscriptions (plans), Bundles (offers) and
 * Maintenance. These wrap the existing retention sub-resources; Maintenance has
 * no backend yet (§2.19) so it renders an honest "coming soon" rather than
 * faking data (canon §0: never paper over a backend gap).
 */

import { useState } from "react";
import { Ticket, Repeat, Boxes, Wrench, Plus } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, EmptyState, MoneyText, Pill, Skeleton } from "@/components/ui/primitives";
import { Select, NumberField, ErrorState } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { INPUT, L } from "./_ui";
import {
  useCoupons,
  useSaveCoupon,
  useSubscriptionPlans,
  useBundles,
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

// ── Maintenance (no backend yet) ────────────────────────────
export function MaintenanceTab() {
  return (
    <EmptyState
      icon={<Wrench className="w-7 h-7" />}
      title="Maintenance plans — coming soon"
      message="Faitlyn salon maintenance subscriptions are defined in the schema but have no API yet. This screen is intentionally blocked on the backend rather than showing placeholder data."
    />
  );
}
