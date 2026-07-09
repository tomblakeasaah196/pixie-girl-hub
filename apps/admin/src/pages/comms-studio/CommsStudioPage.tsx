import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Cake,
  ExternalLink,
  Mail,
  MessageCircle,
  MessagesSquare,
  Package,
  ShieldOff,
  ShoppingBag,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { ErrorState, Select, Toggle } from "@/components/ui/controls";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useActiveBusiness } from "@/stores/business";
import {
  commsStudioApi,
  type Automation,
  type Category,
  type Channel,
  CATEGORY_LABEL,
  CATEGORY_DESCRIPTION,
  CATEGORY_ORDER,
} from "@/lib/comms-studio-api";
import { CommsStudioDrawer } from "./CommsStudioDrawer";

const CHANNEL_OPTIONS: { value: Channel; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "in_app_only", label: "In-app only" },
  { value: "respect_contact_pref", label: "Contact preference" },
  { value: "disabled", label: "Off" },
];

const EVENT_ICON: Record<string, LucideIcon> = {
  birthday_wish: Cake,
  welcome: Sparkles,
  order_confirmation: ShoppingBag,
  order_paid_receipt: ShoppingBag,
  invoice_issued: Package,
  order_ready: Package,
  order_shipped: Package,
  out_for_delivery: Package,
  delivery_failed: AlertTriangle,
  payment_reminder: Mail,
  layaway_reminder: Mail,
  production_update: Package,
  abandoned_cart: ShoppingBag,
  review_request: MessageCircle,
  marketing_blast: Users,
  campaign_launch: Users,
  newsletter: MessagesSquare,
  staff_invite: Users,
  stylist_assignment: Users,
};

/**
 * Communications Studio — CEO-editable control plane for every automated
 * outbound message the Hub sends. Each card is one automation: name,
 * channel, on/off, and a click into the edit drawer where the block
 * editor + live preview live.
 *
 * By default every automation is on email — the cost-safe posture.
 * The CEO opts into WhatsApp per automation from the channel selector,
 * respecting the block_whatsapp guardrail on marketing broadcasts.
 */
export function CommsStudioPage() {
  useBreadcrumbs([
    { label: "Settings", href: "/settings" },
    { label: "Communications Studio" },
  ]);
  const biz = useActiveBusiness();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["comms-studio", biz?.key],
    queryFn: () => commsStudioApi.list(),
    enabled: !!biz?.key,
  });
  const update = useMutation({
    mutationFn: commsStudioApi.update,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["comms-studio"] }),
  });
  const [editing, setEditing] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<Category, Automation[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const row of q.data ?? []) {
      const cat: Category = (row.category as Category) || "operational";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(row);
    }
    return map;
  }, [q.data]);

  if (q.isError) {
    return (
      <ErrorState
        message={(q.error as Error)?.message}
        onRetry={() => q.refetch()}
      />
    );
  }

  return (
    <div className="max-w-[1280px] mx-auto pb-16">
      <div className="mb-8">
        <h2 className="font-display text-[26px] font-medium tracking-tight">
          Communications Studio
        </h2>
        <p className="text-text-muted text-[13px] mt-2 max-w-[720px]">
          Every automated message the Hub sends to customers, in one place.
          Set the channel, edit the copy, preview the branded email — nothing
          hard-coded. Defaults are email; WhatsApp is opt-in per automation.
        </p>
        <div className="mt-3 flex items-center gap-2 text-[12px] text-text-faint">
          <ShieldOff className="w-3.5 h-3.5" />
          Broadcast automations (Marketing) hard-block WhatsApp by policy.
        </div>
      </div>

      {q.isLoading ? (
        <div className="grid gap-4">
          {[...Array(6)].map((_, i) => (
            <Card
              key={i}
              className="h-[92px] animate-pulse bg-text-primary/[0.04]"
            >
              {" "}
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-10">
          {CATEGORY_ORDER.map((cat) => {
            const rows = grouped.get(cat) ?? [];
            if (!rows.length) return null;
            return (
              <section key={cat}>
                <div className="mb-3">
                  <h3 className="font-display text-[16px] font-medium">
                    {CATEGORY_LABEL[cat]}
                  </h3>
                  <p className="text-[12px] text-text-faint mt-0.5">
                    {CATEGORY_DESCRIPTION[cat]}
                  </p>
                </div>
                <div className="grid gap-3">
                  {rows.map((row) => (
                    <AutomationRow
                      key={row.event_key}
                      row={row}
                      onToggle={(is_active) =>
                        update.mutate({ event_key: row.event_key, is_active })
                      }
                      onChannelChange={(channel_preference) =>
                        update.mutate({
                          event_key: row.event_key,
                          channel_preference,
                        })
                      }
                      onEdit={() => setEditing(row.event_key)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editing && (
        <CommsStudioDrawer
          eventKey={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AutomationRow({
  row,
  onToggle,
  onChannelChange,
  onEdit,
}: {
  row: Automation;
  onToggle: (is_active: boolean) => void;
  onChannelChange: (channel: Channel) => void;
  onEdit: () => void;
}) {
  const Icon = EVENT_ICON[row.event_key] ?? Mail;
  const undeclared = row.diagnostics?.undeclared_tokens ?? [];
  const warnings = row.diagnostics?.warnings ?? [];
  const channelDisabled = row.block_whatsapp
    ? CHANNEL_OPTIONS.filter((o) => o.value !== "whatsapp")
    : CHANNEL_OPTIONS;

  return (
    <Card className="!p-4">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-text-primary/[0.04] border border-line flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-text-muted" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-display text-[15px] font-medium leading-tight">
                  {row.display_name || row.event_key}
                </h4>
                {row.block_whatsapp && (
                  <Pill tone="warn">WhatsApp blocked</Pill>
                )}
                {row.trigger_type && (
                  <Pill tone="neutral">{row.trigger_type}</Pill>
                )}
              </div>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                {row.description || row.event_key}
              </p>
              {(undeclared.length > 0 || warnings.length > 0) && (
                <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300/90">
                  <AlertTriangle className="w-3 h-3 mt-[2px] shrink-0" />
                  <span className="leading-snug">
                    {warnings.join(" · ")}
                    {undeclared.length > 0 &&
                      ` Undeclared tokens: ${undeclared.join(", ")}`}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0 pt-1">
              <div className="w-[168px]">
                <Select
                  value={row.channel_preference}
                  onChange={(v) => onChannelChange(v as Channel)}
                  options={channelDisabled}
                  ariaLabel="Channel"
                />
              </div>
              <Toggle
                checked={row.is_active}
                onChange={onToggle}
                label={row.is_active ? "On" : "Off"}
              />
              <Button
                size="sm"
                variant="secondary"
                icon={<ExternalLink className="w-3.5 h-3.5" />}
                onClick={onEdit}
              >
                Edit
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
