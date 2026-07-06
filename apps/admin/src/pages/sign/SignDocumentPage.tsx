import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Loader2,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
  FileText,
  PenLine,
  KeyRound,
  Lock,
  Clock,
  ExternalLink,
  Download,
} from "lucide-react";
import {
  signApi,
  type SignRequestView,
  type SignPayload,
} from "@/lib/public-sign-api";
import { SignaturePad } from "@/components/sign/SignaturePad";

type Stage =
  | "loading"
  | "error"
  | "sign"
  | "signed"
  | "declined"
  | "closed"
  | "waiting";

interface SignedInfo {
  verification_code: string;
  signed_at: string;
  display_name: string;
  signer_role: string;
  saved_signature?: boolean;
  signed_document_ready?: boolean;
}

const brandName = (b?: string | null) =>
  b === "faitlynhair"
    ? "Faitlyn Hair"
    : b === "pixiegirl"
      ? "Pixie Girl Global"
      : "Pixie Girl Hub";

const fmtWat = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }) + " WAT";

const humanType = (t: string) =>
  t
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

export function SignDocumentPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [stage, setStage] = useState<Stage>("loading");
  const [view, setView] = useState<SignRequestView | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [signed, setSigned] = useState<SignedInfo | null>(null);

  // sign-flow state
  const [mode, setMode] = useState<"pin" | "draw">("draw");
  const [signature, setSignature] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [savePin, setSavePin] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // decline
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const load = useCallback(async () => {
    setStage("loading");
    setErrMsg(null);
    try {
      const data = await signApi.view(token);
      setView(data);

      if (data.signer.status === "signed") {
        setSigned({
          verification_code: data.signer.verification_code ?? "—",
          signed_at: data.signer.signed_at ?? new Date().toISOString(),
          display_name: data.signer.display_name,
          signer_role: data.signer.signer_role,
        });
        setStage("signed");
        return;
      }
      const terminal = [
        "declined",
        "cancelled",
        "expired",
        "voided",
        "fully_signed",
      ];
      if (terminal.includes(data.request.status)) {
        setStage("closed");
        return;
      }
      if (!data.signer.can_sign) {
        setStage("waiting");
        return;
      }
      // A saved signature (and not locked) → PIN is the fast path.
      setMode(data.has_saved_signature && !data.saved_signature_locked ? "pin" : "draw");
      setStage("sign");
    } catch (e: unknown) {
      setErrMsg(
        e instanceof Error ? e.message : "We couldn't open this signing link.",
      );
      setStage("error");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (mode === "pin") return /^\d{4,6}$/.test(pin);
    // draw mode
    if (!signature) return false;
    if (savePin && !view?.has_saved_signature) {
      return /^\d{4,6}$/.test(pin) && pin === pinConfirm;
    }
    return true;
  }, [mode, pin, pinConfirm, savePin, signature, submitting, view]);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrMsg(null);
    try {
      const body: SignPayload =
        mode === "pin"
          ? { pin }
          : {
              signature_data_url: signature!,
              ...(savePin && !view?.has_saved_signature
                ? { pin, save_signature: true }
                : {}),
            };
      const result = await signApi.sign(token, body);
      setSigned(result.signed);
      setStage("signed");
    } catch (e: unknown) {
      setErrMsg(
        e instanceof Error ? e.message : "We couldn't record your signature.",
      );
      setSubmitting(false);
    }
  }

  async function doDecline() {
    setSubmitting(true);
    setErrMsg(null);
    try {
      await signApi.decline(token, declineReason || undefined);
      setStage("declined");
    } catch (e: unknown) {
      setErrMsg(
        e instanceof Error ? e.message : "We couldn't record your response.",
      );
      setSubmitting(false);
    }
  }

  // ── Render states ───────────────────────────────────────
  if (stage === "loading") {
    return (
      <Shell>
        <div className="grid place-items-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-accent-glow" />
        </div>
      </Shell>
    );
  }

  if (stage === "error") {
    return (
      <Shell>
        <Centered
          icon={<AlertCircle className="w-8 h-8 text-danger" />}
          title="This signing link doesn’t work"
          body={errMsg ?? "Please ask the sender for a fresh link."}
        />
      </Shell>
    );
  }

  if (stage === "closed") {
    return (
      <Shell brand={view?.request.business}>
        <Centered
          icon={<Lock className="w-8 h-8 text-text-faint" />}
          title="This document is closed"
          body="It has already been completed, cancelled, or has expired. No signature is needed."
        />
      </Shell>
    );
  }

  if (stage === "waiting") {
    return (
      <Shell brand={view?.request.business}>
        <Centered
          icon={<Clock className="w-8 h-8 text-warn" />}
          title="It’s not your turn yet"
          body="This document is signed in order. You’ll be able to sign once the signer before you is done — we’ll email you when it’s your turn."
        />
      </Shell>
    );
  }

  if (stage === "declined") {
    return (
      <Shell brand={view?.request.business}>
        <Centered
          icon={<AlertCircle className="w-8 h-8 text-danger" />}
          title="You declined to sign"
          body="Thanks for letting us know. The sender has been notified."
        />
      </Shell>
    );
  }

  if (stage === "signed" && signed) {
    return (
      <Shell brand={view?.request.business}>
        <SignedConfirmation signed={signed} view={view} token={token} />
      </Shell>
    );
  }

  // ── Sign flow ───────────────────────────────────────────
  const req = view!.request;
  return (
    <Shell brand={req.business}>
      {/* Header */}
      <div className="mb-4">
        <div className="text-[11px] uppercase tracking-widest text-warn mb-2">
          Awaiting your signature
        </div>
        <h1 className="font-display text-[20px] leading-tight mb-1">
          {req.document_title || req.subject}
        </h1>
        <p className="text-[12.5px] text-text-muted">
          {humanType(req.request_type)}
          {req.expires_at ? ` · Expires ${fmtWat(req.expires_at)}` : ""}
        </p>
      </div>

      {req.message && (
        <div className="rounded-xl bg-surface-2 border hairline p-3 mb-4 text-[12.5px] text-text-muted">
          {req.message}
        </div>
      )}

      {/* Signer meta */}
      <div className="grid grid-cols-2 gap-px rounded-xl overflow-hidden border hairline mb-4">
        <Meta label="Signing as" value={view!.signer.display_name} />
        <Meta label="Role" value={view!.signer.signer_role} />
      </div>

      {/* Document preview */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <div className="micro">Document</div>
          <a
            href={signApi.documentUrl(token)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11.5px] text-accent-glow hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </a>
        </div>
        <div className="rounded-xl overflow-hidden border hairline bg-surface-2">
          <iframe
            title="Document to sign"
            src={signApi.documentUrl(token)}
            className="w-full h-[360px] bg-white"
          />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-faint">
          <FileText className="w-3 h-3" />
          Read the full document above before signing.
        </p>
      </div>

      {/* Sign card */}
      <div className="glass rounded-2xl p-4 sm:p-5">
        {mode === "pin" ? (
          <PinEntry
            title="Enter your PIN to sign"
            hint="The PIN you set when you saved your signature."
            pin={pin}
            setPin={setPin}
            onSubmit={submit}
          />
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <PenLine className="w-4 h-4 text-accent-glow" />
              <span className="text-[13.5px] font-medium">
                Draw your signature
              </span>
            </div>
            <p className="text-[11.5px] text-text-muted mb-3">
              Use your finger, mouse, or stylus.
            </p>
            <SignaturePad onChange={setSignature} disabled={submitting} />

            {/* Save-with-PIN (only when there's no signature on file yet) */}
            {!view!.has_saved_signature ? (
              <div className="mt-4 rounded-xl bg-surface-2 border hairline p-3">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={savePin}
                    onChange={(e) => setSavePin(e.target.checked)}
                    className="mt-0.5 accent-accent"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-[12.5px] font-medium">
                      <KeyRound className="w-3.5 h-3.5 text-accent-glow" />
                      Save my signature with a PIN
                    </span>
                    <span className="block text-[11.5px] text-text-muted mt-0.5">
                      Set a PIN once and you won’t have to draw again — next
                      document, just enter your PIN.
                    </span>
                  </span>
                </label>
                {savePin && (
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <PinField
                      label="Create a PIN"
                      value={pin}
                      onChange={setPin}
                    />
                    <PinField
                      label="Confirm PIN"
                      value={pinConfirm}
                      onChange={setPinConfirm}
                      mismatch={
                        pinConfirm.length > 0 && pin !== pinConfirm
                      }
                    />
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode("pin");
                  setSignature(null);
                }}
                className="mt-3 text-[12px] text-accent-glow hover:underline"
              >
                Use my saved PIN instead
              </button>
            )}
          </div>
        )}

        {/* Forgot-PIN escape hatch (returning signer). */}
        {mode === "pin" && (
          <button
            type="button"
            onClick={() => {
              setMode("draw");
              setPin("");
            }}
            className="mt-3 text-[12px] text-text-muted hover:text-text-primary transition-colors"
          >
            Forgot your PIN? Draw your signature instead
          </button>
        )}

        {errMsg && (
          <p className="mt-3 text-[12px] text-danger inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {errMsg}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="mt-4 w-full grid place-items-center rounded-xl bg-accent text-bg font-semibold py-3 text-[14px] hover:bg-accent-glow disabled:opacity-40 transition-all"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "Sign document"
          )}
        </button>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-text-faint leading-relaxed">
          <ShieldCheck className="w-3.5 h-3.5 mt-px shrink-0" />
          By signing you confirm you’ve read this document and agree to its
          terms. Your signature is recorded with a timestamp and a tamper-proof
          verification code.
        </p>
      </div>

      {/* Decline */}
      {!showDecline ? (
        <button
          type="button"
          onClick={() => setShowDecline(true)}
          className="mt-4 block mx-auto text-[12px] text-text-muted hover:text-danger transition-colors underline underline-offset-2"
        >
          Decline to sign
        </button>
      ) : (
        <div className="mt-4 rounded-xl border hairline p-3">
          <p className="text-[12.5px] font-medium mb-2">Decline to sign?</p>
          <textarea
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            placeholder="Reason (optional)"
            rows={2}
            className="w-full rounded-lg bg-surface-2 border hairline px-3 py-2 text-[12.5px] focus:outline-none focus:border-accent/40 resize-none"
          />
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => setShowDecline(false)}
              className="flex-1 rounded-lg border hairline py-2 text-[12.5px] hover:bg-surface-2 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={doDecline}
              disabled={submitting}
              className="flex-1 rounded-lg bg-danger/90 text-white py-2 text-[12.5px] font-medium hover:bg-danger disabled:opacity-50 transition-colors"
            >
              Confirm decline
            </button>
          </div>
        </div>
      )}
    </Shell>
  );
}

// ── Signed confirmation ───────────────────────────────────
function SignedConfirmation({
  signed,
  view,
  token,
}: {
  signed: SignedInfo;
  view: SignRequestView | null;
  token: string;
}) {
  const signedReady =
    signed.signed_document_ready || view?.signed_document_ready;
  const isFullySigned = view?.request.status === "fully_signed" || signedReady;
  return (
    <div>
      <div className="text-center py-4">
        <div className="w-14 h-14 rounded-full bg-success/15 grid place-items-center mx-auto mb-3">
          <CheckCircle2 className="w-8 h-8 text-success" />
        </div>
        <h1 className="font-display text-[22px] mb-1">Document signed</h1>
        <p className="text-[13px] text-text-muted">
          Your signature has been recorded and verified.
        </p>
      </div>

      {view?.request.document_title && (
        <p className="text-center text-[13px] mb-4">
          {view.request.document_title}
        </p>
      )}

      <div className="rounded-2xl bg-surface-2 border hairline p-4">
        <div className="micro mb-3 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-success" />
          Signature verification
        </div>
        <VRow label="Signer" value={signed.display_name} />
        <VRow label="Role" value={signed.signer_role} />
        <VRow label="Signed" value={fmtWat(signed.signed_at)} />
        <div className="flex items-baseline justify-between py-1.5">
          <span className="text-[11.5px] text-text-muted">Verification code</span>
          <span className="font-mono text-[12px] text-accent-glow tracking-wide">
            {signed.verification_code}
          </span>
        </div>
        <a
          href={`/verify/${encodeURIComponent(signed.verification_code)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-accent-glow hover:underline"
        >
          <ExternalLink className="w-3 h-3" />
          Verify this signature
        </a>
      </div>

      {/* Signed copy — appears once the whole document is fully signed. */}
      {isFullySigned &&
        (signedReady ? (
          <a
            href={signApi.signedDocumentUrl(token)}
            className="mt-4 w-full grid place-items-center rounded-xl bg-accent text-bg font-semibold py-3 text-[14px] hover:bg-accent-glow transition-all"
          >
            <span className="inline-flex items-center gap-2">
              <Download className="w-4 h-4" />
              Download signed copy
            </span>
          </a>
        ) : (
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[11.5px] text-text-faint text-center">
            <FileText className="w-3.5 h-3.5 shrink-0" />
            Your signed copy is being prepared — we’ll email it to you shortly.
          </p>
        ))}

      {signed.saved_signature && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] text-text-faint">
          <KeyRound className="w-3.5 h-3.5" />
          Your signature is saved — next time just enter your PIN.
        </p>
      )}
    </div>
  );
}

// ── Small building blocks ─────────────────────────────────
function PinEntry({
  title,
  hint,
  pin,
  setPin,
  onSubmit,
}: {
  title: string;
  hint: string;
  pin: string;
  setPin: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <KeyRound className="w-4 h-4 text-accent-glow" />
        <span className="text-[13.5px] font-medium">{title}</span>
      </div>
      <p className="text-[11.5px] text-text-muted mb-3">{hint}</p>
      <PinField
        label=""
        value={pin}
        onChange={setPin}
        big
        onEnter={onSubmit}
        autoFocus
      />
    </div>
  );
}

function PinField({
  label,
  value,
  onChange,
  mismatch,
  big,
  onEnter,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mismatch?: boolean;
  big?: boolean;
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      {label && (
        <span className="block text-[11px] text-text-muted mb-1">{label}</span>
      )}
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        value={value}
        maxLength={6}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) onEnter();
        }}
        placeholder="••••"
        className={[
          "w-full rounded-xl bg-white/5 border px-3 text-center font-mono tracking-[0.5em] focus:outline-none focus:border-accent/50",
          big ? "py-3 text-[20px]" : "py-2 text-[16px]",
          mismatch ? "border-danger/60" : "hairline",
        ].join(" ")}
      />
    </label>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface p-2.5">
      <div className="text-[9.5px] uppercase tracking-widest text-text-faint mb-0.5">
        {label}
      </div>
      <div className="text-[12.5px] font-medium truncate">{value}</div>
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
    <div className="text-center py-10">
      <div className="grid place-items-center mb-3">{icon}</div>
      <p className="font-display text-[18px] mb-1">{title}</p>
      <p className="text-[12.5px] text-text-muted max-w-[360px] mx-auto leading-relaxed">
        {body}
      </p>
    </div>
  );
}

// ── Layout shell ──────────────────────────────────────────
function Shell({
  brand,
  children,
}: {
  brand?: string | null;
  children: React.ReactNode;
}) {
  const name = brandName(brand);
  return (
    <div className="h-[100dvh] overflow-y-auto overscroll-contain bg-bg text-text-primary px-4 py-6 sm:px-6 sm:py-10">
      <div className="max-w-[560px] mx-auto">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-accent text-bg font-display text-[18px]">
            {name[0]}
          </div>
          <div>
            <p className="font-display text-[17px] leading-none">{name}</p>
            <p className="text-[11px] text-text-faint mt-0.5">
              Document signing
            </p>
          </div>
        </div>
        <div className="glass rounded-2xl p-5 sm:p-6">{children}</div>
        <p className="text-center text-[10.5px] text-text-faint mt-4">
          Secured by Pixie Girl Hub · e-signature
        </p>
      </div>
    </div>
  );
}
