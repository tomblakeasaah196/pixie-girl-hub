import { useState, useCallback } from "react";
import { Plus, Users, QrCode, Search } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Button, Pill, KpiTile, type Tone } from "@/components/ui/primitives";
import { useContacts } from "./hooks";
import { ContactDetailDrawer } from "./ContactDetailDrawer";
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

export function ContactsPage() {
  useBreadcrumbs([{ label: "Contacts" }]);

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

  const handleRowClick = useCallback((c: Contact) => setSelectedId(c.contact_id), []);

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
              <span className="text-[11px] text-text-faint truncate">{c.email}</span>
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
      render: (c) => <Pill tone={PRIORITY_TONE[c.priority_level]}>{c.priority_level}</Pill>,
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

      {/* Type filter */}
      <select
        value={typeFilter}
        onChange={(e) => {
          setTypeFilter(e.target.value);
          setPage(1);
        }}
        className="h-[36px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
      >
        <option value="">All types</option>
        <option value="customer">Customers</option>
        <option value="supplier">Suppliers</option>
        <option value="staff">Staff</option>
        <option value="retail_partner">Retail Partners</option>
        <option value="stylist_partner">Stylists</option>
      </select>

      {/* Priority filter */}
      <select
        value={priorityFilter}
        onChange={(e) => {
          setPriorityFilter(e.target.value);
          setPage(1);
        }}
        className="h-[36px] px-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
      >
        <option value="">All priorities</option>
        <option value="vip">VIP</option>
        <option value="regular">Regular</option>
        <option value="new">New</option>
      </select>

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

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center mb-4 gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-2xl text-text-primary">Contacts</h1>
          {meta && (
            <p className="text-[12px] text-text-faint mt-0.5">
              {meta.total.toLocaleString()} contacts
            </p>
          )}
        </div>
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

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiTile label="Total contacts" value={meta ? meta.total.toLocaleString() : "—"} />
        <KpiTile
          label="VIP clients"
          value="—"
          tone="accent"
          delta={undefined}
        />
        <KpiTile label="New this month" value="—" tone="info" />
        <KpiTile label="At-risk" value="—" tone="warn" />
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
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

      {/* Pagination */}
      {meta && meta.total > meta.page_size && (
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
      )}

      {/* 360° Detail Drawer */}
      <ContactDetailDrawer
        contactId={selectedId}
        onClose={() => setSelectedId(null)}
      />

      {/* Create Modal */}
      {showCreateModal && (
        <ContactFormModal
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* Quick Add Modal */}
      {showQuickAdd && (
        <QuickAddModal
          onClose={() => setShowQuickAdd(false)}
        />
      )}

      {/* Walk-in QR Modal */}
      {showQR && <WalkInQR onClose={() => setShowQR(false)} />}
    </div>
  );
}
