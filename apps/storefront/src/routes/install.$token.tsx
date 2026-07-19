import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { getInstallHub, unwrap } from "@/lib/storefront";
import { usePageSlots, withSlots } from "@/lib/site-config";
import { Section, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/install/$token")({
  component: InstallHub,
});

function InstallHub() {
  const { token } = Route.useParams();
  const s = withSlots(
    {
      loading: "Loading your care hub...",
      eyebrow: "Install & care",
      heading: "Caring for your order",
      orderPrefix: "Order ",
      careGuidesLabel: "Care guides",
      whatsappCta: "Chat with us on WhatsApp",
    },
    usePageSlots("install_hub"),
  );
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["install", token],
    queryFn: async () => unwrap(await getInstallHub(token)),
  });

  if (isLoading)
    return (
      <Section>
        <p className="text-body text-muted-foreground">{s.loading}</p>
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
      <p className="text-caption">{s.eyebrow}</p>
      <h1 className="mt-2 text-h3 font-display">{s.heading}</h1>
      <p className="mt-2 text-body text-muted-foreground">
        {s.orderPrefix}
        {data.order_number}
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
          <p className="text-caption">{s.careGuidesLabel}</p>
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
          <MessageCircle size={18} /> {s.whatsappCta}
        </a>
      ) : null}
    </Section>
  );
}
