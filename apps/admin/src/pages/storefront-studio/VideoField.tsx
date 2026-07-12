/**
 * Storefront Studio — looping-video field ("living image").
 *
 * The operator drops in any video (phone MP4/MOV, screen capture…) and gets a
 * small clip studio: scrub and trim to a ≤10s window, pick a crop aspect and
 * where the crop sits, all against a live looping preview of exactly what the
 * storefront will play. On confirm the raw file goes to the backend, which
 * trims, crops, compresses and cleans it into HD/SD MP4 loops + a poster —
 * the slot then stores those URLs (see StorefrontVideo).
 *
 * The preview is honest: the stage is shaped by the chosen aspect and the
 * video sits in it with object-fit cover at the chosen focus, which is the
 * same geometry the FFmpeg crop reproduces server-side.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/Modal";
import { toast } from "@/stores/toast";
import { describeError } from "@/lib/error-report";
import {
  uploadStorefrontVideo,
  type StorefrontVideo,
} from "@/lib/storefront-studio";

const MAX_SECONDS = 10;
const MIN_SECONDS = 0.5;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const ASPECTS: { key: string; label: string }[] = [
  { key: "original", label: "Original" },
  { key: "16:9", label: "Wide 16:9" },
  { key: "4:3", label: "4:3" },
  { key: "1:1", label: "Square" },
  { key: "4:5", label: "4:5" },
  { key: "9:16", label: "Story 9:16" },
];

const labelCls = "mb-1 block text-[12px] font-medium text-text-muted";

/** Lenient read of whatever the slot currently holds. */
function parseVideo(value: unknown): StorefrontVideo | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  return typeof o.url === "string" && o.url
    ? (o as unknown as StorefrontVideo)
    : null;
}

function fmtSec(s: number): string {
  return `${s.toFixed(1)}s`;
}

function fmtMB(bytes?: number): string | null {
  if (!bytes) return null;
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

/* ────────────────────────────────────────────────────────────── */

export function VideoField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const video = parseVideo(value);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  function pick(file?: File) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("That video is over 200MB", {
        description:
          "Trim it shorter before uploading — the loop only keeps 10 seconds.",
      });
      return;
    }
    setPendingFile(file);
  }

  return (
    <div>
      <span className={labelCls}>{label}</span>
      {video ? (
        <div className="flex items-start gap-3">
          {/* The loop, playing exactly as the storefront will show it. */}
          <video
            src={video.url}
            poster={video.poster_url}
            autoPlay
            muted
            loop
            playsInline
            className="h-[84px] w-auto max-w-[150px] shrink-0 rounded-[8px] border border-line bg-black object-cover"
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-[12px] text-text-muted">
              {video.duration_sec ? `${fmtSec(video.duration_sec)} loop` : "Loop"}
              {video.width && video.height
                ? ` · ${video.width}×${video.height}`
                : ""}
              {fmtMB(video.bytes?.hd) ? ` · ${fmtMB(video.bytes?.hd)}` : ""}
            </p>
            <p className="text-[11px] text-text-muted/80">
              Plays silently on repeat, like a GIF. A lighter copy is served on
              slow connections.
            </p>
            <div className="flex gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                Replace
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onChange("")}>
                Remove
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-[10px] border border-dashed border-line px-3 py-3 text-left transition hover:border-accent-deep/60 hover:bg-text-primary/[0.03]"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-text-primary/[0.06]">
            <Clapperboard className="h-4 w-4 text-text-muted" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] text-text-primary">
              Upload a looping video
            </span>
            <span className="block text-[11px] text-text-muted">
              MP4 or MOV — you'll trim it to 10 seconds and we'll compress it
              so it loads fast everywhere.
            </span>
          </span>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="video/*,.mp4,.mov,.m4v,.webm"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {pendingFile ? (
        <ClipStudio
          file={pendingFile}
          onClose={() => setPendingFile(null)}
          onDone={(v) => {
            setPendingFile(null);
            onChange(v);
          }}
        />
      ) : null}
    </div>
  );
}

/* ── the trim/crop studio modal ──────────────────────────────── */

type Phase = "edit" | "uploading" | "processing";

function ClipStudio({
  file,
  onClose,
  onDone,
}: {
  file: File;
  onClose: () => void;
  onDone: (v: StorefrontVideo) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const src = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  // null until metadata loads; stays null for streams with no known length
  // (the server still clamps to the first 10s in that case).
  const [duration, setDuration] = useState<number | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(MAX_SECONDS);
  const [aspect, setAspect] = useState("original");
  const [focus, setFocus] = useState(0.5);
  const [phase, setPhase] = useState<Phase>("edit");
  const [progress, setProgress] = useState(0);

  const busy = phase !== "edit";

  function onMeta() {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : null;
    setDuration(d);
    setDims({ w: v.videoWidth, h: v.videoHeight });
    setStart(0);
    setEnd(d ? Math.min(MAX_SECONDS, d) : MAX_SECONDS);
  }

  // Keep playback looping inside the selected window.
  function onTime() {
    const v = videoRef.current;
    if (!v || duration == null) return;
    if (v.currentTime > end - 0.05 || v.currentTime < start - 0.3) {
      v.currentTime = start;
    }
  }

  /** Trim-track pointer drag: moves a handle (or the whole window). Local
   *  copies of the window track the live drag; state follows each move. */
  function beginDrag(which: "start" | "end" | "window") {
    return (down: React.PointerEvent) => {
      if (busy || duration == null) return;
      down.preventDefault();
      down.stopPropagation();
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const toTime = (clientX: number) =>
        Math.min(
          duration,
          Math.max(0, ((clientX - rect.left) / rect.width) * duration),
        );
      let s = start;
      let e = end;
      const windowLen = e - s;
      const grabOffset = toTime(down.clientX) - s;
      const move = (ev: PointerEvent) => {
        const t = toTime(ev.clientX);
        const v = videoRef.current;
        if (which === "start") {
          s = Math.max(0, Math.min(t, e - MIN_SECONDS));
          if (e - s > MAX_SECONDS) e = s + MAX_SECONDS;
          if (v) v.currentTime = s; // scrub: show the frame under the handle
        } else if (which === "end") {
          e = Math.min(duration, Math.max(t, s + MIN_SECONDS));
          if (e - s > MAX_SECONDS) s = e - MAX_SECONDS;
          if (v) v.currentTime = Math.max(0, e - 0.1);
        } else {
          s = Math.min(Math.max(0, t - grabOffset), duration - windowLen);
          e = s + windowLen;
          if (v) v.currentTime = s;
        }
        setStart(s);
        setEnd(e);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        videoRef.current?.play().catch(() => {});
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
  }

  // Crop preview geometry — which axis the crop trims, if any.
  const target = useMemo(() => {
    if (aspect === "original") return null;
    const [aw, ah] = aspect.split(":").map(Number);
    return aw / ah;
  }, [aspect]);
  const sourceRatio = dims ? dims.w / dims.h : null;
  const cropAxis: "x" | "y" | null =
    target && sourceRatio && Math.abs(sourceRatio - target) > 0.01
      ? sourceRatio > target
        ? "x"
        : "y"
      : null;
  const objectPosition =
    cropAxis === "x"
      ? `${focus * 100}% 50%`
      : cropAxis === "y"
        ? `50% ${focus * 100}%`
        : "50% 50%";

  const windowLen = Math.max(0, end - start);
  const pct = (t: number) => (duration ? (t / duration) * 100 : 0);

  async function submit() {
    setPhase("uploading");
    setProgress(0);
    try {
      const result = await uploadStorefrontVideo(
        file,
        { trim_start: start, trim_end: end, aspect, focus },
        (p) => {
          setProgress(p);
          if (p >= 100) setPhase("processing");
        },
      );
      toast.success(
        `Video ready — a ${fmtSec(result.duration_sec || windowLen)} loop${
          fmtMB(result.bytes?.hd) ? ` at ${fmtMB(result.bytes?.hd)}` : ""
        }.`,
      );
      onDone(result);
    } catch (err) {
      const { message, detail } = describeError(err);
      toast.error("Couldn't process the video", {
        description: message,
        report: {
          area: "Storefront Studio → Looping video",
          action: "Upload video",
          message,
          detail,
        },
      });
      setPhase("edit");
    }
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      title="Trim your loop"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={busy || (duration != null && windowLen < MIN_SECONDS)}
          >
            {phase === "uploading"
              ? `Uploading… ${progress}%`
              : phase === "processing"
                ? "Optimizing…"
                : "Trim & optimize"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Stage — shaped by the chosen aspect, cover-cropped like the site. */}
        <div
          className="mx-auto max-h-[340px] w-full overflow-hidden rounded-[12px] border border-line bg-black"
          style={{
            aspectRatio: target
              ? String(target)
              : sourceRatio
                ? String(sourceRatio)
                : "16 / 9",
          }}
        >
          <video
            ref={videoRef}
            src={src}
            autoPlay
            muted
            loop
            playsInline
            onLoadedMetadata={onMeta}
            onTimeUpdate={onTime}
            className={cn(
              "h-full w-full",
              aspect === "original" ? "object-contain" : "object-cover",
            )}
            style={{ objectPosition }}
          />
        </div>

        {/* Trim track */}
        {duration != null ? (
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className={labelCls}>Trim — keep up to 10 seconds</span>
              <span className="font-mono text-[12px] text-text-primary">
                {fmtSec(start)} – {fmtSec(end)}
                <span className="text-text-muted"> · {fmtSec(windowLen)} loop</span>
              </span>
            </div>
            <div
              ref={trackRef}
              className="relative h-9 touch-none select-none rounded-[8px] bg-text-primary/[0.07]"
            >
              {/* selected window (draggable as a whole) */}
              <div
                onPointerDown={beginDrag("window")}
                className="absolute inset-y-0 cursor-grab rounded-[8px] border-2 border-accent-deep bg-accent-deep/25 active:cursor-grabbing"
                style={{ left: `${pct(start)}%`, width: `${pct(windowLen)}%` }}
              />
              {/* handles */}
              <div
                onPointerDown={beginDrag("start")}
                className="absolute inset-y-0 z-10 w-4 -translate-x-1/2 cursor-ew-resize"
                style={{ left: `${pct(start)}%` }}
              >
                <span className="absolute inset-y-1 left-1/2 w-[5px] -translate-x-1/2 rounded-full bg-accent-deep" />
              </div>
              <div
                onPointerDown={beginDrag("end")}
                className="absolute inset-y-0 z-10 w-4 -translate-x-1/2 cursor-ew-resize"
                style={{ left: `${pct(end)}%` }}
              >
                <span className="absolute inset-y-1 left-1/2 w-[5px] -translate-x-1/2 rounded-full bg-accent-deep" />
              </div>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              Drag the edges to choose your moment — the preview loops exactly
              what shoppers will see.
            </p>
          </div>
        ) : (
          <p className="text-[12px] text-text-muted">
            <Play className="mr-1 inline h-3.5 w-3.5" />
            We couldn't read this file's length in the browser — we'll keep its
            first 10 seconds.
          </p>
        )}

        {/* Crop aspect */}
        <div>
          <span className={labelCls}>Crop</span>
          <div className="flex flex-wrap gap-1.5">
            {ASPECTS.map((a) => (
              <button
                key={a.key}
                type="button"
                disabled={busy}
                onClick={() => setAspect(a.key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12px] transition",
                  aspect === a.key
                    ? "border-accent-deep bg-accent-deep/15 text-text-primary"
                    : "border-line text-text-muted hover:text-text-primary",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
          {cropAxis ? (
            <div className="mt-2">
              <span className={labelCls}>
                {cropAxis === "x" ? "Crop position (left ↔ right)" : "Crop position (top ↕ bottom)"}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(focus * 100)}
                disabled={busy}
                onChange={(e) => setFocus(Number(e.target.value) / 100)}
                className="w-full accent-accent-deep"
              />
            </div>
          ) : null}
        </div>

        {/* Upload / optimize progress */}
        {busy ? (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-text-primary/10">
              <div
                className={cn(
                  "h-full rounded-full bg-accent-deep transition-[width] duration-300",
                  phase === "processing" && "animate-pulse",
                )}
                style={{ width: `${phase === "processing" ? 100 : progress}%` }}
              />
            </div>
            <p className="mt-1.5 text-[12px] text-text-muted">
              {phase === "uploading"
                ? "Uploading your video…"
                : "Compressing and enhancing — trimming, cleaning the picture and packing it small. Give it a few seconds."}
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
