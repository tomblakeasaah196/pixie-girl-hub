import { useRef, useState } from "react";
import { Upload, Image as ImageIcon, Search, Check, Move } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { UploadProgress } from "@/components/ui/UploadProgress";
import { useUploadProgress } from "@/lib/use-upload";
import { useStyledProducts, useUploadCoverImage } from "@/lib/catalogue";
import { CoverCropModal } from "./CoverCropModal";
import { useToast } from "@/lib/toast";

/**
 * Cover picker for collections & bundles. Per the owner directive you can
 * either PICK a styled product's image (so the cover matches what's inside) or
 * UPLOAD a custom one. Either way the chosen URL is handed back via onChange;
 * the parent saves it onto the entity's hero_image_url.
 */
export function CoverImageEditor({
  value,
  onChange,
  referenceType,
  referenceId,
  coverAspect = "16:9",
}: {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  referenceType: "collection" | "bundle" | "shade";
  referenceId?: string;
  /** Must match the aspect ratio the entity's card actually displays the
   *  cover at, or the crop preview here will lie about what gets shown. */
  coverAspect?: "16:9" | "4:5";
}) {
  const upload = useUploadCoverImage();
  const { progress, run } = useUploadProgress();
  const toast = useToast("Catalogue → Cover image");
  const fileRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState("");
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [repositioning, setRepositioning] = useState(false);
  const styled = useStyledProducts(q.trim().length >= 2 ? { q: q.trim() } : {});
  const withImages = (styled.data ?? []).filter((s) => s.primary_image_url);

  const uploadCropped = (blob: Blob) => {
    const file = new File([blob], "cover.jpg", { type: "image/jpeg" });
    setCropFile(null);
    run((onProgress) =>
      upload.mutateAsync({
        file,
        reference_type: referenceType,
        reference_id: referenceId,
        onProgress,
      }),
    )
      .then((res) => onChange(res.cdn_url))
      .catch(() => toast.error("Couldn't save cover image"));
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setCropFile(file);
    e.target.value = "";
  };

  const reposition = async () => {
    if (!value) return;
    setRepositioning(true);
    try {
      const res = await fetch(value);
      const blob = await res.blob();
      setCropFile(new File([blob], "cover.jpg", { type: blob.type || "image/jpeg" }));
    } catch {
      toast.error(
        "Couldn't load this image for repositioning",
        "Try uploading it again instead.",
      );
    } finally {
      setRepositioning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        className={`${coverAspect === "4:5" ? "aspect-[4/5]" : "aspect-[16/9]"} rounded-[12px] overflow-hidden bg-text-primary/[0.04] border border-line`}
      >
        {value ? (
          <img src={value} alt="Cover" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full grid place-items-center text-text-faint">
            <ImageIcon className="w-8 h-8" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload className="w-3.5 h-3.5" />}
          disabled={upload.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {upload.isPending ? "Uploading…" : "Upload"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<ImageIcon className="w-3.5 h-3.5" />}
          onClick={() => setPicking((p) => !p)}
        >
          Pick from a product
        </Button>
        {value && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Move className="w-3.5 h-3.5" />}
            disabled={repositioning}
            onClick={reposition}
          >
            {repositioning ? "Loading…" : "Reposition"}
          </Button>
        )}
        {value && (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          hidden
          onChange={onFile}
        />
      </div>

      <UploadProgress value={progress} />

      {picking && (
        <div className="rounded-[12px] border border-line p-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-faint pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search styled products…"
              className="w-full h-[38px] pl-9 pr-3 rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50" autoComplete="off" data-lpignore="true" data-1p-ignore="" data-form-type="other"
            />
          </div>
          {withImages.length === 0 ? (
            <p className="text-[12px] text-text-faint px-1 py-2">
              {styled.isLoading
                ? "Loading…"
                : "No styled products with a picture match — upload one instead."}
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[240px] overflow-y-auto">
              {withImages.map((s) => {
                const selected = value === s.primary_image_url;
                return (
                  <button
                    key={s.styled_id}
                    type="button"
                    onClick={() => onChange(s.primary_image_url ?? null)}
                    className="relative aspect-square rounded-[10px] overflow-hidden border border-line hover:border-accent/50 transition-colors"
                    title={s.name}
                  >
                    <img
                      src={s.primary_image_url ?? undefined}
                      alt={s.name}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                    {selected && (
                      <span className="absolute inset-0 bg-accent/30 grid place-items-center">
                        <Check className="w-5 h-5 text-white" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {cropFile && (
        <CoverCropModal
          file={cropFile}
          aspect={coverAspect}
          onCancel={() => setCropFile(null)}
          onDone={uploadCropped}
        />
      )}
    </div>
  );
}
