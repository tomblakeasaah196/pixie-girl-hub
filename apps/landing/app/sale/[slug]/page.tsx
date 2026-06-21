import { notFound, redirect } from "next/navigation";
import { fetchCampaign } from "@/lib/api";
import { deriveState } from "@/lib/state-engine";

interface Params {
  slug: string;
}

export const dynamic = "force-dynamic";

/**
 * State router for /sale/[slug]. Server-only — no UI.
 *
 * The four states each own their own URL so the browser bar and any shared
 * links accurately describe what the visitor is looking at:
 *   /sale/[slug]/before  → cinematic countdown (Atelier Hourglass)
 *   /sale/[slug]/live    → the live drop (LandingShell)
 *   /sale/[slug]/ended   → the ended farewell (LandingShell)
 *
 * deriveState is the same engine the live shell uses; it tolerates a small
 * lag between the backend's cron flip and render time by using the times as
 * a tiebreaker.
 */
export default async function Page({ params }: { params: Params }) {
  const payload = await fetchCampaign(params.slug);
  if (!payload) notFound();
  const { state } = deriveState(payload);
  redirect(`/sale/${params.slug}/${state}`);
}
