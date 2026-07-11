import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, SlidersHorizontal } from "lucide-react";
import { listAlerts, acknowledgeAlert, listAlertRules, updateAlertRule } from "@/lib/api";
import type { AlertSeverity, AlertStatus } from "@/lib/types";
import { Card, StatusPill, Spinner, EmptyState } from "@/components/ui";

function sevTone(s: AlertSeverity) {
  return s === "critical" ? "red" : s === "error" ? "amber" : s === "warning" ? "blue" : "neutral";
}
function ts(v: string | null) {
  return v ? new Date(v).toLocaleString() : "—";
}

const FILTERS: { label: string; value?: AlertStatus }[] = [
  { label: "Active", value: "active" },
  { label: "Acknowledged", value: "acknowledged" },
  { label: "All", value: undefined },
];

export function AlertsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AlertStatus | undefined>("active");

  const alerts = useQuery({
    queryKey: ["kaizen", "alerts", status ?? "all"],
    queryFn: () => listAlerts(status, 1, 50),
    refetchInterval: 20_000,
  });
  const rules = useQuery({ queryKey: ["kaizen", "alerts", "rules"], queryFn: listAlertRules });

  const ack = useMutation({
    mutationFn: (id: string) => acknowledgeAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kaizen", "alerts"] }),
  });
  const toggleRule = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateAlertRule(id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kaizen", "alerts", "rules"] }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-fog-100">Alerts</h1>
          <p className="mt-1 text-sm text-fog-300">
            Email + in-dashboard notifications. Duplicates are suppressed within a window.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-ink-800 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                status === f.value ? "bg-ink-600 text-fog-100" : "text-fog-400 hover:text-fog-200"
              }`}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {alerts.isLoading ? (
          <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-fog-400" /></div>
        ) : alerts.isError ? (
          <EmptyState title="Couldn't load alerts" hint={alerts.error instanceof Error ? alerts.error.message : undefined}
            action={<button className="btn-ghost" onClick={() => alerts.refetch()}>Retry</button>} />
        ) : !alerts.data?.data.length ? (
          <EmptyState icon={<BellRing className="h-8 w-8" />} title="No alerts" hint="Quiet is good." />
        ) : (
          <ul className="space-y-2">
            {alerts.data.data.map((a) => (
              <li key={a.alert_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line/40 bg-ink-900/40 px-3 py-2">
                <StatusPill tone={sevTone(a.severity)}>{a.severity}</StatusPill>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fog-100">{a.title}</div>
                  {a.body && <div className="truncate text-xs text-fog-400">{a.body}</div>}
                </div>
                <span className="font-mono text-xs text-fog-400">{ts(a.created_at)}</span>
                {a.status === "active" ? (
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => ack.mutate(a.alert_id)} disabled={ack.isPending}>
                    <Check className="h-3.5 w-3.5" /> Ack
                  </button>
                ) : (
                  <StatusPill tone="neutral">{a.status}</StatusPill>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Rules" action={<SlidersHorizontal className="h-4 w-4 text-fog-400" />}>
        {rules.isLoading ? (
          <div className="flex justify-center py-6"><Spinner className="h-5 w-5 text-fog-400" /></div>
        ) : (
          <ul className="divide-y divide-line/40">
            {rules.data?.map((r) => (
              <li key={r.rule_id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fog-100">{r.name}</div>
                  <div className="font-mono text-xs text-fog-400">
                    {r.condition_type} • {r.channels.join(", ")}
                  </div>
                </div>
                <button
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    r.enabled ? "bg-signal-green/15 text-signal-green" : "bg-ink-700 text-fog-400"
                  }`}
                  onClick={() => toggleRule.mutate({ id: r.rule_id, enabled: !r.enabled })}
                  disabled={toggleRule.isPending}
                >
                  {r.enabled ? "Enabled" : "Muted"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
