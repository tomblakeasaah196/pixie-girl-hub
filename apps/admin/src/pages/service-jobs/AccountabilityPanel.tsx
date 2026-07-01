import { ShieldCheck, AlertTriangle, PackageCheck } from "lucide-react";
import {
  Card,
  KpiTile,
  Pill,
  EmptyState,
  Skeleton,
} from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { useAccountability } from "./hooks";

/**
 * Wig Accountability — the "never lose a wig" board. Quantity-based: per-stylist
 * holdings (Σ out − Σ return − Σ dispatched) plus any wig that has been out with
 * a stylist longer than the brand's missing-wig threshold.
 */
export function AccountabilityPanel() {
  const { data, isLoading, isError, refetch } = useAccountability();

  if (isLoading) {
    return (
      <div className="grid gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <ErrorState
        message="Couldn't load wig accountability."
        onRetry={() => refetch()}
      />
    );
  }

  const totalHeld = data.balances.reduce((n, b) => n + Number(b.holding), 0);
  const overdue = data.overdue;

  return (
    <div className="grid gap-5">
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiTile
          label="Wigs out with stylists"
          value={String(totalHeld)}
          tone="accent"
        />
        <KpiTile
          label={`Overdue (> ${data.threshold_days} days)`}
          value={String(overdue.length)}
          tone={overdue.length ? "warn" : "success"}
        />
        <KpiTile
          label="Stylists holding stock"
          value={String(data.balances.length)}
          tone="neutral"
        />
      </div>

      {/* Overdue — the "go check on this wig" list */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <AlertTriangle size={16} className="text-warn" />
          <h3 className="font-display text-lg">Overdue with a stylist</h3>
        </div>
        {overdue.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={26} />}
            title="All wigs accounted for"
            message="Nothing has been out with a stylist past the threshold. Every wig can be found."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="px-4 py-2 font-medium">Job</th>
                <th className="px-4 py-2 font-medium">Stylist</th>
                <th className="px-4 py-2 font-medium">Out since</th>
                <th className="px-4 py-2 font-medium text-right">Days out</th>
              </tr>
            </thead>
            <tbody>
              {overdue.map((w) => (
                <tr key={w.job_id} className="border-t border-border-subtle">
                  <td className="px-4 py-2 font-mono">
                    {w.job_number ?? w.job_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2">{w.stylist_name ?? "—"}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {new Date(w.out_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Pill tone="danger">{w.days_out}d — check</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Per-stylist balances */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <PackageCheck size={16} className="text-accent-glow" />
          <h3 className="font-display text-lg">Currently held per stylist</h3>
        </div>
        {data.balances.length === 0 ? (
          <EmptyState
            icon={<PackageCheck size={26} />}
            title="No wigs currently out"
            message="Every wig is on the floor or has shipped."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="px-4 py-2 font-medium">Stylist</th>
                <th className="px-4 py-2 font-medium text-right">Holding</th>
              </tr>
            </thead>
            <tbody>
              {data.balances.map((b) => (
                <tr
                  key={b.stylist_user_id}
                  className="border-t border-border-subtle"
                >
                  <td className="px-4 py-2">{b.stylist_name ?? "—"}</td>
                  <td className="px-4 py-2 text-right">
                    <Pill tone={Number(b.holding) > 0 ? "accent" : "neutral"}>
                      {b.holding} wig{Number(b.holding) === 1 ? "" : "s"}
                    </Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
