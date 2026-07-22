import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Users,
  QrCode,
  Search,
  UserPlus,
  List,
  LayoutGrid,
  Globe,
  Star,
  Zap,
  Store,
  ChevronRight,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Button, Pill, type Tone } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { Select } from "@/components/ui/controls";
import { useContacts, useContactStats } from "./hooks";
import {
  useAmbassadors,
  useStylists,
  type Ambassador,
  type StylistPartner,
} from "./programmesApi";
import { ContactFormModal } from "./ContactFormModal";
import { ContactsImportExport } from "./ContactsImportExport";
import { QuickAddModal } from "./QuickAddModal";
import { WalkInQR } from "./WalkInQR";
import { OnlineQR } from "./OnlineQR";
import {
  directoryTabs,
  stakeholderForType,
  STAKEHOLDERS,
} from "./stakeholders";
import { TYPE_LABELS } from "./ContactDetailPanel";
import type { Contact, ContactType, PriorityLevel } from "./types";

const STYLIST_STATUS_TONE: Record<string, Tone> = {
  certified: "success",
  vetted: "info",
  vetting: "warn",
  applicant: "neutral",
  suspended: "warn",
  terminated: "danger",
};

const PRIORITY_TONE: Record<PriorityLevel, Tone> = {
  vip: "accent",
  regular: "neutral",
  new: "info",
};

const SOURCE_LABEL: Record<string, string> = {
  walk_in: "Walk-in",
  social_media: "Social",
  referral: "Referral",
  website: "Website",
  event: "Event",
  storefront: "Storefront",
  instagram_dm: "Instagram",
};

const PRIORITY_FILTER_OPTS = [
  { value: "", label: "All priorities" },
  { value: "vip", label: "VIP" },
  { value: "regular", label: "Regular" },
  { value: "new", label: "New" },
];

const AVATAR_COLORS = [
  "#8b9d77",
  "#7a8fa8",
  "#b76e79",
  "#9c7ad9",
  "#5aa0a8",
  "#a8785a",
  "#7ab076",
];

function ContactAvatar({ name, idx }: { name: string; idx: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className="w-[30px] h-[30px] rounded-full grid place-items-center text-[11px] font-semibold text-white font-display flex-shrink-0"
      style={{ background: AVATAR_COLORS[idx % AVATAR_COLORS.length] }}
    >
      {initials || "?"}
    </span>
  );
}

/**
 * Line-2 contact metadata for a directory row. Scans the three endpoints and
 * shows up to two, in the fixed priority order Phone → Instagram → Email
 * (so a contact with all three reads "phone • @instagram").
 */
function contactMeta(c: Contact): { value: string; mono: boolean }[] {
  const out: { value: string; mono: boolean }[] = [];
  const phone = c.primary_phone ?? c.whatsapp_number;
  if (phone) out.push({ value: phone, mono: true });
  if (c.instagram_handle) out.push({ value: `@${c.instagram_handle}`, mono: false });
  if (c.email) out.push({ value: c.email, mono: true });
  return out.slice(0, 2);
}

/** A VIP is flagged with a star to the right of the name (no separate pill). */
function VipStar({ level }: { level: PriorityLevel }) {
  if (level !== "vip") return null;
  return (
    <Star
      className="w-3.5 h-3.5 text-accent-glow fill-accent-glow flex-shrink-0"
      aria-label="VIP"
    />
  );
}

// "all" + the per-stakeholder tabs shipped this phase. Tab identity is the
// stakeholder KEY (ambassador has no contact_type — it's an overlay).
type TabKey = "all" | ContactType | "ambassador";

export function ContactsPage() {
  useBreadcrumbs([{ label: "Contacts" }]);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabs = directoryTabs(); // shipped stakeholders
  const initialTab = (searchParams.get("tab") as TabKey) || "all";
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabs.some((t) => t.key === initialTab) ? initialTab : "all",
  );

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [page, setPage] = useState(1);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showOnlineQR, setShowOnlineQR] = useState(false);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [showQrSheet, setShowQrSheet] = useState(false);
  const [view, setView] = useState<"list" | "cards">(
    () =>
      (localStorage.getItem("pgh_contacts_view") as "list" | "cards") || "list",
  );
  const setViewPersist = (v: "list" | "cards") => {
    setView(v);
    localStorage.setItem("pgh_contacts_view", v);
  };

  // The active stakeholder tab IS the contact_type server filter — so when you
  // open Clients, only clients come back from the API.
  const activeDef = activeTab !== "all" ? STAKEHOLDERS[activeTab] : undefined;

  // Stylist Partners and Ambassadors are backed by their own programmes, not
  // the plain contacts list — so those two tabs read from dedicated endpoints.
  const isAmbassadorTab = activeTab === "ambassador";
  const isStylistTab = activeTab === "stylist_partner";
  const isProgrammeTab = isAmbassadorTab || isStylistTab;

  const params = {
    ...(search ? { q: search } : {}),
    ...(activeTab !== "all" && !isProgrammeTab
      ? { contact_type: activeTab }
      : {}),
    ...(priorityFilter ? { priority_level: priorityFilter } : {}),
    page,
    page_size: 25,
  };

  const { data, isLoading } = useContacts(params);
  const contacts = data?.data ?? [];
  const { data: contactStats } = useContactStats();
  const meta = data?.meta;

  // Programme data sources (only the active one matters; the others idle).
  const { data: ambData, isLoading: ambLoading } = useAmbassadors(
    isAmbassadorTab ? search : undefined,
  );
  const ambassadors: Ambassador[] = isAmbassadorTab
    ? (ambData?.data ?? [])
    : [];
  const { data: stylistData, isLoading: stylistLoading } = useStylists(
    isStylistTab
      ? { ...(priorityFilter ? {} : {}), ...(search ? { city: search } : {}) }
      : {},
  );
  const stylists: StylistPartner[] = isStylistTab
    ? (stylistData?.data ?? []).filter((s) =>
        search
          ? s.display_name?.toLowerCase().includes(search.toLowerCase()) ||
            s.partner_code?.toLowerCase().includes(search.toLowerCase())
          : true,
      )
    : [];

  const changeTab = (t: TabKey) => {
    setActiveTab(t);
    setPage(1);
    const next = new URLSearchParams(searchParams);
    if (t !== "all") next.set("tab", t);
    else next.delete("tab");
    setSearchParams(next, { replace: true });
  };

  const openContact = useCallback(
    (c: Contact) => navigate(`/contacts/${c.contact_id}`),
    [navigate],
  );

  // Context-aware "add" — employees go to full onboarding, stylists to the
  // programme setup, ambassadors are promoted from a client profile, everyone
  // else opens the full form pre-typed to the active tab.
  const onPrimaryAdd = () => {
    if (activeTab === "staff") navigate("/contacts/staff/new");
    else if (isStylistTab) changeTab("all");
    else if (isAmbassadorTab) changeTab("customer");
    else setShowCreateModal(true);
  };

  const primaryLabel =
    activeTab === "staff"
      ? "Onboard Employee"
      : isStylistTab
        ? "Add Stylist Partner"
        : isAmbassadorTab
          ? "Promote a Client"
          : activeDef
            ? `New ${activeDef.label}`
            : "New Contact";

  // The Power Plus opens the Add sheet when there's more than one way in
  // (Quick Add and/or Data tools); on programme tabs where the only action is
  // the context primary, it fires that directly instead of a one-item sheet.
  const showQuickAddTile = !isProgrammeTab && activeTab !== "staff";
  const showDataTools = !isProgrammeTab;
  const openAdd = () => {
    if (showQuickAddTile || showDataTools) setShowAddSheet(true);
    else onPrimaryAdd();
  };

  const columns: Column<Contact>[] = [
    {
      key: "name",
      header: "Name",
      render: (c) => (
        <span className="flex flex-col min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="font-medium text-[13px] text-text-primary truncate">
              {c.display_name}
            </span>
            <VipStar level={c.priority_level} />
          </span>
          {c.email && (
            <span className="text-[11px] text-text-faint truncate">
              {c.email}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (c) => (
        <span className="flex flex-wrap gap-1">
          {c.contact_type.slice(0, 2).map((t) => {
            const def = stakeholderForType(t);
            return (
              <Pill key={t} tone={def?.tone ?? "neutral"} dot={false}>
                {TYPE_LABELS[t] ?? t}
              </Pill>
            );
          })}
          {c.is_ambassador && (
            <Pill tone="accent" dot={false}>
              Ambassador
            </Pill>
          )}
        </span>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      render: (c) => (
        <span className="text-[12px] text-text-muted font-mono">
          {c.primary_phone ?? c.whatsapp_number ?? "—"}
        </span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      render: (c) => (
        <Pill tone={PRIORITY_TONE[c.priority_level]}>{c.priority_level}</Pill>
      ),
    },
    {
      key: "source",
      header: "Source",
      render: (c) => (
        <span className="text-[11px] text-text-faint capitalize">
          {c.source ? (SOURCE_LABEL[c.source] ?? c.source) : "—"}
        </span>
      ),
    },
    {
      key: "created",
      header: "Added",
      align: "right",
      render: (c) => (
        <span className="text-[11px] text-text-faint">
          {formatDate(c.created_at)}
        </span>
      ),
    },
  ];

  const ambColumns: Column<Ambassador>[] = [
    {
      key: "name",
      header: "Ambassador",
      render: (a, idx = ambassadors.indexOf(a)) => {
        const name =
          a.display_name ||
          [a.first_name, a.last_name].filter(Boolean).join(" ") ||
          "Unnamed";
        return (
          <span className="flex items-center gap-2.5">
            <ContactAvatar name={name} idx={idx} />
            <span className="flex flex-col min-w-0">
              <span className="font-medium text-[13px] text-text-primary truncate">
                {name}
              </span>
              {a.instagram_handle && (
                <span className="text-[11px] text-text-faint truncate">
                  @{a.instagram_handle}
                </span>
              )}
            </span>
          </span>
        );
      },
    },
    {
      key: "commission",
      header: "Commission",
      render: (a) => (
        <span className="text-[12px] text-text-muted font-mono">
          {a.ambassador_profile?.commission_pct != null
            ? `${Math.round(a.ambassador_profile.commission_pct * 100)}%`
            : "—"}
        </span>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      render: (a) => (
        <span className="text-[12px] text-text-muted font-mono">
          {a.primary_phone ?? "—"}
        </span>
      ),
    },
    {
      key: "badge",
      header: "Status",
      align: "right",
      render: () => (
        <Pill tone="accent" dot={false}>
          Ambassador
        </Pill>
      ),
    },
  ];

  const stylistColumns: Column<StylistPartner>[] = [
    {
      key: "name",
      header: "Stylist",
      render: (s, idx = stylists.indexOf(s)) => (
        <span className="flex items-center gap-2.5">
          <ContactAvatar name={s.display_name} idx={idx} />
          <span className="flex flex-col min-w-0">
            <span className="font-medium text-[13px] text-text-primary truncate">
              {s.display_name}
            </span>
            <span className="text-[11px] text-text-faint truncate font-mono">
              {s.partner_code}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "tier",
      header: "Tier",
      render: (s) => (
        <span className="text-[12px] text-text-muted capitalize">
          {s.current_tier_key ?? "—"}
        </span>
      ),
    },
    {
      key: "location",
      header: "Location",
      render: (s) => (
        <span className="text-[12px] text-text-muted">
          {[s.city, s.country_code].filter(Boolean).join(", ") || "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (s) => (
        <Pill tone={STYLIST_STATUS_TONE[s.status] ?? "neutral"} dot={false}>
          {s.status}
        </Pill>
      ),
    },
  ];

  // ── Phone card renderers ──────────────────────────────────────────────
  // On phones the column tables become tap-friendly stacked cards (no more
  // sideways scrolling). Each mirrors its table's columns in a compact form.
  // Avatar-free, flush-left directory row (redesign): name + VIP star on line 1
  // with the primary segment + a NEW flag; line 2 is the dynamic contact
  // metadata (Phone → Instagram → Email priority, up to two shown).
  const contactMobileCard = (c: Contact) => {
    const primaryType = c.contact_type[0];
    const def = primaryType ? stakeholderForType(primaryType) : undefined;
    const meta = contactMeta(c);
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="font-semibold text-[15px] text-text-primary truncate">
              {c.display_name}
            </span>
            <VipStar level={c.priority_level} />
          </span>
          {primaryType && (
            <Pill tone={def?.tone ?? "neutral"} dot={false}>
              {TYPE_LABELS[primaryType] ?? primaryType}
            </Pill>
          )}
          {c.priority_level === "new" && (
            <Pill tone="info" dot={false}>
              New
            </Pill>
          )}
        </div>
        {meta.length > 0 && (
          <div className="mt-1 text-[13px] text-text-muted truncate">
            {meta.map((e, i) => (
              <span key={i}>
                {i > 0 && <span className="text-text-faint mx-1.5">•</span>}
                <span className={e.mono ? "font-mono" : ""}>{e.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const ambMobileCard = (a: Ambassador) => {
    const idx = ambassadors.indexOf(a);
    const name =
      a.display_name ||
      [a.first_name, a.last_name].filter(Boolean).join(" ") ||
      "Unnamed";
    return (
      <div className="flex items-start gap-3">
        <ContactAvatar name={name} idx={idx} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[14px] text-text-primary truncate">
              {name}
            </span>
            <Pill tone="accent" dot={false}>
              Ambassador
            </Pill>
          </div>
          {a.instagram_handle && (
            <div className="text-[12px] text-text-faint truncate mt-0.5">
              @{a.instagram_handle}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2 text-[12px] text-text-muted font-mono">
            {a.ambassador_profile?.commission_pct != null && (
              <span>
                {Math.round(a.ambassador_profile.commission_pct * 100)}%
                commission
              </span>
            )}
            {a.primary_phone && <span>{a.primary_phone}</span>}
          </div>
        </div>
      </div>
    );
  };

  const stylistMobileCard = (s: StylistPartner) => {
    const idx = stylists.indexOf(s);
    return (
      <div className="flex items-start gap-3">
        <ContactAvatar name={s.display_name} idx={idx} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-[14px] text-text-primary truncate">
              {s.display_name}
            </span>
            <Pill tone={STYLIST_STATUS_TONE[s.status] ?? "neutral"} dot={false}>
              {s.status}
            </Pill>
          </div>
          <div className="text-[12px] text-text-faint truncate mt-0.5 font-mono">
            {s.partner_code}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2 text-[12px] text-text-muted">
            {s.current_tier_key && (
              <span className="capitalize">{s.current_tier_key}</span>
            )}
            <span>
              {[s.city, s.country_code].filter(Boolean).join(", ") || "—"}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const toolbar = (
    <div className="flex flex-col sm:flex-row gap-3 p-[14px_18px] border-b hairline">
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
        <input
          type="text"
          placeholder={`Search ${activeDef ? activeDef.plural.toLowerCase() : "contacts"}…`}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full h-[36px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 transition-colors" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
        />
      </div>

      <Select
        value={priorityFilter}
        onChange={(v) => {
          setPriorityFilter(v);
          setPage(1);
        }}
        options={PRIORITY_FILTER_OPTS}
        className="sm:w-[160px]"
      />
    </div>
  );

  const pagination = meta && meta.total > meta.page_size && (
    <div className="flex items-center justify-between mt-4 px-1">
      <span className="text-[12px] text-text-faint">
        Page {meta.page} of {Math.ceil(meta.total / meta.page_size)}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!meta.has_more}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );

  const emptyLabel = activeDef ? activeDef.plural.toLowerCase() : "contacts";
  const totalCount = isAmbassadorTab
    ? ambassadors.length
    : isStylistTab
      ? stylists.length
      : meta?.total;

  return (
    <div className="animate-fade-in">
      {/* Header + page-level CTAs (no longer teleported to the top bar).
          flex-wrap: on phones the CTA cluster is wider than what's left
          beside the title, so it drops to its own row instead of painting
          over the heading. */}
      <div className="mb-4">
        <div className="min-w-0 mb-3">
          <h1 className="font-display text-2xl text-text-primary">Contacts</h1>
          {totalCount != null && (
            <p className="text-[12px] text-text-faint mt-0.5">
              {totalCount.toLocaleString()} {emptyLabel}
            </p>
          )}
        </div>
        {/* View switch sits on the left directly under the title; the QR pill
            and Power Plus stay together on the right. */}
        <div className="flex items-center gap-2">
          {!isProgrammeTab && (
            <div className="flex items-center rounded-[10px] border border-line overflow-hidden">
              <button
                onClick={() => setViewPersist("list")}
                className={`grid place-items-center w-[34px] h-[34px] transition-colors ${
                  view === "list"
                    ? "bg-accent-deep text-[#F4E9D9]"
                    : "text-text-muted hover:text-text-primary"
                }`}
                aria-label="List view"
                title="List view"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewPersist("cards")}
                className={`grid place-items-center w-[34px] h-[34px] transition-colors ${
                  view === "cards"
                    ? "bg-accent-deep text-[#F4E9D9]"
                    : "text-text-muted hover:text-text-primary"
                }`}
                aria-label="Cards view"
                title="Cards view"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {/* QR pill — reveals Walk-in / Online QR (was two toolbar buttons) */}
            <button
              onClick={() => setShowQrSheet(true)}
              aria-label="Share a QR code"
              title="QR codes"
              className="inline-flex items-center justify-center h-[38px] px-3.5 rounded-[12px] bg-text-primary/[0.04] border border-line text-text-muted hover:text-text-primary hover:bg-text-primary/[0.08] transition-colors"
            >
              <QrCode className="w-[18px] h-[18px]" />
            </button>
            {/* Power Plus — one button, every way to add a contact */}
            <button
              onClick={openAdd}
              aria-label={primaryLabel}
              title={primaryLabel}
              className="inline-flex items-center justify-center h-[38px] min-w-[46px] px-3.5 rounded-[12px] text-[#F4E9D9] bg-accent-deep hover:bg-accent transition-colors shadow-[0_8px_22px_rgb(var(--accent-deep)/0.45)]"
            >
              <Plus className="w-[19px] h-[19px]" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>

      {/* Stakeholder tab bar — each tab is a server-side contact_type filter */}
      <div className="flex gap-1 mb-5 overflow-x-auto no-scrollbar -mx-1 px-1">
        <TabButton
          label="All"
          active={activeTab === "all"}
          onClick={() => changeTab("all")}
        />
        {tabs.map((def) => {
          const Icon = def.icon;
          return (
            <TabButton
              key={def.key}
              label={def.plural}
              icon={<Icon className="w-3.5 h-3.5" />}
              active={activeTab === def.key}
              onClick={() => changeTab(def.key as TabKey)}
            />
          );
        })}
      </div>

      {/* KPI strip — two low-profile landscape metrics (redesign): overview +
          growth, hairline-bordered, no heavy fill. */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="relative rounded-[14px] border border-line px-4 py-3 overflow-hidden">
          <span className="absolute left-0 top-3 bottom-3 w-[2px] rounded bg-accent/60" />
          <div className="micro pl-2.5">Total {emptyLabel}</div>
          <div className="font-display text-[26px] max-md:text-[22px] leading-none mt-1.5 pl-2.5 tabular-nums text-text-primary">
            {totalCount != null ? totalCount.toLocaleString() : "—"}
          </div>
        </div>
        <div className="relative rounded-[14px] border border-line px-4 py-3 overflow-hidden">
          <span className="absolute left-0 top-3 bottom-3 w-[2px] rounded bg-success/60" />
          <div className="micro pl-2.5">New this month</div>
          <div className="font-display text-[26px] max-md:text-[22px] leading-none mt-1.5 pl-2.5 tabular-nums text-text-primary">
            {contactStats ? contactStats.new_this_month.toLocaleString() : "—"}
          </div>
        </div>
      </div>

      {isAmbassadorTab ? (
        <DataTable<Ambassador>
          columns={ambColumns}
          rows={ambassadors}
          rowKey={(a) => a.contact_id}
          onRowClick={(a) => navigate(`/contacts/${a.contact_id}`)}
          loading={ambLoading}
          toolbar={toolbar}
          mobileCard={ambMobileCard}
          empty={{
            icon: <Users className="w-8 h-8" />,
            title: "No ambassadors yet",
            message:
              "Promote a client to ambassador from their profile to start tracking commission and attribution.",
          }}
        />
      ) : isStylistTab ? (
        <DataTable<StylistPartner>
          columns={stylistColumns}
          rows={stylists}
          rowKey={(s) => s.stylist_id}
          onRowClick={(s) => navigate(`/contacts/${s.contact_id}`)}
          loading={stylistLoading}
          toolbar={toolbar}
          mobileCard={stylistMobileCard}
          empty={{
            icon: <Users className="w-8 h-8" />,
            title: "No stylist partners yet",
            message: activeDef?.blurb ?? "",
          }}
        />
      ) : view === "cards" ? (
        <>
          {toolbar}
          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-4">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="h-28 rounded-[14px] glass border hairline animate-pulse"
                />
              ))}
            </div>
          ) : contacts.length === 0 ? (
            <div className="rounded-[14px] glass border hairline grid place-items-center text-center py-16 mt-4">
              <div>
                <span className="grid place-items-center w-12 h-12 rounded-xl bg-text-primary/[0.06] text-text-faint mb-3 mx-auto">
                  <Users className="w-6 h-6" />
                </span>
                <div className="font-display text-[16px] text-text-primary mb-1">
                  No {emptyLabel} yet
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="mt-3"
                  icon={<Plus className="w-3.5 h-3.5" />}
                  onClick={onPrimaryAdd}
                >
                  {primaryLabel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 mt-4">
              {contacts.map((c, i) => (
                <ContactCard
                  key={c.contact_id}
                  contact={c}
                  idx={i}
                  onClick={() => openContact(c)}
                />
              ))}
            </div>
          )}
          {pagination}
        </>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={contacts}
            rowKey={(c) => c.contact_id}
            onRowClick={openContact}
            loading={isLoading}
            toolbar={toolbar}
            mobileCard={contactMobileCard}
            empty={{
              icon: <Users className="w-8 h-8" />,
              title: `No ${emptyLabel} yet`,
              message:
                activeDef?.blurb ??
                "Add your first contact or scan the walk-in QR code.",
              action: (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Plus className="w-3.5 h-3.5" />}
                  onClick={onPrimaryAdd}
                >
                  {primaryLabel}
                </Button>
              ),
            }}
          />
          {pagination}
        </>
      )}

      {/* Full form — pre-typed to the active stakeholder tab */}
      {showCreateModal && (
        <ContactFormModal
          initialType={
            activeDef && activeDef.contactType !== "staff"
              ? (activeDef.contactType as ContactType)
              : "customer"
          }
          onClose={() => setShowCreateModal(false)}
          onSuccess={(id) => navigate(`/contacts/${id}`)}
        />
      )}

      {/* Quick add — never for employees */}
      {showQuickAdd && (
        <QuickAddModal
          initialType={
            activeDef &&
            ["customer", "supplier", "subscriber"].includes(
              activeDef.contactType ?? "",
            )
              ? (activeDef.contactType as ContactType)
              : "customer"
          }
          onClose={() => setShowQuickAdd(false)}
          onSuccess={(id) => navigate(`/contacts/${id}`)}
        />
      )}

      {showQR && <WalkInQR onClose={() => setShowQR(false)} />}
      {showOnlineQR && <OnlineQR onClose={() => setShowOnlineQR(false)} />}

      {/* Power Plus — one button, every way to add a contact */}
      <AddSheet
        open={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        fullFormLabel={primaryLabel}
        showQuickAdd={showQuickAddTile}
        showDataTools={showDataTools}
        onQuickAdd={() => setShowQuickAdd(true)}
        onFullForm={onPrimaryAdd}
        onImported={() => {
          queryClient.invalidateQueries({ queryKey: ["contacts"] });
          queryClient.invalidateQueries({ queryKey: ["contact-stats"] });
        }}
      />

      {/* QR pill — reveals the two QR flows */}
      <QrSheet
        open={showQrSheet}
        onClose={() => setShowQrSheet(false)}
        onWalkIn={() => setShowQR(true)}
        onOnline={() => setShowOnlineQR(true)}
      />
    </div>
  );
}

/** A large tap target used in the Add and QR sheets. */
function SheetOption({
  icon,
  title,
  desc,
  primary,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full flex items-center gap-3.5 p-4 rounded-[16px] border text-left transition-colors",
        primary
          ? "bg-accent-deep/[0.14] border-accent-deep/40 hover:bg-accent-deep/[0.2]"
          : "bg-text-primary/[0.035] border-line hover:bg-text-primary/[0.06]",
      ].join(" ")}
    >
      <span className="grid place-items-center w-11 h-11 rounded-[13px] flex-shrink-0 text-accent-glow bg-accent/[0.12] border border-accent/25">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-text-primary">
          {title}
        </span>
        <span className="block text-[12px] text-text-muted">{desc}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-text-faint flex-shrink-0" />
    </button>
  );
}

/** The Power-Plus add sheet: Quick Add + full form, plus data tools. */
function AddSheet({
  open,
  onClose,
  fullFormLabel,
  showQuickAdd,
  showDataTools,
  onQuickAdd,
  onFullForm,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  fullFormLabel: string;
  showQuickAdd: boolean;
  showDataTools: boolean;
  onQuickAdd: () => void;
  onFullForm: () => void;
  onImported: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add a contact">
      <div className="space-y-2.5">
        {showQuickAdd && (
          <SheetOption
            icon={<Zap className="w-5 h-5" />}
            title="Quick Add"
            desc="Name, phone & source — fast capture"
            primary
            onClick={() => {
              onClose();
              onQuickAdd();
            }}
          />
        )}
        <SheetOption
          icon={<UserPlus className="w-5 h-5" />}
          title={fullFormLabel}
          desc="The full guided form — every field"
          primary={!showQuickAdd}
          onClick={() => {
            onClose();
            onFullForm();
          }}
        />

        {showDataTools && (
          <div className="pt-3">
            <div className="micro mb-2.5">Data tools</div>
            <ContactsImportExport
              variant="sheet"
              onImported={onImported}
              onOpenModal={onClose}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

/** The QR pill's chooser: Walk-in vs Online onboarding QR. */
function QrSheet({
  open,
  onClose,
  onWalkIn,
  onOnline,
}: {
  open: boolean;
  onClose: () => void;
  onWalkIn: () => void;
  onOnline: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Share a QR code">
      <div className="space-y-2.5">
        <SheetOption
          icon={<Store className="w-5 h-5" />}
          title="Walk-in QR"
          desc="A standing counter code — scan to self-register"
          onClick={() => {
            onClose();
            onWalkIn();
          }}
        />
        <SheetOption
          icon={<Globe className="w-5 h-5" />}
          title="Online QR"
          desc="A one-time link to DM or share online"
          onClick={() => {
            onClose();
            onOnline();
          }}
        />
      </div>
    </Modal>
  );
}

function ContactCard({
  contact,
  idx,
  onClick,
}: {
  contact: Contact;
  idx: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left rounded-[14px] glass border hairline p-4 hover:border-accent/40 transition-colors"
    >
      <div className="flex items-center gap-3">
        <ContactAvatar name={contact.display_name} idx={idx} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-[14px] font-medium text-text-primary truncate">
              {contact.display_name}
            </div>
            <VipStar level={contact.priority_level} />
          </div>
          {contact.company_name && (
            <div className="text-[11px] text-text-faint truncate">
              {contact.company_name}
            </div>
          )}
        </div>
        {contact.priority_level === "new" && (
          <Pill tone="info" dot={false}>
            New
          </Pill>
        )}
      </div>
      <div className="flex flex-wrap gap-1 mt-3">
        {contact.contact_type.slice(0, 3).map((t) => {
          const def = stakeholderForType(t);
          return (
            <Pill key={t} tone={def?.tone ?? "neutral"} dot={false}>
              {TYPE_LABELS[t] ?? t}
            </Pill>
          );
        })}
        {contact.is_ambassador && (
          <Pill tone="accent" dot={false}>
            Ambassador
          </Pill>
        )}
      </div>
      <div className="mt-3 text-[12px] text-text-muted font-mono truncate">
        {contact.primary_phone ?? contact.email ?? "—"}
      </div>
    </button>
  );
}

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 h-[34px] rounded-[10px] text-[12.5px] font-semibold border transition-all whitespace-nowrap",
        active
          ? "bg-accent-deep text-[#F4E9D9] border-accent-deep"
          : "bg-text-primary/[0.04] border-line text-text-muted hover:text-text-primary hover:bg-text-primary/[0.07]",
      ].join(" ")}
    >
      {icon}
      {label}
    </button>
  );
}
