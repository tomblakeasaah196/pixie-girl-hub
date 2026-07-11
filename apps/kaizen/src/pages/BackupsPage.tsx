import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DatabaseBackup,
  HardDriveDownload,
  Server,
  RotateCcw,
  Play,
  ShieldCheck,
  PlayCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  backupStatus,
  listBackupRuns,
  triggerBackup,
  rerunBackup,
  listBackupDestinations,
  listRestoreDrills,
  runRestoreDrill,
} from "@/lib/api";
import type { BackupKind, BackupRunStatus, RestoreDrillStatus } from "@/lib/types";
import { Card, StatusPill, Spinner, EmptyState } from "@/components/ui";
import { Bar } from "@/components/charts";

function fmtBytes(n: number | null | undefined) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
}
function fmtDur(ms: number | null) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
function ts(v: string | null) {
  return v ? new Date(v).toLocaleString() : "—";
}
function runTone(s: BackupRunStatus) {
  return s === "success" ? "green" : s === "failed" ? "red" : s === "running" ? "amber" : "neutral";
}
function drillTone(s: RestoreDrillStatus) {
  return s === "pass" ? "green" : s === "fail" ? "red" : "amber";
}
function relDays(v: string | null) {
  if (!v) return "—";
  const days = Math.floor((Date.now() - new Date(v).getTime()) / 86400000);
  if (days <= 0) return "today";
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
const KIND_LABEL: Record<BackupKind, string> = {
  logical_db: "Database",
  logical_bundle: "Logical bundle",
  full_volume: "Full volume",
};

export function BackupsPage() {
  const qc = useQueryClient();
  const [confirmFull, setConfirmFull] = useState(false);

  const status = useQuery({ queryKey: ["kaizen", "backups", "status"], queryFn: backupStatus, refetchInterval: 30_000 });
  const runs = useQuery({ queryKey: ["kaizen", "backups", "runs"], queryFn: () => listBackupRuns({ page: 1, page_size: 30 }), refetchInterval: 15_000 });
  const dests = useQuery({ queryKey: ["kaizen", "backups", "destinations"], queryFn: listBackupDestinations });
  const drills = useQuery({ queryKey: ["kaizen", "backups", "drills"], queryFn: () => listRestoreDrills(1, 10), refetchInterval: 30_000 });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["kaizen", "backups"] });
  };
  const trigger = useMutation({ mutationFn: (kind: "logical_bundle" | "full_volume") => triggerBackup(kind), onSuccess: invalidate });
  const rerun = useMutation({ mutationFn: (id: string) => rerunBackup(id), onSuccess: invalidate });
  const drill = useMutation({ mutationFn: () => runRestoreDrill(), onSuccess: invalidate });

  const st = status.data;
  const storageFreePct =
    st?.storage && st.storage.total && st.storage.free != null
      ? Math.round((st.storage.free / st.storage.total) * 100)
      : null;
  const rd = st?.restore_drill;
  const lastLogical = st?.last_success.find((r) => r.kind.startsWith("logical"));
  const lastFull = st?.last_success.find((r) => r.kind === "full_volume");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-fog-100">Backups</h1>
          <p className="mt-1 text-sm text-fog-300">
            Daily off-site backups we can see, verify and re-run. Retention{" "}
            {st ? `${st.retention.daily}d / ${st.retention.weekly}w / ${st.retention.monthly}m` : "…"}.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-primary"
            onClick={() => trigger.mutate("logical_bundle")}
            disabled={trigger.isPending}
          >
            {trigger.isPending ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            Run logical now
          </button>
          {confirmFull ? (
            <span className="inline-flex items-center gap-2">
              <button className="btn-danger" onClick={() => { trigger.mutate("full_volume"); setConfirmFull(false); }}>
                Confirm full-volume
              </button>
              <button className="btn-ghost" onClick={() => setConfirmFull(false)}>Cancel</button>
            </span>
          ) : (
            <button className="btn-ghost" onClick={() => setConfirmFull(true)}>
              <HardDriveDownload className="h-4 w-4" /> Run full-volume
            </button>
          )}
        </div>
      </div>

      {/* Status tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fog-400">
            <DatabaseBackup className="h-4 w-4" /> Last logical
          </div>
          <div className="mt-2 font-mono text-sm text-fog-100">{lastLogical ? ts(lastLogical.finished_at) : "never"}</div>
          <div className="mt-1 text-xs text-fog-400">
            {lastLogical ? `${fmtBytes(lastLogical.size_bytes)} • ${fmtDur(lastLogical.duration_ms)}` : "no successful run yet"}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fog-400">
            <Server className="h-4 w-4" /> Last full-volume
          </div>
          <div className="mt-2 font-mono text-sm text-fog-100">{lastFull ? ts(lastFull.finished_at) : "never"}</div>
          <div className="mt-1 text-xs text-fog-400">{lastFull ? `snapshot ${lastFull.artifact_key ?? "—"}` : "no snapshot yet"}</div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fog-400">
            <ShieldCheck className="h-4 w-4" /> Off-site storage
          </div>
          <div className="mt-2 font-mono text-sm text-fog-100">
            {storageFreePct != null ? `${storageFreePct}% free` : "unknown"}
          </div>
          {storageFreePct != null && (
            <div className="mt-2">
              <Bar fraction={1 - storageFreePct / 100} className={storageFreePct < 10 ? "h-full bg-signal-red" : "h-full bg-amber"} />
            </div>
          )}
          <div className="mt-1 text-xs text-fog-400">
            {st?.destination ? `${st.destination.name} (${st.destination.kind})` : "no destination set"}
          </div>
        </div>
        <div className="card">
          <div className="text-xs font-semibold uppercase tracking-wider text-fog-400">Schedule</div>
          <div className="mt-2 font-mono text-xs text-fog-200">logical {st?.schedule.logical ?? "—"}</div>
          <div className="font-mono text-xs text-fog-200">full {st?.schedule.full_volume ?? "—"}</div>
        </div>
      </div>

      {/* Runs ledger */}
      <Card title="Backup runs">
        {runs.isLoading ? (
          <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-fog-400" /></div>
        ) : runs.isError ? (
          <EmptyState title="Couldn't load runs" hint={runs.error instanceof Error ? runs.error.message : undefined}
            action={<button className="btn-ghost" onClick={() => runs.refetch()}>Retry</button>} />
        ) : !runs.data?.data.length ? (
          <EmptyState icon={<DatabaseBackup className="h-8 w-8" />} title="No backup runs yet"
            hint="Run one now, or wait for the 02:30 schedule." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line/60 text-xs uppercase tracking-wider text-fog-400">
                  <th className="px-3 py-2 font-semibold">Kind</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Trigger</th>
                  <th className="px-3 py-2 font-semibold">Size</th>
                  <th className="px-3 py-2 font-semibold">Duration</th>
                  <th className="px-3 py-2 font-semibold">Started</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {runs.data.data.map((r) => (
                  <tr key={r.run_id} className="border-b border-line/40 last:border-0">
                    <td className="px-3 py-3 font-medium text-fog-100">{KIND_LABEL[r.kind]}</td>
                    <td className="px-3 py-3"><StatusPill tone={runTone(r.status)}>{r.status}</StatusPill></td>
                    <td className="px-3 py-3 text-fog-300">{r.trigger}</td>
                    <td className="px-3 py-3 font-mono text-fog-200">{fmtBytes(r.size_bytes)}</td>
                    <td className="px-3 py-3 font-mono text-fog-300">{fmtDur(r.duration_ms)}</td>
                    <td className="px-3 py-3 text-fog-400">{ts(r.started_at)}</td>
                    <td className="px-3 py-3 text-right">
                      {r.status === "failed" && (
                        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => rerun.mutate(r.run_id)} disabled={rerun.isPending}>
                          <RotateCcw className="h-3.5 w-3.5" /> Re-run
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Destinations */}
      <Card title="Destinations" action={<span className="text-xs text-fog-400">No secrets stored — rclone config holds credentials</span>}>
        {dests.isLoading ? (
          <div className="flex justify-center py-6"><Spinner className="h-5 w-5 text-fog-400" /></div>
        ) : !dests.data?.length ? (
          <EmptyState title="No destinations configured"
            hint="Add one via the API once rclone is set up on the box (see the deploy guide §10.4)." />
        ) : (
          <ul className="space-y-2">
            {dests.data.map((d) => (
              <li key={d.destination_id} className="flex items-center gap-3 rounded-lg border border-line/40 bg-ink-900/40 px-3 py-2 text-sm">
                <span className="font-medium text-fog-100">{d.name}</span>
                <span className="font-mono text-xs text-fog-400">{d.kind}{d.rclone_remote ? ` • ${d.rclone_remote}` : ""} • {d.path_prefix}</span>
                <span className="ml-auto flex gap-1">
                  {d.is_default && <StatusPill tone="green">default</StatusPill>}
                  {!d.is_active && <StatusPill tone="neutral">inactive</StatusPill>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Verified-restore badge + drill history */}
      <Card
        title="Restore drills"
        action={
          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => drill.mutate()} disabled={drill.isPending}>
            {drill.isPending ? <Spinner className="h-3.5 w-3.5" /> : <PlayCircle className="h-3.5 w-3.5" />}
            Run drill now
          </button>
        }
      >
        <div className="mb-4">
          {rd && rd.status === "pass" ? (
            <div className="inline-flex items-center gap-2 rounded-lg border border-signal-green/30 bg-signal-green/10 px-3 py-2 text-sm text-signal-green">
              <CheckCircle2 className="h-4 w-4" />
              Last verified restore: {relDays(rd.finished_at)} — took {fmtDur(rd.duration_ms)}
            </div>
          ) : rd && rd.status === "fail" ? (
            <div className="inline-flex items-center gap-2 rounded-lg border border-signal-red/30 bg-signal-red/10 px-3 py-2 text-sm text-signal-red">
              <XCircle className="h-4 w-4" />
              Last restore drill FAILED ({relDays(rd.finished_at)}). Investigate before quoting recovery.
            </div>
          ) : (
            <div className="text-sm text-fog-400">No verified restore yet — run a drill to measure real recovery time.</div>
          )}
        </div>

        {drills.isLoading ? (
          <div className="flex justify-center py-6"><Spinner className="h-5 w-5 text-fog-400" /></div>
        ) : !drills.data?.data.length ? (
          <EmptyState title="No drills run yet" hint="The weekly drill runs Sun 04:00, or run one now above." />
        ) : (
          <ul className="space-y-2">
            {drills.data.data.map((d) => (
              <li key={d.drill_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line/40 bg-ink-900/40 px-3 py-2 text-sm">
                <StatusPill tone={drillTone(d.status)}>{d.status}</StatusPill>
                <span className="font-mono text-xs text-fog-300">{ts(d.started_at)}</span>
                <span className="text-xs text-fog-400">took {fmtDur(d.duration_ms)}</span>
                <span className="text-xs text-fog-400">
                  {(d.assertions ?? []).filter((a) => a.ok).length}/{(d.assertions ?? []).length} checks ok
                </span>
                {d.error && <span className="ml-auto truncate text-xs text-signal-red">{d.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
