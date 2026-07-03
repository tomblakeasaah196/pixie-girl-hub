/**
 * Verified reviews moderation (§6.26 Q15). Only platform-routed customers can
 * review (token link), so ratings can't be gamed — moderation is hide/show
 * for abusive content, never editing. Hiding recomputes the partner's public
 * aggregate on the backend.
 */

import { useState } from "react";
import { Star } from "lucide-react";
import { Button, Pill } from "@/components/ui/primitives";
import { ErrorState } from "@/components/ui/controls";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { useAuthStore } from "@/stores/auth";
import { useVerifiedReviews, useReviewVisibilityMutation } from "./hooks";
import type { VerifiedReview } from "./types";

export function ReviewsPanel() {
  const can = useAuthStore((s) => s.can);
  const [showHidden, setShowHidden] = useState(false);
  const reviews = useVerifiedReviews({ hidden: showHidden || undefined });
  const visibility = useReviewVisibilityMutation();
  const canModerate = can("stylist_programme", "edit");

  const columns: Column<VerifiedReview>[] = [
    {
      key: "stylist",
      header: "Partner",
      render: (r) => (
        <span className="text-[13px] font-semibold">
          {r.stylist_name ?? "—"}
        </span>
      ),
    },
    {
      key: "rating",
      header: "Rating",
      render: (r) => (
        <span className="inline-flex items-center gap-1 tabular-nums text-[12.5px]">
          <Star className="w-3.5 h-3.5 text-warn" /> {r.customer_rating}
        </span>
      ),
    },
    {
      key: "review",
      header: "Review",
      render: (r) => (
        <span className="text-[12.5px] text-text-muted line-clamp-2 max-w-[380px] inline-block">
          {r.customer_review ?? <em className="text-text-faint">rating only</em>}
        </span>
      ),
    },
    {
      key: "when",
      header: "Received",
      render: (r) => (
        <span className="tabular-nums text-[12px]">
          {new Date(r.reviewed_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "vis",
      header: "Visibility",
      render: (r) =>
        r.review_hidden ? (
          <Pill tone="neutral" dot={false}>Hidden</Pill>
        ) : (
          <Pill tone="success" dot={false}>Public</Pill>
        ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) =>
        canModerate ? (
          <Button
            size="sm"
            variant={r.review_hidden ? "secondary" : "ghost"}
            disabled={visibility.isPending}
            onClick={() => visibility.mutate([r.assignment_id, !r.review_hidden])}
          >
            {r.review_hidden ? "Unhide" : "Hide"}
          </Button>
        ) : null,
    },
  ];

  if (reviews.isError)
    return (
      <ErrorState
        message={(reviews.error as Error).message}
        onRetry={() => reviews.refetch()}
      />
    );

  return (
    <DataTable
      columns={columns}
      rows={reviews.data ?? []}
      rowKey={(r) => r.assignment_id}
      loading={reviews.isLoading}
      toolbar={
        <label className="flex items-center gap-2 text-[12.5px] text-text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Include hidden
        </label>
      }
      empty={{
        icon: <Star className="w-6 h-6" />,
        title: "No verified reviews yet",
        message:
          "Customers review through the secure link sent when their service completes — reviews cannot be created any other way.",
      }}
    />
  );
}
