import { useMemo, useState } from "react";
import {
  Mail,
  BarChart3,
  Plus,
  Send,
  CalendarClock,
  Pause,
  Ban,
  Loader2,
  Plug,
  Trash2,
  MousePointerClick,
  Eye,
  TrendingUp,
  MessageSquare,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useActiveBusiness } from "@/stores/business";
import { useAuthStore } from "@/stores/auth";
import { money, moneyCompact } from "@/lib/format";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
  KpiTile,
} from "@/components/ui/primitives";
import {
  ErrorState,
  DeniedState,
  Select,
  Toggle,
} from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  useEmailCampaigns,
  useCreateEmailCampaign,
  useEmailSegments,
  useEmailTemplates,
  useEmailStats,
  useSendEmailCampaign,
  usePauseEmailCampaign,
  useCancelEmailCampaign,
  useScheduleEmailCampaign,
  useAdAccounts,
  useConnectAdAccount,
  useRevokeAdAccount,
  useAdCampaigns,
  useCreateAdCampaign,
  useSetAdCampaignStatus,
  useAttribution,
  EMAIL_STATUS_TONE,
  AD_STATUS_TONE,
  AD_PLATFORM_LABEL,
  type EmailCampaign,
  type EmailCampaignType,
  type AdPlatform,
  type AdStatus,
  type AttributionRow,
} from "@/lib/marketing-api";

/**
 * Marketing & Email Campaigns (`/marketing`, canon §6.15/§6.16).
 *
 * Two surfaces under one module:
 *   • Email — campaign builder (always email; optional WhatsApp companion),
 *     list, templates, segments.
 *   • Ads — accounts, campaigns and the spend-vs-revenue attribution report.
 *
 * Email tab is gated on `email_campaigns:*`; Ads tab on `ad_analytics:*`.
 */

type Tab = "email" | "ads";

export function MarketingPage() {
  useBreadcrumbs([{ label: "Marketing" }]);
  const { can } = useAuthStore();

  const canEmail = can("email_campaigns", "view");
  const canAds = can("ad_analytics", "view");
  const [tab, setTab] = useState<Tab>(canEmail ? "email" : "ads");

  if (!canEmail && !canAds) {
    return <DeniedState message="You don't have access to Marketing." />;
  }

  return (
    <div className="max-w-[1180px] space-y-5">
      <nav className="flex items-center gap-1 border-b border-line">
        {canEmail && (
          <TabButton active={tab === "email"} onClick={() => setTab("email")} icon={<Mail className="w-4 h-4" />}>
            Email Campaigns
          </TabButton>
        )}
        {canAds && (
          <TabButton active={tab === "ads"} onClick={() => setTab("ads")} icon={<BarChart3 className="w-4 h-4" />}>
            Ad Analytics
          </TabButton>
        )}
      </nav>

      {tab === "email" && canEmail ? <EmailTab /> : null}
      {tab === "ads" && canAds ? <AdsTab /> : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
        active ? "border-accent text-accent-glow" : "border-transparent text-text-muted hover:text-text-primary"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════
// EMAIL
// ════════════════════════════════════════════════════════════

function EmailTab() {
  const { can } = useAuthStore();
  const [status, setStatus] = useState<string>("");
  const campaignsQ = useEmailCampaigns(status || undefined);
  const [building, setBuilding] = useState(false);
  const [detail, setDetail] = useState<EmailCampaign | null>(null);
  const campaigns = campaignsQ.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="w-44">
          <Select
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "All statuses" },
              { value: "draft", label: "Draft" },
              { value: "scheduled", label: "Scheduled" },
              { value: "sending", label: "Sending" },
              { value: "sent", label: "Sent" },
              { value: "completed", label: "Completed" },
            ]}
          />
        </div>
        {can("email_campaigns", "create") && (
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setBuilding(true)}>
            New campaign
          </Button>
        )}
      </div>

      {campaignsQ.isLoading ? (
        <ListSkeleton />
      ) : campaignsQ.isError ? (
        <ErrorState onRetry={() => campaignsQ.refetch()} />
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={<Mail className="w-7 h-7" />}
          title="No email campaigns"
          message="Build your first campaign — pick an audience and a template, then schedule the send."
          action={
            can("email_campaigns", "create") ? (
              <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setBuilding(true)}>
                New campaign
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          {campaigns.map((c, i) => (
            <button
              key={c.campaign_id}
              onClick={() => setDetail(c)}
              className={`w-full text-left p-4 flex items-center gap-3 hover:bg-text-primary/[0.03] transition-colors ${
                i < campaigns.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-[14px] truncate">{c.campaign_name}</span>
                  <Pill tone={EMAIL_STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Pill>
                </div>
                <p className="text-[11.5px] text-text-faint mt-0.5">
                  {c.campaign_type ?? "one_off"}
                  {c.scheduled_for && ` · scheduled ${new Date(c.scheduled_for).toLocaleString()}`}
                </p>
              </div>
              <Mail className="w-4 h-4 text-text-faint shrink-0" />
            </button>
          ))}
        </Card>
      )}

      {building && <CampaignBuilder onClose={() => setBuilding(false)} />}
      {detail && <CampaignDetail campaign={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function CampaignBuilder({ onClose }: { onClose: () => void }) {
  const create = useCreateEmailCampaign();
  const business = useActiveBusiness();
  const segmentsQ = useEmailSegments();
  const templatesQ = useEmailTemplates();
  const segments = segmentsQ.data ?? [];
  const templates = templatesQ.data ?? [];

  const domain = brandDomain(business.key);
  const [name, setName] = useState("");
  const [type, setType] = useState<EmailCampaignType>("one_off");
  const [segmentId, setSegmentId] = useState("");
  const [templateId, setTemplateId] = useState("");
  // Prefill the sender identity from the active brand. From is the brand's
  // noreply@ mailbox; Reply-To is the monitored sales@ inbox so replies thread
  // back into the conversation (EMAIL_TWO_WAY_SETUP).
  const [fromName, setFromName] = useState(business.name);
  const [fromEmail, setFromEmail] = useState(`noreply@${domain}`);
  const [replyTo, setReplyTo] = useState(`sales@${domain}`);
  const [scheduledFor, setScheduledFor] = useState("");
  const [whatsapp, setWhatsapp] = useState(false);

  function submit() {
    create.mutate(
      {
        campaign_name: name,
        campaign_type: type,
        segment_id: segmentId || undefined,
        default_template_id: templateId || undefined,
        from_name: fromName || undefined,
        from_email: fromEmail || undefined,
        reply_to_email: replyTo || undefined,
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : undefined,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Drawer open onClose={onClose} title="New campaign" subtitle="Audience · template · channels · schedule">
      <div className="space-y-4 p-1">
        <Labelled label="Campaign name">
          <TextInput value={name} onChange={setName} placeholder="June drop announcement" />
        </Labelled>

        <Labelled label="Type">
          <Select
            value={type}
            onChange={(v) => setType(v as EmailCampaignType)}
            options={[
              { value: "one_off", label: "One-off" },
              { value: "recurring", label: "Recurring" },
              { value: "triggered", label: "Triggered" },
              { value: "milestone", label: "Milestone" },
              { value: "ab_test", label: "A/B test" },
            ]}
          />
        </Labelled>

        <Labelled label="Audience segment">
          <Select
            value={segmentId}
            onChange={setSegmentId}
            options={[
              { value: "", label: segments.length ? "Choose a segment…" : "No segments yet" },
              ...segments.map((s) => ({ value: s.segment_id, label: s.name })),
            ]}
          />
        </Labelled>

        <Labelled label="Template">
          <Select
            value={templateId}
            onChange={setTemplateId}
            options={[
              { value: "", label: templates.length ? "Choose a template…" : "No templates yet" },
              ...templates.map((t) => ({ value: t.template_id, label: t.display_name })),
            ]}
          />
        </Labelled>

        {/* Channel selection — email is mandatory, WhatsApp optional */}
        <div className="rounded-xl border border-line bg-text-primary/[0.02] p-3.5 space-y-3">
          <div className="micro">Channels</div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px]">
              <Mail className="w-4 h-4 text-accent-glow" />
              Email
              <span className="text-[10px] uppercase tracking-widest text-text-faint">required</span>
            </div>
            <Toggle checked disabled onChange={() => {}} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px]">
              <MessageSquare className="w-4 h-4 text-text-muted" />
              WhatsApp companion
            </div>
            <Toggle checked={whatsapp} onChange={setWhatsapp} />
          </div>
          {whatsapp && (
            <p className="text-[11.5px] text-warn">
              WhatsApp delivery requires a connected WhatsApp account (Settings →
              Messaging Accounts). Email is always sent regardless.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Labelled label="From name">
            <TextInput value={fromName} onChange={setFromName} placeholder="Pixie Girl" />
          </Labelled>
          <Labelled label="From email">
            <TextInput value={fromEmail} onChange={setFromEmail} placeholder="noreply@brand.com" mono />
          </Labelled>
        </div>
        <Labelled label="Reply-To (customer replies thread back here)">
          <TextInput value={replyTo} onChange={setReplyTo} placeholder="sales@brand.com" mono />
        </Labelled>

        <Labelled label="Schedule for (optional)">
          <input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className="w-full h-[42px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50"
          />
        </Labelled>

        {create.isError && <p className="text-[12px] text-danger">Couldn&rsquo;t create the campaign.</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!name || create.isPending}
            onClick={submit}
            icon={create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          >
            Create campaign
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function CampaignDetail({ campaign, onClose }: { campaign: EmailCampaign; onClose: () => void }) {
  const { can } = useAuthStore();
  const statsQ = useEmailStats(campaign.campaign_id);
  const send = useSendEmailCampaign();
  const pause = usePauseEmailCampaign();
  const cancel = useCancelEmailCampaign();
  const schedule = useScheduleEmailCampaign();
  const stats = statsQ.data ?? {};
  const [when, setWhen] = useState("");

  const canEdit = can("email_campaigns", "edit");
  const canApprove = can("email_campaigns", "approve");

  return (
    <Drawer open onClose={onClose} title={campaign.campaign_name} subtitle={campaign.campaign_type}>
      <div className="space-y-4 p-1">
        <Pill tone={EMAIL_STATUS_TONE[campaign.status] ?? "neutral"}>{campaign.status}</Pill>

        <div>
          <div className="micro mb-2">Performance</div>
          {statsQ.isLoading ? (
            <Skeleton style={{ height: 60 }} />
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <Stat icon={<Send className="w-3.5 h-3.5" />} label="Delivered" value={stats.delivered ?? 0} />
              <Stat icon={<Eye className="w-3.5 h-3.5" />} label="Opened" value={stats.opened ?? 0} />
              <Stat icon={<MousePointerClick className="w-3.5 h-3.5" />} label="Clicked" value={stats.clicked ?? 0} />
              <Stat icon={<Ban className="w-3.5 h-3.5" />} label="Bounced" value={stats.bounced ?? 0} />
              <Stat icon={<Ban className="w-3.5 h-3.5" />} label="Unsub" value={stats.unsubscribed ?? 0} />
              <Stat
                icon={<TrendingUp className="w-3.5 h-3.5" />}
                label="Open %"
                value={Math.round((stats.open_rate ?? 0) * 100)}
                suffix="%"
              />
            </div>
          )}
        </div>

        {campaign.reply_to_email && (
          <p className="text-[12px] text-text-faint">
            Replies thread to <span className="font-mono text-text-muted">{campaign.reply_to_email}</span>.
          </p>
        )}

        {canEdit && (campaign.status === "draft" || campaign.status === "scheduled") && (
          <div className="rounded-xl border border-line p-3 space-y-2">
            <div className="micro">Schedule</div>
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="flex-1 h-[40px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] outline-none focus:border-accent/50"
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={!when || schedule.isPending}
                onClick={() =>
                  schedule.mutate({ id: campaign.campaign_id, scheduled_for: new Date(when).toISOString() })
                }
                icon={<CalendarClock className="w-4 h-4" />}
              >
                Set
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {canEdit && (campaign.status === "sending" || campaign.status === "scheduled") && (
            <Button variant="secondary" onClick={() => pause.mutate(campaign.campaign_id)} icon={<Pause className="w-4 h-4" />}>
              Pause
            </Button>
          )}
          {canEdit && campaign.status !== "sent" && campaign.status !== "cancelled" && (
            <Button variant="danger" onClick={() => cancel.mutate(campaign.campaign_id)} icon={<Ban className="w-4 h-4" />}>
              Cancel
            </Button>
          )}
          {canApprove && (campaign.status === "draft" || campaign.status === "scheduled") && (
            <Button
              variant="primary"
              disabled={send.isPending}
              onClick={() => send.mutate(campaign.campaign_id, { onSuccess: onClose })}
              icon={send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            >
              Send now
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

// ════════════════════════════════════════════════════════════
// ADS
// ════════════════════════════════════════════════════════════

function AdsTab() {
  const { can } = useAuthStore();
  const accountsQ = useAdAccounts();
  const campaignsQ = useAdCampaigns();
  const attributionQ = useAttribution();
  const [connecting, setConnecting] = useState(false);
  const [creating, setCreating] = useState(false);

  const accounts = accountsQ.data ?? [];
  const campaigns = campaignsQ.data?.data ?? [];
  const report = attributionQ.data;
  const rows: AttributionRow[] = report?.ads ?? report?.rows ?? [];

  const totals = useMemo(() => {
    return rows.reduce(
      (a, r) => ({
        spend: a.spend + (r.spend_ngn ?? 0),
        clicks: a.clicks + (r.clicks ?? 0),
        conversions: a.conversions + (r.conversions ?? 0),
        revenue: a.revenue + (r.revenue_ngn ?? 0),
      }),
      { spend: 0, clicks: 0, conversions: 0, revenue: 0 },
    );
  }, [rows]);
  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;

  const setStatus = useSetAdCampaignStatus();

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile label="Ad spend" value={moneyCompact(totals.spend)} />
        <KpiTile label="Attributed revenue" value={moneyCompact(totals.revenue)} />
        <KpiTile label="ROAS" value={`${roas.toFixed(2)}×`} tone={roas >= 1 ? "accent" : "warn"} />
        <KpiTile label="Conversions" value={totals.conversions.toLocaleString()} />
      </div>

      {/* Accounts */}
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-display text-[15px]">Ad accounts</h3>
          {can("ad_analytics", "create") && (
            <Button size="sm" variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={() => setConnecting(true)}>
              Connect
            </Button>
          )}
        </div>
        <Card className="p-0 overflow-hidden">
          {accountsQ.isLoading ? (
            <div className="p-5"><Skeleton style={{ height: 18, width: "40%" }} /></div>
          ) : accounts.length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">
              No ad accounts connected.
            </p>
          ) : (
            accounts.map((a, i) => (
              <div key={a.ad_account_id} className={`p-4 flex items-center gap-3 ${i < accounts.length - 1 ? "border-b border-line" : ""}`}>
                <span className="text-[11px] font-bold uppercase tracking-wide text-accent-glow bg-accent/[0.1] rounded-md px-2 py-1">
                  {AD_PLATFORM_LABEL[a.platform]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[13.5px] truncate">{a.display_name}</div>
                  <div className="text-[11.5px] text-text-faint font-mono truncate">{a.external_account_id}</div>
                </div>
                <span className="text-[11.5px] text-text-faint">{a.currency}</span>
                {can("ad_analytics", "delete") && (
                  <AdAccountDelete id={a.ad_account_id} name={a.display_name} />
                )}
              </div>
            ))
          )}
        </Card>
      </section>

      {/* Campaigns */}
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-display text-[15px]">Campaigns</h3>
          {can("ad_analytics", "create") && accounts.length > 0 && (
            <Button size="sm" variant="secondary" icon={<Plus className="w-4 h-4" />} onClick={() => setCreating(true)}>
              New campaign
            </Button>
          )}
        </div>
        <Card className="p-0 overflow-hidden">
          {campaignsQ.isLoading ? (
            <div className="p-5"><Skeleton style={{ height: 18, width: "40%" }} /></div>
          ) : campaigns.length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">No campaigns recorded.</p>
          ) : (
            campaigns.map((c, i) => (
              <div key={c.ad_campaign_id} className={`p-4 flex items-center gap-3 ${i < campaigns.length - 1 ? "border-b border-line" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[13.5px] truncate">{c.name}</span>
                    <Pill tone={AD_STATUS_TONE[c.status] ?? "neutral"} dot={false}>{c.status}</Pill>
                  </div>
                  <div className="text-[11.5px] text-text-faint">
                    {AD_PLATFORM_LABEL[c.platform]}
                    {c.budget_amount != null && ` · budget ${money(c.budget_amount, c.budget_currency ?? "NGN")}`}
                  </div>
                </div>
                {can("ad_analytics", "edit") && (
                  <div className="w-32">
                    <Select
                      value={c.status}
                      onChange={(v) => setStatus.mutate({ id: c.ad_campaign_id, status: v as AdStatus })}
                      options={(["draft", "active", "paused", "ended", "removed"] as AdStatus[]).map((s) => ({ value: s, label: s }))}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </Card>
      </section>

      {/* Attribution table */}
      <section>
        <h3 className="font-display text-[15px] mb-2.5">Attribution — spend vs revenue</h3>
        {attributionQ.isLoading ? (
          <ListSkeleton />
        ) : rows.length === 0 ? (
          <Card className="p-6 text-center text-[12.5px] text-text-faint italic">
            No attribution data for this period yet.
          </Card>
        ) : (
          <Card className="p-0 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-text-faint text-[10.5px] uppercase tracking-widest border-b border-line">
                  <th className="text-left font-semibold p-3">Campaign</th>
                  <th className="text-right font-semibold p-3">Spend</th>
                  <th className="text-right font-semibold p-3">Clicks</th>
                  <th className="text-right font-semibold p-3">Conv.</th>
                  <th className="text-right font-semibold p-3">Revenue</th>
                  <th className="text-right font-semibold p-3">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rr = r.spend_ngn > 0 ? (r.revenue_ngn ?? 0) / r.spend_ngn : 0;
                  return (
                    <tr key={r.ad_campaign_id} className="border-b border-line last:border-0">
                      <td className="p-3">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-[10.5px] text-text-faint">{AD_PLATFORM_LABEL[r.platform]}</div>
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{money(r.spend_ngn ?? 0)}</td>
                      <td className="p-3 text-right tabular-nums">{(r.clicks ?? 0).toLocaleString()}</td>
                      <td className="p-3 text-right tabular-nums">{(r.conversions ?? 0).toLocaleString()}</td>
                      <td className="p-3 text-right font-mono tabular-nums">{money(r.revenue_ngn ?? 0)}</td>
                      <td className={`p-3 text-right tabular-nums font-semibold ${rr >= 1 ? "text-success" : "text-warn"}`}>
                        {rr.toFixed(2)}×
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {connecting && <ConnectAdAccountDrawer onClose={() => setConnecting(false)} />}
      {creating && <AdCampaignDrawer onClose={() => setCreating(false)} />}
    </div>
  );
}

function AdAccountDelete({ id, name }: { id: string; name: string }) {
  const revoke = useRevokeAdAccount();
  return (
    <button
      onClick={() => window.confirm(`Disconnect ${name}?`) && revoke.mutate(id)}
      className="rounded-lg bg-panel-2 border border-line p-1.5 hover:border-danger/40"
      title="Disconnect"
    >
      <Trash2 className="w-3.5 h-3.5 text-text-muted hover:text-danger" />
    </button>
  );
}

function ConnectAdAccountDrawer({ onClose }: { onClose: () => void }) {
  const connect = useConnectAdAccount();
  const [platform, setPlatform] = useState<AdPlatform>("meta_ads");
  const [externalId, setExternalId] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("NGN");

  return (
    <Drawer open onClose={onClose} title="Connect ad account" subtitle="Google Ads / Meta Ads">
      <div className="space-y-4 p-1">
        <Labelled label="Platform">
          <Select
            value={platform}
            onChange={(v) => setPlatform(v as AdPlatform)}
            options={[
              { value: "meta_ads", label: "Meta Ads" },
              { value: "google_ads", label: "Google Ads" },
            ]}
          />
        </Labelled>
        <Labelled label="External account ID">
          <TextInput value={externalId} onChange={setExternalId} placeholder="act_123456789" mono />
        </Labelled>
        <Labelled label="Display name">
          <TextInput value={name} onChange={setName} placeholder="Pixie Girl — Meta" />
        </Labelled>
        <Labelled label="Currency">
          <TextInput value={currency} onChange={setCurrency} placeholder="NGN" mono />
        </Labelled>
        {connect.isError && <p className="text-[12px] text-danger">Couldn&rsquo;t connect.</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!externalId || !name || connect.isPending}
            onClick={() =>
              connect.mutate(
                { platform, external_account_id: externalId, display_name: name, currency },
                { onSuccess: onClose },
              )
            }
            icon={connect.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />}
          >
            Connect
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function AdCampaignDrawer({ onClose }: { onClose: () => void }) {
  const create = useCreateAdCampaign();
  const accountsQ = useAdAccounts();
  const accounts = accountsQ.data ?? [];
  const [accountId, setAccountId] = useState(accounts[0]?.ad_account_id ?? "");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [budget, setBudget] = useState("");
  const [externalId, setExternalId] = useState("");

  const account = accounts.find((a) => a.ad_account_id === accountId) ?? accounts[0];

  return (
    <Drawer open onClose={onClose} title="New ad campaign" subtitle="Record or push a campaign">
      <div className="space-y-4 p-1">
        <Labelled label="Ad account">
          <Select
            value={accountId || account?.ad_account_id || ""}
            onChange={setAccountId}
            options={accounts.map((a) => ({ value: a.ad_account_id, label: `${a.display_name} · ${AD_PLATFORM_LABEL[a.platform]}` }))}
          />
        </Labelled>
        <Labelled label="Campaign name">
          <TextInput value={name} onChange={setName} placeholder="Retarget — June" />
        </Labelled>
        <Labelled label="Objective">
          <TextInput value={objective} onChange={setObjective} placeholder="conversions" />
        </Labelled>
        <Labelled label="External campaign ID (required unless pushing)">
          <TextInput value={externalId} onChange={setExternalId} placeholder="1203948…" mono />
        </Labelled>
        <Labelled label="Daily budget">
          <TextInput value={budget} onChange={(v) => setBudget(v.replace(/[^0-9.]/g, ""))} placeholder="50000" mono />
        </Labelled>
        {create.isError && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t create. An external campaign ID is required.</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!account || !name || !externalId || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  ad_account_id: account!.ad_account_id,
                  platform: account!.platform,
                  name,
                  objective: objective || undefined,
                  external_campaign_id: externalId || undefined,
                  budget_amount: budget ? Number(budget) : undefined,
                  budget_currency: account!.currency,
                },
                { onSuccess: onClose },
              )
            }
            icon={create.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          >
            Create
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

// ── Shared bits ─────────────────────────────────────────────

function Stat({ icon, label, value, suffix }: { icon: React.ReactNode; label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-lg border border-line bg-text-primary/[0.02] p-2.5">
      <div className="flex items-center gap-1.5 text-text-faint text-[10.5px] uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="font-display text-[18px] tabular-nums mt-0.5">
        {value.toLocaleString()}
        {suffix}
      </div>
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 ${mono ? "font-mono text-[12px]" : ""}`}
    />
  );
}

function ListSkeleton() {
  return (
    <Card className="p-4 space-y-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} style={{ height: 44 }} />
      ))}
    </Card>
  );
}

/** The public email domain for a brand. Used to prefill the sender (noreply@)
 *  and the conversational Reply-To (sales@) in the campaign builder. */
function brandDomain(brandKey: string): string {
  const map: Record<string, string> = {
    pixiegirl: "pixiegirlglobal.com",
    faitlynhair: "faitlynhair.com",
  };
  return map[brandKey] ?? `${brandKey}.com`;
}
