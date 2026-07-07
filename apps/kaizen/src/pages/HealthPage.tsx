import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Database,
  Server,
  ListChecks,
  HardDrive,
  MemoryStick,
  Cpu,
  DatabaseBackup,
  ShieldCheck,
} from "lucide-react";
import { healthCurrent, healthHistory } from "@/lib/api";
import type { HealthComponent, HealthStatus, HealthComponentName } from "@/lib/types";
import { Card, StatusPill, Spinner, EmptyState } from "@/components/ui";
import { Sparkline } from "@/components/charts";

function statusTone(s: HealthStatus) {
  return s === "ok" ? "green" : s === "degraded" ? "amber" : s === "down" ? "red" : "neutral";
}

const ICONS: Record<HealthComponentName, React.ReactNode> = {
  db: <Database className="h-5 w-5" />,
  redis: <Server className="h-5 w-5" />,
  queue: <ListChecks className="h-5 w-5" />,
  disk: <HardDrive className="h-5 w-5" />,
  memory: <MemoryStick className="h-5 w-5" />,
  cpu: <Cpu className="h-5 w-5" />,
  backup: <DatabaseBackup className="h-5 w-5" />,
  restore_drill: <ShieldCheck className="h-5 w-5" />,
};

const LABELS: Record<HealthComponentName, string> = {
  db: "Database",
  redis: "Redis",
  queue: "Job queues",
  disk: "Disk",
  memory: "Memory",
  cpu: "CPU",
  backup: "Backups",
  restore_drill: "Restore drill",
};

function detailLine(c: HealthComponent): string {
  const d = c.detail as Record<string, unknown>;
  switch (c.component) {
    case "db":
    case "redis":
      return c.latency_ms != null ? `${c.latency_ms} ms` : "—";
    case "queue":
      return `${d.waiting ?? 0} waiting • ${d.failed ?? 0} failed`;
    case "disk":
      return d.free_pct != null ? `${d.free_pct}% free` : "—";
    case "memory":
      return d.used_pct != null ? `${d.used_pct}% used` : "—";
    case "cpu":
      return d.load_per_core != null ? `load ${d.load_per_core}/core` : "—";
    case "backup":
      return (d.age_hours as number) != null ? `last ${d.age_hours}h ago` : String(d.reason ?? "—");
    case "restore_drill":
      return d.last_status ? `${d.last_status}` : String(d.reason ?? "—");
    default:
      return "—";
  }
}

function ComponentCard({ c }: { c: HealthComponent }) {
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: ["kaizen", "health", "history", c.component],
    queryFn: () => healthHistory(c.component, 24),
    enabled: open,
  });

  const latencySeries = (history.data ?? [])
    .map((p) => p.latency_ms)
    .filter((v): v is number => v != null);

  return (
    <div className="card">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-ink-700/70 text-amber">
          {ICONS[c.component]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-fog-100">{LABELS[c.component]}</div>
          <div className="truncate font-mono text-xs text-fog-400">{detailLine(c)}</div>
        </div>
        <StatusPill tone={statusTone(c.status)}>{c.status}</StatusPill>
      </div>
      <button
        className="mt-3 text-xs text-fog-400 hover:text-fog-200"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide 24h trend" : "Show 24h trend"}
      </button>
      {open && (
        <div className="mt-2 text-amber">
          {history.isLoading ? (
            <Spinner className="h-4 w-4 text-fog-400" />
          ) : latencySeries.length ? (
            <Sparkline points={latencySeries} width={260} height={40} />
          ) : (
            <p className="text-xs text-fog-500">No latency history for this component.</p>
          )}
        </div>
      )}
    </div>
  );
}

export function HealthPage() {
  const query = useQuery({
    queryKey: ["kaizen", "health", "current"],
    queryFn: healthCurrent,
    refetchInterval: 30_000,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-fog-100">Health</h1>
          <p className="mt-1 text-sm text-fog-300">
            Live probes — refreshes every 30s. Snapshots persist each minute.
          </p>
        </div>
        {query.data && (
          <StatusPill tone={statusTone(query.data.overall)}>
            overall: {query.data.overall}
          </StatusPill>
        )}
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-fog-400" />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="Couldn't load health"
          hint={query.error instanceof Error ? query.error.message : undefined}
          action={
            <button className="btn-ghost" onClick={() => query.refetch()}>
              Retry
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {query.data?.components.map((c) => (
            <ComponentCard key={c.component} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}
