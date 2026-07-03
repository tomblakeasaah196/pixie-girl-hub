import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scissors } from "lucide-react";
import { portalApi, type Assignment, type ApiError } from "@/lib/api";

/** Accepted work: start → complete; completion opens the quality hold. */
export const Route = createFileRoute("/dashboard/jobs")({
  component: Jobs,
});

function holdLabel(a: Assignment): { text: string; cls: string } {
  if (a.status !== "completed") return { text: "", cls: "" };
  if (a.disputed_at && !a.dispute_resolved_at)
    return { text: "Under review", cls: "text-danger" };
  if (a.payout_id) return { text: "Paid out", cls: "text-success" };
  if (a.satisfaction_confirmed_at)
    return { text: "Customer confirmed — payable", cls: "text-success" };
  if (a.payable_at && new Date(a.payable_at) <= new Date())
    return { text: "Hold lapsed — payable", cls: "text-success" };
  if (a.payable_at)
    return {
      text: `Releases ${new Date(a.payable_at).toLocaleDateString()}`,
      cls: "text-warn",
    };
  return { text: "On hold", cls: "text-warn" };
}

const STATUS_LABEL: Record<string, string> = {
  accepted: "Accepted",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

function Jobs() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["portal-assignments"],
    queryFn: () => portalApi.assignments(),
  });
  const act = useMutation({
    mutationFn: ([id, action]: [string, "start" | "complete"]) =>
      portalApi.assignmentAction(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-assignments"] });
      qc.invalidateQueries({ queryKey: ["portal-earnings"] });
      qc.invalidateQueries({ queryKey: ["portal-me"] });
    },
  });

  if (q.isLoading)
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-xl2 bg-cream/5 animate-pulse" />
        ))}
      </div>
    );
  if (q.isError)
    return (
      <div className="text-center py-16">
        <p className="text-danger text-[14px] mb-4">
          {(q.error as ApiError).userMessage}
        </p>
        <button className="btn-ghost" onClick={() => q.refetch()}>
          Retry
        </button>
      </div>
    );

  const jobs = (q.data ?? []).filter((a) =>
    ["accepted", "in_progress", "completed", "disputed"].includes(a.status),
  );

  if (jobs.length === 0)
    return (
      <div className="text-center py-20">
        <Scissors className="w-8 h-8 mx-auto text-cream-faint mb-4" />
        <p className="font-display text-[20px] mb-1">No jobs yet.</p>
        <p className="text-[13px] text-cream-muted">
          Accepted offers become jobs here — start when the customer arrives,
          complete when the work is done.
        </p>
      </div>
    );

  return (
    <div className="space-y-3">
      {jobs.map((a) => {
        const hold = holdLabel(a);
        return (
          <div key={a.assignment_id} className="glass rounded-xl2 p-5 flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-display text-[17px] capitalize">
                {a.service_key}{" "}
                <span className="text-[11px] font-body font-bold uppercase tracking-wider text-cream-faint ml-2">
                  {STATUS_LABEL[a.status] ?? a.status}
                </span>
              </p>
              <p className="text-[12px] text-cream-faint font-mono">{a.assignment_number}</p>
              <p className="text-[12.5px] text-cream-muted mt-1">
                {a.net_payout && <>Net ₦{Number(a.net_payout).toLocaleString()} · </>}
                {a.customer_rating && <>{a.customer_rating}★ verified · </>}
                {hold.text && <span className={hold.cls}>{hold.text}</span>}
              </p>
            </div>
            {a.status === "accepted" && (
              <button
                className="btn-primary !py-2.5 !px-5"
                disabled={act.isPending}
                onClick={() => act.mutate([a.assignment_id, "start"])}
              >
                Start job
              </button>
            )}
            {a.status === "in_progress" && (
              <button
                className="btn-primary !py-2.5 !px-5"
                disabled={act.isPending}
                onClick={() => act.mutate([a.assignment_id, "complete"])}
              >
                Mark complete
              </button>
            )}
          </div>
        );
      })}
      {act.isError && (
        <p className="text-danger text-[12.5px]">
          {(act.error as ApiError).userMessage}
        </p>
      )}
      <p className="text-[11.5px] text-cream-faint">
        Completing a job sends the customer their confirm-and-review link; your
        payment releases when they confirm or the hold window lapses.
      </p>
    </div>
  );
}
