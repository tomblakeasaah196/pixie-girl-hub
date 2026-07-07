import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Bug,
  CheckCircle2,
  EyeOff,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { listErrors, resolveErrors, ignoreErrors, downloadErrorExport } from "@/lib/api";
import type {
  ErrorFilters,
  ErrorSeverity,
  ErrorStatus,
  ErrorSource,
} from "@/lib/types";
import { Card, StatusPill, Spinner, EmptyState } from "@/components/ui";

function severityTone(s: ErrorSeverity) {
  return s === "critical" ? "red" : s === "error" ? "amber" : s === "warning" ? "blue" : "neutral";
}
function statusTone(s: ErrorStatus) {
  return s === "open" ? "amber" : s === "resolved" ? "green" : "neutral";
}
function rel(ts: string) {
  const d = Date.now() - new Date(ts).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SEVERITIES: ErrorSeverity[] = ["critical", "error", "warning", "info"];
const STATUSES: ErrorStatus[] = ["open", "resolved", "ignored"];
const SOURCES: ErrorSource[] = [
  "backend",
  "worker",
  "admin",
  "storefront",
  "stylist",
  "landing",
  "kaizen",
];

export function ErrorsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState<ErrorFilters>({
    status: "open",
    page: 1,
    page_size: 30,
  });
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const query = useQuery({
    queryKey: ["kaizen", "errors", filters],
    queryFn: () => listErrors(filters),
  });

  const patch = (p: Partial<ErrorFilters>) =>
    setFilters((f) => ({ ...f, ...p, page: p.page ?? 1 }));

  const clearSel = () => setSelected(new Set());
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["kaizen", "errors"] });
    clearSel();
  };

  const resolve = useMutation({
    mutationFn: (ids: string[]) => resolveErrors(ids),
    onSuccess: invalidate,
  });
  const ignore = useMutation({
    mutationFn: (ids: string[]) => ignoreErrors(ids),
    onSuccess: invalidate,
  });

  const rows = query.data?.data ?? [];
  const pg = query.data?.pagination;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.group_id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onExport = async () => {
    setExporting(true);
    try {
      await downloadErrorExport(filters);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-fog-100">Errors</h1>
          <p className="mt-1 text-sm text-fog-300">
            One row per bug. Resolve in bulk; a fixed bug that recurs auto-reopens.
          </p>
        </div>
        <button className="btn-ghost" onClick={onExport} disabled={exporting}>
          {exporting ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
          Export Markdown
        </button>
      </div>

      <Card>
        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Status</label>
            <select
              className="input"
              value={filters.status ?? ""}
              onChange={(e) => patch({ status: (e.target.value || undefined) as ErrorStatus })}
            >
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Severity</label>
            <select
              className="input"
              value={filters.severity ?? ""}
              onChange={(e) => patch({ severity: (e.target.value || undefined) as ErrorSeverity })}
            >
              <option value="">Any</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Source</label>
            <select
              className="input"
              value={filters.source ?? ""}
              onChange={(e) => patch({ source: (e.target.value || undefined) as ErrorSource })}
            >
              <option value="">Any</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <form
            className="flex-1 min-w-[180px]"
            onSubmit={(e) => {
              e.preventDefault();
              patch({ q: q.trim() || undefined });
            }}
          >
            <label className="label">Search</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fog-400" />
              <input
                className="input pl-9"
                placeholder="title, route or code…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </form>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-sm">
            <span className="text-fog-100">{selected.size} selected</span>
            <button
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => resolve.mutate([...selected])}
              disabled={resolve.isPending}
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-signal-green" /> Resolve
            </button>
            <button
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => ignore.mutate([...selected])}
              disabled={ignore.isPending}
            >
              <EyeOff className="h-3.5 w-3.5" /> Ignore
            </button>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={clearSel}>
              Clear
            </button>
          </div>
        )}

        {/* Table / states */}
        {query.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6 text-fog-400" />
          </div>
        ) : query.isError ? (
          <EmptyState
            title="Couldn't load errors"
            hint={query.error instanceof Error ? query.error.message : undefined}
            action={
              <button className="btn-ghost" onClick={() => query.refetch()}>
                Retry
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Bug className="h-8 w-8" />}
            title="No errors match"
            hint="Nothing here is a good sign. Try widening the filters."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line/60 text-xs uppercase tracking-wider text-fog-400">
                  <th className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(
                          allSelected ? new Set() : new Set(rows.map((r) => r.group_id)),
                        )
                      }
                    />
                  </th>
                  <th className="px-3 py-2 font-semibold">Error</th>
                  <th className="px-3 py-2 font-semibold">Severity</th>
                  <th className="px-3 py-2 font-semibold">Count</th>
                  <th className="px-3 py-2 font-semibold">Last seen</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.group_id} className="border-b border-line/40 last:border-0 hover:bg-ink-800/40">
                    <td className="px-2 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.group_id)}
                        onChange={() => toggle(r.group_id)}
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Link to={`/errors/${r.group_id}`} className="block">
                        <span className="font-medium text-fog-100 line-clamp-1">{r.title}</span>
                        <span className="font-mono text-xs text-fog-400">
                          {r.route_pattern || r.error_code || r.source}
                          {r.reopen_count > 0 && (
                            <span className="ml-2 text-signal-red">reopened {r.reopen_count}×</span>
                          )}
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <StatusPill tone={severityTone(r.severity)}>{r.severity}</StatusPill>
                    </td>
                    <td className="px-3 py-3 font-mono text-fog-200">{r.occurrence_count}</td>
                    <td className="px-3 py-3 text-fog-300">{rel(r.last_seen_at)}</td>
                    <td className="px-3 py-3">
                      <StatusPill tone={statusTone(r.status)}>{r.status}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pg && pg.total_pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-fog-300">
            <span>
              {pg.total} bug{pg.total === 1 ? "" : "s"} • page {pg.page}/{pg.total_pages}
            </span>
            <div className="flex gap-2">
              <button
                className="btn-ghost px-2 py-1"
                disabled={pg.page <= 1}
                onClick={() => patch({ page: pg.page - 1 })}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                className="btn-ghost px-2 py-1"
                disabled={pg.page >= pg.total_pages}
                onClick={() => patch({ page: pg.page + 1 })}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
