/**
 * Public offer packet (no login). The candidate opens this from the tokenised
 * link emailed to them, reads the full Job Description + Offer Letter, and signs
 * at the bottom. Signing runs on the existing e-signature engine (the backend
 * forwards to documents.esign), so the signature is timestamped and carries a
 * tamper-evident verification code — but the reading experience is branded.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Loader2,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  PenLine,
  Building2,
} from "lucide-react";
import { SignaturePad } from "@/components/sign/SignaturePad";
import { publicOfferApi, type PublicOffer } from "@/lib/recruitment-api";

type Stage = "loading" | "error" | "sign" | "signed" | "closed";

export function OfferPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [offer, setOffer] = useState<PublicOffer | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStage("loading");
    setErrMsg(null);
    try {
      const data = await publicOfferApi.view(token);
      setOffer(data);
      if (data.signed) {
        setCode(data.verification_code);
        setStage("signed");
      } else if (!data.can_sign) {
        setStage("closed");
      } else {
        setStage("sign");
      }
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "We couldn't open this offer link.");
      setStage("error");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!signature || !agreed || submitting) return;
    setSubmitting(true);
    setErrMsg(null);
    try {
      const result = await publicOfferApi.sign(token, signature);
      setCode(result.verification_code);
      setStage("signed");
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "We couldn't record your signature.");
      setSubmitting(false);
    }
  }

  const brandName = offer?.company?.name || "Pixie Girl Hub";

  if (stage === "loading") {
    return (
      <Shell brandName={brandName}>
        <div className="grid place-items-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-accent-glow" />
        </div>
      </Shell>
    );
  }

  if (stage === "error") {
    return (
      <Shell brandName={brandName}>
        <Centered
          icon={<AlertCircle className="h-8 w-8 text-danger" />}
          title="This offer link doesn't work"
          body={errMsg ?? "Please ask the sender for a fresh link."}
        />
      </Shell>
    );
  }

  if (stage === "closed") {
    return (
      <Shell brandName={brandName}>
        <Centered
          icon={<CheckCircle2 className="h-8 w-8 text-text-faint" />}
          title="This offer is already complete"
          body="No further action is needed. If you think this is a mistake, contact the sender."
        />
      </Shell>
    );
  }

  if (stage === "signed") {
    // Prefer the server-persisted signature; fall back to the one just drawn
    // this session so it appears immediately after signing (before any reload).
    const signatureImg = offer?.signature_data_url || signature;
    return (
      <Shell brandName={brandName}>
        <div className="text-center py-4">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-success/15">
            <CheckCircle2 className="h-8 w-8 text-success" />
          </div>
          <h1 className="mb-1 font-display text-[22px]">Offer accepted 🎉</h1>
          <p className="text-[13px] text-text-muted">
            Thank you, and welcome aboard. Your signed offer has been recorded.
          </p>
        </div>

        {/* The signed documents, still fully readable. */}
        {offer?.jd_html && <DocumentCard label="Part A — Job Description" html={offer.jd_html} />}
        {offer?.offer_letter_html && (
          <DocumentCard label="Part B — Offer Letter" html={offer.offer_letter_html} />
        )}

        {/* The actual captured signature — not just "signed". */}
        {signatureImg && (
          <div className="mb-4 rounded-2xl border hairline bg-surface-2 p-4">
            <div className="micro mb-2 flex items-center gap-1.5">
              <PenLine className="h-3.5 w-3.5 text-accent-glow" /> Your signature
            </div>
            <div className="grid place-items-center rounded-xl bg-white p-3">
              <img
                src={signatureImg}
                alt="Your signature"
                className="max-h-[110px] w-auto max-w-full"
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-[11.5px] text-text-muted">
              <span>
                {offer?.candidate_name || "Candidate"}
                {offer?.signed_at
                  ? ` · signed ${new Date(offer.signed_at).toLocaleDateString()}`
                  : ""}
              </span>
            </div>
          </div>
        )}

        {code && (
          <div className="mt-1 rounded-2xl border hairline bg-surface-2 p-4">
            <div className="micro mb-2 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-success" /> Signature verification
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[11.5px] text-text-muted">Verification code</span>
              <span className="font-mono text-[12px] tracking-wide text-accent-glow">{code}</span>
            </div>
          </div>
        )}
        <p className="mt-4 text-center text-[12.5px] leading-relaxed text-text-muted">
          <b>Your login details will be sent to you by email shortly</b> so you can access the Hub.
        </p>
      </Shell>
    );
  }

  // ── Sign flow ───────────────────────────────────────────
  return (
    <Shell brandName={brandName}>
      <div className="mb-4">
        <div className="mb-2 text-[11px] uppercase tracking-widest text-warn">
          Your offer of employment
        </div>
        <h1 className="mb-1 font-display text-[22px] leading-tight">{offer!.title}</h1>
        <p className="flex items-center gap-1.5 text-[12.5px] text-text-muted">
          <Building2 className="h-3.5 w-3.5" /> {brandName}
          {offer!.candidate_name ? ` · Prepared for ${offer!.candidate_name}` : ""}
        </p>
      </div>

      {/* The two documents, rendered as branded "paper". */}
      <DocumentCard label="Part A — Job Description" html={offer!.jd_html} />
      <DocumentCard label="Part B — Offer Letter" html={offer!.offer_letter_html} />

      {/* Company countersignature note */}
      <div className="mb-5 rounded-xl border hairline bg-surface-2 p-3 text-[12px] text-text-muted">
        Executed on behalf of {brandName} by{" "}
        <span className="text-text-primary">{offer!.company.signatory_name}</span>
        {offer!.company.signatory_title ? `, ${offer!.company.signatory_title}` : ""}.
      </div>

      {/* Sign card */}
      <div className="glass rounded-2xl p-4 sm:p-5">
        <div className="mb-1 flex items-center gap-2">
          <PenLine className="h-4 w-4 text-accent-glow" />
          <span className="text-[13.5px] font-medium">Sign to accept your offer</span>
        </div>
        <p className="mb-3 text-[11.5px] text-text-muted">Use your finger, mouse, or stylus.</p>
        <SignaturePad onChange={setSignature} disabled={submitting} />

        <label className="mt-4 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 accent-accent"
          />
          <span className="text-[12.5px] text-text-muted">
            I have read the full job description and offer letter above, and I accept this offer
            on the terms set out.
          </span>
        </label>

        {errMsg && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-danger">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {errMsg}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!signature || !agreed || submitting}
          className="mt-4 grid w-full place-items-center rounded-xl bg-accent py-3 text-[14px] font-semibold text-bg transition-all hover:bg-accent-glow disabled:opacity-40"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept & sign offer"}
        </button>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-text-faint">
          <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
          By signing you confirm you've read this offer and agree to its terms. Your signature is
          recorded with a timestamp and a tamper-proof verification code.
        </p>
      </div>
    </Shell>
  );
}

// ── Document "paper" ──────────────────────────────────────
function DocumentCard({ label, html }: { label: string; html: string }) {
  return (
    <div className="mb-4">
      <div className="micro mb-2">{label}</div>
      <div
        className="offer-doc max-h-[420px] overflow-y-auto rounded-xl border hairline bg-white p-5 text-[13px] leading-relaxed text-neutral-800"
        // Content is server-rendered from markdown with all HTML escaped, so this
        // is safe — no raw tags from the author survive the backend renderer.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style>{`
        .offer-doc h1 { font-size: 18px; font-weight: 700; margin: 0 0 6px; }
        .offer-doc h2 { font-size: 15px; font-weight: 700; margin: 16px 0 6px; }
        .offer-doc h3 { font-size: 13.5px; font-weight: 700; margin: 12px 0 4px; }
        .offer-doc p { margin: 0 0 8px; }
        .offer-doc ul, .offer-doc ol { margin: 0 0 8px 18px; }
        .offer-doc li { margin: 2px 0; }
        .offer-doc table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        .offer-doc th, .offer-doc td { border: 1px solid #e5e5e5; padding: 5px 8px; text-align: left; font-size: 12px; }
        .offer-doc hr { border: 0; border-top: 1px solid #e5e5e5; margin: 12px 0; }
        .offer-doc strong { font-weight: 700; }
      `}</style>
    </div>
  );
}

function Centered({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="py-10 text-center">
      <div className="mb-3 grid place-items-center">{icon}</div>
      <p className="mb-1 font-display text-[18px]">{title}</p>
      <p className="mx-auto max-w-[360px] text-[12.5px] leading-relaxed text-text-muted">{body}</p>
    </div>
  );
}

function Shell({ brandName, children }: { brandName: string; children: React.ReactNode }) {
  return (
    <div className="h-[100dvh] overflow-y-auto overscroll-contain bg-bg px-4 py-6 text-text-primary sm:px-6 sm:py-10">
      <div className="mx-auto max-w-[620px]">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent font-display text-[18px] text-bg">
            {brandName[0]}
          </div>
          <div>
            <p className="font-display text-[17px] leading-none">{brandName}</p>
            <p className="mt-0.5 text-[11px] text-text-faint">Offer of employment</p>
          </div>
        </div>
        <div className="glass rounded-2xl p-5 sm:p-6">{children}</div>
        <p className="mt-4 text-center text-[10.5px] text-text-faint">
          Secured by Pixie Girl Hub · e-signature
        </p>
      </div>
    </div>
  );
}

export default OfferPage;
