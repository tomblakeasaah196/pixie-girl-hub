import { useMemo, useState } from "react";
import { Plus, Store, ChevronRight } from "lucide-react";
import { Button, MoneyText } from "@/components/ui/primitives";
import type { Column } from "@/components/ui/DataTable";
import { useAuthStore } from "@/stores/auth";
import { usePartners } from "./hooks";
import { PartnerFormModal } from "./PartnerFormModal";
import { PartnerDrawer } from "./PartnerDrawer";
import {
  SearchBox,
  ResponsiveTable,
  PartnerStatusPill,
} from "./parts";
import { fmtDate } from "./format";
import type { PartnerStatus, RetailPartner } from "./types";
import { FREQUENCY_LABEL, num } from "./types";

const STATUS_CHIPS: { value: "" | PartnerStatus; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending_approval", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "terminated", label: "Terminated" },
];

export default function PartnersTab({
  onGoToSettlements,
}: {
  onGoToSettlements: (partnerId: string) => void;
}) {
  const can = useAuthStore((s) => s.can);
  const canCreate = can("retail_partners", "create");

  const [statusFilter, setStatusFilter] = useState<"" | PartnerStatus>("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [openPartnerId, setOpenPartnerId] = useState<string | null>(null);

  const { data: partners = [], isLoading, isError, error, refetch } =
    usePartners();

  const rows = useMemo(() => {
    let list = partners;
    if (statusFilter) list = list.filter((p) => p.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        [p.partner_code, p.display_name, p.company_name, p.primary_phone, p.email]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    return list;
  }, [partners, statusFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of partners) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [partners]);

  const columns: Column<RetailPartner>[] = useMemo(
    () => [
      {
        key: "code",
        header: "Code",
        width: "130px",
        render: (p) => (
          <span className="font-mono text-[12px] text-accent-glow">
            {p.partner_code}
          </span>
        ),
      },
      {
        key: "partner",
        header: "Partner",
        render: (p) => (
          <div className="min-w-0">
            <div className="text-[13px] font-medium truncate max-w-[220px]">
              {p.display_name}
            </div>
            {(p.company_name || p.primary_phone) && (
              <div className="text-[11.5px] text-text-faint truncate max-w-[220px]">
                {[p.company_name, p.primary_phone].filter(Boolean).join(" · ")}
              </div>
            )}
          </div>
        ),
      },
      {
        key: "margin",
        header: "Margin",
        width: "90px",
        align: "right",
        render: (p) => (
          <span className="tabular-nums">{num(p.margin_share_pct)}%</span>
        ),
      },
      {
        key: "terms",
        header: "Terms",
        width: "90px",
        align: "right",
        render: (p) => (
          <span className="tabular-nums text-text-muted">
            {p.payment_terms_days}d
          </span>
        ),
      },
      {
        key: "credit",
        header: "Credit limit",
        width: "130px",
        align: "right",
        render: (p) =>
          p.credit_limit_ngn ? (
            <MoneyText ngn={num(p.credit_limit_ngn)} className="text-[13px]" />
          ) : (
            <span className="text-text-faint">—</span>
          ),
      },
      {
        key: "frequency",
        header: "Settles",
        width: "110px",
        render: (p) => (
          <span className="text-[12.5px] text-text-muted">
            {FREQUENCY_LABEL[p.settlement_frequency]}
          </span>
        ),
      },
      {
        key: "since",
        header: "Since",
        width: "110px",
        render: (p) => (
          <span className="text-[12.5px] text-text-muted">
            {fmtDate(p.onboarded_at)}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        width: "140px",
        render: (p) => <PartnerStatusPill status={p.status} />,
      },
      {
        key: "chev",
        header: "",
        width: "40px",
        render: () => <ChevronRight className="w-4 h-4 text-text-faint" />,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_CHIPS.map((c) => {
            const on = statusFilter === c.value;
            const count = c.value === "" ? partners.length : (counts[c.value] ?? 0);
            return (
              <button
                key={c.value || "all"}
                type="button"
                onClick={() => setStatusFilter(c.value)}
                className={`px-2.5 py-1.5 rounded-[9px] text-[12px] font-semibold border transition-colors ${
                  on
                    ? "border-accent/45 text-accent-glow bg-accent/[0.1]"
                    : "border-line text-text-muted hover:text-text-primary"
                }`}
              >
                {c.label}
                <span className="ml-1.5 tabular-nums opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="Search code, name, phone…"
        />
        <div className="flex-1" />
        {canCreate && (
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setCreateOpen(true)}
          >
            Add partner
          </Button>
        )}
      </div>

      <ResponsiveTable<RetailPartner>
        columns={columns}
        rows={rows}
        rowKey={(p) => p.partner_id}
        onRowClick={(p) => setOpenPartnerId(p.partner_id)}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => refetch()}
        empty={{
          icon: <Store className="w-6 h-6" />,
          title: "No retail partners yet",
          message:
            "Consignment partners hold your stock, sell it in their boutiques, and settle with you on a schedule.",
          action: canCreate ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              Add your first partner
            </Button>
          ) : undefined,
        }}
        card={(p) => (
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold truncate">
                {p.display_name}
              </div>
              <div className="text-[11.5px] text-text-faint font-mono">
                {p.partner_code}
              </div>
              <div className="text-[12px] text-text-muted mt-0.5">
                {num(p.margin_share_pct)}% margin ·{" "}
                {FREQUENCY_LABEL[p.settlement_frequency]}
              </div>
            </div>
            <PartnerStatusPill status={p.status} />
          </div>
        )}
      />

      <PartnerFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <PartnerDrawer
        partnerId={openPartnerId}
        onClose={() => setOpenPartnerId(null)}
        onGoToSettlements={(id) => {
          setOpenPartnerId(null);
          onGoToSettlements(id);
        }}
      />
    </div>
  );
}
