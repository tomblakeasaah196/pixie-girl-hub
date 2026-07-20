import { useCallback, useEffect, useRef, useState } from "react";
import {
  ImageUp,
  Loader2,
  Wand2,
  RefreshCw,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { Toggle } from "@/components/ui/controls";
import { UploadProgress } from "@/components/ui/UploadProgress";
import { useUploadProgress } from "@/lib/use-upload";
import {
  useBrandBackdrop,
  useImageCutout,
  compositeBranded,
  type BackdropStyle,
  type CutoutResult,
} from "@/lib/brand-backdrop";
import { cn } from "@/lib/cn";

/**
 * Branded image upload modal (owner directive: consistent catalogue image
 * backgrounds). Drop or pick an image, see the natural photo, then optionally
 * flip on "Use branded background" to wipe the backdrop and drop the subject
 * onto a brand colour (default = the active brand's; others via the dropdown).
 *
 * The subject is isolated on the server; the colour is composited on a canvas
 * here so switching colour/style is instant. On save the chosen image (natural
 * OR branded) is handed to `onComplete`, which uploads it through the surface's
 * normal image endpoint.
 */
export function BrandedImageUpload({
  open,
  onClose,
  onComplete,
  title = "Add a picture",
}: {
  open: boolean;
  onClose: () => void;
  /** Upload the chosen file (natural or branded). Awaited; modal closes after. */
  onComplete: (file: File) => Promise<void> | void;
  title?: string;
}) {
  const { colours, defaultHex } = useBrandBackdrop();
  const cutout = useImageCutout();
  const { progress, run } = useUploadProgress();

  const [file, setFile] = useState<File | null>(null);
  const [naturalUrl, setNaturalUrl] = useState<string | null>(null);
  const [branded, setBranded] = useState(false);
  const [cut, setCut] = useState<CutoutResult | null>(null);
  const [hex, setHex] = useState(defaultHex);
  const [style, setStyle] = useState<BackdropStyle>("flat");
  const [preview, setPreview] = useState<string | null>(null);
  const [brandedFile, setBrandedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [composing, setComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  // Keep the latest object URLs so the unmount cleanup can revoke them.
  const urls = useRef<{ natural: string | null; preview: string | null }>({
    natural: null,
    preview: null,
  });
  urls.current = { natural: naturalUrl, preview };

  const revoke = (u: string | null) => u && URL.revokeObjectURL(u);

  const reset = useCallback(() => {
    revoke(urls.current.natural);
    revoke(urls.current.preview);
    setFile(null);
    setNaturalUrl(null);
    setBranded(false);
    setCut(null);
    setPreview(null);
    setBrandedFile(null);
    setStyle("flat");
    setErr(null);
  }, []);

  // Revoke any live object URLs when the modal unmounts.
  useEffect(
    () => () => {
      revoke(urls.current.natural);
      revoke(urls.current.preview);
    },
    [],
  );

  // Seed the colour to the active brand's default whenever it (re)opens.
  useEffect(() => {
    if (open) setHex(defaultHex);
  }, [open, defaultHex]);

  const close = () => {
    reset();
    onClose();
  };

  const chooseFile = (f: File | undefined | null) => {
    if (!f) return;
    const ok =
      f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name);
    if (!ok) {
      setErr("That doesn't look like an image. Try a JPG, PNG, WEBP or HEIC.");
      return;
    }
    revoke(urls.current.natural);
    revoke(urls.current.preview);
    setErr(null);
    setBranded(false);
    setCut(null);
    setPreview(null);
    setBrandedFile(null);
    setFile(f);
    setNaturalUrl(URL.createObjectURL(f));
  };

  // Compose (or recompose) whenever the branded colour/style/cut-out changes.
  useEffect(() => {
    if (!branded || !cut) return;
    let active = true;
    setComposing(true);
    compositeBranded(cut.cutout_data_url, hex, style, file?.name || "branded.jpg")
      .then(({ file: f, previewUrl }) => {
        if (!active) {
          revoke(previewUrl);
          return;
        }
        setBrandedFile(f);
        setPreview((prev) => {
          revoke(prev);
          return previewUrl;
        });
      })
      .catch((e) =>
        setErr(e instanceof Error ? e.message : "Couldn't render the background"),
      )
      .finally(() => active && setComposing(false));
    return () => {
      active = false;
    };
    // file?.name is stable for a given file; intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branded, cut, hex, style]);

  const toggleBranded = async (on: boolean) => {
    setErr(null);
    if (!on) {
      setBranded(false);
      return;
    }
    if (!file) return;
    if (cut) {
      setBranded(true);
      return;
    }
    try {
      const res = await run((onProgress) =>
        cutout.mutateAsync({ file, onProgress }),
      );
      setCut(res);
      setBranded(true);
    } catch (e) {
      setErr(
        e instanceof Error ? e.message : "Couldn't remove the background",
      );
    }
  };

  const save = async () => {
    const out = branded && brandedFile ? brandedFile : file;
    if (!out) return;
    setSaving(true);
    setErr(null);
    try {
      await onComplete(out);
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSaving(false);
    }
  };

  const removing = cutout.isPending;
  const showBranded = branded && preview;
  const shownImage = showBranded ? preview : naturalUrl;

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={!file || saving || removing || composing}
            icon={
              saving ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined
            }
          >
            {saving ? "Saving…" : "Save picture"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!file ? (
          // ── Dropzone ──
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              chooseFile(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "w-full grid place-items-center gap-2 rounded-[14px] border-2 border-dashed px-6 py-12 text-center transition-colors",
              dragOver
                ? "border-accent/60 bg-accent/[0.06]"
                : "border-line hover:border-accent/40 bg-text-primary/[0.03]",
            )}
          >
            <ImageUp className="w-8 h-8 text-text-faint" />
            <span className="text-[13.5px] font-semibold text-text-primary">
              Drag &amp; drop an image, or click to upload
            </span>
            <span className="text-[11.5px] text-text-faint">
              JPG, PNG, WEBP or HEIC · one picture at a time
            </span>
          </button>
        ) : (
          <>
            {/* ── Preview ── */}
            <div className="relative rounded-[14px] overflow-hidden border border-line bg-text-primary/[0.04] grid place-items-center aspect-square max-h-[46vh]">
              {shownImage && (
                <img
                  src={shownImage}
                  alt="Preview"
                  className="w-full h-full object-contain"
                />
              )}
              {(removing || composing) && (
                <div className="absolute inset-0 grid place-items-center gap-2 bg-bg/70 backdrop-blur-[2px]">
                  <Loader2 className="w-5 h-5 animate-spin text-accent-glow" />
                  <span className="text-[12px] text-text-muted">
                    {removing
                      ? "Removing background…"
                      : "Applying branded background…"}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-muted hover:text-text-primary"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Replace image
              </button>
              {cut?.engine === "ai" && (
                <span className="inline-flex items-center gap-1 text-[11px] text-accent-glow">
                  <Sparkles className="w-3 h-3" /> AI cut-out
                </span>
              )}
            </div>

            <UploadProgress value={progress} />

            {/* ── Branded-background opt-in ── */}
            <div className="rounded-[12px] border border-line p-3.5 space-y-3">
              <Toggle
                checked={branded}
                onChange={toggleBranded}
                disabled={removing}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5 text-accent-glow" />
                    Use branded background
                  </span>
                }
              />

              {branded && (
                <div className="space-y-3 pt-1">
                  {/* Colour dropdown — brand colours only */}
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-9 h-9 rounded-[10px] border border-line shrink-0"
                      style={{ background: hex }}
                      aria-hidden
                    />
                    <label className="sr-only" htmlFor="brand-bg-colour">
                      Background colour
                    </label>
                    <select
                      id="brand-bg-colour"
                      value={hex}
                      onChange={(e) => setHex(e.target.value)}
                      className="flex-1 h-[40px] px-3 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50"
                    >
                      {colours.map((c) => (
                        <option key={c.token} value={c.hex}>
                          {c.label} ({c.hex.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Style — Flat / Gradient */}
                  <div className="grid grid-cols-2 gap-2">
                    {(["flat", "gradient"] as BackdropStyle[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStyle(s)}
                        className={cn(
                          "h-9 rounded-[10px] border text-[12px] font-semibold capitalize transition-colors",
                          style === s
                            ? "border-accent/60 bg-accent/[0.12] text-accent-glow"
                            : "border-line bg-text-primary/[0.04] text-text-muted hover:text-text-primary",
                        )}
                      >
                        {s === "flat" ? "Flat colour" : "Soft gradient"}
                      </button>
                    ))}
                  </div>

                  {cut?.warning && cut.engine === "keyer" && (
                    <p className="flex items-start gap-1.5 text-[11px] text-warn">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      {cut.warning}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {err && <p className="text-[12px] text-danger">{err}</p>}

        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
          className="hidden"
          onChange={(e) => {
            chooseFile(e.target.files?.[0]);
            if (fileRef.current) fileRef.current.value = "";
          }}
        />
      </div>
    </Modal>
  );
}
