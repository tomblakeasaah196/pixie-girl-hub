import { notFound } from "next/navigation";
import { fetchCampaign } from "@/lib/api";
import { CheckoutClient } from "@/components/checkout/CheckoutClient";

export default async function CheckoutPage({ params }: { params: { slug: string } }) {
  const payload = await fetchCampaign(params.slug);
  if (!payload) notFound();
  return <CheckoutClient payload={payload} />;
}
