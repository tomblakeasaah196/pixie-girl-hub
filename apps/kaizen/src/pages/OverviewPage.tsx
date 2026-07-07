import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Server,
  Clock,
  GitCommitHorizontal,
  ArrowRight,
  Bug,
  Gauge,
  Activity,
} from "lucide-react";
import { systemSummary, healthCurrent, perfSummary, listErrors } from "@/lib/api";
import type { HealthStatus } from "@/lib/types";
import { useAuth } from "@/stores/auth";
import { Card, StatusPill, Spinner } from "@/components/ui";
import { NAV } from "@/components/nav";
import { cx } from "@/lib/cx";

function statusTone(s: HealthStatus) {
  return s === "ok" ? "green" : s === "degraded" ? "amber" : s === "down" ? "red" : "neutral";
}
function fmtUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function Tile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: React.ReactNode;
}) {
  return (
    <div className="card flex items-center gap-4">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-ink-700/70 text-amber">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-semibold uppercase tracking-wider text-fog-400">{label}</div>
        <div className="truncate font-mono text-sm text-fog-100">{value}</div>
      </div>
      {tone && <div className="ml-auto">{tone}</div>}
    </div>
  );
}

export function OverviewPage() {
  const operator = useAuth((s) => s.operator);

  const summary = useQuery({
    queryKey: ["kaizen", "system", "summary"],
    queryFn: systemSummary,
    refetchInterval: 30_000,
  });
  const health = useQuery({
    queryKey: ["kaizen", "health", "current"],
    queryFn: healthCurrent,
    refetchInterval: 30_000,
  });
  const perf = useQuery({
    queryKey: ["kaizen", "perf", "summary", 24],
    queryFn: () => perfSummary(24),
    refetchInterval: 60_000,
  });
  const openErrors = useQuery({
    queryKey: ["kaizen", "errors", "open-count"],
    queryFn: () => listErrors({ status: "open", page: 1, page_size: 1 }),
    refetchInterval: 30_000,
  });

  const soon = NAV.filter((n) => n.soon);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-fog-100">
          Welcome back, {operator?.display_name?.split(" ")[0] || "operator"}
        </h1>
        <p className="mt-1 text-sm text-fog-300">
          Live status of the Pixie Girl Hub deployment.
        </p>
      </div>

      {/* Headline tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          icon={<Server className="h-5 w-5" />}
          label="System"
          value={health.data ? `overall ${health.data.overall}` : "checking…"}
          tone={
            health.isLoading ? (
              <Spinner className="h-4 w-4 text-fog-400" />
            ) : health.data ? (
              <StatusPill tone={statusTone(health.data.overall)}>
                {health.data.overall}
              </StatusPill>
            ) : (
              <StatusPill tone="red">down</StatusPill>
            )
          }
        />
        <Tile
          icon={<Bug className="h-5 w-5" />}
          label="Open errors"
          value={openErrors.data ? String(openErrors.data.pagination.total) : "—"}
          tone={
            openErrors.data ? (
              <StatusPill tone={openErrors.data.pagination.total > 0 ? "amber" : "green"}>
                {openErrors.data.pagination.total > 0 ? "attention" : "clear"}
              </StatusPill>
            ) : null
          }
        />
        <Tile
          icon={<Gauge className="h-5 w-5" />}
          label="p95 (24h)"
          value={perf.data?.p95_ms != null ? `${perf.data.p95_ms} ms` : "—"}
        />
        <Tile
          icon={<Activity className="h-5 w-5" />}
          label="Error rate (24h)"
          value={perf.data ? `${perf.data.error_rate_pct}%` : "—"}
        />
      </div>

      {/* Health component chips */}
      <Card
        title="System health"
        action={
          <Link to="/health" className="text-xs text-fog-400 hover:text-fog-200">
            View details →
          </Link>
        }
      >
        {health.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-5 w-5 text-fog-400" />
          </div>
        ) : health.data ? (
          <div className="flex flex-wrap gap-2">
            {health.data.components.map((c) => (
              <StatusPill key={c.component} tone={statusTone(c.status)}>
                {c.component}: {c.status}
              </StatusPill>
            ))}
          </div>
        ) : (
          <p className="text-sm text-signal-red">Health probes unreachable.</p>
        )}
      </Card>

      {/* Meta tiles */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile
          icon={<Clock className="h-5 w-5" />}
          label="API uptime"
          value={summary.data ? fmtUptime(summary.data.uptime_s) : "—"}
        />
        <Tile
          icon={<GitCommitHorizontal className="h-5 w-5" />}
          label="UI build"
          value={typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev"}
          tone={
            summary.data ? (
              <StatusPill tone={summary.data.env === "production" ? "green" : "amber"}>
                {summary.data.env}
              </StatusPill>
            ) : null
          }
        />
        <Tile
          icon={<Server className="h-5 w-5" />}
          label="Node"
          value={summary.data?.node ?? "—"}
        />
      </div>

      {/* Remaining coming-soon modules */}
      {soon.length > 0 && (
        <Card title="Coming soon">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {soon.map(({ to, label, icon: Icon, phase }) => (
              <Link
                key={to}
                to={to}
                className={cx(
                  "group flex items-center gap-3 rounded-xl border border-line/60 bg-ink-800/50 p-4",
                  "transition-colors hover:border-amber/40 hover:bg-ink-700/50",
                )}
              >
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-ink-700/70 text-fog-300 group-hover:text-amber">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-fog-100">{label}</div>
                  <div className="text-xs text-fog-400">{phase}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-fog-400 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
