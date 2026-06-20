import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wallet,
  AlertTriangle,
  Loader2,
  Check,
  Mail,
  MessageSquare,
  Instagram,
  Bell,
  Ban,
  HelpCircle,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useActiveBusiness } from "@/stores/business";
import { Card } from "@/components/ui/primitives";
import {
  outboundPolicyApi,
  EVENT_META,
  CATEGORY_ORDER,
  type OutboundPolicy,
  type ChannelPreference,
} from "@/lib/outbound-policy-api";

/**
 * Channel Policy editor — Settings → Channel Policy.
 *
 * Lays out the 19 seeded events grouped by category. Each row has
 * an inline channel picker, fallback picker, block-WhatsApp toggle,
 * and a free-text rationale (so future-CEO knows why).
 *
 * The Hub never sends an outbound automation without first calling
 * resolveChannel() over this table — so every edit here is binding.
 */

const CHOICES: {
  value: ChannelPreference;
  label: string;
  icon: React.FC<{ className?: string }>;
  cost: string;
}[] = [
  { value: "email", label: "Email", icon: Mail, cost: "Free" },
  {
    value: "whatsapp",
    label: "WhatsApp",
    icon: MessageSquare,
    cost: "~₦11–₦88",
  },
  { value: "instagram", label: "Instagram", icon: Instagram, cost: "Free" },
  { value: "in_app_only", label: "In-app only", icon: Bell, cost: "Free" },
  {
    value: "respect_contact_pref",
    label: "Customer's pick",
    icon: HelpCircle,
    cost: "Varies",
  },
  { value: "disabled", label: "Disabled", icon: Ban, cost: "—" },
];

export function ChannelPolicyPage() {
  useBreadcrumbs([
    { label: "Settings", href: "/settings" },
    { label: "Channel Policy" },
  ]);
  const business = useActiveBusiness();
  const qc = useQueryClient();
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["outbound-policy", business.key],
    queryFn: () => outboundPolicyApi.list(),
  });

  const save = useMutation({
    mutationFn: outboundPolicyApi.upsert,
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["outbound-policy", business.key] });
      setSavedAt((m) => ({ ...m, [p.event_key]: Date.now() }));
      setTimeout(() => setSavedAt((m) => ({ ...m, [p.event_key]: 0 })), 2000);
    },
  });

  const byCategory = useMemo(() => {
    const m = new Map<string, OutboundPolicy[]>();
    for (const p of policies) {
      const meta = EVENT_META[p.event_key];
      const cat = meta?.category ?? "Other";
      const arr = m.get(cat) ?? [];
      arr.push(p);
      m.set(cat, arr);
    }
    return m;
  }, [policies]);

  return (
    <div className="max-w-[1040px]">
      <header className="flex items-center gap-3 mb-1">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Wallet className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">
            Channel Policy
            <span className="text-text-faint text-[14px] ml-2">
              · {business.name}
            </span>
          </h2>
          <p className="text-text-muted text-[13px]">
            Where every automated outbound message goes. Most things default to
            email (free); only delivery + recovery use WhatsApp; marketing stays
            off WhatsApp by guardrail.
          </p>
        </div>
      </header>

      <div className="mt-3 mb-5 flex items-start gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/5 px-3.5 py-2.5 text-[12.5px] text-amber-200">
        <AlertTriangle className="w-4 h-4 mt-[2px] shrink-0" />
        <div>
          <span className="font-medium text-text-primary">
            Every send goes through this matrix.
          </span>{" "}
          Subscribers (layaway reminder, shipping notification, …) pass an{" "}
          <code className="font-mono text-[11px] px-1 bg-panel-2 rounded">
            event_key
          </code>{" "}
          and the resolver picks the channel here — including the unconditional{" "}
          <strong>block WhatsApp</strong> guardrail on marketing.
        </div>
      </div>

      {!isLoading && policies.length > 0 && (
        <CostProjector policies={policies} />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-panel-2 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((cat) => (
            <section key={cat}>
              <h3 className="font-display text-[15px] font-medium uppercase tracking-widest text-text-faint mb-2.5">
                {cat}
              </h3>
              <Card className="p-0 overflow-hidden">
                {byCategory
                  .get(cat)!
                  .sort((a, b) => a.event_key.localeCompare(b.event_key))
                  .map((p, i, arr) => (
                    <PolicyRow
                      key={p.policy_id}
                      policy={p}
                      isLast={i === arr.length - 1}
                      saving={
                        save.isPending &&
                        save.variables?.event_key === p.event_key
                      }
                      saved={!!savedAt[p.event_key]}
                      onSave={(patch) =>
                        save.mutate({
                          event_key: p.event_key,
                          channel_preference:
                            patch.channel_preference ?? p.channel_preference,
                          fallback_channel:
                            patch.fallback_channel ??
                            p.fallback_channel ??
                            undefined,
                          rationale:
                            patch.rationale ?? p.rationale ?? undefined,
                          block_whatsapp:
                            patch.block_whatsapp ?? p.block_whatsapp,
                          is_active: patch.is_active ?? p.is_active,
                        })
                      }
                    />
                  ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

interface PolicyRowProps {
  policy: OutboundPolicy;
  isLast: boolean;
  saving: boolean;
  saved: boolean;
  onSave: (patch: Partial<OutboundPolicy>) => void;
}

function PolicyRow({ policy, isLast, saving, saved, onSave }: PolicyRowProps) {
  const meta = EVENT_META[policy.event_key];
  const [rationale, setRationale] = useState(policy.rationale ?? "");
  const [showRationale, setShowRationale] = useState(false);

  return (
    <div
      className={`p-3.5 ${!isLast ? "border-b hairline" : ""} ${
        !policy.is_active ? "opacity-60" : ""
      }`}
    >
      <div className="flex flex-col md:flex-row md:items-start gap-3">
        <div className="md:w-[260px] shrink-0">
          <div className="font-medium text-[13.5px] text-text-primary">
            {meta?.label ?? policy.event_key}
          </div>
          {meta?.description && (
            <p className="text-[11.5px] text-text-faint leading-relaxed mt-0.5">
              {meta.description}
            </p>
          )}
          <code className="text-[10px] text-text-faint font-mono">
            {policy.event_key}
          </code>
        </div>

        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <ChannelPicker
            label="Primary"
            value={policy.channel_preference}
            onChange={(v) => onSave({ channel_preference: v })}
          />
          <ChannelPicker
            label="Fallback"
            value={(policy.fallback_channel ?? "email") as ChannelPreference}
            onChange={(v) =>
              onSave({
                fallback_channel:
                  v === "respect_contact_pref"
                    ? null
                    : (v as OutboundPolicy["fallback_channel"]),
              })
            }
            compact
          />
        </div>

        <div className="flex flex-col items-stretch gap-2 md:w-[180px]">
          <BlockToggle
            checked={policy.block_whatsapp}
            onChange={(v) => onSave({ block_whatsapp: v })}
          />
          <button
            onClick={() => setShowRationale((v) => !v)}
            className="text-[11px] text-text-faint hover:text-text-muted text-left"
          >
            {showRationale ? "Hide" : "Edit"} rationale
          </button>
        </div>
      </div>

      {showRationale && (
        <div className="mt-3 ml-0 md:ml-[270px]">
          <textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            onBlur={() => {
              if (rationale !== (policy.rationale ?? "")) {
                onSave({ rationale });
              }
            }}
            placeholder="Why this channel? (shown in audit log)"
            rows={2}
            className="w-full rounded-lg bg-panel-2 border hairline px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-accent/40"
          />
        </div>
      )}

      <div className="mt-2 ml-0 md:ml-[270px] h-4 flex items-center gap-2 text-[11px]">
        {saving && (
          <span className="inline-flex items-center gap-1 text-text-faint">
            <Loader2 className="w-3 h-3 animate-spin" />
            Saving…
          </span>
        )}
        {saved && !saving && (
          <span className="inline-flex items-center gap-1 text-green-300">
            <Check className="w-3 h-3" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}

function ChannelPicker({
  label,
  value,
  onChange,
  compact,
}: {
  label: string;
  value: ChannelPreference;
  onChange: (v: ChannelPreference) => void;
  compact?: boolean;
}) {
  return (
    <div>
      <span className="block text-[10.5px] uppercase tracking-widest text-text-faint mb-1">
        {label}
      </span>
      <div className={`grid grid-cols-3 gap-1`}>
        {CHOICES.slice(0, compact ? 5 : 6).map((c) => {
          const Icon = c.icon;
          const active = value === c.value;
          return (
            <button
              key={c.value}
              onClick={() => onChange(c.value)}
              title={`${c.label} (${c.cost})`}
              className={`flex flex-col items-center justify-center rounded-lg border hairline px-1 py-1.5 transition-colors ${
                active
                  ? "bg-accent text-bg border-accent"
                  : "bg-panel-2 text-text-muted hover:text-text-primary"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="text-[9.5px] mt-0.5">{c.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BlockToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      title={
        checked
          ? "Hard guardrail ON — WhatsApp blocked even if customer preference says so."
          : "WhatsApp allowed for this event."
      }
      className={`flex items-center justify-between rounded-xl border hairline px-2.5 py-1.5 text-[11.5px] transition-colors ${
        checked
          ? "border-danger/30 bg-danger/5 text-danger"
          : "text-text-muted hover:text-text-primary"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        <Ban className="w-3 h-3" />
        Block WhatsApp
      </span>
      <span
        className={`w-7 h-3.5 rounded-full transition-colors ${
          checked ? "bg-danger" : "bg-panel-2 border hairline"
        }`}
      >
        <span
          className={`block w-2.5 h-2.5 m-0.5 rounded-full bg-bg transition-transform ${
            checked ? "translate-x-3.5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}

// Per-message WhatsApp rates for Nigerian numbers (early-2026 estimate).
// Email / Instagram / in-app are free; only business-initiated WhatsApp
// templates are billed. Marketing templates cost ~8x a utility template.
const WA_UTILITY_NGN = 11;
const WA_MARKETING_NGN = 88;

/**
 * Live cost projector — turns the channel choices above into a monthly ₦
 * estimate. Only events routed to WhatsApp incur cost; tweak the assumed
 * monthly volume per event to see the bill move. Pure UI, no backend.
 */
function CostProjector({ policies }: { policies: OutboundPolicy[] }) {
  const waEvents = useMemo(
    () =>
      policies.filter(
        (p) =>
          p.is_active &&
          p.channel_preference === "whatsapp" &&
          !p.block_whatsapp,
      ),
    [policies],
  );

  const [volumes, setVolumes] = useState<Record<string, number>>({});

  const rateFor = (eventKey: string) =>
    EVENT_META[eventKey]?.category === "Marketing"
      ? WA_MARKETING_NGN
      : WA_UTILITY_NGN;
  const defaultVol = (eventKey: string) =>
    EVENT_META[eventKey]?.category === "Marketing" ? 500 : 100;

  const total = waEvents.reduce((sum, p) => {
    const vol = volumes[p.event_key] ?? defaultVol(p.event_key);
    return sum + vol * rateFor(p.event_key);
  }, 0);

  return (
    <Card className="mb-5 p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display text-[15px] font-medium">
          Monthly cost projection
        </h3>
        <span className="font-mono text-[18px] font-semibold text-accent-glow">
          ≈ ₦{total.toLocaleString()}
          <span className="text-[11px] text-text-faint">/mo</span>
        </span>
      </div>
      <p className="text-[12px] text-text-muted mb-3">
        Email, Instagram & in-app are free — only WhatsApp templates are billed
        (utility ≈ ₦{WA_UTILITY_NGN}, marketing ≈ ₦{WA_MARKETING_NGN} each).
        Adjust the assumed monthly volume to project the bill.
      </p>

      {waEvents.length === 0 ? (
        <div className="rounded-lg bg-green-400/5 border border-green-400/20 px-3 py-2 text-[12.5px] text-green-300">
          ✓ Every outbound event is on a free channel — ₦0/mo projected for
          WhatsApp.
        </div>
      ) : (
        <div className="space-y-1.5">
          {waEvents.map((p) => {
            const vol = volumes[p.event_key] ?? defaultVol(p.event_key);
            const rate = rateFor(p.event_key);
            const meta = EVENT_META[p.event_key];
            return (
              <div
                key={p.event_key}
                className="flex items-center gap-3 text-[12.5px]"
              >
                <span className="flex-1 truncate">
                  {meta?.label ?? p.event_key}
                  <span className="text-text-faint">
                    {" "}
                    · {meta?.category === "Marketing"
                      ? "marketing"
                      : "utility"}{" "}
                    @ ₦{rate}
                  </span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={vol}
                  onChange={(e) =>
                    setVolumes((m) => ({
                      ...m,
                      [p.event_key]: Math.max(0, Number(e.target.value) || 0),
                    }))
                  }
                  className="w-20 rounded-md bg-panel-2 border hairline px-2 py-1 text-[12px] text-right focus:outline-none focus:border-accent/40"
                />
                <span className="w-24 text-right font-mono text-text-primary">
                  ₦{(vol * rate).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
