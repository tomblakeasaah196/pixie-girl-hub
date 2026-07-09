/**
 * AI Health & Logs page.
 *
 * What operators need to see, and never saw during the July 2026 outage:
 *   1. LIVE VENDOR STATUS  — green/red per vendor with last-checked stamp
 *      and last error, right up top. Nothing to click through.
 *   2. SUCCESS RATE        — success/failure counts + % for the last 24h,
 *      per vendor. If Gemini shows 100 calls, 100 failures, the story is
 *      obvious.
 *   3. RECENT ERRORS       — the last N failed ledger rows with the error
 *      code + Google-side message. Capped at 100 so the browser stays fast.
 *   4. INCIDENTS           — vendor_red, vendor_recovered, failover_engaged.
 *      This is where a night-time outage would leave its trail.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  Circle,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Info,
  ShieldAlert,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDateTime } from "@/lib/format";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Card } from "@/components/ui/primitives";
import { toastReport } from "@/lib/error-report";
import {
  aiGovernanceApi,
  type AiVendor,
  type AiVendorRow,
} from "@/lib/ai-governance-api";

export function AiHealthLogsPage() {
  useBreadcrumbs([
    { label: "AI Control", href: "/ai-control" },
    { label: "Health & Logs" },
  ]);
  const qc = useQueryClient();
  const [hours, setHours] = useState(24);
  const [vendorFilter, setVendorFilter] = useState<string>("");

  const vendorsQ = useQuery({
    queryKey: ["ai", "health", "vendors"],
    queryFn: () => aiGovernanceApi.listVendorHealth(),
    // Auto-refresh so a red vendor turns visible without a manual reload.
    refetchInterval: 30_000,
  });
  const rateQ = useQuery({
    queryKey: ["ai", "health", "success-rate", hours],
    queryFn: () => aiGovernanceApi.vendorSuccessRate({ hours }),
    refetchInterval: 60_000,
  });
  const errorsQ = useQuery({
    queryKey: ["ai", "health", "errors", vendorFilter],
    queryFn: () =>
      aiGovernanceApi.recentErrors({
        vendor: vendorFilter || undefined,
        limit: 100,
      }),
    refetchInterval: 30_000,
  });
  const incidentsQ = useQuery({
    queryKey: ["ai", "health", "incidents", vendorFilter],
    queryFn: () =>
      aiGovernanceApi.listIncidents({
        vendor: vendorFilter || undefined,
        limit: 100,
      }),
    refetchInterval: 30_000,
  });

  const pingNow = useMutation({
    mutationFn: (vendor: AiVendor) => aiGovernanceApi.pingVendorNow(vendor),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai", "health", "vendors"] });
    },
    onError: (e) =>
      toastReport("AI Control → Health & Logs", "Ping vendor", e),
  });

  return (
    <div className="max-w-[1080px] mx-auto space-y-7">
      <header className="flex items-start gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Activity className="w-5 h-5" />
        </span>
        <div className="flex-1">
          <h2 className="font-display text-[22px] font-medium">
            AI Health & Logs
          </h2>
          <p className="text-text-muted text-[13px]">
            Live vendor status, failure rate, recent errors and incidents in
            one place. Auto-refreshes every 30s.
          </p>
        </div>
        <Link
          to="/ai-control"
          className="text-[12px] text-text-muted hover:text-text-primary inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> AI Control
        </Link>
      </header>

      {/* Vendor status */}
      <section>
        <h3 className="font-display text-[16px] mb-2.5">Vendor status</h3>
        <Card className="p-0 overflow-hidden">
          {vendorsQ.isLoading ? (
            <div className="p-4">
              <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
            </div>
          ) : (vendorsQ.data ?? []).length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">
              No vendors configured yet.
            </p>
          ) : (
            (vendorsQ.data ?? []).map((row, i, arr) => (
              <VendorHealthRow
                key={row.credential_id}
                row={row}
                onPing={() => pingNow.mutate(row.vendor)}
                pinging={pingNow.isPending && pingNow.variables === row.vendor}
                divider={i !== arr.length - 1}
              />
            ))
          )}
        </Card>
      </section>

      {/* Success rate */}
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-display text-[16px]">
            Success rate (last{" "}
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="bg-panel-2 border hairline rounded-md px-2 py-0.5 text-[12px] focus:outline-none focus:border-accent/40"
            >
              <option value={1}>hour</option>
              <option value={6}>6 hours</option>
              <option value={24}>24 hours</option>
              <option value={168}>week</option>
            </select>
            )
          </h3>
        </div>
        <Card className="p-0 overflow-hidden">
          {rateQ.isLoading ? (
            <div className="p-4">
              <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
            </div>
          ) : (rateQ.data ?? []).length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">
              No AI calls in this window.
            </p>
          ) : (
            <table className="min-w-full text-[12.5px]">
              <thead className="bg-panel-2 text-text-faint uppercase tracking-widest text-[10px]">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Vendor</th>
                  <th className="text-right px-3 py-2 font-semibold">Calls</th>
                  <th className="text-right px-3 py-2 font-semibold">
                    Failures
                  </th>
                  <th className="text-right px-3 py-2 font-semibold">
                    Success
                  </th>
                  <th className="text-right px-3 py-2 font-semibold">
                    Avg latency
                  </th>
                </tr>
              </thead>
              <tbody>
                {(rateQ.data ?? []).map((r) => (
                  <tr key={r.vendor} className="border-t hairline">
                    <td className="px-3 py-2 font-mono text-[11px] uppercase tracking-widest text-accent-glow">
                      {r.vendor}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {r.total_calls.toLocaleString()}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${r.failures > 0 ? "text-red-300" : "text-text-faint"}`}
                    >
                      {r.failures.toLocaleString()}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${r.success_rate_pct < 90 ? "text-red-300" : r.success_rate_pct < 99 ? "text-amber-300" : "text-green-300"}`}
                    >
                      {r.success_rate_pct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text-muted">
                      {r.avg_latency_ms != null
                        ? `${r.avg_latency_ms}ms`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      {/* Filter (recent errors + incidents share it) */}
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] text-text-faint uppercase tracking-widest">
          Filter
        </span>
        <select
          value={vendorFilter}
          onChange={(e) => setVendorFilter(e.target.value)}
          className="bg-panel-2 border hairline rounded-lg px-2 py-1 text-[12px] focus:outline-none focus:border-accent/40"
        >
          <option value="">All vendors</option>
          {(vendorsQ.data ?? []).map((v) => (
            <option key={v.vendor} value={v.vendor}>
              {v.vendor}
            </option>
          ))}
        </select>
      </div>

      {/* Recent errors */}
      <section>
        <h3 className="font-display text-[16px] mb-2.5">Recent errors</h3>
        <Card className="p-0 overflow-hidden">
          {errorsQ.isLoading ? (
            <div className="p-4">
              <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
            </div>
          ) : (errorsQ.data ?? []).length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">
              No failed AI calls — nothing to see here 💚
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
              <table className="min-w-full text-[12px]">
                <thead className="bg-panel-2 text-text-faint uppercase tracking-widest text-[10px] sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">When</th>
                    <th className="text-left px-3 py-2 font-semibold">
                      Vendor
                    </th>
                    <th className="text-left px-3 py-2 font-semibold">
                      Feature
                    </th>
                    <th className="text-left px-3 py-2 font-semibold">Code</th>
                    <th className="text-left px-3 py-2 font-semibold">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {(errorsQ.data ?? []).map((e) => (
                    <tr key={e.usage_id} className="border-t hairline align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-text-muted">
                        {formatDateTime(e.occurred_at)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10.5px] uppercase tracking-widest text-accent-glow">
                        {e.vendor}
                      </td>
                      <td className="px-3 py-2 text-text-muted">
                        {e.feature_key}
                      </td>
                      <td className="px-3 py-2 font-mono text-red-300">
                        {e.error_code || "—"}
                      </td>
                      <td className="px-3 py-2 text-text-muted max-w-[520px]">
                        {e.error_message || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* Incidents */}
      <section>
        <h3 className="font-display text-[16px] mb-2.5">Incidents</h3>
        <Card className="p-0 overflow-hidden">
          {incidentsQ.isLoading ? (
            <div className="p-4">
              <Loader2 className="w-4 h-4 animate-spin text-text-faint" />
            </div>
          ) : (incidentsQ.data ?? []).length === 0 ? (
            <p className="p-5 text-center text-[12.5px] text-text-faint italic">
              No incidents recorded.
            </p>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {(incidentsQ.data ?? []).map((inc, i, arr) => (
                <div
                  key={inc.incident_id}
                  className={`p-3 flex items-start gap-3 ${i !== arr.length - 1 ? "border-b hairline" : ""}`}
                >
                  {inc.severity === "critical" ? (
                    <ShieldAlert className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
                  ) : inc.severity === "warning" ? (
                    <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                      <span className="font-medium">{inc.summary}</span>
                      <span className="text-[10px] uppercase tracking-widest text-text-faint border hairline rounded-full px-1.5 py-[1px]">
                        {inc.incident_type.replace(/_/g, " ")}
                      </span>
                      {inc.resolved_at && (
                        <span className="text-[10px] uppercase tracking-widest text-green-300/70 border border-green-500/30 rounded-full px-1.5 py-[1px]">
                          resolved
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-text-faint mt-0.5">
                      {formatDateTime(inc.created_at)}
                      {inc.fallback_vendor && (
                        <span> · fallback → {inc.fallback_vendor}</span>
                      )}
                      {inc.feature_key && <span> · {inc.feature_key}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

function VendorHealthRow({
  row,
  onPing,
  pinging,
  divider,
}: {
  row: AiVendorRow;
  onPing: () => void;
  pinging: boolean;
  divider: boolean;
}) {
  const status = row.last_health_status || "unknown";
  const cls =
    status === "green"
      ? "text-green-300"
      : status === "red"
        ? "text-red-300"
        : "text-text-faint";
  const label =
    status === "green" ? "Healthy" : status === "red" ? "Unhealthy" : "Not tested";
  return (
    <div className={`p-4 ${divider ? "border-b hairline" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="text-[12px] font-mono uppercase tracking-widest text-accent-glow shrink-0 mt-1">
          {row.vendor}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-[13.5px] truncate">
            {row.display_name}
          </div>
          <div className="text-[11.5px] text-text-faint mt-0.5 flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 ${cls}`}>
              <Circle className="w-2.5 h-2.5 fill-current" />
              {label}
            </span>
            {row.last_health_at && (
              <span>· checked {formatDateTime(row.last_health_at)}</span>
            )}
            {row.last_health_latency_ms != null && (
              <span>· {row.last_health_latency_ms}ms</span>
            )}
            {row.last_health_error && (
              <span className="text-red-300/80">
                · {row.last_health_error}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onPing}
          disabled={pinging}
          className="shrink-0 rounded-xl bg-panel-2 border hairline px-3 py-1.5 text-[12px] hover:border-accent/40 disabled:opacity-50 inline-flex items-center gap-1.5"
          title="Fire a live ping and refresh the status"
        >
          {pinging ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          Ping now
        </button>
      </div>
    </div>
  );
}
