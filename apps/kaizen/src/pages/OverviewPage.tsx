import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Server,
  Cpu,
  Clock,
  GitCommitHorizontal,
  ArrowRight,
} from "lucide-react";
import { systemSummary } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { Card, StatusPill, Spinner } from "@/components/ui";
import { NAV } from "@/components/nav";
import { cx } from "@/lib/cx";

function useBackendHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const res = await fetch("/health");
      if (!res.ok) throw new Error("unhealthy");
      return (await res.json()) as { ok: boolean; ts: string };
    },
    refetchInterval: 30_000,
  });
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
        <div className="text-xs font-semibold uppercase tracking-wider text-fog-400">
          {label}
        </div>
        <div className="truncate font-mono text-sm text-fog-100">{value}</div>
      </div>
      {tone && <div className="ml-auto">{tone}</div>}
    </div>
  );
}

export function OverviewPage() {
  const operator = useAuth((s) => s.operator);
  const health = useBackendHealth();
  const summary = useQuery({
    queryKey: ["system", "summary"],
    queryFn: systemSummary,
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

      {/* Status tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          icon={<Server className="h-5 w-5" />}
          label="Backend API"
          value={
            health.isLoading
              ? "checking…"
              : health.isSuccess
                ? "responding"
                : "unreachable"
          }
          tone={
            health.isLoading ? (
              <Spinner className="h-4 w-4 text-fog-400" />
            ) : health.isSuccess ? (
              <StatusPill tone="green">Online</StatusPill>
            ) : (
              <StatusPill tone="red">Down</StatusPill>
            )
          }
        />
        <Tile
          icon={<Cpu className="h-5 w-5" />}
          label="Node"
          value={summary.data?.node ?? "—"}
        />
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
      </div>

      {/* Roadmap of coming modules */}
      <Card
        title="Monitoring modules"
        action={
          <span className="text-xs text-fog-400">
            Phase 0 skeleton — modules land per the rollout plan
          </span>
        }
      >
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
    </div>
  );
}
