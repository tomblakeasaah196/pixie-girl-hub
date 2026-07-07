import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Plus,
  MessageCircle,
  Phone,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { Button, Pill, Skeleton, MoneyText } from "@/components/ui/primitives";
import { useCrmClients } from "../hooks";
import { ContactFormModal } from "@/pages/contacts/ContactFormModal";
import type { ClientChip, ClientSort, CrmClient } from "../types";

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

function clientName(c: CrmClient) {
  return (
    c.display_name ||
    [c.first_name, c.last_name].filter(Boolean).join(" ") ||
    c.email ||
    "Client"
  );
}

function relTime(iso: string | null) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

const CHIPS: { key: ClientChip | "all"; label: string }[] = [
  { key: "all", label: "All clients" },
  { key: "vip", label: "VIP" },
  { key: "big_spender", label: "Big spenders" },
  { key: "new", label: "New" },
  { key: "win_back", label: "Win back" },
  { key: "birthdays_soon", label: "Birthdays soon" },
];

const SORTS: { key: ClientSort; label: string }[] = [
  { key: "recent", label: "Recently active" },
  { key: "top_spend", label: "Top spend" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Longest clients" },
  { key: "name", label: "Name A–Z" },
];

const CHURN_TONE = {
  low: "success",
  medium: "warn",
  high: "warn",
  critical: "danger",
} as const;

// ── Client row ────────────────────────────────────────────────────────────

function ClientRow({ client, onOpen }: { client: CrmClient; onOpen: () => void }) {
  const name = clientName(client);
  const isNew =
    Date.now() - new Date(client.created_at).getTime() < 30 * 86_400_000;
  const spend = parseFloat(client.lifetime_spend_ngn || "0");

  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3 p-3 rounded-[13px] bg-text-primary/[0.03] border hairline hover:bg-text-primary/[0.06] transition-colors cursor-pointer group"
    >
      {/* Avatar */}
      <div
        className="w-10 h-10 rounded-full grid place-items-center text-sm font-semibold text-white font-display flex-shrink-0"
        style={{ background: avatarColor(name) }}
      >
        {initials(name)}
      </div>

      {/* Identity */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-text-primary truncate">
            {name}
          </span>
          {client.priority_level === "vip" && (
            <Pill tone="accent" dot={false}>
              VIP
            </Pill>
          )}
          {isNew && (
            <Pill tone="info" dot>
              NEW
            </Pill>
          )}
          {(client.churn_risk_band === "high" ||
            client.churn_risk_band === "critical") && (
            <Pill tone={CHURN_TONE[client.churn_risk_band]} dot={false}>
              {client.churn_risk_band === "critical" ? "At risk!" : "At risk"}
            </Pill>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-faint">
          {client.orders_count === 0 ? (
            <span>No purchases yet</span>
          ) : (
            <span>
              {client.orders_count} purchase
              {client.orders_count === 1 ? "" : "s"}
              {client.last_order_at && ` · last ${relTime(client.last_order_at)}`}
            </span>
          )}
          {client.loyalty_points > 0 && (
            <span>· {client.loyalty_points.toLocaleString()} pts</span>
          )}
        </div>
      </div>

      {/* Lifetime spend */}
      <div className="flex flex-col items-end flex-shrink-0">
        <span className="text-[12.5px] font-mono text-text-primary tabular-nums">
          <MoneyText ngn={spend} />
        </span>
        <span className="text-[10px] text-text-faint">lifetime</span>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {client.primary_phone && (
          <>
            <a
              href={`https://wa.me/${client.primary_phone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="w-8 h-8 grid place-items-center rounded-[9px] bg-[#25D366]/10 text-[#25D366] hover:bg-[#25D366]/20 transition-colors"
              title="WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5" />
            </a>
            <a
              href={`tel:${client.primary_phone}`}
              onClick={(e) => e.stopPropagation()}
              className="w-8 h-8 grid place-items-center rounded-[9px] bg-text-primary/[0.08] text-text-muted hover:text-text-primary transition-colors"
              title="Call"
            >
              <Phone className="w-3.5 h-3.5" />
            </a>
          </>
        )}
        <ChevronRight className="w-4 h-4 text-text-faint" />
      </div>
    </div>
  );
}

// ── Main clients tab ──────────────────────────────────────────────────────

export function ClientsTab() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<ClientChip | "all">("all");
  const [sort, setSort] = useState<ClientSort>("recent");
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, isError, refetch } = useCrmClients({
    q: search || undefined,
    chip: chip === "all" ? undefined : chip,
    sort,
    page,
    page_size: 20,
  });

  const clients = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div>
      {/* Search + sort + add */}
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
            placeholder="Find a client — name, phone, email…"
            className="w-full h-[38px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-[13px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent/40 transition-colors" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
          />
        </div>
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as ClientSort);
              setPage(1);
            }}
            className="h-[38px] pl-3 pr-8 rounded-[11px] bg-text-primary/[0.04] border border-line text-[12.5px] text-text-primary appearance-none focus:outline-none focus:border-accent/40 transition-colors cursor-pointer"
            aria-label="Sort clients"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
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

      {/* Preset chips (same cut-offs as the backend segment presets) */}
      <div className="flex gap-1 p-0.5 rounded-[10px] bg-text-primary/[0.04] border hairline mb-4 w-fit max-w-full overflow-x-auto">
        {CHIPS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setChip(key);
              setPage(1);
            }}
            className={[
              "px-3 h-[28px] rounded-[8px] text-[11.5px] font-semibold whitespace-nowrap transition-all",
              chip === key
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
      ) : isError ? (
        <div className="py-12 text-center">
          <div className="text-text-faint text-[13px] mb-3">
            Couldn't load clients.
          </div>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      ) : clients.length === 0 ? (
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
          {clients.map((c) => (
            <ClientRow
              key={c.contact_id}
              client={c}
              onOpen={() => navigate(`/crm/clients/${c.contact_id}`)}
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

      {/* Create contact modal */}
      {showCreate && <ContactFormModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
