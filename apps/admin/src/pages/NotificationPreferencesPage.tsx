/**
 * Settings → Notification preferences.
 *
 * Per-notification-type matrix using the real /api/v1/notifications/preferences
 * endpoint. Each of the 17 known types shows a row with channel toggles
 * (in_app / email / sms / push / whatsapp). Defaults to all-on when no row
 * is stored.
 *
 * Also surfaces the Do Not Disturb schedule (stored in local Zustand store,
 * per device) and a push permission request button.
 */

import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { BellRing, Moon, Smartphone } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { ErrorState, Toggle } from "@/components/ui/controls";
import { useNotifPrefs, useUpsertNotifPref, NOTIF_META, NOTIF_TYPE_LABELS } from "@/lib/notifications-api";
import { useNotifStore } from "@/stores/notifications";
import { pushPermission, requestPushPermission, markPushPrompted, ensurePushSubscription } from "@/lib/push";
import { useState } from "react";

const CHANNELS = ["in_app", "email", "sms", "push", "whatsapp"] as const;

const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = {
  in_app:    "In-app",
  email:     "Email",
  sms:       "SMS",
  push:      "Push",
  whatsapp:  "WhatsApp",
};

const CHANNEL_FIELD: Record<(typeof CHANNELS)[number], string> = {
  in_app:    "in_app",
  email:     "email_enabled",
  sms:       "sms_enabled",
  push:      "push_enabled",
  whatsapp:  "whatsapp_enabled",
};

// Group types by category for display
const CATEGORIES: Record<string, string> = {
  approvals: "Approvals",
  sales:     "Sales & Finance",
  stock:     "Stock & Production",
  ops:       "Operations & Tasks",
  system:    "System",
};

const ALL_TYPES = Object.keys(NOTIF_META) as Array<keyof typeof NOTIF_META>;

function typesByCategory(cat: string) {
  return ALL_TYPES.filter((t) => NOTIF_META[t].category === cat);
}

export function NotificationPreferencesPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Notifications" }]);
  const query = useNotifPrefs();
  const upsert = useUpsertNotifPref();
  const { dnd, setDnd } = useNotifStore();
  const [pushPerm, setPushPerm] = useState<NotificationPermission>(pushPermission());
  const [requesting, setRequesting] = useState(false);

  const prefs = query.data ?? [];

  function getValue(type: string, channel: (typeof CHANNELS)[number]): boolean {
    const field = CHANNEL_FIELD[channel];
    const row = prefs.find((p) => p.notification_type === type);
    return row ? (row[field as keyof typeof row] as boolean) : true;
  }

  function toggle(type: string, channel: (typeof CHANNELS)[number], enabled: boolean) {
    upsert.mutate({ notification_type: type, [CHANNEL_FIELD[channel]]: enabled });
  }

  async function handleRequestPush() {
    setRequesting(true);
    const perm = await requestPushPermission();
    setPushPerm(perm);
    markPushPrompted();
    if (perm === "granted") await ensurePushSubscription();
    setRequesting(false);
  }

  if (query.isError) {
    return (
      <div className="max-w-[960px]">
        <Card className="overflow-hidden">
          <ErrorState
            message="We couldn't load your notification preferences."
            onRetry={() => query.refetch()}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-[960px] space-y-6">
      <div>
        <h2 className="font-display text-xl font-medium">Notification preferences</h2>
        <p className="text-[13px] text-text-muted mt-0.5">
          Control which notifications you receive per channel. Changes are saved immediately.
        </p>
      </div>

      {/* Push permission card */}
      <Card className="p-4 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/10 grid place-items-center shrink-0">
          <Smartphone className="w-5 h-5 text-accent" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold text-text-primary">Push notifications</p>
          <p className="text-[12px] text-text-muted mt-0.5">
            {pushPerm === "granted"
              ? "Push is enabled. You'll receive alerts even when the app is closed."
              : pushPerm === "denied"
              ? "Push was blocked in your browser. Allow it in your browser's site settings."
              : "Enable push to receive alerts even when the app is closed."}
          </p>
        </div>
        {pushPerm === "default" && (
          <button
            onClick={handleRequestPush}
            disabled={requesting}
            className="shrink-0 h-9 px-4 rounded-xl bg-accent-deep text-[#F4E9D9] text-[12.5px] font-semibold hover:bg-accent transition-colors disabled:opacity-60"
          >
            {requesting ? "Requesting…" : "Enable push"}
          </button>
        )}
        {pushPerm === "granted" && (
          <span className="shrink-0 text-[11px] text-success font-semibold">✓ Enabled</span>
        )}
      </Card>

      {/* DND card */}
      <Card className="p-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-info/10 grid place-items-center shrink-0">
            <Moon className="w-5 h-5 text-info" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[13.5px] font-semibold text-text-primary">Do Not Disturb</p>
                <p className="text-[12px] text-text-muted mt-0.5">
                  Silence sounds and in-app toasts during these hours. Notifications still accumulate.
                </p>
              </div>
              <Toggle
                checked={dnd.enabled}
                onChange={(v) => setDnd({ enabled: v })}
              />
            </div>
            {dnd.enabled && (
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <label className="flex items-center gap-2 text-[12px] text-text-muted">
                  From
                  <select
                    value={dnd.startHour}
                    onChange={(e) => setDnd({ startHour: Number(e.target.value) })}
                    className="h-8 px-2 rounded-lg bg-text-primary/[0.06] border border-line text-text-primary text-[12px]"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {String(i).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[12px] text-text-muted">
                  Until
                  <select
                    value={dnd.endHour}
                    onChange={(e) => setDnd({ endHour: Number(e.target.value) })}
                    className="h-8 px-2 rounded-lg bg-text-primary/[0.06] border border-line text-text-primary text-[12px]"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>
                        {String(i).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Per-type matrix */}
      {Object.entries(CATEGORIES).map(([catKey, catLabel]) => {
        const types = typesByCategory(catKey);
        if (!types.length) return null;
        return (
          <div key={catKey}>
            <p className="micro mb-2">{catLabel}</p>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="micro p-[11px_18px] border-b hairline bg-text-primary/[0.02] text-left">
                        Notification type
                      </th>
                      {CHANNELS.map((ch) => (
                        <th
                          key={ch}
                          className="micro p-[11px_14px] border-b hairline bg-text-primary/[0.02] text-center"
                        >
                          {CHANNEL_LABEL[ch]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {query.isLoading
                      ? types.map((_, i) => (
                          <tr key={i} className="border-b hairline last:border-0">
                            <td className="p-[0_18px] h-[50px] text-[13px] text-text-faint">…</td>
                            {CHANNELS.map((ch) => (
                              <td key={ch} className="p-[0_14px] h-[50px]" />
                            ))}
                          </tr>
                        ))
                      : types.map((type) => (
                          <tr key={type} className="border-b hairline last:border-0 hover:bg-text-primary/[0.02]">
                            <td className="p-[0_18px] h-[50px] text-[13px] font-medium text-text-primary align-middle">
                              {NOTIF_TYPE_LABELS[type] ?? type.replace(/_/g, " ")}
                            </td>
                            {CHANNELS.map((ch) => (
                              <td key={ch} className="p-[0_14px] h-[50px] align-middle text-center">
                                <div className="inline-flex">
                                  <Toggle
                                    checked={getValue(type, ch)}
                                    disabled={upsert.isPending}
                                    onChange={(v) => toggle(type, ch, v)}
                                  />
                                </div>
                              </td>
                            ))}
                          </tr>
                        ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        );
      })}

      <p className="text-[11px] text-text-faint flex items-center gap-1.5">
        <BellRing className="w-3.5 h-3.5" />
        Types with no saved preference default to on for every channel.
      </p>
    </div>
  );
}
