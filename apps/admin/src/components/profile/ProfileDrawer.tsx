import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Camera,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  LogOut,
  Pencil,
  Shield,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { useAuthStore } from "@/stores/auth";
import {
  confirmEmailChange,
  getMe,
  requestEmailChange,
  updateMe,
  uploadAvatar,
  type MyProfile,
} from "@/lib/auth-api";
import { PhotoCropModal } from "./PhotoCropModal";

function Field({
  label,
  value,
  mono,
  note,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  note?: string;
}) {
  return (
    <div className="py-3 border-b hairline last:border-0">
      <div className="text-[11px] font-semibold text-text-faint uppercase tracking-widest mb-1">
        {label}
      </div>
      <div
        className={cn(
          "text-[13.5px] text-text-primary",
          mono && "font-mono",
          !value && "text-text-faint italic",
        )}
      >
        {value || "Not set"}
      </div>
      {note && <div className="text-[11px] text-text-faint mt-0.5">{note}</div>}
    </div>
  );
}

function EditableField({
  label,
  value,
  onSave,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string | null | undefined;
  onSave: (v: string) => Promise<void>;
  placeholder?: string;
  type?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing) setVal(value ?? "");
  }, [value, editing]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onSave(val);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="py-3 border-b hairline last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-semibold text-text-faint uppercase tracking-widest">
          {label}
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] text-accent-glow hover:text-accent flex items-center gap-1 transition-colors"
          >
            <Pencil className="w-3 h-3" /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            ref={inputRef}
            type={type}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full h-9 bg-text-primary/[0.05] border border-accent/40 rounded-lg px-3 text-[13px] placeholder:text-text-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition-all"
          />
          {err && <p className="text-[11px] text-danger">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 h-8 rounded-lg bg-accent-deep text-[#F4E9D9] text-[12px] font-semibold hover:bg-accent transition-all disabled:opacity-50 flex items-center justify-center"
            >
              {saving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 mr-1" /> Save
                </>
              )}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setErr(null);
              }}
              className="px-3 h-8 rounded-lg border border-line/60 text-text-muted text-[12px] font-semibold hover:bg-text-primary/[0.05] transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          className={cn("text-[13.5px]", !value && "text-text-faint italic")}
        >
          {value || "Not set"}
        </div>
      )}
    </div>
  );
}

/** Inline email-change flow: password + new email → OTP verification */
function EmailField({
  value,
  onChanged,
}: {
  value: string | null | undefined;
  onChanged: (newEmail: string) => void;
}) {
  type Stage = "idle" | "form" | "otp" | "done";
  const [stage, setStage] = useState<Stage>("idle");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setStage("idle");
    setPassword("");
    setNewEmail("");
    setOtp("");
    setErr(null);
  };

  const sendCode = async () => {
    setLoading(true);
    setErr(null);
    try {
      await requestEmailChange(password, newEmail);
      setStage("otp");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not send code.");
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setLoading(true);
    setErr(null);
    try {
      const { email } = await confirmEmailChange(otp);
      onChanged(email);
      setStage("done");
      setTimeout(reset, 2500);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Incorrect code.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="py-3 border-b hairline last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-semibold text-text-faint uppercase tracking-widest">
          Email
        </div>
        {stage === "idle" && (
          <button
            onClick={() => setStage("form")}
            className="text-[11px] text-accent-glow hover:text-accent flex items-center gap-1 transition-colors"
          >
            <Pencil className="w-3 h-3" /> Change
          </button>
        )}
      </div>

      <div className="text-[13.5px] mb-2">{value || "—"}</div>

      {stage === "idle" && null}

      {stage === "form" && (
        <div className="space-y-2 mt-2">
          {/* Password confirm */}
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your current password"
              className="w-full h-9 bg-text-primary/[0.05] border border-line/60 rounded-lg px-3 pr-9 text-[13px] placeholder:text-text-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted"
            >
              {showPw ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          {/* New email */}
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="New email address"
            onKeyDown={(e) => e.key === "Enter" && sendCode()}
            className="w-full h-9 bg-text-primary/[0.05] border border-line/60 rounded-lg px-3 text-[13px] placeholder:text-text-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition-all"
          />
          {err && <p className="text-[11px] text-danger">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={sendCode}
              disabled={loading || !password || !newEmail}
              className="flex-1 h-8 rounded-lg bg-accent-deep text-[#F4E9D9] text-[12px] font-semibold hover:bg-accent transition-all disabled:opacity-50 flex items-center justify-center"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Send code"
              )}
            </button>
            <button
              onClick={reset}
              className="px-3 h-8 rounded-lg border border-line/60 text-text-muted text-[12px] font-semibold hover:bg-text-primary/[0.05] transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === "otp" && (
        <div className="space-y-2 mt-2">
          <p className="text-[11.5px] text-text-muted">
            A 6-digit code was sent to <strong>{newEmail}</strong>. Enter it
            below.
          </p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={otp}
            onChange={(e) =>
              setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="000000"
            onKeyDown={(e) => e.key === "Enter" && otp.length === 6 && verify()}
            className="w-full h-9 bg-text-primary/[0.05] border border-line/60 rounded-lg px-3 text-center text-[18px] font-mono tracking-[0.4em] placeholder:tracking-normal placeholder:text-[13px] focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 transition-all"
          />
          {err && <p className="text-[11px] text-danger">{err}</p>}
          <div className="flex gap-2">
            <button
              onClick={verify}
              disabled={loading || otp.length !== 6}
              className="flex-1 h-8 rounded-lg bg-accent-deep text-[#F4E9D9] text-[12px] font-semibold hover:bg-accent transition-all disabled:opacity-50 flex items-center justify-center"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Verify & save"
              )}
            </button>
            <button
              onClick={reset}
              className="px-3 h-8 rounded-lg border border-line/60 text-text-muted text-[12px] font-semibold hover:bg-text-primary/[0.05] transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {stage === "done" && (
        <div className="flex items-center gap-1.5 text-[12px] text-success mt-1">
          <Check className="w-3.5 h-3.5" /> Email updated successfully.
        </div>
      )}
    </div>
  );
}

export function ProfileDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const patchUser = useAuthStore((s) => s.patchUser);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [toast, setToast] = useState<{
    type: "ok" | "err";
    msg: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const showToast = (type: "ok" | "err", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getMe()
      .then((p) => {
        setProfile(p);
        patchUser({ avatarUrl: p.avatar_url ?? null });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleAvatarBlob = async (blob: Blob) => {
    setCropFile(null);
    setAvatarLoading(true);
    try {
      const { avatar_url } = await uploadAvatar(blob);
      setProfile((p) => (p ? { ...p, avatar_url } : p));
      patchUser({ avatarUrl: avatar_url });
      showToast("ok", "Photo updated.");
    } catch {
      showToast("err", "Photo upload failed. Please try again.");
    } finally {
      setAvatarLoading(false);
    }
  };

  const handleSaveName = async (display_name: string) => {
    const updated = await updateMe({ display_name });
    setProfile(updated);
    patchUser({ name: updated.display_name });
    showToast("ok", "Name updated.");
  };

  const handleSavePhone = async (phone: string) => {
    const updated = await updateMe({ phone });
    setProfile(updated);
    showToast("ok", "Phone updated.");
  };

  const handleEmailChanged = (email: string) => {
    setProfile((p) => (p ? { ...p, email } : p));
    patchUser({ email });
    showToast("ok", "Email address updated.");
  };

  const avatarUrl = profile?.avatar_url;
  const displayName = profile?.display_name ?? user?.name ?? "";
  const av = initials(displayName || "?");

  const content = (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-[90] bg-black/50 backdrop-blur-[3px] transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="My profile"
        className={cn(
          "fixed top-0 right-0 h-full z-[95] flex flex-col dropglass border-l shadow-[-30px_0_80px_rgb(0_0_0/0.5)]",
          "w-[min(400px,95vw)] transition-transform duration-300 ease-brand",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b hairline shrink-0">
          <span className="grid place-items-center w-8 h-8 rounded-lg bg-accent/10 text-accent-glow border border-accent/20">
            <User className="w-4 h-4" />
          </span>
          <h2 className="font-display text-xl font-medium flex-1">
            My Profile
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center w-8 h-8 rounded-full text-text-faint hover:text-text-primary hover:bg-text-primary/10 transition-all"
          >
            <X className="w-[18px]" />
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div
            className={cn(
              "mx-5 mt-4 px-4 py-2.5 rounded-xl text-[12.5px] font-medium border",
              toast.type === "ok"
                ? "bg-success/10 text-success border-success/30"
                : "bg-danger/10 text-danger border-danger/30",
            )}
          >
            {toast.msg}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center gap-2 text-text-muted text-[13px] py-10 justify-center">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading profile…
            </div>
          ) : (
            <>
              {/* Avatar */}
              <div className="flex flex-col items-center pb-6 border-b hairline mb-1">
                <div className="relative mb-4">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      className="w-24 h-24 rounded-full object-cover ring-2 ring-accent/30"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full grid place-items-center font-display font-semibold text-3xl text-white bg-[linear-gradient(140deg,var(--biz-1),var(--biz-2))] ring-2 ring-accent/20">
                      {av}
                    </div>
                  )}
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={avatarLoading}
                    aria-label="Change photo"
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-accent-deep text-[#F4E9D9] grid place-items-center shadow-lg hover:bg-accent transition-all disabled:opacity-50"
                  >
                    {avatarLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setCropFile(f);
                      e.target.value = "";
                    }}
                  />
                </div>

                <div className="text-center">
                  <div className="font-display text-lg font-medium">
                    {displayName}
                  </div>
                  <div className="flex items-center justify-center gap-1.5 mt-1">
                    <Shield className="w-3 h-3 text-accent-glow" />
                    <span className="text-[12px] text-text-muted">
                      {user?.role ?? "Team Member"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Editable fields */}
              <div className="mt-1">
                <div className="text-[11px] font-semibold text-text-faint uppercase tracking-widest mb-2 mt-4">
                  Personal info
                </div>

                <EditableField
                  label="Display name"
                  value={profile?.display_name}
                  onSave={handleSaveName}
                  placeholder="Your name"
                />

                <EditableField
                  label="Phone"
                  value={profile?.phone}
                  onSave={handleSavePhone}
                  placeholder="+234 800 000 0000"
                  type="tel"
                />

                <EmailField
                  value={profile?.email}
                  onChanged={handleEmailChanged}
                />
              </div>

              {/* HR fields */}
              {(profile?.job_title ||
                profile?.department ||
                profile?.employee_number) && (
                <div className="mt-4">
                  <div className="text-[11px] font-semibold text-text-faint uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    Employment
                    <span className="text-[10px] normal-case tracking-normal font-normal bg-text-primary/[0.06] border border-line/50 rounded px-1.5 py-px">
                      Managed by HR
                    </span>
                  </div>
                  {profile.job_title && (
                    <Field label="Job title" value={profile.job_title} />
                  )}
                  {profile.department && (
                    <Field label="Department" value={profile.department} />
                  )}
                  {profile.employee_number && (
                    <Field
                      label="Employee number"
                      value={profile.employee_number}
                      mono
                    />
                  )}
                </div>
              )}

              {/* My HR link */}
              <button className="mt-5 w-full flex items-center justify-between p-4 rounded-xl border border-line/50 bg-text-primary/[0.02] hover:bg-text-primary/[0.05] transition-all group">
                <div className="text-left">
                  <div className="text-[13px] font-semibold text-text-primary">
                    My HR records
                  </div>
                  <div className="text-[11.5px] text-text-faint">
                    Contracts, leave, payslips
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-text-faint group-hover:text-text-muted transition-colors" />
              </button>

              {/* Sign out */}
              <button
                onClick={async () => {
                  onClose();
                  await signOut();
                  navigate("/login", { replace: true });
                }}
                className="mt-4 w-full flex items-center justify-center gap-2 p-3.5 rounded-xl border border-danger/30 text-danger text-[13px] font-semibold hover:bg-danger/10 transition-all"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Photo crop modal */}
      {cropFile && (
        <PhotoCropModal
          file={cropFile}
          onDone={handleAvatarBlob}
          onCancel={() => setCropFile(null)}
        />
      )}
    </>
  );

  return createPortal(content, document.body);
}
