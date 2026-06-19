import { useState } from "react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  Copy,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { Card } from "@/components/ui/primitives";
import { ReauthDialog, ErrorState } from "@/components/ui/controls";
import { cn } from "@/lib/cn";
import {
  useTotpStatus,
  useTotpSetup,
  useTotpVerify,
  useTotpDisable,
} from "@/lib/iam";

type Step = "idle" | "setup" | "verify" | "done";

export function IamMfaPage() {
  useBreadcrumbs([
    { label: "IAM & Security", href: "/iam-security" },
    { label: "MFA Setup" },
  ]);

  const status = useTotpStatus();
  const setup = useTotpSetup();
  const verify = useTotpVerify();
  const disable = useTotpDisable();

  const [step, setStep] = useState<Step>("idle");
  const [secret, setSecret] = useState("");
  const [uri, setUri] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showReauth, setShowReauth] = useState(false);

  const enabled = status.data?.enabled ?? false;

  function handleStartSetup() {
    setup.mutate(undefined, {
      onSuccess: (data) => {
        setSecret(data.secret);
        setUri(data.uri);
        setStep("setup");
      },
    });
  }

  function handleVerify() {
    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      setCodeError("Enter a 6-digit code from your authenticator app");
      return;
    }
    setCodeError("");
    verify.mutate(
      { code },
      {
        onSuccess: () => {
          setStep("done");
          setCode("");
          setSecret("");
          setUri("");
        },
        onError: () =>
          setCodeError(
            "Invalid code. Check your authenticator app and try again.",
          ),
      },
    );
  }

  function handleDisable(password: string) {
    disable.mutate(
      { password },
      {
        onSuccess: () => {
          setShowReauth(false);
          setStep("idle");
        },
      },
    );
  }

  function copySecret() {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (status.isError)
    return (
      <ErrorState
        message="Failed to load MFA status"
        onRetry={() => status.refetch()}
      />
    );

  return (
    <div className="max-w-[600px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <Shield className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">
            Multi-Factor Authentication
          </h2>
          <p className="text-text-muted text-[13px]">
            Add a second layer of protection to your account
          </p>
        </div>
      </div>

      {status.isLoading ? (
        <Card className="p-10 animate-pulse h-40">
          <span />
        </Card>
      ) : enabled && step !== "setup" && step !== "verify" ? (
        /* ── MFA enabled state ─────────────────────────────── */
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-success/10 grid place-items-center shrink-0">
              <ShieldCheck className="w-7 h-7 text-success" />
            </div>
            <div className="flex-1">
              <div className="font-display text-[18px] font-medium">
                MFA is active
              </div>
              <p className="text-text-muted text-[13px] mt-1">
                Your account is protected with a time-based one-time password
                (TOTP). You'll be asked for a code from your authenticator app
                when logging in.
              </p>
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-border-c">
            <button
              onClick={() => setShowReauth(true)}
              className="text-[13px] text-danger hover:text-danger/80 transition-colors"
            >
              Disable MFA
            </button>
            <p className="text-text-faint text-[11px] mt-1">
              You'll need to enter your password to confirm this action
            </p>
          </div>
        </Card>
      ) : step === "done" ? (
        /* ── Just-enabled confirmation ─────────────────────── */
        <Card className="p-8 text-center">
          <CheckCircle className="w-12 h-12 text-success mx-auto mb-4" />
          <div className="font-display text-[20px] font-medium mb-2">
            MFA Enabled
          </div>
          <p className="text-text-muted text-[13px] max-w-xs mx-auto">
            Your account is now protected. Next time you log in, you'll be asked
            for a code from your authenticator app.
          </p>
        </Card>
      ) : step === "setup" ? (
        /* ── QR code step ──────────────────────────────────── */
        <Card className="p-6 space-y-5">
          <div>
            <div className="font-display text-[16px] font-medium mb-1">
              Step 1: Scan QR code
            </div>
            <p className="text-text-muted text-[13px]">
              Open your authenticator app (Google Authenticator, Authy,
              1Password, etc.) and scan this QR code.
            </p>
          </div>

          <div className="flex justify-center">
            <div className="p-3 bg-white rounded-2xl">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`}
                alt="TOTP QR Code"
                width={200}
                height={200}
                className="rounded-lg"
              />
            </div>
          </div>

          <div>
            <p className="text-[12px] text-text-faint mb-2">
              Can't scan? Enter this key manually:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border-c text-[13px] font-mono break-all select-all">
                {secret}
              </code>
              <button
                onClick={copySecret}
                className="p-2 rounded-lg text-text-muted hover:text-text transition-colors"
                title="Copy secret"
              >
                {copied ? (
                  <CheckCircle className="w-4 h-4 text-success" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="pt-2">
            <div className="font-display text-[16px] font-medium mb-1">
              Step 2: Enter verification code
            </div>
            <p className="text-text-muted text-[13px] mb-3">
              Enter the 6-digit code from your authenticator app to verify
              setup.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                className={cn(
                  "w-40 px-4 py-2.5 rounded-xl bg-panel border text-center text-[18px] font-mono tracking-[0.3em]",
                  codeError ? "border-danger" : "border-border-c",
                )}
                placeholder="000000"
                value={code}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setCode(v);
                  if (codeError) setCodeError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleVerify();
                }}
              />
              <button
                onClick={handleVerify}
                disabled={code.length !== 6 || verify.isPending}
                className="px-5 py-2.5 rounded-xl bg-accent text-white text-[13px] font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
              >
                {verify.isPending ? "Verifying..." : "Verify & Enable"}
              </button>
            </div>
            {codeError && (
              <p className="text-danger text-[12px] mt-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {codeError}
              </p>
            )}
          </div>

          <button
            onClick={() => {
              setStep("idle");
              setSecret("");
              setUri("");
              setCode("");
            }}
            className="text-[13px] text-text-faint hover:text-text-muted transition-colors"
          >
            Cancel setup
          </button>
        </Card>
      ) : (
        /* ── MFA not enabled — prompt to enable ────────────── */
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-warn/10 grid place-items-center shrink-0">
              <ShieldOff className="w-7 h-7 text-warn" />
            </div>
            <div className="flex-1">
              <div className="font-display text-[18px] font-medium">
                MFA is not enabled
              </div>
              <p className="text-text-muted text-[13px] mt-1">
                Add a second factor to protect your account against unauthorized
                access. You'll use an authenticator app to generate time-based
                codes.
              </p>
            </div>
          </div>
          <div className="mt-5">
            <button
              onClick={handleStartSetup}
              disabled={setup.isPending}
              className="px-5 py-2.5 rounded-xl bg-accent text-white text-[14px] font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {setup.isPending ? "Generating..." : "Set Up MFA"}
            </button>
          </div>
          <div className="mt-4 p-3 rounded-xl bg-info/5 border border-info/20">
            <p className="text-[12px] text-text-muted">
              <strong className="text-text">Recommended apps:</strong> Google
              Authenticator, Microsoft Authenticator, Authy, 1Password, or any
              TOTP-compatible app.
            </p>
          </div>
        </Card>
      )}

      {/* Reauth dialog for disabling */}
      <ReauthDialog
        open={showReauth}
        onClose={() => setShowReauth(false)}
        onConfirm={handleDisable}
        action="disable MFA"
        busy={disable.isPending}
        error={disable.isError ? "Incorrect password or server error" : null}
      />
    </div>
  );
}
