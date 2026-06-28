import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { getInstallHub, unwrap } from "@/lib/storefront";
import { Section, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/install/$token")({
  component: InstallHub,
});

function InstallHub() {
  const { token } = Route.useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["install", token],
    queryFn: async () => unwrap(await getInstallHub(token)),
  });

  if (isLoading)
    return (
      <Section>
        <p className="text-body text-muted-foreground">Loading your care hub...</p>
      </Section>
    );
  if (isError || !data)
    return (
      <Section>
        <ErrorState onRetry={() => refetch()} />
      </Section>
    );

  return (
    <Section className="max-w-2xl">
      <p className="text-caption">Install &amp; care</p>
      <h1 className="mt-2 text-h3 font-display">Caring for your order</h1>
      <p className="mt-2 text-body text-muted-foreground">
        Order {data.order_number}
      </p>

      {data.items?.length ? (
        <ul className="mt-6 space-y-1 text-body-sm">
          {data.items.map((it, i) => (
            <li key={i}>- {it.name}</li>
          ))}
        </ul>
      ) : null}

      {data.care_guides?.length ? (
        <div className="mt-8">
          <p className="text-caption">Care guides</p>
          <ul className="mt-3 space-y-2">
            {data.care_guides.map((g) => (
              <li key={g.slug} className="text-body">
                {g.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.whatsapp_help_url ? (
        <a
          href={data.whatsapp_help_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-body text-primary-foreground"
        >
          <MessageCircle size={18} /> Chat with us on WhatsApp
        </a>
      ) : null}
    </Section>
  );
}
