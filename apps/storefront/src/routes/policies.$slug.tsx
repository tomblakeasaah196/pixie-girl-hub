import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getContentPost } from "@/lib/storefront";
import { Section } from "@/components/parts";

export const Route = createFileRoute("/policies/$slug")({
  component: PolicyPage,
});

const TITLES: Record<string, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
  returns: "Returns & Refunds",
  shipping: "Shipping Policy",
};

function PolicyPage() {
  const { slug } = Route.useParams();
  const { data } = useQuery({
    queryKey: ["policy", slug],
    queryFn: () => getContentPost("policy", slug),
    retry: false,
  });
  const title = data?.title || TITLES[slug] || slug.replace(/-/g, " ");

  return (
    <Section className="max-w-2xl">
      <h1 className="text-h3 font-display capitalize">{title}</h1>
      {data?.body_html ? (
        <div
          className="prose mt-8 max-w-none text-body"
          dangerouslySetInnerHTML={{ __html: data.body_html }}
        />
      ) : data?.body_md ? (
        <p className="mt-8 whitespace-pre-wrap text-body">{data.body_md}</p>
      ) : (
        <p className="mt-8 text-body text-muted-foreground">
          This policy will be published shortly. For any questions in the
          meantime, please contact our support team.
        </p>
      )}
    </Section>
  );
}
