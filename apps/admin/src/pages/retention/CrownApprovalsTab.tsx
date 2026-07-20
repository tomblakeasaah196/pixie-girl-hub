/**
 * Crown Approvals — the verification queue. Honor actions (social follows)
 * auto-approve on submit; manual actions (an Instagram tag link, a "how I
 * rocked the Pixie" photo) land here for a staffer to approve or reject. Gated
 * on the `approve` action (canon §4 #3); four states throughout.
 */

import { useState } from "react";
import { CheckCircle2, XCircle, ExternalLink, ImageIcon, Inbox } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { Button, Card, EmptyState, Pill, Skeleton } from "@/components/ui/primitives";
import { ErrorState, DeniedState } from "@/components/ui/controls";
import {
  useCrownSubmissions,
  useReviewCrownSubmission,
  type CrownSubmission,
} from "@/lib/crown-api";

const ACTION_LABELS: Record<string, string> = {
  social_follow: "Social follow",
  social_tag: "Instagram tag",
  ugc_upload: "Pixie photo (UGC)",
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function CrownApprovalsTab() {
  const { can } = useAuthStore();
  if (!can("retention", "approve")) {
    return <DeniedState message="You don't have approval access for Crowns." />;
  }
  return <ApprovalsList />;
}

function ApprovalsList() {
  const q = useCrownSubmissions();
  const review = useReviewCrownSubmission();
  const [busyId, setBusyId] = useState<string | null>(null);
  const rows = q.data ?? [];

  async function decide(s: CrownSubmission, decision: "approve" | "reject") {
    setBusyId(s.submission_id);
    try {
      await review.mutateAsync({ id: s.submission_id, decision });
    } finally {
      setBusyId(null);
    }
  }

  if (q.isLoading) return <Skeleton style={{ height: 160 }} />;
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Inbox className="w-7 h-7" />}
        title="Nothing to review"
        message="Photo and Instagram-tag submissions will appear here for approval."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-text-muted">
        {rows.length} submission{rows.length === 1 ? "" : "s"} awaiting review.
      </p>
      <Card className="p-0 overflow-hidden">
        {rows.map((s, i) => (
          <div
            key={s.submission_id}
            className={`p-4 flex items-start gap-3 ${i < rows.length - 1 ? "border-b border-line" : ""}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-[14px]">{s.contact_name ?? "Pixie Queen"}</span>
                <Pill tone="warn">{ACTION_LABELS[s.action_type] ?? s.action_type}</Pill>
                {s.social_platform && (
                  <Pill tone="neutral" dot={false}>{s.social_platform}</Pill>
                )}
                <span className="text-[11.5px] text-text-faint">{timeAgo(s.submitted_at)}</span>
              </div>
              {s.rule_name && (
                <p className="text-[12px] text-text-muted mt-0.5">{s.rule_name}</p>
              )}
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                {s.social_handle && (
                  <span className="text-[12px] text-text-muted">@{s.social_handle}</span>
                )}
                {s.proof_url && (
                  <a
                    href={s.proof_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] text-accent-glow hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> View proof
                  </a>
                )}
                {s.media_asset_id && (
                  <span className="inline-flex items-center gap-1 text-[12px] text-text-muted">
                    <ImageIcon className="w-3.5 h-3.5" /> Photo attached
                  </span>
                )}
              </div>
              {s.note && <p className="text-[12px] text-text-faint mt-1 italic">“{s.note}”</p>}
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              <Button
                size="sm"
                variant="primary"
                icon={<CheckCircle2 className="w-4 h-4" />}
                disabled={busyId === s.submission_id}
                onClick={() => decide(s, "approve")}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<XCircle className="w-4 h-4" />}
                disabled={busyId === s.submission_id}
                onClick={() => decide(s, "reject")}
              >
                Reject
              </Button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
