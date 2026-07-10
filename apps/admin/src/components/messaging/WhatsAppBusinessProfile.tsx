import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Camera,
  Save,
  AlertCircle,
  Check,
  Info,
  ExternalLink,
  MessageSquare,
  Building2,
  Globe,
} from "lucide-react";
import { useActiveBusiness } from "@/stores/business";
import {
  messagingAccountsApi,
  WA_VERTICALS,
  WA_VERTICAL_LABELS,
  type MessagingAccount,
  type WhatsAppProfile,
  type WhatsAppProfilePatch,
} from "@/lib/messaging-accounts-api";

/**
 * WhatsApp Business Profile editor — the "business card" a customer sees
 * when they open the chat: display picture, about line, description,
 * address, email, websites and business category.
 *
 * Rendered inside the WhatsApp connection editor once an account exists.
 * The display picture rides Meta's resumable upload, which needs the
 * numeric Meta App ID — captured here and remembered on the account so
 * the operator only enters it once.
 *
 * Four states are honoured: loading (skeleton), error (retry), the empty
 * "not connected yet" case (surfaced as an error banner from the API),
 * and the loaded editor.
 */

interface Props {
  account: MessagingAccount;
}

interface ProfileForm {
  about: string;
  description: string;
  address: string;
  email: string;
  vertical: string;
  website1: string;
  website2: string;
}

function toForm(p: WhatsAppProfile | undefined): ProfileForm {
  return {
    about: p?.about ?? "",
    description: p?.description ?? "",
    address: p?.address ?? "",
    email: p?.email ?? "",
    vertical: p?.vertical ?? "UNDEFINED",
    website1: p?.websites?.[0] ?? "",
    website2: p?.websites?.[1] ?? "",
  };
}

export function WhatsAppBusinessProfile({ account }: Props) {
  const business = useActiveBusiness();
  const qc = useQueryClient();
  const id = account.account_id;

  const profileQ = useQuery({
    queryKey: ["messaging-accounts", "whatsapp-profile", id],
    queryFn: () => messagingAccountsApi.getWhatsAppProfile(id),
    enabled: !!account.is_active,
  });

  const [form, setForm] = useState<ProfileForm>(() => toForm(undefined));
  const [appId, setAppId] = useState("");
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Seed the form + app id once the profile loads.
  useEffect(() => {
    if (profileQ.data) {
      setForm(toForm(profileQ.data));
      setAppId(profileQ.data.app_id ?? "");
    }
  }, [profileQ.data]);

  // Local object-URL preview for a freshly-picked file; revoked on change.
  useEffect(() => {
    if (!pickedFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(pickedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pickedFile]);

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: ["messaging-accounts", "whatsapp-profile", id],
    });

  const saveText = useMutation({
    mutationFn: () => {
      const patch: WhatsAppProfilePatch = {
        about: form.about,
        description: form.description,
        address: form.address,
        email: form.email,
        vertical: form.vertical,
        websites: [form.website1, form.website2].filter((w) => w.trim()),
      };
      return messagingAccountsApi.updateWhatsAppProfile(id, patch);
    },
    onSuccess: invalidate,
  });

  const uploadPic = useMutation({
    mutationFn: () =>
      messagingAccountsApi.setWhatsAppProfilePicture(id, pickedFile!, appId),
    onSuccess: (updated) => {
      setPickedFile(null);
      if (fileRef.current) fileRef.current.value = "";
      qc.setQueryData(
        ["messaging-accounts", "whatsapp-profile", id],
        updated,
      );
    },
  });

  const currentPicture = previewUrl ?? profileQ.data?.profile_picture_url ?? null;
  // App ID is auto-detected from the access token server-side, so it's no
  // longer required to upload — a picked file is enough.
  const canUpload = !!pickedFile && !uploadPic.isPending;

  if (!account.is_active) {
    return (
      <section className="rounded-2xl border hairline bg-panel-2 p-4">
        <div className="flex items-start gap-2 text-[12.5px] text-text-muted">
          <Info className="w-4 h-4 mt-[1px] text-accent-glow shrink-0" />
          <p>
            Activate this WhatsApp connection to manage its business profile.
            The profile is what customers see in the chat header.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border hairline bg-panel-2 overflow-hidden">
      <div className="px-4 py-3 border-b hairline flex items-start gap-2">
        <MessageSquare className="w-4 h-4 mt-[2px] text-accent-glow" />
        <div className="flex-1 min-w-0">
          <h4 className="text-[13px] font-medium">Business profile</h4>
          <p className="text-[11.5px] text-text-faint mt-0.5">
            The display picture, About line and details customers see when they
            open the chat with {business.name}.
          </p>
        </div>
      </div>

      {profileQ.isLoading ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-text-faint" />
        </div>
      ) : profileQ.isError ? (
        <div className="p-4">
          <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 mt-[1px] shrink-0" />
            <span className="flex-1">
              {profileQ.error instanceof Error
                ? profileQ.error.message
                : "Couldn't load the profile from Meta."}
            </span>
            <button
              onClick={() => profileQ.refetch()}
              className="underline underline-offset-2 hover:text-text-primary shrink-0"
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-5">
          {/* Display picture */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-20 h-20 rounded-full overflow-hidden border hairline bg-panel grid place-items-center shrink-0">
                {currentPicture ? (
                  <img
                    src={currentPicture}
                    alt="WhatsApp display picture"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Building2 className="w-7 h-7 text-text-faint" />
                )}
              </div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 rounded-full bg-accent text-bg w-7 h-7 grid place-items-center border-2 border-panel-2 hover:bg-accent-glow"
                title="Choose a new picture"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12.5px] text-text-muted">
                {pickedFile
                  ? `Selected: ${pickedFile.name}`
                  : "Square JPG/PNG works best — we crop to a circle and optimise it for you."}
              </p>
              {pickedFile && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => uploadPic.mutate()}
                    disabled={!canUpload}
                    className="rounded-xl bg-accent text-bg px-3 py-1.5 text-[12px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {uploadPic.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                    Upload picture
                  </button>
                  <button
                    onClick={() => {
                      setPickedFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="text-[12px] text-text-muted hover:text-text-primary"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          {/* Meta App ID — auto-detected from the access token; shown only
              as an optional override in case detection ever fails. */}
          <details className="rounded-xl border hairline bg-panel/40">
            <summary className="cursor-pointer px-3 py-2 text-[11.5px] text-text-muted inline-flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent-glow" />
              Meta App ID
              <span className="text-text-faint">
                (optional — detected automatically)
              </span>
            </summary>
            <div className="px-3 pb-3">
              <input
                type="text"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="e.g. 1234567890123456"
                inputMode="numeric"
                autoComplete="off"
                data-1p-ignore=""
                className="w-full rounded-xl bg-panel border hairline px-3 py-2 text-[13px] font-mono focus:outline-none focus:border-accent/40"
              />
              <p className="text-[10.5px] text-text-faint mt-1">
                We detect this from your access token, so you normally don't
                need it. Only fill it in if an upload says it couldn't find your
                App ID — it's on your app's{" "}
                <a
                  href="https://developers.facebook.com/apps/"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent-glow underline underline-offset-2 inline-flex items-center gap-0.5"
                >
                  Meta dashboard <ExternalLink className="w-3 h-3" />
                </a>{" "}
                → Settings → Basic → App ID.
              </p>
            </div>
          </details>

          {uploadPic.isError && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-[1px] shrink-0" />
              {uploadPic.error instanceof Error
                ? uploadPic.error.message
                : "Couldn't upload the picture."}
            </div>
          )}
          {uploadPic.isSuccess && !pickedFile && (
            uploadPic.data?.picture_applied === false ? (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[12px] text-amber-300 inline-flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-[1px] shrink-0" />
                Picture uploaded — it can take a few minutes to appear in
                WhatsApp.
              </div>
            ) : (
              <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2 text-[12px] text-green-300 inline-flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" /> Display picture updated.
              </div>
            )
          )}

          <div className="h-px bg-border/40" />

          {/* Text fields */}
          <Field
            label="About"
            hint={`${form.about.length}/139 — the short line under your name`}
            value={form.about}
            maxLength={139}
            onChange={(v) => setForm({ ...form, about: v })}
            placeholder="Premium hair & beauty, delivered across Nigeria."
          />
          <TextArea
            label="Description"
            hint={`${form.description.length}/512`}
            value={form.description}
            maxLength={512}
            onChange={(v) => setForm({ ...form, description: v })}
            placeholder="What your business does, hours, returns policy…"
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Field
              label="Business email"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              placeholder="care@pixiegirlglobal.com"
            />
            <label className="block">
              <span className="block text-[11.5px] text-text-muted mb-1">
                Category
              </span>
              <select
                value={form.vertical}
                onChange={(e) => setForm({ ...form, vertical: e.target.value })}
                className="w-full rounded-xl bg-panel border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
              >
                {WA_VERTICALS.map((v) => (
                  <option key={v} value={v}>
                    {WA_VERTICAL_LABELS[v] ?? v}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Field
            label="Address"
            value={form.address}
            maxLength={256}
            onChange={(v) => setForm({ ...form, address: v })}
            placeholder="Shop 12, Balogun Market, Lagos Island, Lagos"
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Field
              label="Website 1"
              icon={<Globe className="w-3 h-3" />}
              value={form.website1}
              maxLength={256}
              onChange={(v) => setForm({ ...form, website1: v })}
              placeholder="https://pixiegirlglobal.com"
            />
            <Field
              label="Website 2"
              icon={<Globe className="w-3 h-3" />}
              value={form.website2}
              maxLength={256}
              onChange={(v) => setForm({ ...form, website2: v })}
              placeholder="https://instagram.com/pixiegirlglobal"
            />
          </div>

          {saveText.isError && (
            <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-[1px] shrink-0" />
              {saveText.error instanceof Error
                ? saveText.error.message
                : "Couldn't save the profile."}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={() => saveText.mutate()}
              disabled={saveText.isPending}
              className="rounded-xl bg-accent text-bg px-4 py-2 text-[13px] font-semibold hover:bg-accent-glow disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {saveText.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save profile
            </button>
            {saveText.isSuccess && !saveText.isPending && (
              <span className="text-[12px] text-green-300 inline-flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" /> Saved
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── Small field helpers (match the modal's field styling) ──

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  maxLength,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  icon?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11.5px] text-text-muted mb-1 flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        data-1p-ignore=""
        className="w-full rounded-xl bg-panel border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
      />
      {hint && <p className="text-[10.5px] text-text-faint mt-1">{hint}</p>}
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  hint,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <span className="block text-[11.5px] text-text-muted mb-1">{label}</span>
      <textarea
        value={value}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full rounded-xl bg-panel border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
      />
      {hint && <p className="text-[10.5px] text-text-faint mt-1">{hint}</p>}
    </label>
  );
}
