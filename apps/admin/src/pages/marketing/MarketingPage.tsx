import { useState } from "react";
import { useUrlTab } from "@/hooks/useUrlTab";
import {
  Mail,
  Plus,
  Send,
  CalendarClock,
  Pause,
  Ban,
  Loader2,
  MousePointerClick,
  Eye,
  TrendingUp,
  MessageSquare,
  FileCode2,
  Users,
  Paintbrush,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { useActiveBusiness } from "@/stores/business";
import { useAuthStore } from "@/stores/auth";
import { money, formatDateTime } from "@/lib/format";
import {
  Button,
  Card,
  Pill,
  Skeleton,
  EmptyState,
} from "@/components/ui/primitives";
import { ErrorState, DeniedState, Select, Toggle } from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import {
  useEmailCampaigns,
  useCreateEmailCampaign,
  useEmailSegments,
  useEmailTemplates,
  useEmailStats,
  useCampaignPreview,
  useSendEmailCampaign,
  usePauseEmailCampaign,
  useCancelEmailCampaign,
  useScheduleEmailCampaign,
  EMAIL_STATUS_TONE,
  type EmailCampaign,
  type EmailCampaignType,
} from "@/lib/marketing-api";
import { TemplatesTab, SegmentsTab, DesignTab } from "./EmailExtras";
import {
  CampaignAudienceSection,
  CampaignSaleSection,
  CampaignVariantsSection,
} from "./EmailExtras";

/**
 * Marketing (`/marketing`, canon §6.16) — email campaigns only.
 *
 * Four surfaces, one per tab:
 *   • Campaigns — build, schedule, send; open one to see the exact mail that
 *     went out plus its performance.
 *   • Templates — the Gmail-style mail editor (rich text + personalise pills).
 *   • Segments — saved audiences with a live "who's in" preview.
 *   • Design — the brand header/footer wrapped around every mail.
 *
 * Everything is gated on `email_campaigns:*`. Mobile-first throughout.
 */

type Tab = "campaigns" | "templates" | "segments" | "design";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "campaigns", label: "Campaigns", icon: <Mail className="w-4 h-4" /> },
  { key: "templates", label: "Templates", icon: <FileCode2 className="w-4 h-4" /> },
  { key: "segments", label: "Segments", icon: <Users className="w-4 h-4" /> },
  { key: "design", label: "Design", icon: <Paintbrush className="w-4 h-4" /> },
];

export function MarketingPage() {
  useBreadcrumbs([{ label: "Marketing" }]);
  const { can } = useAuthStore();
  const [tab, setTab] = useUrlTab<Tab>("campaigns", [
    "campaigns",
    "templates",
    "segments",
    "design",
  ]);

  if (!can("email_campaigns", "view")) {
    return <DeniedState message="You don't have access to Marketing." />;
  }

  return (
    <div className="max-w-[1180px] space-y-5">
      <ModuleInsights module="marketing" />
      <nav className="flex items-center gap-1 border-b border-line overflow-x-auto hide-scrollbar -mx-1 px-1">
        {TABS.map((t) => (
          <TabButton
            key={t.key}
            active={tab === t.key}
            onClick={() => setTab(t.key)}
            icon={t.icon}
          >
            {t.label}
          </TabButton>
        ))}
      </nav>

      {tab === "campaigns" && <CampaignsTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "segments" && <SegmentsTab />}
      {tab === "design" && <DesignTab />}
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
      className={`inline-flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap shrink-0 transition-colors ${
        active
          ? "border-accent text-accent-glow"
          : "border-transparent text-text-muted hover:text-text-primary"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════
// CAMPAIGNS
// ════════════════════════════════════════════════════════════

function CampaignsTab() {
  const { can } = useAuthStore();
  const [status, setStatus] = useState<string>("");
  const campaignsQ = useEmailCampaigns(status || undefined);
  const [building, setBuilding] = useState(false);
  const [detail, setDetail] = useState<EmailCampaign | null>(null);
  const campaigns = campaignsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="w-44 max-sm:w-full">
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
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setBuilding(true)}
          >
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
              <Button
                variant="primary"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setBuilding(true)}
              >
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
                  <span className="font-medium text-[14px] truncate">
                    {c.campaign_name}
                  </span>
                  <Pill tone={EMAIL_STATUS_TONE[c.status] ?? "neutral"}>
                    {c.status}
                  </Pill>
                </div>
                <p className="text-[11.5px] text-text-faint mt-0.5">
                  {c.campaign_type ?? "one_off"}
                  {c.scheduled_for &&
                    ` · scheduled ${formatDateTime(c.scheduled_for)}`}
                </p>
              </div>
              <Mail className="w-4 h-4 text-text-faint shrink-0" />
            </button>
          ))}
        </Card>
      )}

      {building && <CampaignBuilder onClose={() => setBuilding(false)} />}
      {detail && (
        <CampaignDetail campaign={detail} onClose={() => setDetail(null)} />
      )}
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
        scheduled_for: scheduledFor
          ? new Date(scheduledFor).toISOString()
          : undefined,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="New campaign"
      subtitle="Audience · template · channels · schedule"
    >
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

        <Labelled label="Template (the mail that goes out)">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

        {create.isError && (
          <p className="text-[12px] text-danger">Couldn&rsquo;t create the campaign.</p>
        )}

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

/** The exact mail this campaign sends (or sent) — rendered by the same
 *  pipeline as the live send, shown before anything else. */
function CampaignMailSection({ campaign }: { campaign: EmailCampaign }) {
  const previewQ = useCampaignPreview(campaign.campaign_id);
  const wasSent =
    campaign.status === "sent" ||
    campaign.status === "sending" ||
    campaign.status === "completed";

  return (
    <div>
      <div className="micro mb-2">{wasSent ? "The mail that went out" : "The mail"}</div>
      {previewQ.isLoading ? (
        <Skeleton style={{ height: 260 }} />
      ) : previewQ.isError || !previewQ.data ? (
        <div className="rounded-[13px] border border-line p-4 text-[12.5px] text-text-muted">
          No mail to show yet — pick a template for this campaign first.
        </div>
      ) : (
        <div className="rounded-[13px] border border-line overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-line bg-text-primary/[0.02]">
            <div className="text-[13px] font-medium truncate">
              {previewQ.data.subject}
            </div>
            <div className="text-[11px] text-text-faint mt-0.5">
              {previewQ.data.sample_recipient.is_real
                ? `as received by ${previewQ.data.sample_recipient.name || previewQ.data.sample_recipient.email}`
                : "shown with sample customer details"}
            </div>
          </div>
          <iframe
            title="Campaign mail"
            sandbox=""
            srcDoc={previewQ.data.html}
            className="w-full h-[420px] md:h-[520px] bg-white"
          />
        </div>
      )}
    </div>
  );
}

function CampaignDetail({
  campaign,
  onClose,
}: {
  campaign: EmailCampaign;
  onClose: () => void;
}) {
  const { can } = useAuthStore();
  const statsQ = useEmailStats(campaign.campaign_id);
  const send = useSendEmailCampaign();
  const pause = usePauseEmailCampaign();
  const cancel = useCancelEmailCampaign();
  const schedule = useScheduleEmailCampaign();
  const stats = statsQ.data;
  const [when, setWhen] = useState("");

  const canEdit = can("email_campaigns", "edit");
  const canApprove = can("email_campaigns", "approve");
  const wasSent =
    campaign.status === "sent" ||
    campaign.status === "sending" ||
    campaign.status === "completed";

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={campaign.campaign_name}
      subtitle={campaign.campaign_type}
    >
      <div className="space-y-4 p-1">
        <Pill tone={EMAIL_STATUS_TONE[campaign.status] ?? "neutral"}>
          {campaign.status}
        </Pill>

        {/* The mail itself — front and centre */}
        <CampaignMailSection campaign={campaign} />

        {wasSent && (
          <div>
            <div className="micro mb-2">Performance</div>
            {statsQ.isLoading ? (
              <Skeleton style={{ height: 60 }} />
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <Stat icon={<Send className="w-3.5 h-3.5" />} label="Sent" value={stats?.totals?.sent ?? 0} />
                  <Stat icon={<Eye className="w-3.5 h-3.5" />} label="Delivered" value={stats?.totals?.delivered ?? 0} />
                  <Stat icon={<Eye className="w-3.5 h-3.5" />} label="Opened" value={stats?.totals?.opened ?? 0} />
                  <Stat icon={<MousePointerClick className="w-3.5 h-3.5" />} label="Clicked" value={stats?.totals?.clicked ?? 0} />
                  <Stat icon={<Ban className="w-3.5 h-3.5" />} label="Bounced" value={stats?.totals?.bounced ?? 0} />
                  <Stat icon={<Ban className="w-3.5 h-3.5" />} label="Unsub" value={stats?.totals?.unsubscribed ?? 0} />
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <Stat icon={<TrendingUp className="w-3.5 h-3.5" />} label="Open %" value={stats?.rates?.open_rate_pct ?? 0} suffix="%" />
                  <Stat icon={<TrendingUp className="w-3.5 h-3.5" />} label="Click %" value={stats?.rates?.click_rate_pct ?? 0} suffix="%" />
                  <Stat icon={<TrendingUp className="w-3.5 h-3.5" />} label="Bounce %" value={stats?.rates?.bounce_rate_pct ?? 0} suffix="%" />
                </div>
                {stats?.conversions && (stats.conversions.count ?? 0) > 0 && (
                  <p className="text-[12px] text-text-muted mt-2">
                    {stats.conversions.count} conversions · {money(stats.conversions.revenue_ngn ?? 0)} revenue
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <CampaignAudienceSection campaign={campaign} />
        <CampaignSaleSection campaign={campaign} />
        <CampaignVariantsSection campaign={campaign} />

        {campaign.reply_to_email && (
          <p className="text-[12px] text-text-faint">
            Replies thread to{" "}
            <span className="font-mono text-text-muted">{campaign.reply_to_email}</span>.
          </p>
        )}

        {canEdit && (campaign.status === "draft" || campaign.status === "scheduled") && (
          <div className="rounded-xl border border-line p-3 space-y-2">
            <div className="micro">Schedule</div>
            <div className="flex flex-col sm:flex-row gap-2">
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
                  schedule.mutate({
                    id: campaign.campaign_id,
                    scheduled_for: new Date(when).toISOString(),
                  })
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
      className={`w-full rounded-[11px] bg-text-primary/[0.04] border border-line px-3 h-[42px] text-[13px] outline-none focus:border-accent/50 ${mono ? "font-mono text-[12px]" : ""}`} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
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
