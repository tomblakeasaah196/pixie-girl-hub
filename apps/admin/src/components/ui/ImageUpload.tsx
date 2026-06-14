import { useRef, useState } from "react";
import { ImageUp, Link2, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { uploadBrandingImage } from "@/lib/branding";

/**
 * Dual image field: upload a file (→ /media/branding/…) OR paste a URL.
 * Used for platform logos/favicon, the login background, and per-business
 * logos. Shows a live preview and keeps the existing URL-paste workflow so
 * externally hosted assets still work.
 */
export function ImageUpload({
  label,
  value,
  onChange,
  hint,
  aspect = "video",
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  hint?: string;
  aspect?: "video" | "square";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await uploadBrandingImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      <span className="micro block mb-1.5">{label}</span>
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "relative shrink-0 rounded-[10px] border hairline overflow-hidden bg-text-primary/[0.04] grid place-items-center",
            aspect === "square" ? "w-[60px] h-[60px]" : "w-[92px] h-[60px]",
          )}
        >
          {value ? (
            <img
              src={value}
              alt=""
              className="w-full h-full object-contain"
              onError={() => setError("Image failed to load")}
            />
          ) : (
            <ImageUp className="w-5 h-5 text-text-faint" />
          )}
          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-bg/60">
              <Loader2 className="w-4 h-4 animate-spin text-accent-glow" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[9px] border hairline bg-text-primary/[0.04] text-[12px] font-semibold text-text-muted hover:text-text-primary hover:border-accent/40 transition-all disabled:opacity-50"
            >
              <ImageUp className="w-3.5 h-3.5" /> Upload
            </button>
            {value && (
              <button
                type="button"
                onClick={() => onChange(null)}
                className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[9px] border hairline text-[12px] font-semibold text-text-faint hover:text-danger hover:border-danger/40 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
          <div className="relative">
            <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint" />
            <input
              type="url"
              value={value ?? ""}
              placeholder="…or paste an image URL"
              onChange={(e) => onChange(e.target.value || null)}
              className="w-full bg-text-primary/[0.04] hairline border rounded-[9px] pl-8 pr-2 py-1.5 text-[12px] focus:outline-none focus:border-accent/50"
            />
          </div>
          {(error || hint) && (
            <p
              className={cn(
                "text-[11px]",
                error ? "text-danger" : "text-text-faint",
              )}
            >
              {error ?? hint}
            </p>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
    </div>
  );
}
