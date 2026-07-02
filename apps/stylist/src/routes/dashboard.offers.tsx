import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { portalApi, type ApiError } from "@/lib/api";

/** Open offers — first to accept wins (§6.26 routing). */
export const Route = createFileRoute("/dashboard/offers")({
  component: Offers,
});

function timeLeft(expires: string): string {
  const ms = new Date(expires).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

function Offers() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["portal-offers"],
    queryFn: portalApi.offers,
    refetchInterval: 30_000,
  });
  const act = useMutation({
    mutationFn: ([id, action]: [string, "accept" | "decline"]) =>
      portalApi.assignmentAction(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-offers"] });
      qc.invalidateQueries({ queryKey: ["portal-assignments"] });
      qc.invalidateQueries({ queryKey: ["portal-me"] });
    },
  });

  if (q.isLoading)
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl2 bg-cream/5 animate-pulse" />
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

  const offers = q.data ?? [];
  if (offers.length === 0)
    return (
      <div className="text-center py-20">
        <Inbox className="w-8 h-8 mx-auto text-cream-faint mb-4" />
        <p className="font-display text-[20px] mb-1">No open offers.</p>
        <p className="text-[13px] text-cream-muted">
          When Pixie routes a nearby job to you, it lands here — and the first
          partner to accept wins it.
        </p>
      </div>
    );

  return (
    <div className="space-y-3">
      {offers.map((o) => (
        <div
          key={o.offer_id}
          className="glass rounded-xl2 p-5 flex flex-wrap items-center gap-4"
        >
          <div className="min-w-0 flex-1">
            <p className="font-display text-[18px] capitalize">{o.service_key}</p>
            <p className="text-[12px] text-cream-faint font-mono">
              {o.assignment_number}
            </p>
            <p className="text-[12.5px] text-cream-muted mt-1">
              {o.base_rate && <>Rate ₦{Number(o.base_rate).toLocaleString()} · </>}
              {o.scheduled_at
                ? `scheduled ${new Date(o.scheduled_at).toLocaleString()}`
                : "scheduling agreed after acceptance"}
            </p>
          </div>
          <span className="text-[11.5px] font-bold text-warn whitespace-nowrap">
            {timeLeft(o.offer_expires_at)}
          </span>
          <div className="flex gap-2">
            <button
              className="btn-primary !py-2.5 !px-5"
              disabled={act.isPending}
              onClick={() => act.mutate([o.assignment_id, "accept"])}
            >
              Accept
            </button>
            <button
              className="btn-ghost !py-2.5 !px-5"
              disabled={act.isPending}
              onClick={() => act.mutate([o.assignment_id, "decline"])}
            >
              Decline
            </button>
          </div>
        </div>
      ))}
      {act.isError && (
        <p className="text-danger text-[12.5px]">
          {(act.error as ApiError).userMessage}
        </p>
      )}
    </div>
  );
}
