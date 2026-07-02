import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Download, ExternalLink } from "lucide-react";
import { portalApi, getStylistToken, type ApiError } from "@/lib/api";

/** The verifiable badge (§6.26 Q11): QR, live verify link, printable card. */
export const Route = createFileRoute("/dashboard/badge")({
  component: Badge,
});

async function downloadCard() {
  const res = await fetch(portalApi.badgeCardUrl, {
    headers: { Authorization: `Bearer ${getStylistToken()}` },
  });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pixie-partner-badge.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Badge() {
  const q = useQuery({ queryKey: ["portal-badge"], queryFn: portalApi.badge });

  if (q.isLoading)
    return <div className="h-72 rounded-xl2 bg-cream/5 animate-pulse max-w-md" />;
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

  const b = q.data!;
  if (!b.issued)
    return (
      <div className="glass rounded-xl2 p-8 max-w-md text-center">
        <BadgeCheck className="w-8 h-8 mx-auto text-cream-faint mb-4" />
        <p className="font-display text-[20px] mb-2">No badge issued yet.</p>
        <p className="text-[13px] text-cream-muted">
          Your badge issues automatically the moment your partner agreement is
          fully signed.{" "}
          <Link to="/dashboard/contract" className="text-accent-glow no-underline hover:underline">
            Check your contract →
          </Link>
        </p>
      </div>
    );

  const verifyPath = b.verify_url ? new URL(b.verify_url).pathname : null;

  return (
    <div className="grid lg:grid-cols-2 gap-6 items-start max-w-3xl">
      <div className="glass rounded-xl2 p-7 text-center">
        <p className="micro mb-3">Pixie Girl Global</p>
        {b.tier_label && (
          <span className="inline-block px-3 py-1 rounded-full border border-accent text-[10px] font-bold tracking-[0.18em] uppercase mb-3">
            {b.tier_label} Partner
          </span>
        )}
        <p className="font-mono text-[11.5px] text-cream-faint mb-4">
          {b.partner_code}
        </p>
        {b.qr_data_url && (
          <img
            src={b.qr_data_url}
            alt="Badge verification QR"
            className="mx-auto w-44 h-44 rounded-xl bg-cream p-2"
          />
        )}
        {b.tier_expires_at && (
          <p className="text-[10.5px] text-cream-faint mt-3">
            Tier valid to{" "}
            {new Date(b.tier_expires_at).toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-[13.5px] text-cream-muted leading-relaxed">
          Print it, pin it, put it in your bio — anyone who scans lands on your
          live verification page. If your status ever changes, the page changes
          with it; the badge can never lie for you or against you.
        </p>
        <button
          className="btn-primary w-full"
          onClick={() => downloadCard().catch(() => alert("Download failed"))}
        >
          <Download className="w-4 h-4" /> Download badge card (PDF)
        </button>
        {verifyPath && (
          <a
            href={verifyPath}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost w-full no-underline"
          >
            <ExternalLink className="w-4 h-4" /> Open your verify page
          </a>
        )}
        {b.verify_url && (
          <p className="font-mono text-[11px] text-cream-faint break-all">
            {b.verify_url}
          </p>
        )}
      </div>
    </div>
  );
}
