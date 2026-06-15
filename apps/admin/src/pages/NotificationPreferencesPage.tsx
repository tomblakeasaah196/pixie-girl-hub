import { BellRing } from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { ErrorState, Toggle } from "@/components/ui/controls";
import { useNotificationPrefs, useUpsertNotificationPref } from "@/lib/settings";

/**
 * Settings → Notification preferences. A category × channel matrix of
 * toggles for the logged-in user's OWN preferences (self-service). Each
 * cell reflects the matching pref; toggling upserts that single row.
 * No row stored ⇒ default ON.
 */

const CATEGORIES = ["sales", "approvals", "stock", "system", "marketing"] as const;
const CHANNELS = ["email", "sms", "push", "in_app"] as const;

const CHANNEL_LABEL: Record<(typeof CHANNELS)[number], string> = {
  email: "Email",
  sms: "SMS",
  push: "Push",
  in_app: "In-app",
};
const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = {
  sales: "Sales",
  approvals: "Approvals",
  stock: "Stock",
  system: "System",
  marketing: "Marketing",
};

export function NotificationPreferencesPage() {
  const query = useNotificationPrefs();
  const upsert = useUpsertNotificationPref();

  const prefs = query.data ?? [];

  const isEnabled = (category: string, channel: string): boolean => {
    const row = prefs.find((p) => p.category === category && p.channel === channel);
    return row ? row.enabled : true; // default ON when no row exists
  };

  if (query.isError) {
    return (
      <div className="max-w-[820px]">
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
    <div className="max-w-[820px]">
      <div className="mb-4">
        <h2 className="font-display text-xl font-medium">Notification preferences</h2>
        <p className="text-[13px] text-text-muted mt-0.5">
          These are your own preferences — they affect only how you are
          notified. Each category can be tuned per channel.
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="micro p-[12px_18px] border-b hairline bg-text-primary/[0.02] text-left">
                  Category
                </th>
                {CHANNELS.map((ch) => (
                  <th
                    key={ch}
                    className="micro p-[12px_18px] border-b hairline bg-text-primary/[0.02] text-center"
                  >
                    {CHANNEL_LABEL[ch]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.isLoading
                ? Array.from({ length: CATEGORIES.length }).map((_, i) => (
                    <tr key={i}>
                      <td className="p-[0_18px] h-[54px] border-b hairline text-[13px] text-text-faint">
                        …
                      </td>
                      {CHANNELS.map((ch) => (
                        <td key={ch} className="p-[0_18px] h-[54px] border-b hairline" />
                      ))}
                    </tr>
                  ))
                : CATEGORIES.map((cat) => (
                    <tr key={cat} className="border-b hairline last:border-0">
                      <td className="p-[0_18px] h-[54px] text-[13px] font-semibold align-middle">
                        {CATEGORY_LABEL[cat]}
                      </td>
                      {CHANNELS.map((ch) => (
                        <td key={ch} className="p-[0_18px] h-[54px] align-middle text-center">
                          <div className="inline-flex">
                            <Toggle
                              checked={isEnabled(cat, ch)}
                              disabled={upsert.isPending}
                              onChange={(enabled) =>
                                upsert.mutate({ channel: ch, category: cat, enabled })
                              }
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

      <p className="text-[11px] text-text-faint mt-3 flex items-center gap-1.5">
        <BellRing className="w-3.5 h-3.5" />
        Categories with no saved preference default to on for every channel.
      </p>
    </div>
  );
}
