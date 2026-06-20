import { useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Users, QrCode, Search, UserPlus } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button, Pill, KpiTile, type Tone } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useContacts } from "./hooks";
import { ContactFormModal } from "./ContactFormModal";
import { QuickAddModal } from "./QuickAddModal";
import { WalkInQR } from "./WalkInQR";
import { directoryTabs, stakeholderForType } from "./stakeholders";
import { TYPE_LABELS } from "./ContactDetailPanel";
import type { Contact, ContactType, PriorityLevel } from "./types";

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

// "all" + the per-stakeholder tabs shipped this phase.
type TabKey = "all" | ContactType;

export function ContactsPage() {
  useBreadcrumbs([{ label: "Contacts" }]);

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabs = directoryTabs(); // phase-1 stakeholders
  const initialTab = (searchParams.get("tab") as TabKey) || "all";
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabs.some((t) => t.contactType === initialTab) ? initialTab : "all",
  );

  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [page, setPage] = useState(1);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // The active stakeholder tab IS the contact_type server filter — so when you
  // open Clients, only clients come back from the API.
  const activeDef =
    activeTab !== "all" ? stakeholderForType(activeTab) : undefined;

  const params = {
    ...(search ? { q: search } : {}),
    ...(activeTab !== "all" ? { contact_type: activeTab } : {}),
    ...(priorityFilter ? { priority_level: priorityFilter } : {}),
    page,
    page_size: 25,
  };

  const { data, isLoading } = useContacts(params);
  const contacts = data?.data ?? [];
  const meta = data?.meta;

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

  // Context-aware "add" — employees go to full onboarding; everyone else can
  // quick-add or open the full form, pre-typed to the active tab.
  const onPrimaryAdd = () => {
    if (activeTab === "staff") navigate("/contacts/staff/new");
    else setShowCreateModal(true);
  };

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

  return (
    <div className="animate-fade-in">
      {/* Header + page-level CTAs (no longer teleported to the top bar) */}
      <div className="flex items-center mb-4 gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl text-text-primary">Contacts</h1>
          {meta && (
            <p className="text-[12px] text-text-faint mt-0.5">
              {meta.total.toLocaleString()} {emptyLabel}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {activeTab !== "staff" && (
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
            {activeTab === "staff"
              ? "Onboard Employee"
              : activeDef
                ? `New ${activeDef.label}`
                : "New Contact"}
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
              active={activeTab === def.contactType}
              onClick={() => changeTab(def.contactType as TabKey)}
            />
          );
        })}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiTile
          label={`Total ${emptyLabel}`}
          value={meta ? meta.total.toLocaleString() : "—"}
        />
        <KpiTile label="VIP" value="—" tone="accent" />
        <KpiTile label="New this month" value="—" tone="info" />
        <KpiTile label="At-risk" value="—" tone="warn" />
      </div>

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
              {activeTab === "staff"
                ? "Onboard Employee"
                : activeDef
                  ? `New ${activeDef.label}`
                  : "New Contact"}
            </Button>
          ),
        }}
      />
      {pagination}

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
