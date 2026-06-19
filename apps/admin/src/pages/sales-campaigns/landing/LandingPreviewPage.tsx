/**
 * LandingPreviewPage — full-screen, chrome-less preview opened in a new tab
 * from the Landing Studio ("Preview tab" button). Renders the saved DRAFT
 * config for the active brand exactly as the public page will, including the
 * cinematic reveal once on load. This is what reviewers see before publish.
 */

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLandingStudio, withDefaults, useActiveBrand } from "@/lib/landing-studio";
import { LandingPreview } from "./LandingPreview";
import { AtelierRevealPreview } from "./AtelierRevealPreview";

export function LandingPreviewPage() {
  const brand = useActiveBrand();
  const studio = useLandingStudio();
  const [revealDone, setRevealDone] = useState(false);

  if (studio.isLoading) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-black">
        <Loader2 className="w-6 h-6 animate-spin text-white/70" />
      </div>
    );
  }

  const config = withDefaults(brand, studio.data?.config ?? null);

  return (
    <div className="fixed inset-0 overflow-y-auto bg-black">
      <LandingPreview config={config} />
      {config.reveal.enabled && !revealDone && (
        <AtelierRevealPreview config={config} replayKey="once" onComplete={() => setRevealDone(true)} />
      )}
    </div>
  );
}
