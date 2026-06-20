import { useState } from "react";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import type {
  AiDealSummary,
  AiNextActionsResult,
  AiChurnExplainer,
} from "../types";

// ── Shared AI card shell ──────────────────────────────────────────────────

interface AiCardProps {
  title: string;
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function AiCard({
  title,
  isLoading,
  isError,
  onRetry,
  collapsible = true,
  defaultOpen = true,
  children,
}: AiCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-[14px] border border-accent/20 bg-accent/[0.04] overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-accent/[0.04] transition-colors"
        onClick={() => collapsible && setOpen((v) => !v)}
      >
        <Sparkles className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        <span className="text-[12px] font-semibold text-accent flex-1 text-left">
          {title}
        </span>
        {collapsible &&
          (open ? (
            <ChevronUp className="w-3.5 h-3.5 text-accent/60" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-accent/60" />
          ))}
      </button>

      {open && (
        <div className="px-4 pb-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-text-faint py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span className="text-[12px]">Praxis is thinking…</span>
            </div>
          ) : isError ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-warn/80">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="text-[11.5px]">AI unavailable right now</span>
              </div>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="flex items-center gap-1 text-[11px] text-accent hover:text-accent-glow transition-colors"
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry
                </button>
              )}
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  );
}

// ── Deal summary card ─────────────────────────────────────────────────────

interface DealSummaryCardProps {
  summary: AiDealSummary | undefined;
  isLoading: boolean;
  isError: boolean;
  onLoad: () => void;
  onRetry: () => void;
}

export function AiDealSummaryCard({
  summary,
  isLoading,
  isError,
  onLoad,
  onRetry,
}: DealSummaryCardProps) {
  const [loaded, setLoaded] = useState(false);

  if (!loaded && !summary && !isLoading) {
    return (
      <button
        type="button"
        onClick={() => {
          setLoaded(true);
          onLoad();
        }}
        className="w-full flex items-center gap-2 px-4 py-3 rounded-[14px] border border-accent/20 bg-accent/[0.04] hover:bg-accent/[0.08] transition-colors"
      >
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span className="text-[12px] font-semibold text-accent">
          Get AI deal summary
        </span>
      </button>
    );
  }

  const CONF_LABEL = {
    high: "High confidence",
    medium: "Medium confidence",
    low: "Low confidence",
  };

  return (
    <AiCard
      title="Praxis deal summary"
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      defaultOpen
    >
      {summary && (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] text-text-primary leading-relaxed">
            {summary.summary}
          </p>

          {summary.key_risks.length > 0 && (
            <div>
              <div className="micro mb-1.5">Key risks</div>
              <ul className="flex flex-col gap-1">
                {summary.key_risks.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-[11.5px] text-warn/90"
                  >
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-warn/60 flex-shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="p-2.5 rounded-[10px] bg-accent/[0.08] border border-accent/20">
            <div className="micro mb-1">Recommended next step</div>
            <p className="text-[12px] text-accent-glow">
              {summary.recommended_next_step}
            </p>
          </div>

          <div className="flex items-center justify-between text-[10.5px] text-text-faint">
            {summary.win_probability_estimate !== null && (
              <span>
                Win probability estimate: {summary.win_probability_estimate}%
              </span>
            )}
            <span>{CONF_LABEL[summary.confidence]}</span>
          </div>
        </div>
      )}
    </AiCard>
  );
}

// ── Next action card ──────────────────────────────────────────────────────

interface NextActionsCardProps {
  result: AiNextActionsResult | undefined;
  isLoading: boolean;
  isError: boolean;
  onLoad: () => void;
  onRetry: () => void;
}

export function AiNextActionsCard({
  result,
  isLoading,
  isError,
  onLoad,
  onRetry,
}: NextActionsCardProps) {
  const [loaded, setLoaded] = useState(false);

  if (!loaded && !result && !isLoading) {
    return (
      <button
        type="button"
        onClick={() => {
          setLoaded(true);
          onLoad();
        }}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[12px] border border-accent/20 bg-accent/[0.03] hover:bg-accent/[0.07] transition-colors"
      >
        <Sparkles className="w-3 h-3 text-accent" />
        <span className="text-[11.5px] font-semibold text-accent">
          Suggest next actions
        </span>
      </button>
    );
  }

  const urgencyColor = {
    high: "text-danger",
    medium: "text-warn",
    low: "text-success",
  } as const;

  return (
    <AiCard
      title="Praxis next actions"
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
      collapsible={false}
    >
      {result && (
        <div className="flex flex-col gap-2">
          {result.reasoning && (
            <p className="text-[11px] text-text-faint leading-relaxed">
              {result.reasoning}
            </p>
          )}
          {result.actions.map((action, i) => (
            <div
              key={i}
              className="p-2.5 rounded-[10px] bg-text-primary/[0.04] border hairline"
            >
              <div className="flex items-start gap-2">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wide ${urgencyColor[action.urgency]} flex-shrink-0 mt-0.5`}
                >
                  {action.urgency}
                </span>
                <div>
                  <div className="text-[12px] font-medium text-text-primary">
                    {action.action_type}
                  </div>
                  <p className="text-[11.5px] text-text-muted mt-0.5">
                    {action.description}
                  </p>
                  {action.suggested_message && (
                    <p className="text-[11px] text-accent/80 mt-1 italic">
                      "{action.suggested_message}"
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AiCard>
  );
}

// ── Churn explainer card ──────────────────────────────────────────────────

interface ChurnExplainerCardProps {
  explainer: AiChurnExplainer | undefined;
  isLoading: boolean;
  isError: boolean;
  onLoad: () => void;
  onRetry: () => void;
}

export function AiChurnExplainerCard({
  explainer,
  isLoading,
  isError,
  onLoad,
  onRetry,
}: ChurnExplainerCardProps) {
  const [loaded, setLoaded] = useState(false);

  if (!loaded && !explainer && !isLoading) {
    return (
      <button
        type="button"
        onClick={() => {
          setLoaded(true);
          onLoad();
        }}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-[12px] border border-warn/20 bg-warn/[0.04] hover:bg-warn/[0.08] transition-colors"
      >
        <Sparkles className="w-3 h-3 text-warn" />
        <span className="text-[11.5px] font-semibold text-warn">
          Explain churn risk
        </span>
      </button>
    );
  }

  return (
    <AiCard
      title="Praxis churn analysis"
      isLoading={isLoading}
      isError={isError}
      onRetry={onRetry}
    >
      {explainer && (
        <div className="flex flex-col gap-3">
          <div className="text-[12.5px] font-semibold text-warn">
            {explainer.headline}
          </div>
          <p className="text-[12px] text-text-muted leading-relaxed">
            {explainer.explanation}
          </p>
          {explainer.recommendations.length > 0 && (
            <div>
              <div className="micro mb-1.5">Recommendations</div>
              <ul className="flex flex-col gap-1.5">
                {explainer.recommendations.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[12px] text-text-primary"
                  >
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {explainer.win_back_prompt && (
            <div className="p-2.5 rounded-[10px] bg-accent/[0.06] border border-accent/20">
              <div className="micro mb-1">Win-back message draft</div>
              <p className="text-[11.5px] text-accent/90 italic">
                "{explainer.win_back_prompt}"
              </p>
            </div>
          )}
        </div>
      )}
    </AiCard>
  );
}
