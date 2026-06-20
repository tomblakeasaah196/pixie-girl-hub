import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Play, Pause } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  computePeaks,
  fmtDuration,
  getAudioContext,
} from "@/lib/messaging-media";

const BARS = 40;

/** WhatsApp-style voice-note player: play/pause + scrubbable waveform. */
export function VoiceNotePlayer({
  url,
  isOwn,
}: {
  url: string;
  isOwn?: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // Decode the file once to draw a real waveform (best-effort).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const ctx = getAudioContext();
        const audioBuf = await ctx.decodeAudioData(buf);
        if (!cancelled) {
          setPeaks(computePeaks(audioBuf.getChannelData(0), BARS));
          if (Number.isFinite(audioBuf.duration))
            setDuration(audioBuf.duration);
        }
        await ctx.close();
      } catch {
        if (!cancelled) setPeaks(Array.from({ length: BARS }, () => 0.4));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  function toggle() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) a.pause();
    else void a.play();
  }

  function seek(e: MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    a.currentTime = Math.max(0, Math.min(1, ratio)) * duration;
  }

  const progress = duration ? current / duration : 0;
  const shownPeaks = peaks.length
    ? peaks
    : Array.from({ length: BARS }, () => 0.3);

  return (
    <div className="flex items-center gap-2 min-w-[180px] max-w-[260px] py-0.5">
      <button
        onClick={toggle}
        className={cn(
          "grid place-items-center w-8 h-8 rounded-full shrink-0",
          isOwn ? "bg-bg/20 text-bg" : "bg-accent/15 text-accent-glow",
        )}
        title={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className="flex items-center gap-[2px] h-7 cursor-pointer"
          onClick={seek}
        >
          {shownPeaks.map((p, i) => {
            const active = i / BARS <= progress;
            return (
              <span
                key={i}
                className={cn(
                  "flex-1 rounded-full transition-colors",
                  active
                    ? isOwn
                      ? "bg-bg/80"
                      : "bg-accent"
                    : isOwn
                      ? "bg-bg/30"
                      : "bg-text-faint/40",
                )}
                style={{ height: `${Math.max(12, p * 100)}%` }}
              />
            );
          })}
        </div>
        <div
          className={cn(
            "text-[10px] mt-0.5 font-mono",
            isOwn ? "text-bg/70" : "text-text-faint",
          )}
        >
          {fmtDuration(current || duration)}
        </div>
      </div>
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration))
            setDuration(e.currentTarget.duration);
        }}
      />
    </div>
  );
}
