import { useState } from "react";
import {
  MessageCircle,
  Phone,
  Mail,
  Package,
  Activity,
  ExternalLink,
  Plus,
  Trash2,
  CheckCircle,
  Clock,
  PenLine,
} from "lucide-react";
import {
  Button,
  Pill,
  Skeleton,
  MoneyText,
  type Tone,
} from "@/components/ui/primitives";
import { StaticMapImage } from "@/components/ui/AddressAutocomplete";
import {
  useContact,
  useContactSummary,
  useContactTimeline,
  useAddresses,
  useDeals,
  usePreferences,
  useMeasurements,
  useDeleteAddress,
} from "./hooks";
import { ContactFormModal } from "./ContactFormModal";
import { AddressFormModal } from "./AddressFormModal";
import { LogActivityModal } from "./LogActivityModal";
import { LoyaltyTab } from "./LoyaltyTab";
import { TagPicker } from "./TagPicker";
import type {
  Contact,
  Deal,
  TimelineEvent,
  PriorityLevel,
  ContactType,
} from "./types";
import { Link } from "react-router-dom";
import {
  Briefcase,
  ShoppingCart,
  ArrowUpRight,
  Scissors,
  Sparkles,
  Award,
  Wallet,
} from "lucide-react";
import {
  profileTabsFor,
  PROFILE_TAB_LABELS,
  type ProfileTabKey,
} from "./stakeholders";
import {
  useStylistByContact,
  useStylistCertifications,
  useStylistPayouts,
  useStylistAssignments,
  useCreateStylist,
  usePromoteAmbassador,
  useDemoteAmbassador,
} from "./programmesApi";

// ── Helpers (shared with the drawer header) ────────────────────────────────

export const TYPE_LABELS: Record<ContactType, string> = {
  customer: "Client",
  supplier: "Supplier",
  staff: "Employee",
  subscriber: "Subscriber",
  retail_partner: "Stylist Partner",
  stylist_partner: "Stylist Partner",
};

export const PRIORITY_TONE: Record<PriorityLevel, Tone> = {
  vip: "accent",
  regular: "neutral",
  new: "info",
};

const GENDER_LABEL: Record<string, string> = {
  F: "Female",
  M: "Male",
  other: "Non-binary / Other",
  prefer_not: "Prefer not to say",
};

const RISK_TONE: Record<string, Tone> = {
  low: "success",
  medium: "warn",
  high: "danger",
  critical: "danger",
};

const DEAL_STATUS_TONE: Record<string, Tone> = {
  open: "info",
  won: "success",
  lost: "danger",
  on_hold: "warn",
  cancelled: "neutral",
};

export const AVATAR_COLORS = [
  "#8b9d77",
  "#7a8fa8",
  "#b76e79",
  "#9c7ad9",
  "#5aa0a8",
];

export function bigInitials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
  });
}

// ── Message button ────────────────────────────────────────────────────────

export function MessageButton({ contact }: { contact: Contact }) {
  const hasWhatsApp = !!contact.whatsapp_number;
  const hasPhone = !!contact.primary_phone;
  const hasEmail = !!contact.email;

  const handleMessage = () => {
    if (hasWhatsApp) {
      const num = contact.whatsapp_number!.replace(/\D/g, "");
      window.open(`https://wa.me/${num}`, "_blank");
    } else if (hasPhone) {
      window.location.href = `tel:${contact.primary_phone}`;
    } else if (hasEmail) {
      window.location.href = `mailto:${contact.email}`;
    }
  };

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<MessageCircle className="w-3.5 h-3.5" />}
      onClick={handleMessage}
      disabled={!hasWhatsApp && !hasPhone && !hasEmail}
    >
      Message
    </Button>
  );
}

// ── KPI strip ────────────────────────────────────────────────────────────

function SummaryStrip({ contactId }: { contactId: string }) {
  const { data: summary, isLoading } = useContactSummary(contactId);

  if (isLoading) {
    return (
      <div className="grid grid-cols-4 gap-2 mb-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[52px] rounded-[11px]" />
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const tiles = [
    {
      label: "Lifetime value",
      value: <MoneyText ngn={parseFloat(summary.lifetime_value_ngn || "0")} />,
    },
    { label: "Orders", value: summary.total_orders },
    {
      label: "Last activity",
      value: summary.last_activity_at
        ? relativeTime(summary.last_activity_at)
        : "—",
    },
    {
      label: "Churn risk",
      value: summary.churn_risk_band ? (
        <Pill tone={RISK_TONE[summary.churn_risk_band]} dot={false}>
          {summary.churn_risk_band}
        </Pill>
      ) : (
        "—"
      ),
    },
  ];

  // On the wider desktop pane the 4-up strip stays 4 columns (lg:grid-cols-4);
  // phone/tablet keep the original 2-up / 4-up responsive behaviour unchanged.
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-2 mb-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="p-2.5 rounded-[11px] bg-text-primary/[0.04] border hairline"
        >
          <div className="micro mb-1">{t.label}</div>
          <div className="font-display text-base text-text-primary tabular-nums">
            {t.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Timeline tab ─────────────────────────────────────────────────────────

const TIMELINE_TABS = [
  { key: "commercial", label: "Commercial" },
  { key: "engagement", label: "Engagement" },
  { key: "internal", label: "Internal" },
] as const;

function TimelineIcon({ type }: { type: string }) {
  if (type.includes("order") || type.includes("payment"))
    return <Package className="w-3.5 h-3.5" />;
  if (type.includes("deal") || type.includes("activity"))
    return <Activity className="w-3.5 h-3.5" />;
  if (type.includes("tag") || type.includes("segment"))
    return <CheckCircle className="w-3.5 h-3.5" />;
  return <Clock className="w-3.5 h-3.5" />;
}

function TimelineTab({
  contactId,
  contactName,
}: {
  contactId: string;
  contactName: string;
}) {
  const [activeTab, setActiveTab] = useState<
    "commercial" | "engagement" | "internal"
  >("commercial");
  const [showLogActivity, setShowLogActivity] = useState(false);

  const { data, isLoading } = useContactTimeline(contactId, {
    category: activeTab,
    page_size: 20,
  });
  const events: TimelineEvent[] = data?.data ?? [];

  return (
    <div>
      {/* Sub-tabs + Log Activity */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 flex gap-1 p-1 rounded-[12px] bg-text-primary/[0.04] border hairline">
          {TIMELINE_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={[
                "flex-1 py-1.5 rounded-[9px] text-[12px] font-semibold transition-all",
                activeTab === t.key
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>
        {activeTab === "engagement" && (
          <Button
            variant="secondary"
            size="sm"
            icon={<PenLine className="w-3.5 h-3.5" />}
            onClick={() => setShowLogActivity(true)}
          >
            Log
          </Button>
        )}
      </div>

      {showLogActivity && (
        <LogActivityModal
          contactId={contactId}
          contactName={contactName}
          onClose={() => setShowLogActivity(false)}
        />
      )}

      {isLoading && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[56px] rounded-[10px]" />
          ))}
        </div>
      )}

      {!isLoading && events.length === 0 && (
        <div className="py-8 text-center text-text-faint text-[13px]">
          No {activeTab} activity yet
        </div>
      )}

      {!isLoading && events.length > 0 && (
        <div className="flex flex-col gap-2">
          {events.map((ev) => (
            <div
              key={ev.event_id}
              className="flex items-start gap-3 p-3 rounded-[10px] bg-text-primary/[0.03] border hairline"
            >
              <span className="w-7 h-7 rounded-full grid place-items-center bg-text-primary/[0.07] text-text-muted flex-shrink-0 mt-0.5">
                <TimelineIcon type={ev.event_type} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text-primary font-medium">
                  {ev.title}
                </div>
                {ev.detail && (
                  <div className="text-[11px] text-text-muted mt-0.5">
                    {ev.detail}
                  </div>
                )}
                <div className="text-[10.5px] text-text-faint mt-1">
                  {relativeTime(ev.event_at)}
                  {ev.created_by_name && ` · ${ev.created_by_name}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Deals tab ─────────────────────────────────────────────────────────────

function DealsTab({ contactId }: { contactId: string }) {
  const { data, isLoading } = useDeals({
    contact_id: contactId,
    page_size: 10,
  });
  const deals: Deal[] = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[66px] rounded-[11px]" />
        ))}
      </div>
    );
  }

  if (!deals.length) {
    return (
      <div className="py-8 text-center">
        <div className="text-text-faint text-[13px]">No deals yet</div>
      </div>
    );
  }

  // Deals are independent cards — on the wide desktop pane they read better
  // two-up (lg:grid-cols-2); phone/tablet keep the single stacked column.
  return (
    <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-2">
      {deals.map((d) => (
        <div
          key={d.deal_id}
          className="p-3 rounded-[11px] bg-text-primary/[0.03] border hairline"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-text-primary truncate">
                {d.title}
              </div>
              <div className="text-[11px] text-text-faint mt-0.5">
                {d.deal_number}
                {d.current_stage_name ? ` · ${d.current_stage_name}` : ""}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0">
              <Pill tone={DEAL_STATUS_TONE[d.status] ?? "neutral"}>
                {d.status}
              </Pill>
              {d.expected_value_ngn && (
                <span className="text-[12px] font-mono text-text-muted">
                  <MoneyText ngn={parseFloat(d.expected_value_ngn)} />
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Addresses tab ────────────────────────────────────────────────────────

function AddressesTab({ contactId }: { contactId: string }) {
  const { data: addresses = [], isLoading } = useAddresses(contactId);
  const deleteAddr = useDeleteAddress(contactId);
  const [showAdd, setShowAdd] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[80px] rounded-[11px]" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* On the wide desktop pane, address cards sit two-up; phone/tablet keep
          the single stacked column. */}
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-2">
        {addresses.map((addr) => (
          <div
            key={addr.address_id}
            className="p-3 rounded-[11px] bg-text-primary/[0.03] border hairline relative group"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="micro">{addr.address_type}</span>
                  {addr.is_default && (
                    <Pill tone="accent" dot={false}>
                      Default
                    </Pill>
                  )}
                  {addr.is_verified && (
                    <span className="text-success">
                      <CheckCircle className="w-3 h-3" />
                    </span>
                  )}
                </div>
                <div className="text-[13px] text-text-primary">
                  {addr.line1}
                </div>
                {addr.line2 && (
                  <div className="text-[12px] text-text-muted">
                    {addr.line2}
                  </div>
                )}
                <div className="text-[12px] text-text-muted">
                  {[addr.area, addr.city, addr.state]
                    .filter(Boolean)
                    .join(", ")}
                </div>
                {addr.landmark && (
                  <div className="text-[11px] text-text-faint mt-0.5">
                    Landmark: {addr.landmark}
                  </div>
                )}
                {/* Mini map preview */}
                {addr.latitude != null && addr.longitude != null && (
                  <StaticMapImage
                    lat={addr.latitude}
                    lng={addr.longitude}
                    label={addr.city}
                  />
                )}
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {addr.google_maps_url && (
                  <a
                    href={addr.google_maps_url}
                    target="_blank"
                    rel="noreferrer"
                    className="w-7 h-7 grid place-items-center rounded-[8px] text-text-faint hover:text-text-primary hover:bg-text-primary/[0.08] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  onClick={() => deleteAddr.mutate(addr.address_id)}
                  className="w-7 h-7 grid place-items-center rounded-[8px] text-text-faint hover:text-danger hover:bg-danger/[0.1] transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {!addresses.length && (
          <div className="py-6 text-center text-text-faint text-[13px]">
            No addresses saved
          </div>
        )}
      </div>

      <Button
        variant="secondary"
        size="sm"
        icon={<Plus className="w-3.5 h-3.5" />}
        className="mt-3 w-full justify-center"
        onClick={() => setShowAdd(true)}
      >
        Add Address
      </Button>

      {showAdd && (
        <AddressFormModal
          contactId={contactId}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

// ── Preferences tab ──────────────────────────────────────────────────────

function PreferencesTab({ contactId }: { contactId: string }) {
  const { data: prefs, isLoading } = usePreferences(contactId);
  const { data: measurements = [] } = useMeasurements(contactId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-[100px] rounded-[11px]" />
        <Skeleton className="h-[80px] rounded-[11px]" />
      </div>
    );
  }

  const latestMeasurement = measurements[0];

  // On the wide desktop pane, wig preferences + head measurements sit
  // side-by-side (lg:grid-cols-2); phone/tablet keep the stacked column.
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start">
      {/* Wig preferences */}
      <div>
        <div className="micro mb-3">Wig Preferences</div>
        {prefs ? (
          <div className="grid grid-cols-1 gap-2">
            {prefs.preferred_textures.length > 0 && (
              <PrefRow label="Textures" values={prefs.preferred_textures} />
            )}
            {prefs.preferred_lace_types.length > 0 && (
              <PrefRow label="Lace Types" values={prefs.preferred_lace_types} />
            )}
            {prefs.preferred_colours.length > 0 && (
              <PrefRow label="Colours" values={prefs.preferred_colours} />
            )}
            {prefs.preferred_densities.length > 0 && (
              <PrefRow label="Densities" values={prefs.preferred_densities} />
            )}
            {prefs.avoid_textures.length > 0 && (
              <PrefRow
                label="Avoid textures"
                values={prefs.avoid_textures}
                tone="danger"
              />
            )}
            {prefs.avoid_colours.length > 0 && (
              <PrefRow
                label="Avoid colours"
                values={prefs.avoid_colours}
                tone="danger"
              />
            )}
            {(prefs.budget_min_ngn || prefs.budget_max_ngn) && (
              <div className="p-2.5 rounded-[10px] bg-text-primary/[0.04] border hairline">
                <div className="micro mb-1">Budget</div>
                <div className="text-[13px] text-text-primary font-mono">
                  {prefs.budget_min_ngn && (
                    <MoneyText ngn={parseFloat(prefs.budget_min_ngn)} />
                  )}
                  {prefs.budget_min_ngn && prefs.budget_max_ngn && " – "}
                  {prefs.budget_max_ngn && (
                    <MoneyText ngn={parseFloat(prefs.budget_max_ngn)} />
                  )}
                </div>
              </div>
            )}
            {prefs.styling_sensitivities && (
              <div className="p-2.5 rounded-[10px] bg-text-primary/[0.04] border hairline">
                <div className="micro mb-1">Sensitivities</div>
                <div className="text-[12px] text-text-muted">
                  {prefs.styling_sensitivities}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="py-4 text-center text-text-faint text-[13px]">
            No preferences recorded yet
          </div>
        )}
      </div>

      {/* Head measurements */}
      <div>
        <div className="micro mb-3">Head Measurements</div>
        {latestMeasurement ? (
          <div className="p-3 rounded-[11px] bg-text-primary/[0.03] border hairline">
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Circumference", latestMeasurement.circumference_cm],
                ["Ear to ear", latestMeasurement.ear_to_ear_cm],
                ["Forehead to nape", latestMeasurement.forehead_to_nape_cm],
                ["Temple to temple", latestMeasurement.temple_to_temple_cm],
                ["Nape width", latestMeasurement.nape_width_cm],
              ]
                .filter(([, v]) => v != null)
                .map(([label, value]) => (
                  <div key={label as string}>
                    <div className="micro">{label as string}</div>
                    <div className="text-[13px] text-text-primary font-mono">
                      {value} cm
                    </div>
                  </div>
                ))}
            </div>
            {latestMeasurement.measured_at && (
              <div className="text-[10.5px] text-text-faint mt-2">
                Measured{" "}
                {new Date(latestMeasurement.measured_at).toLocaleDateString(
                  "en-NG",
                  {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  },
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="py-4 text-center text-text-faint text-[13px]">
            No measurements recorded yet
          </div>
        )}
      </div>
    </div>
  );
}

function PrefRow({
  label,
  values,
  tone = "neutral",
}: {
  label: string;
  values: string[];
  tone?: Tone;
}) {
  return (
    <div className="p-2.5 rounded-[10px] bg-text-primary/[0.04] border hairline">
      <div className="micro mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <Pill key={v} tone={tone} dot={false}>
            {v}
          </Pill>
        ))}
      </div>
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────

function OverviewTab({ contact }: { contact: Contact }) {
  const rows: [string, string | null][] = [
    ["Display name", contact.display_name],
    ["First name", contact.first_name],
    ["Last name", contact.last_name],
    ["Company", contact.company_name],
    [
      "Gender",
      contact.gender ? (GENDER_LABEL[contact.gender] ?? contact.gender) : null,
    ],
    [
      "Birthday",
      contact.date_of_birth
        ? new Date(contact.date_of_birth).toLocaleDateString("en-NG", {
            day: "numeric",
            month: "long",
            year: contact.date_of_birth.startsWith("1900")
              ? undefined
              : "numeric",
          })
        : null,
    ],
    ["WhatsApp", contact.whatsapp_number],
    ["Email", contact.email],
    [
      "Instagram",
      contact.instagram_handle ? `@${contact.instagram_handle}` : null,
    ],
    ["TikTok", contact.tiktok_handle ? `@${contact.tiktok_handle}` : null],
    [
      "Facebook",
      contact.facebook_handle ? `@${contact.facebook_handle}` : null,
    ],
    ["Country code", contact.country_code],
    ["TIN", contact.tin],
    ["CAC number", contact.cac_number],
    ["Source", contact.source],
  ].filter(([, v]) => v != null) as [string, string][];

  return (
    <div>
      {/* Contact actions */}
      <div className="flex gap-2 mb-4">
        {contact.whatsapp_number && (
          <a
            href={`https://wa.me/${contact.whatsapp_number.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 h-[33px] px-3 rounded-[10px] bg-[#25D366]/10 border border-[#25D366]/30 text-[12px] font-semibold text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            WhatsApp
          </a>
        )}
        {contact.primary_phone && (
          <a
            href={`tel:${contact.primary_phone}`}
            className="flex items-center gap-1.5 h-[33px] px-3 rounded-[10px] bg-text-primary/[0.04] border hairline text-[12px] font-semibold text-text-muted hover:text-text-primary hover:bg-text-primary/[0.09] transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
            {contact.primary_phone}
          </a>
        )}
        {contact.email && (
          <a
            href={`mailto:${contact.email}`}
            className="flex items-center gap-1.5 h-[33px] px-3 rounded-[10px] bg-text-primary/[0.04] border hairline text-[12px] font-semibold text-text-muted hover:text-text-primary hover:bg-text-primary/[0.09] transition-colors"
          >
            <Mail className="w-3.5 h-3.5" />
            Email
          </a>
        )}
      </div>

      {/* Field grid — on the wide desktop pane the rows split into two columns
          (lg:grid-cols-2); phone/tablet keep the single stacked column. */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-x-6">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between py-2 border-b hairline last:border-0"
          >
            <span className="micro">{label}</span>
            <span className="text-[13px] text-text-primary text-right max-w-[60%] truncate">
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Tags */}
      <div className="mt-4">
        <TagPicker contactId={contact.contact_id} />
      </div>

      {/* Notes */}
      {contact.notes && (
        <div className="mt-4 p-3 rounded-[11px] bg-text-primary/[0.04] border hairline">
          <div className="micro mb-1">Notes</div>
          <p className="text-[13px] text-text-muted leading-relaxed">
            {contact.notes}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Reusable detail body ───────────────────────────────────────────────────

type TabKey = ProfileTabKey;

/**
 * The inner body of the contact 360° view — summary strip, tab bar and tab
 * content. Used directly inline in the desktop master-detail right pane, and
 * wrapped by `ContactDetailDrawer` for the phone/tablet overlay. The drawer
 * supplies its own header/footer (avatar, edit button), so this body only
 * renders the scrollable content.
 */
export function ContactDetailPanel({
  contactId,
}: {
  contactId: string | null;
}) {
  const [tab, setTab] = useState<TabKey>("overview");
  const { data: contact, isLoading } = useContact(contactId);
  // The stylist Programme tab also appears when an enrolled stylist record
  // exists, even if the contact_type isn't tagged stylist_partner.
  const { data: stylistRec } = useStylistByContact(contactId);

  // Tabs adapt to what the contact actually is — a Client sees
  // Deals/Preferences/Loyalty, an Employee sees Employment, a Supplier sees
  // Purchasing. If the active tab isn't valid for this contact, fall back to
  // Overview rather than rendering nothing.
  const tabs = contact
    ? profileTabsFor(contact.contact_type, {
        isAmbassador: contact.is_ambassador,
        isStylist: !!stylistRec,
      })
    : (["overview"] as TabKey[]);
  const activeTab: TabKey = tabs.includes(tab) ? tab : "overview";

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-24 rounded" />
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[52px] rounded-[11px]" />
          ))}
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[32px] rounded" />
        ))}
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="py-10 text-center text-text-faint text-[13px]">
        Contact not found
      </div>
    );
  }

  return (
    <>
      {/* Summary strip */}
      <SummaryStrip contactId={contact.contact_id} />

      {/* Tab bar — type-aware */}
      <div className="flex gap-0.5 mb-4 -mx-1 px-1 overflow-x-auto no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "flex-shrink-0 px-3 py-1.5 rounded-[9px] text-[12px] font-semibold transition-all whitespace-nowrap",
              activeTab === t
                ? "bg-accent-deep text-[#F4E9D9]"
                : "text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06]",
            ].join(" ")}
          >
            {PROFILE_TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && <OverviewTab contact={contact} />}
      {activeTab === "timeline" && (
        <TimelineTab
          contactId={contact.contact_id}
          contactName={contact.display_name}
        />
      )}
      {activeTab === "deals" && <DealsTab contactId={contact.contact_id} />}
      {activeTab === "addresses" && (
        <AddressesTab contactId={contact.contact_id} />
      )}
      {activeTab === "preferences" && (
        <PreferencesTab contactId={contact.contact_id} />
      )}
      {activeTab === "loyalty" && (
        <LoyaltyTab
          contactId={contact.contact_id}
          contactName={contact.display_name}
        />
      )}
      {activeTab === "employment" && <EmploymentTab contact={contact} />}
      {activeTab === "purchasing" && <PurchasingTab contact={contact} />}
      {activeTab === "subscription" && <SubscriptionTab contact={contact} />}
      {activeTab === "programme" && <ProgrammeTab contact={contact} />}
      {activeTab === "ambassador" && <AmbassadorTab contact={contact} />}
    </>
  );
}

// ── Employment tab (lighter summary → deep-links into HR) ──────────────────

function EmploymentTab({ contact }: { contact: Contact }) {
  return (
    <div className="rounded-[14px] glass border hairline p-6 text-center">
      <span className="grid place-items-center w-11 h-11 rounded-xl bg-info/[0.12] text-info mx-auto mb-3">
        <Briefcase className="w-5 h-5" />
      </span>
      <div className="font-display text-[16px] text-text-primary mb-1">
        Employee record
      </div>
      <p className="text-[12.5px] text-text-muted max-w-[360px] mx-auto mb-4">
        {contact.display_name}&rsquo;s role, schedule, attendance, salary and
        documents live in the HR module — managed there so payroll and access
        stay in sync.
      </p>
      <Link
        to={`/hr?contact=${contact.contact_id}`}
        className="inline-flex items-center gap-1.5 h-[34px] px-4 rounded-[10px] bg-accent-deep text-[#F4E9D9] text-[12px] font-semibold hover:opacity-90 transition-opacity"
      >
        Open in HR
        <ArrowUpRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

// ── Purchasing tab (supplier → deep-links into Procurement) ────────────────

function PurchasingTab({ contact }: { contact: Contact }) {
  return (
    <div className="rounded-[14px] glass border hairline p-6 text-center">
      <span className="grid place-items-center w-11 h-11 rounded-xl bg-success/[0.13] text-success mx-auto mb-3">
        <ShoppingCart className="w-5 h-5" />
      </span>
      <div className="font-display text-[16px] text-text-primary mb-1">
        Supplier &amp; purchasing
      </div>
      <p className="text-[12.5px] text-text-muted max-w-[360px] mx-auto mb-4">
        Purchase orders, bills and supplier terms for {contact.display_name} are
        managed in Procurement.
      </p>
      <Link
        to={`/purchasing/suppliers?contact=${contact.contact_id}`}
        className="inline-flex items-center gap-1.5 h-[34px] px-4 rounded-[10px] bg-accent-deep text-[#F4E9D9] text-[12px] font-semibold hover:opacity-90 transition-opacity"
      >
        Open in Procurement
        <ArrowUpRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

// ── Subscription tab (newsletter subscribers) ──────────────────────────────

function SubscriptionTab({ contact }: { contact: Contact }) {
  return (
    <div className="space-y-3">
      <div className="rounded-[12px] glass border hairline p-4 flex items-center justify-between">
        <div>
          <div className="micro mb-0.5">Newsletter</div>
          <div className="text-[13px] text-text-primary">
            Subscribed{contact.source ? ` · via ${contact.source}` : ""}
          </div>
        </div>
        <Pill tone="success">Active</Pill>
      </div>
      <Link
        to={`/email-campaigns?contact=${contact.contact_id}`}
        className="inline-flex items-center gap-1.5 h-[33px] px-3 rounded-[10px] bg-text-primary/[0.04] border hairline text-[12px] font-semibold text-text-muted hover:text-text-primary transition-colors"
      >
        Email campaigns
        <ArrowUpRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

// ── Stylist-Partner programme tab ──────────────────────────────────────────

const STYLIST_STATUS_TONE: Record<string, Tone> = {
  certified: "success",
  vetted: "info",
  vetting: "warn",
  applicant: "neutral",
  suspended: "warn",
  terminated: "danger",
};

const INPUT_CLS =
  "w-full h-[38px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 transition-colors";

function ProgrammeTab({ contact }: { contact: Contact }) {
  const { data: stylist, isLoading } = useStylistByContact(contact.contact_id);
  const create = useCreateStylist();
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("NG");
  const [err, setErr] = useState("");

  const { data: certs } = useStylistCertifications(stylist?.stylist_id ?? null);
  const { data: payouts } = useStylistPayouts(stylist?.stylist_id ?? null);
  const { data: assignments } = useStylistAssignments(
    stylist?.stylist_id ?? null,
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 rounded-[12px]" />
        <Skeleton className="h-16 rounded-[12px]" />
      </div>
    );
  }

  // Not yet in the programme — enrol this contact.
  if (!stylist) {
    return (
      <div className="rounded-[14px] glass border hairline p-6 text-center max-w-md mx-auto">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-warn/[0.14] text-warn mx-auto mb-3">
          <Scissors className="w-5 h-5" />
        </span>
        <div className="font-display text-[16px] text-text-primary mb-1">
          Add to stylist programme
        </div>
        <p className="text-[12.5px] text-text-muted mb-4">
          Enrol {contact.display_name} as a stylist partner to manage tiers,
          assignments and payouts.
        </p>
        {err && (
          <div className="mb-3 px-3 py-2 rounded-[10px] bg-danger/[0.1] border border-danger/30 text-[12px] text-danger">
            {err}
          </div>
        )}
        <div className="flex gap-2 mb-3">
          <input
            className={INPUT_CLS}
            placeholder="City (e.g. Lagos)"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <input
            className={INPUT_CLS + " w-[110px] shrink-0"}
            placeholder="Country"
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            maxLength={3}
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Scissors className="w-3.5 h-3.5" />}
          disabled={create.isPending || !city.trim() || !country.trim()}
          onClick={async () => {
            setErr("");
            try {
              await create.mutateAsync({
                contact_id: contact.contact_id,
                display_name: contact.display_name,
                country_code: country.trim(),
                city: city.trim(),
              });
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Could not enrol stylist.");
            }
          }}
        >
          {create.isPending ? "Enrolling…" : "Enrol as stylist partner"}
        </Button>
      </div>
    );
  }

  const certList = certs?.data ?? [];
  const payoutList = payouts?.data ?? [];
  const assignmentList = assignments?.data ?? [];

  return (
    <div className="space-y-5">
      {/* Programme summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <ProgCard label="Partner code">
          <span className="font-mono text-[13px] text-text-primary">
            {stylist.partner_code}
          </span>
        </ProgCard>
        <ProgCard label="Status">
          <Pill tone={STYLIST_STATUS_TONE[stylist.status] ?? "neutral"}>
            {stylist.status}
          </Pill>
        </ProgCard>
        <ProgCard label="Tier">
          <span className="text-[13px] text-text-primary capitalize">
            {stylist.current_tier_key ?? "—"}
          </span>
        </ProgCard>
        <ProgCard label="Location">
          <span className="text-[13px] text-text-primary">
            {[stylist.city, stylist.country_code].filter(Boolean).join(", ") ||
              "—"}
          </span>
        </ProgCard>
        <ProgCard label="Active jobs">
          <span className="text-[13px] text-text-primary tabular-nums">
            {stylist.current_active_count ?? 0}
            {stylist.max_active_assignments
              ? ` / ${stylist.max_active_assignments}`
              : ""}
          </span>
        </ProgCard>
        <ProgCard label="Badge">
          {stylist.badge_token && !stylist.badge_revoked_at ? (
            <Pill tone="success">Issued</Pill>
          ) : (
            <span className="text-[13px] text-text-faint">None</span>
          )}
        </ProgCard>
      </div>

      {/* Certifications */}
      <ProgSection icon={<Award className="w-3.5 h-3.5" />} title={`Certifications · ${certList.length}`}>
        {certList.length === 0 ? (
          <p className="text-[12.5px] text-text-faint">No certifications yet.</p>
        ) : (
          <div className="space-y-1.5">
            {certList.map((c) => (
              <div
                key={c.certification_id}
                className="flex items-center justify-between p-2.5 rounded-[10px] bg-text-primary/[0.04] border hairline"
              >
                <span className="text-[13px] text-text-primary capitalize">
                  {c.tier_key}
                </span>
                <span className="text-[11px] text-text-faint">
                  {c.revoked_at ? "Revoked" : `Awarded ${fmtShort(c.awarded_at)}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </ProgSection>

      {/* Recent payouts */}
      <ProgSection icon={<Wallet className="w-3.5 h-3.5" />} title={`Recent payouts · ${payoutList.length}`}>
        {payoutList.length === 0 ? (
          <p className="text-[12.5px] text-text-faint">No payouts yet.</p>
        ) : (
          <div className="space-y-1.5">
            {payoutList.slice(0, 6).map((p) => (
              <div
                key={p.payout_id}
                className="flex items-center justify-between p-2.5 rounded-[10px] bg-text-primary/[0.04] border hairline"
              >
                <span className="text-[12px] text-text-muted">
                  {fmtShort(p.period_start)} – {fmtShort(p.period_end)}
                </span>
                <span className="flex items-center gap-2">
                  <MoneyText ngn={Number(p.net_payable ?? p.amount ?? 0)} />
                  <Pill tone={p.status === "paid" ? "success" : "warn"} dot>
                    {p.status}
                  </Pill>
                </span>
              </div>
            ))}
          </div>
        )}
      </ProgSection>

      {/* Recent assignments */}
      <ProgSection icon={<Scissors className="w-3.5 h-3.5" />} title={`Recent assignments · ${assignmentList.length}`}>
        {assignmentList.length === 0 ? (
          <p className="text-[12.5px] text-text-faint">No assignments yet.</p>
        ) : (
          <div className="space-y-1.5">
            {assignmentList.slice(0, 6).map((a, i) => (
              <div
                key={a.assignment_id ?? a.job_id ?? i}
                className="flex items-center justify-between p-2.5 rounded-[10px] bg-text-primary/[0.04] border hairline"
              >
                <span className="text-[12px] text-text-muted">
                  {a.scheduled_for ? fmtShort(a.scheduled_for) : "Unscheduled"}
                </span>
                <Pill tone="neutral" dot>
                  {a.status}
                </Pill>
              </div>
            ))}
          </div>
        )}
      </ProgSection>
    </div>
  );
}

function ProgCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-[11px] bg-text-primary/[0.04] border hairline">
      <div className="micro mb-1">{label}</div>
      {children}
    </div>
  );
}

function ProgSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-[11px] tracking-widest uppercase text-accent-glow inline-flex items-center gap-1.5 mb-2">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}

function fmtShort(d?: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── Ambassador overlay tab ─────────────────────────────────────────────────

function AmbassadorTab({ contact }: { contact: Contact }) {
  const promote = usePromoteAmbassador(contact.contact_id);
  const demote = useDemoteAmbassador(contact.contact_id);
  const profile = contact.ambassador_profile ?? null;

  const [commission, setCommission] = useState(
    profile?.commission_pct != null
      ? String(Math.round(profile.commission_pct * 100))
      : "",
  );
  const [instagram, setInstagram] = useState(
    profile?.social_handles?.instagram ?? contact.instagram_handle ?? "",
  );
  const [err, setErr] = useState("");

  const save = async () => {
    setErr("");
    const pct = commission ? Number(commission) / 100 : null;
    try {
      await promote.mutateAsync({
        commission_pct: pct,
        ...(instagram.trim()
          ? { social_handles: { instagram: instagram.trim() } }
          : {}),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save ambassador.");
    }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div className="flex items-center gap-2.5">
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-accent/[0.12] text-accent-glow">
          <Sparkles className="w-4 h-4" />
        </span>
        <div>
          <div className="text-[14px] font-medium text-text-primary">
            {contact.is_ambassador ? "Active ambassador" : "Not an ambassador"}
          </div>
          <div className="text-[12px] text-text-faint">
            {contact.is_ambassador
              ? "Earns commission on attributed sales via their share link."
              : "Promote this contact to start tracking referrals & commission."}
          </div>
        </div>
      </div>

      {err && (
        <div className="px-3 py-2 rounded-[10px] bg-danger/[0.1] border border-danger/30 text-[12px] text-danger">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="micro mb-1 block">Commission %</span>
          <input
            className={INPUT_CLS}
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            placeholder="e.g. 10"
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="micro mb-1 block">Instagram handle</span>
          <input
            className={INPUT_CLS}
            placeholder="amara.style"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value.replace(/^@+/, ""))}
          />
        </label>
      </div>

      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={<Sparkles className="w-3.5 h-3.5" />}
          disabled={promote.isPending}
          onClick={save}
        >
          {promote.isPending
            ? "Saving…"
            : contact.is_ambassador
              ? "Save ambassador"
              : "Promote to ambassador"}
        </Button>
        {contact.is_ambassador && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="w-3.5 h-3.5" />}
            disabled={demote.isPending}
            onClick={() => demote.mutate()}
          >
            {demote.isPending ? "Removing…" : "Remove ambassador"}
          </Button>
        )}
        <Link
          to="/sales-campaigns"
          className="inline-flex items-center gap-1.5 h-[33px] px-3 rounded-[10px] bg-text-primary/[0.04] border hairline text-[12px] font-semibold text-text-muted hover:text-text-primary transition-colors"
        >
          Campaigns
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

// Re-export so the drawer can build its edit modal without a second import path.
export { ContactFormModal };
