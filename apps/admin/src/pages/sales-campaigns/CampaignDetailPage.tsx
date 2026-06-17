import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Copy, Gift, Pencil, Send, Share2, Sparkles, Trophy, Users } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, EmptyState, KpiTile, MoneyText, Pill, Skeleton, type Tone } from "@/components/ui/primitives";
import { DeniedState, ErrorState } from "@/components/ui/controls";
import { Field } from "@/components/ui/Form";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import {
  type Campaign,
  type CampaignStatus,
  type VipGrant,
  useCampaign,
  useCampaignMetrics,
  useCampaignSignups,
  useGrantVip,
  usePraxisAnalyticsQna,
  useShareKit,
  useUpdateGiftStatus,
  useVipGrants,
} from "@/lib/campaigns";

const TONE_FOR: Record<CampaignStatus, Tone> = {
  draft: "neutral",
  pending_approval: "warn",
  scheduled: "info",
  live: "success",
  paused: "warn",
  ended: "neutral",
  archived: "neutral",
};

export function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const campaignQ = useCampaign(id);
  const metricsQ = useCampaignMetrics(id);
  const { can } = useAuthStore();
  const [tab, setTab] = useState<"live" | "signups" | "share" | "vip" | "praxis">("live");
  useBreadcrumbs([
    { label: "Sales Campaigns", href: "/sales-campaigns" },
    { label: campaignQ.data?.name || "Loading…" },
  ]);

  if (!can("sales_campaigns", "view")) return <DeniedState />;
  if (campaignQ.isLoading) return <Skeleton style={{ height: 280 }} />;
  if (campaignQ.isError || !campaignQ.data) return <ErrorState onRetry={() => campaignQ.refetch()} />;

  const campaign = campaignQ.data;
  const rollups = metricsQ.data?.rollups || {};
  const conversion = rollups.total_unique_visitors > 0
    ? ((rollups.total_orders || 0) / rollups.total_unique_visitors) * 100
    : 0;
  const aov = rollups.total_orders > 0
    ? Number(rollups.total_revenue_ngn || 0) / Number(rollups.total_orders)
    : 0;

  return (
    <div className="space-y-4">
      <Card className="p-5 relative overflow-hidden">
        <div
          className="absolute -top-12 -right-8 w-[280px] h-[280px] rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgb(var(--accent-deep)/0.45), transparent 70%)",
            filter: "blur(36px)",
          }}
        />
        <div className="relative flex items-center gap-3 flex-wrap">
          <Link to="/sales-campaigns" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-muted hover:text-text-primary">
            <ArrowLeft className="w-3.5 h-3.5" /> All campaigns
          </Link>
          <Pill tone={TONE_FOR[campaign.status]}>{campaign.status.replace("_", " ")}</Pill>
          {campaign.ai_assist_pct > 0 && (
            <Pill tone="accent" dot={false}>
              <Sparkles className="w-3 h-3" /> {Math.round(campaign.ai_assist_pct * 100)}% AI
            </Pill>
          )}
          <Link to={`/sales-campaigns/${campaign.campaign_id}/edit`} className="ml-auto">
            <Button variant="ghost" icon={<Pencil className="w-4 h-4" />}>Open builder</Button>
          </Link>
        </div>
        <div className="relative mt-3">
          <h1 className="font-display text-[28px] md:text-[34px] leading-tight">{campaign.name}</h1>
          <div className="micro mt-1">/sale/{campaign.slug}</div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiTile label="Visitors" value={String(rollups.total_unique_visitors || 0)} tone="accent" />
        <KpiTile label="Signups" value={String(rollups.total_signups || 0)} tone="accent" />
        <KpiTile label="Orders" value={String(rollups.total_orders || 0)} tone="accent" />
        <KpiTile label="Revenue" value={money(Number(rollups.total_revenue_ngn || 0))} tone="accent" />
        <KpiTile label="Conversion" value={`${conversion.toFixed(2)}%`} tone="accent" />
      </div>

      <Card className="p-2">
        <div className="flex flex-wrap gap-1">
          {[
            { k: "live", l: "Live" },
            { k: "signups", l: "Signups" },
            { k: "share", l: "Share kit" },
            { k: "vip", l: "VIP &amp; gifts" },
            { k: "praxis", l: "Ask Praxis" },
          ].map(({ k, l }) => (
            <button
              key={k}
              onClick={() => setTab(k as typeof tab)}
              className={cn(
                "px-3 py-2 rounded-[11px] text-[12.5px] font-semibold",
                tab === k ? "bg-accent-deep text-[#F4E9D9]" : "text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary",
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </Card>

      {tab === "live" && <LivePanel campaign={campaign} aov={aov} />}
      {tab === "signups" && <SignupsPanel campaignId={campaign.campaign_id} />}
      {tab === "share" && <SharePanel campaignId={campaign.campaign_id} />}
      {tab === "vip" && <VipPanel campaign={campaign} />}
      {tab === "praxis" && <PraxisPanel campaignId={campaign.campaign_id} />}
    </div>
  );
}

function LivePanel({ campaign, aov }: { campaign: Campaign; aov: number }) {
  const start = new Date(campaign.starts_at);
  const end = new Date(campaign.ends_at);
  const now = Date.now();
  const remaining = Math.max(0, end.getTime() - now);
  const days = Math.floor(remaining / (24 * 3600 * 1000));
  const hours = Math.floor((remaining % (24 * 3600 * 1000)) / (3600 * 1000));
  const mins = Math.floor((remaining % (3600 * 1000)) / 60000);

  return (
    <Card className="p-5 space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div>
          <div className="micro">AOV</div>
          <div className="font-display text-[34px] tabular-nums mt-1"><MoneyText ngn={aov} /></div>
          <div className="text-[12px] text-text-faint mt-1">
            Discount given: <span className="font-mono text-accent-glow">{money(Number(campaign.total_discount_given_ngn || 0))}</span>
          </div>
        </div>
        <div>
          <div className="micro">Time remaining</div>
          <div className="font-display text-[34px] tabular-nums font-mono mt-1">
            {String(days).padStart(2, "0")} : {String(hours).padStart(2, "0")} : {String(mins).padStart(2, "0")}
          </div>
          <div className="text-[12px] text-text-faint mt-1">
            Starts {start.toLocaleString()} → Ends {end.toLocaleString()}
          </div>
        </div>
      </div>
    </Card>
  );
}

function SignupsPanel({ campaignId }: { campaignId: string }) {
  const q = useCampaignSignups(campaignId);
  const data = q.data?.data || [];
  if (q.isLoading) return <Skeleton style={{ height: 180 }} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (!data.length)
    return (
      <Card className="p-2">
        <EmptyState icon={<Users className="w-7 h-7" />} title="No signups yet" message="Pre-launch signups will appear here once you publish the campaign and visitors opt in." />
      </Card>
    );
  return (
    <Card className="p-4">
      <div className="space-y-1.5">
        {data.map((s: Record<string, unknown>, i) => (
          <div key={String(s.signup_id || i)} className="grid grid-cols-12 gap-3 items-center p-2.5 rounded-[10px] bg-text-primary/[0.04]">
            <span className="col-span-4 text-[13px] truncate">{String(s.email || "—")}</span>
            <span className="col-span-3 text-[12px] text-text-muted">{String(s.phone || "—")}</span>
            <span className="col-span-2 text-[11px] font-semibold uppercase tracking-wide text-accent-glow">{String(s.notify_via || "email")}</span>
            <span className="col-span-3 text-[11px] text-text-faint font-mono">
              {s.signed_up_at ? new Date(String(s.signed_up_at)).toLocaleString() : ""}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SharePanel({ campaignId }: { campaignId: string }) {
  const q = useShareKit(campaignId);
  const [copied, setCopied] = useState<string | null>(null);
  function copy(label: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    });
  }
  if (q.isLoading) return <Skeleton style={{ height: 200 }} />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const kit = q.data;
  return (
    <Card className="p-5 space-y-4">
      <div>
        <div className="micro mb-1">Base URL</div>
        <div className="flex gap-2 items-center">
          <code className="text-[13px] font-mono text-accent-glow truncate flex-1">{kit.base_url}</code>
          <Button variant="ghost" onClick={() => copy("url", kit.base_url)} icon={<Copy className="w-4 h-4" />}>
            {copied === "url" ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Object.entries(kit.copy).map(([k, v]) => (
          <div key={k} className="dropglass rounded-[12px] p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Share2 className="w-3.5 h-3.5 text-accent-glow" />
              <span className="micro">{k.replace(/_/g, " ")}</span>
            </div>
            <pre className="text-[12.5px] whitespace-pre-wrap text-text-muted leading-relaxed">{v}</pre>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => copy(k, v)} icon={<Copy className="w-3.5 h-3.5" />}>
                {copied === k ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function VipPanel({ campaign }: { campaign: Campaign }) {
  const q = useVipGrants(campaign.campaign_id);
  const grant = useGrantVip(campaign.campaign_id);
  const update = useUpdateGiftStatus(campaign.campaign_id);
  const grants = (q.data?.data || []) as VipGrant[];

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-[22px]">VIP gifts</h2>
          <p className="text-text-muted text-[13px] mt-1">
            Top {campaign.vip_top_n} spenders get a personal gift from Faith.
            {campaign.vip_lifetime_threshold_ngn ? ` Anyone above ${money(Number(campaign.vip_lifetime_threshold_ngn))} lifetime spend is promoted to Platinum VIP.` : ""}
          </p>
        </div>
        {campaign.status === "ended" && (
          <Button variant="primary" icon={<Trophy className="w-4 h-4" />} onClick={() => grant.mutate({})}>
            {grant.isPending ? "Computing…" : "Compute VIP gifts"}
          </Button>
        )}
      </div>
      {q.isLoading && <Skeleton style={{ height: 140 }} />}
      {!q.isLoading && grants.length === 0 && (
        <EmptyState
          icon={<Gift className="w-7 h-7" />}
          title="No VIP grants yet"
          message="VIP gifts are computed when the campaign ends. Top spenders + lifetime-threshold customers appear here."
        />
      )}
      <div className="space-y-1.5">
        {grants.map((g) => (
          <div key={g.grant_id} className="grid grid-cols-12 gap-3 items-center p-3 rounded-[12px] bg-text-primary/[0.04] border border-line">
            <span className="col-span-1 font-display text-[16px] tabular-nums text-center">#{g.rank}</span>
            <div className="col-span-3 min-w-0">
              <div className="font-medium text-[13px] truncate">{g.first_name} {g.last_name}</div>
              <div className="text-text-faint text-[11px] truncate">{g.email || g.instagram_handle}</div>
            </div>
            <div className="col-span-2 text-[12.5px] tabular-nums"><MoneyText ngn={Number(g.total_spend_ngn || 0)} /></div>
            <div className="col-span-3 text-[12px] text-text-muted truncate">{g.praxis_gift_suggestion}</div>
            <div className="col-span-2 flex gap-1 justify-end">
              <Pill tone={g.gift_status === "delivered" ? "success" : g.gift_status === "dispatched" ? "info" : g.gift_status === "approved" ? "warn" : "neutral"}>
                {g.gift_status}
              </Pill>
              {g.promoted_to_platinum && <Pill tone="accent" dot={false}>Platinum</Pill>}
            </div>
            <div className="col-span-1">
              {g.gift_status === "pending" && (
                <button
                  onClick={() => update.mutate({ grantId: g.grant_id, gift_status: "approved" })}
                  className="text-[11px] font-semibold text-accent-glow hover:underline"
                >
                  Approve
                </button>
              )}
              {g.gift_status === "approved" && (
                <button
                  onClick={() => update.mutate({ grantId: g.grant_id, gift_status: "dispatched" })}
                  className="text-[11px] font-semibold text-accent-glow hover:underline"
                >
                  Dispatch
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PraxisPanel({ campaignId }: { campaignId: string }) {
  const ask = usePraxisAnalyticsQna(campaignId);
  const [q, setQ] = useState("");
  const [history, setHistory] = useState<Array<{ q: string; a: string }>>([]);

  async function send() {
    if (!q.trim()) return;
    const question = q;
    setQ("");
    const r = await ask.mutateAsync({ question });
    setHistory((h) => [...h, { q: question, a: r.answer }]);
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent-glow" />
        <h2 className="font-display text-[22px]">Ask Praxis</h2>
      </div>
      <p className="text-text-muted text-[13px]">
        Natural-language questions about this campaign. Try: "Which bundle made the most yesterday?" or "Why did conversion drop after 3pm?"
      </p>
      <div className="space-y-3 max-h-[420px] overflow-y-auto pr-2">
        {history.map((m, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-end">
              <div className="bg-accent-deep text-[#F4E9D9] rounded-[14px] rounded-tr-sm px-4 py-2 text-[13px] max-w-[80%]">{m.q}</div>
            </div>
            <div className="flex">
              <div className="dropglass rounded-[14px] rounded-tl-sm px-4 py-2 text-[13px] max-w-[80%] whitespace-pre-wrap">{m.a}</div>
            </div>
          </div>
        ))}
        {ask.isPending && <div className="text-[12px] text-text-faint italic">Praxis is thinking…</div>}
      </div>
      <Field label="Ask a question">
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Which bundle sold most yesterday?"
            className="flex-1 h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
          />
          <Button variant="primary" onClick={send} disabled={ask.isPending} icon={<Send className="w-4 h-4" />}>
            Ask
          </Button>
        </div>
      </Field>
    </Card>
  );
}
