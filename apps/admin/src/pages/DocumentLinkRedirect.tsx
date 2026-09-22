import { useEffect } from "react";
import { useParams } from "react-router-dom";

/**
 * `/i/<uuid>` and `/r/<uuid>` reached the SPA instead of the backend.
 *
 * That happens on any host whose nginx serves the SPA for non-/api paths
 * (all vhosts in this repo do — see ops/hub/nginx-document-links.conf) and
 * the request wasn't proxied to Node. The customer clicked "View your
 * invoice" and would otherwise get a login page: the exact failure that
 * started this work.
 *
 * The API path is always proxied, so bounce there immediately — a top-level
 * navigation, not a router navigation, because the destination is a PDF
 * streamed by the backend, not a React route.
 */
export function DocumentLinkRedirect({
  kind,
}: {
  kind: "invoice" | "receipt";
}) {
  const { id } = useParams<{ id: string }>();
  useEffect(() => {
    const safe = String(id ?? "");
    // UUIDs only — never forward arbitrary path text into a URL.
    if (!/^[0-9a-f-]{36}$/i.test(safe)) return;
    window.location.replace(
      `/api/public/documents/${kind}/${encodeURIComponent(safe)}`,
    );
  }, [id, kind]);

  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6">
      <div className="text-center">
        <div className="text-[13px] font-medium text-text-primary">
          Opening your {kind}…
        </div>
        <div className="mt-1 text-[11.5px] text-text-faint">
          If nothing happens, the document link may have expired.
        </div>
      </div>
    </div>
  );
}
