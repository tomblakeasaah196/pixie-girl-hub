import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eraser, FileSignature } from "lucide-react";
import { portalApi, getStylistToken, type ApiError } from "@/lib/api";

/**
 * Contract review + e-signature (§6.26 Q10). The partner reads the PDF,
 * draws their signature, and signing fires the same e-sign rail as the
 * emailed link — the badge auto-issues the moment it's fully signed.
 */
export const Route = createFileRoute("/dashboard/contract")({
  component: Contract,
});

function SignaturePad({
  onChange,
}: {
  onChange: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const c = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * dpr;
    c.height = 160 * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#1a0f11";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="w-full h-[160px] rounded-xl bg-cream touch-none cursor-crosshair"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = canvasRef.current!.getContext("2d")!;
          const { x, y } = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current!.getContext("2d")!;
          const { x, y } = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          setDirty(true);
          onChange(canvasRef.current!.toDataURL("image/png"));
        }}
      />
      <button
        className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-cream-muted hover:text-cream"
        onClick={() => {
          const c = canvasRef.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          setDirty(false);
          onChange(null);
        }}
      >
        <Eraser className="w-3.5 h-3.5" /> Clear
      </button>
      {!dirty && (
        <p className="text-[11px] text-cream-faint">
          Sign above with your finger or mouse.
        </p>
      )}
    </div>
  );
}

function Contract() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["portal-contract"],
    queryFn: portalApi.contract,
  });
  const [signature, setSignature] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const sign = useMutation({
    mutationFn: () => portalApi.signContract(signature!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-contract"] });
      qc.invalidateQueries({ queryKey: ["portal-me"] });
      qc.invalidateQueries({ queryKey: ["portal-badge"] });
    },
  });

  // The contract PDF needs the bearer token, so fetch it as a blob for the
  // inline viewer rather than pointing an <iframe> at the API directly.
  useEffect(() => {
    let revoke: string | null = null;
    (async () => {
      if (!q.data?.exists) return;
      const res = await fetch(portalApi.contractDocumentUrl, {
        headers: { Authorization: `Bearer ${getStylistToken()}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      revoke = URL.createObjectURL(blob);
      setPdfUrl(revoke);
    })();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [q.data?.exists, q.data?.status]);

  if (q.isLoading)
    return <div className="h-64 rounded-xl2 bg-cream/5 animate-pulse max-w-2xl" />;
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

  const c = q.data!;

  if (!c.exists)
    return (
      <div className="glass rounded-xl2 p-8 max-w-md text-center">
        <FileSignature className="w-8 h-8 mx-auto text-cream-faint mb-4" />
        <p className="font-display text-[20px] mb-2">No contract yet.</p>
        <p className="text-[13px] text-cream-muted">
          Your partner agreement is generated when your application is
          approved — it will appear here for signing.
        </p>
      </div>
    );

  const fullySigned = c.status === "fully_signed" || Boolean(c.signed_at);

  return (
    <div className="max-w-2xl space-y-5">
      {pdfUrl && (
        <iframe
          src={pdfUrl}
          title="Partner agreement"
          className="w-full h-[460px] rounded-xl2 border border-line bg-cream"
        />
      )}

      {fullySigned ? (
        <div className="glass rounded-xl2 p-6 flex items-center gap-4">
          <CheckCircle2 className="w-7 h-7 text-success shrink-0" />
          <div>
            <p className="font-display text-[18px]">Fully signed.</p>
            <p className="text-[12.5px] text-cream-muted">
              Signed{" "}
              {c.signed_at ? new Date(c.signed_at).toLocaleString() : "— recorded"} ·
              your badge is live.
            </p>
          </div>
        </div>
      ) : c.signing_token ? (
        <div className="glass rounded-xl2 p-6 space-y-4">
          <div>
            <p className="font-display text-[18px] mb-1">Sign your agreement.</p>
            <p className="text-[12.5px] text-cream-muted">
              Your signature is recorded with a tamper-evident audit trail; the
              badge issues automatically the moment you sign.
            </p>
          </div>
          <SignaturePad onChange={setSignature} />
          <button
            className="btn-primary w-full"
            disabled={!signature || sign.isPending}
            onClick={() => sign.mutate()}
          >
            {sign.isPending ? "Recording signature…" : "Sign the agreement"}
          </button>
          {sign.isError && (
            <p className="text-danger text-[12.5px] text-center">
              {(sign.error as ApiError).userMessage}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[13px] text-cream-muted">
          This contract is {c.status} — contact the programme team if that
          looks wrong.
        </p>
      )}
    </div>
  );
}
