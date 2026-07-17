/**
 * Stylists — Stylist Partner Programme (V2.2 §6.26) admin module.
 *
 * PXG-scoped (Q4). Marketing runs vetting/onboarding; Operations handles
 * quality/suspensions; CEO/Finance authorises payouts via the workflow
 * engine. Tabs: Directory · Applications · Assignments · Payouts · Reviews ·
 * Referrals · Programme (config). Four states per canon §4.9;
 * permission-aware per §4.3 (`stylist_programme` module key).
 */

import { useMemo, useState } from "react";
import { useUrlTab } from "@/hooks/useUrlTab";
import { Scissors, Search, Star } from "lucide-react";
import { Pill, KpiTile } from "@/components/ui/primitives";
import { DeniedState, ErrorState, Select } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useAuthStore } from "@/stores/auth";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { ModuleInsights } from "@/components/insights/ModuleInsights";
import { cn } from "@/lib/cn";
import { usePartners, useApplications, useTiers } from "./hooks";
import { PARTNER_STATUS_META } from "./constants";
import type { Partner } from "./types";
import { ApplicationsPanel } from "./ApplicationsPanel";
import { PartnerDrawer } from "./PartnerDrawer";
import { AssignmentsPanel } from "./AssignmentsPanel";
import { PayoutsPanel } from "./PayoutsPanel";
import { ReviewsPanel } from "./ReviewsPanel";
import { ReferralsPanel } from "./ReferralsPanel";
import { ProgrammePanel } from "./ProgrammePanel";

const TABS = [
  "Directory",
  "Applications",
  "Assignments",
  "Payouts",
  "Reviews",
  "Referrals",
  "Programme",
] as const;
type Tab = (typeof TABS)[number];

function DirectoryPanel({
  onOpenPartner,
}: {
  onOpenPartner: (id: string) => void;
}) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const partners = usePartners({ status: status || undefined });
  const tiers = useTiers();
  const tierLabel = useMemo(() => {
    const m = new Map<string, { label: string; color: string | null }>();
    for (const t of tiers.data ?? [])
      m.set(t.tier_key, { label: t.label, color: t.badge_color });
    return m;
  }, [tiers.data]);

  const needle = q.trim().toLowerCase();
  const rows = (partners.data ?? []).filter(
    (p) =>
      !needle ||
      p.display_name.toLowerCase().includes(needle) ||
      p.partner_code.toLowerCase().includes(needle) ||
      p.city.toLowerCase().includes(needle) ||
      (p.state ?? "").toLowerCase().includes(needle),
  );

  const columns: Column<Partner>[] = [
    {
      key: "name",
      header: "Partner",
      render: (p) => (
        <div>
          <div className="font-semibold text-[13px]">{p.display_name}</div>
          <div className="font-mono text-[10.5px] text-text-faint">
            {p.partner_code}
          </div>
        </div>
      ),
    },
    {
      key: "location",
      header: "Location",
      render: (p) => (
        <span className="text-[12.5px]">
          {p.city}
          {p.state ? `, ${p.state}` : ""} · {p.country_code}
        </span>
      ),
    },
    {
      key: "tier",
      header: "Tier",
      render: (p) =>
        p.current_tier_key ? (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide"
            style={{
              color:
                tierLabel.get(p.current_tier_key)?.color ??
                "rgb(var(--accent))",
            }}
          >
            <Star className="w-3 h-3" />
            {tierLabel.get(p.current_tier_key)?.label ?? p.current_tier_key}
          </span>
        ) : (
          <span className="text-text-faint text-[12px]">—</span>
        ),
    },
    {
      key: "rating",
      header: "Rating",
      render: (p) =>
        p.rating_count > 0 ? (
          <span className="tabular-nums text-[12.5px]">
            {Number(p.avg_rating).toFixed(2)}★{" "}
            <span className="text-text-faint">({p.rating_count})</span>
          </span>
        ) : (
          <span className="text-text-faint text-[12px]">No reviews</span>
        ),
    },
    {
      key: "capacity",
      header: "Capacity",
      render: (p) => (
        <span className="tabular-nums text-[12.5px]">
          {p.current_active_count}/{p.max_active_assignments}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => (
        <Pill tone={PARTNER_STATUS_META[p.status].tone}>
          {PARTNER_STATUS_META[p.status].label}
        </Pill>
      ),
    },
    {
      key: "badge",
      header: "Badge",
      render: (p) =>
        p.badge_token && !p.badge_revoked_at ? (
          <Pill tone="success">Live</Pill>
        ) : (
          <span className="text-text-faint text-[12px]">—</span>
        ),
    },
  ];

  if (partners.isError)
    return (
      <ErrorState
        message={(partners.error as Error)?.message}
        onRetry={() => partners.refetch()}
      />
    );

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(p) => p.stylist_id}
      loading={partners.isLoading}
      onRowClick={(p) => onOpenPartner(p.stylist_id)}
      toolbar={
        <>
          <Select
            className="w-44"
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "All statuses" },
              ...Object.entries(PARTNER_STATUS_META).map(([k, m]) => ({
                value: k,
                label: m.label,
              })),
            ]}
          />
          <div className="relative w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint pointer-events-none" />
            <input
              className="input !pl-9"
              placeholder="Search name, code or city…"
              value={q}
              onChange={(e) => setQ(e.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </div>
          <span className="ml-auto micro">
            {rows.length} partner{rows.length === 1 ? "" : "s"}
          </span>
        </>
      }
      empty={{
        icon: <Scissors className="w-6 h-6" />,
        title: "No partners yet",
        message:
          "Approved applicants appear here. Applications land in the Applications tab from the public portal.",
      }}
    />
  );
}

export function StylistsPage() {
  useBreadcrumbs([{ label: "Stylists" }]);
  const can = useAuthStore((s) => s.can);
  const [tab, setTab] = useUrlTab<Tab>("Directory", TABS);
  const [openPartnerId, setOpenPartnerId] = useState<string | null>(null);

  const partners = usePartners({});
  const applications = useApplications();

  if (!can("stylist_programme", "view"))
    return <DeniedState message="You don't have access to the Stylist Partner Programme." />;

  const all = partners.data ?? [];
  const certified = all.filter((p) => p.status === "certified").length;
  const queue = (applications.data ?? []).length;
  const capacity = all
    .filter((p) => p.status === "certified")
    .reduce((s, p) => s + (p.max_active_assignments - p.current_active_count), 0);
  const rated = all.filter((p) => p.rating_count > 0);
  const avgRating = rated.length
    ? (
        rated.reduce((s, p) => s + Number(p.avg_rating ?? 0), 0) / rated.length
      ).toFixed(2)
    : "—";

  const visibleTabs = TABS.filter((t) => {
    if (t === "Payouts") return can("stylist_programme", "view");
    if (t === "Programme") return can("stylist_programme", "view");
    return true;
  });

  return (
    <div className="space-y-5">
      <ModuleInsights module="stylist_programme" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Certified partners" value={String(certified)} />
        <KpiTile
          label="Applications in queue"
          value={String(queue)}
          tone={queue > 0 ? "warn" : "accent"}
        />
        <KpiTile label="Open capacity (jobs)" value={String(capacity)} />
        <KpiTile label="Avg verified rating" value={avgRating} />
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {visibleTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "h-9 px-4 rounded-full text-[12.5px] font-semibold transition-colors",
              tab === t
                ? "bg-accent-deep text-[#F4E9D9] shadow-glass"
                : "glass border hairline text-text-muted hover:text-text-primary",
            )}
          >
            {t}
            {t === "Applications" && queue > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-warn/20 text-warn text-[10px] tabular-nums">
                {queue}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "Directory" && (
        <DirectoryPanel onOpenPartner={setOpenPartnerId} />
      )}
      {tab === "Applications" && (
        <ApplicationsPanel onOpenPartner={setOpenPartnerId} />
      )}
      {tab === "Assignments" && <AssignmentsPanel />}
      {tab === "Payouts" && <PayoutsPanel />}
      {tab === "Reviews" && <ReviewsPanel />}
      {tab === "Referrals" && <ReferralsPanel />}
      {tab === "Programme" && <ProgrammePanel />}

      {openPartnerId && (
        <PartnerDrawer
          stylistId={openPartnerId}
          onClose={() => setOpenPartnerId(null)}
        />
      )}
    </div>
  );
}

