import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCrownProgramme, type CrownProgramme as Programme } from "@/lib/crowns";
import { CrownProgramme } from "@/components/crowns";
import { Section, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/crowns")({ component: CrownsPage });

function CrownsPage() {
  const [programme, setProgramme] = useState<Programme | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let active = true;
    getCrownProgramme()
      .then((p) => {
        if (!active) return;
        setProgramme(p);
        setState("ready");
      })
      .catch(() => active && setState("error"));
    return () => {
      active = false;
    };
  }, []);

  return (
    <Section>
      {/* Hero */}
      <div className="max-w-2xl">
        <p className="text-caption">Rewards</p>
        <h1 className="mt-2 text-h2 font-display">Crowns 👑</h1>
        <p className="mt-3 text-body text-muted-foreground">
          Join free and earn Crowns every time you shop, refer a friend, follow
          us, or share your look. The more Crowns you collect, the bigger your
          discounts — and your streak keeps the rewards coming.
        </p>
        <div className="mt-5">
          <Link
            to="/account"
            className="inline-block rounded-full bg-primary px-6 py-2.5 text-body text-primary-foreground"
          >
            Join &amp; view your Crowns
          </Link>
        </div>
      </div>

      <div className="mt-12">
        {state === "loading" ? (
          <p className="text-body-sm text-muted-foreground">Loading the programme…</p>
        ) : state === "error" ? (
          <ErrorState onRetry={() => window.location.reload()} />
        ) : programme ? (
          <CrownProgramme programme={programme} />
        ) : null}
      </div>
    </Section>
  );
}
