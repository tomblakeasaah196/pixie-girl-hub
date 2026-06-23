import { useEffect, useState } from "react";
import { Play, Ruler } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/primitives";
import { NumberField } from "@/components/ui/controls";
import {
  useSizeConfig,
  useSaveSizeConfig,
  type SizeTier,
} from "@/lib/catalogue";

/** Pull a YouTube video ID from any of the common share formats so the
 *  modal can show a tiny live preview thumbnail before save. Returns null
 *  when the URL isn't YouTube (UGC vimeo / mp4 will still play in-product). */
function youtubeId(url: string): string | null {
  if (!url) return null;
  const m =
    url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
    ) || url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

/**
 * "Size & Guide" config (catalogue PR). One modal that holds the brand-wide
 * size ladder — each size's price premium + head-circumference range + a short
 * tip — and the customer-facing "how to find your head size" guide. Seeded;
 * everything here is editable and shows on the website.
 */
type Row = SizeTier & {
  _inMin: string;
  _inMax: string;
  _premium: string;
  _premiumUsd: string;
  _tip: string;
};

export function SizeGuideModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const cfg = useSizeConfig();
  const save = useSaveSizeConfig();
  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [guide, setGuide] = useState("");
  // Optional YouTube / UGC video URL — surfaces on the storefront product
  // modal alongside the markdown guide. Empty = no video shown.
  const [videoUrl, setVideoUrl] = useState("");

  useEffect(() => {
    if (!open || !cfg.data) return;
    setRows(
      cfg.data.tiers.map((t) => ({
        ...t,
        _premium: t.premium_ngn != null ? String(t.premium_ngn) : "",
        _premiumUsd: t.premium_usd != null ? String(t.premium_usd) : "",
        _inMin:
          t.circumference_min_in != null ? String(t.circumference_min_in) : "",
        _inMax:
          t.circumference_max_in != null ? String(t.circumference_max_in) : "",
        _tip: t.guidance_text ?? "",
      })),
    );
    setTitle(cfg.data.config?.size_guide_title ?? "How to find your head size");
    setGuide(cfg.data.config?.head_size_guide_md ?? "");
    setVideoUrl(cfg.data.config?.head_size_video_url ?? "");
  }, [open, cfg.data]);

  const patch = (code: string, key: keyof Row, val: string) =>
    setRows((rs) =>
      rs.map((r) => (r.size_code === code ? { ...r, [key]: val } : r)),
    );

  const num = (s: string) => (s.trim() === "" ? null : Number(s));

  const submit = () => {
    const tiers = rows.map((r) => ({
      size_code: r.size_code,
      label: r.label,
      premium_ngn: num(r._premium) ?? 0,
      premium_usd: num(r._premiumUsd),
      circumference_min_in: num(r._inMin),
      circumference_max_in: num(r._inMax),
      // Keep cm in step with inches so the storefront can show either.
      circumference_min_cm:
        num(r._inMin) != null
          ? Math.round(Number(r._inMin) * 2.54 * 10) / 10
          : null,
      circumference_max_cm:
        num(r._inMax) != null
          ? Math.round(Number(r._inMax) * 2.54 * 10) / 10
          : null,
      guidance_text: r._tip.trim() || null,
      display_order: r.display_order,
      is_active: r.is_active,
    }));
    save.mutate(
      {
        tiers,
        size_guide_title: title.trim() || null,
        head_size_guide_md: guide.trim() || null,
        head_size_video_url: videoUrl.trim() || null,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Size & guide" size="lg">
      <div className="flex items-center gap-2 text-[12.5px] text-text-muted mb-4">
        <Ruler className="w-4 h-4 text-accent-glow" />
        Set the size premiums and the head-size guide once — they apply to every
        styled product and show on the website.
      </div>

      {cfg.isLoading ? (
        <div className="h-40 animate-pulse rounded-[12px] bg-text-primary/[0.04]" />
      ) : (
        <div className="space-y-5">
          {/* Tier ladder */}
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-text-faint text-left border-b hairline">
                  <th className="py-2 font-semibold">Size</th>
                  <th className="py-2 font-semibold">Premium (₦)</th>
                  <th className="py-2 font-semibold">Premium ($)</th>
                  <th className="py-2 font-semibold">
                    Head circumference (inches)
                  </th>
                  <th className="py-2 font-semibold">Tip</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.size_code}
                    className="border-b hairline last:border-0 align-top"
                  >
                    <td className="py-2 pr-2">
                      <div className="font-semibold">{r.size_code}</div>
                      <div className="text-[11px] text-text-faint">
                        {r.label}
                      </div>
                    </td>
                    <td className="py-2 pr-2 w-[120px]">
                      <NumberField
                        value={r._premium}
                        onChange={(v) => patch(r.size_code, "_premium", v)}
                        suffix="₦+"
                        className="[&_input]:h-[36px]"
                      />
                    </td>
                    <td className="py-2 pr-2 w-[120px]">
                      <NumberField
                        value={r._premiumUsd}
                        onChange={(v) => patch(r.size_code, "_premiumUsd", v)}
                        suffix="$+"
                        placeholder="—"
                        className="[&_input]:h-[36px]"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1.5 w-[180px]">
                        <NumberField
                          value={r._inMin}
                          onChange={(v) => patch(r.size_code, "_inMin", v)}
                          placeholder="min"
                          className="[&_input]:h-[36px]"
                        />
                        <span className="text-text-faint">–</span>
                        <NumberField
                          value={r._inMax}
                          onChange={(v) => patch(r.size_code, "_inMax", v)}
                          placeholder="max"
                          className="[&_input]:h-[36px]"
                        />
                      </div>
                    </td>
                    <td className="py-2">
                      <input
                        value={r._tip}
                        onChange={(e) =>
                          patch(r.size_code, "_tip", e.target.value)
                        }
                        placeholder="e.g. Average — fits most heads."
                        className="w-full h-[36px] px-[11px] rounded-[10px] bg-text-primary/[0.04] border border-line text-text-primary text-[12.5px] outline-none focus:border-accent/50"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-text-faint mt-1.5">
              Premiums are absolute amounts added to the styled anchor for that
              size. The USD premium is independent — set it for USD-priced
              products; leave it blank to skip. Nothing is auto-converted.
            </p>
          </div>

          {/* Guide copy */}
          <div className="pt-4 border-t hairline">
            <label className="micro block mb-1">Guide title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-[40px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 mb-3"
            />
            <label className="micro block mb-1">
              How-to guide (Markdown · shows on the website · emojis welcome 📏)
            </label>
            <textarea
              value={guide}
              onChange={(e) => setGuide(e.target.value)}
              rows={9}
              className="w-full px-[13px] py-2.5 rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[12.5px] leading-relaxed outline-none focus:border-accent/50 resize-y font-mono"
            />

            {/* Video URL (YouTube or any UGC mp4 link). Embedded in the
                storefront product modal alongside the markdown guide so the
                buyer can watch a demo instead of reading. */}
            <label className="micro block mt-4 mb-1 flex items-center gap-2">
              <Play className="w-3.5 h-3.5 text-accent-glow" />
              Head-size video (optional)
            </label>
            <input
              type="url"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              className="w-full h-[40px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line text-text-primary text-[13px] outline-none focus:border-accent/50 font-mono"
            />
            <p className="text-[11px] text-text-faint mt-1.5">
              YouTube share URL, Shorts, or any direct video link. Shown on
              the storefront product modal next to the guide. Leave blank to
              hide.
            </p>
            {videoUrl.trim() && youtubeId(videoUrl.trim()) && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
                <img
                  src={`https://i.ytimg.com/vi/${youtubeId(videoUrl.trim())}/mqdefault.jpg`}
                  alt=""
                  className="w-20 h-12 rounded-[6px] object-cover border border-line"
                />
                <span className="text-text-faint">
                  Preview · live thumbnail from YouTube
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {save.isError && (
        <p className="text-[12px] text-danger mt-3">
          {save.error instanceof Error ? save.error.message : "Could not save."}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={save.isPending}
          onClick={submit}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
