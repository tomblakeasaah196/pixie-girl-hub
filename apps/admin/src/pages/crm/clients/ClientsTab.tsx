import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, MessageCircle, Phone, ChevronRight } from "lucide-react";
import { Button, Pill, Skeleton } from "@/components/ui/primitives";
import { useContacts } from "../hooks";
import { NewDealModal } from "../shared/NewDealModal";
import { ContactDetailDrawer } from "@/pages/contacts/ContactDetailDrawer";
import { ContactFormModal } from "@/pages/contacts/ContactFormModal";
import type { Contact } from "@/pages/contacts/types";
import type { ClientSegment } from "../types";

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

const SEGMENT_OPTIONS: { key: ClientSegment; label: string }[] = [
  { key: "all", label: "All" },
  { key: "vip", label: "VIP" },
  { key: "new", label: "New" },
  { key: "regular", label: "Regular" },
  { key: "high_risk", label: "At risk" },
];

// ── Contact row ───────────────────────────────────────────────────────────

function ClientRow({
  contact,
  onOpen,
  onNewDeal,
}: {
  contact: Contact;
  onOpen: () => void;
  onNewDeal: () => void;
}) {
  const PRIORITY_TONE = {
    vip: "accent",
    regular: "neutral",
    new: "info",
  } as const;

  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3 p-3 rounded-[13px] bg-text-primary/[0.03] border hairline hover:bg-text-primary/[0.06] transition-colors cursor-pointer group"
    >
      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full grid place-items-center text-sm font-semibold text-white font-display flex-shrink-0"
        style={{ background: avatarColor(contact.display_name) }}
      >
        {initials(contact.display_name)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-text-primary truncate">
            {contact.display_name}
          </span>
          <Pill tone={PRIORITY_TONE[contact.priority_level]} dot={false}>
            {contact.priority_level}
          </Pill>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-faint">
          {contact.primary_phone && (
            <span className="font-mono">{contact.primary_phone}</span>
          )}
          {contact.email && !contact.primary_phone && (
            <span>{contact.email}</span>
          )}
          {contact.source && (
            <span className="capitalize">
              {contact.source.replace(/_/g, " ")}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {contact.whatsapp_number && (
          <a
            href={`https://wa.me/${contact.whatsapp_number.replace(/\D/g, "")}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="w-8 h-8 grid place-items-center rounded-[9px] bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </a>
        )}
        {contact.primary_phone && !contact.whatsapp_number && (
          <a
            href={`tel:${contact.primary_phone}`}
            onClick={(e) => e.stopPropagation()}
            className="w-8 h-8 grid place-items-center rounded-[9px] bg-text-primary/[0.08] text-text-muted hover:text-text-primary transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
          </a>
        )}
        <button
          type="button"
          title="New deal"
          onClick={(e) => {
            e.stopPropagation();
            onNewDeal();
          }}
          className="w-8 h-8 grid place-items-center rounded-[9px] bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <ChevronRight className="w-4 h-4 text-text-faint" />
      </div>
    </div>
  );
}

// ── Main clients tab ──────────────────────────────────────────────────────

export function ClientsTab() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<ClientSegment>("all");
  const [page, setPage] = useState(1);
  const [openContactId, setOpenContactId] = useState<string | null>(null);
  const [newDealFor, setNewDealFor] = useState<Contact | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const priorityFilter =
    segment === "vip"
      ? "vip"
      : segment === "new"
        ? "new"
        : segment === "regular"
          ? "regular"
          : undefined;

  const { data, isLoading } = useContacts({
    q: search || undefined,
    priority_level: priorityFilter,
    contact_type: "customer",
    page,
    page_size: 20,
  });

  const contacts = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div>
      {/* Search + actions */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search clients…"
            className="w-full h-[38px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/40 transition-colors"
          />
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() => setShowCreate(true)}
        >
          Add client
        </Button>
      </div>

      {/* Segment filter */}
      <div className="flex gap-1 p-0.5 rounded-[10px] bg-text-primary/[0.04] border hairline mb-4 w-fit">
        {SEGMENT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setSegment(key);
              setPage(1);
            }}
            className={[
              "px-3 h-[28px] rounded-[8px] text-[11.5px] font-semibold transition-all",
              segment === key
                ? "bg-accent-deep text-[#F4E9D9]"
                : "text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[66px] rounded-[13px]" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="py-12 text-center">
          <div className="text-text-faint text-[13px]">
            No clients match this filter
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => setShowCreate(true)}
          >
            Add a client
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {contacts.map((c) => (
            <ClientRow
              key={c.contact_id}
              contact={c}
              onOpen={() => setOpenContactId(c.contact_id)}
              onNewDeal={() => setNewDealFor(c)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {meta && meta.total > meta.page_size && (
        <div className="flex items-center justify-between mt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Previous
          </Button>
          <span className="text-[11px] text-text-faint">
            {(page - 1) * meta.page_size + 1}–
            {Math.min(page * meta.page_size, meta.total)} of {meta.total}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={!meta.has_more}
          >
            Next
          </Button>
        </div>
      )}

      {/* Contact detail drawer */}
      <ContactDetailDrawer
        contactId={openContactId}
        onClose={() => setOpenContactId(null)}
      />

      {/* New deal modal */}
      {newDealFor && (
        <NewDealModal
          contactId={newDealFor.contact_id}
          contactName={newDealFor.display_name}
          onClose={() => setNewDealFor(null)}
          onCreated={(id) => navigate(`/crm/deals/${id}`)}
        />
      )}

      {/* Create contact modal */}
      {showCreate && <ContactFormModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
