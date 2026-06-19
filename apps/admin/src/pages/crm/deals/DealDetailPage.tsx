import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, PenLine, Trophy } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Button, Pill, Skeleton } from "@/components/ui/primitives";
import { useDeal, useDealActivities, useDealNotes } from "../hooks";
import { useAiDealSummary } from "../hooks";
import { AiDealSummaryCard } from "../shared/AiInsightCard";
import { ActivityFeed } from "./ActivityFeed";
import { DealNotes } from "./DealNotes";
import { DealSidebar } from "./DealSidebar";
import { LogActivityModal } from "./LogActivityModal";
import { WonLostModal } from "../pipeline/WonLostModal";

const STATUS_TONE = {
  open: "info",
  won: "success",
  lost: "danger",
  on_hold: "warn",
  cancelled: "neutral",
} as const;

type TabKey = "timeline" | "notes";

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>("timeline");
  const [showLog, setShowLog] = useState(false);
  const [showWonLost, setShowWonLost] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);

  const { data: deal, isLoading: dealLoading } = useDeal(id ?? null);
  const { data: activities = [], isLoading: actLoading } = useDealActivities(
    id ?? null,
  );
  const { data: notes = [], isLoading: notesLoading } = useDealNotes(
    id ?? null,
  );
  const {
    data: aiSummary,
    isLoading: aiLoading,
    isError: aiError,
    refetch: aiRefetch,
  } = useAiDealSummary(id ?? null, aiEnabled);

  useBreadcrumbs([
    { label: "CRM", href: "/crm" },
    { label: deal?.deal_number ?? "Deal", href: "/crm" },
    { label: deal?.title ?? "…" },
  ]);

  if (dealLoading) {
    return (
      <div className="max-w-[1100px] mx-auto pb-12">
        <Skeleton className="h-8 w-48 mb-6 rounded-[10px]" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-[60px] rounded-[14px]" />
            <Skeleton className="h-[300px] rounded-[14px]" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-[200px] rounded-[14px]" />
          </div>
        </div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="py-20 text-center">
        <div className="text-text-faint text-[14px] mb-3">Deal not found</div>
        <Button variant="ghost" onClick={() => navigate("/crm")}>
          Back to CRM
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto pb-12 animate-fade-in">
      {/* Back + header */}
      <div className="flex items-start gap-3 mb-6">
        <button
          type="button"
          onClick={() => navigate("/crm")}
          className="w-8 h-8 grid place-items-center rounded-[9px] text-text-faint hover:text-text-primary hover:bg-text-primary/[0.08] transition-colors flex-shrink-0 mt-0.5"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-2xl text-text-primary leading-tight">
              {deal.title}
            </h1>
            <Pill tone={STATUS_TONE[deal.status] ?? "neutral"} dot={false}>
              {deal.status.replace(/_/g, " ")}
            </Pill>
          </div>
          <div className="text-[12px] text-text-faint mt-1">
            {deal.deal_number}
            {deal.pipeline_name && ` · ${deal.pipeline_name}`}
            {deal.contact_name && ` · ${deal.contact_name}`}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {deal.status === "open" && (
            <>
              <Button
                variant="secondary"
                size="sm"
                icon={<Trophy className="w-3.5 h-3.5" />}
                onClick={() => setShowWonLost(true)}
              >
                Won / Lost
              </Button>
            </>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={<PenLine className="w-3.5 h-3.5" />}
            onClick={() => setShowLog(true)}
          >
            Log activity
          </Button>
        </div>
      </div>

      {/* Description */}
      {deal.description && (
        <p className="text-[13px] text-text-muted mb-5 leading-relaxed">
          {deal.description}
        </p>
      )}

      {/* AI summary */}
      <div className="mb-5">
        <AiDealSummaryCard
          summary={aiSummary}
          isLoading={aiLoading}
          isError={aiError}
          onLoad={() => setAiEnabled(true)}
          onRetry={() => aiRefetch()}
        />
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        {/* Left: timeline + notes */}
        <div>
          {/* Tab bar */}
          <div className="flex gap-0.5 mb-4 p-0.5 rounded-[10px] bg-text-primary/[0.04] border hairline w-fit">
            {(
              [
                { key: "timeline", label: "Timeline" },
                {
                  key: "notes",
                  label: `Notes${notes.length ? ` (${notes.length})` : ""}`,
                },
              ] as { key: TabKey; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={[
                  "px-4 py-1.5 rounded-[9px] text-[12px] font-semibold transition-all",
                  tab === key
                    ? "bg-accent-deep text-[#F4E9D9]"
                    : "text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Log activity shortcut for timeline tab */}
          {tab === "timeline" && (
            <button
              type="button"
              onClick={() => setShowLog(true)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-[13px] border border-dashed border-line hover:border-accent/40 hover:bg-accent/[0.04] transition-all mb-4 text-left group"
            >
              <div className="w-8 h-8 rounded-full bg-text-primary/[0.06] grid place-items-center text-text-faint group-hover:text-accent transition-colors">
                <PenLine className="w-3.5 h-3.5" />
              </div>
              <span className="text-[12.5px] text-text-faint group-hover:text-text-muted transition-colors">
                Log a call, message, meeting…
              </span>
            </button>
          )}

          {tab === "timeline" && (
            <ActivityFeed activities={activities} isLoading={actLoading} />
          )}
          {tab === "notes" && (
            <DealNotes
              dealId={deal.deal_id}
              notes={notes}
              isLoading={notesLoading}
            />
          )}
        </div>

        {/* Right: sidebar */}
        <DealSidebar deal={deal} />
      </div>

      {/* Modals */}
      {showLog && (
        <LogActivityModal
          dealId={deal.deal_id}
          contactId={deal.contact_id}
          onClose={() => setShowLog(false)}
        />
      )}
      {showWonLost && (
        <WonLostModal deal={deal} onClose={() => setShowWonLost(false)} />
      )}
    </div>
  );
}
