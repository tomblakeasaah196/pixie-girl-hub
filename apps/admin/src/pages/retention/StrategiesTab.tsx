/**
 * Strategies tab — the no-code retention engine, template-first (canon: as
 * easy as WhatsApp). A friendly template gallery leads; existing strategies
 * sit below with one-tap activate/pause. Building/editing opens the full-page
 * wizard (StrategyBuilderPage).
 */

import { useNavigate } from "react-router-dom";
import { Sparkles, Plus, Play, Pause, Pencil } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, EmptyState, Pill, Skeleton } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import {
  useStrategies,
  useStrategyCatalogue,
  useCreateFromTemplate,
  useSetStrategyStatus,
  STRATEGY_STATUS_TONE,
  type Strategy,
} from "@/lib/retention-api";

export function StrategiesTab() {
  const navigate = useNavigate();
  const { can } = useAuthStore();
  const canCreate = can("retention", "create");
  const canEdit = can("retention", "edit");

  const catalogueQ = useStrategyCatalogue();
  const listQ = useStrategies();
  const fromTemplate = useCreateFromTemplate();
  const setStatus = useSetStrategyStatus();

  const strategies = listQ.data ?? [];
  const templates = catalogueQ.data?.templates ?? [];

  const startFromTemplate = async (template_key: string) => {
    const created = await fromTemplate.mutateAsync({ template_key });
    navigate(`/retention/strategies/${created.strategy_id}/edit`);
  };

  return (
    <div className="space-y-6">
      {/* Template gallery */}
      {canCreate && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg">Start from a template</h2>
              <p className="text-[12.5px] text-text-muted">
                Pick a ready-made play and tweak it — or build your own from scratch.
              </p>
            </div>
            <Button
              variant="secondary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => navigate("/retention/strategies/new")}
            >
              From scratch
            </Button>
          </div>

          {catalogueQ.isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} style={{ height: 96 }} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {templates.map((t) => (
                <button
                  key={t.template_key}
                  disabled={fromTemplate.isPending}
                  onClick={() => startFromTemplate(t.template_key)}
                  className="glass rounded-[var(--radius)] shadow-glass p-4 text-left transition-all hover:shadow-[0_8px_26px_rgb(var(--accent-deep)/0.25)] disabled:opacity-50 group"
                >
                  <span className="grid place-items-center w-9 h-9 rounded-[11px] bg-accent/10 text-accent-glow border border-accent/20 mb-2.5">
                    <Sparkles className="w-4 h-4" />
                  </span>
                  <div className="font-medium text-[14px]">{t.name}</div>
                  <p className="text-[12px] text-text-muted mt-0.5 line-clamp-2">{t.description}</p>
                  <div className="text-[10.5px] text-text-faint uppercase tracking-wide mt-2">
                    {t.step_count} step{t.step_count === 1 ? "" : "s"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Existing strategies */}
      <section className="space-y-3">
        <h2 className="font-display text-lg">Your strategies</h2>
        {listQ.isLoading ? (
          <Skeleton style={{ height: 160 }} />
        ) : listQ.isError ? (
          <ErrorState onRetry={() => listQ.refetch()} />
        ) : strategies.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="w-7 h-7" />}
            title="No strategies yet"
            message="Start from a template above, or build one from scratch. Nothing sends until you activate it."
          />
        ) : (
          <Card className="p-0 overflow-hidden">
            {strategies.map((s, i) => (
              <StrategyRow
                key={s.strategy_id}
                s={s}
                last={i === strategies.length - 1}
                canEdit={canEdit}
                onEdit={() => navigate(`/retention/strategies/${s.strategy_id}/edit`)}
                onToggle={(status) => setStatus.mutate({ id: s.strategy_id, status })}
                toggling={setStatus.isPending}
              />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function StrategyRow({
  s,
  last,
  canEdit,
  onEdit,
  onToggle,
  toggling,
}: {
  s: Strategy;
  last: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onToggle: (status: "active" | "paused") => void;
  toggling: boolean;
}) {
  return (
    <div
      className={`p-4 flex items-center gap-3 ${last ? "" : "border-b border-line"}`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-[14px] truncate">{s.display_name}</span>
          <Pill tone={STRATEGY_STATUS_TONE[s.status]}>{s.status}</Pill>
        </div>
        <p className="text-[12px] text-text-muted mt-0.5 line-clamp-1">
          {s.summary || s.description || "—"}
        </p>
        <div className="text-[10.5px] text-text-faint mt-1">
          {s.total_enrolled} enrolled · {s.total_completed} completed
        </div>
      </div>
      {canEdit && (
        <div className="flex items-center gap-1.5 shrink-0">
          {s.status === "active" ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Pause className="w-4 h-4" />}
              disabled={toggling}
              onClick={() => onToggle("paused")}
            >
              Pause
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<Play className="w-4 h-4" />}
              disabled={toggling || (s.step_count ?? 0) === 0}
              onClick={() => onToggle("active")}
            >
              Activate
            </Button>
          )}
          <Button size="sm" variant="secondary" icon={<Pencil className="w-4 h-4" />} onClick={onEdit}>
            Edit
          </Button>
        </div>
      )}
    </div>
  );
}
