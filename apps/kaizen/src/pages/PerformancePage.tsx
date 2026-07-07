import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gauge, AlertTriangle, Activity, Timer } from "lucide-react";
import { perfSummary } from "@/lib/api";
import type { SlowRoute } from "@/lib/types";
import { Card, Spinner, EmptyState } from "@/components/ui";
import { Bar } from "@/components/charts";

const RANGES = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
];

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fog-400">
        {icon}
        {label}
      </div>
      <div className={`mt-2 font-mono text-2xl ${tone ?? "text-fog-100"}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-fog-400">{sub}</div>}
    </div>
  );
}

export function PerformancePage() {
  const [hours, setHours] = useState(24);
  const query = useQuery({
    queryKey: ["kaizen", "perf", "summary", hours],
    queryFn: () => perfSummary(hours),
    refetchInterval: 60_000,
  });

  const d = query.data;
  const maxP95 = Math.max(1, ...(d?.slow_routes ?? []).map((r) => r.p95_ms ?? 0));
  const errorTone =
    (d?.error_rate_pct ?? 0) >= 5
      ? "text-signal-red"
      : (d?.error_rate_pct ?? 0) >= 1
        ? "text-signal-amber"
        : "text-signal-green";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-fog-100">Performance</h1>
          <p className="mt-1 text-sm text-fog-300">
            Per-route latency percentiles, error rate and throughput from 1-minute rollups.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-ink-800 p-1">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                hours === r.hours ? "bg-ink-600 text-fog-100" : "text-fog-400 hover:text-fog-200"
              }`}
              onClick={() => setHours(r.hours)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-fog-400" />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="Couldn't load performance"
          hint={query.error instanceof Error ? query.error.message : undefined}
          action={
            <button className="btn-ghost" onClick={() => query.refetch()}>
              Retry
            </button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={<Gauge className="h-4 w-4" />}
              label="p95 latency"
              value={d?.p95_ms != null ? `${d.p95_ms} ms` : "—"}
              sub={d?.max_ms != null ? `max ${d.max_ms} ms` : undefined}
            />
            <Stat
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Error rate"
              value={`${d?.error_rate_pct ?? 0}%`}
              sub={`${d?.total_errors ?? 0} of ${d?.total_requests ?? 0}`}
              tone={errorTone}
            />
            <Stat
              icon={<Activity className="h-4 w-4" />}
              label="Throughput"
              value={`${d?.throughput_per_min ?? 0}/min`}
              sub={`${d?.total_requests ?? 0} requests`}
            />
            <Stat
              icon={<Timer className="h-4 w-4" />}
              label="Window"
              value={`${hours}h`}
            />
          </div>

          <Card title="Slowest routes (by p95)">
            {!d?.slow_routes.length ? (
              <EmptyState
                title="No traffic recorded yet"
                hint="Rollups appear a minute or two after the first requests flow through."
              />
            ) : (
              <div className="space-y-3">
                {d.slow_routes.map((r: SlowRoute) => (
                  <div key={`${r.method} ${r.route_pattern}`} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-fog-200">
                        {r.method} {r.route_pattern}
                      </div>
                      <Bar
                        fraction={(r.p95_ms ?? 0) / maxP95}
                        className={r.err_count > 0 ? "h-full bg-signal-red" : "h-full bg-amber"}
                      />
                    </div>
                    <div className="text-right font-mono text-xs">
                      <div className="text-fog-100">{r.p95_ms ?? "—"} ms</div>
                      <div className="text-fog-400">
                        {r.req_count} req{r.err_count > 0 ? ` • ${r.err_count} err` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
