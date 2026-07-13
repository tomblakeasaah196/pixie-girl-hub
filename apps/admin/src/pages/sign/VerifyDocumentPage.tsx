import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Loader2,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
} from "lucide-react";
import { signApi, type VerifyResult } from "@/lib/public-sign-api";
import { formatDateTime } from "@/lib/format";

const fmtWat = (iso: string) => `${formatDateTime(iso)} WAT`;

const humanType = (t: string) =>
  t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

type Stage = "loading" | "ok" | "error";

export function VerifyDocumentPage() {
  const { code = "" } = useParams<{ code: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await signApi.verify(code);
        if (cancelled) return;
        setResult(data);
        setStage("ok");
      } catch (e: unknown) {
        if (cancelled) return;
        setErrMsg(
          e instanceof Error
            ? e.message
            : "We couldn’t find a signature for that code.",
        );
        setStage("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  return (
    <div className="h-[100dvh] overflow-y-auto overscroll-contain bg-bg text-text-primary px-4 py-6 sm:px-6 sm:py-10">
      <div className="max-w-[480px] mx-auto">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-accent text-bg font-display text-[18px]">
            P
          </div>
          <div>
            <p className="font-display text-[17px] leading-none">
              Signature verification
            </p>
            <p className="text-[11px] text-text-faint mt-0.5">Pixie Girl Hub</p>
          </div>
        </div>

        <div className="glass rounded-2xl p-5 sm:p-6">
          {stage === "loading" && (
            <div className="grid place-items-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-accent-glow" />
            </div>
          )}

          {stage === "error" && (
            <div className="text-center py-10">
              <AlertCircle className="w-8 h-8 text-danger mx-auto mb-3" />
              <p className="font-display text-[18px] mb-1">
                Code not recognised
              </p>
              <p className="text-[12.5px] text-text-muted max-w-[320px] mx-auto">
                {errMsg}
              </p>
              <p className="mt-3 font-mono text-[12px] text-text-faint">
                {code}
              </p>
            </div>
          )}

          {stage === "ok" && result && (
            <div>
              <div
                className={[
                  "flex items-center gap-3 rounded-xl p-3.5 mb-4",
                  result.intact
                    ? "bg-success/12"
                    : "bg-danger/12",
                ].join(" ")}
              >
                {result.intact ? (
                  <ShieldCheck className="w-7 h-7 text-success shrink-0" />
                ) : (
                  <ShieldAlert className="w-7 h-7 text-danger shrink-0" />
                )}
                <div>
                  <p className="font-medium text-[14px]">
                    {result.intact
                      ? "Signature verified"
                      : "Integrity check failed"}
                  </p>
                  <p className="text-[11.5px] text-text-muted">
                    {result.intact
                      ? "This signature is genuine and hasn’t been altered."
                      : "This record doesn’t match its original hash."}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-surface-2 border hairline p-4">
                <VRow label="Document" value={result.document.title || "—"} />
                <VRow
                  label="Type"
                  value={humanType(result.document.request_type)}
                />
                <VRow label="Signer" value={result.signer.display_name} />
                <VRow label="Role" value={result.signer.signer_role} />
                <VRow label="Signed" value={fmtWat(result.signed_at)} />
                <div className="flex items-baseline justify-between py-1.5">
                  <span className="text-[11.5px] text-text-muted">
                    Verification code
                  </span>
                  <span className="font-mono text-[12px] text-accent-glow tracking-wide">
                    {result.verification_code}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
        <p className="text-center text-[10.5px] text-text-faint mt-4">
          Secured by Pixie Girl Hub · e-signature
        </p>
      </div>
    </div>
  );
}

function VRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b hairline last:border-0">
      <span className="text-[11.5px] text-text-muted">{label}</span>
      <span className="text-[12.5px] font-medium text-right">{value}</span>
    </div>
  );
}
