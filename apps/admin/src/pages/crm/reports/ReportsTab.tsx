import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trophy, Grid3x3, Scale, Timer, TrendingUp } from "lucide-react";
import { Button, Skeleton, MoneyText } from "@/components/ui/primitives";
import {
  useReportLtv,
  useReportCohorts,
  useReportWinLoss,
  useReportVelocity,
  useReportForecast,
} from "../hooks";
import type { CohortCell } from "../types";

/*
 * CRM Reports — the BI layer over /crm/reports/*.
 *
 * Visual grammar (per the dataviz method):
 * - Cohort retention = sequential heat TABLE: one hue (the accent), alpha
 *   scaled by value, the % printed in every cell so the table view is the
 *   chart and identity is never colour-alone.
 * - Win/loss = paired horizontal bars on the semantic success/danger tokens
 *   (won/lost is a STATE, not a series) with counts printed beside each bar.
 * - LTV, velocity, forecast = ranked tables with inline single-hue magnitude
 *   bars. Money in JetBrains Mono via MoneyText; text wears text tokens only.
 */

// ── Shared bits ───────────────────────────────────────────────────────────

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Trophy;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-4 rounded-[14px] bg-text-primary/[0.03] border hairline">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-[10px] grid place-items-center bg-accent/10 text-accent flex-shrink-0">
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <div className="text-[13px] font-semibold text-text-primary">
            {title}
          </div>
          <div className="text-[10.5px] text-text-faint">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function LoadingBlock() {
  return <Skeleton className="h-[180px] rounded-[10px]" />;
}

function ErrorBlock({ retry }: { retry: () => void }) {
  return (
    <div className="py-8 text-center">
      <p className="text-[12px] text-text-muted mb-3">
        Couldn't load this report.
      </p>
      <Button variant="secondary" size="sm" onClick={retry}>
        Retry
      </Button>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <p className="py-8 text-center text-[12px] italic text-text-faint">
      {text}
    </p>
  );
}

function monthLabel(iso: string | null) {
  if (!iso) return "Unscheduled";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

// ── LTV ranking ───────────────────────────────────────────────────────────

function LtvSection() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useReportLtv(page, 15);
  const rows = data?.data ?? [];
  const maxSpend = rows.length
    ? Math.max(...rows.map((r) => parseFloat(r.lifetime_spend_ngn)))
    : 0;

  return (
    <SectionCard
      icon={Trophy}
      title="Top clients by lifetime value"
      subtitle="Your highest-buying clients, ranked — with how long they've been with you"
    >
      {isLoading ? (
        <LoadingBlock />
      ) : isError ? (
        <ErrorBlock retry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyBlock text="No paid orders yet — the ranking builds itself as sales land." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left">
                  <th className="micro pb-2 pr-3 font-normal">#</th>
                  <th className="micro pb-2 pr-3 font-normal">Client</th>
                  <th className="micro pb-2 pr-3 font-normal">
                    Lifetime spend
                  </th>
                  <th className="micro pb-2 pr-3 font-normal">Orders</th>
                  <th className="micro pb-2 pr-3 font-normal">Avg order</th>
                  <th className="micro pb-2 font-normal">Client since</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const spend = parseFloat(r.lifetime_spend_ngn);
                  const pct = maxSpend > 0 ? (spend / maxSpend) * 100 : 0;
                  return (
                    <tr
                      key={r.contact_id}
                      onClick={() => navigate(`/crm/clients/${r.contact_id}`)}
                      className="cursor-pointer hover:bg-text-primary/[0.04] transition-colors"
                    >
                      <td className="py-2 pr-3 text-text-faint tabular-nums">
                        {(page - 1) * 15 + i + 1}
                      </td>
                      <td className="py-2 pr-3 text-text-primary font-medium max-w-[180px] truncate">
                        {r.display_name || r.first_name || r.email || "Client"}
                      </td>
                      <td className="py-2 pr-3 min-w-[160px]">
                        <div className="flex items-center gap-2">
                          <span className="font-mono tabular-nums text-text-primary">
                            <MoneyText ngn={spend} />
                          </span>
                          <div className="flex-1 h-[6px] rounded-full bg-text-primary/[0.06] min-w-[40px]">
                            <div
                              className="h-full rounded-full bg-accent/60"
                              style={{ width: `${Math.max(pct, 2)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-text-muted">
                        {r.orders_count}
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums text-text-muted">
                        <MoneyText ngn={parseFloat(r.avg_order_value_ngn)} />
                      </td>
                      <td className="py-2 text-text-muted">
                        {fmtDate(r.first_order_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data?.meta && data.meta.total > 15 && (
            <div className="flex items-center justify-between mt-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-[11px] text-text-faint">
                {data.meta.total} clients
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!data.meta.has_more}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ── Cohort retention heat table ───────────────────────────────────────────

function CohortSection() {
  const { data, isLoading, isError, refetch } = useReportCohorts(12);

  let content: React.ReactNode;
  if (isLoading) content = <LoadingBlock />;
  else if (isError) content = <ErrorBlock retry={refetch} />;
  else {
    const cells = data ?? [];
    if (cells.length === 0) {
      content = (
        <EmptyBlock text="Cohorts appear once clients make their first purchase." />
      );
    } else {
      // rows = cohort months; columns = months since first purchase
      const byMonth = new Map<string, Map<number, number>>();
      for (const c of cells as CohortCell[]) {
        if (!byMonth.has(c.cohort_month))
          byMonth.set(c.cohort_month, new Map());
        byMonth.get(c.cohort_month)!.set(c.month_offset, c.active_customers);
      }
      const months = [...byMonth.keys()].sort();
      const maxOffset = Math.min(
        11,
        Math.max(...cells.map((c: CohortCell) => c.month_offset)),
      );

      content = (
        <div className="overflow-x-auto">
          <table className="text-[11px] border-separate border-spacing-[2px]">
            <thead>
              <tr>
                <th className="micro pr-2 text-left font-normal">Cohort</th>
                <th className="micro px-1 font-normal">Size</th>
                {Array.from({ length: maxOffset + 1 }).map((_, i) => (
                  <th key={i} className="micro px-1 font-normal">
                    M{i}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const row = byMonth.get(m)!;
                const size = row.get(0) ?? 0;
                return (
                  <tr key={m}>
                    <td className="pr-2 text-text-muted whitespace-nowrap">
                      {monthLabel(m)}
                    </td>
                    <td className="px-1 text-center tabular-nums text-text-primary font-medium">
                      {size}
                    </td>
                    {Array.from({ length: maxOffset + 1 }).map((_, off) => {
                      const active = row.get(off);
                      const pct =
                        active != null && size > 0
                          ? Math.round((active / size) * 100)
                          : null;
                      return (
                        <td
                          key={off}
                          title={
                            pct != null
                              ? `${monthLabel(m)} cohort · month ${off}: ${active} of ${size} active (${pct}%)`
                              : undefined
                          }
                          className="w-[42px] h-[30px] text-center rounded-[6px] tabular-nums"
                          style={
                            pct != null
                              ? {
                                  backgroundColor: `rgb(var(--accent) / ${
                                    0.08 + (pct / 100) * 0.55
                                  })`,
                                  color:
                                    pct >= 60
                                      ? "rgb(var(--text))"
                                      : "rgb(var(--text-muted))",
                                }
                              : { backgroundColor: "rgb(var(--text) / 0.02)" }
                          }
                        >
                          {pct != null ? `${pct}%` : ""}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10.5px] text-text-faint mt-2">
            Each row is the clients whose FIRST purchase fell in that month;
            each cell is the share of them still buying N months later.
          </p>
        </div>
      );
    }
  }

  return (
    <SectionCard
      icon={Grid3x3}
      title="Cohort retention"
      subtitle="How many clients from each month keep coming back"
    >
      {content}
    </SectionCard>
  );
}

// ── Win / loss ────────────────────────────────────────────────────────────

function WinLossSection() {
  const { data, isLoading, isError, refetch } = useReportWinLoss(12);

  let content: React.ReactNode;
  if (isLoading) content = <LoadingBlock />;
  else if (isError) content = <ErrorBlock retry={refetch} />;
  else if (!data || data.monthly.length === 0)
    content = (
      <EmptyBlock text="Win/loss trends appear once deals start closing." />
    );
  else {
    const maxCount = Math.max(
      ...data.monthly.map((m) => Math.max(m.won, m.lost)),
      1,
    );
    content = (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Monthly won vs lost — paired horizontal bars, counts printed */}
        <div>
          <div className="micro mb-2">Won vs lost by month</div>
          <div className="flex flex-col gap-2">
            {data.monthly.map((m) => (
              <div key={m.month} className="flex items-center gap-2">
                <span className="text-[10.5px] text-text-faint w-14 flex-shrink-0">
                  {monthLabel(m.month)}
                </span>
                <div className="flex-1 flex flex-col gap-[3px]">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="h-[10px] rounded-[4px] bg-success/70"
                      style={{
                        width: `${Math.max((m.won / maxCount) * 100, m.won > 0 ? 3 : 0)}%`,
                      }}
                    />
                    <span className="text-[10px] tabular-nums text-text-muted">
                      {m.won} won
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div
                      className="h-[10px] rounded-[4px] bg-danger/60"
                      style={{
                        width: `${Math.max((m.lost / maxCount) * 100, m.lost > 0 ? 3 : 0)}%`,
                      }}
                    />
                    <span className="text-[10px] tabular-nums text-text-muted">
                      {m.lost} lost
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Lost reasons */}
        <div>
          <div className="micro mb-2">Why deals were lost</div>
          {data.lost_reasons.length === 0 ? (
            <EmptyBlock text="No lost deals in this window." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.lost_reasons.map((r) => (
                <div
                  key={r.reason}
                  className="flex items-center gap-2 p-2 rounded-[9px] bg-text-primary/[0.03]"
                >
                  <span className="flex-1 text-[11.5px] text-text-primary truncate capitalize">
                    {r.reason}
                  </span>
                  <span className="text-[11px] tabular-nums text-text-muted">
                    {r.deals} deal{r.deals === 1 ? "" : "s"}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-text-faint">
                    <MoneyText ngn={parseFloat(r.value_ngn)} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <SectionCard
      icon={Scale}
      title="Win / loss"
      subtitle="Closed deals over the last 12 months, and why the lost ones died"
    >
      {content}
    </SectionCard>
  );
}

// ── Sales velocity ────────────────────────────────────────────────────────

function VelocitySection() {
  const { data, isLoading, isError, refetch } = useReportVelocity();

  let content: React.ReactNode;
  if (isLoading) content = <LoadingBlock />;
  else if (isError) content = <ErrorBlock retry={refetch} />;
  else if (!data || data.stages.length === 0)
    content = (
      <EmptyBlock text="Stage timings build up as deals move through the pipeline (tracking started with this upgrade)." />
    );
  else {
    content = (
      <>
        {data.close?.won_deals > 0 && data.close.avg_days_to_win && (
          <p className="text-[12px] text-text-muted mb-3">
            Average time to win a deal:{" "}
            <span className="font-mono text-text-primary">
              {data.close.avg_days_to_win} days
            </span>{" "}
            across {data.close.won_deals} won deals.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left">
                <th className="micro pb-2 pr-3 font-normal">Pipeline</th>
                <th className="micro pb-2 pr-3 font-normal">Stage</th>
                <th className="micro pb-2 pr-3 font-normal">Moves</th>
                <th className="micro pb-2 pr-3 font-normal">Avg days</th>
                <th className="micro pb-2 font-normal">Median days</th>
              </tr>
            </thead>
            <tbody>
              {data.stages.map((s) => (
                <tr key={s.stage_id}>
                  <td className="py-1.5 pr-3 text-text-faint">
                    {s.pipeline_name}
                  </td>
                  <td className="py-1.5 pr-3 text-text-primary">
                    {s.display_name}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-text-muted">
                    {s.moves}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums font-mono text-text-primary">
                    {s.avg_days_in_stage ?? "—"}
                  </td>
                  <td className="py-1.5 tabular-nums font-mono text-text-muted">
                    {s.median_days_in_stage ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <SectionCard
      icon={Timer}
      title="Sales velocity"
      subtitle="How long deals sit in each stage before moving on"
    >
      {content}
    </SectionCard>
  );
}

// ── Forecast vs actual ────────────────────────────────────────────────────

function ForecastSection() {
  const { data, isLoading, isError, refetch } = useReportForecast();

  let content: React.ReactNode;
  if (isLoading) content = <LoadingBlock />;
  else if (isError) content = <ErrorBlock retry={refetch} />;
  else if (!data || (data.open_by_month.length === 0 && data.won_by_month.length === 0))
    content = (
      <EmptyBlock text="Give deals an expected value and close date to see the forecast." />
    );
  else {
    content = (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <div className="micro mb-2">
            Open pipeline by expected close month
          </div>
          {data.open_by_month.length === 0 ? (
            <EmptyBlock text="No open deals right now." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.open_by_month.map((m) => (
                <div
                  key={m.month ?? "none"}
                  className="flex items-center gap-2 p-2 rounded-[9px] bg-text-primary/[0.03]"
                >
                  <span className="w-20 text-[11px] text-text-muted flex-shrink-0">
                    {monthLabel(m.month)}
                  </span>
                  <span className="text-[10.5px] text-text-faint">
                    {m.deals} deal{m.deals === 1 ? "" : "s"}
                  </span>
                  <span className="ml-auto text-[11.5px] font-mono tabular-nums text-text-primary">
                    <MoneyText ngn={parseFloat(m.pipeline_value_ngn)} />
                  </span>
                  <span
                    className="text-[10.5px] font-mono tabular-nums text-text-faint"
                    title="Weighted by each stage's win probability"
                  >
                    (~
                    <MoneyText ngn={parseFloat(m.weighted_value_ngn)} />)
                  </span>
                </div>
              ))}
              <p className="text-[10px] text-text-faint mt-1">
                Bracketed figure = value weighted by each stage's win
                probability.
              </p>
            </div>
          )}
        </div>
        <div>
          <div className="micro mb-2">Actually won (last 6 months)</div>
          {data.won_by_month.length === 0 ? (
            <EmptyBlock text="No won deals in the last 6 months." />
          ) : (
            <div className="flex flex-col gap-1.5">
              {data.won_by_month.map((m) => (
                <div
                  key={m.month}
                  className="flex items-center gap-2 p-2 rounded-[9px] bg-success/[0.05]"
                >
                  <span className="w-20 text-[11px] text-text-muted flex-shrink-0">
                    {monthLabel(m.month)}
                  </span>
                  <span className="text-[10.5px] text-text-faint">
                    {m.deals} won
                  </span>
                  <span className="ml-auto text-[11.5px] font-mono tabular-nums text-text-primary">
                    <MoneyText ngn={parseFloat(m.won_value_ngn)} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <SectionCard
      icon={TrendingUp}
      title="Forecast vs actual"
      subtitle="What the pipeline promises vs what actually closed"
    >
      {content}
    </SectionCard>
  );
}

// ── Main reports tab ──────────────────────────────────────────────────────

export function ReportsTab() {
  return (
    <div className="animate-fade-in flex flex-col gap-4">
      <LtvSection />
      <CohortSection />
      <WinLossSection />
      <VelocitySection />
      <ForecastSection />
    </div>
  );
}
