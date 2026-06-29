import { useEffect, useMemo, useState } from "react";
import { Sparkles, Wand2, Image as ImageIcon, Info, Crop } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Select } from "@/components/ui/controls";
import { Field } from "@/components/ui/Form";
import {
  useBundle,
  useCollageFonts,
  useGenerateBundleCollage,
  useApplyCollageToAll,
  type CollageCrop,
} from "@/lib/catalogue";
import { BundleCollageCropModal } from "./BundleCollageCropModal";

const inputCls =
  "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50";

/**
 * Generate a beautiful PORTRAIT collage cover from the bundle's product photos.
 * Pick a curated title font + edit the badge text, then generate — the server
 * composites the cover and points the bundle's hero at it. Once at least one
 * cover is generated you can push the same look (font + eyebrow) to every other
 * generated collage in one go.
 */
export function BundleCollageEditor({ bundleId }: { bundleId: string }) {
  const detail = useBundle(bundleId);
  const fonts = useCollageFonts();
  const gen = useGenerateBundleCollage(bundleId);
  const applyAll = useApplyCollageToAll();

  const bundle = detail.data;
  const components = bundle?.components ?? [];
  const imagedCount = components.filter((c) => c.image_url).length;
  const pieces = Math.min(6, components.length);
  const canGenerate = imagedCount >= 3;

  const [font, setFont] = useState("Cormorant Garamond");
  const [title, setTitle] = useState("");
  const [eyebrow, setEyebrow] = useState("");
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [crops, setCrops] = useState<Record<string, CollageCrop>>({});
  const [cropOpen, setCropOpen] = useState(false);

  // Hydrate the controls from the bundle's saved collage settings.
  useEffect(() => {
    if (!bundle) return;
    const s = bundle.collage_settings ?? {};
    setFont(s.font_family ?? "Cormorant Garamond");
    setTitle(s.title ?? "");
    setEyebrow(s.eyebrow ?? "");
    setCrops(s.crops ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle?.bundle_id]);

  const reframedCount = useMemo(() => Object.keys(crops).length, [crops]);

  const fontOptions = (fonts.data ?? ["Cormorant Garamond"]).map((f) => ({
    value: f,
    label: f,
  }));

  const generate = () =>
    gen.mutate({
      font_family: font,
      title: title.trim() || undefined,
      eyebrow: eyebrow.trim() || undefined,
      // Always send the map (even {}) so "Reset to auto" actually clears any
      // previously-saved framing rather than the server-side merge keeping it.
      crops,
    });

  const restyleAll = () =>
    applyAll.mutate(
      { font_family: font, eyebrow: eyebrow.trim() || undefined },
      {
        onSuccess: (r) => {
          setApplyMsg(
            `Restyled ${r.updated} cover${r.updated === 1 ? "" : "s"}` +
              (r.skipped ? ` · skipped ${r.skipped}` : "") +
              ".",
          );
          setTimeout(() => setApplyMsg(null), 4500);
        },
      },
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent-glow" />
        <div className="text-[13px] font-semibold">Generate a collage cover</div>
      </div>

      {/* Portrait preview */}
      <div className="aspect-[4/5] max-w-[220px] mx-auto rounded-[14px] overflow-hidden bg-text-primary/[0.04] border border-line relative">
        {bundle?.hero_image_url ? (
          <img
            src={bundle.hero_image_url}
            alt="Bundle cover"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-text-faint">
            <ImageIcon className="w-7 h-7" />
          </div>
        )}
        {bundle?.cover_is_generated && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 h-6 rounded-[7px] text-[10px] font-semibold dropglass text-accent-glow">
            <Wand2 className="w-3 h-3" /> Generated
          </span>
        )}
      </div>

      {!canGenerate && (
        <div className="flex items-start gap-1.5 text-[11.5px] text-text-faint">
          <Info className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>
            A collage needs at least 3 products with a photo. This bundle has{" "}
            {imagedCount} of {components.length}.
          </span>
        </div>
      )}

      <Field label="Title font">
        <Select value={font} onChange={setFont} options={fontOptions} />
      </Field>
      <Field label="Title" hint={`blank → "${pieces || 3}-Piece Collection"`}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`${pieces || 3}-Piece Collection`}
          className={inputCls}
        />
      </Field>
      <Field label="Eyebrow" hint="blank → brand default">
        <input
          value={eyebrow}
          onChange={(e) => setEyebrow(e.target.value)}
          placeholder="Pixie Girl · Bundle"
          className={inputCls}
        />
      </Field>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="primary"
          size="sm"
          icon={<Sparkles className="w-3.5 h-3.5" />}
          disabled={!canGenerate || gen.isPending}
          onClick={generate}
        >
          {gen.isPending
            ? "Generating…"
            : bundle?.cover_is_generated
              ? "Regenerate cover"
              : "Generate cover"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Crop className="w-3.5 h-3.5" />}
          disabled={!canGenerate}
          onClick={() => setCropOpen(true)}
          title="Drag/zoom each photo to frame the hair before generating"
        >
          {reframedCount ? `Reframe photos · ${reframedCount}` : "Reframe photos"}
        </Button>
        {bundle?.cover_is_generated && (
          <Button
            variant="ghost"
            size="sm"
            icon={<Wand2 className="w-3.5 h-3.5" />}
            disabled={applyAll.isPending}
            onClick={restyleAll}
            title="Apply this font + eyebrow to every generated collage"
          >
            {applyAll.isPending ? "Applying…" : "Apply style to all"}
          </Button>
        )}
      </div>

      {reframedCount > 0 && !gen.isPending && (
        <p className="text-[11.5px] text-text-faint">
          {reframedCount} photo{reframedCount === 1 ? "" : "s"} reframed —
          regenerate to apply.
        </p>
      )}

      {applyMsg && <p className="text-[11.5px] text-success">{applyMsg}</p>}
      {gen.isError && (
        <p className="text-[11.5px] text-danger">
          {gen.error instanceof Error
            ? gen.error.message
            : "Could not generate the cover."}
        </p>
      )}

      {cropOpen && (
        <BundleCollageCropModal
          components={components}
          value={crops}
          onApply={(next) => {
            setCrops(next);
            setCropOpen(false);
          }}
          onCancel={() => setCropOpen(false)}
        />
      )}
    </div>
  );
}
