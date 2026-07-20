import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { formatDate } from "@/lib/format";
import {
  ArrowLeft,
  Phone,
  MessageCircle,
  Mail,
  ExternalLink,
  RotateCcw,
  PenLine,
  Loader2,
  Gem,
  ShoppingBag,
  Clock,
  Award,
  HeartPulse,
  ChevronRight,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button, Pill, Skeleton, MoneyText, EmptyState } from "@/components/ui/primitives";
import { toast } from "@/stores/toast";
import { toastReport } from "@/lib/error-report";
import {
  useContact,
  useContactSummary,
  useDeals,
} from "@/pages/contacts/hooks";
import { useContactTimeline, usePreferences, useMeasurements } from "@/pages/contacts/hooks";
import {
  useContactCrmActivities,
  useTriggerWinBack,
} from "../hooks";
import { ActivityIcon, activityLabel } from "../shared/ActivityIcon";
import { NewDealModal } from "../shared/NewDealModal";
import { ContactLogActivityModal } from "./ContactLogActivityModal";
import { StagePill } from "../shared/StagePill";
import { CrownCustomerPanel } from "@/pages/retention/CrownCustomerPanel";
import { useCrownWallet } from "@/lib/crown-api";
import type { TimelineEvent } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  "#8b9d77",
  "#7a8fa8",
  "#b76e79",
  "#9c7ad9",
  "#5aa0a8",
  "#a8785a",
];

function avatarColor(name: string) {
  return AVATAR_COLORS[
    Math.abs(name.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) %
      AVATAR_COLORS.length
  ];
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function fmtDate(iso: string | null | undefined) {
  return formatDate(iso);
}

function relTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

const CHURN_TONE = {
  low: "success",
  medium: "warn",
  high: "warn",
  critical: "danger",
} as const;

type ProfileTab = "overview" | "purchases" | "deals" | "activity" | "concierge";

const TABS: { key: ProfileTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "purchases", label: "Purchases" },
  { key: "deals", label: "Deals" },
  { key: "activity", label: "Activity" },
  { key: "concierge", label: "Concierge" },
];

// ── Stat card ─────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Gem;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="p-3.5 rounded-[14px] bg-text-primary/[0.03] border hairline">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-[9px] grid place-items-center bg-accent/10 text-accent">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="micro">{label}</span>
      </div>
      <div className="font-display text-xl tabular-nums text-text-primary leading-tight">
        {value}
      </div>
      {sub && <div className="text-[10.5px] text-text-faint mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Purchases list (timeline, commercial events) ──────────────────────────

function PurchasesList({ contactId, limit }: { contactId: string; limit?: number }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useContactTimeline(contactId, {
    category: "commercial",
    page,
    page_size: limit ?? 20,
  });

  if (isLoading)
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[52px] rounded-[12px]" />
        ))}
      </div>
    );
  if (isError)
    return (
      <div className="py-8 text-center">
        <p className="text-[12.5px] text-text-muted mb-3">
          Couldn't load purchases.
        </p>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );

  const events = data?.data ?? [];
  if (events.length === 0)
    return (
      <p className="py-8 text-center text-[12px] italic text-text-faint">
        Nothing yet — their first purchase will appear here automatically.
      </p>
    );

  return (
    <>
      <div className="flex flex-col gap-2">
        {events.map((e: TimelineEvent) => {
          const amount = e.metadata?.amount_ngn as string | number | null;
          return (
            <div
              key={`${e.event_type}-${e.event_id}`}
              className="flex items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.03] border hairline"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium text-text-primary truncate">
                  {e.title}
                </div>
                <div className="text-[10.5px] text-text-faint mt-0.5">
                  {e.event_type.replace(/[._]/g, " ")}
                  {e.detail && ` · ${e.detail.replace(/_/g, " ")}`} ·{" "}
                  {fmtDate(e.event_at)}
                </div>
              </div>
              {amount != null && (
                <span className="text-[12px] font-mono text-text-primary tabular-nums flex-shrink-0">
                  <MoneyText ngn={parseFloat(String(amount))} />
                </span>
              )}
            </div>
          );
        })}
      </div>
      {!limit && data?.meta && (data.meta.has_more || page > 1) && (
        <div className="flex items-center justify-between mt-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!data.meta.has_more}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </>
  );
}

// ── Deals list ────────────────────────────────────────────────────────────

function DealsList({ contactId, contactName }: { contactId: string; contactName: string }) {
  const navigate = useNavigate();
  const [showNewDeal, setShowNewDeal] = useState(false);
  const { data, isLoading } = useDeals({ contact_id: contactId, page_size: 50 });
  const deals = data?.data ?? [];

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button variant="secondary" size="sm" onClick={() => setShowNewDeal(true)}>
          New deal
        </Button>
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[56px] rounded-[12px]" />
          ))}
        </div>
      ) : deals.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="w-5 h-5" />}
          title="No deals yet"
          message="Start a deal to track this client's next opportunity through the pipeline."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {deals.map((d) => (
            <div
              key={d.deal_id}
              onClick={() => navigate(`/crm/deals/${d.deal_id}`)}
              className="flex items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.03] border hairline hover:bg-text-primary/[0.06] transition-colors cursor-pointer group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium text-text-primary truncate">
                  {d.title}
                </div>
                <div className="text-[10.5px] text-text-faint mt-0.5">
                  {d.deal_number} · {fmtDate(d.created_at)}
                </div>
              </div>
              <StagePill
                stageName={
                  d.status === "open"
                    ? (d.current_stage_name ?? "Open")
                    : d.status
                }
              />
              {d.expected_value_ngn && (
                <span className="text-[12px] font-mono text-text-muted tabular-nums flex-shrink-0">
                  <MoneyText ngn={parseFloat(d.expected_value_ngn)} />
                </span>
              )}
              <ChevronRight className="w-4 h-4 text-text-faint opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ))}
        </div>
      )}
      {showNewDeal && (
        <NewDealModal
          contactId={contactId}
          contactName={contactName}
          onClose={() => setShowNewDeal(false)}
          onCreated={(id) => navigate(`/crm/deals/${id}`)}
        />
      )}
    </>
  );
}

// ── Activity list (contact-level log) ─────────────────────────────────────

function ActivityList({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const [showLog, setShowLog] = useState(false);
  const { data: activities = [], isLoading } =
    useContactCrmActivities(contactId);

  return (
    <>
      <div className="flex justify-end mb-3">
        <Button
          variant="secondary"
          size="sm"
          icon={<PenLine className="w-3.5 h-3.5" />}
          onClick={() => setShowLog(true)}
        >
          Log activity
        </Button>
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[56px] rounded-[12px]" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <EmptyState
          icon={<PenLine className="w-5 h-5" />}
          title="No activity logged"
          message="Log calls, WhatsApp chats and emails here so any teammate can pick up where you left off."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {activities.map((a) => (
            <div
              key={a.activity_id}
              className="flex items-start gap-3 p-3 rounded-[12px] bg-text-primary/[0.03] border hairline"
            >
              <ActivityIcon type={a.activity_type} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium text-text-primary">
                  {a.subject || activityLabel(a.activity_type)}
                </div>
                {a.body && (
                  <p className="text-[11.5px] text-text-muted mt-0.5 whitespace-pre-wrap">
                    {a.body}
                  </p>
                )}
                <div className="text-[10.5px] text-text-faint mt-1">
                  {a.direction && `${a.direction} · `}
                  {a.outcome && `${a.outcome.replace(/_/g, " ")} · `}
                  {fmtDate(a.performed_at)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {showLog && (
        <ContactLogActivityModal
          contactId={contactId}
          contactName={contactName}
          onClose={() => setShowLog(false)}
        />
      )}
    </>
  );
}

// ── Concierge (preferences + measurements, read-focused) ─────────────────

function ConciergePanel({ contactId }: { contactId: string }) {
  const { data: prefs, isLoading: loadPrefs } = usePreferences(contactId);
  const { data: measurements = [], isLoading: loadMeas } =
    useMeasurements(contactId);
  const current = measurements.find((m) => m.is_current);

  const prefLines: { label: string; values?: string[] | number[] }[] = prefs
    ? [
        { label: "Textures", values: prefs.preferred_textures },
        { label: "Lace types", values: prefs.preferred_lace_types },
        { label: "Lengths (in)", values: prefs.preferred_lengths_in },
        { label: "Colours", values: prefs.preferred_colours },
        { label: "Cap sizes", values: prefs.preferred_cap_sizes },
        { label: "Use cases", values: prefs.use_cases },
      ].filter((l) => l.values && l.values.length > 0)
    : [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="p-4 rounded-[14px] bg-text-primary/[0.03] border hairline">
        <div className="micro mb-3">Preferences</div>
        {loadPrefs ? (
          <Skeleton className="h-[80px] rounded-[10px]" />
        ) : prefLines.length === 0 ? (
          <p className="text-[12px] italic text-text-faint">
            None recorded — capture sizes, textures and colours as you learn
            them.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {prefLines.map((l) => (
              <div key={l.label} className="flex items-start gap-2">
                <span className="text-[11px] text-text-faint w-24 flex-shrink-0 pt-0.5">
                  {l.label}
                </span>
                <div className="flex flex-wrap gap-1">
                  {l.values!.map((v) => (
                    <span
                      key={String(v)}
                      className="px-2 py-0.5 rounded-[7px] bg-text-primary/[0.06] text-[11px] text-text-primary"
                    >
                      {String(v).replace(/_/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {prefs?.styling_sensitivities && (
              <p className="text-[11px] text-warn mt-1">
                ⚠ {prefs.styling_sensitivities}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="p-4 rounded-[14px] bg-text-primary/[0.03] border hairline">
        <div className="micro mb-3">Current measurements</div>
        {loadMeas ? (
          <Skeleton className="h-[80px] rounded-[10px]" />
        ) : !current ? (
          <p className="text-[12px] italic text-text-faint">
            No measurements on file yet.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-[12px]">
            {[
              ["Circumference", current.circumference_cm],
              ["Ear to ear", current.ear_to_ear_cm],
              ["Forehead–nape", current.forehead_to_nape_cm],
              ["Temple–temple", current.temple_to_temple_cm],
              ["Nape width", current.nape_width_cm],
              ["Hair type", current.natural_hair_type],
            ]
              .filter(([, v]) => v != null)
              .map(([label, v]) => (
                <div key={String(label)}>
                  <span className="text-text-faint">{label}: </span>
                  <span className="text-text-primary font-mono">
                    {String(v)}
                    {typeof v === "string" ? "" : " cm"}
                  </span>
                </div>
              ))}
            <div className="col-span-2 text-[10.5px] text-text-faint mt-1">
              Measured {fmtDate(current.measured_at)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export function ClientProfilePage() {
  const { contactId = "" } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ProfileTab>("overview");
  const winBack = useTriggerWinBack();

  const { data: contact, isLoading, isError, refetch } = useContact(contactId);
  const { data: summary } = useContactSummary(contactId);
  // Cutover: the header stat shows Crowns (shares the panel's query key, so
  // TanStack dedupes to a single request).
  const crownWallet = useCrownWallet(contactId);

  const name = contact?.display_name || "Client";
  useBreadcrumbs([
    { label: "CRM", href: "/crm?tab=clients" },
    { label: contact ? name : "Client" },
  ]);

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <Skeleton className="h-[88px] rounded-[16px] mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[96px] rounded-[14px]" />
          ))}
        </div>
        <Skeleton className="h-[240px] rounded-[16px]" />
      </div>
    );
  }

  if (isError || !contact) {
    return (
      <div className="py-16 text-center animate-fade-in">
        <p className="text-[13px] text-text-muted mb-4">
          Couldn't load this client — they may have been removed, or you may
          not have permission to view them.
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/crm?tab=clients")}
          >
            Back to clients
          </Button>
        </div>
      </div>
    );
  }

  const isNew =
    Date.now() - new Date(contact.created_at).getTime() < 30 * 86_400_000;
  const churnBand = summary?.churn_risk_band ?? null;
  const atRisk = churnBand === "high" || churnBand === "critical";
  const wa = contact.whatsapp_number || contact.primary_phone;

  function fireWinBack() {
    winBack.mutate(contactId, {
      onSuccess: ({ enrolled }) => {
        if (enrolled > 0) {
          toast.success(
            `${name} enrolled in ${enrolled} win-back ${enrolled === 1 ? "journey" : "journeys"}.`,
          );
        } else {
          toast.error("No active win-back strategy", {
            description:
              "Activate one in Retention → Strategies, then try again.",
          });
        }
      },
      onError: (err) =>
        toastReport("CRM → Client profile", "Trigger win-back", err),
    });
  }

  return (
    <div className="animate-fade-in">
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate("/crm?tab=clients")}
        className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary transition-colors mb-4"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Clients
      </button>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div
          className="w-14 h-14 rounded-full grid place-items-center text-lg font-semibold text-white font-display flex-shrink-0"
          style={{ background: avatarColor(name) }}
        >
          {initials(name)}
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-2xl text-text-primary">{name}</h1>
            {contact.priority_level === "vip" && (
              <Pill tone="accent" dot={false}>
                VIP
              </Pill>
            )}
            {isNew && (
              <Pill tone="info" dot>
                NEW
              </Pill>
            )}
            {churnBand && atRisk && (
              <Pill tone={CHURN_TONE[churnBand]} dot={false}>
                {churnBand === "critical" ? "Critical risk" : "At risk"}
              </Pill>
            )}
          </div>
          <div className="text-[11.5px] text-text-faint mt-0.5">
            client since {fmtDate(contact.created_at)}
            {contact.source && ` · via ${contact.source.replace(/_/g, " ")}`}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {contact.primary_phone && (
            <a href={`tel:${contact.primary_phone}`}>
              <Button
                variant="secondary"
                size="sm"
                icon={<Phone className="w-3.5 h-3.5" />}
              >
                Call
              </Button>
            </a>
          )}
          {wa && (
            <a
              href={`https://wa.me/${wa.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
            >
              <Button
                variant="secondary"
                size="sm"
                icon={<MessageCircle className="w-3.5 h-3.5" />}
              >
                WhatsApp
              </Button>
            </a>
          )}
          {contact.email && (
            <a href={`mailto:${contact.email}`}>
              <Button
                variant="secondary"
                size="sm"
                icon={<Mail className="w-3.5 h-3.5" />}
              >
                Email
              </Button>
            </a>
          )}
          {atRisk && (
            <Button
              variant="primary"
              size="sm"
              disabled={winBack.isPending}
              icon={
                winBack.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )
              }
              onClick={fireWinBack}
            >
              Win back
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={<ExternalLink className="w-3.5 h-3.5" />}
            onClick={() => navigate(`/contacts?open=${contactId}`)}
          >
            Full record
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <StatCard
          icon={Gem}
          label="Lifetime spend"
          value={
            <MoneyText ngn={parseFloat(summary?.lifetime_value_ngn ?? "0")} />
          }
        />
        <StatCard
          icon={ShoppingBag}
          label="Purchases"
          value={summary?.total_orders ?? 0}
          sub={summary?.open_deals ? `${summary.open_deals} open deal${summary.open_deals === 1 ? "" : "s"}` : undefined}
        />
        <StatCard
          icon={Clock}
          label="Last activity"
          value={
            summary?.last_activity_at ? relTime(summary.last_activity_at) : "—"
          }
          sub={summary?.last_activity_at ? fmtDate(summary.last_activity_at) : undefined}
        />
        <StatCard
          icon={Award}
          label="Crowns"
          value={`${(crownWallet.data?.state?.current_crowns ?? 0).toLocaleString()}👑`}
          sub={crownWallet.data?.state?.tier_name ?? undefined}
        />
        <StatCard
          icon={HeartPulse}
          label="Churn risk"
          value={
            churnBand ? (
              <span className="capitalize">{churnBand}</span>
            ) : (
              "—"
            )
          }
          sub={
            summary?.churn_risk_score != null
              ? `score ${summary.churn_risk_score}/100`
              : "not scored yet"
          }
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 p-0.5 rounded-[12px] bg-text-primary/[0.04] border hairline mb-5 w-fit max-w-full overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={[
              "px-4 h-[34px] rounded-[10px] text-[12.5px] font-semibold whitespace-nowrap transition-all",
              tab === key
                ? "bg-accent-deep text-[#F4E9D9] shadow-sm"
                : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 p-4 rounded-[14px] bg-text-primary/[0.03] border hairline">
            <div className="micro mb-3">Recent purchases</div>
            <PurchasesList contactId={contactId} limit={5} />
          </div>
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-[14px] bg-text-primary/[0.03] border hairline">
              <div className="micro mb-3">Contact</div>
              <div className="flex flex-col gap-1.5 text-[12px]">
                {contact.primary_phone && (
                  <div className="font-mono text-text-primary">
                    {contact.primary_phone}
                  </div>
                )}
                {contact.email && (
                  <div className="text-text-primary">{contact.email}</div>
                )}
                {contact.instagram_handle && (
                  <div className="text-text-muted">
                    @{contact.instagram_handle}
                  </div>
                )}
                {contact.date_of_birth && (
                  <div className="text-text-muted">
                    🎂{" "}
                    {new Date(contact.date_of_birth).toLocaleDateString(
                      undefined,
                      { day: "numeric", month: "long" },
                    )}
                  </div>
                )}
                {!contact.primary_phone &&
                  !contact.email &&
                  !contact.instagram_handle && (
                    <p className="italic text-text-faint">
                      No contact details on file.
                    </p>
                  )}
              </div>
            </div>
            <CrownCustomerPanel contactId={contactId} />
            <div className="p-4 rounded-[14px] bg-text-primary/[0.03] border hairline">
              <div className="micro mb-3">Latest activity</div>
              <OverviewActivity contactId={contactId} />
            </div>
          </div>
        </div>
      )}
      {tab === "purchases" && <PurchasesList contactId={contactId} />}
      {tab === "deals" && (
        <DealsList contactId={contactId} contactName={name} />
      )}
      {tab === "activity" && (
        <ActivityList contactId={contactId} contactName={name} />
      )}
      {tab === "concierge" && <ConciergePanel contactId={contactId} />}
    </div>
  );
}

function OverviewActivity({ contactId }: { contactId: string }) {
  const { data: activities = [], isLoading } =
    useContactCrmActivities(contactId);
  if (isLoading) return <Skeleton className="h-[60px] rounded-[10px]" />;
  if (activities.length === 0)
    return (
      <p className="text-[12px] italic text-text-faint">
        Nothing logged yet — use the Activity tab to record a call or chat.
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      {activities.slice(0, 3).map((a) => (
        <div key={a.activity_id} className="flex items-center gap-2">
          <ActivityIcon type={a.activity_type} size="sm" />
          <span className="text-[11.5px] text-text-primary truncate flex-1">
            {a.subject || activityLabel(a.activity_type)}
          </span>
          <span className="text-[10px] text-text-faint flex-shrink-0">
            {relTime(a.performed_at)}
          </span>
        </div>
      ))}
    </div>
  );
}
