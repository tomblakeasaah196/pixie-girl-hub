import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Plus,
  Users,
  QrCode,
  Search,
  UserPlus,
  List,
  LayoutGrid,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button, Pill, KpiTile, type Tone } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useContacts } from "./hooks";
import {
  useAmbassadors,
  useStylists,
  type Ambassador,
  type StylistPartner,
} from "./programmesApi";
import { ContactFormModal } from "./ContactFormModal";
import { QuickAddModal } from "./QuickAddModal";
import { WalkInQR } from "./WalkInQR";
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

// "all" + the per-stakeholder tabs shipped this phase. Tab identity is the
// stakeholder KEY (ambassador has no contact_type — it's an overlay).
type TabKey = "all" | ContactType | "ambassador";

export function ContactsPage() {
  useBreadcrumbs([{ label: "Contacts" }]);

  const navigate = useNavigate();
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

  const columns: Column<Contact>[] = [
    {
      key: "name",
      header: "Name",
      render: (c, idx = contacts.indexOf(c)) => (
        <span className="flex items-center gap-2.5">
          <ContactAvatar name={c.display_name} idx={idx} />
          <span className="flex flex-col min-w-0">
            <span className="font-medium text-[13px] text-text-primary truncate">
              {c.display_name}
            </span>
            {c.email && (
              <span className="text-[11px] text-text-faint truncate">
                {c.email}
              </span>
            )}
          </span>
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
          {new Date(c.created_at).toLocaleDateString("en-NG", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
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
          className="w-full h-[36px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 transition-colors"
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

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="sm"
        icon={<QrCode className="w-3.5 h-3.5" />}
        onClick={() => setShowQR(true)}
      >
        Walk-in QR
      </Button>
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
      {/* Header + page-level CTAs (no longer teleported to the top bar) */}
      <div className="flex items-center mb-4 gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl text-text-primary">Contacts</h1>
          {totalCount != null && (
            <p className="text-[12px] text-text-faint mt-0.5">
              {totalCount.toLocaleString()} {emptyLabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isProgrammeTab && (
            <div className="flex items-center rounded-[10px] border border-line overflow-hidden mr-1">
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
          {!isProgrammeTab && activeTab !== "staff" && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Plus className="w-3.5 h-3.5" />}
              onClick={() => setShowQuickAdd(true)}
            >
              Quick Add
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={
              activeTab === "staff" ? (
                <UserPlus className="w-3.5 h-3.5" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )
            }
            onClick={onPrimaryAdd}
          >
            {primaryLabel}
          </Button>
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

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiTile
          label={`Total ${emptyLabel}`}
          value={totalCount != null ? totalCount.toLocaleString() : "—"}
        />
        <KpiTile label="VIP" value="—" tone="accent" />
        <KpiTile label="New this month" value="—" tone="info" />
        <KpiTile label="At-risk" value="—" tone="warn" />
      </div>

      {isAmbassadorTab ? (
        <DataTable<Ambassador>
          columns={ambColumns}
          rows={ambassadors}
          rowKey={(a) => a.contact_id}
          onRowClick={(a) => navigate(`/contacts/${a.contact_id}`)}
          loading={ambLoading}
          toolbar={toolbar}
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
    </div>
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
          <div className="text-[14px] font-medium text-text-primary truncate">
            {contact.display_name}
          </div>
          {contact.company_name && (
            <div className="text-[11px] text-text-faint truncate">
              {contact.company_name}
            </div>
          )}
        </div>
        <Pill tone={PRIORITY_TONE[contact.priority_level]} dot={false}>
          {contact.priority_level}
        </Pill>
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
