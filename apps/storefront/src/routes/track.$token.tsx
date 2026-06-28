import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { trackOrder, unwrap } from "@/lib/storefront";
import { Section, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/track/$token")({ component: TrackPage });

interface TimelineEvent {
  event_type?: string;
  label?: string;
  title?: string;
  description?: string;
  created_at?: string;
  occurred_at?: string;
}
interface Tracking {
  order_number?: string;
  status?: string;
  events?: TimelineEvent[];
  timeline?: TimelineEvent[];
}

function TrackPage() {
  const { token } = Route.useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["track", token],
    queryFn: async () => unwrap(await trackOrder(token)) as Tracking,
    // Near-real-time: poll every 20s while the order is still in flight; stop
    // once it reaches a terminal state. (Socket.io can replace this later.)
    refetchInterval: (q) => {
      const s = String((q.state.data as Tracking | undefined)?.status || "");
      return ["delivered", "cancelled", "refunded", "completed"].includes(s)
        ? false
        : 20000;
    },
    refetchOnWindowFocus: true,
  });

  if (isLoading)
    return (
      <Section>
        <p className="text-body text-muted-foreground">Loading your order...</p>
      </Section>
    );
  if (isError || !data)
    return (
      <Section>
        <ErrorState onRetry={() => refetch()} />
      </Section>
    );

  const events = data.events || data.timeline || [];

  return (
    <Section className="max-w-2xl">
      <p className="text-caption">Order tracking</p>
      <h1 className="mt-2 text-h3 font-display">
        {data.order_number || "Your order"}
      </h1>
      {data.status ? (
        <p className="mt-2 text-body capitalize text-muted-foreground">
          Status: {String(data.status).replace(/_/g, " ")}
        </p>
      ) : null}

      <ol className="mt-8 space-y-5 border-l border-border pl-6">
        {events.length === 0 ? (
          <li className="text-body-sm text-muted-foreground">
            No updates yet - check back soon.
          </li>
        ) : (
          events.map((e, i) => (
            <li key={i} className="relative">
              <span className="absolute -left-[27px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
              <p className="text-body">
                {e.label || e.title || (e.event_type || "").replace(/_/g, " ")}
              </p>
              {e.description ? (
                <p className="text-body-sm text-muted-foreground">{e.description}</p>
              ) : null}
              {e.created_at || e.occurred_at ? (
                <p className="mt-0.5 text-body-sm text-muted-foreground">
                  {new Date(e.created_at || e.occurred_at!).toLocaleString()}
                </p>
              ) : null}
            </li>
          ))
        )}
      </ol>
    </Section>
  );
}
