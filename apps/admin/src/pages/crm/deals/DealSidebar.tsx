import { useNavigate } from "react-router-dom";
import { Calendar, User, Link2, ExternalLink, Building } from "lucide-react";
import { MoneyText, Pill } from "@/components/ui/primitives";
import { StagePill } from "../shared/StagePill";
import { AiNextActionsCard } from "../shared/AiInsightCard";
import { useAiNextActions, useContact } from "../hooks";
import type { Deal } from "@/pages/contacts/types";

const STATUS_TONE = {
  open: "info",
  won: "success",
  lost: "danger",
  on_hold: "warn",
  cancelled: "neutral",
} as const;

function SidebarRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b hairline last:border-0">
      <span className="micro">{label}</span>
      <div className="text-[13px] text-text-primary">{children}</div>
    </div>
  );
}

interface DealSidebarProps {
  deal: Deal;
}

export function DealSidebar({ deal }: DealSidebarProps) {
  const navigate = useNavigate();
  const { data: contact } = useContact(deal.contact_id);

  const [aiEnabled, setAiEnabled] = React.useState(false);
  const {
    data: aiNextActions,
    isLoading: aiLoading,
    isError: aiError,
    refetch: aiRefetch,
  } = useAiNextActions(deal.deal_id, aiEnabled);

  return (
    <div className="flex flex-col gap-4">
      {/* Deal meta */}
      <div className="p-4 rounded-[14px] bg-text-primary/[0.03] border hairline">
        <div className="micro mb-3">Deal details</div>

        <div className="flex flex-col">
          <SidebarRow label="Deal number">
            <span className="font-mono text-[12px]">{deal.deal_number}</span>
          </SidebarRow>

          <SidebarRow label="Status">
            <Pill tone={STATUS_TONE[deal.status] ?? "neutral"} dot={false}>
              {deal.status.replace(/_/g, " ")}
            </Pill>
          </SidebarRow>

          <SidebarRow label="Stage">
            <StagePill stageName={deal.current_stage_name} />
          </SidebarRow>

          {deal.expected_value_ngn && (
            <SidebarRow label="Expected value">
              <span className="font-display tabular-nums">
                <MoneyText ngn={parseFloat(deal.expected_value_ngn)} />
              </span>
            </SidebarRow>
          )}

          {deal.expected_close_date && (
            <SidebarRow label="Expected close">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3 text-text-faint" />
                {new Date(deal.expected_close_date).toLocaleDateString(
                  "en-NG",
                  {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  },
                )}
              </span>
            </SidebarRow>
          )}

          {deal.source_channel && (
            <SidebarRow label="Source">
              <span className="capitalize">
                {deal.source_channel.replace(/_/g, " ")}
              </span>
            </SidebarRow>
          )}

          {deal.assigned_to_name && (
            <SidebarRow label="Assigned to">
              <span className="flex items-center gap-1.5">
                <User className="w-3 h-3 text-text-faint" />
                {deal.assigned_to_name}
              </span>
            </SidebarRow>
          )}

          {deal.won_at && (
            <SidebarRow label="Won on">
              {new Date(deal.won_at).toLocaleDateString("en-NG", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </SidebarRow>
          )}

          {deal.lost_at && (
            <SidebarRow label="Lost on">
              {new Date(deal.lost_at).toLocaleDateString("en-NG", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </SidebarRow>
          )}

          {deal.lost_reason && (
            <SidebarRow label="Lost reason">
              <span className="text-danger">{deal.lost_reason}</span>
            </SidebarRow>
          )}

          {deal.sales_order_id && (
            <SidebarRow label="Sales order">
              <button
                type="button"
                onClick={() => navigate(`/sales?order=${deal.sales_order_id}`)}
                className="flex items-center gap-1.5 text-accent hover:text-accent-glow transition-colors"
              >
                <Link2 className="w-3 h-3" />
                View order
                <ExternalLink className="w-3 h-3" />
              </button>
            </SidebarRow>
          )}
        </div>
      </div>

      {/* Contact quick-view */}
      {contact && (
        <div
          className="p-4 rounded-[14px] bg-text-primary/[0.03] border hairline cursor-pointer hover:bg-text-primary/[0.06] transition-colors"
          onClick={() => navigate(`/contacts?open=${contact.contact_id}`)}
        >
          <div className="micro mb-3">Contact</div>
          <div className="text-[13px] font-medium text-text-primary">
            {contact.display_name}
          </div>
          {contact.primary_phone && (
            <div className="text-[11.5px] text-text-faint font-mono mt-0.5">
              {contact.primary_phone}
            </div>
          )}
          {contact.email && (
            <div className="text-[11.5px] text-text-faint mt-0.5 truncate">
              {contact.email}
            </div>
          )}
          {contact.company_name && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-text-faint mt-0.5">
              <Building className="w-3 h-3" />
              {contact.company_name}
            </div>
          )}
        </div>
      )}

      {/* AI next actions */}
      <AiNextActionsCard
        result={aiNextActions}
        isLoading={aiLoading}
        isError={aiError}
        onLoad={() => setAiEnabled(true)}
        onRetry={() => aiRefetch()}
      />
    </div>
  );
}

// Need React for useState
import React from "react";
