import { useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, X, Save, Loader2 } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { Field, TextInput } from "@/components/ui/Form";
import { Toggle } from "@/components/ui/controls";
import { toast } from "@/stores/toast";
import { useAuthStore } from "@/stores/auth";
import { usePaymentSettings, useSavePaymentSettings } from "./hooks";
import type { FlexiPaySettings, FlexiPaySettingsPatch } from "./types";

// Channels the buyer can start an instalment on, in display order. Keep in sync
// with payment-settings.service DEFAULTS.channels on the Hub.
const CHANNELS: { key: string; label: string }[] = [
  { key: "storefront", label: "Website" },
  { key: "sales_campaign", label: "Sales Campaign" },
  { key: "public_form", label: "Public Order Form" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "instagram", label: "Instagram" },
  { key: "walk_in", label: "Walk-in" },
  { key: "event", label: "Event" },
];

/**
 * Sales → Payments tab (Flexi Pay config, PR-3). The single place the business
 * tunes partial payments: plan name + terms, minimums, the abandonment/reminder
 * windows, which channels offer instalments, and whether staff may record bank
 * transfers. Everything writes to business_config.installment_settings via
 * /sales/payment-settings — no code change to change the policy.
 *
 * Note: whether a SPECIFIC sales campaign offers instalments is a per-campaign
 * toggle in the campaign builder (this tab's "Sales Campaign" switch is the
 * channel-wide gate that must ALSO be on).
 */
export function PaymentSettingsView() {
  const can = useAuthStore((s) => s.can);
  const canEdit = can("sales", "approve");
  const { data, isLoading } = usePaymentSettings();
  const save = useSavePaymentSettings();

  const [form, setForm] = useState<FlexiPaySettings | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const dirty = useMemo(() => {
    if (!data || !form) return false;
    return JSON.stringify(data) !== JSON.stringify(form);
  }, [data, form]);

  if (isLoading || !form) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3 text-text-muted text-[13px]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading payment settings…
        </div>
      </Card>
    );
  }

  const set = <K extends keyof FlexiPaySettings>(
    key: K,
    value: FlexiPaySettings[K],
  ) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const setChannel = (ch: string, on: boolean) =>
    setForm((f) => (f ? { ...f, channels: { ...f.channels, [ch]: on } } : f));

  const setTerm = (i: number, value: string) =>
    setForm((f) => {
      if (!f) return f;
      const terms = [...f.plan_terms];
      terms[i] = value;
      return { ...f, plan_terms: terms };
    });

  const addTerm = () =>
    setForm((f) => (f ? { ...f, plan_terms: [...f.plan_terms, ""] } : f));

  const removeTerm = (i: number) =>
    setForm((f) =>
      f ? { ...f, plan_terms: f.plan_terms.filter((_, j) => j !== i) } : f,
    );

  const onSave = async () => {
    if (!form) return;
    // Only send a clean, trimmed patch (drop empty terms).
    const patch: FlexiPaySettingsPatch = {
      plan_display_name: form.plan_display_name.trim() || "Flexi Pay",
      plan_terms: form.plan_terms.map((t) => t.trim()).filter(Boolean),
      min_first_payment_pct: Number(form.min_first_payment_pct),
      min_topup_ngn: Number(form.min_topup_ngn),
      custom_order_deposit_pct: Number(form.custom_order_deposit_pct),
      layaway_abandonment_days: Number(form.layaway_abandonment_days),
      layaway_reminder_cadence_days: Number(form.layaway_reminder_cadence_days),
      auto_cancel_after_no_payment: form.auto_cancel_after_no_payment,
      abandoned_checkout_nudge_enabled: form.abandoned_checkout_nudge_enabled,
      abandoned_checkout_nudge_hours: Number(
        form.abandoned_checkout_nudge_hours,
      ),
      abandoned_checkout_expiry_hours: Number(
        form.abandoned_checkout_expiry_hours,
      ),
      milestone_messages_enabled: form.milestone_messages_enabled,
      channels: form.channels,
      allow_staff_recorded_manual_payments:
        form.allow_staff_recorded_manual_payments,
    };
    try {
      await save.mutateAsync(patch);
      toast.success("Payment settings saved");
    } catch (e) {
      toast.error("Couldn't save settings", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  const num = (v: number) => (Number.isFinite(v) ? v : 0);

  return (
    <div className="space-y-4 max-w-3xl">
      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-accent-glow" />
          <h2 className="font-display text-lg">Flexi Pay (instalments)</h2>
        </div>
        <p className="text-[13px] text-text-muted">
          Let customers reserve an order with a deposit and pay the balance over
          time using a personal payment link. These settings apply to this
          business only.
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Customer-facing plan name">
            <TextInput
              value={form.plan_display_name}
              disabled={!canEdit}
              onChange={(e) => set("plan_display_name", e.target.value)}
              placeholder="Flexi Pay"
            />
          </Field>
          <Field
            label="Minimum first payment"
            hint="% of the order total to reserve"
          >
            <TextInput
              type="number"
              min={0}
              max={100}
              value={String(num(form.min_first_payment_pct))}
              disabled={!canEdit}
              onChange={(e) =>
                set("min_first_payment_pct", Number(e.target.value))
              }
            />
          </Field>
          <Field label="Minimum top-up (₦)" hint="smallest later payment">
            <TextInput
              type="number"
              min={0}
              value={String(num(form.min_topup_ngn))}
              disabled={!canEdit}
              onChange={(e) => set("min_topup_ngn", Number(e.target.value))}
            />
          </Field>
          <Field
            label="Custom-order deposit"
            hint="% deposit before production starts"
          >
            <TextInput
              type="number"
              min={0}
              max={100}
              value={String(num(form.custom_order_deposit_pct))}
              disabled={!canEdit}
              onChange={(e) =>
                set("custom_order_deposit_pct", Number(e.target.value))
              }
            />
          </Field>
        </div>
      </Card>

      {/* Plan terms */}
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold text-[14px]">Terms shown to customers</h3>
        <p className="text-[12px] text-text-muted">
          These bullets appear at checkout, on the pay page, and in the first
          reminder.
        </p>
        <div className="space-y-2">
          {form.plan_terms.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <TextInput
                value={t}
                disabled={!canEdit}
                onChange={(e) => setTerm(i, e.target.value)}
                placeholder="e.g. Your item is reserved once you pay the deposit"
              />
              {canEdit && (
                <button
                  type="button"
                  onClick={() => removeTerm(i)}
                  className="p-2 text-text-faint hover:text-danger shrink-0"
                  aria-label="Remove term"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        {canEdit && (
          <Button
            variant="secondary"
            onClick={addTerm}
            icon={<Plus className="w-4 h-4" />}
          >
            Add a term
          </Button>
        )}
      </Card>

      {/* Channels */}
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold text-[14px]">
          Which channels offer Flexi Pay
        </h3>
        <p className="text-[12px] text-text-muted">
          Sales Campaign must be on here AND enabled on the specific campaign in
          the campaign builder.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {CHANNELS.map((c) => (
            <div
              key={c.key}
              className="flex items-center justify-between rounded-[11px] border border-line px-3.5 py-2.5"
            >
              <span className="text-[13px]">{c.label}</span>
              <Toggle
                checked={form.channels[c.key] !== false}
                disabled={!canEdit}
                ariaLabel={`Flexi Pay on ${c.label}`}
                onChange={(v) => setChannel(c.key, v)}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* Timing + automation */}
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold text-[14px]">Reminders & abandonment</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <Field
            label="Auto-cancel after"
            hint="days of silence on an instalment"
          >
            <TextInput
              type="number"
              min={1}
              value={String(num(form.layaway_abandonment_days))}
              disabled={!canEdit}
              onChange={(e) =>
                set("layaway_abandonment_days", Number(e.target.value))
              }
            />
          </Field>
          <Field label="Reminder cadence" hint="days between balance reminders">
            <TextInput
              type="number"
              min={1}
              value={String(num(form.layaway_reminder_cadence_days))}
              disabled={!canEdit}
              onChange={(e) =>
                set("layaway_reminder_cadence_days", Number(e.target.value))
              }
            />
          </Field>
          <Field
            label="Abandoned-checkout nudge"
            hint="hours after an unpaid order"
          >
            <TextInput
              type="number"
              min={0}
              value={String(num(form.abandoned_checkout_nudge_hours))}
              disabled={!canEdit}
              onChange={(e) =>
                set("abandoned_checkout_nudge_hours", Number(e.target.value))
              }
            />
          </Field>
          <Field
            label="Abandoned-checkout expiry"
            hint="hours before auto-cancel (self-serve)"
          >
            <TextInput
              type="number"
              min={1}
              value={String(num(form.abandoned_checkout_expiry_hours))}
              disabled={!canEdit}
              onChange={(e) =>
                set("abandoned_checkout_expiry_hours", Number(e.target.value))
              }
            />
          </Field>
        </div>
        <div className="space-y-3 pt-1">
          <Toggle
            checked={form.auto_cancel_after_no_payment}
            disabled={!canEdit}
            onChange={(v) => set("auto_cancel_after_no_payment", v)}
            label="Auto-cancel abandoned instalment orders"
          />
          <Toggle
            checked={form.abandoned_checkout_nudge_enabled}
            disabled={!canEdit}
            onChange={(v) => set("abandoned_checkout_nudge_enabled", v)}
            label="Send the abandoned-checkout nudge"
          />
          <Toggle
            checked={form.milestone_messages_enabled}
            disabled={!canEdit}
            onChange={(v) => set("milestone_messages_enabled", v)}
            label="Send milestone messages (e.g. halfway there 🎉)"
          />
        </div>
      </Card>

      {/* Manual payments */}
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold text-[14px]">Staff-recorded payments</h3>
        <p className="text-[12px] text-text-muted">
          When on, staff with edit access can record a bank-transfer payment
          against an order (a bank reference is mandatory and the recorder is
          logged). Off by default so every payment comes through a gateway.
        </p>
        <Toggle
          checked={form.allow_staff_recorded_manual_payments}
          disabled={!canEdit}
          onChange={(v) => set("allow_staff_recorded_manual_payments", v)}
          label="Allow staff to record bank-transfer payments"
        />
      </Card>

      {canEdit && (
        <div className="flex items-center gap-3 sticky bottom-4">
          <Button
            onClick={onSave}
            disabled={!dirty || save.isPending}
            icon={
              save.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )
            }
          >
            Save changes
          </Button>
          {dirty && (
            <span className="text-[12px] text-text-muted">
              You have unsaved changes.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
