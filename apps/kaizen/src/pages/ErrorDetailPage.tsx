import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, RotateCcw, EyeOff } from "lucide-react";
import {
  getErrorDetail,
  resolveErrors,
  ignoreErrors,
  reopenErrors,
} from "@/lib/api";
import type { ErrorSeverity, ErrorStatus } from "@/lib/types";
import { Card, StatusPill, Spinner, EmptyState } from "@/components/ui";

function severityTone(s: ErrorSeverity) {
  return s === "critical" ? "red" : s === "error" ? "amber" : s === "warning" ? "blue" : "neutral";
}
function statusTone(s: ErrorStatus) {
  return s === "open" ? "amber" : s === "resolved" ? "green" : "neutral";
}
function ts(v?: string | null) {
  return v ? new Date(v).toLocaleString() : "—";
}

export function ErrorDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [occPage, setOccPage] = useState(1);

  const query = useQuery({
    queryKey: ["kaizen", "errors", "detail", id, occPage],
    queryFn: () => getErrorDetail(id, occPage),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["kaizen", "errors"] });
  };
  const resolve = useMutation({ mutationFn: () => resolveErrors([id]), onSuccess: invalidate });
  const ignore = useMutation({ mutationFn: () => ignoreErrors([id]), onSuccess: invalidate });
  const reopen = useMutation({ mutationFn: () => reopenErrors([id]), onSuccess: invalidate });

  const g = query.data?.group;
  const occs = query.data?.occurrences ?? [];
  const pg = query.data?.pagination;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link to="/errors" className="inline-flex items-center gap-1 text-sm text-fog-300 hover:text-fog-100">
        <ArrowLeft className="h-4 w-4" /> Back to errors
      </Link>

      {query.isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-fog-400" />
        </div>
      ) : query.isError || !g ? (
        <EmptyState
          title="Couldn't load this error"
          hint={query.error instanceof Error ? query.error.message : undefined}
          action={
            <button className="btn-ghost" onClick={() => query.refetch()}>
              Retry
            </button>
          }
        />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <StatusPill tone={severityTone(g.severity)}>{g.severity}</StatusPill>
                  <StatusPill tone={statusTone(g.status)}>{g.status}</StatusPill>
                  {g.reopen_count > 0 && (
                    <StatusPill tone="red">reopened {g.reopen_count}×</StatusPill>
                  )}
                </div>
                <h1 className="font-display text-xl font-semibold text-fog-100 break-words">
                  {g.title}
                </h1>
                <p className="mt-1 font-mono text-xs text-fog-400 break-all">
                  {g.route_pattern || "—"} {g.http_status ? `• ${g.http_status}` : ""} • {g.source}
                  {g.error_code ? ` • ${g.error_code}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {g.status !== "resolved" && (
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => resolve.mutate()} disabled={resolve.isPending}>
                    <CheckCircle2 className="h-3.5 w-3.5 text-signal-green" /> Resolve
                  </button>
                )}
                {g.status !== "ignored" && (
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => ignore.mutate()} disabled={ignore.isPending}>
                    <EyeOff className="h-3.5 w-3.5" /> Ignore
                  </button>
                )}
                {g.status !== "open" && (
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reopen
                  </button>
                )}
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase text-fog-400">Occurrences</dt>
                <dd className="font-mono text-fog-100">{g.occurrence_count}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-fog-400">First seen</dt>
                <dd className="text-fog-200">{ts(g.first_seen_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-fog-400">Last seen</dt>
                <dd className="text-fog-200">{ts(g.last_seen_at)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-fog-400">Fingerprint</dt>
                <dd className="font-mono text-xs text-fog-300 break-all">{g.fingerprint.slice(0, 16)}…</dd>
              </div>
            </dl>
          </Card>

          <Card title="Recent occurrences">
            {occs.length === 0 ? (
              <EmptyState title="No occurrences retained" hint="Older occurrences are pruned; the group counters are preserved." />
            ) : (
              <ul className="space-y-4">
                {occs.map((o) => (
                  <li key={o.occurrence_id} className="rounded-lg border border-line/40 bg-ink-900/40 p-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fog-400">
                      <span className="font-mono text-fog-200">{ts(o.occurred_at)}</span>
                      {o.method && <span className="font-mono">{o.method} {o.route}</span>}
                      {o.http_status && <span>status {o.http_status}</span>}
                      {o.brand && <span>brand {o.brand}</span>}
                      {o.request_id && <span className="font-mono">req {o.request_id}</span>}
                    </div>
                    {o.message && (
                      <p className="mt-2 text-sm text-fog-100 break-words">{o.message}</p>
                    )}
                    {o.stack && (
                      <pre className="mt-2 max-h-56 overflow-auto rounded bg-ink-950 p-3 font-mono text-xs text-fog-300">
                        {o.stack}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {pg && pg.total_pages > 1 && (
              <div className="mt-4 flex items-center justify-between text-sm text-fog-300">
                <span>page {pg.page}/{pg.total_pages}</span>
                <div className="flex gap-2">
                  <button className="btn-ghost px-2 py-1" disabled={pg.page <= 1} onClick={() => setOccPage((p) => p - 1)}>
                    Prev
                  </button>
                  <button className="btn-ghost px-2 py-1" disabled={pg.page >= pg.total_pages} onClick={() => setOccPage((p) => p + 1)}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
