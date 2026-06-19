import { useState, useCallback } from "react";
import { Plus, Users, QrCode, Search, Pencil, UserSquare2 } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { DataTable, type Column } from "@/components/ui/DataTable";
import {
  Button,
  Pill,
  KpiTile,
  Skeleton,
  type Tone,
} from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useContact, useContacts } from "./hooks";
import { ContactDetailDrawer } from "./ContactDetailDrawer";
import {
  ContactDetailPanel,
  MessageButton,
  PRIORITY_TONE as DETAIL_PRIORITY_TONE,
  TYPE_LABELS as DETAIL_TYPE_LABELS,
  AVATAR_COLORS as DETAIL_AVATAR_COLORS,
  bigInitials,
} from "./ContactDetailPanel";
import { ContactFormModal } from "./ContactFormModal";
import { QuickAddModal } from "./QuickAddModal";
import { WalkInQR } from "./WalkInQR";
import type { Contact, ContactType, PriorityLevel } from "./types";

const TYPE_LABELS: Record<ContactType, string> = {
  customer: "Customer",
  supplier: "Supplier",
  staff: "Staff",
  retail_partner: "Retail",
  stylist_partner: "Stylist",
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

// Themed-select option sets for the toolbar filters
const TYPE_FILTER_OPTS = [
  { value: "", label: "All types" },
  { value: "customer", label: "Customers" },
  { value: "supplier", label: "Suppliers" },
  { value: "staff", label: "Staff" },
  { value: "retail_partner", label: "Retail Partners" },
  { value: "stylist_partner", label: "Stylists" },
];

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

// ── Desktop master-detail right pane ───────────────────────────────────────
// Desktop-only: wraps the shared `ContactDetailPanel` with header chrome
// (avatar, name, priority, Message/Edit) that the Drawer otherwise supplies.
// Rendered only inside the `isDesktop` branch, so phone/tablet never see it.

function DesktopDetailPane({ contactId }: { contactId: string }) {
  const { data: contact, isLoading } = useContact(contactId);
  const [showEdit, setShowEdit] = useState(false);

  const colorIdx = contact
    ? Math.abs(
        contact.display_name
          .split("")
          .reduce((acc, ch) => acc + ch.charCodeAt(0), 0),
      ) % DETAIL_AVATAR_COLORS.length
    : 0;

  return (
    <div className="rounded-[16px] glass border hairline overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-5 border-b hairline">
        {contact && (
          <div
            className="w-10 h-10 rounded-full grid place-items-center text-sm font-semibold text-white font-display flex-shrink-0"
            style={{ background: DETAIL_AVATAR_COLORS[colorIdx] }}
          >
            {bigInitials(contact.display_name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {isLoading ? (
            <Skeleton className="w-32 h-5 rounded-md" />
          ) : (
            <>
              <h2 className="font-display text-xl font-medium leading-tight truncate flex items-center gap-2">
                {contact?.display_name ?? ""}
                {contact && (
                  <Pill
                    tone={DETAIL_PRIORITY_TONE[contact.priority_level]}
                    dot={false}
                  >
                    {contact.priority_level}
                  </Pill>
                )}
              </h2>
              {contact && (
                <div className="micro mt-0.5 flex items-center gap-1.5">
                  {contact.contact_type
                    .map((t) => DETAIL_TYPE_LABELS[t] ?? t)
                    .join(" · ")}
                  {contact.source && (
                    <>
                      <span className="text-text-faint">·</span>
                      <span className="capitalize">
                        {contact.source.replace(/_/g, " ")}
                      </span>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        {contact && (
          <div className="flex gap-2 flex-shrink-0">
            <MessageButton contact={contact} />
            <Button
              size="sm"
              variant="primary"
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => setShowEdit(true)}
            >
              Edit
            </Button>
          </div>
        )}
      </div>

      {/* Body — the shared panel */}
      <div className="p-[22px]">
        <ContactDetailPanel contactId={contactId} />
      </div>

      {showEdit && contact && (
        <ContactFormModal
          contact={contact}
          onClose={() => setShowEdit(false)}
        />
      )}
    </div>
  );
}

function SelectContactPrompt() {
  return (
    <div className="rounded-[16px] glass border hairline grid place-items-center text-center px-6 py-20">
      <div>
        <span className="grid place-items-center w-12 h-12 rounded-xl bg-text-primary/[0.06] text-text-faint mb-3 mx-auto">
          <UserSquare2 className="w-6 h-6" />
        </span>
        <div className="font-display text-[16px] text-text-primary mb-1">
          Select a contact
        </div>
        <p className="text-[13px] text-text-muted max-w-[320px]">
          Pick a contact from the list to see their full 360° profile, timeline,
          deals and more.
        </p>
      </div>
    </div>
  );
}

export function ContactsPage() {
  useBreadcrumbs([{ label: "Contacts" }]);

  const isDesktop = useIsDesktop();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [page, setPage] = useState(1);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const params = {
    ...(search ? { q: search } : {}),
    ...(typeFilter ? { contact_type: typeFilter } : {}),
    ...(priorityFilter ? { priority_level: priorityFilter } : {}),
    page,
    page_size: 25,
  };

  const { data, isLoading } = useContacts(params);
  const contacts = data?.data ?? [];
  const meta = data?.meta;

  const handleRowClick = useCallback(
    (c: Contact) => setSelectedId(c.contact_id),
    [],
  );

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
          {c.contact_type.slice(0, 2).map((t) => (
            <Pill key={t} tone="neutral" dot={false}>
              {TYPE_LABELS[t] ?? t}
            </Pill>
          ))}
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

  // On the desktop master-detail layout the right pane already carries the
  // Type/Priority/Source columns, so the left list drops them to stay readable
  // in the narrow column. Phone/tablet keep the full column set.
  const visibleColumns = isDesktop
    ? columns.filter((c) => c.key === "name" || c.key === "priority")
    : columns;

  const toolbar = (
    <div className="flex flex-col sm:flex-row gap-3 p-[14px_18px] border-b hairline">
      {/* Search */}
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
        <input
          type="text"
          placeholder="Search contacts…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full h-[36px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/50 transition-colors"
        />
      </div>

      {/* Type filter (themed Select) */}
      <Select
        value={typeFilter}
        onChange={(v) => {
          setTypeFilter(v);
          setPage(1);
        }}
        options={TYPE_FILTER_OPTS}
        className="sm:w-[170px]"
      />

      {/* Priority filter (themed Select) */}
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

      {/* Walk-in QR */}
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

  const table = (
    <DataTable
      columns={visibleColumns}
      rows={contacts}
      rowKey={(c) => c.contact_id}
      onRowClick={handleRowClick}
      loading={isLoading}
      toolbar={toolbar}
      empty={{
        icon: <Users className="w-8 h-8" />,
        title: "No contacts yet",
        message: "Add your first contact or scan the walk-in QR code.",
        action: (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowCreateModal(true)}
          >
            New Contact
          </Button>
        ),
      }}
    />
  );

  return (
    <div className="animate-fade-in">
      {/* Header — primary CTAs teleport to the top bar on desktop via
          PageActions; on phone/tablet they render inline here as today. */}
      <div className="flex items-center mb-4 gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl text-text-primary">Contacts</h1>
          {meta && (
            <p className="text-[12px] text-text-faint mt-0.5">
              {meta.total.toLocaleString()} contacts
            </p>
          )}
        </div>
        {/* Primary CTAs live in the page header (not teleported to the top bar). */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowQuickAdd(true)}
          >
            Quick Add
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setShowCreateModal(true)}
          >
            New Contact
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiTile
          label="Total contacts"
          value={meta ? meta.total.toLocaleString() : "—"}
        />
        <KpiTile
          label="VIP clients"
          value="—"
          tone="accent"
          delta={undefined}
        />
        <KpiTile label="New this month" value="—" tone="info" />
        <KpiTile label="At-risk" value="—" tone="warn" />
      </div>

      {isDesktop ? (
        /* Desktop master-detail: list left, selected contact's detail right. */
        <div className="grid grid-cols-[minmax(380px,460px)_1fr] gap-5 items-start">
          <div className="min-w-0">
            {table}
            {pagination}
          </div>
          <div className="min-w-0">
            {selectedId ? (
              <DesktopDetailPane key={selectedId} contactId={selectedId} />
            ) : (
              <SelectContactPrompt />
            )}
          </div>
        </div>
      ) : (
        /* Phone / tablet: full-width list + overlay detail drawer (unchanged). */
        <>
          {table}
          {pagination}
          <ContactDetailDrawer
            contactId={selectedId}
            onClose={() => setSelectedId(null)}
          />
        </>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <ContactFormModal onClose={() => setShowCreateModal(false)} />
      )}

      {/* Quick Add Modal */}
      {showQuickAdd && <QuickAddModal onClose={() => setShowQuickAdd(false)} />}

      {/* Walk-in QR Modal */}
      {showQR && <WalkInQR onClose={() => setShowQR(false)} />}
    </div>
  );
}
