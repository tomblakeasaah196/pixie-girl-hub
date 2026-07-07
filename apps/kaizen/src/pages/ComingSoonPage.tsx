import { useLocation } from "react-router-dom";
import { Construction } from "lucide-react";
import { NAV } from "@/components/nav";
import { Card } from "@/components/ui";

const BLURB: Record<string, string> = {
  "/errors":
    "Live, fingerprinted error feed — one row per bug with occurrence counts, first/last seen, bulk resolve, Markdown export, and auto-reopen on regression.",
  "/health":
    "Component health for database, Redis, background queues, disk, memory and CPU — with history and degraded/down alerts.",
  "/performance":
    "Request latency percentiles (p50/p95/p99), error rate, throughput, slow endpoints, and queue depth / failed jobs.",
  "/backups":
    "Daily off-site backups (database, uploads, config, and full-volume via restic) with a status ledger, one-click re-run, retention, and verified restore drills.",
  "/alerts":
    "Configurable alert rules delivered by email and in-dashboard, with acknowledgement and de-duplication.",
  "/settings":
    "Retention policy, alert recipients, backup destinations, and the frontend error-ingest key.",
};

export function ComingSoonPage() {
  const { pathname } = useLocation();
  const item = NAV.find((n) => n.to === pathname);

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-ink-700/70 text-amber">
            {item?.icon ? <item.icon className="h-7 w-7" /> : <Construction className="h-7 w-7" />}
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold text-fog-100">
              {item?.label ?? "Coming soon"}
            </h1>
            {item?.phase && (
              <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-amber">
                {item.phase}
              </p>
            )}
          </div>
          <p className="max-w-lg text-sm text-fog-300">
            {(item && BLURB[item.to]) ||
              "This module is part of the Kaizen rollout and will light up in an upcoming phase."}
          </p>
          <span className="rounded-full border border-line bg-ink-800 px-3 py-1 text-xs text-fog-400">
            Not built yet — Phase 0 skeleton
          </span>
        </div>
      </Card>
    </div>
  );
}
